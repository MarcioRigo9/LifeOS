import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { startWorkoutSession, recordWorkoutSet, completeWorkoutSession } from "@/lib/fitness/workoutSessions";

describe("Fitness history is append-only (DATA_MODEL_REVIEW.md §2.4)", () => {
  beforeEach(truncateAll);

  it("the runtime role cannot UPDATE or DELETE a workout_log row — corrections are new rows", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "AppendFit1");
    const catalog = await seedFitnessCatalog();
    const sessionId = await startWorkoutSession(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      performedAt: new Date(),
    });
    await recordWorkoutSet(pool, {
      householdId: household.householdId,
      userId: household.userId,
      sessionId,
      exerciseId: catalog.benchPressId,
      setNumber: 1,
      reps: 10,
      loadKg: 80,
    });

    // Postgres 42501 = insufficient_privilege — locale-independent (SECURITY_MODEL server runs
    // in pt-BR; see the Fase 2 healthAppendOnly.test.ts fix for why we assert on the code).
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query("UPDATE workout_logs SET load_kg = 999 WHERE workout_session_id = $1", [sessionId])
      )
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query("DELETE FROM workout_logs WHERE workout_session_id = $1", [sessionId])
      )
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a workout_session cannot be mutated once concluded (completed) — database trigger enforced", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "AppendFit2");
    const sessionId = await startWorkoutSession(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      performedAt: new Date(),
    });

    // Mutations are fine WHILE in_progress.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE workout_sessions SET notes = 'treino leve hoje' WHERE id = $1", [sessionId])
    );

    await completeWorkoutSession(pool, { householdId: household.householdId, userId: household.userId, sessionId, durationMinutes: 45 });

    // Any further mutation — even an innocuous one — is rejected once concluded.
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query("UPDATE workout_sessions SET notes = 'tentando editar depois' WHERE id = $1", [sessionId])
      )
    ).rejects.toThrow(/append-only/i);
  });
});
