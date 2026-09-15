import { describe, expect, it } from "vitest";
import { checkCapability, requireCapability } from "@/lib/agents/capabilities";

describe("Strict star topology: Coordinator <-> specialist only, never specialist <-> specialist (Fase 5 non-negotiable rule)", () => {
  it("the Nutrition Agent has no delegate:fitness capability — invoking Fitness from Nutrition fails at the capabilities middleware", () => {
    expect(checkCapability({ agent: "nutrition", action: "delegate:fitness", resourceHouseholdId: "hh-1" })).toBe("deny");
    expect(() => requireCapability({ agent: "nutrition", action: "delegate:fitness", resourceHouseholdId: "hh-1" })).toThrow(
      /capability denied/i
    );
  });

  it("the Fitness Agent has no delegate:nutrition capability — invoking Nutrition from Fitness fails at the capabilities middleware", () => {
    expect(checkCapability({ agent: "fitness", action: "delegate:nutrition", resourceHouseholdId: "hh-1" })).toBe("deny");
    expect(() => requireCapability({ agent: "fitness", action: "delegate:nutrition", resourceHouseholdId: "hh-1" })).toThrow(
      /capability denied/i
    );
  });

  it("neither specialist can delegate to itself, to finance, or back to the coordinator", () => {
    expect(checkCapability({ agent: "nutrition", action: "delegate:nutrition", resourceHouseholdId: "hh-1" })).toBe("deny");
    expect(checkCapability({ agent: "nutrition", action: "delegate:finance", resourceHouseholdId: "hh-1" })).toBe("deny");
    expect(checkCapability({ agent: "nutrition", action: "delegate:coordinator", resourceHouseholdId: "hh-1" })).toBe("deny");
    expect(checkCapability({ agent: "fitness", action: "delegate:fitness", resourceHouseholdId: "hh-1" })).toBe("deny");
    expect(checkCapability({ agent: "fitness", action: "delegate:finance", resourceHouseholdId: "hh-1" })).toBe("deny");
    expect(checkCapability({ agent: "fitness", action: "delegate:coordinator", resourceHouseholdId: "hh-1" })).toBe("deny");
  });

  it("only the Coordinator is allowed to delegate to either specialist", () => {
    expect(checkCapability({ agent: "coordinator", action: "delegate:nutrition", resourceHouseholdId: "hh-1" })).toBe("allow");
    expect(checkCapability({ agent: "coordinator", action: "delegate:fitness", resourceHouseholdId: "hh-1" })).toBe("allow");
  });

  it("an unknown agent key is denied by default (deny-by-default, AGENT_CONTRACTS.md §4)", () => {
    expect(checkCapability({ agent: "nutrition_evil_clone", action: "delegate:fitness", resourceHouseholdId: "hh-1" })).toBe(
      "deny"
    );
  });
});
