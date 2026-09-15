import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { hashPassword } from "./password";
import { logAudit } from "@/lib/audit";

export interface SignupParams {
  householdName: string;
  timezone?: string;
  locale?: string;
  currency?: string;
  email: string;
  password: string;
  displayName: string;
}

export interface SignupResult {
  householdId: string;
  userId: string;
  profileId: string;
}

/**
 * Creates a brand-new household + its first user + membership + profile + consent record in
 * one transaction. This is the one place where household_id is *chosen* rather than looked
 * up — generated client-side (here) and used as the RLS context from the very first INSERT,
 * so every row satisfies its policy naturally (DATA_MODEL_REVIEW.md §1.1, §2.1).
 */
export async function signupHousehold(pool: Pool, params: SignupParams): Promise<SignupResult> {
  const householdId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await hashPassword(params.password);

  return withHouseholdContext(pool, { userId, householdId }, async (client) => {
    await client.query(
      `INSERT INTO households (id, name, timezone, locale, currency) VALUES ($1, $2, $3, $4, $5)`,
      [householdId, params.householdName, params.timezone ?? "America/Sao_Paulo", params.locale ?? "pt-BR", params.currency ?? "BRL"]
    );

    await client.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, [
      userId,
      params.email,
      passwordHash,
    ]);

    await client.query(
      `INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [householdId, userId]
    );

    const profileRes = await client.query<{ id: string }>(
      `INSERT INTO profiles (household_id, user_id, display_name) VALUES ($1, $2, $3) RETURNING id`,
      [householdId, userId, params.displayName]
    );
    const profileId = profileRes.rows[0].id;

    await client.query(
      `INSERT INTO consents (household_id, user_id, purpose, policy_version) VALUES ($1, $2, 'account_creation', 'v1')`,
      [householdId, userId]
    );

    await logAudit(client, {
      householdId,
      actorType: "user",
      actorId: userId,
      eventType: "signup",
      entityType: "household",
      entityId: householdId,
    });

    return { householdId, userId, profileId };
  });
}
