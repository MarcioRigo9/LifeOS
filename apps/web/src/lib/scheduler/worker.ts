import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { withHouseholdContext } from "@/lib/db/pool";
import { logAudit } from "@/lib/audit";
import { calculateNextRun } from "./cron";
import { RITUAL_KINDS } from "./jobs";
import { processWeeklyPlanningJob } from "./rituals/weeklyPlanning";
import { processShoppingPreparationJob } from "./rituals/shoppingPreparation";
import { processDailyCheckinJob } from "./rituals/dailyCheckin";
import { processSyncMarketPricesJob } from "./rituals/syncMarketPrices";
import type { RitualResult } from "./rituals/types";

const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_BATCH_SIZE = 20;
const MAX_BACKOFF_SECONDS = 3600;

export interface DueJobRef {
  scheduledJobId: string;
  householdId: string;
  ownerUserId: string;
}

/**
 * Cross-household discovery (read-only) — the ONLY place in the scheduler that needs to see
 * across households, because "which households have work due" is structurally a cross-household
 * question. Runs on the admin pool (never the runtime pool: RLS would hide every row from a
 * connection with no household context set), mirroring the existing precedent of
 * scripts/household-export.ts using DATABASE_URL_ADMIN for legitimate admin-level, non-request
 * cross-household operations (IMPLEMENTATION_RULES.md #13 restricts lifeos_admin only "at
 * request time" — this is a background daemon, not request-handling code). Every actual CLAIM,
 * mutation and business-logic call after this discovery step goes through the runtime pool +
 * withHouseholdContext (RLS enforced) — this function only ever reads.
 */
async function discoverJobs(adminPool: Pool, statusFilter: "due" | "expired_lease", limit: number): Promise<DueJobRef[]> {
  const whereClause =
    statusFilter === "due" ? "sj.status = 'pending' AND sj.next_run_at <= now()" : "sj.status = 'running' AND sj.lease_expires_at < now()";
  const res = await adminPool.query<{ id: string; household_id: string; owner_user_id: string }>(
    `SELECT sj.id, sj.household_id, hm.user_id AS owner_user_id
     FROM scheduled_jobs sj
     JOIN LATERAL (
       SELECT user_id FROM household_members
       WHERE household_id = sj.household_id AND removed_at IS NULL
       ORDER BY (role = 'owner') DESC, joined_at ASC
       LIMIT 1
     ) hm ON true
     WHERE ${whereClause}
     ORDER BY sj.next_run_at ASC
     LIMIT $1`,
    [limit]
  );
  return res.rows.map((r) => ({ scheduledJobId: r.id, householdId: r.household_id, ownerUserId: r.owner_user_id }));
}

export interface ClaimedJob {
  id: string;
  householdId: string;
  kind: string;
  cronExpr: string;
  timezone: string;
  attempts: number;
  maxAttempts: number;
  backoffBaseSeconds: number;
}

/**
 * Atomic claim (ADR 018): a single `UPDATE ... WHERE status='pending' AND next_run_at<=now()
 * RETURNING` — two workers racing for the same row will always see exactly one succeed (the
 * second's UPDATE matches zero rows once the first has committed the status flip, and Postgres's
 * row lock makes them serialize rather than both "succeeding"). Scoped to the household via
 * withHouseholdContext so RLS double-enforces the household boundary even though `ref` already
 * came from a household-specific discovery row.
 */
export async function claimScheduledJob(
  pool: Pool,
  ref: DueJobRef,
  workerId: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS
): Promise<ClaimedJob | null> {
  return withHouseholdContext(pool, { userId: ref.ownerUserId, householdId: ref.householdId }, async (client) => {
    const res = await client.query<{
      id: string;
      household_id: string;
      kind: string;
      cron_expr: string;
      timezone: string;
      attempts: number;
      max_attempts: number;
      backoff_base_seconds: number;
    }>(
      `UPDATE scheduled_jobs
       SET status = 'running', locked_by = $2, lease_expires_at = now() + make_interval(secs => $3)
       WHERE id = $1 AND household_id = $4 AND status = 'pending' AND next_run_at <= now()
       RETURNING id, household_id, kind, cron_expr, timezone, attempts, max_attempts, backoff_base_seconds`,
      [ref.scheduledJobId, workerId, leaseSeconds, ref.householdId]
    );
    if (res.rowCount === 0) return null; // lost the race, or already claimed/disabled/not due
    const row = res.rows[0];
    return {
      id: row.id,
      householdId: row.household_id,
      kind: row.kind,
      cronExpr: row.cron_expr,
      timezone: row.timezone,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      backoffBaseSeconds: row.backoff_base_seconds,
    };
  });
}

async function startJobRun(
  pool: Pool,
  params: { householdId: string; userId: string; scheduledJobId: string; attempt: number; requestId: string }
): Promise<string> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO job_runs (household_id, scheduled_job_id, status, attempt, request_id)
       VALUES ($1, $2, 'running', $3, $4) RETURNING id`,
      [params.householdId, params.scheduledJobId, params.attempt, params.requestId]
    );
    return res.rows[0].id;
  });
}

async function completeJobRun(
  pool: Pool,
  params: {
    householdId: string;
    userId: string;
    scheduledJobId: string;
    jobRunId: string;
    cronExpr: string;
    timezone: string;
    resultSummary: string;
  }
): Promise<void> {
  await withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const nextRunAt = calculateNextRun(params.cronExpr, params.timezone, new Date());
    // Recomputing next_run_at from NOW (not from the old next_run_at) is what gives catch-up
    // coalescing for free (ARCHITECTURE_REVIEW.md §7 scenario I): however many cron windows were
    // missed while the system was down, exactly one gets executed here, and rescheduling always
    // jumps to the next FUTURE occurrence — never replays the backlog.
    await client.query(
      `UPDATE scheduled_jobs
       SET status = 'pending', attempts = 0, last_run_at = now(), next_run_at = $2,
           lease_expires_at = NULL, locked_by = NULL
       WHERE id = $1 AND status = 'running'`,
      [params.scheduledJobId, nextRunAt]
    );
    await client.query(`UPDATE job_runs SET status = 'succeeded', finished_at = now(), result_summary = $2 WHERE id = $1`, [
      params.jobRunId,
      params.resultSummary,
    ]);
  });
}

/**
 * Shared failure transition for BOTH paths that can end a job's attempt badly: the worker's own
 * catch block (still holds the claim, no expiry check needed) and the reaper recovering an
 * abandoned lease (`requireExpiredLease: true` — only touches rows genuinely still expired,
 * avoiding a race with another reaper tick or a worker that finishes just in time). One atomic
 * UPDATE decides backoff vs dead_letter and clears the lease — no separate SELECT-then-UPDATE
 * that a concurrent process could interleave with.
 */
async function transitionJobOnFailure(
  client: PoolClient,
  params: { householdId: string; scheduledJobId: string; jobRunId: string | null; errorText: string; requireExpiredLease: boolean }
): Promise<{ deadLettered: boolean; newAttempts: number } | null> {
  const guard = params.requireExpiredLease ? "AND lease_expires_at < now()" : "";
  const res = await client.query<{ status: string; attempts: number }>(
    `UPDATE scheduled_jobs
     SET attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
         next_run_at = CASE WHEN attempts + 1 >= max_attempts THEN next_run_at
                            ELSE now() + make_interval(secs =>
                              LEAST(${MAX_BACKOFF_SECONDS}, (backoff_base_seconds * power(2::float, attempts::float)) + (random() * backoff_base_seconds))::int
                            ) END,
         lease_expires_at = NULL,
         locked_by = NULL
     WHERE id = $1 AND status = 'running' ${guard}
     RETURNING status, attempts`,
    [params.scheduledJobId]
  );
  if (res.rowCount === 0) return null; // already handled (raced with another reaper/worker)

  if (params.jobRunId) {
    await client.query(`UPDATE job_runs SET status = 'failed', finished_at = now(), error_text = $2 WHERE id = $1`, [
      params.jobRunId,
      params.errorText,
    ]);
  }

  const deadLettered = res.rows[0].status === "dead_letter";
  if (deadLettered) {
    await logAudit(client, {
      householdId: params.householdId,
      actorType: "system",
      eventType: "scheduled_job.dead_letter",
      entityType: "scheduled_jobs",
      entityId: params.scheduledJobId,
      reason: params.errorText,
    });
  }
  return { deadLettered, newAttempts: res.rows[0].attempts };
}

async function failJobRun(
  pool: Pool,
  params: { householdId: string; userId: string; scheduledJobId: string; jobRunId: string; errorText: string }
): Promise<{ deadLettered: boolean; newAttempts: number }> {
  const outcome = await withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, (client) =>
    transitionJobOnFailure(client, {
      householdId: params.householdId,
      scheduledJobId: params.scheduledJobId,
      jobRunId: params.jobRunId,
      errorText: params.errorText,
      requireExpiredLease: false,
    })
  );
  // This worker just claimed the row itself, so the guardless UPDATE cannot legitimately miss.
  if (!outcome) throw new Error(`failJobRun: scheduled_job ${params.scheduledJobId} was not in 'running' status`);
  return outcome;
}

/**
 * Recovers jobs whose worker crashed mid-execution (ARCHITECTURE_REVIEW.md §7 scenarios B/C):
 * lease expired while status was still 'running'. Requeues to 'pending' with attempts
 * incremented (same backoff/dead-letter rule as a normal failure) and marks the orphaned
 * job_runs row 'failed'. Discovery is cross-household (admin, read-only); the actual transition
 * is household-scoped and RLS-enforced, same posture as the claim path.
 */
export async function reapExpiredLeases(runtimePool: Pool, adminPool: Pool, opts: { limit?: number } = {}): Promise<{ reaped: number }> {
  const refs = await discoverJobs(adminPool, "expired_lease", opts.limit ?? DEFAULT_BATCH_SIZE);
  let reaped = 0;

  for (const ref of refs) {
    const result = await withHouseholdContext(runtimePool, { userId: ref.ownerUserId, householdId: ref.householdId }, async (client) => {
      const openRun = await client.query<{ id: string }>(
        `SELECT id FROM job_runs WHERE scheduled_job_id = $1 AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
        [ref.scheduledJobId]
      );
      return transitionJobOnFailure(client, {
        householdId: ref.householdId,
        scheduledJobId: ref.scheduledJobId,
        jobRunId: openRun.rows[0]?.id ?? null,
        errorText: "lease expired — worker crash detected by reaper",
        requireExpiredLease: true,
      });
    });
    if (result) reaped++;
  }

  return { reaped };
}

async function dispatchRitual(pool: Pool, kind: string, params: { householdId: string; userId: string }): Promise<RitualResult> {
  switch (kind) {
    case RITUAL_KINDS.WEEKLY_PLANNING:
      return processWeeklyPlanningJob(pool, params);
    case RITUAL_KINDS.SHOPPING_PREPARATION:
      return processShoppingPreparationJob(pool, params);
    case RITUAL_KINDS.DAILY_CHECKIN:
      return processDailyCheckinJob(pool, params);
    case RITUAL_KINDS.SYNC_MARKET_PRICES:
      return processSyncMarketPricesJob(pool, params);
    default:
      throw new Error(`unknown scheduled job kind: "${kind}"`);
  }
}

export interface SchedulerDeps {
  runtimePool: Pool;
  adminPool: Pool;
  workerId: string;
  leaseSeconds?: number;
  batchSize?: number;
}

export interface TickResult {
  reaped: number;
  claimed: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
}

/**
 * One polling cycle: reap abandoned leases first, then claim and process everything currently
 * due, up to `batchSize`. Safe to call concurrently from multiple worker processes/instances —
 * that's the entire point of the atomic claim (two ticks racing for the same row never both
 * "win").
 */
export async function runSchedulerTick(deps: SchedulerDeps): Promise<TickResult> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const { reaped } = await reapExpiredLeases(deps.runtimePool, deps.adminPool, { limit: batchSize });

  const due = await discoverJobs(deps.adminPool, "due", batchSize);
  let claimed = 0;
  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const ref of due) {
    const claim = await claimScheduledJob(deps.runtimePool, ref, deps.workerId, deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS);
    if (!claim) continue; // another worker won the race for this one
    claimed++;

    const requestId = randomUUID();
    const jobRunId = await startJobRun(deps.runtimePool, {
      householdId: claim.householdId,
      userId: ref.ownerUserId,
      scheduledJobId: claim.id,
      attempt: claim.attempts + 1,
      requestId,
    });

    try {
      const result = await dispatchRitual(deps.runtimePool, claim.kind, { householdId: claim.householdId, userId: ref.ownerUserId });
      await completeJobRun(deps.runtimePool, {
        householdId: claim.householdId,
        userId: ref.ownerUserId,
        scheduledJobId: claim.id,
        jobRunId,
        cronExpr: claim.cronExpr,
        timezone: claim.timezone,
        resultSummary: result.summary,
      });
      succeeded++;
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      const outcome = await failJobRun(deps.runtimePool, {
        householdId: claim.householdId,
        userId: ref.ownerUserId,
        scheduledJobId: claim.id,
        jobRunId,
        errorText,
      });
      failed++;
      if (outcome.deadLettered) deadLettered++;
    }
  }

  return { reaped, claimed, succeeded, failed, deadLettered };
}
