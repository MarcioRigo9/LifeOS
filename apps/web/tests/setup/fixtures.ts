import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { withHouseholdContext } from "@/lib/db/pool";
import { signupHousehold } from "@/lib/auth/signup";

export interface HouseholdFixture {
  householdId: string;
  userId: string;
  profileId: string;
}

let counter = 0;
function unique(prefix: string): string {
  counter++;
  return `${prefix}-${Date.now()}-${counter}-${randomUUID().slice(0, 8)}`;
}

export async function createHouseholdFixture(pool: Pool, label: string): Promise<HouseholdFixture> {
  return signupHousehold(pool, {
    householdName: `${label} household`,
    email: `${unique(label)}@example.com`,
    password: "correct horse battery staple",
    displayName: label,
  });
}

/** Adds a second profile (no login) to an existing household — e.g. Márcio's household also
 * has Brenda, both sharing household_id but with distinct person_id (DATA_MODEL_REVIEW §2.1). */
export async function addProfileToHousehold(pool: Pool, fixture: HouseholdFixture, displayName: string): Promise<string> {
  return withHouseholdContext(pool, { userId: fixture.userId, householdId: fixture.householdId }, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO profiles (household_id, display_name) VALUES ($1, $2) RETURNING id`,
      [fixture.householdId, displayName]
    );
    return res.rows[0].id;
  });
}

export async function createGoalFixture(
  pool: Pool,
  fixture: HouseholdFixture,
  overrides: Partial<{ title: string; targetValue: number }> = {}
): Promise<{ goalId: string; version: number }> {
  return withHouseholdContext(pool, { userId: fixture.userId, householdId: fixture.householdId }, async (client) => {
    const res = await client.query<{ id: string; version: number }>(
      `INSERT INTO goals (household_id, person_id, title, target_value, version)
       VALUES ($1, $2, $3, $4, 1) RETURNING id, version`,
      [fixture.householdId, fixture.profileId, overrides.title ?? "Perder peso", overrides.targetValue ?? 80]
    );
    return { goalId: res.rows[0].id, version: res.rows[0].version };
  });
}
