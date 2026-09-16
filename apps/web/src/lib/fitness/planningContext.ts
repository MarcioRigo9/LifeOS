import type { PoolClient } from "pg";
import type { FitnessGoal, TrainingDaysPerWeek } from "@/lib/domain/fitness";
import { getLatestMeasurement } from "@/lib/health/measurements";
import type { WorkoutPlanPerson } from "./workoutPlans";

export interface MissingFitnessPlanningData {
  personId: string;
  displayName: string;
  missing: string[];
}

export interface GatherFitnessPlanningContextResult {
  ready: WorkoutPlanPerson[];
  incomplete: MissingFitnessPlanningData[];
}

/**
 * Reuses `profiles.nutrition_goal` (Fase 3) as the fitness goal too — the same
 * lose_weight/maintain/gain_muscle intent drives both individualized calorie targets and
 * individualized training rep ranges/loads, rather than duplicating a second goal column.
 */
export async function gatherWeeklyWorkoutPlanningContext(
  client: PoolClient,
  householdId: string
): Promise<GatherFitnessPlanningContextResult> {
  const res = await client.query<{
    id: string;
    display_name: string;
    nutrition_goal: FitnessGoal | null;
    training_days_per_week: TrainingDaysPerWeek | null;
  }>("SELECT id, display_name, nutrition_goal, training_days_per_week FROM profiles WHERE household_id = $1", [householdId]);

  const ready: WorkoutPlanPerson[] = [];
  const incomplete: MissingFitnessPlanningData[] = [];

  for (const row of res.rows) {
    const missing: string[] = [];
    if (!row.nutrition_goal) missing.push("nutrition_goal");

    const latest = await getLatestMeasurement(client, row.id);
    if (!latest) missing.push("measurement (peso)");

    if (missing.length > 0) {
      incomplete.push({ personId: row.id, displayName: row.display_name, missing });
      continue;
    }

    ready.push({
      personId: row.id,
      bodyweightKg: latest!.weightKg,
      goal: row.nutrition_goal!,
      trainingDaysPerWeek: row.training_days_per_week ?? undefined, // WorkoutPlanPerson defaults to 3 (workoutPlans.ts)
    });
  }

  return { ready, incomplete };
}
