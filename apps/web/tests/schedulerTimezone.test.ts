import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { ensureScheduledJob } from "@/lib/scheduler/jobs";

describe("Scheduled jobs respect households.timezone, never the worker's machine timezone (ADR 018)", () => {
  beforeEach(truncateAll);

  it("computes next_run_at for 09:00 using the household's OWN timezone, not the default", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "TzJob1");
    // America/Sao_Paulo is UTC-3 (no DST since 2019) — set explicitly so the test doesn't depend
    // on households' schema default.
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE households SET timezone = 'America/Sao_Paulo' WHERE id = $1", [household.householdId])
    );

    const jobId = await ensureScheduledJob(pool, {
      householdId: household.householdId,
      userId: household.userId,
      kind: "daily_checkin",
      cronExpr: "0 9 * * *",
    });

    const row = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT timezone, next_run_at FROM scheduled_jobs WHERE id = $1", [jobId])
    );
    expect(row.rows[0].timezone).toBe("America/Sao_Paulo");
    // Next 09:00 BRT is 12:00 UTC on whatever day it lands on.
    expect(new Date(row.rows[0].next_run_at).getUTCHours()).toBe(12);
    expect(new Date(row.rows[0].next_run_at).getUTCMinutes()).toBe(0);
  });

  it("a household in a different timezone gets a DIFFERENT UTC instant for the same 09:00 cron", async () => {
    const pool = getTestRuntimePool();
    const saoPaulo = await createHouseholdFixture(pool, "TzJob2");
    const tokyo = await createHouseholdFixture(pool, "TzJob3");

    await withHouseholdContext(pool, { userId: saoPaulo.userId, householdId: saoPaulo.householdId }, (client) =>
      client.query("UPDATE households SET timezone = 'America/Sao_Paulo' WHERE id = $1", [saoPaulo.householdId])
    );
    await withHouseholdContext(pool, { userId: tokyo.userId, householdId: tokyo.householdId }, (client) =>
      client.query("UPDATE households SET timezone = 'Asia/Tokyo' WHERE id = $1", [tokyo.householdId])
    );

    const jobSaoPauloId = await ensureScheduledJob(pool, {
      householdId: saoPaulo.householdId,
      userId: saoPaulo.userId,
      kind: "daily_checkin",
      cronExpr: "0 9 * * *",
    });
    const jobTokyoId = await ensureScheduledJob(pool, {
      householdId: tokyo.householdId,
      userId: tokyo.userId,
      kind: "daily_checkin",
      cronExpr: "0 9 * * *",
    });

    const rowSaoPaulo = await withHouseholdContext(pool, { userId: saoPaulo.userId, householdId: saoPaulo.householdId }, (client) =>
      client.query("SELECT next_run_at FROM scheduled_jobs WHERE id = $1", [jobSaoPauloId])
    );
    const rowTokyo = await withHouseholdContext(pool, { userId: tokyo.userId, householdId: tokyo.householdId }, (client) =>
      client.query("SELECT next_run_at FROM scheduled_jobs WHERE id = $1", [jobTokyoId])
    );

    expect(new Date(rowSaoPaulo.rows[0].next_run_at).getUTCHours()).toBe(12); // BRT = UTC-3
    expect(new Date(rowTokyo.rows[0].next_run_at).getUTCHours()).toBe(0); // JST = UTC+9
    expect(rowSaoPaulo.rows[0].next_run_at).not.toEqual(rowTokyo.rows[0].next_run_at);
  });

  it("ensureScheduledJob is idempotent by (household, kind) — calling it twice never creates a duplicate row", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "TzJob4");

    const firstId = await ensureScheduledJob(pool, {
      householdId: household.householdId,
      userId: household.userId,
      kind: "weekly_planning",
      cronExpr: "0 9 * * 6",
    });
    const secondId = await ensureScheduledJob(pool, {
      householdId: household.householdId,
      userId: household.userId,
      kind: "weekly_planning",
      cronExpr: "0 9 * * 6",
    });
    expect(secondId).toBe(firstId);

    const count = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT count(*) FROM scheduled_jobs WHERE household_id = $1", [household.householdId])
    );
    expect(Number(count.rows[0].count)).toBe(1);
  });
});
