import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedNutritionCatalog, createBasicMealSet, seedMarket, seedMarketPrice } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { generateWeeklyMealPlan } from "@/lib/nutrition/mealPlans";
import { generateShoppingList } from "@/lib/nutrition/shoppingLists";
import { calculateDailyTargets } from "@/lib/domain/nutrition";

describe("Cross-household isolation of nutrition data (recipes, plans, shopping lists)", () => {
  beforeEach(truncateAll);

  it("Household A cannot read Household B's recipes, meal plans, or shopping list items", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "NutA");
    const householdB = await createHouseholdFixture(pool, "NutB");
    const catalog = await seedNutritionCatalog();
    await createBasicMealSet(pool, householdA);
    const mealsB = await createBasicMealSet(pool, householdB);

    const targets = calculateDailyTargets({
      weightKg: 75,
      heightCm: 175,
      age: 30,
      sex: "male",
      activityLevel: "moderate",
      goal: "maintain",
    });
    const planB = await generateWeeklyMealPlan(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [{ personId: householdB.profileId, dailyTargets: targets }],
    });
    const marketB = await seedMarket(pool, householdB);
    await seedMarketPrice(pool, householdB, { marketId: marketB, foodId: catalog.chickenId, packageSizeG: 1000, priceCents: 2000 });
    await seedMarketPrice(pool, householdB, { marketId: marketB, foodId: catalog.riceId, packageSizeG: 1000, priceCents: 800 });
    await seedMarketPrice(pool, householdB, { marketId: marketB, foodId: catalog.oatsId, packageSizeG: 500, priceCents: 1000 });
    await seedMarketPrice(pool, householdB, { marketId: marketB, foodId: catalog.bananaId, packageSizeG: 1000, priceCents: 500 });
    const shoppingListB = await generateShoppingList(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      mealPlanId: planB.mealPlanId,
    });

    // Recipes: A sees only its own.
    const recipesSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM recipes")
    );
    expect(recipesSeenByA.rows.map((r) => r.id)).not.toContain(mealsB.lunchRecipeId);

    // Meal plans: A cannot read B's plan by id.
    const planSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM meal_plans WHERE id = $1", [planB.mealPlanId])
    );
    expect(planSeenByA.rowCount).toBe(0);

    // Markets/prices: A cannot see B's market prices at all.
    const marketsSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM markets")
    );
    expect(marketsSeenByA.rows.map((r) => r.id)).not.toContain(marketB);

    // Shopping list items: A cannot read B's shopping list by id.
    const shoppingItemsSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM shopping_list_items WHERE shopping_list_id = $1", [shoppingListB.shoppingListId])
    );
    expect(shoppingItemsSeenByA.rowCount).toBe(0);
  });

  it("Household A cannot INSERT a recipe tagged with Household B's household_id (RLS WITH CHECK)", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "NutA2");
    const householdB = await createHouseholdFixture(pool, "NutB2");

    await expect(
      withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
        client.query("INSERT INTO recipes (household_id, name) VALUES ($1, 'invasão')", [householdB.householdId])
      )
    ).rejects.toThrow();
  });

  it("global catalog (foods, cooking_yields) is readable by any household — it's not household data", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "NutA3");
    const catalog = await seedNutritionCatalog();

    const foodsSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM foods WHERE id = $1", [catalog.chickenId])
    );
    expect(foodsSeenByA.rowCount).toBe(1);
  });
});
