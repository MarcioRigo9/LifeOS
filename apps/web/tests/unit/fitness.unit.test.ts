import { describe, expect, it } from "vitest";
import {
  progressionEngine,
  volumeCalculator,
  suggestStartingLoadKg,
  getContraindicatedBodyRegions,
  validateWorkoutSet,
  ImplausibleWorkoutValueError,
  REP_RANGE_BY_GOAL,
  type WorkoutLogEntry,
  type ExerciseTarget,
} from "@/lib/domain/fitness";

const BENCH_TARGET: ExerciseTarget = { exerciseType: "compound", targetSets: 3, minReps: 6, maxReps: 10, targetRpe: 8 };

function session(sessionId: string, daysAgo: number, loadKg: number, reps: number[], rpe: (number | null)[], completed?: boolean[]): WorkoutLogEntry[] {
  const performedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return reps.map((r, i) => ({
    sessionId,
    performedAt,
    setNumber: i + 1,
    reps: r,
    loadKg,
    rpe: rpe[i],
    completed: completed ? completed[i] : true,
  }));
}

describe("progressionEngine — deterministic, pure function of history alone", () => {
  it("3 bench press sessions all hitting the top of the rep range at target RPE -> exact +2.5kg increment", () => {
    const history: WorkoutLogEntry[] = [
      ...session("s1", 14, 80, [10, 10, 10], [8, 8, 8]),
      ...session("s2", 7, 80, [10, 10, 10], [8, 8, 7.5]),
      ...session("s3", 0, 80, [10, 10, 10], [8, 7.5, 8]), // most recent — this is what decides
    ];

    const rec = progressionEngine(history, BENCH_TARGET);
    expect(rec.action).toBe("increase_load");
    expect(rec.lastLoadKg).toBe(80);
    expect(rec.recommendedLoadKg).toBe(82.5); // exact, documented increment for compound lifts
  });

  it("reconstruction proof: calling it again from the SAME raw history produces the identical result — no hidden state", () => {
    const history: WorkoutLogEntry[] = [
      ...session("s1", 14, 80, [10, 10, 10], [8, 8, 8]),
      ...session("s2", 7, 80, [10, 10, 10], [8, 8, 7.5]),
      ...session("s3", 0, 80, [10, 10, 10], [8, 7.5, 8]),
    ];
    const first = progressionEngine(history, BENCH_TARGET);
    const second = progressionEngine([...history].reverse(), BENCH_TARGET); // even shuffled input order
    expect(second).toEqual(first);
  });

  it("RPE above 9.5 in the most recent session triggers a deload, even if reps were hit", () => {
    const history: WorkoutLogEntry[] = [
      ...session("s1", 7, 80, [10, 10, 10], [8, 8, 8]),
      ...session("s2", 0, 80, [10, 10, 10], [8, 8, 9.8]),
    ];
    const rec = progressionEngine(history, BENCH_TARGET);
    expect(rec.action).toBe("deload");
    expect(rec.recommendedLoadKg).toBe(72); // 80 * 0.9
  });

  it("recurring failure (incomplete sets in 2 of the last 3 sessions) triggers a deload", () => {
    const history: WorkoutLogEntry[] = [
      ...session("s1", 14, 80, [10, 10, 10], [8, 8, 8], [true, true, false]),
      ...session("s2", 7, 80, [10, 10, 10], [8, 8, 8], [true, true, true]),
      ...session("s3", 0, 80, [10, 10, 6], [8, 8, 9], [true, true, false]),
    ];
    const rec = progressionEngine(history, BENCH_TARGET);
    expect(rec.action).toBe("deload");
  });

  it("not yet at the top of the rep range -> maintain the same load", () => {
    const history: WorkoutLogEntry[] = [...session("s1", 0, 80, [7, 7, 6], [8, 8, 8.5])];
    const rec = progressionEngine(history, BENCH_TARGET);
    expect(rec.action).toBe("maintain");
    expect(rec.recommendedLoadKg).toBe(80);
  });

  it("isolation exercises get the smaller documented increment (1.5kg)", () => {
    const history: WorkoutLogEntry[] = [...session("s1", 0, 15, [12, 12, 12], [7, 7, 7])];
    const target: ExerciseTarget = { exerciseType: "isolation", targetSets: 3, minReps: 10, maxReps: 12, targetRpe: 8 };
    const rec = progressionEngine(history, target);
    expect(rec.action).toBe("increase_load");
    expect(rec.recommendedLoadKg).toBe(16.5);
  });
});

describe("volumeCalculator", () => {
  it("computes total tonnage and effective sets per muscle group, completed sets only", () => {
    const result = volumeCalculator(
      [
        { exerciseId: "bench", reps: 10, loadKg: 80, completed: true },
        { exerciseId: "bench", reps: 10, loadKg: 80, completed: true },
        { exerciseId: "bench", reps: 5, loadKg: 80, completed: false }, // excluded — not completed
        { exerciseId: "squat", reps: 8, loadKg: 100, completed: true },
      ],
      { bench: { primaryMuscleGroup: "chest" }, squat: { primaryMuscleGroup: "legs" } }
    );
    expect(result.totalTonnageKg).toBe(2400); // (10*80)+(10*80)+(8*100) = 800+800+800
    expect(result.effectiveSetsByMuscleGroup).toEqual({ chest: 2, legs: 1 });
    expect(result.tonnageByMuscleGroup).toEqual({ chest: 1600, legs: 800 });
  });
});

describe("suggestStartingLoadKg — individualized by bodyweight", () => {
  it("different bodyweights produce different starting loads for the same exercise", () => {
    const marcio = suggestStartingLoadKg("compound", 90);
    const brenda = suggestStartingLoadKg("compound", 60);
    expect(marcio).not.toBe(brenda);
    expect(marcio).toBeGreaterThan(brenda);
  });
});

describe("getContraindicatedBodyRegions", () => {
  it("an active shoulder injury contraindicates the shoulders region", () => {
    const regions = getContraindicatedBodyRegions([
      { category: "injury", title: "Tendinite no ombro direito", details: "diagnosticada em 2025", active: true },
    ]);
    expect(regions).toContain("shoulders");
  });

  it("an INACTIVE (resolved) injury does not contraindicate anything", () => {
    const regions = getContraindicatedBodyRegions([
      { category: "injury", title: "Tendinite no ombro", details: "resolvida", active: false },
    ]);
    expect(regions).toEqual([]);
  });

  it("allergy/medication entries never contraindicate an exercise region", () => {
    const regions = getContraindicatedBodyRegions([
      { category: "allergy", title: "Alergia a amendoim", details: "ombro não relacionado", active: true },
    ]);
    expect(regions).toEqual([]);
  });
});

describe("validateWorkoutSet", () => {
  it("rejects non-positive or non-integer reps, non-positive load, and out-of-range RPE", () => {
    expect(() => validateWorkoutSet({ reps: 0, loadKg: 80 })).toThrow(ImplausibleWorkoutValueError);
    expect(() => validateWorkoutSet({ reps: 10.5, loadKg: 80 })).toThrow(ImplausibleWorkoutValueError);
    expect(() => validateWorkoutSet({ reps: 10, loadKg: 0 })).toThrow(ImplausibleWorkoutValueError);
    expect(() => validateWorkoutSet({ reps: 10, loadKg: 80, rpe: 11 })).toThrow(ImplausibleWorkoutValueError);
    expect(() => validateWorkoutSet({ reps: 10, loadKg: 80, rpe: 8 })).not.toThrow();
  });
});

describe("REP_RANGE_BY_GOAL", () => {
  it("gain_muscle and lose_weight have different rep ranges (individualization by goal)", () => {
    expect(REP_RANGE_BY_GOAL.gain_muscle).not.toEqual(REP_RANGE_BY_GOAL.lose_weight);
  });
});
