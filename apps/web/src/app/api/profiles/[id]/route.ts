import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";

const bodySchema = z.object({
  householdId: z.string().uuid(),
  displayName: z.string().min(1).optional(),
  birthDate: z.string().date().optional(),
  sex: z.enum(["male", "female"]).optional(),
  heightCm: z.number().positive().optional(),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).optional(),
  nutritionGoal: z.enum(["lose_weight", "maintain", "gain_muscle"]).optional(),
});

/**
 * Plain data update — no domain math involved, so a direct parameterized UPDATE is appropriate
 * (same posture as the raw-SQL profile UPDATEs already exercised by the test suite's fixtures).
 * Grants already allow this (0009_grants.sql: SELECT, INSERT, UPDATE on profiles); RLS scopes it
 * to the caller's own household.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });

  const { displayName, birthDate, sex, heightCm, activityLevel, nutritionGoal } = parsed.data;
  const sets: string[] = [];
  const args: unknown[] = [];
  function set(column: string, value: unknown) {
    args.push(value);
    sets.push(`${column} = $${args.length}`);
  }
  if (displayName !== undefined) set("display_name", displayName);
  if (birthDate !== undefined) set("birth_date", birthDate);
  if (sex !== undefined) set("sex", sex);
  if (heightCm !== undefined) set("height_cm", heightCm);
  if (activityLevel !== undefined) set("activity_level", activityLevel);
  if (nutritionGoal !== undefined) set("nutrition_goal", nutritionGoal);

  if (sets.length === 0) return NextResponse.json({ error: "no_fields" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const row = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      args.push(id);
      const res = await client.query(
        `UPDATE profiles SET ${sets.join(", ")} WHERE id = $${args.length}
         RETURNING id, display_name, birth_date, sex, height_cm, activity_level, nutrition_goal`,
        args
      );
      return res.rows[0] ?? null;
    });

    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}

const getBodySchema = z.object({ householdId: z.string().uuid() });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const parsed = getBodySchema.safeParse({ householdId: url.searchParams.get("householdId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const row = await withHouseholdContext(getRuntimePool(), { userId, householdId }, (client) =>
      client.query(
        `SELECT id, display_name, birth_date, sex, height_cm, activity_level, nutrition_goal FROM profiles WHERE id = $1`,
        [id]
      )
    );
    if (row.rowCount === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row.rows[0]);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
