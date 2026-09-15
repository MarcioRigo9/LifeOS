import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, createGoalFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";

describe("Household isolation (SEC-004, SEC-005)", () => {
  beforeEach(truncateAll);

  it("Household A cannot read Household B's goal by id, even with the exact id (SEC-004)", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "A");
    const householdB = await createHouseholdFixture(pool, "B");
    const goalB = await createGoalFixture(pool, householdB);

    const rowsSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT * FROM goals WHERE id = $1", [goalB.goalId])
    );

    // Not an error, not a leak — RLS makes the row simply not exist from A's point of view.
    // The API layer turns this empty result into a 404 (never a 403, SECURITY_MODEL.md §3.3).
    expect(rowsSeenByA.rowCount).toBe(0);
  });

  it("RLS blocks cross-household rows even when the application query has NO WHERE clause at all (SEC-005)", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "A2");
    const householdB = await createHouseholdFixture(pool, "B2");
    const goalA = await createGoalFixture(pool, householdA, { title: "Goal from A" });
    await createGoalFixture(pool, householdB, { title: "Goal from B" });

    const rowsSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      // Deliberately the "forgotten WHERE" scenario the task requires as a test.
      (client) => client.query("SELECT id, household_id FROM goals")
    );

    expect(rowsSeenByA.rows.map((r) => r.id)).toEqual([goalA.goalId]);
    expect(rowsSeenByA.rows.every((r) => r.household_id === householdA.householdId)).toBe(true);
  });

  it("Global/system-scoped tables (agents, skills) are readable regardless of household context — RLS is not misapplied to them (DATA_MODEL_REVIEW.md §1.1)", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "GlobalA");
    const householdB = await createHouseholdFixture(pool, "GlobalB");

    const agentsSeenByA = await withHouseholdContext(
      pool,
      { userId: householdA.userId, householdId: householdA.householdId },
      (client) => client.query("SELECT key FROM agents ORDER BY key")
    );
    const agentsSeenByB = await withHouseholdContext(
      pool,
      { userId: householdB.userId, householdId: householdB.householdId },
      (client) => client.query("SELECT key FROM agents ORDER BY key")
    );

    expect(agentsSeenByA.rows).toEqual(agentsSeenByB.rows);
    expect(agentsSeenByA.rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(["coordinator", "nutrition", "fitness", "finance"])
    );
  });

  it("Without any household context set at all, zero rows are visible (fail-closed)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "C");
    await createGoalFixture(pool, household);

    const rows = await withHouseholdContext(pool, { userId: household.userId }, (client) =>
      client.query("SELECT * FROM goals")
    );
    expect(rows.rowCount).toBe(0);
  });
});
