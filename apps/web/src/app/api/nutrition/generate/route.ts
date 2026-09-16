import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { gatherWeeklyPlanningContext, nextMonday } from "@/lib/nutrition/planningContext";
import { generateWeeklyMealPlan } from "@/lib/nutrition/mealPlans";
import { generateShoppingList } from "@/lib/nutrition/shoppingLists";

const bodySchema = z.object({ householdId: z.string().uuid() });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const context = await withHouseholdContext(getRuntimePool(), { userId, householdId }, (client) =>
      gatherWeeklyPlanningContext(client, householdId)
    );
    if (context.ready.length === 0) {
      return NextResponse.json({ error: "incomplete_profile", missing: context.incomplete }, { status: 422 });
    }

    const plan = await generateWeeklyMealPlan(getRuntimePool(), { householdId, userId, weekStartDate: nextMonday(), people: context.ready });
    const shoppingList = await generateShoppingList(getRuntimePool(), { householdId, userId, mealPlanId: plan.mealPlanId });

    return NextResponse.json({ plan, shoppingList, incomplete: context.incomplete }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // generateWeeklyMealPlan (mealPlans.ts) throws a plain Error when a main slot (breakfast/
    // lunch/dinner) has zero meals registered yet — a common, expected "not set up yet" state
    // (not a bug), so it's worth a clean 422 rather than a generic 500.
    if (err instanceof Error && /no meals of type/.test(err.message)) {
      return NextResponse.json({ error: "missing_meal_type", message: err.message }, { status: 422 });
    }
    throw err;
  }
}
