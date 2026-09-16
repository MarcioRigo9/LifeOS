import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { recordWorkoutSet } from "@/lib/fitness/workoutSessions";
import { ImplausibleWorkoutValueError } from "@/lib/domain/fitness";

const bodySchema = z.object({
  householdId: z.string().uuid(),
  exerciseId: z.string().uuid(),
  setNumber: z.number().int().positive(),
  reps: z.number().int().positive(),
  loadKg: z.number().positive(),
  rpe: z.number().min(1).max(10).optional(),
  completed: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const setId = await recordWorkoutSet(getRuntimePool(), {
      householdId,
      userId,
      sessionId: id,
      exerciseId: parsed.data.exerciseId,
      setNumber: parsed.data.setNumber,
      reps: parsed.data.reps,
      loadKg: parsed.data.loadKg,
      rpe: parsed.data.rpe,
      completed: parsed.data.completed,
    });
    return NextResponse.json({ id: setId }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (err instanceof ImplausibleWorkoutValueError) {
      return NextResponse.json({ error: "implausible_value", field: err.field }, { status: 422 });
    }
    throw err;
  }
}
