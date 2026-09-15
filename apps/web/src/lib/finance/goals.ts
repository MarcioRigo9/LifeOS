import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { assertFinanceModuleEnabled } from "./financeGuard";
import type { FinancialGoal } from "@/lib/domain/finance";

export interface CreateFinancialGoalInput {
  householdId: string;
  userId: string;
  personId?: string;
  title: string;
  targetCents: number;
  currentCents?: number;
  deadline?: Date;
}

export async function createFinancialGoal(pool: Pool, input: CreateFinancialGoalInput): Promise<FinancialGoal> {
  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, input.householdId);
    const res = await client.query(
      `INSERT INTO financial_goals (household_id, person_id, title, target_cents, current_cents, deadline)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, household_id, person_id, title, target_cents, current_cents, deadline, version, created_at, updated_at`,
      [input.householdId, input.personId ?? null, input.title, input.targetCents, input.currentCents ?? 0, input.deadline ?? null]
    );
    return mapGoalRow(res.rows[0]);
  });
}

export class FinancialGoalVersionConflictError extends Error {
  constructor(public goalId: string, public expectedVersion: number) {
    super(`financial_goal ${goalId} version mismatch: expected ${expectedVersion}`);
  }
}

/** Optimistic concurrency (D017), same pattern as budgets.ts/goals.ts (the general, non-financial
 * one) and meal_plans/workout_plans. */
export async function updateFinancialGoalProgress(
  pool: Pool,
  params: { householdId: string; userId: string; goalId: string; expectedVersion: number; newCurrentCents: number }
): Promise<FinancialGoal> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    await assertFinanceModuleEnabled(client, params.householdId);
    const res = await client.query(
      `UPDATE financial_goals SET current_cents = $1, version = version + 1
       WHERE id = $2 AND version = $3
       RETURNING id, household_id, person_id, title, target_cents, current_cents, deadline, version, created_at, updated_at`,
      [params.newCurrentCents, params.goalId, params.expectedVersion]
    );
    if (res.rowCount === 0) {
      throw new FinancialGoalVersionConflictError(params.goalId, params.expectedVersion);
    }
    return mapGoalRow(res.rows[0]);
  });
}

function mapGoalRow(row: Record<string, unknown>): FinancialGoal {
  return {
    id: row.id as string,
    householdId: row.household_id as string,
    personId: row.person_id as string | null,
    title: row.title as string,
    targetCents: Number(row.target_cents),
    currentCents: Number(row.current_cents),
    deadline: row.deadline as Date | null,
    version: Number(row.version),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}
