import type { Pool } from "pg";
import { withTestAdminClient } from "./testDb";
import { withHouseholdContext } from "@/lib/db/pool";
import { createRecipe } from "@/lib/nutrition/recipes";
import { createMeal } from "@/lib/nutrition/meals";
import type { HouseholdFixture } from "./fixtures";

export interface NutritionCatalog {
  chickenId: string;
  riceId: string;
  oatsId: string;
  bananaId: string;
  chickenGrilledYieldId: string;
  riceBoiledYieldId: string;
}

let cached: NutritionCatalog | null = null;

async function ensureFood(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { id: string }[] }> },
  name: string,
  macros: { calories: number; protein: number; carbs: number; fat: number }
): Promise<string> {
  const existing = await client.query("SELECT id FROM foods WHERE name = $1", [name]);
  if (existing.rows[0]) return existing.rows[0].id;
  const res = await client.query(
    `INSERT INTO foods (name, category, calories_kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g)
     VALUES ($1, 'test', $2, $3, $4, $5) RETURNING id`,
    [name, macros.calories, macros.protein, macros.carbs, macros.fat]
  );
  return res.rows[0].id;
}

async function ensureCookingYield(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { id: string }[] }> },
  foodId: string,
  method: string,
  rawWeightG: number,
  cookedWeightG: number
): Promise<string> {
  const existing = await client.query(
    "SELECT id FROM cooking_yields WHERE food_id = $1 AND preparation_method = $2 ORDER BY version DESC LIMIT 1",
    [foodId, method]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const res = await client.query(
    `INSERT INTO cooking_yields (food_id, preparation_method, raw_weight_g, cooked_weight_g, source, version)
     VALUES ($1, $2, $3, $4, 'test-fixture', 1) RETURNING id`,
    [foodId, method, rawWeightG, cookedWeightG]
  );
  return res.rows[0].id;
}

/** Idempotent — seeds the GLOBAL foods/cooking_yields catalog once per test session (these
 * tables are never truncated between tests, DATA_MODEL_REVIEW.md §1.1). */
export async function seedNutritionCatalog(): Promise<NutritionCatalog> {
  if (cached) return cached;
  cached = await withTestAdminClient(async (client) => {
    const chickenId = await ensureFood(client, "Peito de frango", { calories: 165, protein: 31, carbs: 0, fat: 3.6 });
    const riceId = await ensureFood(client, "Arroz branco", { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 });
    const oatsId = await ensureFood(client, "Aveia em flocos", { calories: 389, protein: 16.9, carbs: 66, fat: 6.9 });
    const bananaId = await ensureFood(client, "Banana", { calories: 89, protein: 1.1, carbs: 23, fat: 0.3 });

    const chickenGrilledYieldId = await ensureCookingYield(client, chickenId, "grilled", 100, 70);
    const riceBoiledYieldId = await ensureCookingYield(client, riceId, "boiled", 100, 250);

    return { chickenId, riceId, oatsId, bananaId, chickenGrilledYieldId, riceBoiledYieldId };
  });
  return cached;
}

export interface HouseholdMealSet {
  lunchRecipeId: string;
  breakfastRecipeId: string;
  lunchMealId: string;
  dinnerMealId: string;
  breakfastMealId: string;
}

/** Creates one household's worth of recipes/meals: a chicken+rice dish (used for both lunch and
 * dinner, exercising cross-slot ingredient aggregation) and an oats+banana breakfast. */
export async function createBasicMealSet(pool: Pool, household: HouseholdFixture): Promise<HouseholdMealSet> {
  const catalog = await seedNutritionCatalog();

  const lunchRecipeId = await createRecipe(pool, {
    householdId: household.householdId,
    userId: household.userId,
    name: "Frango grelhado com arroz",
    servings: 1,
    items: [
      { foodId: catalog.chickenId, rawGrams: 200, preparationMethod: "grilled" },
      { foodId: catalog.riceId, rawGrams: 100, preparationMethod: "boiled" },
    ],
  });
  const breakfastRecipeId = await createRecipe(pool, {
    householdId: household.householdId,
    userId: household.userId,
    name: "Aveia com banana",
    servings: 1,
    items: [
      { foodId: catalog.oatsId, rawGrams: 60 }, // eaten as-is, no cooking step
      { foodId: catalog.bananaId, rawGrams: 100 },
    ],
  });

  const lunchMealId = await createMeal(pool, {
    householdId: household.householdId,
    userId: household.userId,
    recipeId: lunchRecipeId,
    name: "Frango grelhado com arroz — almoço",
    type: "lunch",
  });
  const dinnerMealId = await createMeal(pool, {
    householdId: household.householdId,
    userId: household.userId,
    recipeId: lunchRecipeId,
    name: "Frango grelhado com arroz — jantar",
    type: "dinner",
  });
  const breakfastMealId = await createMeal(pool, {
    householdId: household.householdId,
    userId: household.userId,
    recipeId: breakfastRecipeId,
    name: "Aveia com banana",
    type: "breakfast",
  });

  return { lunchRecipeId, breakfastRecipeId, lunchMealId, dinnerMealId, breakfastMealId };
}

/** A second lunch option with NO chicken — "Carne moída com arroz" — for exercising the
 * reheat-intolerance constraint (a person who can't reheat chicken still needs a valid lunch
 * option to round-robin into). */
export async function createGroundBeefLunchMeal(pool: Pool, household: HouseholdFixture): Promise<{ mealId: string; recipeId: string }> {
  const catalog = await seedNutritionCatalog();
  const groundBeefId = await withTestAdminClient((client) =>
    ensureFood(client, "Carne moída", { calories: 250, protein: 26, carbs: 0, fat: 15 })
  );

  const recipeId = await createRecipe(pool, {
    householdId: household.householdId,
    userId: household.userId,
    name: "Carne moída com arroz",
    servings: 1,
    items: [
      { foodId: groundBeefId, rawGrams: 150 },
      { foodId: catalog.riceId, rawGrams: 100, preparationMethod: "boiled" },
    ],
  });
  const mealId = await createMeal(pool, {
    householdId: household.householdId,
    userId: household.userId,
    recipeId,
    name: "Carne moída com arroz — almoço",
    type: "lunch",
  });
  return { mealId, recipeId };
}

export async function seedMarket(
  pool: Pool,
  household: HouseholdFixture,
  name = "Mercado do Bairro"
): Promise<string> {
  return withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, async (client) => {
    const res = await client.query<{ id: string }>("INSERT INTO markets (household_id, name) VALUES ($1, $2) RETURNING id", [
      household.householdId,
      name,
    ]);
    return res.rows[0].id;
  });
}

export async function seedMarketPrice(
  pool: Pool,
  household: HouseholdFixture,
  params: { marketId: string; foodId: string; packageSizeG: number; priceCents: number; capturedAt?: Date }
): Promise<string> {
  return withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO market_prices (household_id, market_id, food_id, package_size_g, price_cents, captured_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'test-fixture') RETURNING id`,
      [
        household.householdId,
        params.marketId,
        params.foodId,
        params.packageSizeG,
        params.priceCents,
        params.capturedAt ?? new Date(),
      ]
    );
    return res.rows[0].id;
  });
}
