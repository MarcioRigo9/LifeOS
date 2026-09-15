import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { startWorkoutSession, recordWorkoutSet } from "@/lib/fitness/workoutSessions";
import { generateWeeklyWorkoutPlan, proposeWorkoutPlanActivation } from "@/lib/fitness/workoutPlans";
import { approveDecision, executeApprovedDecision, newRequestId } from "@/lib/agents/decisions";
import { evaluateRisk } from "@/lib/policy-engine/evaluateRisk";

describe("Fitness actions are gated by risk level (SECURITY_MODEL.md §5-6)", () => {
  beforeEach(truncateAll);

  it("workout_log.create is LOW risk", () => {
    expect(evaluateRisk({ actionType: "workout_log.create", scope: { entityCount: 1, reversible: true } })).toBe("low");
  });

  it("workout_plan.activate is MEDIUM risk", () => {
    expect(evaluateRisk({ actionType: "workout_plan.activate", scope: { entityCount: 1, reversible: true } })).toBe(
      "medium"
    );
  });

  it("registering a completed set executes immediately — no agent_decisions row is ever created for it", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "PolicyFit1");
    const catalog = await seedFitnessCatalog();

    const sessionId = await startWorkoutSession(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      performedAt: new Date(),
    });
    await recordWorkoutSet(pool, {
      householdId: household.householdId,
      userId: household.userId,
      sessionId,
      exerciseId: catalog.benchPressId,
      setNumber: 1,
      reps: 10,
      loadKg: 80,
      rpe: 8,
    });

    const decisions = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT count(*) FROM agent_decisions")
    );
    expect(Number(decisions.rows[0].count)).toBe(0); // LOW risk -> straight to the table, no proposal

    const logs = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT count(*) FROM workout_logs WHERE workout_session_id = $1", [sessionId])
    );
    expect(Number(logs.rows[0].count)).toBe(1);
  });

  it("activating a workout_plan requires a full Approval -> Execution cycle, blocked by a tampered hash", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "PolicyFit2");
    await seedFitnessCatalog();

    const [plan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, bodyweightKg: 80, goal: "maintain" }],
    });

    const statusBefore = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM workout_plans WHERE id = $1", [plan.workoutPlanId])
    );
    expect(statusBefore.rows[0].status).toBe("draft");

    const proposal = await proposeWorkoutPlanActivation(pool, {
      householdId: household.householdId,
      userId: household.userId,
      workoutPlanId: plan.workoutPlanId,
    });
    expect(proposal.outcome).toBe("proposed");
    if (proposal.outcome !== "proposed") throw new Error("expected proposal");

    // Tampered hash is rejected.
    const tampered = proposal.proposalHash.slice(0, -1) + (proposal.proposalHash.endsWith("0") ? "1" : "0");
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        approveDecision(client, { decisionId: proposal.decisionId, proposalHash: tampered, approvedByProfileId: household.profileId })
      )
    ).rejects.toThrow();

    // Correct hash approves and executes cleanly.
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

    const statusAfter = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, version FROM workout_plans WHERE id = $1", [plan.workoutPlanId])
    );
    expect(statusAfter.rows[0].status).toBe("active");
    expect(statusAfter.rows[0].version).toBe(2);
  });
});
