import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { resolveActiveHouseholdMembership } from "@/lib/auth/session";

describe("Removed household member is rejected on the next request (SEC-006)", () => {
  beforeEach(truncateAll);

  it("active member resolves successfully, then fails immediately after removal", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "D");

    const before = await resolveActiveHouseholdMembership(pool, household.userId, household.householdId);
    expect(before).not.toBeNull();
    expect(before?.role).toBe("owner");

    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE household_members SET removed_at = now() WHERE user_id = $1 AND household_id = $2", [
        household.userId,
        household.householdId,
      ])
    );

    const after = await resolveActiveHouseholdMembership(pool, household.userId, household.householdId);
    expect(after).toBeNull(); // no TTL to wait for — every request re-checks, this call IS "the next request"
  });
});
