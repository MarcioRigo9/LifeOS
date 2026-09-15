import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { withHouseholdContext } from "@/lib/db/pool";
import { requireCapability } from "./capabilities";
import type { AgentTask } from "./contracts";
import { createDecisionProposal, type CreateProposalResult } from "./decisions";
import { gatherWeeklyPlanningContext } from "@/lib/nutrition/planningContext";
import { gatherWeeklyWorkoutPlanningContext } from "@/lib/fitness/planningContext";
import { handleGenerateWeeklyPlanTask } from "@/lib/nutrition/nutritionAgent";
import { handleGenerateWeeklyWorkoutPlanTask, handleWeeklyTrainingSummaryTask } from "@/lib/fitness/fitnessAgent";
import { handleWeeklyNutritionSummaryTask } from "@/lib/nutrition/nutritionAgent";
import { getRecentMeasurements } from "@/lib/health/measurements";
import { calculateWeightTrend, type WeightTrend } from "@/lib/domain/health";
import type { DailyTargets } from "@/lib/domain/nutrition";
import type { WeeklyPlanPerson } from "@/lib/nutrition/mealPlans";
import type { WorkoutPlanPerson } from "@/lib/fitness/workoutPlans";
import {
  computeVolumeChangePct,
  suggestCalorieAdjustmentKcal,
  adjustDailyTargetsForCalorieDelta,
  computeHabitAdherence,
} from "@/lib/domain/weeklyReview";
import { logAudit } from "@/lib/audit";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export interface RunWeeklyReviewParams {
  householdId: string;
  userId: string;
  weekStartDate: Date; // the week just ended (Monday) — the one being reviewed
}

export interface WeeklyReviewPersonReport {
  personId: string;
  displayName: string;
  weighIns: { count: number; trend: WeightTrend | null };
  training: {
    completedSessions: number;
    plannedSessionsPerWeek: number;
    totalTonnageKg: number;
    previousWeekTonnageKg: number;
    volumeChangePct: number | null;
  } | null;
  nutrition: { activeMealPlanId: string | null; plannedMealCount: number; dailyTargets: DailyTargets | null } | null;
  suggestedCalorieAdjustmentKcal: number;
}

export interface WeeklyReviewHabitReport {
  habitId: string;
  title: string;
  completedCount: number;
  totalLogged: number;
  missedCount: number;
  adherencePct: number;
}

export interface WeeklyReviewReport {
  weekStartDate: string;
  people: WeeklyReviewPersonReport[];
  habits: WeeklyReviewHabitReport[];
  deviations: string[];
}

export interface RunWeeklyReviewResult {
  weeklyReviewId: string;
  report: WeeklyReviewReport;
  proposal: CreateProposalResult | null;
}

/**
 * Fase 5 §2.2 — consolidates the last 7 days of measurements, workout adherence and habit
 * adherence into one report, then (when there's enough profile data) proposes a next-week
 * meal+workout plan package for human approval.
 *
 * Foundation-level data (profiles, measurements, habits) is read directly by the Coordinator —
 * same posture as coordinator.ts's buildHealthSummaryBlock. Nutrition/Fitness DOMAIN aggregation
 * (training tonnage, meal-plan adherence) always goes through an AgentTask to the owning
 * specialist and back (AGENT_CONTRACTS.md §14) — the Coordinator never queries workout_logs,
 * workout_sessions or meal_plans directly (Fase 5 non-negotiable rule).
 */
export async function runWeeklyReview(pool: Pool, params: RunWeeklyReviewParams): Promise<RunWeeklyReviewResult> {
  requireCapability({ agent: "coordinator", action: "read:measurements", resourceHouseholdId: params.householdId });
  requireCapability({ agent: "coordinator", action: "read:habit_logs", resourceHouseholdId: params.householdId });

  const previousWeekStartDate = new Date(params.weekStartDate.getTime() - MS_PER_WEEK);
  const weekEndDate = new Date(params.weekStartDate.getTime() + MS_PER_WEEK);

  const { profiles, habitLogRows } = await withHouseholdContext(
    pool,
    { userId: params.userId, householdId: params.householdId },
    async (client) => {
      const profilesRes = await client.query<{ id: string; display_name: string }>(
        "SELECT id, display_name FROM profiles WHERE household_id = $1",
        [params.householdId]
      );
      const habitLogsRes = await client.query<{ habit_id: string; title: string; completed: boolean }>(
        `SELECT hl.habit_id, h.title, hl.completed
         FROM habit_logs hl JOIN habits h ON h.id = hl.habit_id
         WHERE hl.household_id = $1 AND hl.logged_date >= $2 AND hl.logged_date < $3`,
        [params.householdId, params.weekStartDate, weekEndDate]
      );
      return { profiles: profilesRes.rows, habitLogRows: habitLogsRes.rows };
    }
  );

  const nutritionContext = await withHouseholdContext(
    pool,
    { userId: params.userId, householdId: params.householdId },
    (client) => gatherWeeklyPlanningContext(client, params.householdId)
  );
  const fitnessContext = await withHouseholdContext(
    pool,
    { userId: params.userId, householdId: params.householdId },
    (client) => gatherWeeklyWorkoutPlanningContext(client, params.householdId)
  );

  const people: WeeklyReviewPersonReport[] = [];
  const nextWeekNutritionPeople: WeeklyPlanPerson[] = [];
  const nextWeekFitnessPeople: WorkoutPlanPerson[] = [];
  const deviations: string[] = [];

  for (const profile of profiles) {
    const allMeasurements = await withHouseholdContext(
      pool,
      { userId: params.userId, householdId: params.householdId },
      (client) => getRecentMeasurements(client, profile.id, 100)
    );
    const weekWeighIns = allMeasurements.filter((m) => m.takenAt >= params.weekStartDate && m.takenAt < weekEndDate);
    const trend = calculateWeightTrend(weekWeighIns.map((m) => ({ takenAt: m.takenAt, weightKg: m.weightKg })));

    let training: WeeklyReviewPersonReport["training"] = null;
    const fitnessReady = fitnessContext.ready.find((p) => p.personId === profile.id);
    if (fitnessReady) {
      const trainingTask: AgentTask = {
        taskId: randomUUID(),
        requestId: randomUUID(),
        agent: "fitness",
        goal: "weekly_training_summary",
        context: {
          householdId: params.householdId,
          userId: params.userId,
          personId: profile.id,
          weekStartDate: params.weekStartDate.toISOString(),
          previousWeekStartDate: previousWeekStartDate.toISOString(),
        },
        suggestedRiskLevel: "low",
        idempotencyKey: `weekly-training-summary:${profile.id}:${params.weekStartDate.toISOString().slice(0, 10)}`,
        timeoutMs: 30_000,
      };
      const result = await handleWeeklyTrainingSummaryTask(pool, trainingTask);
      if (result.status === "completed") {
        const out = result.output as {
          completedSessions: number;
          plannedSessionsPerWeek: number;
          totalTonnageKg: number;
          previousWeekTonnageKg: number;
        };
        const volumeChangePct = computeVolumeChangePct(out.previousWeekTonnageKg, out.totalTonnageKg);
        training = { ...out, volumeChangePct };

        if (out.plannedSessionsPerWeek > 0 && out.completedSessions < out.plannedSessionsPerWeek) {
          deviations.push(
            `${profile.display_name}: completou ${out.completedSessions}/${out.plannedSessionsPerWeek} treinos planejados`
          );
        }
        if (volumeChangePct !== null && Math.abs(volumeChangePct) >= 20) {
          deviations.push(
            `${profile.display_name}: volume de treino ${volumeChangePct > 0 ? "subiu" : "caiu"} ${Math.abs(volumeChangePct)}%`
          );
        }
      }
    }

    let nutrition: WeeklyReviewPersonReport["nutrition"] = null;
    const nutritionReady = nutritionContext.ready.find((p) => p.personId === profile.id);
    if (nutritionReady) {
      const nutritionTask: AgentTask = {
        taskId: randomUUID(),
        requestId: randomUUID(),
        agent: "nutrition",
        goal: "weekly_nutrition_summary",
        context: {
          householdId: params.householdId,
          userId: params.userId,
          personId: profile.id,
          weekStartDate: params.weekStartDate.toISOString(),
        },
        suggestedRiskLevel: "low",
        idempotencyKey: `weekly-nutrition-summary:${profile.id}:${params.weekStartDate.toISOString().slice(0, 10)}`,
        timeoutMs: 30_000,
      };
      const result = await handleWeeklyNutritionSummaryTask(pool, nutritionTask);
      if (result.status === "completed") {
        nutrition = result.output as WeeklyReviewPersonReport["nutrition"];
      }
    }

    const suggestedCalorieAdjustmentKcal = training ? suggestCalorieAdjustmentKcal(training.volumeChangePct) : 0;

    people.push({
      personId: profile.id,
      displayName: profile.display_name,
      weighIns: { count: weekWeighIns.length, trend },
      training,
      nutrition,
      suggestedCalorieAdjustmentKcal,
    });

    if (nutritionReady) {
      const adjustedTargets =
        suggestedCalorieAdjustmentKcal !== 0
          ? adjustDailyTargetsForCalorieDelta(nutritionReady.dailyTargets, suggestedCalorieAdjustmentKcal)
          : nutritionReady.dailyTargets;
      nextWeekNutritionPeople.push({ personId: profile.id, dailyTargets: adjustedTargets });
    }
    if (fitnessReady) {
      nextWeekFitnessPeople.push(fitnessReady);
    }
  }

  const byHabit = new Map<string, { title: string; logs: { completed: boolean }[] }>();
  for (const row of habitLogRows) {
    if (!byHabit.has(row.habit_id)) byHabit.set(row.habit_id, { title: row.title, logs: [] });
    byHabit.get(row.habit_id)!.logs.push({ completed: row.completed });
  }
  const habitsReport: WeeklyReviewHabitReport[] = Array.from(byHabit.entries()).map(([habitId, { title, logs }]) => {
    const adherence = computeHabitAdherence(logs);
    if (adherence.missedCount > 0) {
      deviations.push(`hábito "${title}": ${adherence.missedCount} dia(s) sem cumprir`);
    }
    return { habitId, title, ...adherence };
  });

  const report: WeeklyReviewReport = {
    weekStartDate: params.weekStartDate.toISOString().slice(0, 10),
    people,
    habits: habitsReport,
    deviations,
  };

  // Next-week proposal package (Fase 5 §2.2) — only when at least one person has enough profile
  // data to generate BOTH a meal plan and a workout plan; a household missing biometrics gets a
  // review with no proposal, same "never invent, report the gap" posture as Fases 3-4.
  let proposal: CreateProposalResult | null = null;
  if (nextWeekNutritionPeople.length > 0 && nextWeekFitnessPeople.length > 0) {
    const nextWeekStart = weekEndDate; // the Monday right after the reviewed week

    const nutritionTask: AgentTask = {
      taskId: randomUUID(),
      requestId: randomUUID(),
      agent: "nutrition",
      goal: "generate_weekly_meal_plan",
      context: {
        householdId: params.householdId,
        userId: params.userId,
        weekStartDate: nextWeekStart.toISOString(),
        people: nextWeekNutritionPeople,
      },
      suggestedRiskLevel: "low",
      idempotencyKey: `weekly-review-nutrition:${params.householdId}:${nextWeekStart.toISOString().slice(0, 10)}`,
      timeoutMs: 30_000,
    };
    const nutritionResult = await handleGenerateWeeklyPlanTask(pool, nutritionTask);

    const fitnessTask: AgentTask = {
      taskId: randomUUID(),
      requestId: randomUUID(),
      agent: "fitness",
      goal: "generate_weekly_workout_plan",
      context: {
        householdId: params.householdId,
        userId: params.userId,
        weekStartDate: nextWeekStart.toISOString(),
        people: nextWeekFitnessPeople,
      },
      suggestedRiskLevel: "low",
      idempotencyKey: `weekly-review-fitness:${params.householdId}:${nextWeekStart.toISOString().slice(0, 10)}`,
      timeoutMs: 30_000,
    };
    const fitnessResult = await handleGenerateWeeklyWorkoutPlanTask(pool, fitnessTask);

    if (nutritionResult.status === "completed" && fitnessResult.status === "completed") {
      const mealPlanId = (nutritionResult.output as { mealPlanId: string }).mealPlanId;
      const workoutPlanIds = (fitnessResult.output as { plans: { workoutPlanId: string }[] }).plans.map(
        (p) => p.workoutPlanId
      );
      proposal = await proposeCompositePlanActivation(pool, {
        householdId: params.householdId,
        userId: params.userId,
        mealPlanId,
        workoutPlanIds,
      });
    }
  }

  const weeklyReviewId = await withHouseholdContext(
    pool,
    { userId: params.userId, householdId: params.householdId },
    async (client) => {
      requireCapability({ agent: "coordinator", action: "write:weekly_reviews", resourceHouseholdId: params.householdId });
      const decisionId = proposal && proposal.outcome === "proposed" ? proposal.decisionId : null;
      const res = await client.query<{ id: string }>(
        `INSERT INTO weekly_reviews (household_id, week_start_date, report_json, decision_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [params.householdId, params.weekStartDate, JSON.stringify(report), decisionId]
      );
      const weeklyReviewIdInserted = res.rows[0].id;

      // Session memory & synthesis (Fase 5 §2.4): a `decision` record of what this run concluded
      // (source_type='system' — it's a factual record of the run, not an inference, so confidence
      // stays at 1.0), plus, when deviations were found, a `learned_pattern` inference about the
      // couple's adherence this week (source_type='agent_inferred', confidence forced < 1.0 by
      // the agent_memories_learned_pattern_confidence constraint — never masquerades as confirmed).
      requireCapability({ agent: "coordinator", action: "write:agent_memories", resourceHouseholdId: params.householdId });
      await client.query(
        `INSERT INTO agent_memories (household_id, type, content_json, confidence, source_type, source_ref)
         VALUES ($1, 'decision', $2, 1.0, 'system', $3)`,
        [
          params.householdId,
          JSON.stringify({
            weeklyReviewId: weeklyReviewIdInserted,
            deviations,
            proposalHash: proposal && proposal.outcome === "proposed" ? proposal.proposalHash : null,
          }),
          `weekly_review:${weeklyReviewIdInserted}`,
        ]
      );
      if (deviations.length > 0) {
        await client.query(
          `INSERT INTO agent_memories (household_id, type, content_json, confidence, source_type, source_ref)
           VALUES ($1, 'learned_pattern', $2, 0.7, 'agent_inferred', $3)`,
          [
            params.householdId,
            JSON.stringify({ pattern: "weekly_adherence_deviation", deviations }),
            `weekly_review:${weeklyReviewIdInserted}`,
          ]
        );
      }

      await logAudit(client, {
        householdId: params.householdId,
        actorType: "system",
        eventType: "weekly_review.generated",
        entityType: "weekly_reviews",
        entityId: weeklyReviewIdInserted,
      });

      return weeklyReviewIdInserted;
    }
  );

  return { weeklyReviewId, report, proposal };
}

/**
 * A joint meal-plan + workout-plan(s) activation as ONE proposal_hash (Fase 5 non-negotiable
 * rule: composite actions are consolidated into atomic ActionEnvelopes, still gated MEDIUM risk
 * by the Policy Engine — never split into separate silent approvals). agentKey is "coordinator"
 * itself since the action spans two domains and belongs to neither specialist alone.
 */
export async function proposeCompositePlanActivation(
  pool: Pool,
  params: { householdId: string; userId: string; mealPlanId: string; workoutPlanIds: string[] }
): Promise<CreateProposalResult> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const mealRes = await client.query<{ id: string; version: number }>(
      "SELECT id, version FROM meal_plans WHERE id = $1",
      [params.mealPlanId]
    );
    if (mealRes.rowCount === 0) throw new Error("meal plan not found");

    const expectedVersions: Record<string, number> = {
      [`meal_plan:${params.mealPlanId}`]: mealRes.rows[0].version,
    };
    for (const workoutPlanId of params.workoutPlanIds) {
      const res = await client.query<{ id: string; version: number }>(
        "SELECT id, version FROM workout_plans WHERE id = $1",
        [workoutPlanId]
      );
      if (res.rowCount === 0) throw new Error(`workout plan ${workoutPlanId} not found`);
      expectedVersions[`workout_plan:${workoutPlanId}`] = res.rows[0].version;
    }

    return createDecisionProposal(client, {
      householdId: params.householdId,
      agentKey: "coordinator",
      envelope: {
        actionType: "composite.activate_plans",
        actionPayload: { mealPlanId: params.mealPlanId, workoutPlanIds: params.workoutPlanIds },
        targetEntityIds: [params.mealPlanId, ...params.workoutPlanIds],
        expectedVersions,
        scope: {
          householdId: params.householdId,
          entityCount: 1 + params.workoutPlanIds.length,
          reversible: true,
          financialImpactCents: 0,
        },
      },
    });
  });
}
