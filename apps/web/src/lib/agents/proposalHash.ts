import { createHash } from "node:crypto";
import { canonicalStringify } from "./canonicalJson";
import type { ActionEnvelope } from "./contracts";
import type { RiskLevel } from "@/lib/policy-engine/evaluateRisk";

/**
 * AGENT_CONTRACTS.md §8.3: SHA-256 over a canonical serialization of exactly
 * { actionType, actionPayload, targetEntityIds, expectedVersions, scope, riskLevel }.
 * Computed once, at proposal creation — never recomputed from client-supplied data to
 * "validate" an approval; validation is a straight string comparison against the value
 * stored in agent_decisions.proposal_hash (immutable once written).
 */
export function computeProposalHash(envelope: ActionEnvelope, riskLevel: RiskLevel): string {
  const canonical = canonicalStringify({
    actionType: envelope.actionType,
    actionPayload: envelope.actionPayload,
    targetEntityIds: envelope.targetEntityIds,
    expectedVersions: envelope.expectedVersions,
    scope: envelope.scope,
    riskLevel,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
