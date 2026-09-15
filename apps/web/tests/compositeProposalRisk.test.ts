import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { createBasicMealSet } from "./setup/nutritionFixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordMeasurement } from "@/lib/health/measurements";
import { generateWeeklyMealPlan } from "@/lib/nutrition/mealPlans";
import { generateWeeklyWorkoutPlan } from "@/lib/fitness/workoutPlans";
import { proposeCompositePlanActivation } from "@/lib/agents/weeklyReview";
import { approveDecision, executeApprovedDecision, newRequestId } from "@/lib/agents/decisions";
import { evaluateRisk } from "@/lib/policy-engine/evaluateRisk";

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

describe("Composite (meal-plan + workout-plan) activation proposals are gated by the Policy Engine (Fase 5 §8, non-negotiable rule)", () => {
  beforeEach(truncateAll);

  it("composite.activate_plans is MEDIUM risk", () => {
    expect(evaluateRisk({ actionType: "composite.activate_plans", scope: { entityCount: 2, reversible: true } })).toBe(
      "medium"
    );
  });

  it("a joint proposal requires ONE proposal_hash approval, is blocked by a tampered hash, and activates both plans atomically on the correct hash", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "CompositeRisk1");
    await createBasicMealSet(pool, household);
    await seedFitnessCatalog();
    await completeProfile(pool, household);

    const mealPlan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, dailyTargets: { calories: 2200, proteinG: 160, carbsG: 220, fatG: 60 } }],
    });
    const [workoutPlan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, bodyweightKg: 82, goal: "maintain" }],
    });

    const proposal = await proposeCompositePlanActivation(pool, {
      householdId: household.householdId,
      userId: household.userId,
      mealPlanId: mealPlan.mealPlanId,
      workoutPlanIds: [workoutPlan.workoutPlanId],
    });
    expect(proposal.outcome).toBe("proposed");
    if (proposal.outcome !== "proposed") throw new Error("expected proposed");
    expect(proposal.riskLevel).toBe("medium");

    // Exactly one agent_decisions row for the whole composite action, not two.
    const decisions = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT count(*) FROM agent_decisions")
    );
    expect(Number(decisions.rows[0].count)).toBe(1);

    // Tampered hash is rejected.
    const tampered = proposal.proposalHash.slice(0, -1) + (proposal.proposalHash.endsWith("0") ? "1" : "0");
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        approveDecision(client, { decisionId: proposal.decisionId, proposalHash: tampered, approvedByProfileId: household.profileId })
      )
    ).rejects.toThrow();

    // Both plans are still drafts — a rejected approval never applies anything.
    const stillDraft = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM meal_plans WHERE id = $1", [mealPlan.mealPlanId])
    );
    expect(stillDraft.rows[0].status).toBe("draft");

    // Correct hash approves and executes cleanly — both plans become active in one transaction.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      approveDecision(client, { decisionId: proposal.decisionId, proposalHash: proposal.proposalHash, approvedByProfileId: household.profileId })
    );
    const outcome = await executeApprovedDecision(pool, {
      householdId: household.householdId,
      userId: household.userId,
      decisionId: proposal.decisionId,
      requestId: newRequestId(),
    });
    expect(outcome.result).toBe("executed");

    const mealAfter = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, version FROM meal_plans WHERE id = $1", [mealPlan.mealPlanId])
    );
    expect(mealAfter.rows[0].status).toBe("active");
    expect(mealAfter.rows[0].version).toBe(2);

    const workoutAfter = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, version FROM workout_plans WHERE id = $1", [workoutPlan.workoutPlanId])
    );
    expect(workoutAfter.rows[0].status).toBe("active");
    expect(workoutAfter.rows[0].version).toBe(2);
  });

  it("a stale workout_plan version rolls back the WHOLE composite action — the meal_plan is never left half-activated", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "CompositeRisk2");
    await createBasicMealSet(pool, household);
    await seedFitnessCatalog();
    await completeProfile(pool, household);

    const mealPlan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, dailyTargets: { calories: 2200, proteinG: 160, carbsG: 220, fatG: 60 } }],
    });
    const [workoutPlan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, bodyweightKg: 82, goal: "maintain" }],
    });

    const proposal = await proposeCompositePlanActivation(pool, {
      householdId: household.householdId,
      userId: household.userId,
      mealPlanId: mealPlan.mealPlanId,
      workoutPlanIds: [workoutPlan.workoutPlanId],
    });
    if (proposal.outcome !== "proposed") throw new Error("expected proposed");

    // Someone else bumps the workout_plan's version out from under the pending proposal.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE workout_plans SET version = version + 1 WHERE id = $1", [workoutPlan.workoutPlanId])
    );

    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      approveDecision(client, { decisionId: proposal.decisionId, proposalHash: proposal.proposalHash, approvedByProfileId: household.profileId })
    );
    const outcome = await executeApprovedDecision(pool, {
      householdId: household.householdId,
      userId: household.userId,
      decisionId: proposal.decisionId,
      requestId: newRequestId(),
    });
    expect(outcome.result).toBe("failed");

    // The meal_plan's version-conflict-free UPDATE ran first but must have been rolled back too.
    const mealAfter = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, version FROM meal_plans WHERE id = $1", [mealPlan.mealPlanId])
    );
    expect(mealAfter.rows[0].status).toBe("draft");
    expect(mealAfter.rows[0].version).toBe(1);
  });
});
