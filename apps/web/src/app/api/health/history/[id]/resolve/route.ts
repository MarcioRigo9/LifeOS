import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { markHealthEventResolved } from "@/lib/health/healthHistory";

const bodySchema = z.object({ householdId: z.string().uuid() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    await markHealthEventResolved(getRuntimePool(), { householdId, userId, eventId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
