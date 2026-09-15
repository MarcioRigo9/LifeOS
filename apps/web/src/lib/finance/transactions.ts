import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { assertFinanceModuleEnabled } from "./financeGuard";
import type { FinancialTransaction, FinancialTransactionType } from "@/lib/domain/finance";
import { logAudit } from "@/lib/audit";

export interface CreateFinancialTransactionInput {
  householdId: string;
  userId: string;
  accountId?: string;
  creditCardId?: string;
  categoryId?: string;
  personId?: string;
  amountCents: number;
  currency?: string;
  type: FinancialTransactionType;
  transactedAt: Date;
  description: string;
}

/** Append-only (0022_finance_grants.sql: no UPDATE/DELETE grant) — a correction is a new
 * transaction, never editing what already happened. financial_transactions_needs_a_source
 * (0021_finance_schema.sql) rejects a transaction with neither accountId nor creditCardId. */
export async function createFinancialTransaction(pool: Pool, input: CreateFinancialTransactionInput): Promise<FinancialTransaction> {
  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, input.householdId);
    const res = await client.query(
      `INSERT INTO financial_transactions
         (household_id, account_id, credit_card_id, category_id, person_id, amount_cents, currency, type, transacted_at, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, household_id, account_id, credit_card_id, category_id, person_id, amount_cents, currency, type, transacted_at, description, created_at`,
      [
        input.householdId,
        input.accountId ?? null,
        input.creditCardId ?? null,
        input.categoryId ?? null,
        input.personId ?? null,
        input.amountCents,
        input.currency ?? "BRL",
        input.type,
        input.transactedAt,
        input.description,
      ]
    );
    await logAudit(client, {
      householdId: input.householdId,
      actorType: "user",
      actorId: input.userId,
      eventType: "financial_transaction.created",
      entityType: "financial_transactions",
      entityId: res.rows[0].id,
    });
    return mapTransactionRow(res.rows[0]);
  });
}

export async function listFinancialTransactions(
  pool: Pool,
  params: { householdId: string; userId: string; limit?: number }
): Promise<FinancialTransaction[]> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, params.householdId);
    const res = await client.query(
      `SELECT id, household_id, account_id, credit_card_id, category_id, person_id, amount_cents, currency, type, transacted_at, description, created_at
       FROM financial_transactions WHERE household_id = $1 ORDER BY transacted_at DESC LIMIT $2`,
      [params.householdId, params.limit ?? 100]
    );
    return res.rows.map(mapTransactionRow);
  });
}

function mapTransactionRow(row: Record<string, unknown>): FinancialTransaction {
  return {
    id: row.id as string,
    householdId: row.household_id as string,
    accountId: row.account_id as string | null,
    creditCardId: row.credit_card_id as string | null,
    categoryId: row.category_id as string | null,
    personId: row.person_id as string | null,
    amountCents: Number(row.amount_cents),
    currency: row.currency as string,
    type: row.type as FinancialTransactionType,
    transactedAt: row.transacted_at as Date,
    description: row.description as string,
    createdAt: row.created_at as Date,
  };
}
