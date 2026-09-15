import { describe, expect, it } from "vitest";
import { checkCapability } from "@/lib/agents/capabilities";

describe("Capabilities deny-by-default (TOOL-001)", () => {
  it("denies an action not present in `can`, even if also absent from `cannot`", () => {
    expect(checkCapability({ agent: "nutrition", action: "write:financial_transactions", resourceHouseholdId: "x" })).toBe(
      "deny"
    );
  });

  it("allows an action explicitly listed in `can`", () => {
    expect(checkCapability({ agent: "nutrition", action: "write:meal_plans", resourceHouseholdId: "x" })).toBe("allow");
  });

  it("denies an unknown agent entirely", () => {
    expect(checkCapability({ agent: "does-not-exist", action: "read:profiles", resourceHouseholdId: "x" })).toBe("deny");
  });

  it("specialist -> specialist delegation is never a capability any agent has (AGENT-001)", () => {
    expect(checkCapability({ agent: "nutrition", action: "delegate:fitness", resourceHouseholdId: "x" })).toBe("deny");
    expect(checkCapability({ agent: "fitness", action: "delegate:nutrition", resourceHouseholdId: "x" })).toBe("deny");
  });

  it("Coordinator cannot delegate to itself (no recursion)", () => {
    expect(checkCapability({ agent: "coordinator", action: "delegate:coordinator", resourceHouseholdId: "x" })).toBe(
      "deny"
    );
  });
});
