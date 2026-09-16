import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { runWeeklyReview } from "@/lib/agents/weeklyReview";

const bodySchema = z.object({ householdId: z.string().uuid() });

/** Manual "rodar agora" trigger for the Review screen — same runWeeklyReview the Fase 6
 * scheduler calls every Saturday (scheduler/rituals/weeklyPlanning.ts), just invoked on demand
 * so the screen is useful without waiting for the ritual. */
function currentWeekMonday(from: Date): Date {
  const result = new Date(from);
  const day = result.getDay();
  const diff = day === 0 ? 6 : day - 1;
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const result = await runWeeklyReview(getRuntimePool(), { householdId, userId, weekStartDate: currentWeekMonday(new Date()) });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
