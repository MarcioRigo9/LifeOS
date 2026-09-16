import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { logAudit } from "@/lib/audit";

export interface DietaryPreferencesRecord {
  id: string;
  personId: string;
  dislikedFoods: string[];
  reheatIntolerantFoods: string[];
  prepSchedule: Record<string, string>;
  notes: string | null;
  updatedAt: string;
}

function mapRow(r: {
  id: string;
  person_id: string;
  disliked_foods: string[];
  reheat_intolerant_foods: string[];
  prep_schedule: Record<string, string>;
  notes: string | null;
  updated_at: string;
}): DietaryPreferencesRecord {
  return {
    id: r.id,
    personId: r.person_id,
    dislikedFoods: r.disliked_foods,
    reheatIntolerantFoods: r.reheat_intolerant_foods,
    prepSchedule: r.prep_schedule,
    notes: r.notes,
    updatedAt: r.updated_at,
  };
}

export async function getDietaryPreferences(
  pool: Pool,
  ctx: { householdId: string; userId: string },
  personId: string
): Promise<DietaryPreferencesRecord | null> {
  return withHouseholdContext(pool, ctx, async (client) => {
    const res = await client.query(
      `SELECT id, person_id, disliked_foods, reheat_intolerant_foods, prep_schedule, notes, updated_at
       FROM dietary_preferences WHERE person_id = $1`,
      [personId]
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  });
}

/** All preferences in the household — one row per profile that has ever saved preferences (a
 * profile with none yet simply has no row here, not a row of empty defaults). Used by the
 * weekly plan assembler (mealPlans.ts) to fetch every relevant person's constraints in one call. */
export async function listHouseholdDietaryPreferences(
  pool: Pool,
  ctx: { householdId: string; userId: string }
): Promise<DietaryPreferencesRecord[]> {
  return withHouseholdContext(pool, ctx, async (client) => {
    const res = await client.query(
      `SELECT id, person_id, disliked_foods, reheat_intolerant_foods, prep_schedule, notes, updated_at
       FROM dietary_preferences WHERE household_id = $1`,
      [ctx.householdId]
    );
    return res.rows.map(mapRow);
  });
}

export interface UpsertDietaryPreferencesInput {
  personId: string;
  dislikedFoods: string[];
  reheatIntolerantFoods: string[];
  prepSchedule: Record<string, string>;
  notes?: string | null;
}

/** One row per person (UNIQUE(person_id) in 0025) — INSERT..ON CONFLICT keeps the onboarding
 * form and later edits both just "save the whole thing", no separate create/update UI paths. */
export async function upsertDietaryPreferences(
  pool: Pool,
  ctx: { householdId: string; userId: string },
  input: UpsertDietaryPreferencesInput
): Promise<DietaryPreferencesRecord> {
  return withHouseholdContext(pool, ctx, async (client) => {
    const res = await client.query(
      `INSERT INTO dietary_preferences (household_id, person_id, disliked_foods, reheat_intolerant_foods, prep_schedule, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (person_id) DO UPDATE SET
         disliked_foods = EXCLUDED.disliked_foods,
         reheat_intolerant_foods = EXCLUDED.reheat_intolerant_foods,
         prep_schedule = EXCLUDED.prep_schedule,
         notes = EXCLUDED.notes
       RETURNING id, person_id, disliked_foods, reheat_intolerant_foods, prep_schedule, notes, updated_at`,
      [ctx.householdId, input.personId, input.dislikedFoods, input.reheatIntolerantFoods, JSON.stringify(input.prepSchedule), input.notes ?? null]
    );

    await logAudit(client, {
      householdId: ctx.householdId,
      actorType: "user",
      actorId: ctx.userId,
      eventType: "dietary_preferences.updated",
      entityType: "dietary_preferences",
      entityId: res.rows[0].id,
    });

    return mapRow(res.rows[0]);
  });
}
