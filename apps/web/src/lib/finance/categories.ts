import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { assertFinanceModuleEnabled } from "./financeGuard";
import type { FinancialCategory, FinancialCategoryType } from "@/lib/domain/finance";

export interface CreateFinancialCategoryInput {
  householdId: string;
  userId: string;
  name: string;
  type: FinancialCategoryType;
}

/** Always household-scoped when created through this path — a global (household_id IS NULL)
 * category is a system-seeded default, never something a household's own write can produce
 * (0021_finance_schema.sql's RLS WITH CHECK enforces this independently at the database level). */
export async function createFinancialCategory(pool: Pool, input: CreateFinancialCategoryInput): Promise<FinancialCategory> {
  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, input.householdId);
    const res = await client.query(
      `INSERT INTO financial_categories (household_id, name, type) VALUES ($1, $2, $3)
       RETURNING id, household_id, name, type, created_at`,
      [input.householdId, input.name, input.type]
    );
    return mapCategoryRow(res.rows[0]);
  });
}

export async function listFinancialCategories(pool: Pool, params: { householdId: string; userId: string }): Promise<FinancialCategory[]> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, params.householdId);
    // Sees both this household's own categories AND global defaults (household_id IS NULL) —
    // the RLS policy already encodes this; the WHERE here is just the same rule made explicit.
    const res = await client.query(
      `SELECT id, household_id, name, type, created_at FROM financial_categories
       WHERE household_id = $1 OR household_id IS NULL ORDER BY name`,
      [params.householdId]
    );
    return res.rows.map(mapCategoryRow);
  });
}

function mapCategoryRow(row: Record<string, unknown>): FinancialCategory {
  return {
    id: row.id as string,
    householdId: row.household_id as string | null,
    name: row.name as string,
    type: row.type as FinancialCategoryType,
    createdAt: row.created_at as Date,
  };
}
