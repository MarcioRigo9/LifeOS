import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { startWorkoutSession } from "@/lib/fitness/workoutSessions";

const bodySchema = z.object({ householdId: z.string().uuid(), profileId: z.string().uuid(), workoutPlanId: z.string().uuid().optional().nullable() });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const sessionId = await startWorkoutSession(getRuntimePool(), {
      householdId,
      userId,
      personId: parsed.data.profileId,
      workoutPlanId: parsed.data.workoutPlanId ?? undefined,
      performedAt: new Date(),
    });
    return NextResponse.json({ id: sessionId }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
