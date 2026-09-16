import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { getDietaryPreferences, listHouseholdDietaryPreferences, upsertDietaryPreferences } from "@/lib/nutrition/dietaryPreferences";

const getQuerySchema = z.object({ householdId: z.string().uuid(), personId: z.string().uuid().optional() });

/** personId omitted -> every profile's preferences in the household (onboarding overview);
 * personId given -> that one profile's record, or null if never saved. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = getQuerySchema.safeParse({
    householdId: url.searchParams.get("householdId"),
    personId: url.searchParams.get("personId") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const ctx = { userId, householdId };

    if (parsed.data.personId) {
      const record = await getDietaryPreferences(getRuntimePool(), ctx, parsed.data.personId);
      return NextResponse.json(record);
    }
    const records = await listHouseholdDietaryPreferences(getRuntimePool(), ctx);
    return NextResponse.json(records);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}

const patchBodySchema = z.object({
  householdId: z.string().uuid(),
  personId: z.string().uuid(),
  dislikedFoods: z.array(z.string().min(1)).default([]),
  reheatIntolerantFoods: z.array(z.string().min(1)).default([]),
  prepSchedule: z.record(z.string(), z.string()).default({}),
  notes: z.string().nullish(),
});

/** Upsert (ON CONFLICT (person_id) in dietaryPreferences.ts) — the onboarding form and any later
 * edit are both just "save the whole record", so one idempotent PATCH covers both. */
export async function PATCH(req: Request) {
  const parsed = patchBodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const record = await upsertDietaryPreferences(
      getRuntimePool(),
      { userId, householdId },
      {
        personId: parsed.data.personId,
        dislikedFoods: parsed.data.dislikedFoods,
        reheatIntolerantFoods: parsed.data.reheatIntolerantFoods,
        prepSchedule: parsed.data.prepSchedule,
        notes: parsed.data.notes ?? null,
      }
    );
    return NextResponse.json(record);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
