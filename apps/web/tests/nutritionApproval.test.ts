import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { createBasicMealSet } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { generateWeeklyMealPlan, proposeMealPlanActivation } from "@/lib/nutrition/mealPlans";
import { approveDecision, executeApprovedDecision, DecisionError, newRequestId } from "@/lib/agents/decisions";
import { evaluateRisk } from "@/lib/policy-engine/evaluateRisk";
import { calculateDailyTargets } from "@/lib/domain/nutrition";

describe("Meal plan activation is gated by the Policy Engine (MEDIUM risk, human approval)", () => {
  beforeEach(truncateAll);

  it("meal_plan.activate is classified MEDIUM by the server, never executed directly", () => {
    expect(evaluateRisk({ actionType: "meal_plan.activate", scope: { entityCount: 1, reversible: true } })).toBe(
      "medium"
    );
  });

  it("proposing activation never changes the plan's status — it stays draft until approved AND executed", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Approve1");
    await createBasicMealSet(pool, household);
    const targets = calculateDailyTargets({
      weightKg: 75,
      heightCm: 175,
      age: 30,
      sex: "male",
      activityLevel: "moderate",
      goal: "maintain",
    });
    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [{ personId: household.profileId, dailyTargets: targets }],
    });

    const proposal = await proposeMealPlanActivation(pool, {
      householdId: household.householdId,
      userId: household.userId,
      mealPlanId: plan.mealPlanId,
    });
    expect(proposal.outcome).toBe("proposed");

    const statusAfterProposal = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM meal_plans WHERE id = $1", [plan.mealPlanId])
    );
    expect(statusAfterProposal.rows[0].status).toBe("draft"); // unchanged — a proposal is not an execution

    if (proposal.outcome !== "proposed") throw new Error("expected proposal");
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      approveDecision(client, {
        decisionId: proposal.decisionId,
        proposalHash: proposal.proposalHash,
        approvedByProfileId: household.profileId,
      })
    );
    const outcome = await executeApprovedDecision(pool, {
      householdId: household.householdId,
      userId: household.userId,
      decisionId: proposal.decisionId,
      requestId: newRequestId(),
    });
    expect(outcome.result).toBe("executed");

    const statusAfterExecution = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, version FROM meal_plans WHERE id = $1", [plan.mealPlanId])
    );
    expect(statusAfterExecution.rows[0].status).toBe("active");
    expect(statusAfterExecution.rows[0].version).toBe(2); // bumped by the versioned update
  });

  it("changing the plan after proposing invalidates the proposal hash — approval is blocked", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Approve2");
    await createBasicMealSet(pool, household);
    const targets = calculateDailyTargets({
      weightKg: 75,
      heightCm: 175,
      age: 30,
      sex: "male",
      activityLevel: "moderate",
      goal: "maintain",
    });
    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [{ personId: household.profileId, dailyTargets: targets }],
    });

    const proposal = await proposeMealPlanActivation(pool, {
      householdId: household.householdId,
      userId: household.userId,
      mealPlanId: plan.mealPlanId,
    });
    if (proposal.outcome !== "proposed") throw new Error("expected proposal");

    // The plan's version changes underneath the proposal (e.g. someone edited it) — this must
    // invalidate approval even with the ORIGINAL (now-stale) hash the human saw.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE meal_plans SET version = version + 1 WHERE id = $1", [plan.mealPlanId])
    );

    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      approveDecision(client, {
        decisionId: proposal.decisionId,
        proposalHash: proposal.proposalHash,
        approvedByProfileId: household.profileId,
      })
    );
    // The approval itself succeeds (the DecisionProposal record is still internally consistent —
    // its hash matches what was stored) — but execution re-checks expectedVersions against the
    // CURRENT plan and must fail, because the plan changed after the proposal was made.
    const outcome = await executeApprovedDecision(pool, {
      householdId: household.householdId,
      userId: household.userId,
      decisionId: proposal.decisionId,
      requestId: newRequestId(),
    });
    expect(outcome.result).toBe("failed");

    const finalStatus = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM meal_plans WHERE id = $1", [plan.mealPlanId])
    );
    expect(finalStatus.rows[0].status).toBe("draft"); // never activated on stale expectedVersions
  });

  it("a tampered proposal hash is rejected outright at approval time", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Approve3");
    await createBasicMealSet(pool, household);
    const targets = calculateDailyTargets({
      weightKg: 75,
      heightCm: 175,
      age: 30,
      sex: "male",
      activityLevel: "moderate",
      goal: "maintain",
    });
    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [{ personId: household.profileId, dailyTargets: targets }],
    });
    const proposal = await proposeMealPlanActivation(pool, {
      householdId: household.householdId,
      userId: household.userId,
      mealPlanId: plan.mealPlanId,
    });
    if (proposal.outcome !== "proposed") throw new Error("expected proposal");

    const tamperedHash = proposal.proposalHash.slice(0, -1) + (proposal.proposalHash.endsWith("0") ? "1" : "0");
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        approveDecision(client, {
          decisionId: proposal.decisionId,
          proposalHash: tamperedHash,
          approvedByProfileId: household.profileId,
        })
      )
    ).rejects.toBeInstanceOf(DecisionError);
  });
});
