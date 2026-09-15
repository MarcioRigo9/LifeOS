import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { assertFinanceModuleEnabled } from "./financeGuard";
import type { FinancialCreditCard } from "@/lib/domain/finance";

export interface CreateFinancialCreditCardInput {
  householdId: string;
  userId: string;
  personId?: string;
  name: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  currency?: string;
}

export async function createFinancialCreditCard(pool: Pool, input: CreateFinancialCreditCardInput): Promise<FinancialCreditCard> {
  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, input.householdId);
    const res = await client.query(
      `INSERT INTO financial_credit_cards (household_id, person_id, name, limit_cents, closing_day, due_day, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, household_id, person_id, name, limit_cents, closing_day, due_day, currency, created_at, updated_at`,
      [
        input.householdId,
        input.personId ?? null,
        input.name,
        input.limitCents,
        input.closingDay,
        input.dueDay,
        input.currency ?? "BRL",
      ]
    );
    return mapCreditCardRow(res.rows[0]);
  });
}

function mapCreditCardRow(row: Record<string, unknown>): FinancialCreditCard {
  return {
    id: row.id as string,
    householdId: row.household_id as string,
    personId: row.person_id as string | null,
    name: row.name as string,
    limitCents: Number(row.limit_cents),
    closingDay: Number(row.closing_day),
    dueDay: Number(row.due_day),
    currency: row.currency as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
