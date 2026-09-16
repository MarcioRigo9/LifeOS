import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";

const querySchema = z.object({ householdId: z.string().uuid() });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ householdId: url.searchParams.get("householdId") });
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    const result = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const listRes = await client.query(
        `SELECT sl.id, sl.status, sl.total_cost_cents, sl.meal_plan_id, mp.week_start_date
         FROM shopping_lists sl JOIN meal_plans mp ON mp.id = sl.meal_plan_id
         WHERE sl.household_id = $1 ORDER BY mp.week_start_date DESC LIMIT 1`,
        [householdId]
      );
      const list = listRes.rows[0] ?? null;
      if (!list) return { list: null, items: [] as unknown[] };

      const items = await client.query(
        `SELECT sli.id, sli.needed_raw_grams, sli.buy_qty, sli.surplus_grams, sli.estimated_cost_cents, sli.price_unavailable,
                f.name AS food_name, f.category
         FROM shopping_list_items sli JOIN foods f ON f.id = sli.food_id
         WHERE sli.shopping_list_id = $1 ORDER BY f.name`,
        [list.id]
      );

      return { list, items: items.rows };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
