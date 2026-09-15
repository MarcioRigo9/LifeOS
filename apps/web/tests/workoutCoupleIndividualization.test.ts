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
    // 3 training days x 7 exercises (none excluded — no health_history) = 21 items each.
    expect(marcioPlan.itemCount).toBe(21);
    expect(brendaPlan.itemCount).toBe(21);

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
});
