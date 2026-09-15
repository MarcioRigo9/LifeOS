import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { weeklyCostOptimizer, type PriceOffer, type PantryStockItem } from "@/lib/domain/nutrition";
import { aggregateNeededRawIngredients } from "./mealPlans";
import { logAudit } from "@/lib/audit";

export interface GenerateShoppingListResult {
  shoppingListId: string;
  totalCostCents: number;
  itemsWithoutPrice: string[];
}

/**
 * Real prices only (SECURITY_MODEL.md §7) — pulls the most recent captured `market_prices` row
 * per (food, market) for this household; never estimates a price for a food with no offer.
 */
export async function generateShoppingList(
  pool: Pool,
  params: { householdId: string; userId: string; mealPlanId: string; pantryStock?: PantryStockItem[] }
): Promise<GenerateShoppingListResult> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const needed = await aggregateNeededRawIngredients(client, params.mealPlanId);

    const foodIds = needed.map((n) => n.foodId);
    const pricesRes = await client.query<{
      id: string;
      food_id: string;
      market_id: string;
      package_size_g: string;
      price_cents: string;
    }>(
      `SELECT DISTINCT ON (food_id, market_id) id, food_id, market_id, package_size_g, price_cents
       FROM market_prices
       WHERE food_id = ANY($1)
       ORDER BY food_id, market_id, captured_at DESC`,
      [foodIds]
    );
    const offers: PriceOffer[] = pricesRes.rows.map((r) => ({
      foodId: r.food_id,
      marketId: r.market_id,
      packageSizeGrams: Number(r.package_size_g),
      priceCents: Number(r.price_cents),
    }));
    const priceRowIdByOffer = new Map(
      pricesRes.rows.map((r) => [`${r.food_id}:${r.market_id}`, r.id])
    );

    const optimized = weeklyCostOptimizer(needed, offers, params.pantryStock ?? []);

    const listRes = await client.query<{ id: string }>(
      `INSERT INTO shopping_lists (household_id, meal_plan_id, status, total_cost_cents)
       VALUES ($1, $2, 'draft', $3) RETURNING id`,
      [params.householdId, params.mealPlanId, optimized.totalCostCents]
    );
    const shoppingListId = listRes.rows[0].id;

    for (const item of optimized.items) {
      const marketPriceId = item.chosenOffer
        ? priceRowIdByOffer.get(`${item.chosenOffer.foodId}:${item.chosenOffer.marketId}`) ?? null
        : null;
      await client.query(
        `INSERT INTO shopping_list_items
           (household_id, shopping_list_id, food_id, needed_raw_grams, market_price_id, buy_qty, surplus_grams, estimated_cost_cents, price_unavailable)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          params.householdId,
          shoppingListId,
          item.foodId,
          item.neededAfterPantryGrams,
          marketPriceId,
          item.buyQty,
          item.surplusGrams,
          item.costCents,
          item.priceUnavailable,
        ]
      );
    }

    await logAudit(client, {
      householdId: params.householdId,
      actorType: "user",
      actorId: params.userId,
      eventType: "shopping_list.generated",
      entityType: "shopping_lists",
      entityId: shoppingListId,
      reason: optimized.itemsWithoutPrice.length > 0 ? `no price for: ${optimized.itemsWithoutPrice.join(", ")}` : undefined,
    });

    return {
      shoppingListId,
      totalCostCents: optimized.totalCostCents,
      itemsWithoutPrice: optimized.itemsWithoutPrice,
    };
  });
}
