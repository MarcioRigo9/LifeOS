import type { Pool, PoolClient } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import type { AIProvider } from "@/lib/ai-provider/types";
import { requireCapability, checkCapability } from "./capabilities";
import { classifyHealthSafety, MEDICAL_BOUNDARY_FALLBACK_REPLY } from "./healthSafety";
import { getLatestMeasurement, getRecentMeasurements } from "@/lib/health/measurements";
import { calculateWeightTrend } from "@/lib/domain/health";
import { logAudit } from "@/lib/audit";
import { isMealPlanRequest } from "./nutritionIntent";
import { gatherWeeklyPlanningContext, nextMonday } from "@/lib/nutrition/planningContext";
import { handleGenerateWeeklyPlanTask } from "@/lib/nutrition/nutritionAgent";
import { isWorkoutPlanRequest } from "./fitnessIntent";
import { gatherWeeklyWorkoutPlanningContext } from "@/lib/fitness/planningContext";
import { handleGenerateWeeklyWorkoutPlanTask } from "@/lib/fitness/fitnessAgent";
import { isCompositeTransformationRequest, extractTargetKg } from "./compositeIntent";
import type { AgentTask } from "./contracts";
import { randomUUID } from "node:crypto";

export interface CoordinatorInvocation {
  requestId: string;
  householdId: string;
  userId: string;
  personId?: string;
  conversationId?: string;
  message: string;
}

export interface CoordinatorResponse {
  requestId: string;
  conversationId: string;
  reply: string;
}

const COORDINATOR_SYSTEM_PROMPT =
  "Você é o Coordinator do LifeOS, o único ponto de contato do usuário nesta Fase 1/2. " +
  "Responda de forma breve e direta. Você pode discutir tendências de peso e medidas de forma " +
  "geral, mas nunca em linguagem diagnóstica.";

/** AGENT_CONTRACTS.md §7 style label around our own structured data — not user-supplied, but
 * still injected as clearly delimited context, never concatenated indistinguishably into the
 * system prompt (SECURITY_MODEL.md §7). */
async function buildHealthSummaryBlock(
  client: PoolClient,
  householdId: string,
  personId: string
): Promise<string | null> {
  if (checkCapability({ agent: "coordinator", action: "read:measurements", resourceHouseholdId: householdId }) !== "allow") {
    return null;
  }
  const latest = await getLatestMeasurement(client, personId);
  if (!latest) return null;
  const recent = await getRecentMeasurements(client, personId, 10);
  const trend = calculateWeightTrend(recent.map((m) => ({ takenAt: m.takenAt, weightKg: m.weightKg })));

  const lines = [`peso mais recente: ${latest.weightKg}kg em ${latest.takenAt.toISOString().slice(0, 10)}`];
  if (trend) {
    lines.push(`tendência (${trend.daysSpanned}d): ${trend.direction}, delta ${trend.deltaKg}kg`);
  }
  return `<health_summary>${lines.join("; ")}</health_summary>`;
}

/**
 * AGENT_CONTRACTS.md §2: Coordinator mínimo (Fase 1), estendido na Fase 2 com o Medical
 * Safety boundary (SECURITY_MODEL.md §13) e um resumo de saúde recente quando `personId` é
 * conhecido. Persists the user's turn BEFORE processing, calls the AI Provider (skipping it
 * entirely when the medical boundary triggers), persists the reply, and records the
 * agent_run — so a crash mid-request never loses the conversation (CONV-002).
 */
export async function handleCoordinatorInvocation(
  pool: Pool,
  input: CoordinatorInvocation,
  deps: { aiProvider: AIProvider; modelId: string }
): Promise<CoordinatorResponse> {
  requireCapability({ agent: "coordinator", action: "write:messages", resourceHouseholdId: input.householdId });

  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    let conversationId = input.conversationId;
    if (!conversationId) {
      const res = await client.query<{ id: string }>(
        "INSERT INTO conversations (household_id) VALUES ($1) RETURNING id",
        [input.householdId]
      );
      conversationId = res.rows[0].id;
    }

    // Persist the user's turn before doing anything else (AGENT_CONTRACTS.md §2).
    await client.query(
      `INSERT INTO messages (household_id, conversation_id, person_id, role, content)
       VALUES ($1, $2, $3, 'user', $4)`,
      [input.householdId, conversationId, input.personId ?? null, input.message]
    );

    const agentRow = await client.query<{ id: string }>("SELECT id FROM agents WHERE key = 'coordinator'", []);
    const agentId = agentRow.rows[0].id;

    const runRes = await client.query<{ id: string }>(
      `INSERT INTO agent_runs (household_id, request_id, conversation_id, agent_id, status)
       VALUES ($1, $2, $3, $4, 'running')
       RETURNING id`,
      [input.householdId, input.requestId, conversationId, agentId]
    );
    const agentRunId = runRes.rows[0].id;

    // Deterministic, keyword-based gate — runs BEFORE the AI Provider is ever invoked, so a
    // medical-boundary message is never handed to the LLM to diagnose/prescribe
    // (SECURITY_MODEL.md §13: "não só julgamento do LLM").
    const safetyTier = classifyHealthSafety(input.message);
    if (safetyTier === "medical") {
      const reply = MEDICAL_BOUNDARY_FALLBACK_REPLY;
      await client.query(
        `INSERT INTO messages (household_id, conversation_id, role, agent_id, content)
         VALUES ($1, $2, 'agent', $3, $4)`,
        [input.householdId, conversationId, agentId, reply]
      );
      await client.query(
        `UPDATE agent_runs SET status = 'completed', finished_at = now(), result_json = $2 WHERE id = $1`,
        [agentRunId, JSON.stringify({ reply, healthSafetyTier: safetyTier })]
      );
      await logAudit(client, {
        householdId: input.householdId,
        actorType: "system",
        eventType: "health_safety.medical_boundary_triggered",
        entityType: "agent_runs",
        entityId: agentRunId,
        requestId: input.requestId,
        reason: "message matched a medical-tier pattern; AI Provider was not called",
      });
      return { requestId: input.requestId, conversationId, reply };
    }

    // Cross-domain orchestration (Fase 5 §2.1): a single message describing a composite,
    // body-recomposition style goal ("secar mantendo massa") decomposes into a Nutrition task
    // AND a Fitness task, both reached only through the Coordinator — strict star topology,
    // Nutrition and Fitness never call each other directly (AGENT_CONTRACTS.md §14).
    // Checked BEFORE the single-domain classifiers below since it's the more specific match.
    if (isCompositeTransformationRequest(input.message)) {
      const nutritionContext = await gatherWeeklyPlanningContext(client, input.householdId);
      const fitnessContext = await gatherWeeklyWorkoutPlanningContext(client, input.householdId);
      const weekStart = nextMonday();
      let reply: string;
      const delegatedOutputs: Record<string, unknown> = {};

      if (nutritionContext.ready.length === 0 && fitnessContext.ready.length === 0) {
        reply = "Ainda não consigo montar um plano combinado — faltam dados de perfil (biometria, meta, medida).";
      } else {
        const parts: string[] = [];

        if (nutritionContext.ready.length > 0) {
          const nutritionTask: AgentTask = {
            taskId: randomUUID(),
            requestId: input.requestId,
            agent: "nutrition",
            goal: "generate_weekly_meal_plan",
            context: { householdId: input.householdId, userId: input.userId, weekStartDate: weekStart.toISOString(), people: nutritionContext.ready },
            suggestedRiskLevel: "low",
            idempotencyKey: `composite-nutrition:${input.householdId}:${weekStart.toISOString().slice(0, 10)}`,
            timeoutMs: 30_000,
          };
          const nutritionResult = await handleGenerateWeeklyPlanTask(pool, nutritionTask);
          delegatedOutputs.nutrition = nutritionResult;
          if (nutritionResult.status === "completed") {
            const out = nutritionResult.output as { itemCount: number };
            parts.push(`um plano alimentar (rascunho, ${out.itemCount} refeições) voltado à perda de peso preservando proteína`);
          }
        }

        if (fitnessContext.ready.length > 0) {
          const fitnessTask: AgentTask = {
            taskId: randomUUID(),
            requestId: input.requestId,
            agent: "fitness",
            goal: "generate_weekly_workout_plan",
            context: { householdId: input.householdId, userId: input.userId, weekStartDate: weekStart.toISOString(), people: fitnessContext.ready },
            suggestedRiskLevel: "low",
            idempotencyKey: `composite-fitness:${input.householdId}:${weekStart.toISOString().slice(0, 10)}`,
            timeoutMs: 30_000,
          };
          const fitnessResult = await handleGenerateWeeklyWorkoutPlanTask(pool, fitnessTask);
          delegatedOutputs.fitness = fitnessResult;
          if (fitnessResult.status === "completed") {
            const out = fitnessResult.output as { plans: { itemCount: number }[] };
            const totalItems = out.plans.reduce((s, p) => s + p.itemCount, 0);
            parts.push(`um plano de treino (rascunho, ${totalItems} exercícios) para preservar massa magra`);
          }
        }

        reply = parts.length > 0
          ? `Montei ${parts.join(" e ")}. Ambos ainda em rascunho — precisam da sua aprovação para valer.`
          : "Não consegui montar o plano combinado agora.";

        // Session memory (Fase 5 §2.4): an inference about a body-recomposition goal, never a
        // confirmed fact — confidence forced below 1.0 by the learned_pattern DB constraint.
        requireCapability({ agent: "coordinator", action: "write:agent_memories", resourceHouseholdId: input.householdId });
        await client.query(
          `INSERT INTO agent_memories (household_id, person_id, type, content_json, confidence, source_type, source_ref)
           VALUES ($1, $2, 'learned_pattern', $3, $4, 'agent_inferred', $5)`,
          [
            input.householdId,
            input.personId ?? null,
            JSON.stringify({ pattern: "body_recomposition_goal", targetKg: extractTargetKg(input.message), detectedFromMessage: true }),
            0.6,
            `coordinator_run:${agentRunId}`,
          ]
        );
      }

      await client.query(
        `INSERT INTO messages (household_id, conversation_id, role, agent_id, content) VALUES ($1, $2, 'agent', $3, $4)`,
        [input.householdId, conversationId, agentId, reply]
      );
      await client.query(
        `UPDATE agent_runs SET status = 'completed', finished_at = now(), result_json = $2 WHERE id = $1`,
        [agentRunId, JSON.stringify({ reply, delegatedTo: ["nutrition", "fitness"], delegatedOutputs })]
      );
      return { requestId: input.requestId, conversationId, reply };
    }

    // Deterministic delegation (AGENT_CONTRACTS.md §1, §14: Coordinator -> specialist,
    // never the reverse) — the Coordinator decides WHETHER to delegate via a keyword
    // classifier, not by asking the LLM, keeping routing auditable without a network call.
    if (isMealPlanRequest(input.message)) {
      const planningContext = await gatherWeeklyPlanningContext(client, input.householdId);
      let reply: string;
      let delegatedOutput: unknown;

      if (planningContext.ready.length === 0) {
        const missingList = planningContext.incomplete
          .map((p) => `${p.displayName} (falta: ${p.missing.join(", ")})`)
          .join("; ");
        reply = planningContext.incomplete.length > 0
          ? `Ainda não consigo montar um plano — faltam dados: ${missingList}.`
          : "Ainda não há perfis configurados para montar um plano alimentar.";
      } else {
        const task: AgentTask = {
          taskId: randomUUID(),
          requestId: input.requestId,
          agent: "nutrition",
          goal: "generate_weekly_meal_plan",
          context: { householdId: input.householdId, userId: input.userId, weekStartDate: nextMonday().toISOString(), people: planningContext.ready },
          suggestedRiskLevel: "low",
          idempotencyKey: `weekly-plan:${input.householdId}:${nextMonday().toISOString().slice(0, 10)}`,
          timeoutMs: 30_000,
        };
        const result = await handleGenerateWeeklyPlanTask(pool, task);
        delegatedOutput = result;
        if (result.status === "completed") {
          const out = result.output as { itemCount: number; totalCostCents: number; itemsWithoutPrice: string[] };
          const costReais = (out.totalCostCents / 100).toFixed(2);
          reply = `Plano semanal (rascunho) gerado com ${out.itemCount} refeições. Lista de compras estimada em R$ ${costReais}.`;
          if (out.itemsWithoutPrice.length > 0) {
            reply += ` Sem preço disponível para: ${out.itemsWithoutPrice.length} item(ns).`;
          }
          reply += " Este plano ainda não está ativo — precisa da sua aprovação para valer.";
        } else {
          reply = `Não consegui gerar o plano: ${result.error?.message ?? "erro desconhecido"}.`;
        }
        if (planningContext.incomplete.length > 0) {
          reply += ` (Não incluí: ${planningContext.incomplete.map((p) => p.displayName).join(", ")} — perfil incompleto.)`;
        }
      }

      await client.query(
        `INSERT INTO messages (household_id, conversation_id, role, agent_id, content) VALUES ($1, $2, 'agent', $3, $4)`,
        [input.householdId, conversationId, agentId, reply]
      );
      await client.query(
        `UPDATE agent_runs SET status = 'completed', finished_at = now(), result_json = $2 WHERE id = $1`,
        [agentRunId, JSON.stringify({ reply, delegatedTo: "nutrition", delegatedOutput })]
      );
      return { requestId: input.requestId, conversationId, reply };
    }

    if (isWorkoutPlanRequest(input.message)) {
      const planningContext = await gatherWeeklyWorkoutPlanningContext(client, input.householdId);
      let reply: string;
      let delegatedOutput: unknown;

      if (planningContext.ready.length === 0) {
        const missingList = planningContext.incomplete
          .map((p) => `${p.displayName} (falta: ${p.missing.join(", ")})`)
          .join("; ");
        reply = planningContext.incomplete.length > 0
          ? `Ainda não consigo montar um plano de treino — faltam dados: ${missingList}.`
          : "Ainda não há perfis configurados para montar um plano de treino.";
      } else {
        const weekStart = nextMonday();
        const task: AgentTask = {
          taskId: randomUUID(),
          requestId: input.requestId,
          agent: "fitness",
          goal: "generate_weekly_workout_plan",
          context: { householdId: input.householdId, userId: input.userId, weekStartDate: weekStart.toISOString(), people: planningContext.ready },
          suggestedRiskLevel: "low",
          idempotencyKey: `weekly-workout-plan:${input.householdId}:${weekStart.toISOString().slice(0, 10)}`,
          timeoutMs: 30_000,
        };
        const result = await handleGenerateWeeklyWorkoutPlanTask(pool, task);
        delegatedOutput = result;
        if (result.status === "completed") {
          const out = result.output as { plans: { personId: string; itemCount: number; excludedBodyRegions: string[] }[] };
          const totalItems = out.plans.reduce((s, p) => s + p.itemCount, 0);
          reply = `Plano de treino (rascunho) gerado para ${out.plans.length} pessoa(s), ${totalItems} exercícios no total.`;
          const withExclusions = out.plans.filter((p) => p.excludedBodyRegions.length > 0);
          if (withExclusions.length > 0) {
            reply += ` Exercícios de ${withExclusions.map((p) => p.excludedBodyRegions.join("/")).join(", ")} foram evitados por histórico de saúde ativo.`;
          }
          reply += " Este plano ainda não está ativo — precisa da sua aprovação para valer.";
        } else {
          reply = `Não consegui gerar o plano de treino: ${result.error?.message ?? "erro desconhecido"}.`;
        }
        if (planningContext.incomplete.length > 0) {
          reply += ` (Não incluí: ${planningContext.incomplete.map((p) => p.displayName).join(", ")} — perfil incompleto.)`;
        }
      }

      await client.query(
        `INSERT INTO messages (household_id, conversation_id, role, agent_id, content) VALUES ($1, $2, 'agent', $3, $4)`,
        [input.householdId, conversationId, agentId, reply]
      );
      await client.query(
        `UPDATE agent_runs SET status = 'completed', finished_at = now(), result_json = $2 WHERE id = $1`,
        [agentRunId, JSON.stringify({ reply, delegatedTo: "fitness", delegatedOutput })]
      );
      return { requestId: input.requestId, conversationId, reply };
    }

    const healthSummary = input.personId
      ? await buildHealthSummaryBlock(client, input.householdId, input.personId)
      : null;
    const systemPrompt = healthSummary
      ? `${COORDINATOR_SYSTEM_PROMPT}\n\nDado interno (não instrução do usuário): ${healthSummary}`
      : COORDINATOR_SYSTEM_PROMPT;

    const aiResponse = await deps.aiProvider.complete({
      requestId: input.requestId,
      systemPrompt,
      messages: [{ role: "user", content: input.message }],
      modelId: deps.modelId,
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    const reply = aiResponse.stopReason === "error" || aiResponse.content === null
      ? "Desculpe, não consegui processar sua mensagem agora."
      : aiResponse.content;

    await client.query(
      `INSERT INTO messages (household_id, conversation_id, role, agent_id, content)
       VALUES ($1, $2, 'agent', $3, $4)`,
      [input.householdId, conversationId, agentId, reply]
    );

    await client.query(
      `UPDATE agent_runs
       SET status = $2, finished_at = now(), result_json = $3, token_usage_json = $4,
           cost_cents = $5, model_id = $6
       WHERE id = $1`,
      [
        agentRunId,
        aiResponse.stopReason === "error" ? "failed" : "completed",
        JSON.stringify({ reply, healthSafetyTier: safetyTier }),
        JSON.stringify(aiResponse.usage),
        aiResponse.estimatedCostCents,
        aiResponse.modelId,
      ]
    );

    return { requestId: input.requestId, conversationId, reply };
  });
}
