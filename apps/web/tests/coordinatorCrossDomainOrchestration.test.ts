import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { createBasicMealSet } from "./setup/nutritionFixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordMeasurement } from "@/lib/health/measurements";
import { handleCoordinatorInvocation } from "@/lib/agents/coordinator";
import { checkCapability } from "@/lib/agents/capabilities";
import { FakeAIProvider } from "@/lib/ai-provider/fake";
import { newRequestId } from "@/lib/auth/session";
import type { AICompleteInput, AIProvider, AIResponse } from "@/lib/ai-provider/types";

class SpyAIProvider implements AIProvider {
  calls: AICompleteInput[] = [];
  private inner = new FakeAIProvider();
  async complete(input: AICompleteInput): Promise<AIResponse> {
    this.calls.push(input);
    return this.inner.complete(input);
  }
}

async function completeProfile(pool: ReturnType<typeof getTestRuntimePool>, household: Awaited<ReturnType<typeof createHouseholdFixture>>) {
  await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
    client.query(
      `UPDATE profiles SET birth_date = '1990-01-01', sex = 'male', height_cm = 178,
       activity_level = 'moderate', nutrition_goal = 'lose_weight' WHERE id = $1`,
      [household.profileId]
    )
  );
  await recordMeasurement(pool, {
    householdId: household.householdId,
    userId: household.userId,
    personId: household.profileId,
    takenAt: new Date(),
    weightKg: 90,
  });
}

describe("Coordinator cross-domain orchestration (Fase 5 §2.1)", () => {
  beforeEach(truncateAll);

  it("a composite body-recomposition request triggers BOTH the Nutrition and Fitness Agents and returns one consolidated reply", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Composite1");
    await createBasicMealSet(pool, household);
    await seedFitnessCatalog();
    await completeProfile(pool, household);
    const spy = new SpyAIProvider();

    const response = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        message: "Quero secar 3kg este mês mantendo massa magra, pode me ajudar?",
      },
      { aiProvider: spy, modelId: "test-model" }
    );

    // Handled entirely by the deterministic composite path — the LLM was never asked to invent
    // a plan or reconcile the two domains itself.
    expect(spy.calls).toHaveLength(0);
    expect(response.reply).toMatch(/plano alimentar/i);
    expect(response.reply).toMatch(/plano de treino/i);
    expect(response.reply).toMatch(/aprovação/i);

    const mealPlans = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM meal_plans WHERE household_id = $1", [household.householdId])
    );
    expect(mealPlans.rows).toHaveLength(1);
    expect(mealPlans.rows[0].status).toBe("draft");

    const workoutPlans = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM workout_plans WHERE household_id = $1", [household.householdId])
    );
    expect(workoutPlans.rows).toHaveLength(1);
    expect(workoutPlans.rows[0].status).toBe("draft");

    // Session memory & synthesis (§2.4): an inferred pattern, never a confirmed fact.
    const memories = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT type, confidence, source_type FROM agent_memories WHERE household_id = $1", [household.householdId])
    );
    expect(memories.rows).toHaveLength(1);
    expect(memories.rows[0].type).toBe("learned_pattern");
    expect(memories.rows[0].source_type).toBe("agent_inferred");
    expect(Number(memories.rows[0].confidence)).toBeLessThan(1.0);
  });

  it("star topology: the composite path never lets Nutrition and Fitness call each other, only the Coordinator", () => {
    // Neither specialist is ever granted a delegate:<other specialist> capability — this is what
    // makes a direct Nutrition <-> Fitness call structurally impossible, not just avoided by
    // convention (see starTopologyEnforcement.test.ts for the direct proof).
    expect(checkCapability({ agent: "nutrition", action: "delegate:fitness", resourceHouseholdId: "any" })).toBe("deny");
    expect(checkCapability({ agent: "fitness", action: "delegate:nutrition", resourceHouseholdId: "any" })).toBe("deny");
  });

  it("a plain unrelated message does not trigger composite orchestration", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Composite2");
    const spy = new SpyAIProvider();

    await handleCoordinatorInvocation(
      pool,
      { requestId: newRequestId(), householdId: household.householdId, userId: household.userId, message: "Oi, tudo bem?" },
      { aiProvider: spy, modelId: "test-model" }
    );

    expect(spy.calls).toHaveLength(1);
  });
});
