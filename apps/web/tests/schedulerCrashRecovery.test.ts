import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, getTestAdminPool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { reapExpiredLeases, claimScheduledJob } from "@/lib/scheduler/worker";

async function insertStuckRunningJob(
  pool: ReturnType<typeof getTestRuntimePool>,
  household: Awaited<ReturnType<typeof createHouseholdFixture>>,
  overrides: { attempts?: number; maxAttempts?: number } = {}
): Promise<{ scheduledJobId: string; jobRunId: string }> {
  return withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, async (client) => {
    // Simulates a job a worker claimed, then the worker's process died before finishing:
    // status='running', lease already expired, attempts still at its pre-crash value.
    const jobRes = await client.query<{ id: string }>(
      `INSERT INTO scheduled_jobs
         (household_id, kind, cron_expr, timezone, next_run_at, status, attempts, max_attempts,
          backoff_base_seconds, lease_expires_at, locked_by, idempotency_key)
       VALUES ($1, 'daily_checkin', '0 8 * * *', 'America/Sao_Paulo', now() - interval '10 minutes', 'running',
               $2, $3, 10, now() - interval '1 minute', 'dead-worker-abc', $4)
       RETURNING id`,
      [household.householdId, overrides.attempts ?? 0, overrides.maxAttempts ?? 5, `${household.householdId}:daily_checkin`]
    );
    const scheduledJobId = jobRes.rows[0].id;

    const runRes = await client.query<{ id: string }>(
      `INSERT INTO job_runs (household_id, scheduled_job_id, status, attempt, request_id, started_at)
       VALUES ($1, $2, 'running', $3, gen_random_uuid(), now() - interval '10 minutes')
       RETURNING id`,
      [household.householdId, scheduledJobId, (overrides.attempts ?? 0) + 1]
    );
    return { scheduledJobId, jobRunId: runRes.rows[0].id };
  });
}

describe("Crash recovery via lease expiry (ADR 018, ARCHITECTURE_REVIEW.md §7 scenarios B/C)", () => {
  beforeEach(truncateAll);

  it("a job stuck 'running' with an expired lease is reaped: requeued to pending with attempts incremented", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const household = await createHouseholdFixture(pool, "Reap1");
    const { scheduledJobId, jobRunId } = await insertStuckRunningJob(pool, household, { attempts: 0, maxAttempts: 5 });

    const { reaped } = await reapExpiredLeases(pool, adminPool);
    expect(reaped).toBeGreaterThanOrEqual(1);

    const jobRow = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, attempts, lease_expires_at, locked_by, next_run_at FROM scheduled_jobs WHERE id = $1", [scheduledJobId])
    );
    expect(jobRow.rows[0].status).toBe("pending");
    expect(jobRow.rows[0].attempts).toBe(1); // incremented by the reaper
    expect(jobRow.rows[0].lease_expires_at).toBeNull();
    expect(jobRow.rows[0].locked_by).toBeNull();
    expect(new Date(jobRow.rows[0].next_run_at).getTime()).toBeGreaterThan(Date.now()); // backoff pushed it into the future

    const runRow = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, error_text, finished_at FROM job_runs WHERE id = $1", [jobRunId])
    );
    expect(runRow.rows[0].status).toBe("failed");
    expect(runRow.rows[0].error_text).toMatch(/lease expired/i);
    expect(runRow.rows[0].finished_at).not.toBeNull();
  });

  it("another worker can claim the job again once it's back to pending and due", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const household = await createHouseholdFixture(pool, "Reap2");
    const { scheduledJobId } = await insertStuckRunningJob(pool, household, { attempts: 0, maxAttempts: 5 });

    await reapExpiredLeases(pool, adminPool);

    // The reaper pushed next_run_at into the future via backoff — fast-forward it back to "due
    // now" (a test-only shortcut, same pattern as Fase 4/5 tests directly flipping a status
    // column) to exercise the actual re-claim without a real sleep.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE scheduled_jobs SET next_run_at = now() - interval '1 second' WHERE id = $1", [scheduledJobId])
    );

    const claim = await claimScheduledJob(
      pool,
      { scheduledJobId, householdId: household.householdId, ownerUserId: household.userId },
      "worker-recovered"
    );
    expect(claim).not.toBeNull();
    expect(claim?.attempts).toBe(1); // reflects the reaper's increment
  });

  it("a job whose lease has NOT expired yet is left alone by the reaper", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const household = await createHouseholdFixture(pool, "Reap3");
    const scheduledJobId = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO scheduled_jobs (household_id, kind, cron_expr, timezone, next_run_at, status, lease_expires_at, locked_by, idempotency_key)
         VALUES ($1, 'daily_checkin', '0 8 * * *', 'America/Sao_Paulo', now(), 'running', now() + interval '5 minutes', 'live-worker', $2)
         RETURNING id`,
        [household.householdId, `${household.householdId}:daily_checkin`]
      );
      return res.rows[0].id;
    });

    const { reaped } = await reapExpiredLeases(pool, adminPool);
    expect(reaped).toBe(0);

    const row = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT status, locked_by FROM scheduled_jobs WHERE id = $1", [scheduledJobId])
    );
    expect(row.rows[0].status).toBe("running");
    expect(row.rows[0].locked_by).toBe("live-worker");
  });
});
