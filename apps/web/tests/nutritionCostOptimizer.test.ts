import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedNutritionCatalog, createBasicMealSet, seedMarket, seedMarketPrice } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { generateWeeklyMealPlan } from "@/lib/nutrition/mealPlans";
import { generateShoppingList } from "@/lib/nutrition/shoppingLists";
import { calculateDailyTargets } from "@/lib/domain/nutrition";

describe("Weekly cost optimizer — real DB integration (whole packages, not fractional grams x price)", () => {
  beforeEach(truncateAll);

  it("never computes 1.2kg x R$20/kg = R$24 — always whole closed packages", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Cost1");
    const catalog = await seedNutritionCatalog();
    const meals = await createBasicMealSet(pool, household);
    const marketId = await seedMarket(pool, household);
    await seedMarketPrice(pool, household, {
      marketId,
      foodId: catalog.chickenId,
      packageSizeG: 1000,
      priceCents: 2000, // R$ 20,00/kg
    });
    await seedMarketPrice(pool, household, {
      marketId,
      foodId: catalog.riceId,
      packageSizeG: 1000,
      priceCents: 800,
    });
    await seedMarketPrice(pool, household, {
      marketId,
      foodId: catalog.oatsId,
      packageSizeG: 500,
      priceCents: 1000,
    });
    await seedMarketPrice(pool, household, {
      marketId,
      foodId: catalog.bananaId,
      packageSizeG: 1000,
      priceCents: 500,
    });
    void meals;

    const targets = calculateDailyTargets({
      weightKg: 85,
      heightCm: 178,
      age: 35,
      sex: "male",
      activityLevel: "moderate",
      goal: "maintain",
    });
    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [{ personId: household.profileId, dailyTargets: targets }],
    });

    const shoppingList = await generateShoppingList(pool, {
      householdId: household.householdId,
      userId: household.userId,
      mealPlanId: plan.mealPlanId,
    });

    const chickenItem = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        client.query(
          "SELECT buy_qty, surplus_grams, estimated_cost_cents, needed_raw_grams FROM shopping_list_items WHERE shopping_list_id = $1 AND food_id = $2",
          [shoppingList.shoppingListId, catalog.chickenId]
        )
    );

    expect(chickenItem.rows).toHaveLength(1);
    const row = chickenItem.rows[0];
    // The plan needs chicken across BOTH lunch and dinner, every day of the week — well over
    // 1kg — so this must buy multiple whole packages, never a fractional-package estimate.
    expect(row.buy_qty).toBeGreaterThanOrEqual(2);
    expect(Number(row.estimated_cost_cents)).toBe(row.buy_qty * 2000); // exact multiple of the package price
    expect(Number(row.surplus_grams)).toBeGreaterThanOrEqual(0);
    expect(shoppingList.totalCostCents).toBeGreaterThan(0);
    expect(shoppingList.itemsWithoutPrice).toEqual([]);
  });

  it("reports a food with no market price as explicitly unavailable, never a guessed cost", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Cost2");
    await seedNutritionCatalog();
    await createBasicMealSet(pool, household);
    // Deliberately: no seedMarketPrice calls at all.

    const targets = calculateDailyTargets({
      weightKg: 70,
      heightCm: 170,
      age: 30,
      sex: "female",
      activityLevel: "light",
      goal: "maintain",
    });
    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [{ personId: household.profileId, dailyTargets: targets }],
    });

    const shoppingList = await generateShoppingList(pool, {
      householdId: household.householdId,
      userId: household.userId,
      mealPlanId: plan.mealPlanId,
    });

    expect(shoppingList.totalCostCents).toBe(0);
    expect(shoppingList.itemsWithoutPrice.length).toBeGreaterThan(0);

    const flaggedRows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        client.query("SELECT price_unavailable FROM shopping_list_items WHERE shopping_list_id = $1", [
          shoppingList.shoppingListId,
        ])
    );
    expect(flaggedRows.rows.every((r) => r.price_unavailable === true)).toBe(true);
  });
});
