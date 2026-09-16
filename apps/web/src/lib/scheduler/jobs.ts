import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { calculateNextRun } from "./cron";

export const RITUAL_KINDS = {
  WEEKLY_PLANNING: "weekly_planning",
  SHOPPING_PREPARATION: "shopping_preparation",
  DAILY_CHECKIN: "daily_checkin",
  SYNC_MARKET_PRICES: "sync_market_prices",
} as const;

export type RitualKind = (typeof RITUAL_KINDS)[keyof typeof RITUAL_KINDS];

export interface EnsureScheduledJobParams {
  householdId: string;
  userId: string;
  kind: string;
  cronExpr: string;
  timezone?: string; // defaults to households.timezone (ADR 018 — never the worker's local tz)
  maxAttempts?: number;
  backoffBaseSeconds?: number;
}

/**
 * Idempotent by (household, kind) via `idempotency_key` (0007_scheduler_and_runs.sql's UNIQUE
 * index) — calling this twice for the same household+ritual never creates a duplicate recurring
 * job, it just updates the cron/timezone in place.
 */
export async function ensureScheduledJob(pool: Pool, params: EnsureScheduledJobParams): Promise<string> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    let timezone = params.timezone;
    if (!timezone) {
      const hh = await client.query<{ timezone: string }>("SELECT timezone FROM households WHERE id = $1", [params.householdId]);
      timezone = hh.rows[0]?.timezone ?? "America/Sao_Paulo";
    }
    const idempotencyKey = `${params.householdId}:${params.kind}`;
    const nextRunAt = calculateNextRun(params.cronExpr, timezone, new Date());

    const res = await client.query<{ id: string }>(
      `INSERT INTO scheduled_jobs
         (household_id, kind, cron_expr, timezone, next_run_at, status, max_attempts, backoff_base_seconds, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
       ON CONFLICT (idempotency_key) DO UPDATE SET cron_expr = EXCLUDED.cron_expr, timezone = EXCLUDED.timezone
       RETURNING id`,
      [
        params.householdId,
        params.kind,
        params.cronExpr,
        timezone,
        nextRunAt,
        params.maxAttempts ?? 5,
        params.backoffBaseSeconds ?? 30,
        idempotencyKey,
      ]
    );
    return res.rows[0].id;
  });
}

/** The four native rituals, wired to their default cron schedule — always evaluated in the
 * household's own timezone, never the worker's. sync_market_prices runs Saturday 23:00, after
 * Weekly Planning (09:00) settles the next week's plan and before Shopping Preparation
 * (Sunday 10:00) needs fresh prices to cost it against. */
export async function ensureDefaultRituals(pool: Pool, params: { householdId: string; userId: string }): Promise<void> {
  await ensureScheduledJob(pool, { ...params, kind: RITUAL_KINDS.WEEKLY_PLANNING, cronExpr: "0 9 * * 6" }); // Saturday 09:00
  await ensureScheduledJob(pool, { ...params, kind: RITUAL_KINDS.SYNC_MARKET_PRICES, cronExpr: "0 23 * * 6" }); // Saturday 23:00
  await ensureScheduledJob(pool, { ...params, kind: RITUAL_KINDS.SHOPPING_PREPARATION, cronExpr: "0 10 * * 0" }); // Sunday 10:00
  await ensureScheduledJob(pool, { ...params, kind: RITUAL_KINDS.DAILY_CHECKIN, cronExpr: "0 8 * * *" }); // daily 08:00
}
