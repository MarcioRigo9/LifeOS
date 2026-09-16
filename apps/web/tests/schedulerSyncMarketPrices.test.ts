import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, getTestAdminPool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture } from "./setup/fixtures";
import { seedNutritionCatalog, seedMarket } from "./setup/nutritionFixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { createRecipe } from "@/lib/nutrition/recipes";
import { ensureScheduledJob } from "@/lib/scheduler/jobs";
import { runSchedulerTick } from "@/lib/scheduler/worker";
import { processSyncMarketPricesJob } from "@/lib/scheduler/rituals/syncMarketPrices";
import type { MarketPriceProvider, RawMarketQuote } from "@/lib/scraping/providers/types";
import { MarketPriceProviderError } from "@/lib/scraping/providers/types";

describe("sync_market_prices scheduler ritual (Saturday 23:00, before Sunday's Shopping Preparation)", () => {
  beforeEach(truncateAll);

  it("runs end-to-end through the real scheduler tick and produces market_prices rows", async () => {
    const pool = getTestRuntimePool();
    const adminPool = getTestAdminPool();
    const household = await createHouseholdFixture(pool, "SchedPrice1");
    const catalog = await seedNutritionCatalog();
    await seedMarket(pool, household, "Mercado Padrão");
    await createRecipe(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Frango com arroz",
      servings: 2,
      items: [
        { foodId: catalog.chickenId, rawGrams: 200, preparationMethod: "grilled" },
        { foodId: catalog.riceId, rawGrams: 100, preparationMethod: "boiled" },
      ],
    });

    const scheduledJobId = await ensureScheduledJob(pool, {
      householdId: household.householdId,
      userId: household.userId,
      kind: "sync_market_prices",
      cronExpr: "0 23 * * 6",
    });
    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE scheduled_jobs SET next_run_at = now() - interval '1 second' WHERE id = $1", [scheduledJobId])
    );

    const tick = await runSchedulerTick({ runtimePool: pool, adminPool, workerId: "w-price-sync", batchSize: 10 });
    expect(tick.claimed).toBe(1);
    expect(tick.succeeded).toBe(1);
    expect(tick.failed).toBe(0);

    const runRow = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT status, result_summary FROM job_runs WHERE scheduled_job_id = $1", [scheduledJobId])
    );
    expect(runRow.rows[0].status).toBe("succeeded");
    expect(runRow.rows[0].result_summary).toMatch(/cotaç/i);

    const prices = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT count(*) FROM market_prices WHERE household_id = $1", [household.householdId])
    );
    expect(Number(prices.rows[0].count)).toBeGreaterThan(0);
  });

  it("a market whose provider fails entirely does not stop other markets in the same household from being synced", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "SchedPrice2");
    const catalog = await seedNutritionCatalog();
    await seedMarket(pool, household, "Mercado que Funciona");
    await seedMarket(pool, household, "Mercado Fora do Ar");
    await createRecipe(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Frango",
      servings: 1,
      items: [{ foodId: catalog.chickenId, rawGrams: 150, preparationMethod: "grilled" }],
    });

    let callCount = 0;
    class HalfBrokenProvider implements MarketPriceProvider {
      name = "half-broken";
      async searchPrices(query: string): Promise<RawMarketQuote[]> {
        callCount++;
        // Every OTHER call fails, simulating one market's endpoint being down while another
        // (using the same provider instance across the ritual's market loop) still works.
        if (callCount % 2 === 0) {
          throw new MarketPriceProviderError(this.name, "network", "simulated connection refused");
        }
        return [{ productTitle: "Peito de Frango 1kg", priceText: "R$ 20,00", packageText: "1kg" }];
      }
    }

    const result = await processSyncMarketPricesJob(pool, {
      householdId: household.householdId,
      userId: household.userId,
      provider: new HalfBrokenProvider(),
    });

    // The ritual completed (no throw) with a summary describing partial success — resilience:
    // one market's total provider failure never aborts the household's whole sync run.
    expect(result.summary).toMatch(/cotaç/i);
    const data = result.data as { perMarketResults: { insertedCount: number }[] };
    expect(data.perMarketResults).toHaveLength(2);
    const totalInserted = data.perMarketResults.reduce((s, r) => s + r.insertedCount, 0);
    expect(totalInserted).toBeGreaterThan(0);
  });

  it("a household with no markets and no recipes still completes the ritual cleanly (never invents data to sync)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "SchedPrice3");

    const result = await processSyncMarketPricesJob(pool, { householdId: household.householdId, userId: household.userId });
    expect(result.summary).toMatch(/nenhum/i);
  });
});
