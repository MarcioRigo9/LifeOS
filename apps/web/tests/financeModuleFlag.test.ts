import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, enableFinanceModule } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { createFinancialAccount, listFinancialAccounts } from "@/lib/finance/accounts";
import { FinanceModuleDisabledError } from "@/lib/finance/financeGuard";

describe("Module flag enforcement (Fase 7 §1): households.module_finance_enabled gates every finance operation", () => {
  beforeEach(truncateAll);

  it("households are created with the finance module DISABLED by default (ADR 022)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FlagDefault1");
    const row = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT module_finance_enabled FROM households WHERE id = $1", [household.householdId])
    );
    expect(row.rows[0].module_finance_enabled).toBe(false);
  });

  it("a write fails immediately with a clear domain error when the module is disabled", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FlagOff1");

    await expect(
      createFinancialAccount(pool, { householdId: household.householdId, userId: household.userId, name: "Conta", type: "checking" })
    ).rejects.toThrow(FinanceModuleDisabledError);
  });

  it("a read fails immediately with the same domain error when the module is disabled", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FlagOff2");

    await expect(listFinancialAccounts(pool, { householdId: household.householdId, userId: household.userId })).rejects.toThrow(
      FinanceModuleDisabledError
    );
  });

  it("operations succeed once the household explicitly enables the module", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FlagOn1");
    await enableFinanceModule(pool, household);

    const account = await createFinancialAccount(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Conta Corrente",
      type: "checking",
      balanceCents: 10_000,
    });
    expect(account.id).toBeTruthy();

    const accounts = await listFinancialAccounts(pool, { householdId: household.householdId, userId: household.userId });
    expect(accounts).toHaveLength(1);
  });

  it("re-disabling the module blocks further writes again, even with existing data present", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FlagToggle1");
    await enableFinanceModule(pool, household);
    await createFinancialAccount(pool, { householdId: household.householdId, userId: household.userId, name: "Conta", type: "checking" });

    await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("UPDATE households SET module_finance_enabled = false WHERE id = $1", [household.householdId])
    );

    await expect(
      createFinancialAccount(pool, { householdId: household.householdId, userId: household.userId, name: "Conta 2", type: "savings" })
    ).rejects.toThrow(FinanceModuleDisabledError);
  });

  it("defense in depth: the DATABASE trigger blocks a direct INSERT even bypassing the application guard entirely", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FlagTrigger1");
    // Module deliberately left disabled — this INSERT goes straight to SQL, skipping
    // financeGuard.ts's assertFinanceModuleEnabled entirely, to prove the DB-level trigger
    // (enforce_finance_module_enabled, 0021_finance_schema.sql) is an INDEPENDENT second layer.
    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query(`INSERT INTO financial_accounts (household_id, name, type) VALUES ($1, 'Conta Direta', 'cash')`, [
          household.householdId,
        ])
      )
    ).rejects.toMatchObject({ code: "P0001" });
  });
});
