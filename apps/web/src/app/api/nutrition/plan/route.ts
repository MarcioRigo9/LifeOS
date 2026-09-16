import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { getRecipeIngredients } from "@/lib/nutrition/recipes";
import { recipeYield } from "@/lib/domain/nutrition";

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
        // created_at DESC breaks ties deterministically when two plans share the same
        // week_start_date (e.g. "Gerar plano" called twice for the same upcoming week) — without
        // it, Postgres may return either row on a tie, non-deterministically.
        "SELECT id, status, week_start_date, version FROM meal_plans WHERE household_id = $1 ORDER BY week_start_date DESC, created_at DESC LIMIT 1",
        [householdId]
      );
      const plan = planRes.rows[0] ?? null;

      const items = plan
        ? await client.query(
            `SELECT mpi.id, mpi.day_of_week, mpi.planned_cooked_grams, m.id AS meal_id, m.type, m.name AS meal_name,
                    r.id AS recipe_id, r.name AS recipe_name
             FROM meal_plan_items mpi JOIN meals m ON m.id = mpi.meal_id JOIN recipes r ON r.id = m.recipe_id
             WHERE mpi.meal_plan_id = $1 AND mpi.person_id = $2
             ORDER BY mpi.day_of_week, CASE m.type WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END`,
            [plan.id, profileId]
          )
        : { rows: [] as Record<string, unknown>[] };

      const shoppingList = plan
        ? await client.query("SELECT id, status, total_cost_cents FROM shopping_lists WHERE meal_plan_id = $1 LIMIT 1", [plan.id])
        : { rows: [] as Record<string, unknown>[] };

      // Weight split (cru vs. cozido, §2.3): reuses the SAME recipeYield math the plan
      // generator itself uses (mealPlans.ts's aggregateNeededRawIngredients) — never a separate
      // estimate, so the raw-grams figure shown here always matches what the shopping list
      // was actually built from.
      const recipeCache = new Map<string, { totalRawGrams: number; totalCookedGrams: number }>();
      const itemsWithRawGrams = [];
      for (const row of items.rows as { id: string; recipe_id: string; planned_cooked_grams: string }[]) {
        let recipeTotals = recipeCache.get(row.recipe_id);
        if (!recipeTotals) {
          const ingredients = await getRecipeIngredients(client, row.recipe_id);
          const { totalCookedGrams } = recipeYield(
            ingredients.map((i, idx) => ({ foodId: String(idx), rawGrams: i.rawGrams, yieldFactor: i.yieldFactor }))
          );
          recipeTotals = { totalRawGrams: ingredients.reduce((sum, i) => sum + i.rawGrams, 0), totalCookedGrams };
          recipeCache.set(row.recipe_id, recipeTotals);
        }
        const scale = Number(row.planned_cooked_grams) / recipeTotals.totalCookedGrams;
        const rawGramsEquivalent = Math.round(recipeTotals.totalRawGrams * scale * 100) / 100;
        itemsWithRawGrams.push({ ...row, raw_grams_equivalent: rawGramsEquivalent });
      }

      return { plan, items: itemsWithRawGrams, shoppingList: shoppingList.rows[0] ?? null };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
