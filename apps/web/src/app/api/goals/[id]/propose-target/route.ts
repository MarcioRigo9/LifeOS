import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { createDecisionProposal } from "@/lib/agents/decisions";

const bodySchema = z.object({ householdId: z.string().uuid(), newTargetValue: z.number() });

/**
 * goal.update_target is fixed at MEDIUM risk (evaluateRisk.ts) — changing an existing goal's
 * target always goes through the same DecisionProposal -> approve (hash-checked) -> execute
 * pipeline the Approve/Reject Action Cards already render (createDecisionProposal +
 * executeApprovedDecision's existing "goal.update_target" case, both tested since Fase 1).
 * Creating a NEW goal (POST /api/goals) is LOW risk and applies directly — only CHANGING one
 * needs human approval.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const proposal = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const res = await client.query<{ id: string; version: number }>("SELECT id, version FROM goals WHERE id = $1", [id]);
      if (res.rowCount === 0) throw new Error("goal not found");
      const goal = res.rows[0];

      return createDecisionProposal(client, {
        householdId,
        agentKey: "coordinator",
        envelope: {
          actionType: "goal.update_target",
          actionPayload: { newTargetValue: parsed.data.newTargetValue },
          targetEntityIds: [goal.id],
          expectedVersions: { [`goal:${goal.id}`]: goal.version },
          scope: { householdId, entityCount: 1, reversible: true, financialImpactCents: 0 },
        },
      });
    });

    return NextResponse.json(proposal, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
