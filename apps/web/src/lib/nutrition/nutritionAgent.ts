import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import type { AgentTask, AgentTaskResult } from "@/lib/agents/contracts";
import { requireCapability } from "@/lib/agents/capabilities";
import { generateWeeklyMealPlan, proposeMealPlanActivation, getWeeklyNutritionSummary, type WeeklyPlanPerson } from "./mealPlans";
import { generateShoppingList } from "./shoppingLists";
import { gatherWeeklyPlanningContext } from "./planningContext";

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

interface WeeklyNutritionSummaryTaskContext {
  householdId: string;
  userId: string;
  personId: string;
  weekStartDate: string; // the week just ended (Monday, ISO)
}

/**
 * The Nutrition Agent's Fase 5 read-only capability, reached only via the Coordinator's Weekly
 * Review engine (AGENT_CONTRACTS.md §14). Reports whether the reviewed week had an active plan
 * and this person's current individualized daily targets — never applies anything, never talks
 * to Fitness directly.
 */
export async function handleWeeklyNutritionSummaryTask(pool: Pool, task: AgentTask): Promise<AgentTaskResult> {
  const ctx = task.context as unknown as WeeklyNutritionSummaryTaskContext;
  if (!ctx.householdId || !ctx.userId || !ctx.personId || !ctx.weekStartDate) {
    return {
      taskId: task.taskId,
      status: "failed",
      error: { code: "invalid_context", message: "householdId, userId, personId and weekStartDate are required" },
    };
  }
  requireCapability({ agent: "nutrition", action: "read:meal_plans", resourceHouseholdId: ctx.householdId });

  try {
    const output = await withHouseholdContext(pool, { userId: ctx.userId, householdId: ctx.householdId }, async (client) => {
      const summary = await getWeeklyNutritionSummary(client, {
        householdId: ctx.householdId,
        personId: ctx.personId,
        weekStartDate: new Date(ctx.weekStartDate),
      });
      const planningContext = await gatherWeeklyPlanningContext(client, ctx.householdId);
      const ready = planningContext.ready.find((p) => p.personId === ctx.personId);
      return {
        personId: ctx.personId,
        activeMealPlanId: summary.activeMealPlanId,
        plannedMealCount: summary.plannedMealCount,
        dailyTargets: ready?.dailyTargets ?? null,
      };
    });
    return { taskId: task.taskId, status: "completed", output };
  } catch (err) {
    return {
      taskId: task.taskId,
      status: "failed",
      error: { code: "summary_failed", message: err instanceof Error ? err.message : String(err) },
    };
  }
}
