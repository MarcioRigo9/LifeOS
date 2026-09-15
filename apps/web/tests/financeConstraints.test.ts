import { beforeEach, describe, expect, it } from "vitest";
import { getTestRuntimePool, truncateAll } from "./setup/testDb";
import { createHouseholdFixture, enableFinanceModule } from "./setup/fixtures";
import { createFinancialAccount } from "@/lib/finance/accounts";
import { createFinancialCreditCard } from "@/lib/finance/creditCards";
import { createFinancialCategory } from "@/lib/finance/categories";
import { createFinancialTransaction } from "@/lib/finance/transactions";
import { createFinancialBudget, updateFinancialBudgetTarget, FinancialBudgetVersionConflictError } from "@/lib/finance/budgets";
import { createFinancialGoal, updateFinancialGoalProgress, FinancialGoalVersionConflictError } from "@/lib/finance/goals";
import { withHouseholdContext } from "@/lib/db/pool";

describe("Financial schema constraint integrity (Fase 7 §2.1)", () => {
  beforeEach(truncateAll);

  it("a transaction with NEITHER account_id NOR credit_card_id is rejected", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinConstraint1");
    await enableFinanceModule(pool, household);

    await expect(
      createFinancialTransaction(pool, {
        householdId: household.householdId,
        userId: household.userId,
        amountCents: 5000,
        type: "expense",
        transactedAt: new Date(),
        description: "sem origem",
      })
    ).rejects.toThrow();
  });

  it("a transaction with an account_id alone succeeds", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinConstraint2");
    await enableFinanceModule(pool, household);
    const account = await createFinancialAccount(pool, { householdId: household.householdId, userId: household.userId, name: "Conta", type: "checking" });

    const tx = await createFinancialTransaction(pool, {
      householdId: household.householdId,
      userId: household.userId,
      accountId: account.id,
      amountCents: 5000,
      type: "expense",
      transactedAt: new Date(),
      description: "mercado",
    });
    expect(tx.accountId).toBe(account.id);
    expect(tx.creditCardId).toBeNull();
  });

  it("a transaction with a credit_card_id alone succeeds", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinConstraint3");
    await enableFinanceModule(pool, household);
    const card = await createFinancialCreditCard(pool, {
      householdId: household.householdId,
      userId: household.userId,
      name: "Cartão",
      limitCents: 300_000,
      closingDay: 5,
      dueDay: 15,
    });

    const tx = await createFinancialTransaction(pool, {
      householdId: household.householdId,
      userId: household.userId,
      creditCardId: card.id,
      amountCents: 12_000,
      type: "expense",
      transactedAt: new Date(),
      description: "compra no cartão",
    });
    expect(tx.creditCardId).toBe(card.id);
    expect(tx.accountId).toBeNull();
  });

  it("a credit card's closing_day/due_day outside 1-31 is rejected", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinConstraint4");
    await enableFinanceModule(pool, household);

    await expect(
      createFinancialCreditCard(pool, { householdId: household.householdId, userId: household.userId, name: "Cartão Inválido", limitCents: 100_000, closingDay: 32, dueDay: 10 })
    ).rejects.toThrow();
  });

  it("a financial_debt with remaining_cents greater than total_cents is rejected", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinConstraint5");
    await enableFinanceModule(pool, household);

    await expect(
      withHouseholdContext(pool, { userId: household.userId, householdId: household.householdId }, (client) =>
        client.query(
          `INSERT INTO financial_debts (household_id, name, total_cents, remaining_cents) VALUES ($1, 'Dívida', 100000, 200000)`,
          [household.householdId]
        )
      )
    ).rejects.toThrow();
  });

  it("a duplicate budget for the same household/category/month/year is rejected", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinConstraint6");
    await enableFinanceModule(pool, household);
    const category = await createFinancialCategory(pool, { householdId: household.householdId, userId: household.userId, name: "Lazer", type: "expense" });

    await createFinancialBudget(pool, { householdId: household.householdId, userId: household.userId, categoryId: category.id, month: 3, year: 2026, targetCents: 50_000 });
    await expect(
      createFinancialBudget(pool, { householdId: household.householdId, userId: household.userId, categoryId: category.id, month: 3, year: 2026, targetCents: 70_000 })
    ).rejects.toThrow();
  });

  it("optimistic concurrency on financial_budgets: a stale version is rejected, matching version succeeds (D017)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinConstraint7");
    await enableFinanceModule(pool, household);
    const category = await createFinancialCategory(pool, { householdId: household.householdId, userId: household.userId, name: "Transporte", type: "expense" });
    const budget = await createFinancialBudget(pool, { householdId: household.householdId, userId: household.userId, categoryId: category.id, month: 4, year: 2026, targetCents: 40_000 });
    expect(budget.version).toBe(1);

    await expect(
      updateFinancialBudgetTarget(pool, { householdId: household.householdId, userId: household.userId, budgetId: budget.id, expectedVersion: 99, newTargetCents: 45_000 })
    ).rejects.toThrow(FinancialBudgetVersionConflictError);

    const updated = await updateFinancialBudgetTarget(pool, { householdId: household.householdId, userId: household.userId, budgetId: budget.id, expectedVersion: 1, newTargetCents: 45_000 });
    expect(updated.version).toBe(2);
    expect(updated.targetCents).toBe(45_000);
  });

  it("optimistic concurrency on financial_goals: a stale version is rejected, matching version succeeds (D017)", async () => {
    const pool = getTestRuntimePool();
    const household = await createHouseholdFixture(pool, "FinConstraint8");
    await enableFinanceModule(pool, household);
    const goal = await createFinancialGoal(pool, { householdId: household.householdId, userId: household.userId, title: "Viagem", targetCents: 800_000 });
    expect(goal.version).toBe(1);

    await expect(
      updateFinancialGoalProgress(pool, { householdId: household.householdId, userId: household.userId, goalId: goal.id, expectedVersion: 7, newCurrentCents: 100_000 })
    ).rejects.toThrow(FinancialGoalVersionConflictError);

    const updated = await updateFinancialGoalProgress(pool, { householdId: household.householdId, userId: household.userId, goalId: goal.id, expectedVersion: 1, newCurrentCents: 100_000 });
    expect(updated.version).toBe(2);
    expect(updated.currentCents).toBe(100_000);
  });
});
