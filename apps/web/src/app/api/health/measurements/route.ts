import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { recordMeasurement, listMeasurements } from "@/lib/health/measurements";
import { ImplausibleMeasurementError } from "@/lib/domain/health";

const postSchema = z.object({
  householdId: z.string().uuid(),
  personId: z.string().uuid(),
  takenAt: z.string().datetime(),
  weightKg: z.number(),
  bodyFatPct: z.number().optional(),
  muscleMassKg: z.number().optional(),
  waistCm: z.number().optional(),
  hipCm: z.number().optional(),
  armCm: z.number().optional(),
  notes: z.string().optional(),
});

function sessionTokenFrom(req: Request): string | undefined {
  return (req.headers.get("cookie") ?? "").match(/lifeos_session=([^;]+)/)?.[1];
}

export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(
      getRuntimePool(),
      sessionTokenFrom(req),
      parsed.data.householdId
    );
    const row = await recordMeasurement(getRuntimePool(), {
      householdId,
      userId,
      personId: parsed.data.personId,
      takenAt: new Date(parsed.data.takenAt),
      weightKg: parsed.data.weightKg,
      bodyFatPct: parsed.data.bodyFatPct,
      muscleMassKg: parsed.data.muscleMassKg,
      waistCm: parsed.data.waistCm,
      hipCm: parsed.data.hipCm,
      armCm: parsed.data.armCm,
      notes: parsed.data.notes,
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (err instanceof ImplausibleMeasurementError) {
      return NextResponse.json({ error: "implausible_value", field: err.field }, { status: 422 });
    }
    throw err;
  }
}

const getSchema = z.object({
  householdId: z.string().uuid(),
  personId: z.string().uuid(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = getSchema.safeParse({
    householdId: url.searchParams.get("householdId"),
    personId: url.searchParams.get("personId"),
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(
      getRuntimePool(),
      sessionTokenFrom(req),
      parsed.data.householdId
    );
    const rows = await listMeasurements(getRuntimePool(), { householdId, userId, personId: parsed.data.personId });
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
