import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import type { RitualResult } from "./types";

/**
 * Daily Check-in ritual (Fase 6 §2.3, daily 08:00 household-local): a pure read-only summary —
 * whether each person has training planned today and how long since their last weigh-in. Writes
 * nothing (no plan, no measurement, no habit log), so unlike the other two rituals it needs no
 * idempotency guard at all: running it twice produces the same harmless summary text.
 */
export async function processDailyCheckinJob(
  pool: Pool,
  params: { householdId: string; userId: string }
): Promise<RitualResult> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const profiles = await client.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM profiles WHERE household_id = $1",
      [params.householdId]
    );

    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    // workout_plan_items.day_of_week: 0=Monday..6=Sunday. Date#getDay(): 0=Sunday..6=Saturday.
    const planDayOfWeek = (today.getDay() + 6) % 7;

    const lines: string[] = [];
    for (const profile of profiles.rows) {
      const latest = await client.query<{ taken_at: Date }>(
        "SELECT taken_at FROM measurements WHERE person_id = $1 ORDER BY taken_at DESC LIMIT 1",
        [profile.id]
      );
      const daysSinceWeighIn = latest.rows[0]
        ? Math.floor((today.getTime() - new Date(latest.rows[0].taken_at).getTime()) / (24 * 60 * 60 * 1000))
        : null;

      const plannedToday = await client.query<{ count: string }>(
        `SELECT count(*) FROM workout_plan_items wpi
         JOIN workout_plans wp ON wp.id = wpi.workout_plan_id
         WHERE wp.person_id = $1 AND wp.status = 'active' AND wpi.day_of_week = $2`,
        [profile.id, planDayOfWeek]
      );
      const hasTrainingToday = Number(plannedToday.rows[0].count) > 0;

      const weighInNote =
        daysSinceWeighIn === null
          ? "nenhuma pesagem registrada ainda"
          : daysSinceWeighIn > 7
            ? `${daysSinceWeighIn} dias sem pesagem`
            : `pesagem há ${daysSinceWeighIn} dia(s)`;
      lines.push(`${profile.display_name}: ${hasTrainingToday ? "treino previsto hoje" : "sem treino previsto hoje"}; ${weighInNote}`);
    }

    return {
      summary: `Check-in de ${todayIso}: ${lines.length > 0 ? lines.join(" | ") : "nenhum perfil no household"}`,
      data: { date: todayIso, people: lines },
    };
  });
}
