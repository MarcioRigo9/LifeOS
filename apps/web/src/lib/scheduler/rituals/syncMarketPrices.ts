import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { identifyFrequentFoods, syncMarketPrices, type SyncMarketPricesResult } from "@/lib/scraping/priceSyncService";
import { FixtureMarketPriceProvider } from "@/lib/scraping/providers/fixtureProvider";
import type { MarketPriceProvider } from "@/lib/scraping/providers/types";
import type { RitualResult } from "./types";

/**
 * Sync Market Prices ritual (Saturday 23:00 household-local, before Sunday's Shopping
 * Preparation) — refreshes market_prices for the household's most-used foods. A failure on ONE
 * market never aborts the others (§1 resilience rule): each market gets its own try/catch, and
 * priceSyncService itself isolates failures per-food/per-quote below that.
 */
export async function processSyncMarketPricesJob(
  pool: Pool,
  params: { householdId: string; userId: string; provider?: MarketPriceProvider }
): Promise<RitualResult> {
  const provider = params.provider ?? new FixtureMarketPriceProvider();

  const markets = await withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, (client) =>
    client.query<{ id: string; name: string }>("SELECT id, name FROM markets WHERE household_id = $1", [params.householdId])
  );

  if (markets.rowCount === 0) {
    return { summary: "Nenhum mercado cadastrado — nada para atualizar." };
  }

  const foods = await withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, (client) =>
    identifyFrequentFoods(client, { householdId: params.householdId, limit: 20 })
  );

  if (foods.length === 0) {
    return { summary: "Nenhum alimento usado em receitas ainda — nada para cotar." };
  }

  const perMarketResults: SyncMarketPricesResult[] = [];
  const marketFailures: { marketName: string; reason: string }[] = [];

  for (const market of markets.rows) {
    try {
      const result = await syncMarketPrices(pool, {
        householdId: params.householdId,
        userId: params.userId,
        marketId: market.id,
        provider,
        foods,
      });
      perMarketResults.push(result);
    } catch (err) {
      // Only reached for an error OUTSIDE syncMarketPrices' own per-food isolation (e.g. a
      // database-level failure) — still never aborts the OTHER markets in this loop.
      marketFailures.push({ marketName: market.name, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const totalInserted = perMarketResults.reduce((sum, r) => sum + r.insertedCount, 0);
  const totalSkipped = perMarketResults.reduce((sum, r) => sum + r.skippedQuotes.length, 0);
  const totalProviderFailures = perMarketResults.reduce((sum, r) => sum + r.providerFailures.length, 0);

  const summaryParts = [`${totalInserted} cotação(ões) registrada(s) em ${markets.rowCount} mercado(s)`];
  if (totalSkipped > 0) summaryParts.push(`${totalSkipped} descartada(s) (formato inválido)`);
  if (totalProviderFailures > 0) summaryParts.push(`${totalProviderFailures} busca(s) sem resposta do provider`);
  if (marketFailures.length > 0) summaryParts.push(`${marketFailures.length} mercado(s) falharam por completo`);

  return {
    summary: summaryParts.join(", ") + ".",
    data: { perMarketResults, marketFailures },
  };
}
