import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withHouseholdContext } from "@/lib/db/pool";
import { logAudit } from "@/lib/audit";
import { parseCurrencyToCents, parsePackageSize, sanitizeProductTitle, InvalidPriceError, InvalidProductTitleError } from "./sanitize";
import { MarketPriceProviderError, type MarketPriceProvider, type RawMarketQuote } from "./providers/types";

/** Defense in depth alongside the DB's own CHECK constraints (0013_nutrition_household.sql) —
 * validated immediately before the INSERT, never trusting the parser's output implicitly. */
const marketPriceInsertSchema = z.object({
  householdId: z.string().uuid(),
  marketId: z.string().uuid(),
  foodId: z.string().uuid(),
  brand: z.string().max(200).nullable(),
  packageSizeG: z.number().positive(),
  packageUnit: z.enum(["g", "ml"]),
  priceCents: z.number().int().positive(),
  currency: z.literal("BRL"),
  source: z.string().min(1).max(120),
  sourceUrl: z.string().max(2000).nullable(),
  promo: z.boolean(),
});
type MarketPriceInsert = z.infer<typeof marketPriceInsertSchema>;

export interface FrequentFood {
  foodId: string;
  name: string;
  usageCount: number;
}

/** "Alimentos mais consumidos nas receitas do household" (§2.2) — a plain count over
 * recipe_items, no domain math involved (frequency is not a calculation ADR 005 concerns
 * itself with, it's just an ORDER BY). */
export async function identifyFrequentFoods(
  client: PoolClient,
  params: { householdId: string; limit?: number }
): Promise<FrequentFood[]> {
  const res = await client.query<{ food_id: string; name: string; usage_count: string }>(
    `SELECT ri.food_id, f.name, count(*) AS usage_count
     FROM recipe_items ri JOIN foods f ON f.id = ri.food_id
     WHERE ri.household_id = $1
     GROUP BY ri.food_id, f.name
     ORDER BY usage_count DESC, f.name
     LIMIT $2`,
    [params.householdId, params.limit ?? 20]
  );
  return res.rows.map((r) => ({ foodId: r.food_id, name: r.name, usageCount: Number(r.usage_count) }));
}

export interface SkippedQuote {
  foodName: string;
  reason: string;
}

export interface SyncMarketPricesResult {
  marketId: string;
  providerName: string;
  foodsQueried: number;
  insertedCount: number;
  skippedQuotes: SkippedQuote[];
  providerFailures: { foodName: string; reason: string }[];
}

/**
 * Syncs prices for the household's most-used foods against ONE market/provider pair.
 * Resilience (§1 non-negotiable rules): a provider failure for one food (timeout, HTTP error,
 * bad JSON) is caught, audited, and the loop continues with the next food — it never aborts the
 * whole sync, and it never invents a price for the food that failed (that food's cost stays
 * `priceUnavailable` in weeklyCostOptimizer, exactly as an already-tested, existing behavior).
 * Every quote is independently sanitized/parsed/validated — one bad quote never drops the
 * others from the same search.
 */
export async function syncMarketPrices(
  pool: Pool,
  params: { householdId: string; userId: string; marketId: string; provider: MarketPriceProvider; foods: FrequentFood[] }
): Promise<SyncMarketPricesResult> {
  const result: SyncMarketPricesResult = {
    marketId: params.marketId,
    providerName: params.provider.name,
    foodsQueried: params.foods.length,
    insertedCount: 0,
    skippedQuotes: [],
    providerFailures: [],
  };

  for (const food of params.foods) {
    let quotes: RawMarketQuote[];
    try {
      quotes = await params.provider.searchPrices(food.name);
    } catch (err) {
      const reason =
        err instanceof MarketPriceProviderError ? `${err.reason}: ${err.message}` : err instanceof Error ? err.message : String(err);
      result.providerFailures.push({ foodName: food.name, reason });
      await withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, (client) =>
        logAudit(client, {
          householdId: params.householdId,
          actorType: "system",
          eventType: "market_price.provider_failed",
          entityType: "markets",
          entityId: params.marketId,
          reason: `${params.provider.name} failed for "${food.name}": ${reason}`,
        })
      );
      continue; // never abort the batch for one food's provider failure
    }

    for (const quote of quotes) {
      const outcome = await insertOneQuote(pool, {
        householdId: params.householdId,
        userId: params.userId,
        marketId: params.marketId,
        providerName: params.provider.name,
        food,
        quote,
      });
      if (outcome.inserted) {
        result.insertedCount++;
      } else {
        result.skippedQuotes.push({ foodName: food.name, reason: outcome.reason! });
      }
    }
  }

  return result;
}

async function insertOneQuote(
  pool: Pool,
  params: {
    householdId: string;
    userId: string;
    marketId: string;
    providerName: string;
    food: FrequentFood;
    quote: RawMarketQuote;
  }
): Promise<{ inserted: boolean; reason?: string }> {
  // Sanitization/parsing first — the title is stored ONLY for display, never used to derive
  // price or package size (those come from the quote's own priceText/packageText fields).
  let title: string;
  try {
    title = sanitizeProductTitle(params.quote.productTitle);
  } catch (err) {
    return { inserted: false, reason: err instanceof InvalidProductTitleError ? err.message : String(err) };
  }

  let priceCents: number;
  try {
    priceCents = parseCurrencyToCents(params.quote.priceText);
  } catch (err) {
    return { inserted: false, reason: err instanceof InvalidPriceError ? err.message : String(err) };
  }

  const pkg = parsePackageSize(params.quote.packageText ?? params.quote.productTitle);
  if (!pkg) {
    // Never invents a package size (SECURITY_MODEL.md §7 "never guess") — a quote with no
    // recognizable quantity is skipped, not stored with a fabricated default.
    return { inserted: false, reason: `no recognizable package size in "${title}"` };
  }

  const candidate = marketPriceInsertSchema.safeParse({
    householdId: params.householdId,
    marketId: params.marketId,
    foodId: params.food.foodId,
    brand: params.quote.brand ?? null,
    packageSizeG: pkg.sizeValue,
    packageUnit: pkg.unit,
    priceCents,
    currency: "BRL",
    source: params.providerName,
    sourceUrl: params.quote.sourceUrl ?? null,
    promo: params.quote.promo ?? false,
  });
  if (!candidate.success) {
    return { inserted: false, reason: candidate.error.issues.map((i) => i.message).join("; ") };
  }

  try {
    await insertMarketPrice(pool, params.userId, candidate.data, title);
    return { inserted: true };
  } catch (err) {
    // 23505 = unique_violation (market_prices_offer_capture_unique) — the same offer already
    // captured at this exact instant; append-only means this is a benign no-op skip, not a bug.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return { inserted: false, reason: "duplicate capture (already recorded this instant)" };
    }
    throw err;
  }
}

async function insertMarketPrice(pool: Pool, userId: string, data: MarketPriceInsert, productTitle: string): Promise<string> {
  return withHouseholdContext(pool, { userId, householdId: data.householdId }, async (client) => {
    // product_title (0024_market_prices_product_title.sql) is where the SANITIZED title
    // actually lands — proof that untrusted text safely round-trips through Postgres as inert
    // data (a parameterized query, never string-built SQL) without affecting any other column.
    const res = await client.query<{ id: string }>(
      `INSERT INTO market_prices
         (household_id, market_id, food_id, brand, product_title, package_size_g, package_unit, price_cents, currency, captured_at, source, source_url, confidence, promo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, 1.0, $12)
       RETURNING id`,
      [
        data.householdId,
        data.marketId,
        data.foodId,
        data.brand,
        productTitle,
        data.packageSizeG,
        data.packageUnit,
        data.priceCents,
        data.currency,
        data.source,
        data.sourceUrl,
        data.promo,
      ]
    );
    return res.rows[0].id;
  });
}
