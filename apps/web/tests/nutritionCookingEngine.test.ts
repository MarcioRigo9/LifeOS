import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll, withTestAdminClient } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedNutritionCatalog } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { createRecipe, getRecipeMacroProfile } from "@/lib/nutrition/recipes";

describe("Cooking engine — exact conversions and version immutability (DATA_MODEL_REVIEW.md §2.3)", () => {
  beforeEach(truncateAll);

  it("computes exact raw->cooked yield for a composed recipe (chicken 0.7x, rice 2.5x)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Cook1");
    const catalog = await seedNutritionCatalog();

    const recipeId = await createRecipe(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Frango com arroz",
      items: [
        { foodId: catalog.chickenId, rawGrams: 200, preparationMethod: "grilled" }, // 200 * 0.7 = 140
        { foodId: catalog.riceId, rawGrams: 100, preparationMethod: "boiled" }, // 100 * 2.5 = 250
      ],
    });

    const profile = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => getRecipeMacroProfile(client, recipeId)
    );

    expect(profile.totalCookedGrams).toBe(390); // 140 + 250, exact
  });

  it("a future re-versioning of cooking_yields does NOT change an already-created recipe's computed yield", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Cook2");

    // Deliberately a food/yield DEDICATED to this test (never touched by seedNutritionCatalog's
    // shared fixture) — this test mutates cooking_yields on purpose (publishes a v2), and doing
    // that to the shared chicken fixture would pollute every other test that reuses it, since
    // foods/cooking_yields are global and NEVER truncated between tests (DATA_MODEL_REVIEW §1.1).
    const { foodId } = await withTestAdminClient(async (client) => {
      const foodRes = await client.query<{ id: string }>(
        `INSERT INTO foods (name, category, calories_kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g)
         VALUES ('Frango Teste Imutabilidade', 'test', 165, 31, 0, 3.6) RETURNING id`
      );
      const foodId = foodRes.rows[0].id;
      await client.query(
        `INSERT INTO cooking_yields (food_id, preparation_method, raw_weight_g, cooked_weight_g, source, version)
         VALUES ($1, 'grilled', 100, 70, 'test-fixture', 1)`,
        [foodId]
      );
      return { foodId };
    });

    const recipeId = await createRecipe(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Só frango",
      items: [{ foodId, rawGrams: 200, preparationMethod: "grilled" }],
    });

    const profileBefore = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => getRecipeMacroProfile(client, recipeId)
    );
    expect(profileBefore.totalCookedGrams).toBe(140); // 200 * 0.7 (v1)

    // A correction is published: grilled chicken actually yields 0.6x, not 0.7x — a NEW version.
    await withTestAdminClient((client) =>
      client.query(
        `INSERT INTO cooking_yields (food_id, preparation_method, raw_weight_g, cooked_weight_g, source, version)
         VALUES ($1, 'grilled', 100, 60, 'corrected-source', 2)`,
        [foodId]
      )
    );

    const profileAfter = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => getRecipeMacroProfile(client, recipeId)
    );
    // Unchanged — the existing recipe_item is pinned to the v1 cooking_yields row.
    expect(profileAfter.totalCookedGrams).toBe(140);

    // But a NEW recipe created now picks up the latest (v2) version automatically.
    const newRecipeId = await createRecipe(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Frango (receita nova)",
      items: [{ foodId, rawGrams: 200, preparationMethod: "grilled" }],
    });
    const newProfile = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => getRecipeMacroProfile(client, newRecipeId)
    );
    expect(newProfile.totalCookedGrams).toBe(120); // 200 * 0.6 (v2)
  });
});
