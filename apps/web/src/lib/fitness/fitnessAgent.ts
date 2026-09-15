import type { Pool } from "pg";
import type { AgentTask, AgentTaskResult } from "@/lib/agents/contracts";
import { requireCapability } from "@/lib/agents/capabilities";
import { generateWeeklyWorkoutPlan, proposeWorkoutPlanActivation, type WorkoutPlanPerson } from "./workoutPlans";

interface GenerateWeeklyWorkoutPlanTaskContext {
  householdId: string;
  userId: string;
  weekStartDate: string;
  people: WorkoutPlanPerson[];
}

/**
 * The Fitness Agent's Fase 4 capability, reached only via the Coordinator (AGENT_CONTRACTS.md
 * §14). Builds DRAFT plans deterministically (packages/domain does the math and the
 * contraindication filtering; this function only orchestrates) and returns the result as an
 * AgentTaskResult — never applies anything itself.
 */
export async function handleGenerateWeeklyWorkoutPlanTask(pool: Pool, task: AgentTask): Promise<AgentTaskResult> {
  const ctx = task.context as unknown as GenerateWeeklyWorkoutPlanTaskContext;
  if (!ctx.householdId || !ctx.weekStartDate || !Array.isArray(ctx.people) || ctx.people.length === 0) {
    return {
      taskId: task.taskId,
      status: "failed",
      error: { code: "invalid_context", message: "householdId, weekStartDate and people are required" },
    };
  }
  requireCapability({ agent: "fitness", action: "write:workout_plans", resourceHouseholdId: ctx.householdId });

  try {
    const plans = await generateWeeklyWorkoutPlan(pool, {
      householdId: ctx.householdId,
      userId: ctx.userId,
      weekStartDate: new Date(ctx.weekStartDate),
      people: ctx.people,
    });
    return {
      taskId: task.taskId,
      status: "completed",
      output: { plans },
    };
  } catch (err) {
    return {
      taskId: task.taskId,
      status: "failed",
      error: { code: "generation_failed", message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function handleProposeWorkoutPlanActivationTask(pool: Pool, task: AgentTask): Promise<AgentTaskResult> {
  const ctx = task.context as { householdId: string; userId: string; workoutPlanId: string };
  requireCapability({ agent: "fitness", action: "write:workout_plans", resourceHouseholdId: ctx.householdId });

  const result = await proposeWorkoutPlanActivation(pool, ctx);
  if (result.outcome === "auto_execute") {
    return {
      taskId: task.taskId,
      status: "failed",
      error: { code: "unexpected_auto_execute", message: "workout_plan.activate must always require approval" },
    };
  }
  return { taskId: task.taskId, status: "proposed", decisionId: result.decisionId, output: { proposalHash: result.proposalHash } };
}
