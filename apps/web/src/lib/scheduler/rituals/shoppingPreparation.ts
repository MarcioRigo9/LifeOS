import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { generateShoppingList } from "@/lib/nutrition/shoppingLists";
import type { RitualResult } from "./types";

/**
 * Shopping Preparation ritual (Fase 6 §2.3, Sunday 10:00 household-local): generates an
 * optimized shopping list for the household's most recent meal plan (approved or still
 * PENDING — this only READS the plan, never touches its approval state). Idempotent per meal
 * plan: a shopping_lists row already existing for that plan means a previous run (or a
 * crash-recovered retry) already did this, so it's reported, not duplicated (ARCHITECTURE_REVIEW
 * §7 scenario E/F — "job executes twice" must never double-create a shopping list).
 */
export async function processShoppingPreparationJob(
  pool: Pool,
  params: { householdId: string; userId: string }
): Promise<RitualResult> {
  const check = await withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const planRes = await client.query<{ id: string; week_start_date: string }>(
      `SELECT id, week_start_date FROM meal_plans WHERE household_id = $1 ORDER BY week_start_date DESC LIMIT 1`,
      [params.householdId]
    );
    if (planRes.rowCount === 0) return { mealPlanId: null as string | null, weekStartDate: null as string | null, existingShoppingListId: null as string | null };
    const plan = planRes.rows[0];
    const existing = await client.query<{ id: string }>(`SELECT id FROM shopping_lists WHERE meal_plan_id = $1 LIMIT 1`, [
      plan.id,
    ]);
    return { mealPlanId: plan.id, weekStartDate: plan.week_start_date, existingShoppingListId: existing.rows[0]?.id ?? null };
  });

  if (!check.mealPlanId) {
    return { summary: "Nenhum plano alimentar encontrado — nada para preparar." };
  }
  if (check.existingShoppingListId) {
    return {
      summary: `Lista de compras já existia para o plano de ${check.weekStartDate} — nada a refazer.`,
      data: { shoppingListId: check.existingShoppingListId, skipped: true },
    };
  }

  const generated = await generateShoppingList(pool, {
    householdId: params.householdId,
    userId: params.userId,
    mealPlanId: check.mealPlanId,
  });

  return {
    summary: `Lista de compras gerada para o plano de ${check.weekStartDate}: R$ ${(generated.totalCostCents / 100).toFixed(2)}${
      generated.itemsWithoutPrice.length > 0 ? `, ${generated.itemsWithoutPrice.length} item(ns) sem preço` : ""
    }.`,
    data: {
      shoppingListId: generated.shoppingListId,
      totalCostCents: generated.totalCostCents,
      itemsWithoutPrice: generated.itemsWithoutPrice,
    },
  };
}
