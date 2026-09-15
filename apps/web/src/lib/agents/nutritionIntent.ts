// Deterministic routing signal (same spirit as healthSafety.ts's keyword classifier) — the
// Coordinator decides WHETHER to delegate to the Nutrition Agent without asking the LLM to
// decide, keeping delegation auditable and testable without a network call.
const MEAL_PLAN_REQUEST_PATTERNS: RegExp[] = [
  /\bplano (alimentar|de refei[çc][õo]es)\b/i,
  /\bcardápio (da semana|semanal)\b/i,
  /\bmonte?u?\b.*\brefei[çc][õo]es\b/i,
  /\bo que (eu|a gente|n[óo]s) vamos? comer\b/i,
];

export function isMealPlanRequest(message: string): boolean {
  return MEAL_PLAN_REQUEST_PATTERNS.some((p) => p.test(message));
}
