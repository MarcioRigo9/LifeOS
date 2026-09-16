import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimePool, withHouseholdContext } from "@/lib/db/pool";
import { requireHouseholdContext, UnauthenticatedError, ForbiddenHouseholdError } from "@/lib/auth/requestContext";
import { getSessionToken } from "@/lib/auth/requestToken";
import { identifyFrequentFoods, syncMarketPrices } from "@/lib/scraping/priceSyncService";
import { FixtureMarketPriceProvider } from "@/lib/scraping/providers/fixtureProvider";

const bodySchema = z.object({ householdId: z.string().uuid() });

/**
 * Manual "Atualizar Cotações" trigger (§2.4) — same syncMarketPrices the Saturday-23:00 ritual
 * calls (scheduler/rituals/syncMarketPrices.ts), just invoked on demand. Human-in-the-loop is
 * untouched by this: refreshing market_prices only feeds weeklyCostOptimizer's estimate, it
 * never activates or approves a shopping list itself.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const { userId, householdId } = await requireHouseholdContext(getRuntimePool(), getSessionToken(req), parsed.data.householdId);

    // "Atualização autônoma... das tabelas markets e market_prices" (§ intro) — a household with
    // no market registered yet gets one auto-provisioned rather than hard-blocking the sync; the
    // couple can rename/add more later, this just removes an otherwise-permanent dead end.
    const markets = await withHouseholdContext(getRuntimePool(), { userId, householdId }, async (client) => {
      const existing = await client.query<{ id: string; name: string }>("SELECT id, name FROM markets WHERE household_id = $1", [
        householdId,
      ]);
      if (existing.rowCount! > 0) return existing.rows;
      const created = await client.query<{ id: string; name: string }>(
        "INSERT INTO markets (household_id, name) VALUES ($1, 'Mercado padrão') RETURNING id, name",
        [householdId]
      );
      return created.rows;
    });

    const foods = await withHouseholdContext(getRuntimePool(), { userId, householdId }, (client) =>
      identifyFrequentFoods(client, { householdId, limit: 20 })
    );
    if (foods.length === 0) {
      return NextResponse.json({ error: "no_foods" }, { status: 422 });
    }

    const provider = new FixtureMarketPriceProvider();
    const results = [];
    for (const market of markets) {
      results.push(await syncMarketPrices(getRuntimePool(), { householdId, userId, marketId: market.id, provider, foods }));
    }

    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenHouseholdError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}
