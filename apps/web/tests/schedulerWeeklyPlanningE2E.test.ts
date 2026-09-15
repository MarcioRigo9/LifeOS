import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, getTestAdminPool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { createBasicMealSet } from "./setup/nutritionFixtures";
import { seedFitnessCatalog } from "./setup/fitnessFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordMeasurement } from "@/lib/health/measurements";
import { ensureScheduledJob } from "@/lib/scheduler/jobs";
import { runSchedulerTick } from "@/lib/scheduler/worker";

async function completeProfile(pool: ReturnType<typeof getTestRuntimePool>, household: Awaited<ReturnType<typeof createHouseholdFixture>>) {
  await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
    client.query(
      `UPDATE profiles SET birth_date = '1990-01-01', sex = 'male', height_cm = 178,
       activity_level = 'moderate', nutrition_goal = 'maintain' WHERE id = $1`,
      [household.profileId]
    )
  );
  await recordMeasurement(pool, {
    householdId: household.householdId,
    userId: household.userId,
    personId: household.profileId,
    takenAt: new Date(),
    weightKg: 82,
  });
}

describe("Weekly Planning end-to-end via the scheduler — autonomy WITH human-in-the-loop (Fase 6 §5)", () => {
  beforeEach(truncateAll);

  it("the scheduler runs the Weekly Review autonomously, but the resulting plan stays PENDING — never auto-approved", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const household = await createHouseholdFixture(pool, "SchedWeekly1");
    await createBasicMealSet(pool, household);
    await seedFitnessCatalog();
    await completeProfile(pool, household);

    const scheduledJobId = await ensureScheduledJob(pool, {
      householdId: household.householdId,
      userId: household.userId,
      kind: "weekly_planning",
      cronExpr: "0 9 * * 6",
    });
    // Force it due now rather than waiting for an actual Saturday 09:00.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE scheduled_jobs SET next_run_at = now() - interval '1 second' WHERE id = $1", [scheduledJobId])
    );

    const tick = await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w-e2e", batchSize: 10 });
    expect(tick.claimed).toBe(1);
    expect(tick.succeeded).toBe(1);
    expect(tick.failed).toBe(0);

    // The job itself completed successfully and rescheduled ~1 week out — no residual lock.
    const jobRow = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT status, last_run_at, lease_expires_at, locked_by, next_run_at FROM scheduled_jobs WHERE id = $1", [scheduledJobId])
    );
    expect(jobRow.rows[0].status).toBe("pending");
    expect(jobRow.rows[0].locked_by).toBeNull();
    expect(jobRow.rows[0].lease_expires_at).toBeNull();
    expect(jobRow.rows[0].last_run_at).not.toBeNull();
    const nextRunGapDays = (new Date(jobRow.rows[0].next_run_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(nextRunGapDays).toBeGreaterThan(0.5); // rescheduled roughly a week out, not immediately

    // The Weekly Review artifact was produced...
    const reviews = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT id, decision_id FROM weekly_reviews WHERE household_id = $1", [household.householdId])
    );
    expect(reviews.rows).toHaveLength(1);
    expect(reviews.rows[0].decision_id).toBeTruthy();

    // ...and its composite next-week proposal is PENDING, waiting for a human — never
    // auto-approved or auto-executed by the scheduler itself.
    const decision = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT status, risk_level, approved_by FROM agent_decisions WHERE id = $1", [reviews.rows[0].decision_id])
    );
    expect(decision.rows[0].status).toBe("PENDING");
    expect(decision.rows[0].risk_level).toBe("medium");
    expect(decision.rows[0].approved_by).toBeNull();

    // The generated next-week meal/workout plans exist but are still drafts, not active.
    const mealPlans = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT status FROM meal_plans WHERE household_id = $1", [household.householdId])
    );
    expect(mealPlans.rows.every((r) => r.status === "draft")).toBe(true);

    // The job_run itself recorded success with a human-readable summary mentioning the pending proposal.
    const runRow = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT status, result_summary FROM job_runs WHERE scheduled_job_id = $1", [scheduledJobId])
    );
    expect(runRow.rows[0].status).toBe("succeeded");
    expect(runRow.rows[0].result_summary).toMatch(/PENDING/);
  });

  it("a household with incomplete profile data still succeeds (no proposal, no crash) — never invents missing data", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const household = await createHouseholdFixture(pool, "SchedWeekly2");
    // Deliberately incomplete: no meals, no fitness catalog interaction, no biometrics.

    const scheduledJobId = await ensureScheduledJob(pool, {
      householdId: household.householdId,
      userId: household.userId,
      kind: "weekly_planning",
      cronExpr: "0 9 * * 6",
    });
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE scheduled_jobs SET next_run_at = now() - interval '1 second' WHERE id = $1", [scheduledJobId])
    );

    const tick = await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w-e2e2", batchSize: 10 });
    expect(tick.succeeded).toBe(1);
    expect(tick.failed).toBe(0);

    const decisions = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT count(*) FROM agent_decisions")
    );
    expect(Number(decisions.rows[0].count)).toBe(0);
  });
});
