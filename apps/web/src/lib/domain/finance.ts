// Fase 7 (Finance Ready) — pure TypeScript typing of every financial entity. Deliberately no
// business logic/math here yet (D009/ADR 022: the Finance Agent itself is not implemented in
// this phase) — this module exists only so the schema's shape has a typed counterpart, the same
// role domain/health.ts, domain/nutrition.ts and domain/fitness.ts play for their tables.
//
// D016: every monetary value is an integer number of cents — never a float. Represented here as
// `number` (not `bigint`): JS's safe integer range (±2^53) comfortably covers any real
// household's cents-denominated balance, matching how the rest of the codebase already reads
// Postgres bigint/numeric columns (e.g. shoppingLists.ts's totalCostCents).

export type FinancialAccountType = "checking" | "savings" | "investment" | "cash";
export type FinancialCategoryType = "income" | "expense";
export type FinancialTransactionType = "income" | "expense" | "transfer";

export interface FinancialAccount {
  id: string;
  householdId: string;
  personId: string | null;
  name: string;
  type: FinancialAccountType;
  balanceCents: number;
  currency: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialCreditCard {
  id: string;
  householdId: string;
  personId: string | null;
  name: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialCategory {
  id: string;
  householdId: string | null; // null = global/system default category
  name: string;
  type: FinancialCategoryType;
  createdAt: Date;
}

export interface FinancialTransaction {
  id: string;
  householdId: string;
  accountId: string | null;
  creditCardId: string | null;
  categoryId: string | null;
  personId: string | null;
  amountCents: number;
  currency: string;
  type: FinancialTransactionType;
  transactedAt: Date;
  description: string;
  createdAt: Date;
}

export interface FinancialDebt {
  id: string;
  householdId: string;
  personId: string | null;
  name: string;
  totalCents: number;
  remainingCents: number;
  interestRateMonthly: number | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialBudget {
  id: string;
  householdId: string;
  categoryId: string;
  month: number; // 1-12
  year: number;
  targetCents: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialGoal {
  id: string;
  householdId: string;
  personId: string | null;
  title: string;
  targetCents: number;
  currentCents: number;
  deadline: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
