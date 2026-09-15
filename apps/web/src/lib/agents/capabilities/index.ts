import coordinator from "./coordinator.json" with { type: "json" };
import nutrition from "./nutrition.json" with { type: "json" };
import fitness from "./fitness.json" with { type: "json" };
import finance from "./finance.json" with { type: "json" };

export interface AgentCapabilities {
  agent: string;
  can: string[];
  cannot: string[];
}

const REGISTRY: Record<string, AgentCapabilities> = {
  coordinator,
  nutrition,
  fitness,
  finance,
};

export interface CapabilityCheck {
  agent: string;
  action: string; // "read:x" | "write:x" | "execute:x" | "delegate:x"
  resourceHouseholdId: string;
}

/**
 * AGENT_CONTRACTS.md §4: deny-by-default. An action is allowed only if explicitly listed in
 * `can` — being merely absent from `cannot` is never sufficient (IMPLEMENTATION_RULES.md #15).
 * `resourceHouseholdId` is accepted for signature-compatibility with the normative contract;
 * household scoping itself is enforced by RLS (SEC-001..005), not by this function.
 */
export function checkCapability(check: CapabilityCheck): "allow" | "deny" {
  const caps = REGISTRY[check.agent];
  if (!caps) return "deny";
  if (caps.cannot.includes(check.action)) return "deny";
  return caps.can.includes(check.action) ? "allow" : "deny";
}

export function requireCapability(check: CapabilityCheck): void {
  if (checkCapability(check) !== "allow") {
    throw new Error(`Capability denied: agent="${check.agent}" action="${check.action}"`);
  }
}
