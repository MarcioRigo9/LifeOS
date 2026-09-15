import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, getTestAdminPool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { claimScheduledJob } from "@/lib/scheduler/worker";

async function insertDueJob(
  pool: ReturnType<typeof getTestRuntimePool>,
  household: Awaited<ReturnType<typeof createHouseholdFixture>>,
  kind = "daily_checkin"
): Promise<string> {
  return withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO scheduled_jobs (household_id, kind, cron_expr, timezone, next_run_at, status, max_attempts, backoff_base_seconds, idempotency_key)
       VALUES ($1, $2, '0 8 * * *', 'America/Sao_Paulo', now() - interval '1 minute', 'pending', 5, 30, $3)
       RETURNING id`,
      [household.householdId, kind, `${household.householdId}:${kind}`]
    );
    return res.rows[0].id;
  });
}

describe("Atomic claim & concurrent workers (ADR 018, ARCHITECTURE_REVIEW.md §7 scenario A)", () => {
  beforeEach(truncateAll);

  it("two workers racing for the SAME due job: exactly one wins the claim", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "ClaimRace1");
    const scheduledJobId = await insertDueJob(pool, household);
    const ref = { scheduledJobId, householdId: household.householdId, ownerUserId: household.userId };

    const [claimA, claimB] = await Promise.all([
      claimScheduledJob(pool, ref, "worker-A"),
      claimScheduledJob(pool, ref, "worker-B"),
    ]);

    const winners = [claimA, claimB].filter((c) => c !== null);
    expect(winners).toHaveLength(1);

    const row = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT status, locked_by FROM scheduled_jobs WHERE id = $1", [scheduledJobId])
    );
    expect(row.rows[0].status).toBe("running");
    expect(["worker-A", "worker-B"]).toContain(row.rows[0].locked_by);
  });

  it("ten workers racing for the same job: still exactly one claim, no error from the other nine", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "ClaimRace2");
    const scheduledJobId = await insertDueJob(pool, household);
    const ref = { scheduledJobId, householdId: household.householdId, ownerUserId: household.userId };

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => claimScheduledJob(pool, ref, `worker-${i}`))
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("a job not yet due (next_run_at in the future) is never claimed", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "ClaimRace3");
    const scheduledJobId = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      async (client) => {
        const res = await client.query<{ id: string }>(
          `INSERT INTO scheduled_jobs (household_id, kind, cron_expr, timezone, next_run_at, status, idempotency_key)
           VALUES ($1, 'daily_checkin', '0 8 * * *', 'America/Sao_Paulo', now() + interval '1 hour', 'pending', $2)
           RETURNING id`,
          [household.householdId, `${household.householdId}:daily_checkin`]
        );
        return res.rows[0].id;
      }
    );

    const claim = await claimScheduledJob(
      pool,
      { scheduledJobId, householdId: household.householdId, ownerUserId: household.userId },
      "worker-early"
    );
    expect(claim).toBeNull();
  });

  it("a disabled job is never claimed even when next_run_at is due", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "ClaimRace4");
    const scheduledJobId = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      async (client) => {
        const res = await client.query<{ id: string }>(
          `INSERT INTO scheduled_jobs (household_id, kind, cron_expr, timezone, next_run_at, status, idempotency_key)
           VALUES ($1, 'daily_checkin', '0 8 * * *', 'America/Sao_Paulo', now() - interval '1 minute', 'disabled', $2)
           RETURNING id`,
          [household.householdId, `${household.householdId}:daily_checkin`]
        );
        return res.rows[0].id;
      }
    );

    const claim = await claimScheduledJob(
      pool,
      { scheduledJobId, householdId: household.householdId, ownerUserId: household.userId },
      "worker-x"
    );
    expect(claim).toBeNull();
  });

  it("getTestAdminPool connects and can read across the whole scheduled_jobs table", async () => {
    const adminPool = getTestAdminPool();
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "ClaimRace5");
    await insertDueJob(pool, household);

    const res = await adminPool.query("SELECT count(*) FROM scheduled_jobs WHERE household_id = $1", [household.householdId]);
    expect(Number(res.rows[0].count)).toBe(1);
  });
});
