export type RiskLevel = "low" | "medium" | "high";

export interface RiskEvaluationInput {
  actionType: string;
  scope: {
    entityCount: number;
    reversible: boolean;
    financialImpactCents?: number;
  };
}

// Deterministic, server-side, versioned in code — never configuration read from the agent's
// output (AGENT_CONTRACTS.md §6, ADR 012, IMPLEMENTATION_RULES.md #1).
const FIXED_RULES: Record<string, RiskLevel> = {
  "test.echo": "low",
  "test.medium_action": "medium",
  "test.high_action": "high",
  "goal.create": "low",
  "habit.create": "low",
  "goal.update_target": "medium",
  "goal.delete": "high",
  "profile.update_sensitive": "medium",
  "meal_plan.activate": "medium",
  "workout_plan.activate": "medium",
  "workout_log.create": "low",
  "composite.activate_plans": "medium",
};

const FINANCIAL_IMPACT_HIGH_THRESHOLD_CENTS = 10_000; // R$ 100,00

/**
 * The single authoritative source of `riskLevel`. Whatever `suggestedRiskLevel` an agent sends
 * is informative only (AGENT_CONTRACTS.md §3, §6) — this function is the only thing that ever
 * decides whether an action executes directly (low) or requires a human approval proposal
 * (medium/high). Never accepts or reads a caller-supplied risk value.
 */
export function evaluateRisk(input: RiskEvaluationInput): RiskLevel {
  if (
    typeof input.scope.financialImpactCents === "number" &&
    input.scope.financialImpactCents > FINANCIAL_IMPACT_HIGH_THRESHOLD_CENTS
  ) {
    return "high";
  }

  const fixed = FIXED_RULES[input.actionType];
  if (fixed) return fixed;

  if (!input.scope.reversible) return "high";
  if (input.scope.entityCount > 5) return "medium";
  return "low";
}
