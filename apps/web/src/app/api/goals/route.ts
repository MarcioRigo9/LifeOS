import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { logAudit } from "@/lib/audit";

const querySchema = z.object({ householdId: z.string().uuid(), personId: z.string().uuid().optional() });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId"), personId: url.searchParams.get("personId") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const rows = await withHouseholdContext(getRuntimePool(), { userId, householdId }, (client) =>
      client.query(
        `SELECT id, person_id, title, metric, target_value, current_value, start_value, deadline, status, version
         FROM goals WHERE household_id = $1 ${parsed.data.personId ? "AND person_id = $2" : ""} ORDER BY created_at DESC`,
        parsed.data.personId ? [householdId, parsed.data.personId] : [householdId]
      )
    );
    return NextResponse.json(rows.rows);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}

const postSchema = z.object({
  householdId: z.string().uuid(),
  personId: z.string().uuid().optional(),
  title: z.string().min(1),
  metric: z.string().optional(),
  targetValue: z.number(),
  startValue: z.number().optional(),
});

/** goal.create is LOW risk (evaluateRisk.ts) — applies directly, no approval needed. */
export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const row = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const res = await client.query(
        `INSERT INTO goals (household_id, person_id, title, metric, target_value, current_value, start_value, version)
         VALUES ($1, $2, $3, $4, $5, $6, $6, 1)
         RETURNING id, person_id, title, metric, target_value, current_value, start_value, deadline, status, version`,
        [householdId, parsed.data.personId ?? null, parsed.data.title, parsed.data.metric ?? null, parsed.data.targetValue, parsed.data.startValue ?? null]
      );
      await logAudit(client, {
        householdId,
        actorType: "user",
        actorId: userId,
        eventType: "goal.created",
        entityType: "goals",
        entityId: res.rows[0].id,
      });
      return res.rows[0];
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
