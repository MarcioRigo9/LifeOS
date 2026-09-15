import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import type { AIProvider } from "@/lib/ai-provider/types";
import { requireCapability } from "./capabilities";

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
  "Você é o Coordinator do LifeOS, o único ponto de contato do usuário nesta Fase 1. " +
  "Responda de forma breve e direta.";

/**
 * AGENT_CONTRACTS.md §2: Coordinator mínimo (Fase 1). Persists the user's turn BEFORE
 * processing, calls the AI Provider, persists the reply, and records the agent_run — so a
 * crash mid-request never loses the conversation (CONV-002).
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

    const aiResponse = await deps.aiProvider.complete({
      requestId: input.requestId,
      systemPrompt: COORDINATOR_SYSTEM_PROMPT,
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
        JSON.stringify({ reply }),
        JSON.stringify(aiResponse.usage),
        aiResponse.estimatedCostCents,
        aiResponse.modelId,
      ]
    );

    return { requestId: input.requestId, conversationId, reply };
  });
}
