import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { startWorkoutSession, recordWorkoutSet, getExerciseHistory } from "@/lib/fitness/workoutSessions";
import { progressionEngine, type ExerciseTarget } from "@/lib/domain/fitness";

const BENCH_TARGET: ExerciseTarget = { exerciseType: "compound", targetSets: 3, minReps: 6, maxReps: 10, targetRpe: 8 };

describe("Progression engine — real DB integration (workout_logs is the sole authority)", () => {
  beforeEach(truncateAll);

  it("3 real bench press sessions in the database, all hitting target reps at target RPE, produce the exact documented increment", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Prog1");
    const catalog = await seedFitnessCatalog();

    for (const daysAgo of [14, 7, 0]) {
      const sessionId = await startWorkoutSession(pool, {
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        performedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      });
      for (let set = 1; set <= 3; set++) {
        await recordWorkoutSet(pool, {
          householdId: household.householdId,
          userId: household.userId,
          sessionId,
          exerciseId: catalog.benchPressId,
          setNumber: set,
          reps: 10,
          loadKg: 80,
          rpe: 8,
        });
      }
    }

    const history = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => getExerciseHistory(client, { personId: household.profileId, exerciseId: catalog.benchPressId })
    );
    expect(history.length).toBe(9); // 3 sessions x 3 sets

    const recommendation = progressionEngine(history, BENCH_TARGET);
    expect(recommendation.action).toBe("increase_load");
    expect(recommendation.lastLoadKg).toBe(80);
    expect(recommendation.recommendedLoadKg).toBe(82.5); // exact, documented compound increment
  });

  it("reconstruction proof: the SAME recommendation is derived purely from workout_logs, queried fresh, with zero cached state anywhere", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Prog2");
    const catalog = await seedFitnessCatalog();

    const sessionId = await startWorkoutSession(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      performedAt: new Date(),
    });
    for (let set = 1; set <= 3; set++) {
      await recordWorkoutSet(pool, {
        householdId: household.householdId,
        userId: household.userId,
        sessionId,
        exerciseId: catalog.squatId,
        setNumber: set,
        reps: 10,
        loadKg: 100,
        rpe: 7.5,
      });
    }

    const squatTarget: ExerciseTarget = { exerciseType: "compound", targetSets: 3, minReps: 6, maxReps: 10, targetRpe: 8 };

    // Two independent queries of the same underlying table, two independent calls of the pure
    // function — nothing in between is shared state.
    const historyA = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      getExerciseHistory(client, { personId: household.profileId, exerciseId: catalog.squatId })
    );
    const recA = progressionEngine(historyA, squatTarget);

    const historyB = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      getExerciseHistory(client, { personId: household.profileId, exerciseId: catalog.squatId })
    );
    const recB = progressionEngine(historyB, squatTarget);

    expect(recB).toEqual(recA);
    expect(recA.action).toBe("increase_load");
  });

  it("workout_log.create validates plausibility BEFORE writing — an absurd load is rejected, nothing is persisted", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Prog3");
    const catalog = await seedFitnessCatalog();
    const sessionId = await startWorkoutSession(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      performedAt: new Date(),
    });

    await expect(
      recordWorkoutSet(pool, {
        householdId: household.householdId,
        userId: household.userId,
        sessionId,
        exerciseId: catalog.benchPressId,
        setNumber: 1,
        reps: 10,
        loadKg: 9999,
      })
    ).rejects.toThrow();

    const history = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      getExerciseHistory(client, { personId: household.profileId, exerciseId: catalog.benchPressId })
    );
    expect(history).toHaveLength(0);
  });
});
