import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { logAudit } from "@/lib/audit";

const querySchema = z.object({ householdId: z.string().uuid(), search: z.string().optional() });

/** foods is a GLOBAL catalog (no household_id) — householdId here is only used to authenticate
 * the caller (requireHouseholdContext), same as every other route. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId"), search: url.searchParams.get("search") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const rows = await withHouseholdContext(getRuntimePool(), { userId, householdId }, (client) =>
      client.query(
        `SELECT f.id, f.name, f.category, f.calories_kcal_per_100g, f.protein_g_per_100g, f.carbs_g_per_100g, f.fat_g_per_100g,
                COALESCE(
                  json_agg(DISTINCT jsonb_build_object('method', cy.preparation_method, 'yieldFactor', cy.yield_factor))
                    FILTER (WHERE cy.preparation_method IS NOT NULL),
                  '[]'
                ) AS cooking_methods
         FROM foods f
         LEFT JOIN LATERAL (
           SELECT DISTINCT ON (preparation_method) preparation_method, yield_factor
           FROM cooking_yields WHERE food_id = f.id ORDER BY preparation_method, version DESC
         ) cy ON true
         WHERE ($1::text IS NULL OR f.name ILIKE '%' || $1 || '%')
         GROUP BY f.id ORDER BY f.name LIMIT 50`,
        [parsed.data.search ?? null]
      )
    );
    return NextResponse.json(rows.rows);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}

const postSchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().min(1),
  category: z.string().optional(),
  caloriesPer100g: z.number().nonnegative(),
  proteinPer100g: z.number().nonnegative(),
  carbsPer100g: z.number().nonnegative(),
  fatPer100g: z.number().nonnegative(),
  fiberPer100g: z.number().nonnegative().optional(),
  cookingYield: z
    .object({ method: z.string().min(1), rawWeightG: z.number().positive(), cookedWeightG: z.number().positive() })
    .optional(),
});

/**
 * Writes to the GLOBAL foods/cooking_yields catalog — a deliberate, narrow grant exception
 * (0023_nutrition_catalog_write_grants.sql) to the "read-only for the app" posture the Fase 3
 * grants originally set, confirmed with the user because it's a real security-model change, not
 * just a new route. The new food/yield is visible to the whole catalog (there's no household_id
 * column on these tables — same shared-reference-data posture as exercises).
 */
export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const result = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const foodRes = await client.query<{ id: string }>(
        `INSERT INTO foods (name, category, calories_kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, fiber_g_per_100g)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          parsed.data.name,
          parsed.data.category ?? null,
          parsed.data.caloriesPer100g,
          parsed.data.proteinPer100g,
          parsed.data.carbsPer100g,
          parsed.data.fatPer100g,
          parsed.data.fiberPer100g ?? null,
        ]
      );
      const foodId = foodRes.rows[0].id;

      let cookingYieldId: string | null = null;
      if (parsed.data.cookingYield) {
        const cy = parsed.data.cookingYield;
        const yieldRes = await client.query<{ id: string }>(
          `INSERT INTO cooking_yields (food_id, preparation_method, raw_weight_g, cooked_weight_g, source, version)
           VALUES ($1, $2, $3, $4, 'household_entry', 1) RETURNING id`,
          [foodId, cy.method, cy.rawWeightG, cy.cookedWeightG]
        );
        cookingYieldId = yieldRes.rows[0].id;
      }

      await logAudit(client, {
        householdId,
        actorType: "user",
        actorId: userId,
        eventType: "food.created",
        entityType: "foods",
        entityId: foodId,
        reason: "custom food added by household via /nutrition/recipes",
      });

      return { foodId, cookingYieldId };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
