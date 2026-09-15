import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { createBasicMealSet } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { generateWeeklyMealPlan } from "@/lib/nutrition/mealPlans";
import { processShoppingPreparationJob } from "@/lib/scheduler/rituals/shoppingPreparation";
import { processDailyCheckinJob } from "@/lib/scheduler/rituals/dailyCheckin";

describe("Shopping Preparation ritual — idempotent per meal plan (ARCHITECTURE_REVIEW.md §7 scenario F)", () => {
  beforeEach(truncateAll);

  it("running it twice for the same meal plan generates the list only once", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "RitualShop1");
    await createBasicMealSet(pool, household);
    await generateWeeklyMealPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, dailyTargets: { calories: 2200, proteinG: 160, carbsG: 220, fatG: 60 } }],
    });

    const first = await processShoppingPreparationJob(pool, { householdId: household.householdId, userId: household.userId });
    expect(first.data?.skipped).toBeUndefined();

    const second = await processShoppingPreparationJob(pool, { householdId: household.householdId, userId: household.userId });
    expect(second.data?.skipped).toBe(true);
    expect(second.data?.shoppingListId).toBe(first.data?.shoppingListId);

    const lists = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT count(*) FROM shopping_lists WHERE household_id = $1", [household.householdId])
    );
    expect(Number(lists.rows[0].count)).toBe(1);
  });

  it("reports gracefully when there is no meal plan yet", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "RitualShop2");

    const result = await processShoppingPreparationJob(pool, { householdId: household.householdId, userId: household.userId });
    expect(result.summary).toMatch(/nenhum plano/i);
  });
});

describe("Daily Check-in ritual — read-only, no side effects", () => {
  beforeEach(truncateAll);

  it("produces a per-person summary without writing any domain row", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "RitualCheckin1");

    const result = await processDailyCheckinJob(pool, { householdId: household.householdId, userId: household.userId });
    expect(result.summary).toMatch(/Check-in de/);
    expect((result.data?.people as string[]).length).toBe(1);

    // Confirm no measurement/workout/habit rows were created as a side effect.
    const counts = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, async (client) => {
      const m = await client.query("SELECT count(*) FROM measurements");
      const ws = await client.query("SELECT count(*) FROM workout_sessions");
      return { measurements: Number(m.rows[0].count), sessions: Number(ws.rows[0].count) };
    });
    expect(counts.measurements).toBe(0);
    expect(counts.sessions).toBe(0);
  });

  it("running it twice in a row produces the same harmless result (safe to duplicate)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "RitualCheckin2");

    const first = await processDailyCheckinJob(pool, { householdId: household.householdId, userId: household.userId });
    const second = await processDailyCheckinJob(pool, { householdId: household.householdId, userId: household.userId });
    expect(first.data?.date).toBe(second.data?.date);
    expect(first.data?.people).toEqual(second.data?.people);
  });
});
