import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, createGoalFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import {
  createDecisionProposal,
  approveDecision,
  rejectDecision,
  executeApprovedDecision,
  reapStuckExecutions,
  DecisionError,
  newRequestId,
} from "@/lib/agents/decisions";
import type { ActionEnvelope } from "@/lib/agents/contracts";

function makeEnvelope(household: { householdId: string }, goalId: string, version: number, newTargetValue: number): ActionEnvelope {
  return {
    actionType: "goal.update_target",
    actionPayload: { newTargetValue },
    targetEntityIds: [goalId],
    expectedVersions: { [`goal:${goalId}`]: version },
    scope: { householdId: household.householdId, entityCount: 1, reversible: true, financialImpactCents: 0 },
  };
}

describe("Approval -> Execution pipeline (EXEC-001..004, APPROVAL-005)", () => {
  beforeEach(truncateAll);

  it("full happy path: PENDING -> APPROVED -> EXECUTING -> EXECUTED, goal actually updated, decision_executions recorded", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "I");
    const goal = await createGoalFixture(pool, household, { targetValue: 80 });

    const proposal = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        createDecisionProposal(client, {
          householdId: household.householdId,
          agentKey: "coordinator",
          envelope: makeEnvelope(household, goal.goalId, goal.version, 70),
        })
    );
    if (proposal.outcome !== "proposed") throw new Error("expected proposal");
    expect(proposal.riskLevel).toBe("medium");

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

    const decisionRow = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM agent_decisions WHERE id = $1", [proposal.decisionId])
    );
    expect(decisionRow.rows[0].status).toBe("EXECUTED");

    const execRow = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status FROM decision_executions WHERE decision_id = $1", [proposal.decisionId])
    );
    expect(execRow.rows[0].status).toBe("executed");

    const goalRow = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT target_value, version FROM goals WHERE id = $1", [goal.goalId])
    );
    expect(goalRow.rows[0].target_value).toBe("70");
    expect(goalRow.rows[0].version).toBe(2);
  });

  it("rejects invalid state transitions (e.g. approving a REJECTED decision)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "J");
    const goal = await createGoalFixture(pool, household);

    const proposal = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        createDecisionProposal(client, {
          householdId: household.householdId,
          agentKey: "coordinator",
          envelope: makeEnvelope(household, goal.goalId, goal.version, 70),
        })
    );
    if (proposal.outcome !== "proposed") throw new Error("expected proposal");

    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      rejectDecision(client, proposal.decisionId)
    );

    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        approveDecision(client, {
          decisionId: proposal.decisionId,
          proposalHash: proposal.proposalHash,
          approvedByProfileId: household.profileId,
        })
      )
    ).rejects.toBeInstanceOf(DecisionError);
  });

  it("concurrent execution attempts on the same approved decision: exactly one executes (EXEC-002)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "K");
    const goal = await createGoalFixture(pool, household);

    const proposal = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        createDecisionProposal(client, {
          householdId: household.householdId,
          agentKey: "coordinator",
          envelope: makeEnvelope(household, goal.goalId, goal.version, 70),
        })
    );
    if (proposal.outcome !== "proposed") throw new Error("expected proposal");
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      approveDecision(client, {
        decisionId: proposal.decisionId,
        proposalHash: proposal.proposalHash,
        approvedByProfileId: household.profileId,
      })
    );

    const [a, b] = await Promise.all([
      executeApprovedDecision(pool, {
        householdId: household.householdId,
        userId: household.userId,
        decisionId: proposal.decisionId,
        requestId: newRequestId(),
      }),
      executeApprovedDecision(pool, {
        householdId: household.householdId,
        userId: household.userId,
        decisionId: proposal.decisionId,
        requestId: newRequestId(),
      }),
    ]);

    const results = [a.result, b.result].sort();
    expect(results).toEqual(["already_claimed", "executed"]);

    const execRows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT count(*) FROM decision_executions WHERE decision_id = $1", [proposal.decisionId])
    );
    expect(Number(execRows.rows[0].count)).toBe(1); // unique constraint + atomic claim: exactly one row, ever
  });

  it("crash recovery: EXECUTING with an expired lease and no decision_executions row is safely requeued to APPROVED (EXEC-003)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "L");
    const goal = await createGoalFixture(pool, household);

    const proposal = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        createDecisionProposal(client, {
          householdId: household.householdId,
          agentKey: "coordinator",
          envelope: makeEnvelope(household, goal.goalId, goal.version, 70),
        })
    );
    if (proposal.outcome !== "proposed") throw new Error("expected proposal");
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      approveDecision(client, {
        decisionId: proposal.decisionId,
        proposalHash: proposal.proposalHash,
        approvedByProfileId: household.profileId,
      })
    );

    // Simulate a worker that claimed the decision then crashed before doing anything else —
    // manually put it into EXECUTING with an already-expired lease, exactly as the atomic
    // claim in executeApprovedDecision would, but without ever writing decision_executions.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query(
        `UPDATE agent_decisions
         SET status = 'EXECUTING', execution_started_at = now() - interval '1 minute',
             execution_lease_expires_at = now() - interval '30 seconds'
         WHERE id = $1`,
        [proposal.decisionId]
      )
    );

    const reaped = await reapStuckExecutions(pool, { householdId: household.householdId, userId: household.userId });
    expect(reaped.requeued).toBe(1);
    expect(reaped.reconciledExecuted).toBe(0);

    const decisionRow = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, attempts FROM agent_decisions WHERE id = $1", [proposal.decisionId])
    );
    expect(decisionRow.rows[0].status).toBe("APPROVED");
    expect(decisionRow.rows[0].attempts).toBe(1);

    // And now it can genuinely execute — proves the requeue actually left it executable.
    const outcome = await executeApprovedDecision(pool, {
      householdId: household.householdId,
      userId: household.userId,
      decisionId: proposal.decisionId,
      requestId: newRequestId(),
    });
    expect(outcome.result).toBe("executed");
  });
});
