import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { createMeal } from "@/lib/nutrition/meals";

const bodySchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
});

/** Wires a recipe into the weekly-plan generator's pool of meals (listMealsByType,
 * mealPlans.ts's generateWeeklyMealPlan requires at least one meal per main slot) — without
 * this step, recipes alone never get picked up by "Gerar plano da semana". */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);
    const mealId = await createMeal(getRuntimePool(), { householdId, userId, recipeId: id, name: parsed.data.name, type: parsed.data.type });
    return NextResponse.json({ id: mealId }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
