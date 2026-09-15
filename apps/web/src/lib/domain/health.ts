// Deterministic, pure, unit-tested functions — the LLM never computes these
// (ARCHITECTURE.md §1 principle 2, IMPLEMENTATION_RULES.md #8).

export class ImplausibleMeasurementError extends Error {
  constructor(public field: string, public value: number, public min: number, public max: number) {
    super(`${field} value ${value} is outside the plausible range [${min}, ${max}]`);
  }
}

// Business plausibility bounds — narrower and more meaningful than the DB's loose sanity
// CHECK (db/migrations/0010_health.sql), which exists only as a last-resort backstop.
const PLAUSIBLE_RANGES = {
  weight_kg: { min: 20, max: 350 },
  body_fat_pct: { min: 2, max: 70 },
  muscle_mass_kg: { min: 5, max: 150 },
  waist_cm: { min: 30, max: 250 },
  hip_cm: { min: 30, max: 250 },
  arm_cm: { min: 10, max: 100 },
  height_cm: { min: 40, max: 250 },
} as const;

export type PlausibleField = keyof typeof PLAUSIBLE_RANGES;

/** Throws ImplausibleMeasurementError if `value` is outside the known-plausible human range. */
export function validatePlausibleRange(field: PlausibleField, value: number): void {
  const range = PLAUSIBLE_RANGES[field];
  if (value < range.min || value > range.max) {
    throw new ImplausibleMeasurementError(field, value, range.min, range.max);
  }
}

export type BmiClassification = "underweight" | "normal" | "overweight" | "obese";

export interface BmiResult {
  bmi: number;
  classification: BmiClassification;
}

function classifyBmi(bmi: number): BmiClassification {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

/** Standard WHO formula: weight (kg) / height (m)^2. Rounded to 1 decimal. */
export function calculateBmi(weightKg: number, heightCm: number): BmiResult {
  validatePlausibleRange("weight_kg", weightKg);
  validatePlausibleRange("height_cm", heightCm);
  const heightM = heightCm / 100;
  const bmi = Math.round((weightKg / (heightM * heightM)) * 10) / 10;
  return { bmi, classification: classifyBmi(bmi) };
}

export interface WeightPoint {
  takenAt: Date;
  weightKg: number;
}

export type TrendDirection = "gaining" | "losing" | "stable";

export interface WeightTrend {
  firstWeightKg: number;
  lastWeightKg: number;
  deltaKg: number;
  daysSpanned: number;
  direction: TrendDirection;
}

const STABLE_THRESHOLD_KG = 0.3; // deltas smaller than this count as "stable" noise, not a trend

/**
 * Simple, deterministic delta between the earliest and latest point in a (not necessarily
 * sorted) series — not a statistical model, exactly the "não deixar para o LLM" requirement.
 * Returns null when there isn't enough data (0 or 1 points) to compute a trend at all.
 */
export function calculateWeightTrend(points: WeightPoint[]): WeightTrend | null {
  if (points.length < 2) return null;

  const sorted = [...points].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const deltaKg = Math.round((last.weightKg - first.weightKg) * 100) / 100;
  const daysSpanned = Math.max(
    0,
    Math.round((last.takenAt.getTime() - first.takenAt.getTime()) / (1000 * 60 * 60 * 24))
  );

  let direction: TrendDirection = "stable";
  if (deltaKg > STABLE_THRESHOLD_KG) direction = "gaining";
  else if (deltaKg < -STABLE_THRESHOLD_KG) direction = "losing";

  return { firstWeightKg: first.weightKg, lastWeightKg: last.weightKg, deltaKg, daysSpanned, direction };
}
