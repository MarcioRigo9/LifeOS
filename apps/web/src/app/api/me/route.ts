import { NextResponse } from "next/server";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { resolveSession } from "@/lib/auth/session";

/**
 * Frontend bootstrap endpoint — resolves the session cookie into { userId, householdId,
 * profiles }. Unlike /api/coordinator etc., the household isn't supplied by the caller: this
 * app has exactly one household per user (couple-shared login, DATA_MODEL_REVIEW.md §2.1), so
 * this is the one place that looks it up from household_members rather than trusting a
 * client-supplied id.
 */
export async function GET(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie.match(/lifeos_session=([^;]+)/)?.[1];
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const pool = getRuntimePool();
  const session = await resolveSession(pool, token);
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // No household_id known yet — relies on household_members_self_visibility (0002_households_users.sql),
  // the same RLS bootstrap-exception policy resolveActiveHouseholdMembership (session.ts) uses:
  // "user_id = app_user_id()" works with only app.user_id set, before app.household_id exists.
  const membership = await withHouseholdContext(pool, { userId: session.userId }, (client) =>
    client.query<{ household_id: string }>(
      "SELECT household_id FROM household_members WHERE user_id = $1 AND removed_at IS NULL ORDER BY joined_at LIMIT 1",
      [session.userId]
    )
  );
  const householdId = membership.rows[0]?.household_id;
  if (!householdId) return NextResponse.json({ error: "no_household" }, { status: 404 });

  const profiles = await withHouseholdContext(pool, { userId: session.userId, householdId }, (client) =>
    client.query<{ id: string; display_name: string; user_id: string | null }>(
      "SELECT id, display_name, user_id FROM profiles WHERE household_id = $1 ORDER BY created_at",
      [householdId]
    )
  );

  return NextResponse.json({
    userId: session.userId,
    householdId,
    profiles: profiles.rows.map((r) => ({ id: r.id, displayName: r.display_name, isCurrentUser: r.user_id === session.userId })),
  });
}
