import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";

const querySchema = z.object({ householdId: z.string().uuid() });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const result = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const reviewRes = await client.query(
        "SELECT id, week_start_date, report_json, decision_id, generated_at FROM weekly_reviews WHERE household_id = $1 ORDER BY generated_at DESC LIMIT 1",
        [householdId]
      );
      const review = reviewRes.rows[0] ?? null;
      if (!review) return { review: null, decision: null };

      const decision = review.decision_id
        ? await client.query(
            `SELECT d.id, d.status, d.risk_level, d.proposal_hash, d.expires_at, d.created_at, d.action_envelope_json, a.display_name AS agent_name, a.key AS agent_key
             FROM agent_decisions d JOIN agents a ON a.id = d.agent_id WHERE d.id = $1`,
            [review.decision_id]
          )
        : { rows: [] as Record<string, unknown>[] };

      return { review, decision: decision.rows[0] ?? null };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
