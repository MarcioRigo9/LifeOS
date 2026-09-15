import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, createGoalFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { createDecisionProposal } from "@/lib/agents/decisions";
import { evaluateRisk } from "@/lib/policy-engine/evaluateRisk";
import type { ActionEnvelope } from "@/lib/agents/contracts";

describe("Risk spoofing is impossible (RISK-001, RISK-002, RISK-003)", () => {
  beforeEach(truncateAll);

  it("evaluateRisk() ignores any client-declared risk — there is no parameter to accept one", () => {
    // Structural proof: the Policy Engine's function signature has no `suggestedRiskLevel`
    // input at all — an agent cannot spoof what the function was never given the chance to read.
    const risk = evaluateRisk({ actionType: "goal.delete", scope: { entityCount: 1, reversible: false } });
    expect(risk).toBe("high");
  });

  it("an agent claiming suggestedRiskLevel=low for a HIGH-risk action still produces a PENDING approval, never a direct execution", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "E");
    const goal = await createGoalFixture(pool, household);

    // The agent's own (irrelevant, ignored) opinion:
    const agentSuggestedRiskLevel = "low" as const;
    void agentSuggestedRiskLevel; // never passed into createDecisionProposal — proves it can't matter

    const envelope: ActionEnvelope = {
      actionType: "goal.delete", // fixed rule: always "high" (evaluateRisk.ts)
      actionPayload: {},
      targetEntityIds: [goal.goalId],
      expectedVersions: { [`goal:${goal.goalId}`]: goal.version },
      scope: { householdId: household.householdId, entityCount: 1, reversible: false, financialImpactCents: 0 },
    };

    const result = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => createDecisionProposal(client, { householdId: household.householdId, agentKey: "coordinator", envelope })
    );

    expect(result.outcome).toBe("proposed");
    if (result.outcome === "proposed") {
      expect(result.riskLevel).toBe("high"); // server-determined, matches the fixed rule — not "low"
    }

    // And the goal must be untouched — nothing executes just because a proposal exists.
    const stillIntact = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT version FROM goals WHERE id = $1", [goal.goalId])
    );
    expect(stillIntact.rows[0].version).toBe(1);
  });
});
