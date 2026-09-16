import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";

const querySchema = z.object({ householdId: z.string().uuid(), profileId: z.string().uuid() });

/**
 * One aggregated read for the daily dashboard (Fase Frontend §2.1) — read-only joins across
 * already-tested tables, no new business logic. planDayOfWeek follows the same 0=Monday..6=Sunday
 * convention already used by workout_plan_items/meal_plan_items (see
 * scheduler/rituals/dailyCheckin.ts for the identical conversion).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId"), profileId: url.searchParams.get("profileId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const { profileId } = parsed.data;
    const today = new Date();
    const planDayOfWeek = (today.getDay() + 6) % 7;
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const result = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const workoutPlan = await client.query<{ id: string }>(
        "SELECT id FROM workout_plans WHERE person_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
        [profileId]
      );
      const workoutItems = workoutPlan.rowCount
        ? await client.query(
            `SELECT wpi.id, wpi.order_index, wpi.target_sets, wpi.min_reps, wpi.max_reps, wpi.target_rpe, wpi.target_load_kg,
                    e.id AS exercise_id, e.name AS exercise_name, e.primary_muscle_group
             FROM workout_plan_items wpi JOIN exercises e ON e.id = wpi.exercise_id
             WHERE wpi.workout_plan_id = $1 AND wpi.day_of_week = $2 ORDER BY wpi.order_index`,
            [workoutPlan.rows[0].id, planDayOfWeek]
          )
        : { rows: [] as Record<string, unknown>[] };

      const activeSession = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM workout_sessions
         WHERE person_id = $1 AND performed_at >= $2 AND performed_at < $3
         ORDER BY performed_at DESC LIMIT 1`,
        [profileId, todayStart, todayEnd]
      );

      const mealPlan = await client.query<{ id: string; week_start_date: string }>(
        "SELECT id, week_start_date FROM meal_plans WHERE household_id = $1 ORDER BY week_start_date DESC LIMIT 1",
        [householdId]
      );
      const mealItems = mealPlan.rowCount
        ? await client.query(
            `SELECT mpi.id, mpi.planned_cooked_grams, m.type, m.name AS meal_name, r.name AS recipe_name
             FROM meal_plan_items mpi JOIN meals m ON m.id = mpi.meal_id JOIN recipes r ON r.id = m.recipe_id
             WHERE mpi.meal_plan_id = $1 AND mpi.person_id = $2 AND mpi.day_of_week = $3
             ORDER BY CASE m.type WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END`,
            [mealPlan.rows[0].id, profileId, planDayOfWeek]
          )
        : { rows: [] as Record<string, unknown>[] };

      const habits = await client.query(
        `SELECT h.id, h.title, h.frequency, hl.completed AS logged_completed
         FROM habits h
         LEFT JOIN habit_logs hl ON hl.habit_id = h.id AND hl.logged_date = current_date
         WHERE h.household_id = $1 AND (h.person_id = $2 OR h.person_id IS NULL)
         ORDER BY h.created_at`,
        [householdId, profileId]
      );

      const pendingDecisions = await client.query(
        `SELECT d.id, d.risk_level, d.proposal_hash, d.expires_at, d.created_at, d.action_envelope_json, a.key AS agent_key, a.display_name AS agent_name
         FROM agent_decisions d JOIN agents a ON a.id = d.agent_id
         WHERE d.household_id = $1 AND d.status = 'PENDING' ORDER BY d.created_at DESC`,
        [householdId]
      );

      const latestMeasurement = await client.query<{ weight_kg: string; taken_at: string }>(
        "SELECT weight_kg, taken_at FROM measurements WHERE person_id = $1 ORDER BY taken_at DESC LIMIT 1",
        [profileId]
      );

      return {
        planDayOfWeek,
        workout: {
          planId: workoutPlan.rows[0]?.id ?? null,
          items: workoutItems.rows,
          activeSession: activeSession.rows[0] ?? null,
        },
        nutrition: {
          mealPlanId: mealPlan.rows[0]?.id ?? null,
          weekStartDate: mealPlan.rows[0]?.week_start_date ?? null,
          items: mealItems.rows,
        },
        habits: habits.rows.map((h) => ({
          id: h.id,
          title: h.title,
          frequency: h.frequency,
          doneToday: h.logged_completed === true,
          loggedToday: h.logged_completed !== null,
        })),
        pendingDecisions: pendingDecisions.rows.map((d) => ({
          id: d.id,
          riskLevel: d.risk_level,
          proposalHash: d.proposal_hash,
          expiresAt: d.expires_at,
          createdAt: d.created_at,
          agentKey: d.agent_key,
          agentName: d.agent_name,
          actionEnvelope: d.action_envelope_json,
        })),
        latestMeasurement: latestMeasurement.rows[0]
          ? { weightKg: Number(latestMeasurement.rows[0].weight_kg), takenAt: latestMeasurement.rows[0].taken_at }
          : null,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
