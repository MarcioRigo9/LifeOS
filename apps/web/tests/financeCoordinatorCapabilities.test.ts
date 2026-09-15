import { describe, expect, it } from "vitest";
import { checkCapability, requireCapability } from "@/lib/agents/capabilities";

describe("Coordinator capability isolation from financial detail (Fase 7 §1, SECURITY_MODEL.md §4)", () => {
  it("the Coordinator does NOT have read:financial_accounts_detail — denied even though it's a broadly-capable agent", () => {
    expect(checkCapability({ agent: "coordinator", action: "read:financial_accounts_detail", resourceHouseholdId: "hh-1" })).toBe(
      "deny"
    );
    expect(() =>
      requireCapability({ agent: "coordinator", action: "read:financial_accounts_detail", resourceHouseholdId: "hh-1" })
    ).toThrow(/capability denied/i);
  });

  it("the Coordinator has no write capability over any financial_* table either", () => {
    for (const action of ["write:financial_accounts", "write:financial_transactions", "write:financial_budgets", "write:financial_goals"]) {
      expect(checkCapability({ agent: "coordinator", action, resourceHouseholdId: "hh-1" })).toBe("deny");
    }
  });

  it("the finance agent's own reserved capabilities are declarative only — no execution path ever grants them at runtime (D009/ADR 022)", () => {
    // The registration exists (so it can be denied/allowed consistently once the Finance Agent
    // is actually built), but nothing in the Coordinator ever constructs an AgentTask with
    // agent: "finance" — this asserts the capability CHECK function itself, which is the only
    // thing that would matter if such a call were ever made.
    expect(checkCapability({ agent: "finance", action: "read:financial_aggregates", resourceHouseholdId: "hh-1" })).toBe("allow");
    expect(checkCapability({ agent: "finance", action: "write:external_transfers", resourceHouseholdId: "hh-1" })).toBe("deny");
    expect(checkCapability({ agent: "finance", action: "delegate:coordinator", resourceHouseholdId: "hh-1" })).toBe("deny");
  });

  it("nutrition and fitness never gain financial capabilities either — deny-by-default extends to every non-finance agent", () => {
    expect(checkCapability({ agent: "nutrition", action: "read:financial_accounts_detail", resourceHouseholdId: "hh-1" })).toBe(
      "deny"
    );
    expect(checkCapability({ agent: "fitness", action: "read:financial_accounts_detail", resourceHouseholdId: "hh-1" })).toBe(
      "deny"
    );
  });
});
