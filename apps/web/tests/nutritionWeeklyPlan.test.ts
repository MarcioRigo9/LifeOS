import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, addProfileToHousehold } from "./setup/fixtures";
import { seedNutritionCatalog, createBasicMealSet, seedMarket, seedMarketPrice } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { generateWeeklyMealPlan } from "@/lib/nutrition/mealPlans";
import { generateShoppingList } from "@/lib/nutrition/shoppingLists";
import { calculateDailyTargets } from "@/lib/domain/nutrition";

describe("Full weekly plan for a couple — individualized calories/macros, shared shopping list", () => {
  beforeEach(truncateAll);

  it("generates 7 days x 3 meals x 2 people with DIFFERENT portions per person, and one unified shopping list", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Casal");
    const marcioId = household.profileId;
    const brendaId = await addProfileToHousehold(pool, household, "Brenda");
    const catalog = await seedNutritionCatalog();
    await createBasicMealSet(pool, household);

    const marcioTargets = calculateDailyTargets({
      weightKg: 90,
      heightCm: 180,
      age: 34,
      sex: "male",
      activityLevel: "active",
      goal: "gain_muscle",
    });
    const brendaTargets = calculateDailyTargets({
      weightKg: 60,
      heightCm: 162,
      age: 31,
      sex: "female",
      activityLevel: "light",
      goal: "lose_weight",
    });
    expect(marcioTargets.calories).toBeGreaterThan(brendaTargets.calories); // sanity: genuinely different

    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [
        { personId: marcioId, dailyTargets: marcioTargets },
        { personId: brendaId, dailyTargets: brendaTargets },
      ],
    });

    // 2 people x 7 days x 3 slots (breakfast/lunch/dinner) = 42 items.
    expect(plan.items).toHaveLength(42);

    const rows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        client.query(
          "SELECT person_id, day_of_week, planned_cooked_grams FROM meal_plan_items WHERE meal_plan_id = $1 AND day_of_week = 0",
          [plan.mealPlanId]
        )
    );
    const marcioDay0 = rows.rows.filter((r) => r.person_id === marcioId);
    const brendaDay0 = rows.rows.filter((r) => r.person_id === brendaId);
    expect(marcioDay0).toHaveLength(3);
    expect(brendaDay0).toHaveLength(3);
    // Márcio (gain_muscle, more active, heavier) gets meaningfully larger portions than Brenda
    // (lose_weight) for the SAME recipes — never a shared generic portion.
    const marcioTotal = marcioDay0.reduce((s, r) => s + Number(r.planned_cooked_grams), 0);
    const brendaTotal = brendaDay0.reduce((s, r) => s + Number(r.planned_cooked_grams), 0);
    expect(marcioTotal).toBeGreaterThan(brendaTotal);

    // One unified shopping list for the whole household — not one per person.
    const marketId = await seedMarket(pool, household);
    for (const { foodId, packageSizeG, priceCents } of [
      { foodId: catalog.chickenId, packageSizeG: 1000, priceCents: 2000 },
      { foodId: catalog.riceId, packageSizeG: 1000, priceCents: 800 },
      { foodId: catalog.oatsId, packageSizeG: 500, priceCents: 1000 },
      { foodId: catalog.bananaId, packageSizeG: 1000, priceCents: 500 },
    ]) {
      await seedMarketPrice(pool, household, { marketId, foodId, packageSizeG, priceCents });
    }
    const shoppingList = await generateShoppingList(pool, {
      householdId: household.householdId,
      userId: household.userId,
      mealPlanId: plan.mealPlanId,
    });
    expect(shoppingList.totalCostCents).toBeGreaterThan(0);

    const listCount = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT count(*) FROM shopping_lists WHERE meal_plan_id = $1", [plan.mealPlanId])
    );
    expect(Number(listCount.rows[0].count)).toBe(1); // one list, covering both people's needs together
  });
});
