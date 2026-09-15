import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
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

describe("Coordinator delegates workout-plan requests to the Fitness Agent (AGENT_CONTRACTS.md §14)", () => {
  beforeEach(truncateAll);

  it("a workout-plan request generates a draft plan via the Fitness Agent, never via the AI Provider's own arithmetic", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FitDelegate1");
    await seedFitnessCatalog();
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE profiles SET nutrition_goal = 'gain_muscle' WHERE id = $1", [household.profileId])
    );
    await recordMeasurement(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      takenAt: new Date(),
      weightKg: 85,
    });
    const spy = new SpyAIProvider();

    const response = await handleCoordinatorInvocation(
      pool,
      {
        requestId: newRequestId(),
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        message: "Pode montar o plano de treino da semana pra mim?",
      },
      { aiProvider: spy, modelId: "test-model" }
    );

    expect(spy.calls).toHaveLength(0);
    expect(response.reply).toMatch(/plano de treino/i);
    expect(response.reply).toMatch(/ainda não está ativo/i);

    const plans = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM workout_plans WHERE household_id = $1", [household.householdId])
    );
    expect(plans.rows).toHaveLength(1);
    expect(plans.rows[0].status).toBe("draft");
  });

  it("an unrelated message does not trigger workout delegation", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FitDelegate2");
    const spy = new SpyAIProvider();

    await handleCoordinatorInvocation(
      pool,
      { requestId: newRequestId(), householdId: household.householdId, userId: household.userId, message: "Como vai?" },
      { aiProvider: spy, modelId: "test-model" }
    );

    expect(spy.calls).toHaveLength(1);
  });
});
