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
      // sl.created_at DESC breaks ties deterministically when two shopping lists' meal plans
      // share the same week_start_date (same root cause/fix as nutrition/plan/route.ts).
      const listRes = await client.query(
        `SELECT sl.id, sl.status, sl.total_cost_cents, sl.meal_plan_id, mp.week_start_date
         FROM shopping_lists sl JOIN meal_plans mp ON mp.id = sl.meal_plan_id
         WHERE sl.household_id = $1 ORDER BY mp.week_start_date DESC, sl.created_at DESC LIMIT 1`,
        [householdId]
      );
      const list = listRes.rows[0] ?? null;
      if (!list) return { list: null, items: [] as unknown[] };

      // mp/m joined in (§2.4 "indicador de preço atualizado") — when a price was actually found
      // (price_unavailable=false), show WHEN it was captured and from which market, sourced
      // straight from the market_prices row shoppingLists.ts already pinned via market_price_id.
      const items = await client.query(
        `SELECT sli.id, sli.needed_raw_grams, sli.buy_qty, sli.surplus_grams, sli.estimated_cost_cents, sli.price_unavailable,
                f.name AS food_name, f.category,
                mp.captured_at AS price_captured_at, mp.source AS price_source, m.name AS market_name
         FROM shopping_list_items sli JOIN foods f ON f.id = sli.food_id
         LEFT JOIN market_prices mp ON mp.id = sli.market_price_id
         LEFT JOIN markets m ON m.id = mp.market_id
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
