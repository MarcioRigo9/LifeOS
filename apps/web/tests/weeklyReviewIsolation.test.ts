import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordMeasurement } from "@/lib/health/measurements";
import { createHabit, logHabitCompletion } from "@/lib/habits";
import { runWeeklyReview } from "@/lib/agents/weeklyReview";

describe("Cross-household isolation of the Weekly Review (Fase 5 non-negotiable rule)", () => {
  beforeEach(truncateAll);

  it("Household A's Weekly Review never reads or aggregates Household B's measurements/habits/history", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "ReviewIsoA");
    const householdB = await createHouseholdFixture(pool, "ReviewIsoB");

    const weekStart = new Date("2026-03-02T00:00:00.000Z"); // Monday

    // Household A: 1 weigh-in this week, no habits.
    await recordMeasurement(pool, {
      householdId: householdA.householdId,
      userId: householdA.userId,
      personId: householdA.profileId,
      takenAt: new Date("2026-03-03T08:00:00.000Z"),
      weightKg: 75,
    });

    // Household B: 2 weigh-ins this week and a logged habit — deliberately more data than A, so
    // any leakage into A's report would be immediately visible as a count mismatch.
    await recordMeasurement(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      personId: householdB.profileId,
      takenAt: new Date("2026-03-03T08:00:00.000Z"),
      weightKg: 95,
    });
    await recordMeasurement(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      personId: householdB.profileId,
      takenAt: new Date("2026-03-05T08:00:00.000Z"),
      weightKg: 94.5,
    });
    const habitB = await createHabit(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      personId: householdB.profileId,
      title: "Household B's private habit",
    });
    await logHabitCompletion(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      habitId: habitB,
      personId: householdB.profileId,
      loggedDate: new Date("2026-03-03"),
      completed: true,
    });

    const reviewA = await runWeeklyReview(pool, { householdId: householdA.householdId, userId: householdA.userId, weekStartDate: weekStart });
    const reviewB = await runWeeklyReview(pool, { householdId: householdB.householdId, userId: householdB.userId, weekStartDate: weekStart });

    expect(reviewA.report.people).toHaveLength(1);
    expect(reviewA.report.people[0].weighIns.count).toBe(1); // only A's own weigh-in
    expect(reviewA.report.habits).toHaveLength(0); // never sees B's habit

    expect(reviewB.report.people).toHaveLength(1);
    expect(reviewB.report.people[0].weighIns.count).toBe(2);
    expect(reviewB.report.habits).toHaveLength(1);

    // RLS: Household A's own session context cannot read Household B's persisted review row.
    const seenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM weekly_reviews WHERE id = $1", [reviewB.weeklyReviewId])
    );
    expect(seenByA.rowCount).toBe(0);

    const seenByAOwn = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT id FROM weekly_reviews WHERE id = $1", [reviewA.weeklyReviewId])
    );
    expect(seenByAOwn.rowCount).toBe(1);

    // Same isolation for the agent_memories written by each review: each household's own
    // context sees only its own rows, never the other's, even though both were just written.
    const memoriesSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT count(*) FROM agent_memories")
    );
    const memoriesTotalAcrossBoth = await withHouseholdContext(pool, { userId: householdB.userId }, (client) =>
      client.query("SELECT count(*) FROM agent_memories") // no household_id set -> RLS default-denies everything
    );
    expect(Number(memoriesSeenByA.rows[0].count)).toBeGreaterThan(0);
    expect(Number(memoriesTotalAcrossBoth.rows[0].count)).toBe(0);
  });
});
