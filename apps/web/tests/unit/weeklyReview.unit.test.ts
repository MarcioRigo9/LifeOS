import { describe, expect, it } from "vitest";
import {
  computeVolumeChangePct,
  suggestCalorieAdjustmentKcal,
  adjustDailyTargetsForCalorieDelta,
  computeHabitAdherence,
} from "@/lib/domain/weeklyReview";

describe("computeVolumeChangePct", () => {
  it("computes a % change between two weeks' tonnage", () => {
    expect(computeVolumeChangePct(1000, 1200)).toBe(20);
    expect(computeVolumeChangePct(1000, 800)).toBe(-20);
    expect(computeVolumeChangePct(1000, 1000)).toBe(0);
  });

  it("returns null when there's no prior-week baseline (never divides by zero)", () => {
    expect(computeVolumeChangePct(0, 500)).toBeNull();
    expect(computeVolumeChangePct(-5, 500)).toBeNull();
  });
});

describe("suggestCalorieAdjustmentKcal", () => {
  it("suggests +150kcal when volume rose >= 20%", () => {
    expect(suggestCalorieAdjustmentKcal(20)).toBe(150);
    expect(suggestCalorieAdjustmentKcal(35)).toBe(150);
  });

  it("suggests -100kcal when volume dropped <= -20%", () => {
    expect(suggestCalorieAdjustmentKcal(-20)).toBe(-100);
    expect(suggestCalorieAdjustmentKcal(-40)).toBe(-100);
  });

  it("suggests no change for a stable week or when there's no baseline", () => {
    expect(suggestCalorieAdjustmentKcal(10)).toBe(0);
    expect(suggestCalorieAdjustmentKcal(-10)).toBe(0);
    expect(suggestCalorieAdjustmentKcal(null)).toBe(0);
  });
});

describe("adjustDailyTargetsForCalorieDelta", () => {
  it("applies the whole delta to carbs, leaving protein/fat untouched", () => {
    const base = { calories: 2000, proteinG: 160, carbsG: 200, fatG: 55 };
    const adjusted = adjustDailyTargetsForCalorieDelta(base, 150);
    expect(adjusted).toEqual({ calories: 2150, proteinG: 160, carbsG: 238, fatG: 55 });
  });

  it("never lets carbs go negative even with a large deficit", () => {
    const base = { calories: 1500, proteinG: 150, carbsG: 20, fatG: 40 };
    const adjusted = adjustDailyTargetsForCalorieDelta(base, -200);
    expect(adjusted.carbsG).toBe(0);
  });

  it("is a no-op for a zero delta", () => {
    const base = { calories: 2000, proteinG: 160, carbsG: 200, fatG: 55 };
    expect(adjustDailyTargetsForCalorieDelta(base, 0)).toBe(base);
  });
});

describe("computeHabitAdherence", () => {
  it("computes completed/missed counts and adherence % from only what was logged", () => {
    const logs = [{ completed: true }, { completed: true }, { completed: false }, { completed: true }];
    expect(computeHabitAdherence(logs)).toEqual({ completedCount: 3, totalLogged: 4, missedCount: 1, adherencePct: 75 });
  });

  it("never invents a missed day for a day with no log at all", () => {
    expect(computeHabitAdherence([])).toEqual({ completedCount: 0, totalLogged: 0, missedCount: 0, adherencePct: 0 });
  });
});
