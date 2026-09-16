import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";

const querySchema = z.object({
  householdId: z.string().uuid(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "EXECUTING", "EXECUTED", "FAILED"]).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId"), status: url.searchParams.get("status") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const rows = await withHouseholdContext(getRuntimePool(), { userId, householdId }, (client) =>
      client.query(
        `SELECT d.id, d.risk_level, d.status, d.proposal_hash, d.expires_at, d.created_at, d.approved_at,
                d.action_envelope_json, a.key AS agent_key, a.display_name AS agent_name
         FROM agent_decisions d JOIN agents a ON a.id = d.agent_id
         WHERE d.household_id = $1 ${parsed.data.status ? "AND d.status = $2" : ""}
         ORDER BY d.created_at DESC LIMIT 50`,
        parsed.data.status ? [householdId, parsed.data.status] : [householdId]
      )
    );

    return NextResponse.json(
      rows.rows.map((d) => ({
        id: d.id,
        riskLevel: d.risk_level,
        status: d.status,
        proposalHash: d.proposal_hash,
        expiresAt: d.expires_at,
        createdAt: d.created_at,
        approvedAt: d.approved_at,
        agentKey: d.agent_key,
        agentName: d.agent_name,
        actionEnvelope: d.action_envelope_json,
      }))
    );
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
