import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedNutritionCatalog, seedMarket } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { createRecipe } from "@/lib/nutrition/recipes";
import { identifyFrequentFoods, syncMarketPrices } from "@/lib/scraping/priceSyncService";
import type { MarketPriceProvider, RawMarketQuote } from "@/lib/scraping/providers/types";

class StubProvider implements MarketPriceProvider {
  name = "stub-provider";
  async searchPrices(): Promise<RawMarketQuote[]> {
    return [{ productTitle: "Peito de Frango Sadia 1kg Bandeja", priceText: "R$ 19,90", packageText: "1kg" }];
  }
}

describe("Cross-household isolation of market price sync (RLS, SECURITY_MODEL.md §3.1)", () => {
  beforeEach(truncateAll);

  it("Household A's markets/market_prices are invisible to Household B, even via a direct unfiltered query", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "PriceIsoA");
    const householdB = await createHouseholdFixture(pool, "PriceIsoB");
    const catalog = await seedNutritionCatalog();

    const marketA = await seedMarket(pool, householdA, "Mercado A");
    await createRecipe(pool, {
      householdId: householdA.householdId,
      userId: householdA.userId,
      name: "Receita A",
      servings: 1,
      items: [{ foodId: catalog.chickenId, rawGrams: 150, preparationMethod: "grilled" }],
    });
    const foodsA = await withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
      identifyFrequentFoods(client, { householdId: householdA.householdId })
    );
    await syncMarketPrices(pool, { householdId: householdA.householdId, userId: householdA.userId, marketId: marketA, provider: new StubProvider(), foods: foodsA });

    // Household B has its own market and its own sync, independent of A's.
    const marketB = await seedMarket(pool, householdB, "Mercado B");
    await createRecipe(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      name: "Receita B",
      servings: 1,
      items: [{ foodId: catalog.chickenId, rawGrams: 150, preparationMethod: "grilled" }],
    });
    const foodsB = await withHouseholdContext(pool, { userId: householdB.userId, householdId: householdB.householdId }, (client) =>
      identifyFrequentFoods(client, { householdId: householdB.householdId })
    );
    await syncMarketPrices(pool, { householdId: householdB.householdId, userId: householdB.userId, marketId: marketB, provider: new StubProvider(), foods: foodsB });

    // Unfiltered queries under B's own session context — RLS must be what hides A's rows, not
    // an application-level WHERE clause that a query could forget.
    const seenByB = await withHouseholdContext(pool, { userId: householdB.userId, householdId: householdB.householdId }, async (client) => {
      const markets = await client.query("SELECT * FROM markets");
      const prices = await client.query("SELECT * FROM market_prices");
      return { markets: markets.rowCount, prices: prices.rowCount };
    });
    expect(seenByB).toEqual({ markets: 1, prices: 1 });
    expect(seenByB.markets).not.toBe(2); // proves A's market never leaked in

    const seenByA = await withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
      client.query("SELECT id FROM markets WHERE id = $1", [marketB])
    );
    expect(seenByA.rowCount).toBe(0);
  });

  it("Household A cannot INSERT a market_prices row tagged with Household B's household_id (RLS WITH CHECK)", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "PriceIsoC");
    const householdB = await createHouseholdFixture(pool, "PriceIsoD");
    const catalog = await seedNutritionCatalog();
    const marketB = await seedMarket(pool, householdB, "Mercado B");

    await expect(
      withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
        client.query(
          `INSERT INTO market_prices (household_id, market_id, food_id, package_size_g, package_unit, price_cents, captured_at, source)
           VALUES ($1, $2, $3, 1000, 'g', 1990, now(), 'forged')`,
          [householdB.householdId, marketB, catalog.chickenId]
        )
      )
    ).rejects.toThrow();
  });

  it("identifyFrequentFoods for Household A never counts Household B's recipe usage", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "PriceIsoE");
    const householdB = await createHouseholdFixture(pool, "PriceIsoF");
    const catalog = await seedNutritionCatalog();

    // B uses rice heavily; A never does.
    for (let i = 0; i < 3; i++) {
      await createRecipe(pool, {
        householdId: householdB.householdId,
        userId: householdB.userId,
        name: `Receita B ${i}`,
        servings: 1,
        items: [{ foodId: catalog.riceId, rawGrams: 100, preparationMethod: "boiled" }],
      });
    }

    const foodsA = await withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
      identifyFrequentFoods(client, { householdId: householdA.householdId })
    );
    expect(foodsA).toHaveLength(0);
  });
});
