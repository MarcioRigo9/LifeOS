import { randomBytes, createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withoutContext, withHouseholdContext } from "@/lib/db/pool";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 12-24h per SECURITY_MODEL.md §2

export interface CreatedSession {
  token: string; // raw token — goes in the cookie, never stored
  sessionId: string;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(pool: Pool, userId: string): Promise<CreatedSession> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const sessionId = await withoutContext(pool, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
      [userId, tokenHash, expiresAt]
    );
    return res.rows[0].id;
  });

  return { token, sessionId, expiresAt };
}

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
}

/** Step 1 of SECURITY_MODEL.md §3 layered model: "quem é o usuário". No household context yet. */
export async function resolveSession(pool: Pool, rawToken: string): Promise<AuthenticatedSession | null> {
  const tokenHash = hashToken(rawToken);
  return withoutContext(pool, async (client) => {
    const res = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [tokenHash]
    );
    if (res.rowCount === 0) return null;
    return { sessionId: res.rows[0].id, userId: res.rows[0].user_id };
  });
}

export async function revokeSession(pool: Pool, rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await withoutContext(pool, (client) =>
    client.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, [tokenHash])
  );
}

/**
 * Step 2 of SECURITY_MODEL.md §3: "Resolução de household_member ATIVO" — confirms the
 * membership is still active (not removed) EVERY time, never trusting a stale claim
 * (SEC-006 / SECURITY_MODEL.md §2). Uses the household_members_self_visibility RLS policy,
 * which is why this can run with app.user_id set but no app.household_id yet.
 */
export async function resolveActiveHouseholdMembership(
  pool: Pool,
  userId: string,
  requestedHouseholdId: string
): Promise<{ householdId: string; personProfileId: string | null; role: string } | null> {
  return withHouseholdContext(pool, { userId }, async (client) => {
    const res = await client.query<{ household_id: string; role: string }>(
      `SELECT household_id, role FROM household_members
       WHERE user_id = $1 AND household_id = $2 AND removed_at IS NULL`,
      [userId, requestedHouseholdId]
    );
    if (res.rowCount === 0) return null;
    return { householdId: res.rows[0].household_id, personProfileId: null, role: res.rows[0].role };
  });
}

export function newRequestId(): string {
  return randomUUID();
}
