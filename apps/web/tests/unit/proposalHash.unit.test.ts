import { describe, expect, it } from "vitest";
import { computeProposalHash } from "@/lib/agents/proposalHash";
import { canonicalStringify } from "@/lib/agents/canonicalJson";
import type { ActionEnvelope } from "@/lib/agents/contracts";

const baseEnvelope: ActionEnvelope = {
  actionType: "goal.update_target",
  actionPayload: { newTargetValue: 75 },
  targetEntityIds: ["goal-1"],
  expectedVersions: { "goal:goal-1": 3 },
  scope: { householdId: "hh-1", entityCount: 1, reversible: true, financialImpactCents: 0 },
};

describe("canonicalStringify / computeProposalHash (APPROVAL-003)", () => {
  it("is insensitive to key insertion order (canonical serialization)", () => {
    const a = { b: 1, a: 2, c: { y: 1, x: 2 } };
    const b = { a: 2, c: { x: 2, y: 1 }, b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("distinguishes null from a missing key", () => {
    expect(canonicalStringify({ a: null })).not.toBe(canonicalStringify({}));
  });

  it("same envelope + same riskLevel always produces the same hash (deterministic)", () => {
    const h1 = computeProposalHash(baseEnvelope, "medium");
    const h2 = computeProposalHash(structuredClone(baseEnvelope), "medium");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changing riskLevel alone changes the hash (risk is part of what's protected)", () => {
    const low = computeProposalHash(baseEnvelope, "medium");
    const high = computeProposalHash(baseEnvelope, "high");
    expect(low).not.toBe(high);
  });

  it("a one-character change in actionPayload changes the hash", () => {
    const original = computeProposalHash(baseEnvelope, "medium");
    const tampered = computeProposalHash(
      { ...baseEnvelope, actionPayload: { newTargetValue: 76 } },
      "medium"
    );
    expect(original).not.toBe(tampered);
  });
});
