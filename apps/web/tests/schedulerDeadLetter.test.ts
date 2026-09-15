import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { claimScheduledJob, runSchedulerTick } from "@/lib/scheduler/worker";
import { getTestAdminPool } from "./setup/testDb";

async function insertAlwaysFailingJob(
  pool: ReturnType<typeof getTestRuntimePool>,
  household: Awaited<ReturnType<typeof createHouseholdFixture>>
): Promise<string> {
  // kind='unknown_ritual_xyz' -> dispatchRitual() throws "unknown scheduled job kind", giving us
  // a deterministic failure on every attempt without needing to mock anything.
  return withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO scheduled_jobs
         (household_id, kind, cron_expr, timezone, next_run_at, status, max_attempts, backoff_base_seconds, idempotency_key)
       VALUES ($1, 'unknown_ritual_xyz', '0 8 * * *', 'America/Sao_Paulo', now() - interval '1 second', 'pending', 3, 10, $2)
       RETURNING id`,
      [household.householdId, `${household.householdId}:unknown_ritual_xyz`]
    );
    return res.rows[0].id;
  });
}

async function forceDueNow(pool: ReturnType<typeof getTestRuntimePool>, household: Awaited<ReturnType<typeof createHouseholdFixture>>, scheduledJobId: string) {
  await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
    client.query("UPDATE scheduled_jobs SET next_run_at = now() - interval '1 second' WHERE id = $1", [scheduledJobId])
  );
}

async function readJob(pool: ReturnType<typeof getTestRuntimePool>, household: Awaited<ReturnType<typeof createHouseholdFixture>>, scheduledJobId: string) {
  const row = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
    client.query("SELECT status, attempts, next_run_at FROM scheduled_jobs WHERE id = $1", [scheduledJobId])
  );
  return row.rows[0] as { status: string; attempts: number; next_run_at: string };
}

describe("Dead-letter & exponential backoff (ADR 018, ARCHITECTURE_REVIEW.md §7 scenario H)", () => {
  beforeEach(truncateAll);

  it("a job failing repeatedly gets an increasing gap between retries, then dead_letters after max_attempts", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const household = await createHouseholdFixture(pool, "DeadLetter1");
    const scheduledJobId = await insertAlwaysFailingJob(pool, household);

    // Attempt 1: fails, requeued with backoff.
    let tick = await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w1", batchSize: 10 });
    expect(tick.claimed).toBe(1);
    expect(tick.failed).toBe(1);
    expect(tick.deadLettered).toBe(0);
    let job = await readJob(pool, household, scheduledJobId);
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    const gap1Ms = new Date(job.next_run_at).getTime() - Date.now();
    expect(gap1Ms).toBeGreaterThan(0);

    await forceDueNow(pool, household, scheduledJobId);

    // Attempt 2: fails again, backoff gap should be noticeably larger than attempt 1's
    // (base=10s: attempt1 gap in [10,20)s, attempt2 gap in [20,30)s — ranges never overlap, so
    // this is deterministic despite the jitter).
    tick = await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w1", batchSize: 10 });
    expect(tick.failed).toBe(1);
    job = await readJob(pool, household, scheduledJobId);
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(2);
    const gap2Ms = new Date(job.next_run_at).getTime() - Date.now();
    expect(gap2Ms).toBeGreaterThan(gap1Ms);

    await forceDueNow(pool, household, scheduledJobId);

    // Attempt 3 == max_attempts: transitions to dead_letter, no further backoff scheduling.
    tick = await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w1", batchSize: 10 });
    expect(tick.failed).toBe(1);
    expect(tick.deadLettered).toBe(1);
    job = await readJob(pool, household, scheduledJobId);
    expect(job.status).toBe("dead_letter");
    expect(job.attempts).toBe(3);

    // A dead-lettered job is never claimed again, even if forced "due".
    await forceDueNow(pool, household, scheduledJobId);
    const claim = await claimScheduledJob(pool, { scheduledJobId, householdId: household.householdId, ownerUserId: household.userId }, "w2");
    expect(claim).toBeNull();

    // Audit trail records the dead-letter event.
    const auditRows = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT event_type, entity_id, reason FROM audit_log WHERE event_type = 'scheduled_job.dead_letter'")
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].entity_id).toBe(scheduledJobId);
  });

  it("every job_runs row for the failing job records an increasing attempt number and a failed status", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const household = await createHouseholdFixture(pool, "DeadLetter2");
    const scheduledJobId = await insertAlwaysFailingJob(pool, household);

    for (let i = 0; i < 3; i++) {
      await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w1", batchSize: 10 });
      await forceDueNow(pool, household, scheduledJobId);
    }

    const runs = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT attempt, status, error_text FROM job_runs WHERE scheduled_job_id = $1 ORDER BY attempt", [scheduledJobId])
    );
    expect(runs.rows.map((r) => r.attempt)).toEqual([1, 2, 3]);
    for (const r of runs.rows) {
      expect(r.status).toBe("failed");
      expect(r.error_text).toMatch(/unknown scheduled job kind/i);
    }
  });
});
