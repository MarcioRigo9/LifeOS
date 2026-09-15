import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { assertFinanceModuleEnabled } from "./financeGuard";
import type { FinancialBudget } from "@/lib/domain/finance";

export interface CreateFinancialBudgetInput {
  householdId: string;
  userId: string;
  categoryId: string;
  month: number;
  year: number;
  targetCents: number;
}

export async function createFinancialBudget(pool: Pool, input: CreateFinancialBudgetInput): Promise<FinancialBudget> {
  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, input.householdId);
    const res = await client.query(
      `INSERT INTO financial_budgets (household_id, category_id, month, year, target_cents)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, household_id, category_id, month, year, target_cents, version, created_at, updated_at`,
      [input.householdId, input.categoryId, input.month, input.year, input.targetCents]
    );
    return mapBudgetRow(res.rows[0]);
  });
}

export class FinancialBudgetVersionConflictError extends Error {
  constructor(public budgetId: string, public expectedVersion: number) {
    super(`financial_budget ${budgetId} version mismatch: expected ${expectedVersion}`);
  }
}

/** Optimistic concurrency (D017) — same `WHERE version = :expected` pattern as goals/meal_plans/
 * workout_plans; two people editing the same budget never silently overwrite each other. */
export async function updateFinancialBudgetTarget(
  pool: Pool,
  params: { householdId: string; userId: string; budgetId: string; expectedVersion: number; newTargetCents: number }
): Promise<FinancialBudget> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, params.householdId);
    const res = await client.query(
      `UPDATE financial_budgets SET target_cents = $1, version = version + 1
       WHERE id = $2 AND version = $3
       RETURNING id, household_id, category_id, month, year, target_cents, version, created_at, updated_at`,
      [params.newTargetCents, params.budgetId, params.expectedVersion]
    );
    if (res.rowCount === 0) {
      throw new FinancialBudgetVersionConflictError(params.budgetId, params.expectedVersion);
    }
    return mapBudgetRow(res.rows[0]);
  });
}

function mapBudgetRow(row: Record<string, unknown>): FinancialBudget {
  return {
    id: row.id as string,
    householdId: row.household_id as string,
    categoryId: row.category_id as string,
    month: Number(row.month),
    year: Number(row.year),
    targetCents: Number(row.target_cents),
    version: Number(row.version),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
