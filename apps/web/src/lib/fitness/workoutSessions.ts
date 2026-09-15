import type { Pool, PoolClient } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { validateWorkoutSet, type WorkoutLogEntry } from "@/lib/domain/fitness";
import { logAudit } from "@/lib/audit";

export async function startWorkoutSession(
  pool: Pool,
  params: { householdId: string; userId: string; personId: string; workoutPlanId?: string; performedAt: Date }
): Promise<string> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO workout_sessions (household_id, person_id, workout_plan_id, performed_at, status)
       VALUES ($1, $2, $3, $4, 'in_progress') RETURNING id`,
      [params.householdId, params.personId, params.workoutPlanId ?? null, params.performedAt]
    );
    return res.rows[0].id;
  });
}

export interface RecordSetInput {
  householdId: string;
  userId: string;
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  reps: number;
  loadKg: number;
  rpe?: number | null;
  completed?: boolean;
}

/**
 * `workout_log.create` is LOW RISK (evaluateRisk.ts) — executes and persists immediately, no
 * ActionEnvelope/approval needed (SECURITY_MODEL.md §5). Validates against the domain's
 * plausibility bounds BEFORE writing, same discipline as Fase 2's measurements.
 */
export async function recordWorkoutSet(pool: Pool, input: RecordSetInput): Promise<string> {
  validateWorkoutSet({ reps: input.reps, loadKg: input.loadKg, rpe: input.rpe });

  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO workout_logs (household_id, workout_session_id, exercise_id, set_number, reps, load_kg, rpe, completed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.householdId,
        input.sessionId,
        input.exerciseId,
        input.setNumber,
        input.reps,
        input.loadKg,
        input.rpe ?? null,
        input.completed ?? true,
      ]
    );
    await logAudit(client, {
      householdId: input.householdId,
      actorType: "user",
      actorId: input.userId,
      eventType: "workout_log.created",
      entityType: "workout_logs",
      entityId: res.rows[0].id,
    });
    return res.rows[0].id;
  });
}

export async function completeWorkoutSession(
  pool: Pool,
  params: { householdId: string; userId: string; sessionId: string; durationMinutes?: number; notes?: string }
): Promise<void> {
  await withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    await client.query(
      `UPDATE workout_sessions SET status = 'completed', duration_minutes = $2, notes = $3 WHERE id = $1`,
      [params.sessionId, params.durationMinutes ?? null, params.notes ?? null]
    );
    await logAudit(client, {
      householdId: params.householdId,
      actorType: "user",
      actorId: params.userId,
      eventType: "workout_session.completed",
      entityType: "workout_sessions",
      entityId: params.sessionId,
    });
  });
}

/** Full history for one person+exercise, oldest to newest as workout_logs rows — the ONLY
 * input progressionEngine ever needs (DATA_MODEL_REVIEW.md §2.4: reconstructible from scratch). */
export async function getExerciseHistory(
  client: PoolClient,
  params: { personId: string; exerciseId: string; limit?: number }
): Promise<WorkoutLogEntry[]> {
  const res = await client.query<{
    session_id: string;
    performed_at: Date;
    set_number: number;
    reps: number;
    load_kg: string;
    rpe: string | null;
    completed: boolean;
  }>(
    `SELECT wl.workout_session_id AS session_id, ws.performed_at, wl.set_number, wl.reps, wl.load_kg, wl.rpe, wl.completed
     FROM workout_logs wl
     JOIN workout_sessions ws ON ws.id = wl.workout_session_id
     WHERE ws.person_id = $1 AND wl.exercise_id = $2
     ORDER BY ws.performed_at DESC
     LIMIT $3`,
    [params.personId, params.exerciseId, (params.limit ?? 10) * 10] // generous: several sets per session
  );
  return res.rows.map((r) => ({
    sessionId: r.session_id,
    performedAt: r.performed_at,
    setNumber: r.set_number,
    reps: r.reps,
    loadKg: Number(r.load_kg),
    rpe: r.rpe === null ? null : Number(r.rpe),
    completed: r.completed,
  }));
}
