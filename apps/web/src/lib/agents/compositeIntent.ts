// Deterministic routing signal (same pattern as nutritionIntent.ts / fitnessIntent.ts) — detects
// a single message asking for a BODY-RECOMPOSITION style goal that spans both domains at once
// (e.g. "Quero secar 3kg este mês mantendo massa magra"), so the Coordinator decomposes it into
// parallel Nutrition + Fitness AgentTasks instead of routing it to either specialist alone
// (Fase 5 spec §2.1, AGENT_CONTRACTS.md §14).
const COMPOSITE_REQUEST_PATTERNS: RegExp[] = [
  /\bsecar\b.*\bmassa\b/i,
  /\bemagrecer\b.*\bmassa\b/i,
  /\bperder\s+\d+(?:[.,]\d+)?\s*kg\b.*\bmassa\b/i,
  /\bmassa\b.*\bsecar\b/i,
];

export function isCompositeTransformationRequest(message: string): boolean {
  return COMPOSITE_REQUEST_PATTERNS.some((p) => p.test(message));
}

/** Extracts an optional target-kg number from phrasing like "secar 3kg este mês" — informational
 * only (recorded in the memory entry), never required for the composite path to run. */
export function extractTargetKg(message: string): number | null {
  const match = message.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
  if (!match) return null;
  return Number(match[1].replace(",", "."));
}
