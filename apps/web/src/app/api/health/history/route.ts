import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { recordHealthEvent, listHealthHistory } from "@/lib/health/healthHistory";

const postSchema = z.object({
  householdId: z.string().uuid(),
  personId: z.string().uuid(),
  category: z.enum(["injury", "surgery", "allergy", "chronic_condition", "continuous_medication"]),
  title: z.string().min(1),
  details: z.string().min(1),
  source: z.enum(["user_input", "checkin", "doctor_report"]).default("user_input"),
});

export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const row = await recordHealthEvent(getRuntimePool(), {
      householdId,
      userId,
      personId: parsed.data.personId,
      category: parsed.data.category,
      title: parsed.data.title,
      details: parsed.data.details,
      recordedAt: new Date(),
      source: parsed.data.source,
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}

const getSchema = z.object({ householdId: z.string().uuid(), personId: z.string().uuid() });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = getSchema.safeParse({ householdId: url.searchParams.get("householdId"), personId: url.searchParams.get("personId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const rows = await listHealthHistory(getRuntimePool(), { householdId, userId, personId: parsed.data.personId });
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
