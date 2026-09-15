import type { Pool } from "pg";
import type { AgentTask, AgentTaskResult } from "@/lib/agents/contracts";
import { requireCapability } from "@/lib/agents/capabilities";
import { generateWeeklyMealPlan, proposeMealPlanActivation, type WeeklyPlanPerson } from "./mealPlans";
import { generateShoppingList } from "./shoppingLists";

interface GenerateWeeklyPlanTaskContext {
  householdId: string;
  weekStartDate: string; // ISO date
  people: WeeklyPlanPerson[];
}

/**
 * The Nutrition Agent's one Fase 3 capability, reached only via the Coordinator
 * (AGENT_CONTRACTS.md §14: Coordinator -> specialist is the only delegation direction). Builds
 * a DRAFT plan + shopping list deterministically (packages/domain does the math, this function
 * only orchestrates) and returns the result as an AgentTaskResult — never applies anything
 * itself. Making the plan ACTIVE is a separate, explicit proposeMealPlanActivation() call,
 * gated by the Policy Engine as MEDIUM risk (mealPlans.ts).
 */
export async function handleGenerateWeeklyPlanTask(pool: Pool, task: AgentTask): Promise<AgentTaskResult> {
  const ctx = task.context as unknown as GenerateWeeklyPlanTaskContext;
  if (!ctx.householdId || !ctx.weekStartDate || !Array.isArray(ctx.people) || ctx.people.length === 0) {
    return {
      taskId: task.taskId,
      status: "failed",
      error: { code: "invalid_context", message: "householdId, weekStartDate and people are required" },
    };
  }
  requireCapability({ agent: "nutrition", action: "write:meal_plans", resourceHouseholdId: ctx.householdId });

  try {
    const plan = await generateWeeklyMealPlan(pool, {
      householdId: ctx.householdId,
      userId: task.context.userId as string,
      weekStartDate: new Date(ctx.weekStartDate),
      people: ctx.people,
    });

    const shoppingList = await generateShoppingList(pool, {
      householdId: ctx.householdId,
      userId: task.context.userId as string,
      mealPlanId: plan.mealPlanId,
    });

    return {
      taskId: task.taskId,
      status: "completed",
      output: {
        mealPlanId: plan.mealPlanId,
        itemCount: plan.items.length,
        shoppingListId: shoppingList.shoppingListId,
        totalCostCents: shoppingList.totalCostCents,
        itemsWithoutPrice: shoppingList.itemsWithoutPrice,
      },
    };
  } catch (err) {
    return {
      taskId: task.taskId,
      status: "failed",
      error: { code: "generation_failed", message: err instanceof Error ? err.message : String(err) },
    };
  }
}

/** Requests approval to make an existing draft/proposed plan the household's ACTIVE plan —
 * always MEDIUM risk (Policy Engine), never applied by this call itself. */
export async function handleProposeActivationTask(
  pool: Pool,
  task: AgentTask
): Promise<AgentTaskResult> {
  const ctx = task.context as { householdId: string; userId: string; mealPlanId: string };
  requireCapability({ agent: "nutrition", action: "write:meal_plans", resourceHouseholdId: ctx.householdId });
  const result = await proposeMealPlanActivation(pool, ctx);

  if (result.outcome === "auto_execute") {
    // Never expected for this actionType (evaluateRisk fixes meal_plan.activate at MEDIUM),
    // but handled explicitly rather than silently — no action is a bug we want to hide.
    return { taskId: task.taskId, status: "failed", error: { code: "unexpected_auto_execute", message: "meal_plan.activate must always require approval" } };
  }
  return { taskId: task.taskId, status: "proposed", decisionId: result.decisionId, output: { proposalHash: result.proposalHash } };
}
