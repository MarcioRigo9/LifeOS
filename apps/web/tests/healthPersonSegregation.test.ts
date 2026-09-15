import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, addProfileToHousehold } from "./setup/fixtures";
import { recordMeasurement, listMeasurements } from "@/lib/health/measurements";

describe("Health data segregation by person within the same household", () => {
  beforeEach(truncateAll);

  it("Márcio's and Brenda's measurements don't mix in person-filtered listings, but both are reachable within the household", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "Casal");
    const marcioId = household.profileId; // the signup flow's own profile
    const brendaId = await addProfileToHousehold(pool, household, "Brenda");

    await recordMeasurement(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: marcioId,
      takenAt: new Date("2026-01-01"),
      weightKg: 85,
    });
    await recordMeasurement(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: marcioId,
      takenAt: new Date("2026-01-08"),
      weightKg: 84,
    });
    await recordMeasurement(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: brendaId,
      takenAt: new Date("2026-01-01"),
      weightKg: 62,
    });

    const marcioMeasurements = await listMeasurements(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: marcioId,
    });
    const brendaMeasurements = await listMeasurements(pool, {
      householdId: household.householdId,
      userId: household.userId,
      personId: brendaId,
    });

    expect(marcioMeasurements).toHaveLength(2);
    expect(marcioMeasurements.every((m) => m.personId === marcioId)).toBe(true);
    expect(brendaMeasurements).toHaveLength(1);
    expect(brendaMeasurements[0].personId).toBe(brendaId);
    expect(brendaMeasurements[0].weightKg).toBe(62);

    // Same household, same authenticated user context — access to BOTH people is authorized
    // (this is not a cross-household case, so the household-level auth check should pass for
    // either personId; only the person_id filter distinguishes the two listings).
    expect(marcioMeasurements.map((m) => m.weightKg).sort()).toEqual([84, 85]);
  });
});
