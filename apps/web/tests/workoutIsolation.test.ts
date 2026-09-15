import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { startWorkoutSession, recordWorkoutSet } from "@/lib/fitness/workoutSessions";
import { generateWeeklyWorkoutPlan } from "@/lib/fitness/workoutPlans";

describe("Cross-household isolation of fitness data (plans, sessions, logs)", () => {
  beforeEach(truncateAll);

  it("Household A cannot read Household B's workout plans, sessions, or logs", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "FitA");
    const householdB = await createHouseholdFixture(pool, "FitB");
    const catalog = await seedFitnessCatalog();

    const [planB] = await generateWeeklyWorkoutPlan(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      weekStartDate: new Date("2026-02-02"),
      people: [{ personId: householdB.profileId, bodyweightKg: 75, goal: "maintain" }],
    });
    const sessionB = await startWorkoutSession(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      personId: householdB.profileId,
      performedAt: new Date(),
    });
    await recordWorkoutSet(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      sessionId: sessionB,
      exerciseId: catalog.benchPressId,
      setNumber: 1,
      reps: 10,
      loadKg: 80,
    });

    const planSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM workout_plans WHERE id = $1", [planB.workoutPlanId])
    );
    expect(planSeenByA.rowCount).toBe(0);

    const sessionSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM workout_sessions WHERE id = $1", [sessionB])
    );
    expect(sessionSeenByA.rowCount).toBe(0);

    const logsSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM workout_logs WHERE workout_session_id = $1", [sessionB])
    );
    expect(logsSeenByA.rowCount).toBe(0);
  });

  it("Household A cannot INSERT a workout_plan tagged with Household B's household_id (RLS WITH CHECK)", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "FitA2");
    const householdB = await createHouseholdFixture(pool, "FitB2");

    await expect(
      withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
        client.query("INSERT INTO workout_plans (household_id, person_id, week_start_date) VALUES ($1, $2, now())", [
          householdB.householdId,
          householdB.profileId,
        ])
      )
    ).rejects.toThrow();
  });

  it("the global exercises catalog is readable by any household", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FitA3");
    const catalog = await seedFitnessCatalog();

    const seen = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT id FROM exercises WHERE id = $1", [catalog.benchPressId])
    );
    expect(seen.rowCount).toBe(1);
  });
});
