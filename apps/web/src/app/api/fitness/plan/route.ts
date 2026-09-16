import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";

const querySchema = z.object({ householdId: z.string().uuid(), profileId: z.string().uuid() });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId"), profileId: url.searchParams.get("profileId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const { profileId } = parsed.data;

    const result = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const planRes = await client.query(
        `SELECT id, status, week_start_date, version FROM workout_plans
         WHERE person_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [profileId]
      );
      const plan = planRes.rows[0] ?? null;

      const items = plan
        ? await client.query(
            `SELECT wpi.id, wpi.day_of_week, wpi.order_index, wpi.target_sets, wpi.min_reps, wpi.max_reps, wpi.target_rpe, wpi.target_load_kg,
                    e.id AS exercise_id, e.name AS exercise_name, e.primary_muscle_group, e.exercise_type
             FROM workout_plan_items wpi JOIN exercises e ON e.id = wpi.exercise_id
             WHERE wpi.workout_plan_id = $1 ORDER BY wpi.day_of_week, wpi.order_index`,
            [plan.id]
          )
        : { rows: [] as Record<string, unknown>[] };

      const activeSessionRes = await client.query(
        `SELECT id, performed_at, status FROM workout_sessions
         WHERE person_id = $1 AND status = 'in_progress' ORDER BY performed_at DESC LIMIT 1`,
        [profileId]
      );
      const activeSession = activeSessionRes.rows[0] ?? null;

      const loggedSets = activeSession
        ? await client.query(
            `SELECT id, exercise_id, set_number, reps, load_kg, rpe, completed FROM workout_logs
             WHERE workout_session_id = $1 ORDER BY created_at`,
            [activeSession.id]
          )
        : { rows: [] as Record<string, unknown>[] };

      const recentSessions = await client.query(
        `SELECT id, performed_at, status, duration_minutes FROM workout_sessions
         WHERE person_id = $1 AND status IN ('completed', 'skipped') ORDER BY performed_at DESC LIMIT 5`,
        [profileId]
      );

      return {
        plan,
        items: items.rows,
        activeSession: activeSession ? { ...activeSession, sets: loggedSets.rows } : null,
        recentSessions: recentSessions.rows,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
