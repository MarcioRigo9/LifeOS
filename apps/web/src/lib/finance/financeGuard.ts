import type { PoolClient } from "pg";

/** Domain-level error — distinguishable from a generic Postgres error, so callers (and tests)
 * can assert on `err instanceof FinanceModuleDisabledError` rather than parsing a message. */
export class FinanceModuleDisabledError extends Error {
  constructor(public householdId: string) {
    super(`finance module is not enabled for household ${householdId}`);
  }
}

/**
 * The application-level half of the module-flag enforcement (Fase 7 spec §1: "toda tentativa de
 * mutação ou leitura de dados financeiros via serviço de aplicação deve verificar
 * households.module_finance_enabled"). Every finance/*.ts function calls this FIRST, before
 * touching any financial_* table — fails fast with a clear domain error rather than letting a
 * disabled household's request reach the database at all.
 *
 * This is deliberately duplicated by a database trigger (enforce_finance_module_enabled,
 * 0021_finance_schema.sql) as an independent second layer — same "duas camadas independentes"
 * posture as household_id filtering + RLS (ADR 014) elsewhere in this codebase. A bug here does
 * not remove the database-level guarantee, and vice versa.
 */
export async function assertFinanceModuleEnabled(client: PoolClient, householdId: string): Promise<void> {
  const res = await client.query<{ module_finance_enabled: boolean }>(
    "SELECT module_finance_enabled FROM households WHERE id = $1",
    [householdId]
  );
  if (!res.rows[0]?.module_finance_enabled) {
    throw new FinanceModuleDisabledError(householdId);
  }
}
