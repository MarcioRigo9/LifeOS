import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { logHabitCompletion } from "@/lib/habits";

const bodySchema = z.object({ householdId: z.string().uuid(), profileId: z.string().uuid(), completed: z.boolean().default(true) });

/** habit_logs is append-only (unique per habit+day, no UPDATE grant — 0018_weekly_review.sql):
 * a second call for the same day fails with a unique-violation, surfaced as 409 so the UI can
 * show "já registrado hoje" instead of a generic 500. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const logId = await logHabitCompletion(getRuntimePool(), {
      householdId,
      userId,
      habitId: id,
      personId: parsed.data.profileId,
      loggedDate: new Date(),
      completed: parsed.data.completed,
    });
    return NextResponse.json({ id: logId }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return NextResponse.json({ error: "already_logged_today" }, { status: 409 });
    }
    throw err;
  }
}
