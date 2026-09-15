import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export async function createMeal(
  pool: Pool,
  params: { householdId: string; userId: string; recipeId: string; name: string; type: MealType }
): Promise<string> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO meals (household_id, recipe_id, name, type) VALUES ($1, $2, $3, $4) RETURNING id`,
      [params.householdId, params.recipeId, params.name, params.type]
    );
    return res.rows[0].id;
  });
}

export interface MealRow {
  id: string;
  recipeId: string;
  name: string;
  type: MealType;
}

export async function listMealsByType(
  pool: Pool,
  params: { householdId: string; userId: string; type: MealType }
): Promise<MealRow[]> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const res = await client.query(`SELECT id, recipe_id, name, type FROM meals WHERE type = $1 ORDER BY created_at`, [
      params.type,
    ]);
    return res.rows.map((r) => ({ id: r.id, recipeId: r.recipe_id, name: r.name, type: r.type }));
  });
}
