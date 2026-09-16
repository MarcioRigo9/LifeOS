import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, addProfileToHousehold } from "./setup/fixtures";
import { seedNutritionCatalog, createBasicMealSet, createGroundBeefLunchMeal } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { generateWeeklyMealPlan } from "@/lib/nutrition/mealPlans";
import { upsertDietaryPreferences } from "@/lib/nutrition/dietaryPreferences";
import { calculateDailyTargets } from "@/lib/domain/nutrition";

const MARCIO_TARGETS = calculateDailyTargets({ weightKg: 90, heightCm: 180, age: 34, sex: "male", activityLevel: "active", goal: "gain_muscle" });
const BRENDA_TARGETS = calculateDailyTargets({ weightKg: 60, heightCm: 162, age: 31, sex: "female", activityLevel: "light", goal: "lose_weight" });

describe("Dietary preferences — reheat-intolerance constraint on the weekly plan assembler", () => {
  beforeEach(truncateAll);

  it("critical example: Brenda never gets chicken (reheat-intolerant) at lunch (marmita), but still gets it at dinner (fresh)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Casal");
    const marcioId = household.profileId;
    const brendaId = await addProfileToHousehold(pool, household, "Brenda");
    await createBasicMealSet(pool, household); // chicken lunch + chicken dinner + oats breakfast
    const groundBeef = await createGroundBeefLunchMeal(pool, household); // 2nd lunch option, no chicken

    await upsertDietaryPreferences(
      pool,
      { userId: household.userId, householdId: household.householdId },
      { personId: brendaId, dislikedFoods: [], reheatIntolerantFoods: ["Frango"], prepSchedule: { lunch: "prepped_sunday", dinner: "fresh" } }
    );

    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [
        { personId: marcioId, dailyTargets: MARCIO_TARGETS },
        { personId: brendaId, dailyTargets: BRENDA_TARGETS },
      ],
    });

    const rows = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query(
        `SELECT mpi.person_id, mpi.day_of_week, m.type, m.recipe_id
         FROM meal_plan_items mpi JOIN meals m ON m.id = mpi.meal_id
         WHERE mpi.meal_plan_id = $1`,
        [plan.mealPlanId]
      )
    );

    const brendaLunches = rows.rows.filter((r) => r.person_id === brendaId && r.type === "lunch");
    expect(brendaLunches).toHaveLength(7);
    // NEVER the chicken recipe at lunch for Brenda — always the ground-beef alternative.
    expect(brendaLunches.every((r) => r.recipe_id === groundBeef.recipeId)).toBe(true);

    const brendaDinners = rows.rows.filter((r) => r.person_id === brendaId && r.type === "dinner");
    expect(brendaDinners).toHaveLength(7);
    // Dinner is cooked fresh (not reheated) — chicken is fine there, unaffected by the constraint.
    expect(brendaDinners.every((r) => r.recipe_id !== groundBeef.recipeId)).toBe(true);

    // Márcio has no dietary preferences saved — round-robins across BOTH lunch options.
    const marcioLunches = rows.rows.filter((r) => r.person_id === marcioId && r.type === "lunch");
    const marcioLunchRecipeIds = new Set(marcioLunches.map((r) => r.recipe_id));
    expect(marcioLunchRecipeIds.size).toBe(2);
  });

  it("excludes disliked foods from EVERY slot, not just lunch", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Casal2");
    const marcioId = household.profileId;
    const brendaId = await addProfileToHousehold(pool, household, "Brenda");
    await createBasicMealSet(pool, household);
    const groundBeef = await createGroundBeefLunchMeal(pool, household);

    await upsertDietaryPreferences(
      pool,
      { userId: household.userId, householdId: household.householdId },
      { personId: brendaId, dislikedFoods: ["Frango"], reheatIntolerantFoods: [], prepSchedule: {} }
    );

    // Brenda dislikes chicken outright — but her only dinner option IS chicken (no alternative
    // dinner recipe exists in this fixture set), so plan generation must fail loudly rather than
    // silently serve her a disliked food.
    await expect(
      generateWeeklyMealPlan(pool, {
        householdId: household.householdId,
        userId: household.userId,
        weekStartDate: new Date("2026-01-05"),
        people: [{ personId: brendaId, dailyTargets: BRENDA_TARGETS }],
      })
    ).rejects.toThrow(/dietary preferences/);

    // Sanity: Márcio (no preferences) is unaffected and this alternative meal exists at all.
    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [{ personId: marcioId, dailyTargets: MARCIO_TARGETS }],
    });
    expect(plan.items.length).toBeGreaterThan(0);
    void groundBeef;
  });

  it("throws a clear error when filtering would leave zero valid lunch options", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Casal3");
    const brendaId = await addProfileToHousehold(pool, household, "Brenda");
    await createBasicMealSet(pool, household); // ONLY chicken lunch available, no alternative

    await upsertDietaryPreferences(
      pool,
      { userId: household.userId, householdId: household.householdId },
      { personId: brendaId, dislikedFoods: [], reheatIntolerantFoods: ["Frango"], prepSchedule: {} }
    );

    await expect(
      generateWeeklyMealPlan(pool, {
        householdId: household.householdId,
        userId: household.userId,
        weekStartDate: new Date("2026-01-05"),
        people: [{ personId: brendaId, dailyTargets: BRENDA_TARGETS }],
      })
    ).rejects.toThrow(/no lunch meals available/);
  });

  it("a person with no saved dietary_preferences row is completely unaffected (backward compatible)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Casal4");
    const marcioId = household.profileId;
    await createBasicMealSet(pool, household);
    await seedNutritionCatalog();

    const plan = await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-05"),
      people: [{ personId: marcioId, dailyTargets: MARCIO_TARGETS }],
    });
    expect(plan.items).toHaveLength(21); // 7 days x 3 slots, no filtering applied
  });
});
