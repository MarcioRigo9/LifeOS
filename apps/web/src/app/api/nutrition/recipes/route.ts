import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { createRecipe, getRecipeMacroProfile } from "@/lib/nutrition/recipes";

const querySchema = z.object({ householdId: z.string().uuid(), search: z.string().optional() });

/** Every macro/yield figure here comes straight from getRecipeMacroProfile (recipes.ts), which
 * itself is built entirely on domain/nutrition.ts's calculateRecipeMacros/recipeYield — this
 * route does no arithmetic of its own, only formatting rows for the list. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId"), search: url.searchParams.get("search") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const recipes = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const res = await client.query<{ id: string; name: string; instructions: string | null; servings: number; created_at: string }>(
        `SELECT id, name, instructions, servings, created_at FROM recipes
         WHERE household_id = $1 ${parsed.data.search ? "AND name ILIKE '%' || $2 || '%'" : ""}
         ORDER BY created_at DESC`,
        parsed.data.search ? [householdId, parsed.data.search] : [householdId]
      );

      const withMacros = [];
      for (const recipe of res.rows) {
        try {
          const macros = await getRecipeMacroProfile(client, recipe.id);
          withMacros.push({ ...recipe, macros });
        } catch {
          // A recipe with zero ingredients (shouldn't normally happen — createRecipe requires
          // at least one) is still listed, just without computed macros.
          withMacros.push({ ...recipe, macros: null });
        }
      }
      return withMacros;
    });

    return NextResponse.json(recipes);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}

const postSchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().min(1),
  instructions: z.string().optional(),
  servings: z.number().int().positive().optional(),
  items: z
    .array(z.object({ foodId: z.string().uuid(), rawGrams: z.number().positive(), preparationMethod: z.string().optional() }))
    .min(1),
});

export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const recipeId = await createRecipe(getRuntimePool(), {
      householdId,
      userId,
      name: parsed.data.name,
      instructions: parsed.data.instructions,
      servings: parsed.data.servings,
      items: parsed.data.items,
    });
    return NextResponse.json({ id: recipeId }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (err instanceof Error && err.message.includes("no cooking_yields row")) {
      return NextResponse.json({ error: "missing_cooking_yield" }, { status: 422 });
    }
    throw err;
  }
}
