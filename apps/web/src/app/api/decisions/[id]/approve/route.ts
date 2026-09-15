import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { approveDecision, DecisionError } from "@/lib/agents/decisions";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ householdId: z.string().uuid(), proposalHash: z.string() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie.match(/lifeos_session=([^;]+)/)?.[1];
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), token, parsed.data.householdId);

    await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      // approvedBy is a profiles.id in the canonical model; for Fase 1 the acting user's own
      // profile row is used (1:1 user<->profile at signup).
      const profileRes = await client.query<{ id: string }>(
        "SELECT id FROM profiles WHERE user_id = $1 AND household_id = $2",
        [userId, householdId]
      );
      await approveDecision(client, {
        decisionId: id,
        proposalHash: parsed.data.proposalHash,
        approvedByProfileId: profileRes.rows[0]?.id ?? null,
      });
      await logAudit(client, {
        householdId,
        actorType: "user",
        actorId: userId,
        eventType: "decision.approved",
        entityType: "agent_decisions",
        entityId: id,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (err instanceof DecisionError) {
      const statusByCode = { not_found: 404, invalid_state: 409, expired: 409, hash_mismatch: 409, not_approved: 409 } as const;
      return NextResponse.json({ error: err.code }, { status: statusByCode[err.code] });
    }
    throw err;
  }
}
