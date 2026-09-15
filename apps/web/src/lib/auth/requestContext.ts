import type { Pool } from "pg";
import { resolveSession, resolveActiveHouseholdMembership } from "./session";

export class UnauthenticatedError extends Error {}
export class ForbiddenHouseholdError extends Error {}

/**
 * SECURITY_MODEL.md §3 steps 1-2: resolve who the user is (session), then confirm the
 * requested household_member is still active — re-checked on every sensitive request, never
 * cached from a stale claim (SEC-006).
 */
export async function requireHouseholdContext(
  pool: Pool,
  sessionToken: string | undefined,
  requestedHouseholdId: string | undefined
): Promise<{ userId: string; householdId: string }> {
  if (!sessionToken) throw new UnauthenticatedError();
  const session = await resolveSession(pool, sessionToken);
  if (!session) throw new UnauthenticatedError();
  if (!requestedHouseholdId) throw new ForbiddenHouseholdError();

  const membership = await resolveActiveHouseholdMembership(pool, session.userId, requestedHouseholdId);
  if (!membership) throw new ForbiddenHouseholdError();

  return { userId: session.userId, householdId: membership.householdId };
}
