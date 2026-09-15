import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { assertFinanceModuleEnabled } from "./financeGuard";
import type { FinancialAccount, FinancialAccountType } from "@/lib/domain/finance";
import { logAudit } from "@/lib/audit";

export interface CreateFinancialAccountInput {
  householdId: string;
  userId: string;
  personId?: string;
  name: string;
  type: FinancialAccountType;
  balanceCents?: number;
  currency?: string;
}

/**
 * Base guarded write — every finance/*.ts mutation starts with assertFinanceModuleEnabled
 * (Fase 7 spec §1). No Finance Agent, no route, no UI calls this yet (D009/ADR 022) — it exists
 * only to exercise and prove the schema/guard/RLS/constraints, which is exactly what this
 * phase's test battery checks.
 */
export async function createFinancialAccount(pool: Pool, input: CreateFinancialAccountInput): Promise<FinancialAccount> {
  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, input.householdId);

    const res = await client.query(
      `INSERT INTO financial_accounts (household_id, person_id, name, type, balance_cents, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, household_id, person_id, name, type, balance_cents, currency, active, created_at, updated_at`,
      [
        input.householdId,
        input.personId ?? null,
        input.name,
        input.type,
        input.balanceCents ?? 0,
        input.currency ?? "BRL",
      ]
    );
    await logAudit(client, {
      householdId: input.householdId,
      actorType: "user",
      actorId: input.userId,
      eventType: "financial_account.created",
      entityType: "financial_accounts",
      entityId: res.rows[0].id,
    });
    return mapAccountRow(res.rows[0]);
  });
}

export async function listFinancialAccounts(pool: Pool, params: { householdId: string; userId: string }): Promise<FinancialAccount[]> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, params.householdId);
    const res = await client.query(
      `SELECT id, household_id, person_id, name, type, balance_cents, currency, active, created_at, updated_at
       FROM financial_accounts WHERE household_id = $1 ORDER BY created_at`,
      [params.householdId]
    );
    return res.rows.map(mapAccountRow);
  });
}

function mapAccountRow(row: Record<string, unknown>): FinancialAccount {
  return {
    id: row.id as string,
    householdId: row.household_id as string,
    personId: row.person_id as string | null,
    name: row.name as string,
    type: row.type as FinancialAccountType,
    balanceCents: Number(row.balance_cents),
    currency: row.currency as string,
    active: row.active as boolean,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
