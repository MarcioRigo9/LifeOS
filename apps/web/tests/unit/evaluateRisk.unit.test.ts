import { describe, expect, it } from "vitest";
import { evaluateRisk } from "@/lib/policy-engine/evaluateRisk";

describe("evaluateRisk (RISK-001, RISK-002)", () => {
  it("fixed rules win regardless of scope", () => {
    expect(evaluateRisk({ actionType: "goal.delete", scope: { entityCount: 1, reversible: true } })).toBe("high");
    expect(evaluateRisk({ actionType: "goal.create", scope: { entityCount: 1, reversible: false } })).toBe("low");
  });

  it("large financial impact forces high, overriding a fixed 'medium' rule", () => {
    expect(
      evaluateRisk({
        actionType: "goal.update_target",
        scope: { entityCount: 1, reversible: true, financialImpactCents: 50_000 },
      })
    ).toBe("high");
  });

  it("unknown action types fall back to scope-based heuristics", () => {
    expect(evaluateRisk({ actionType: "unknown.thing", scope: { entityCount: 1, reversible: false } })).toBe("high");
    expect(evaluateRisk({ actionType: "unknown.thing", scope: { entityCount: 10, reversible: true } })).toBe("medium");
    expect(evaluateRisk({ actionType: "unknown.thing", scope: { entityCount: 1, reversible: true } })).toBe("low");
  });
});
