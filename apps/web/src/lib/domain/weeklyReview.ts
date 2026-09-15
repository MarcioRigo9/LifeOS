// Deterministic, pure, unit-tested functions for the Weekly Review's cross-domain synthesis —
// the LLM never decides adherence percentages or calorie adjustments (IMPLEMENTATION_RULES.md #8).

/** Week-over-week % change in training tonnage. Null when there's no prior-week baseline to
 * compare against (never divides by zero, never invents a percentage). */
export function computeVolumeChangePct(previousTonnageKg: number, currentTonnageKg: number): number | null {
  if (previousTonnageKg <= 0) return null;
  return Math.round(((currentTonnageKg - previousTonnageKg) / previousTonnageKg) * 1000) / 10; // 1 decimal %
}

const VOLUME_INCREASE_THRESHOLD_PCT = 20;
const VOLUME_DECREASE_THRESHOLD_PCT = -20;
const VOLUME_INCREASE_CALORIE_ADJUSTMENT_KCAL = 150;
const VOLUME_DECREASE_CALORIE_ADJUSTMENT_KCAL = -100;

/**
 * Fixed, documented cross-domain rule (Fase 5 spec §2.3): a significant week-over-week rise in
 * training volume gets more fuel; a significant drop gets less — a deterministic threshold
 * table, never a number the LLM invents.
 */
export function suggestCalorieAdjustmentKcal(volumeChangePct: number | null): number {
  if (volumeChangePct === null) return 0;
  if (volumeChangePct >= VOLUME_INCREASE_THRESHOLD_PCT) return VOLUME_INCREASE_CALORIE_ADJUSTMENT_KCAL;
  if (volumeChangePct <= VOLUME_DECREASE_THRESHOLD_PCT) return VOLUME_DECREASE_CALORIE_ADJUSTMENT_KCAL;
  return 0;
}

export interface DailyTargetsLike {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Applies a calorie delta entirely to carbs — protein (fixed at 2g/kg bodyweight) and fat
 * (fixed at 25% of calories) stay individualized and untouched, same "never invent a split"
 * discipline as calculateDailyTargets (domain/nutrition.ts). */
export function adjustDailyTargetsForCalorieDelta(base: DailyTargetsLike, deltaKcal: number): DailyTargetsLike {
  if (deltaKcal === 0) return base;
  const carbsG = Math.max(0, Math.round(base.carbsG + deltaKcal / 4));
  return { calories: base.calories + deltaKcal, proteinG: base.proteinG, carbsG, fatG: base.fatG };
}

export interface HabitLogLike {
  completed: boolean;
}

export interface HabitAdherence {
  completedCount: number;
  totalLogged: number;
  missedCount: number;
  adherencePct: number; // 0-100
}

/** Adherence is computed only from what was actually LOGGED this week — a day with no log is
 * neither a pass nor a fail, it's simply not counted (never invents a missed day that wasn't
 * recorded, same "não deixar para o LLM" discipline). */
export function computeHabitAdherence(logs: HabitLogLike[]): HabitAdherence {
  const totalLogged = logs.length;
  const completedCount = logs.filter((l) => l.completed).length;
  const missedCount = totalLogged - completedCount;
  const adherencePct = totalLogged === 0 ? 0 : Math.round((completedCount / totalLogged) * 1000) / 10;
  return { completedCount, totalLogged, missedCount, adherencePct };
}
