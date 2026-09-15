import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, createGoalFixture } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";

describe("Optimistic concurrency on versioned entities (DATA-005, ADR 017)", () => {
  beforeEach(truncateAll);

  it("two concurrent updates to the same goal: the second one conflicts and does not silently overwrite", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "H");
    const goal = await createGoalFixture(pool, household, { targetValue: 80 });

    const updateWithExpectedVersion = (newValue: number, expectedVersion: number) =>
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query(
          "UPDATE goals SET target_value = $1, version = version + 1 WHERE id = $2 AND version = $3 RETURNING version",
          [newValue, goal.goalId, expectedVersion]
        )
      );

    // Both "read" version 1 concurrently, then both try to write based on that stale read.
    const first = await updateWithExpectedVersion(70, 1);
    expect(first.rowCount).toBe(1);
    expect(first.rows[0].version).toBe(2);

    // Second attempt still thinks the version is 1 — must conflict, not overwrite.
    const second = await updateWithExpectedVersion(65, 1);
    expect(second.rowCount).toBe(0); // explicit conflict signal, never a silent overwrite

    const final = await withHouseholdContext(
      pool,
      { userId: household.userId, householdId: household.householdId },
      (client) => client.query("SELECT target_value, version FROM goals WHERE id = $1", [goal.goalId])
    );
    expect(final.rows[0].target_value).toBe("70"); // first writer's value survives
    expect(final.rows[0].version).toBe(2);
  });
});
