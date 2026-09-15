import type { Pool, PoolClient } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import {
  suggestStartingLoadKg,
  getContraindicatedBodyRegions,
  REP_RANGE_BY_GOAL,
  type FitnessGoal,
  type ExerciseType,
} from "@/lib/domain/fitness";
import { createDecisionProposal, type CreateProposalResult } from "@/lib/agents/decisions";
import { logAudit } from "@/lib/audit";

// Full-body, 3x/week — deterministic day assignment (Monday/Wednesday/Friday), same rotation
// logic style as Fase 3's meal plan assembler.
const TRAINING_DAYS = [0, 2, 4]; // 0=Monday

export interface WorkoutPlanPerson {
  personId: string;
  bodyweightKg: number;
  goal: FitnessGoal;
}

interface ExerciseRow {
  id: string;
  exerciseType: ExerciseType;
  bodyRegion: string;
}

async function fetchExercisePool(client: PoolClient): Promise<ExerciseRow[]> {
  const res = await client.query<{ id: string; exercise_type: ExerciseType; body_region: string }>(
    "SELECT id, exercise_type, body_region FROM exercises ORDER BY name"
  );
  return res.rows.map((r) => ({ id: r.id, exerciseType: r.exercise_type, bodyRegion: r.body_region }));
}

async function fetchActiveHealthHistory(client: PoolClient, personId: string) {
  const res = await client.query<{ category: string; title: string; details: string; active: boolean }>(
    "SELECT category, title, details, active FROM health_history WHERE person_id = $1 AND active = true",
    [personId]
  );
  return res.rows;
}

export interface GeneratedWorkoutPlan {
  personId: string;
  workoutPlanId: string;
  itemCount: number;
  excludedBodyRegions: string[];
}

/**
 * Deterministic weekly assembler (packages/domain does every number — this function only
 * orchestrates): filters the exercise catalog against the person's ACTIVE health_history
 * contraindications, then sizes sets/reps/RPE from their goal and starting load from their own
 * bodyweight — two different people never get the same plan.
 */
export async function generateWeeklyWorkoutPlan(
  pool: Pool,
  params: { householdId: string; userId: string; weekStartDate: Date; people: WorkoutPlanPerson[] }
): Promise<GeneratedWorkoutPlan[]> {
  if (params.people.length === 0) throw new Error("at least one person is required");

  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const pool_ = await fetchExercisePool(client);
    const results: GeneratedWorkoutPlan[] = [];

    for (const person of params.people) {
      const healthHistory = await fetchActiveHealthHistory(client, person.personId);
      const excludedBodyRegions = getContraindicatedBodyRegions(healthHistory);
      const safeExercises = pool_.filter((e) => !excludedBodyRegions.includes(e.bodyRegion));
      if (safeExercises.length === 0) {
        throw new Error(`no safe exercises available for person ${person.personId} after contraindication filtering`);
      }

      const planRes = await client.query<{ id: string }>(
        `INSERT INTO workout_plans (household_id, person_id, week_start_date, status) VALUES ($1, $2, $3, 'draft') RETURNING id`,
        [params.householdId, person.personId, params.weekStartDate]
      );
      const workoutPlanId = planRes.rows[0].id;
      const repRange = REP_RANGE_BY_GOAL[person.goal];

      let itemCount = 0;
      for (const day of TRAINING_DAYS) {
        for (let i = 0; i < safeExercises.length; i++) {
          const exercise = safeExercises[i];
          const targetLoadKg = suggestStartingLoadKg(exercise.exerciseType, person.bodyweightKg);
          await client.query(
            `INSERT INTO workout_plan_items
               (household_id, workout_plan_id, exercise_id, day_of_week, order_index, target_sets, min_reps, max_reps, target_rpe, target_load_kg)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              params.householdId,
              workoutPlanId,
              exercise.id,
              day,
              i,
              repRange.targetSets,
              repRange.minReps,
              repRange.maxReps,
              repRange.targetRpe,
              targetLoadKg,
            ]
          );
          itemCount++;
        }
      }

      await logAudit(client, {
        householdId: params.householdId,
        actorType: "user",
        actorId: params.userId,
        eventType: "workout_plan.generated",
        entityType: "workout_plans",
        entityId: workoutPlanId,
        reason: excludedBodyRegions.length > 0 ? `excluded body regions: ${excludedBodyRegions.join(", ")}` : undefined,
      });

      results.push({ personId: person.personId, workoutPlanId, itemCount, excludedBodyRegions });
    }

    return results;
  });
}

/** Human-in-the-loop gate (SECURITY_MODEL.md §5-6): activating a workout_plan is always MEDIUM
 * risk — never applied directly (same pattern as Fase 3's meal_plan.activate). */
export async function proposeWorkoutPlanActivation(
  pool: Pool,
  params: { householdId: string; userId: string; workoutPlanId: string }
): Promise<CreateProposalResult> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const res = await client.query<{ id: string; version: number }>(
      "SELECT id, version FROM workout_plans WHERE id = $1",
      [params.workoutPlanId]
    );
    if (res.rowCount === 0) throw new Error("workout plan not found");
    const plan = res.rows[0];

    return createDecisionProposal(client, {
      householdId: params.householdId,
      agentKey: "fitness",
      envelope: {
        actionType: "workout_plan.activate",
        actionPayload: { newStatus: "active" },
        targetEntityIds: [plan.id],
        expectedVersions: { [`workout_plan:${plan.id}`]: plan.version },
        scope: { householdId: params.householdId, entityCount: 1, reversible: true, financialImpactCents: 0 },
      },
    });
  });
}
