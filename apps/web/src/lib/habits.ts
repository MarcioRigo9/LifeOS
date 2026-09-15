import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";

export async function createHabit(
  pool: Pool,
  params: { householdId: string; userId: string; personId?: string; title: string; frequency?: string }
): Promise<string> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO habits (household_id, person_id, title, frequency) VALUES ($1, $2, $3, $4) RETURNING id`,
      [params.householdId, params.personId ?? null, params.title, params.frequency ?? null]
    );
    return res.rows[0].id;
  });
}

/** habit_logs is append-only (0018_weekly_review.sql: unique per habit+day, no UPDATE/DELETE
 * grant) — a correction is a new day's row, never editing a past one. */
export async function logHabitCompletion(
  pool: Pool,
  params: { householdId: string; userId: string; habitId: string; personId?: string; loggedDate: Date; completed: boolean }
): Promise<string> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO habit_logs (household_id, habit_id, person_id, logged_date, completed)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [params.householdId, params.habitId, params.personId ?? null, params.loggedDate, params.completed]
    );
    return res.rows[0].id;
  });
}
