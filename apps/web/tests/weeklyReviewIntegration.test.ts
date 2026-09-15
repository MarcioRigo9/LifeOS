import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { createBasicMealSet } from "./setup/nutritionFixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordMeasurement } from "@/lib/health/measurements";
import { generateWeeklyWorkoutPlan } from "@/lib/fitness/workoutPlans";
import { startWorkoutSession, recordWorkoutSet, completeWorkoutSession } from "@/lib/fitness/workoutSessions";
import { createHabit, logHabitCompletion } from "@/lib/habits";
import { runWeeklyReview } from "@/lib/agents/weeklyReview";

async function completeProfile(pool: ReturnType<typeof getTestRuntimePool>, household: Awaited<ReturnType<typeof createHouseholdFixture>>) {
  await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
    client.query(
      `UPDATE profiles SET birth_date = '1990-01-01', sex = 'female', height_cm = 165,
       activity_level = 'moderate', nutrition_goal = 'lose_weight' WHERE id = $1`,
      [household.profileId]
    )
  );
}

describe("Integrated Weekly Review (Fase 5 §2.2)", () => {
  beforeEach(truncateAll);

  it("consolidates a week of measurements, workouts and habits into one report and proposes a next-week plan package", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "WeeklyReview1");
    await createBasicMealSet(pool, household);
    const catalog = await seedFitnessCatalog();
    await completeProfile(pool, household);

    const weekStart = new Date("2026-02-02T00:00:00.000Z"); // Monday

    // 3 weigh-ins this week.
    for (const [day, weightKg] of [["02", 90], ["04", 89.5], ["06", 89]] as const) {
      await recordMeasurement(pool, {
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        takenAt: new Date(`2026-02-${day}T08:00:00.000Z`),
        weightKg,
      });
    }

    // An ACTIVE workout plan (3 training days/week) so adherence has a baseline to compare
    // against — activated directly here since the approval flow itself is covered elsewhere
    // (compositeProposalRisk.test.ts, workoutPolicyEngine.test.ts).
    const [plan] = await generateWeeklyWorkoutPlan(pool, {
      householdId: household.householdId,
      userId: household.userId,
      weekStartDate: new Date("2026-01-26"),
      people: [{ personId: household.profileId, bodyweightKg: 90, goal: "lose_weight" }],
    });
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE workout_plans SET status = 'active' WHERE id = $1", [plan.workoutPlanId])
    );

    // 4 completed workouts this week (plan only expects 3/week).
    for (const day of ["03", "04", "05", "07"]) {
      const sessionId = await startWorkoutSession(pool, {
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        performedAt: new Date(`2026-02-${day}T18:00:00.000Z`),
      });
      await recordWorkoutSet(pool, {
        householdId: household.householdId,
        userId: household.userId,
        sessionId,
        exerciseId: catalog.benchPressId,
        setNumber: 1,
        reps: 10,
        loadKg: 60,
      });
      await completeWorkoutSession(pool, { householdId: household.householdId, userId: household.userId, sessionId });
    }

    // 1 habit, logged every day — 6 completed, 1 failed.
    const habitId = await createHabit(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      title: "Beber 2L de água",
      frequency: "daily",
    });
    for (const [day, completed] of [
      ["02", true], ["03", true], ["04", true], ["05", false], ["06", true], ["07", true], ["08", true],
    ] as const) {
      await logHabitCompletion(pool, {
        householdId: household.householdId,
        userId: household.userId,
        habitId,
        personId: household.profileId,
        loggedDate: new Date(`2026-02-${day}`),
        completed,
      });
    }

    const result = await runWeeklyReview(pool, { householdId: household.householdId, userId: household.userId, weekStartDate: weekStart });

    expect(result.report.weekStartDate).toBe("2026-02-02");
    expect(result.report.people).toHaveLength(1);
    const personReport = result.report.people[0];
    expect(personReport.weighIns.count).toBe(3);
    expect(personReport.weighIns.trend?.direction).toBe("losing");
    expect(personReport.training?.completedSessions).toBe(4);
    expect(personReport.training?.plannedSessionsPerWeek).toBe(3);

    expect(result.report.habits).toHaveLength(1);
    expect(result.report.habits[0].totalLogged).toBe(7);
    expect(result.report.habits[0].completedCount).toBe(6);
    expect(result.report.habits[0].missedCount).toBe(1);

    expect(result.report.deviations.some((d) => /água/i.test(d))).toBe(true);

    // A correctly structured next-week proposal package, PENDING human approval.
    expect(result.proposal).not.toBeNull();
    if (result.proposal?.outcome !== "proposed") throw new Error("expected a proposed composite decision");
    expect(result.proposal.riskLevel).toBe("medium");
    const decisionId = result.proposal.decisionId;

    const decisionRow = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, risk_level FROM agent_decisions WHERE id = $1", [decisionId])
    );
    expect(decisionRow.rows[0].status).toBe("PENDING");
    expect(decisionRow.rows[0].risk_level).toBe("medium");

    // The review itself is persisted as its own artifact.
    const reviewRow = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT week_start_date, decision_id FROM weekly_reviews WHERE id = $1", [result.weeklyReviewId])
    );
    expect(reviewRow.rows).toHaveLength(1);
    expect(reviewRow.rows[0].decision_id).toBeTruthy();

    // Session memory & synthesis (§2.4).
    const memories = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT type, confidence, source_type FROM agent_memories WHERE household_id = $1 ORDER BY type", [household.householdId])
    );
    const types = memories.rows.map((r) => r.type);
    expect(types).toContain("decision");
    expect(types).toContain("learned_pattern");
    const learnedRow = memories.rows.find((r) => r.type === "learned_pattern")!;
    expect(Number(learnedRow.confidence)).toBeLessThan(1.0);
    expect(learnedRow.source_type).toBe("agent_inferred");

    // A next-week draft plan package exists (not yet activated).
    const nextWeekMealPlans = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, week_start_date FROM meal_plans WHERE household_id = $1", [household.householdId])
    );
    expect(nextWeekMealPlans.rows).toHaveLength(1);
    expect(nextWeekMealPlans.rows[0].status).toBe("draft");
  });
});
