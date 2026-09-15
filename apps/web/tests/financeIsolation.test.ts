import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll, withTestAdminClient } from "./setup/testDb";
import { createHouseholdFixture, enableFinanceModule } from "./setup/fixtures";
import { withHouseholdContext } from "@/lib/db/pool";
import { createFinancialAccount } from "@/lib/finance/accounts";
import { createFinancialCreditCard } from "@/lib/finance/creditCards";
import { createFinancialTransaction } from "@/lib/finance/transactions";
import { createFinancialBudget } from "@/lib/finance/budgets";
import { createFinancialCategory } from "@/lib/finance/categories";

describe("Cross-household financial isolation (RLS, SECURITY_MODEL.md §3.1)", () => {
  beforeEach(truncateAll);

  it("Household A cannot read Household B's accounts, cards, transactions or budgets via a direct query with no WHERE clause", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "FinIsoA");
    const householdB = await createHouseholdFixture(pool, "FinIsoB");
    await enableFinanceModule(pool, householdA);
    await enableFinanceModule(pool, householdB);

    const accountB = await createFinancialAccount(pool, { householdId: householdB.householdId, userId: householdB.userId, name: "Conta B", type: "checking" });
    const cardB = await createFinancialCreditCard(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      name: "Cartão B",
      limitCents: 500_000,
      closingDay: 10,
      dueDay: 20,
    });
    const categoryB = await createFinancialCategory(pool, { householdId: householdB.householdId, userId: householdB.userId, name: "Categoria B", type: "expense" });
    await createFinancialTransaction(pool, {
      householdId: householdB.householdId,
      userId: householdB.userId,
      accountId: accountB.id,
      amountCents: 1000,
      type: "expense",
      transactedAt: new Date(),
      description: "compra B",
    });
    await createFinancialBudget(pool, { householdId: householdB.householdId, userId: householdB.userId, categoryId: categoryB.id, month: 1, year: 2026, targetCents: 100_000 });

    // A deliberately unfiltered query, run under Household A's session context — RLS must be
    // the thing preventing leakage, not an application-level WHERE that a query could forget.
    const seenByA = await withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, async (client) => {
      const accounts = await client.query("SELECT * FROM financial_accounts");
      const cards = await client.query("SELECT * FROM financial_credit_cards");
      const transactions = await client.query("SELECT * FROM financial_transactions");
      const budgets = await client.query("SELECT * FROM financial_budgets");
      return { accounts: accounts.rowCount, cards: cards.rowCount, transactions: transactions.rowCount, budgets: budgets.rowCount };
    });
    expect(seenByA).toEqual({ accounts: 0, cards: 0, transactions: 0, budgets: 0 });

    // And confirm B really does see its own rows (proves the emptiness above is isolation, not
    // a broken query).
    const seenByB = await withHouseholdContext(pool, { userId: householdB.userId, householdId: householdB.householdId }, (client) =>
      client.query("SELECT count(*) FROM financial_accounts")
    );
    expect(Number(seenByB.rows[0].count)).toBe(1);
    void cardB;
  });

  it("Household A cannot INSERT a financial_account tagged with Household B's household_id (RLS WITH CHECK)", async () => {
    const pool = getTestRuntimePool();
    const householdA = await createHouseholdFixture(pool, "FinIsoC");
    const householdB = await createHouseholdFixture(pool, "FinIsoD");
    await enableFinanceModule(pool, householdA);
    await enableFinanceModule(pool, householdB);

    await expect(
      withHouseholdContext(pool, { userId: householdA.userId, householdId: householdA.householdId }, (client) =>
        client.query(`INSERT INTO financial_accounts (household_id, name, type) VALUES ($1, 'Conta Forjada', 'checking')`, [
          householdB.householdId,
        ])
      )
    ).rejects.toThrow();
  });

  it("global financial_categories (household_id IS NULL) are readable by any household, but a household can never insert one itself", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinIsoE");
    await enableFinanceModule(pool, household);
    // Seeded as a system-level global default via an admin connection (bypasses RLS) — never
    // through a household's own write path, which the next assertion proves is impossible.
    await withTestAdminClient((client) =>
      client.query(`INSERT INTO financial_categories (household_id, name, type) VALUES (NULL, 'Moradia', 'expense')`)
    );

    const seen = await withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
      client.query("SELECT name FROM financial_categories WHERE household_id IS NULL")
    );
    expect(seen.rows.map((r) => r.name)).toContain("Moradia");

    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query(`INSERT INTO financial_categories (household_id, name, type) VALUES (NULL, 'Categoria Forjada', 'expense')`)
      )
    ).rejects.toThrow();
  });
});
