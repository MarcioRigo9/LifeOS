import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordHealthEvent } from "@/lib/health/healthHistory";
import { generateWeeklyWorkoutPlan } from "@/lib/fitness/workoutPlans";

describe("Fitness Agent respects active health_history (SECURITY_MODEL.md §13, wellness-tier exclusion)", () => {
  beforeEach(truncateAll);

  it("an active shoulder injury excludes shoulder exercises from the generated plan", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Contra1");
    const catalog = await seedFitnessCatalog();

    await recordHealthEvent(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      category: "injury",
      title: "Tendinite no ombro direito",
      details: "diagnosticada por fisioterapeuta em janeiro",
      recordedAt: new Date(),
      source: "doctor_report",
    });

    const [plan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, bodyweightKg: 80, goal: "maintain" }],
    });

    expect(plan.excludedBodyRegions).toContain("shoulders");

    const exerciseIdsInPlan = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT DISTINCT exercise_id FROM workout_plan_items WHERE workout_plan_id = $1", [plan.workoutPlanId])
    );
    const ids = exerciseIdsInPlan.rows.map((r) => r.exercise_id);
    expect(ids).not.toContain(catalog.overheadPressId);
    expect(ids).not.toContain(catalog.lateralRaiseId);
    // Unrelated exercises remain in the plan.
    expect(ids).toContain(catalog.squatId);
    expect(ids).toContain(catalog.benchPressId);
  });

  it("a RESOLVED (inactive) injury does not exclude anything", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Contra2");
    const catalog = await seedFitnessCatalog();

    const eventId = await recordHealthEvent(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      category: "injury",
      title: "Tendinite no ombro",
      details: "já tratada",
      recordedAt: new Date(),
      source: "user_input",
    });
    void eventId;
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE health_history SET active = false WHERE household_id = $1", [household.householdId])
    );

    const [plan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: household.profileId, bodyweightKg: 80, goal: "maintain" }],
    });

    expect(plan.excludedBodyRegions).toEqual([]);
    const exerciseIdsInPlan = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT DISTINCT exercise_id FROM workout_plan_items WHERE workout_plan_id = $1", [plan.workoutPlanId])
    );
    expect(exerciseIdsInPlan.rows.map((r) => r.exercise_id)).toContain(catalog.overheadPressId);
  });
});
