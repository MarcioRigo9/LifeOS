import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, enableFinanceModule } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { createFinancialAccount } from "@/lib/finance/accounts";
import { createFinancialTransaction } from "@/lib/finance/transactions";
import { createFinancialGoal } from "@/lib/finance/goals";

describe("Regra de Ouro Monetária (D016): dinheiro é SEMPRE bigint em centavos, nunca float", () => {
  beforeEach(truncateAll);

  it("a decimal value sent to balance_cents is rejected by Postgres at the schema level, not silently truncated", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "GoldenRule1");
    await enableFinanceModule(pool, household);

    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query(
          `INSERT INTO financial_accounts (household_id, name, type, balance_cents) VALUES ($1, 'Conta Teste', 'checking', $2)`,
          [household.householdId, 199.99]
        )
      )
    ).rejects.toThrow();
  });

  it("a decimal value sent to amount_cents on a transaction is rejected the same way", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "GoldenRule2");
    await enableFinanceModule(pool, household);
    const account = await createFinancialAccount(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Conta Corrente",
      type: "checking",
    });

    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query(
          `INSERT INTO financial_transactions (household_id, account_id, amount_cents, type, transacted_at, description)
           VALUES ($1, $2, $3, 'expense', now(), 'compra')`,
          [household.householdId, account.id, 45.5]
        )
      )
    ).rejects.toThrow();
  });

  it("integer cents round-trip exactly — no floating point drift for real values (e.g. R$ 1.234,56)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "GoldenRule3");
    await enableFinanceModule(pool, household);

    const account = await createFinancialAccount(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Poupança",
      type: "savings",
      balanceCents: 123_456, // R$ 1.234,56
    });
    expect(account.balanceCents).toBe(123_456);
    expect(Number.isInteger(account.balanceCents)).toBe(true);

    const tx = await createFinancialTransaction(pool, {
      householdId: household.householdId,
      userId: household.userId,
      accountId: account.id,
      amountCents: 999_999_999, // large but well within JS's safe integer range
      type: "income",
      transactedAt: new Date(),
      description: "salário",
    });
    expect(tx.amountCents).toBe(999_999_999);
  });

  it("a zero-amount transaction is rejected (amount_cents <> 0)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "GoldenRule4");
    await enableFinanceModule(pool, household);
    const account = await createFinancialAccount(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Conta",
      type: "checking",
    });

    await expect(
      createFinancialTransaction(pool, {
        householdId: household.householdId,
        userId: household.userId,
        accountId: account.id,
        amountCents: 0,
        type: "expense",
        transactedAt: new Date(),
        description: "nada",
      })
    ).rejects.toThrow();
  });

  it("currency defaults to BRL and is stored as a fixed-width code, never mixed into the amount", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "GoldenRule5");
    await enableFinanceModule(pool, household);

    const account = await createFinancialAccount(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Conta",
      type: "checking",
    });
    expect(account.currency).toBe("BRL");
    expect(typeof account.balanceCents).toBe("number");

    const goal = await createFinancialGoal(pool, {
      householdId: household.householdId,
      userId: household.userId,
      title: "Reserva de emergência",
      targetCents: 5_000_000,
    });
    expect(goal.targetCents).toBe(5_000_000);
    expect(goal.currentCents).toBe(0);
  });
});
