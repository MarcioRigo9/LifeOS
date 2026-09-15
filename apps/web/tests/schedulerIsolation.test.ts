import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, getTestAdminPool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { claimScheduledJob, runSchedulerTick } from "@/lib/scheduler/worker";

async function insertDueJob(pool: ReturnType<typeof getTestRuntimePool>, household: Awaited<ReturnType<typeof createHouseholdFixture>>) {
  return withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO scheduled_jobs (household_id, kind, cron_expr, timezone, next_run_at, status, idempotency_key)
       VALUES ($1, 'daily_checkin', '0 8 * * *', 'America/Sao_Paulo', now() - interval '1 minute', 'pending', $2)
       RETURNING id`,
      [household.householdId, `${household.householdId}:daily_checkin`]
    );
    return res.rows[0].id;
  });
}

describe("Cross-household isolation of the scheduler (Fase 6 §5, RLS enforced)", () => {
  beforeEach(truncateAll);

  it("Household A's session context cannot claim Household B's scheduled_job at all — RLS hides the row entirely", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "SchedIsoA");
    const householdB = await createHouseholdFixture(pool, "SchedIsoB");
    const jobB = await insertDueJob(pool, householdB);

    // A worker somehow holding Household A's context tries to claim what it believes is a due
    // job, but passes Household B's job id (e.g. a forged/stale reference) — RLS on
    // scheduled_jobs means the UPDATE...WHERE simply matches zero rows, not "wrong data".
    const claim = await claimScheduledJob(pool, { scheduledJobId: jobB, householdId: householdA.householdId, ownerUserId: householdA.userId }, "worker-cross");
    expect(claim).toBeNull();

    // Household B's job is untouched — still pending, unclaimed.
    const rowSeenByB = await withHouseholdContext(pool, { userId: householdB.userId, householdId: householdB.householdId }, (client) =>
      client.query("SELECT status, locked_by FROM scheduled_jobs WHERE id = $1", [jobB])
    );
    expect(rowSeenByB.rows[0].status).toBe("pending");
    expect(rowSeenByB.rows[0].locked_by).toBeNull();
  });

  it("Household A cannot read Household B's job_runs via its own session context", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const householdA = await createHouseholdFixture(pool, "SchedIsoC");
    const householdB = await createHouseholdFixture(pool, "SchedIsoD");
    await insertDueJob(pool, householdA);
    const jobB = await insertDueJob(pool, householdB);

    await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w-iso", batchSize: 10 });

    const runB = await withHouseholdContext(pool, { userId: householdB.userId, householdId: householdB.householdId }, (client) =>
      client.query("SELECT id FROM job_runs WHERE scheduled_job_id = $1", [jobB])
    );
    expect(runB.rows).toHaveLength(1);

    const runBSeenByA = await withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
      client.query("SELECT id FROM job_runs WHERE id = $1", [runB.rows[0].id])
    );
    expect(runBSeenByA.rowCount).toBe(0);
  });

  it("one scheduler tick processes BOTH households' due jobs independently, without cross-contamination", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const householdA = await createHouseholdFixture(pool, "SchedIsoE");
    const householdB = await createHouseholdFixture(pool, "SchedIsoF");
    const jobA = await insertDueJob(pool, householdA);
    const jobB = await insertDueJob(pool, householdB);

    const tick = await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w-both", batchSize: 10 });
    expect(tick.claimed).toBe(2);
    expect(tick.succeeded).toBe(2);

    const runA = await withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
      client.query("SELECT household_id FROM job_runs WHERE scheduled_job_id = $1", [jobA])
    );
    const runB = await withHouseholdContext(pool, { userId: householdB.userId, householdId: householdB.householdId }, (client) =>
      client.query("SELECT household_id FROM job_runs WHERE scheduled_job_id = $1", [jobB])
    );
    expect(runA.rows[0].household_id).toBe(householdA.householdId);
    expect(runB.rows[0].household_id).toBe(householdB.householdId);
  });
});
