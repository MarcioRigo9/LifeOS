import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { gatherWeeklyWorkoutPlanningContext } from "@/lib/fitness/planningContext";
import { generateWeeklyWorkoutPlan } from "@/lib/fitness/workoutPlans";
import { nextMonday } from "@/lib/nutrition/planningContext";

const bodySchema = z.object({ householdId: z.string().uuid() });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const context = await withHouseholdContext(getRuntimePool(), { userId, householdId }, (client) =>
      gatherWeeklyWorkoutPlanningContext(client, householdId)
    );
    if (context.ready.length === 0) {
      return NextResponse.json({ error: "incomplete_profile", missing: context.incomplete }, { status: 422 });
    }

    const plans = await generateWeeklyWorkoutPlan(getRuntimePool(), {
      householdId,
      userId,
      weekStartDate: nextMonday(),
      people: context.ready,
    });

    return NextResponse.json({ plans, incomplete: context.incomplete }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
