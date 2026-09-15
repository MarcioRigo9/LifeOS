import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordMeasurement, listMeasurements } from "@/lib/health/measurements";

describe("Measurements are append-only (DATA_MODEL_REVIEW.md §2.2)", () => {
  beforeEach(truncateAll);

  it("sequential inserts preserve chronology via taken_at regardless of insertion order", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Chrono");

    await recordMeasurement(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      takenAt: new Date("2026-02-01"),
      weightKg: 80,
    });
    await recordMeasurement(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      takenAt: new Date("2026-01-01"), // inserted second, but dated earlier
      weightKg: 82,
    });
    await recordMeasurement(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      takenAt: new Date("2026-03-01"),
      weightKg: 78,
    });

    const rows = await listMeasurements(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
    });

    // listMeasurements orders DESC by taken_at — chronology comes from the column, not
    // insertion order.
    expect(rows.map((r) => r.weightKg)).toEqual([78, 80, 82]);
  });

  it("the runtime role cannot UPDATE or DELETE a measurement — corrections must be new rows", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "AppendOnly");
    const measurement = await recordMeasurement(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
      takenAt: new Date("2026-01-01"),
      weightKg: 80,
    });

    // Postgres error 42501 = insufficient_privilege. Asserting on the SQL state code (not the
    // message text) keeps this test independent of the server's locale — this Postgres install
    // reports errors in Portuguese ("permissão negada"), not English.
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query("UPDATE measurements SET weight_kg = 999 WHERE id = $1", [measurement.id])
      )
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query("DELETE FROM measurements WHERE id = $1", [measurement.id])
      )
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("out-of-plausible-range values are rejected before any row is written (domain validation)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Implausible");

    await expect(
      recordMeasurement(pool, {
        householdId: household.householdId,
        userId: household.userId,
        personId: household.profileId,
        takenAt: new Date(),
        weightKg: 1000, // outside the domain-layer plausible range
      })
    ).rejects.toThrow(/plausible range/);

    const rows = await listMeasurements(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: household.profileId,
    });
    expect(rows).toHaveLength(0); // nothing was written
  });
});
