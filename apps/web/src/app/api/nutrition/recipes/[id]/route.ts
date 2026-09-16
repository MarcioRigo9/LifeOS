import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { getRecipeMacroProfile } from "@/lib/nutrition/recipes";

const querySchema = z.object({ householdId: z.string().uuid() });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const result = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const recipeRes = await client.query(`SELECT id, name, instructions, servings, created_at FROM recipes WHERE id = $1`, [id]);
      if (recipeRes.rowCount === 0) return null;

      const itemsRes = await client.query(
        `SELECT ri.id, ri.food_id, ri.raw_grams, cy.preparation_method, cy.yield_factor, f.name AS food_name
         FROM recipe_items ri JOIN foods f ON f.id = ri.food_id
         LEFT JOIN cooking_yields cy ON cy.id = ri.cooking_yield_id
         WHERE ri.recipe_id = $1`,
        [id]
      );

      const macros = await getRecipeMacroProfile(client, id);
      const meals = await client.query(`SELECT id, name, type FROM meals WHERE recipe_id = $1`, [id]);

      return { recipe: recipeRes.rows[0], items: itemsRes.rows, macros, meals: meals.rows };
    });

    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
