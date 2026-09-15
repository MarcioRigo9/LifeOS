import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, createGoalFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { createDecisionProposal, approveDecision, DecisionError } from "@/lib/agents/decisions";
import type { ActionEnvelope } from "@/lib/agents/contracts";

describe("Proposal hash integrity (APPROVAL-003, APPROVAL-004)", () => {
  beforeEach(truncateAll);

  it("a single changed character in the approved payload's hash is rejected — execution is blocked", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "F");
    const goal = await createGoalFixture(pool, household);

    const envelope: ActionEnvelope = {
      actionType: "goal.update_target",
      actionPayload: { newTargetValue: 75 },
      targetEntityIds: [goal.goalId],
      expectedVersions: { [`goal:${goal.goalId}`]: goal.version },
      scope: { householdId: household.householdId, entityCount: 1, reversible: true, financialImpactCents: 0 },
    };

    const proposal = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => createDecisionProposal(client, { householdId: household.householdId, agentKey: "coordinator", envelope })
    );
    if (proposal.outcome !== "proposed") throw new Error("expected a proposal");

    // Flip one character of the hash — simulates a tampered/stale client-side copy.
    const tamperedHash = proposal.proposalHash.slice(0, -1) + (proposal.proposalHash.endsWith("0") ? "1" : "0");

    const profileId = household.profileId;
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        approveDecision(client, { decisionId: proposal.decisionId, proposalHash: tamperedHash, approvedByProfileId: profileId })
      )
    ).rejects.toBeInstanceOf(DecisionError);

    // The real hash still approves correctly — proves the rejection above was about the hash,
    // not some unrelated bug.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      approveDecision(client, { decisionId: proposal.decisionId, proposalHash: proposal.proposalHash, approvedByProfileId: profileId })
    );

    const row = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT status FROM agent_decisions WHERE id = $1", [proposal.decisionId])
    );
    expect(row.rows[0].status).toBe("APPROVED");
  });

  it("changing the actionPayload after the proposal was created changes the hash (proves the hash covers the action, not just a label)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "G");
    const goal = await createGoalFixture(pool, household);

    const baseEnvelope: ActionEnvelope = {
      actionType: "goal.update_target",
      actionPayload: { newTargetValue: 75 },
      targetEntityIds: [goal.goalId],
      expectedVersions: { [`goal:${goal.goalId}`]: goal.version },
      scope: { householdId: household.householdId, entityCount: 1, reversible: true, financialImpactCents: 0 },
    };
    const alteredEnvelope: ActionEnvelope = {
      ...baseEnvelope,
      actionPayload: { newTargetValue: 999 }, // "1 bit" flipped in spirit: a materially different action
    };

    const [proposalA, proposalB] = await Promise.all(
      [baseEnvelope, alteredEnvelope].map((envelope) =>
        withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
          createDecisionProposal(client, { householdId: household.householdId, agentKey: "coordinator", envelope })
        )
      )
    );
    if (proposalA.outcome !== "proposed" || proposalB.outcome !== "proposed") throw new Error("expected proposals");

    expect(proposalA.proposalHash).not.toBe(proposalB.proposalHash);

    // Approving with proposal A's hash must never authorize executing proposal B's decisionId.
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        approveDecision(client, {
          decisionId: proposalB.decisionId,
          proposalHash: proposalA.proposalHash,
          approvedByProfileId: household.profileId,
        })
      )
    ).rejects.toBeInstanceOf(DecisionError);
  });
});
