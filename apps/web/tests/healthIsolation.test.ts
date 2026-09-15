import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { recordMeasurement, listMeasurements } from "@/lib/health/measurements";

describe("Health data cross-household isolation", () => {
  beforeEach(truncateAll);

  it("Household A cannot read Household B's measurement via the service layer", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "HA");
    const householdB = await createHouseholdFixture(pool, "HB");

    await recordMeasurement(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      personId: householdB.profileId,
      takenAt: new Date("2026-01-01"),
      weightKg: 70,
    });

    // A queries for its own household, asking for B's person_id explicitly — the household
    // filter alone (not just person_id) must be what keeps this at zero.
    const seenByA = await listMeasurements(pool, {
      householdId: householdA.householdId,
      userId: householdA.userId,
      personId: householdB.profileId,
    });
    expect(seenByA).toHaveLength(0);
  });

  it("Household A cannot INSERT a measurement into Household B (RLS WITH CHECK, not just SELECT)", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "HA2");
    const householdB = await createHouseholdFixture(pool, "HB2");

    // Attempt, under A's household context, to directly insert a row tagged with B's
    // household_id — RLS's WITH CHECK clause must reject this at the database level.
    await expect(
      withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
        client.query(
          `INSERT INTO measurements (household_id, person_id, taken_at, weight_kg)
           VALUES ($1, $2, now(), 70)`,
          [householdB.householdId, householdB.profileId]
        )
      )
    ).rejects.toThrow();
  });

  it("RLS blocks cross-household measurement rows even with a query that has NO WHERE clause at all", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "HA3");
    const householdB = await createHouseholdFixture(pool, "HB3");

    await recordMeasurement(pool, {
      householdId: householdA.householdId,
      userId: householdA.userId,
      personId: householdA.profileId,
      takenAt: new Date("2026-01-01"),
      weightKg: 65,
    });
    await recordMeasurement(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      personId: householdB.profileId,
      takenAt: new Date("2026-01-01"),
      weightKg: 90,
    });

    const rows = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT weight_kg, household_id FROM measurements")
    );
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].weight_kg)).toBe(65);
    expect(rows.rows[0].household_id).toBe(householdA.householdId);
  });
});
