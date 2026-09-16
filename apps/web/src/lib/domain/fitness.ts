// Deterministic, pure, unit-tested functions — the LLM never computes a load/rep increment
// (IMPLEMENTATION_RULES.md #8, DECISIONS.md D005, ARCHITECTURE.md §1 principle 2).

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export class ImplausibleWorkoutValueError extends Error {
  constructor(public field: string, public value: number) {
    super(`${field} value ${value} is outside the plausible range`);
  }
}

export function validateWorkoutSet(input: { reps: number; loadKg: number; rpe?: number | null }): void {
  if (!Number.isInteger(input.reps) || input.reps <= 0) {
    throw new ImplausibleWorkoutValueError("reps", input.reps);
  }
  if (input.loadKg <= 0 || input.loadKg > 500) {
    throw new ImplausibleWorkoutValueError("loadKg", input.loadKg);
  }
  if (input.rpe !== undefined && input.rpe !== null && (input.rpe < 1.0 || input.rpe > 10.0)) {
    throw new ImplausibleWorkoutValueError("rpe", input.rpe);
  }
}

// ---------------------------------------------------------------------------------------------
// Progression engine
// ---------------------------------------------------------------------------------------------

export type ExerciseType = "compound" | "isolation";

export interface WorkoutLogEntry {
  sessionId: string;
  performedAt: Date;
  setNumber: number;
  reps: number;
  loadKg: number;
  rpe: number | null;
  completed: boolean;
}

export interface ExerciseTarget {
  exerciseType: ExerciseType;
  targetSets: number;
  minReps: number;
  maxReps: number;
  targetRpe: number;
}

export type ProgressionAction = "increase_load" | "maintain" | "deload";

export interface ProgressionRecommendation {
  action: ProgressionAction;
  lastLoadKg: number;
  recommendedLoadKg: number;
  reason: string;
}

// Fixed, documented increments — a deterministic point within the "2-5kg compostos, 1-2kg
// isolados" range the task specifies, never a range the LLM has to pick from itself.
const LOAD_INCREMENT_KG: Record<ExerciseType, number> = { compound: 2.5, isolation: 1.5 };
const DELOAD_RPE_THRESHOLD = 9.5;
const DELOAD_REDUCTION_FACTOR = 0.9; // -10%
const RECURRING_FAILURE_LOOKBACK_SESSIONS = 3;
const RECURRING_FAILURE_MIN_INCOMPLETE_SESSIONS = 2;

interface SessionGroup {
  sessionId: string;
  performedAt: Date;
  sets: WorkoutLogEntry[];
}

function groupBySession(history: WorkoutLogEntry[]): SessionGroup[] {
  const bySession = new Map<string, SessionGroup>();
  for (const entry of history) {
    let group = bySession.get(entry.sessionId);
    if (!group) {
      group = { sessionId: entry.sessionId, performedAt: entry.performedAt, sets: [] };
      bySession.set(entry.sessionId, group);
    }
    group.sets.push(entry);
  }
  return Array.from(bySession.values()).sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime());
}

/**
 * Pure function of `history` alone — no hidden state, no cache read (DATA_MODEL_REVIEW.md §2.4,
 * D017: progression is never an independent source of truth, always reconstructible from
 * workout_logs from scratch). Priority order: deload safety checks first, then progression,
 * then maintain as the default.
 */
export function progressionEngine(history: WorkoutLogEntry[], targets: ExerciseTarget): ProgressionRecommendation {
  const sessions = groupBySession(history);
  if (sessions.length === 0) {
    throw new Error("progressionEngine requires at least one past session");
  }

  const latest = sessions[0];
  const lastLoadKg = latest.sets[0].loadKg;
  const increment = LOAD_INCREMENT_KG[targets.exerciseType];

  // 1) Safety first: RPE too high in the most recent session -> deload, regardless of reps hit.
  const anyExcessiveRpe = latest.sets.some((s) => s.rpe !== null && s.rpe > DELOAD_RPE_THRESHOLD);
  if (anyExcessiveRpe) {
    return {
      action: "deload",
      lastLoadKg,
      recommendedLoadKg: round1(lastLoadKg * DELOAD_REDUCTION_FACTOR),
      reason: `RPE acima de ${DELOAD_RPE_THRESHOLD} na última sessão`,
    };
  }

  // 2) Recurring failure: incomplete sets in >= 2 of the last 3 sessions -> deload.
  const recentSessions = sessions.slice(0, RECURRING_FAILURE_LOOKBACK_SESSIONS);
  const incompleteSessionCount = recentSessions.filter((s) => s.sets.some((set) => !set.completed)).length;
  if (incompleteSessionCount >= RECURRING_FAILURE_MIN_INCOMPLETE_SESSIONS) {
    return {
      action: "deload",
      lastLoadKg,
      recommendedLoadKg: round1(lastLoadKg * DELOAD_REDUCTION_FACTOR),
      reason: `falha recorrente: ${incompleteSessionCount} das últimas ${recentSessions.length} sessões com série incompleta`,
    };
  }

  // 3) Progression: every set in the most recent session hit the TOP of the rep range, at or
  // under the target RPE (felt at least as easy as planned), and every set was completed.
  const hitTopOfRange = latest.sets.every((s) => s.completed && s.reps >= targets.maxReps && (s.rpe === null || s.rpe <= targets.targetRpe));
  if (hitTopOfRange && latest.sets.length >= targets.targetSets) {
    return {
      action: "increase_load",
      lastLoadKg,
      recommendedLoadKg: round1(lastLoadKg + increment),
      reason: `todas as ${latest.sets.length} séries atingiram ${targets.maxReps}+ reps em RPE <= ${targets.targetRpe}`,
    };
  }

  // 4) Default: maintain the current load, try again.
  return {
    action: "maintain",
    lastLoadKg,
    recommendedLoadKg: lastLoadKg,
    reason: "meta de repetições/RPE ainda não atingida em todas as séries",
  };
}

// ---------------------------------------------------------------------------------------------
// Volume calculator
// ---------------------------------------------------------------------------------------------

export interface VolumeLogEntry {
  exerciseId: string;
  reps: number;
  loadKg: number;
  completed: boolean;
}

export interface ExerciseMuscleInfo {
  primaryMuscleGroup: string;
}

export interface VolumeResult {
  totalTonnageKg: number;
  effectiveSetsByMuscleGroup: Record<string, number>;
  tonnageByMuscleGroup: Record<string, number>;
}

/** Tonnage (reps x load, completed sets only) and effective-set count per primary muscle group
 * — the two standard volume metrics for weekly training load review. */
export function volumeCalculator(logs: VolumeLogEntry[], exerciseMap: Record<string, ExerciseMuscleInfo>): VolumeResult {
  let totalTonnageKg = 0;
  const effectiveSetsByMuscleGroup: Record<string, number> = {};
  const tonnageByMuscleGroup: Record<string, number> = {};

  for (const log of logs) {
    if (!log.completed) continue;
    const muscleGroup = exerciseMap[log.exerciseId]?.primaryMuscleGroup ?? "unknown";
    const tonnage = round1(log.reps * log.loadKg);
    totalTonnageKg = round1(totalTonnageKg + tonnage);
    tonnageByMuscleGroup[muscleGroup] = round1((tonnageByMuscleGroup[muscleGroup] ?? 0) + tonnage);
    effectiveSetsByMuscleGroup[muscleGroup] = (effectiveSetsByMuscleGroup[muscleGroup] ?? 0) + 1;
  }

  return { totalTonnageKg, effectiveSetsByMuscleGroup, tonnageByMuscleGroup };
}

// ---------------------------------------------------------------------------------------------
// Starting load and rep ranges by goal (individualization)
// ---------------------------------------------------------------------------------------------

export type FitnessGoal = "lose_weight" | "maintain" | "gain_muscle";

export interface RepRangeByGoal {
  minReps: number;
  maxReps: number;
  targetRpe: number;
  targetSets: number;
}

export const REP_RANGE_BY_GOAL: Record<FitnessGoal, RepRangeByGoal> = {
  gain_muscle: { minReps: 6, maxReps: 10, targetRpe: 8, targetSets: 4 },
  maintain: { minReps: 10, maxReps: 15, targetRpe: 7, targetSets: 3 },
  lose_weight: { minReps: 12, maxReps: 15, targetRpe: 7, targetSets: 3 },
};

// Conservative, documented starting-load heuristic (percentage of bodyweight) — a starting
// point for a new plan, not a claim of exact 1RM. Always individualized: two different
// bodyweights always produce two different numbers for the same exercise.
export function suggestStartingLoadKg(exerciseType: ExerciseType, bodyweightKg: number): number {
  if (bodyweightKg <= 0) throw new Error("bodyweightKg must be > 0");
  const fraction = exerciseType === "compound" ? 0.4 : 0.1;
  const raw = bodyweightKg * fraction;
  const increment = exerciseType === "compound" ? 2.5 : 1;
  return Math.round(raw / increment) * increment;
}

// ---------------------------------------------------------------------------------------------
// Health-history contraindication filtering
// ---------------------------------------------------------------------------------------------

const BODY_REGION_KEYWORDS: Record<string, RegExp[]> = {
  shoulders: [/ombro/i],
  knees: [/joelho/i],
  lower_back: [/lombar/i, /coluna/i],
  elbows: [/cotovelo/i],
  hips: [/quadril/i],
  wrists: [/punho/i],
  ankles: [/tornozelo/i],
};

export interface HealthHistoryForContraindication {
  category: string;
  title: string;
  details: string;
  active: boolean;
}

/**
 * Deterministic keyword match against ACTIVE injury/chronic_condition entries (same pattern as
 * healthSafety.ts's classifier) — never an LLM judgment call about what's safe
 * (SECURITY_MODEL.md §13: wellness-tier exclusion, not a medical decision).
 */
export function getContraindicatedBodyRegions(healthHistory: HealthHistoryForContraindication[]): string[] {
  const regions = new Set<string>();
  for (const entry of healthHistory) {
    if (!entry.active) continue;
    if (entry.category !== "injury" && entry.category !== "chronic_condition") continue;
    const text = `${entry.title} ${entry.details}`;
    for (const [region, patterns] of Object.entries(BODY_REGION_KEYWORDS)) {
      if (patterns.some((p) => p.test(text))) regions.add(region);
    }
  }
  return Array.from(regions);
}

// ---------------------------------------------------------------------------------------------
// Weekly split builder — coherent muscle-group sessions instead of every exercise on every day
// ---------------------------------------------------------------------------------------------

export type TrainingDaysPerWeek = 3 | 4 | 5;

export interface SplitExerciseInput {
  id: string;
  name: string;
  primaryMuscleGroup: string; // chest | back | shoulders | legs | core | arms (catalog values)
  exerciseType: ExerciseType;
}

export interface WeeklySplitSession {
  dayOfWeek: number; // 0=Monday..6=Sunday — days not returned here are rest days
  label: string;
  exerciseIds: string[]; // ordered: compounds before isolations
}

const MAX_EXERCISES_PER_SESSION = 6;

// "arms" in the catalog covers both biceps and triceps (no finer primary_muscle_group tag) — a
// Push/Pull split needs them on DIFFERENT days, so this is the one place a name-keyword heuristic
// is needed (same pattern as BODY_REGION_KEYWORDS above: deterministic, not an LLM guess).
const TRICEPS_NAME_PATTERN = /tr[ií]ceps/i;
const BICEPS_NAME_PATTERN = /b[ií]ceps|rosca/i;

function sortCompoundFirst<T extends { exerciseType: ExerciseType }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.exerciseType === b.exerciseType) return 0;
    return a.exerciseType === "compound" ? -1 : 1;
  });
}

function groupByMuscle(pool: SplitExerciseInput[]): Map<string, SplitExerciseInput[]> {
  const byMuscle = new Map<string, SplitExerciseInput[]>();
  for (const ex of pool) {
    const list = byMuscle.get(ex.primaryMuscleGroup) ?? [];
    list.push(ex);
    byMuscle.set(ex.primaryMuscleGroup, list);
  }
  for (const [key, list] of byMuscle) byMuscle.set(key, sortCompoundFirst(list));
  return byMuscle;
}

/** Splits the catalog's "arms" bucket into a triceps-leaning lane and a biceps-leaning lane —
 * only needed for the Push/Pull split, where the two must land on different days. An exercise
 * whose name matches neither pattern (future catalog additions) falls back to the triceps lane,
 * a fixed, deterministic tie-break rather than a coin flip. */
function splitArmsForPushPull(arms: SplitExerciseInput[]): { triceps: SplitExerciseInput[]; biceps: SplitExerciseInput[] } {
  const triceps: SplitExerciseInput[] = [];
  const biceps: SplitExerciseInput[] = [];
  for (const ex of arms) {
    if (BICEPS_NAME_PATTERN.test(ex.name) && !TRICEPS_NAME_PATTERN.test(ex.name)) biceps.push(ex);
    else triceps.push(ex);
  }
  return { triceps, biceps };
}

/** Round-robins across muscle-group "lanes" (one exercise per lane per round) so a session
 * always covers every assigned muscle group at least once before doubling up on any of them —
 * lanes are pre-sorted compound-first, so round 0 naturally picks the compound lift per group
 * (satisfying "1-2 compostos principais" without a rigid separate cap that would starve a group
 * whose only exercise happens to be its 2nd pick). Hard-capped at MAX_EXERCISES_PER_SESSION.
 */
function selectSession(lanes: SplitExerciseInput[][], usedIds?: Set<string>): SplitExerciseInput[] {
  const filteredLanes = usedIds ? lanes.map((lane) => lane.filter((e) => !usedIds.has(e.id))) : lanes;
  const hasAnyCandidate = filteredLanes.some((l) => l.length > 0);
  const effectiveLanes = hasAnyCandidate ? filteredLanes : lanes; // pool exhausted -> allow repeats rather than an empty session

  const selected: SplitExerciseInput[] = [];
  let round = 0;
  while (selected.length < MAX_EXERCISES_PER_SESSION) {
    let addedThisRound = false;
    for (const lane of effectiveLanes) {
      if (selected.length >= MAX_EXERCISES_PER_SESSION) break;
      const candidate = lane[round];
      if (candidate) {
        selected.push(candidate);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
    round++;
  }

  return sortCompoundFirst(selected);
}

/**
 * Builds a coherent weekly split from a (already contraindication-filtered) exercise pool —
 * Push/Pull/Legs for 3 days, Upper/Lower (repeated) for 4, a 5-day body-part split for 5. Days
 * not returned are rest days. Never mixes antagonistic groups (e.g. heavy squats with deadlifts/
 * rows) on the same session, and never exceeds MAX_EXERCISES_PER_SESSION (IMPLEMENTATION_RULES.md
 * — "4 a 6 exercícios por treino"). An empty muscle bucket (thin catalog, or everything in it
 * excluded by a health contraindication) simply yields a shorter session, never a crash — only
 * a totally empty POOL is the caller's problem (generateWeeklyWorkoutPlan already throws before
 * calling this, see workoutPlans.ts).
 */
export function buildWeeklySplit(pool: SplitExerciseInput[], daysPerWeek: TrainingDaysPerWeek): WeeklySplitSession[] {
  const byMuscle = groupByMuscle(pool);
  const lane = (muscle: string) => byMuscle.get(muscle) ?? [];

  if (daysPerWeek === 3) {
    const { triceps, biceps } = splitArmsForPushPull(lane("arms"));
    return [
      { dayOfWeek: 0, label: "Push (Peito, Ombros, Tríceps)", exerciseIds: selectSession([lane("chest"), lane("shoulders"), triceps]).map((e) => e.id) },
      { dayOfWeek: 2, label: "Pull (Costas, Bíceps, Abdômen)", exerciseIds: selectSession([lane("back"), biceps, lane("core")]).map((e) => e.id) },
      { dayOfWeek: 4, label: "Legs (Quadríceps, Posterior, Panturrilhas)", exerciseIds: selectSession([lane("legs")]).map((e) => e.id) },
    ];
  }

  if (daysPerWeek === 4) {
    const upperLanes = [lane("chest"), lane("back"), lane("shoulders"), lane("arms")];
    const lowerLanes = [lane("legs"), lane("core")];
    const usedIds = new Set<string>();

    const pick = (lanes: SplitExerciseInput[][]) => {
      const selected = selectSession(lanes, usedIds);
      selected.forEach((e) => usedIds.add(e.id));
      return selected;
    };

    const a1 = pick(upperLanes);
    const b1 = pick(lowerLanes);
    const a2 = pick(upperLanes);
    const b2 = pick(lowerLanes);

    // Day 2 (Wednesday) is deliberately a rest day between the two Upper/Lower pairs.
    return [
      { dayOfWeek: 0, label: "Upper A (Peito, Costas, Ombros, Braços)", exerciseIds: a1.map((e) => e.id) },
      { dayOfWeek: 1, label: "Lower A (Quadríceps, Posterior, Panturrilhas, Abdômen)", exerciseIds: b1.map((e) => e.id) },
      { dayOfWeek: 3, label: "Upper B (Peito, Costas, Ombros, Braços)", exerciseIds: a2.map((e) => e.id) },
      { dayOfWeek: 4, label: "Lower B (Quadríceps, Posterior, Panturrilhas, Abdômen)", exerciseIds: b2.map((e) => e.id) },
    ];
  }

  // 5 days/week — a classic body-part split, ordered so chest/triceps never lands immediately
  // before shoulders (Chest Mon -> Shoulders Thu, buffered by Back/Legs) and squats (Legs) are
  // never grouped with deadlifts/rows (Back) — both on the ticket's explicit "never" list.
  return [
    { dayOfWeek: 0, label: "Peito", exerciseIds: selectSession([lane("chest")]).map((e) => e.id) },
    { dayOfWeek: 1, label: "Costas", exerciseIds: selectSession([lane("back")]).map((e) => e.id) },
    { dayOfWeek: 2, label: "Pernas", exerciseIds: selectSession([lane("legs")]).map((e) => e.id) },
    { dayOfWeek: 3, label: "Ombros + Abdômen", exerciseIds: selectSession([lane("shoulders"), lane("core")]).map((e) => e.id) },
    { dayOfWeek: 4, label: "Braços", exerciseIds: selectSession([lane("arms")]).map((e) => e.id) },
  ];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
