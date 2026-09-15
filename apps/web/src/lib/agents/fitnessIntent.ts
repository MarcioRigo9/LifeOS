// Deterministic routing signal (same pattern as nutritionIntent.ts / healthSafety.ts).
const WORKOUT_PLAN_REQUEST_PATTERNS: RegExp[] = [
  /\bplano de treino\b/i,
  /\btreino da semana\b/i,
  /\bmonte?u?\b.*\btreino\b/i,
  /\bo que (eu|a gente|n[óo]s) vamos? treinar\b/i,
];

export function isWorkoutPlanRequest(message: string): boolean {
  return WORKOUT_PLAN_REQUEST_PATTERNS.some((p) => p.test(message));
}
