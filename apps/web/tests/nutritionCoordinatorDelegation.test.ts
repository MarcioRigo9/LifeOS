import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { createBasicMealSet } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordMeasurement } from "@/lib/health/measurements";
import { handleCoordinatorInvocation } from "@/lib/agents/coordinator";
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
       activity_level = 'moderate', nutrition_goal = 'maintain' WHERE id = $1`,
      [household.profileId]
    )
  );
  await recordMeasurement(pool, {
    householdId: household.householdId,
    userId: household.userId,
    personId: household.profileId,
    takenAt: new Date(),
    weightKg: 82,
  });
}

describe("Coordinator delegates meal-plan requests to the Nutrition Agent (AGENT_CONTRACTS.md §14)", () => {
  beforeEach(truncateAll);

  it("a meal-plan request generates a draft plan via the Nutrition Agent, never via the AI Provider's own arithmetic", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Delegate1");
    await createBasicMealSet(pool, household);
    await completeProfile(pool, household);
    const spy = new SpyAIProvider();

    const response = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        message: "Pode montar o plano alimentar da semana pra gente?",
      },
      { aiProvider: spy, modelId: "test-model" }
    );

    // The Nutrition Agent's deterministic path handled this — the LLM was never asked to
    // invent a plan or do arithmetic for it.
    expect(spy.calls).toHaveLength(0);
    expect(response.reply).toMatch(/plano semanal/i);
    expect(response.reply).toMatch(/ainda não está ativo/i); // human-in-the-loop reminder

    const planRows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM meal_plans WHERE household_id = $1", [household.householdId])
    );
    expect(planRows.rows).toHaveLength(1);
    expect(planRows.rows[0].status).toBe("draft"); // delegation generates, never activates
  });

  it("reports missing profile data explicitly instead of guessing targets", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Delegate2");
    await createBasicMealSet(pool, household);
    // Deliberately: completeProfile() NOT called — profile is missing biometrics.
    const spy = new SpyAIProvider();

    const response = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        message: "Monta o plano alimentar da semana",
      },
      { aiProvider: spy, modelId: "test-model" }
    );

    expect(spy.calls).toHaveLength(0);
    expect(response.reply).toMatch(/faltam dados/i);

    const planRows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT count(*) FROM meal_plans WHERE household_id = $1", [household.householdId])
    );
    expect(Number(planRows.rows[0].count)).toBe(0); // nothing generated on incomplete data
  });

  it("an unrelated message does NOT trigger nutrition delegation and reaches the AI Provider normally", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Delegate3");
    const spy = new SpyAIProvider();

    await handleCoordinatorInvocation(
      pool,
      { requestId: newRequestId(), householdId: household.householdId, userId: household.userId, message: "Bom dia!" },
      { aiProvider: spy, modelId: "test-model" }
    );

    expect(spy.calls).toHaveLength(1);
  });
});
