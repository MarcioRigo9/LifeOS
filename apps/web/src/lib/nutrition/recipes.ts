import type { Pool, PoolClient } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { calculateRecipeMacros, type RecipeMacroProfile } from "@/lib/domain/nutrition";
import { logAudit } from "@/lib/audit";

export interface CreateRecipeItemInput {
  foodId: string;
  rawGrams: number;
  preparationMethod?: string; // omitted = eaten raw, no cooking step (yieldFactor treated as 1.0)
}

export interface CreateRecipeInput {
  householdId: string;
  userId: string;
  name: string;
  instructions?: string;
  servings?: number;
  items: CreateRecipeItemInput[];
}

export async function createRecipe(pool: Pool, input: CreateRecipeInput): Promise<string> {
  if (input.items.length === 0) throw new Error("a recipe needs at least one ingredient");

  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    const recipeRes = await client.query<{ id: string }>(
      `INSERT INTO recipes (household_id, name, instructions, servings) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.householdId, input.name, input.instructions ?? null, input.servings ?? 1]
    );
    const recipeId = recipeRes.rows[0].id;

    for (const item of input.items) {
      let cookingYieldId: string | null = null;
      if (item.preparationMethod) {
        // Pin the LATEST version at creation time — deliberately. A future re-versioning of
        // cooking_yields must never silently change this recipe's already-computed yield
        // (this phase's immutability requirement).
        const yieldRes = await client.query<{ id: string }>(
          `SELECT id FROM cooking_yields WHERE food_id = $1 AND preparation_method = $2
           ORDER BY version DESC LIMIT 1`,
          [item.foodId, item.preparationMethod]
        );
        if (yieldRes.rowCount === 0) {
          throw new Error(`no cooking_yields row for food=${item.foodId} method=${item.preparationMethod}`);
        }
        cookingYieldId = yieldRes.rows[0].id;
      }
      await client.query(
        `INSERT INTO recipe_items (household_id, recipe_id, food_id, cooking_yield_id, raw_grams)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.householdId, recipeId, item.foodId, cookingYieldId, item.rawGrams]
      );
    }

    await logAudit(client, {
      householdId: input.householdId,
      actorType: "user",
      actorId: input.userId,
      eventType: "recipe.created",
      entityType: "recipes",
      entityId: recipeId,
    });

    return recipeId;
  });
}

export interface RecipeIngredientRow {
  foodId: string;
  rawGrams: number;
  yieldFactor: number;
}

/** Ingredients as pinned at recipe-creation time (via cooking_yield_id) — immune to later
 * cooking_yields re-versioning (see createRecipe). */
export async function getRecipeIngredients(client: PoolClient, recipeId: string): Promise<RecipeIngredientRow[]> {
  const res = await client.query<{ food_id: string; raw_grams: string; yield_factor: string | null }>(
    `SELECT ri.food_id, ri.raw_grams, cy.yield_factor
     FROM recipe_items ri
     LEFT JOIN cooking_yields cy ON cy.id = ri.cooking_yield_id
     WHERE ri.recipe_id = $1`,
    [recipeId]
  );
  return res.rows.map((r) => ({
    foodId: r.food_id,
    rawGrams: Number(r.raw_grams),
    yieldFactor: r.yield_factor === null ? 1.0 : Number(r.yield_factor),
  }));
}

export async function getRecipeMacroProfile(client: PoolClient, recipeId: string): Promise<RecipeMacroProfile> {
  const ingredients = await getRecipeIngredients(client, recipeId);
  if (ingredients.length === 0) throw new Error(`recipe ${recipeId} has no ingredients`);

  const foodsRes = await client.query<{
    id: string;
    calories_kcal_per_100g: string;
    protein_g_per_100g: string;
    carbs_g_per_100g: string;
    fat_g_per_100g: string;
  }>(`SELECT id, calories_kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g FROM foods WHERE id = ANY($1)`, [
    ingredients.map((i) => i.foodId),
  ]);
  const foodById = new Map(foodsRes.rows.map((f) => [f.id, f]));

  return calculateRecipeMacros(
    ingredients.map((i) => {
      const food = foodById.get(i.foodId);
      if (!food) throw new Error(`food ${i.foodId} not found`);
      return {
        rawGrams: i.rawGrams,
        yieldFactor: i.yieldFactor,
        food: {
          caloriesPer100g: Number(food.calories_kcal_per_100g),
          proteinPer100g: Number(food.protein_g_per_100g),
          carbsPer100g: Number(food.carbs_g_per_100g),
          fatPer100g: Number(food.fat_g_per_100g),
        },
      };
    })
  );
}
