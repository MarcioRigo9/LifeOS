import { describe, expect, it } from "vitest";
import {
  progressionEngine,
  volumeCalculator,
  suggestStartingLoadKg,
  getContraindicatedBodyRegions,
  validateWorkoutSet,
  buildWeeklySplit,
  ImplausibleWorkoutValueError,
  REP_RANGE_BY_GOAL,
  type WorkoutLogEntry,
  type ExerciseTarget,
  type SplitExerciseInput,
} from "@/lib/domain/fitness";

// The full real seed catalog (scripts/seed-catalog.ts) — 13 exercises, used as-is so these tests
// exercise the split logic against the actual production data shape, not a hand-picked subset.
const FULL_CATALOG: SplitExerciseInput[] = [
  { id: "supino", name: "Supino reto", primaryMuscleGroup: "chest", exerciseType: "compound" },
  { id: "agachamento", name: "Agachamento livre", primaryMuscleGroup: "legs", exerciseType: "compound" },
  { id: "terra", name: "Levantamento terra", primaryMuscleGroup: "back", exerciseType: "compound" },
  { id: "desenvolvimento", name: "Desenvolvimento militar", primaryMuscleGroup: "shoulders", exerciseType: "compound" },
  { id: "remada", name: "Remada curvada", primaryMuscleGroup: "back", exerciseType: "compound" },
  { id: "puxada", name: "Puxada na polia", primaryMuscleGroup: "back", exerciseType: "compound" },
  { id: "legpress", name: "Leg press", primaryMuscleGroup: "legs", exerciseType: "compound" },
  { id: "rosca", name: "Rosca direta", primaryMuscleGroup: "arms", exerciseType: "isolation" },
  { id: "triceps", name: "Tríceps corda", primaryMuscleGroup: "arms", exerciseType: "isolation" },
  { id: "elevacao", name: "Elevação lateral", primaryMuscleGroup: "shoulders", exerciseType: "isolation" },
  { id: "cadeira", name: "Cadeira extensora", primaryMuscleGroup: "legs", exerciseType: "isolation" },
  { id: "panturrilha", name: "Panturrilha em pé", primaryMuscleGroup: "legs", exerciseType: "isolation" },
  { id: "prancha", name: "Prancha abdominal", primaryMuscleGroup: "core", exerciseType: "isolation" },
];
const byId = (id: string) => FULL_CATALOG.find((e) => e.id === id)!;

describe("buildWeeklySplit — coherent muscle-group sessions, never a full-catalog dump per day", () => {
  it("3 days/week: Push/Pull/Legs never mixes antagonistic groups on the same day", () => {
    const sessions = buildWeeklySplit(FULL_CATALOG, 3);
    expect(sessions).toHaveLength(3);

    const push = sessions.find((s) => s.label.startsWith("Push"))!;
    const pull = sessions.find((s) => s.label.startsWith("Pull"))!;
    const legs = sessions.find((s) => s.label.startsWith("Legs"))!;

    // Legs day: only leg exercises — never squat mixed with chest/back/shoulders.
    expect(legs.exerciseIds).toContain("agachamento");
    expect(legs.exerciseIds.every((id) => byId(id).primaryMuscleGroup === "legs")).toBe(true);

    // Push has chest+shoulders+triceps, never back or legs.
    expect(push.exerciseIds).toContain("supino");
    expect(push.exerciseIds).toContain("desenvolvimento");
    expect(push.exerciseIds).toContain("triceps"); // Tríceps corda -> Push, not Pull
    expect(push.exerciseIds).not.toContain("rosca"); // biceps stays out of Push
    expect(push.exerciseIds.some((id) => byId(id).primaryMuscleGroup === "legs")).toBe(false);
    expect(push.exerciseIds.some((id) => byId(id).primaryMuscleGroup === "back")).toBe(false);

    // Pull has back+biceps+core, never chest/shoulders/legs — the ticket's explicit
    // "never agachamento pesado junto com remada/terra" rule: deadlift/rows land with Pull,
    // squat/leg-press land with Legs, always on different days.
    expect(pull.exerciseIds).toContain("terra");
    expect(pull.exerciseIds).toContain("remada");
    expect(pull.exerciseIds).toContain("rosca"); // biceps -> Pull, not Push
    expect(pull.exerciseIds).not.toContain("triceps");
    expect(pull.exerciseIds.some((id) => byId(id).primaryMuscleGroup === "legs")).toBe(false);

    for (const s of sessions) {
      expect(s.exerciseIds.length).toBeGreaterThanOrEqual(4);
      expect(s.exerciseIds.length).toBeLessThanOrEqual(6);
    }
  });

  it("4 days/week: Upper/Lower pairs, capped at 6/session, distinct dayOfWeek with a rest day", () => {
    const sessions = buildWeeklySplit(FULL_CATALOG, 4);
    expect(sessions).toHaveLength(4);
    expect(sessions.map((s) => s.dayOfWeek).sort()).toEqual([0, 1, 3, 4]); // Wed (2) is rest

    const lowerSessions = sessions.filter((s) => s.label.startsWith("Lower"));
    const upperSessions = sessions.filter((s) => s.label.startsWith("Upper"));
    expect(lowerSessions).toHaveLength(2);
    expect(upperSessions).toHaveLength(2);

    for (const s of sessions) expect(s.exerciseIds.length).toBeLessThanOrEqual(6);

    // Lower never contains a Push/Pull-only muscle (chest/back/shoulders/arms).
    for (const s of lowerSessions) {
      expect(s.exerciseIds.every((id) => ["legs", "core"].includes(byId(id).primaryMuscleGroup))).toBe(true);
    }
    // Upper never contains legs.
    for (const s of upperSessions) {
      expect(s.exerciseIds.some((id) => byId(id).primaryMuscleGroup === "legs")).toBe(false);
    }
  });

  it("4 days/week: the two Upper sessions don't just duplicate each other when more exercises are available", () => {
    const sessions = buildWeeklySplit(FULL_CATALOG, 4);
    const [a1, a2] = sessions.filter((s) => s.label.startsWith("Upper"));
    // With 8 candidate Upper exercises (chest1+back3+shoulders2+arms2) and a 6-cap on A1, A2
    // picks up at least one exercise A1 couldn't fit.
    const onlyInA2 = a2.exerciseIds.filter((id) => !a1.exerciseIds.includes(id));
    expect(onlyInA2.length).toBeGreaterThan(0);
  });

  it("5 days/week: one muscle group (or a paired group) per day, chest/shoulders never adjacent", () => {
    const sessions = buildWeeklySplit(FULL_CATALOG, 5);
    expect(sessions).toHaveLength(5);

    const chestDay = sessions.find((s) => s.exerciseIds.includes("supino"))!.dayOfWeek;
    const shouldersDay = sessions.find((s) => s.exerciseIds.includes("desenvolvimento"))!.dayOfWeek;
    expect(shouldersDay - chestDay).not.toBe(1);

    const legsDay = sessions.find((s) => s.exerciseIds.includes("agachamento"))!;
    const backDay = sessions.find((s) => s.exerciseIds.includes("terra"))!;
    expect(legsDay.dayOfWeek).not.toBe(backDay.dayOfWeek); // squat and deadlift never share a day

    for (const s of sessions) expect(s.exerciseIds.length).toBeLessThanOrEqual(6);
  });

  it("never exceeds the 6-exercise session cap even with a much larger catalog", () => {
    const bigCatalog: SplitExerciseInput[] = Array.from({ length: 20 }, (_, i) => ({
      id: `chest-${i}`,
      name: `Exercício de peito ${i}`,
      primaryMuscleGroup: "chest",
      exerciseType: i % 2 === 0 ? "compound" : "isolation",
    }));
    const sessions = buildWeeklySplit(bigCatalog, 3);
    for (const s of sessions) expect(s.exerciseIds.length).toBeLessThanOrEqual(6);
  });

  it("a thin catalog (one exercise per muscle group) still produces a valid, non-crashing split", () => {
    const thin: SplitExerciseInput[] = [
      { id: "c", name: "Supino reto", primaryMuscleGroup: "chest", exerciseType: "compound" },
      { id: "l", name: "Agachamento livre", primaryMuscleGroup: "legs", exerciseType: "compound" },
    ];
    const sessions = buildWeeklySplit(thin, 3);
    expect(sessions).toHaveLength(3);
    const legs = sessions.find((s) => s.label.startsWith("Legs"))!;
    expect(legs.exerciseIds).toEqual(["l"]);
  });
});

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
