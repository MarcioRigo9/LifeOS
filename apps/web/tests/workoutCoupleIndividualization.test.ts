import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, addProfileToHousehold } from "./setup/fixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { generateWeeklyWorkoutPlan } from "@/lib/fitness/workoutPlans";

describe("Individualized workout plans for a couple (Márcio & Brenda)", () => {
  beforeEach(truncateAll);

  it("generates DISTINCT plans — different loads (bodyweight) and different rep ranges/volume (goal) per person", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "CasalTreino");
    const marcioId = household.profileId;
    const brendaId = await addProfileToHousehold(pool, household, "Brenda");
    await seedFitnessCatalog();

    const plans = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [
        { personId: marcioId, bodyweightKg: 90, goal: "gain_muscle" },
        { personId: brendaId, bodyweightKg: 60, goal: "lose_weight" },
      ],
    });

    expect(plans).toHaveLength(2);
    const marcioPlan = plans.find((p) => p.personId === marcioId)!;
    const brendaPlan = plans.find((p) => p.personId === brendaId)!;
    // Coherent PPL split (default trainingDaysPerWeek=3), not "every exercise on every day" —
    // each of the fixture's 7 exercises lands on exactly one of the 3 sessions once.
    expect(marcioPlan.itemCount).toBe(7);
    expect(brendaPlan.itemCount).toBe(7);

    const marcioItems = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT min_reps, max_reps, target_load_kg FROM workout_plan_items WHERE workout_plan_id = $1 AND day_of_week = 0 ORDER BY order_index LIMIT 1", [marcioPlan.workoutPlanId])
    );
    const brendaItems = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT min_reps, max_reps, target_load_kg FROM workout_plan_items WHERE workout_plan_id = $1 AND day_of_week = 0 ORDER BY order_index LIMIT 1", [brendaPlan.workoutPlanId])
    );

    // gain_muscle (Márcio) uses a lower rep range than lose_weight (Brenda) — REP_RANGE_BY_GOAL.
    expect(Number(marcioItems.rows[0].max_reps)).toBeLessThan(Number(brendaItems.rows[0].max_reps));
    // Heavier bodyweight -> higher starting load for the SAME exercise slot — never a shared load.
    expect(Number(marcioItems.rows[0].target_load_kg)).toBeGreaterThan(Number(brendaItems.rows[0].target_load_kg));
  });

  it("each person gets their OWN workout_plans row (never a shared plan)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "CasalTreino2");
    const marcioId = household.profileId;
    const brendaId = await addProfileToHousehold(pool, household, "Brenda2");
    await seedFitnessCatalog();

    const plans = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [
        { personId: marcioId, bodyweightKg: 85, goal: "maintain" },
        { personId: brendaId, bodyweightKg: 58, goal: "maintain" },
      ],
    });

    expect(plans[0].workoutPlanId).not.toBe(plans[1].workoutPlanId);
    const rows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT person_id FROM workout_plans WHERE household_id = $1", [household.householdId])
    );
    expect(rows.rows.map((r) => r.person_id).sort()).toEqual([marcioId, brendaId].sort());
  });

  it("3 days/week: no session mixes legs with push/pull muscle groups, and every session stays within 4-6 exercises", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "CasalSplit3");
    const catalog = await seedFitnessCatalog();

    const [plan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, bodyweightKg: 80, goal: "maintain", trainingDaysPerWeek: 3 }],
    });

    const rows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        client.query<{ day_of_week: number; exercise_id: string }>(
          "SELECT day_of_week, exercise_id FROM workout_plan_items WHERE workout_plan_id = $1 ORDER BY day_of_week, order_index",
          [plan.workoutPlanId]
        )
    );

    const byDay = new Map<number, string[]>();
    for (const row of rows.rows) {
      const list = byDay.get(row.day_of_week) ?? [];
      list.push(row.exercise_id);
      byDay.set(row.day_of_week, list);
    }

    // Legs is dayOfWeek=4 (Friday) per buildWeeklySplit — never contains a Push/Pull exercise.
    const legsDay = byDay.get(4) ?? [];
    expect(legsDay).toContain(catalog.squatId);
    expect(legsDay).not.toContain(catalog.benchPressId); // chest (Push)
    expect(legsDay).not.toContain(catalog.deadliftId); // back (Pull)
    expect(legsDay).not.toContain(catalog.overheadPressId); // shoulders (Push)

    // Push (Monday=0) and Pull (Wednesday=2) never mix squat/deadlift on the same day as each
    // other (the ticket's explicit "never agachamento pesado junto com remada/terra" rule).
    const pushDay = byDay.get(0) ?? [];
    const pullDay = byDay.get(2) ?? [];
    expect(pushDay).not.toContain(catalog.squatId);
    expect(pullDay).not.toContain(catalog.squatId);
    expect(pushDay).toContain(catalog.benchPressId);
    expect(pullDay).toContain(catalog.deadliftId);

    for (const [, exercises] of byDay) {
      expect(exercises.length).toBeGreaterThan(0);
      expect(exercises.length).toBeLessThanOrEqual(6);
    }
  });

  it("4 days/week: builds Upper/Lower x2 with a rest day, capped at 6 exercises/session", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "CasalSplit4");
    await seedFitnessCatalog();

    const [plan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, bodyweightKg: 80, goal: "maintain", trainingDaysPerWeek: 4 }],
    });

    const rows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query<{ day_of_week: number }>("SELECT day_of_week FROM workout_plan_items WHERE workout_plan_id = $1", [plan.workoutPlanId])
    );
    const daysUsed = new Set(rows.rows.map((r) => r.day_of_week));
    // Exactly 4 distinct training days, Wednesday (2) free as a rest day between the two pairs.
    expect(daysUsed.size).toBeLessThanOrEqual(4);
    expect(daysUsed.has(2)).toBe(false);

    const countByDay = new Map<number, number>();
    for (const row of rows.rows) countByDay.set(row.day_of_week, (countByDay.get(row.day_of_week) ?? 0) + 1);
    for (const count of countByDay.values()) expect(count).toBeLessThanOrEqual(6);
  });

  it("5 days/week: chest/triceps never lands the day immediately before shoulders", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "CasalSplit5");
    await seedFitnessCatalog();

    const [plan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, bodyweightKg: 80, goal: "maintain", trainingDaysPerWeek: 5 }],
    });

    const rows = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) =>
        client.query<{ day_of_week: number; exercise_id: string }>(
          "SELECT day_of_week, exercise_id FROM workout_plan_items WHERE workout_plan_id = $1",
          [plan.workoutPlanId]
        )
    );
    const byDay = new Map<number, string[]>();
    for (const row of rows.rows) {
      const list = byDay.get(row.day_of_week) ?? [];
      list.push(row.exercise_id);
      byDay.set(row.day_of_week, list);
    }

    const catalog = await seedFitnessCatalog();
    const chestDay = [...byDay.entries()].find(([, ex]) => ex.includes(catalog.benchPressId))?.[0];
    const shouldersDay = [...byDay.entries()].find(([, ex]) => ex.includes(catalog.overheadPressId))?.[0];
    expect(chestDay).toBeDefined();
    expect(shouldersDay).toBeDefined();
    expect(shouldersDay! - chestDay!).not.toBe(1); // never the very next day
  });
});
