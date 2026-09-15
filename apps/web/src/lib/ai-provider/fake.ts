import type { AICompleteInput, AIProvider, AIResponse } from "./types";

/**
 * Deterministic test double implementing the same normative contract as AnthropicProvider
 * (AGENT_CONTRACTS.md §13) — used by tests and local dev without an ANTHROPIC_API_KEY, so the
 * Coordinator pipeline (persist -> call provider -> validate -> respond) is fully exercised
 * without a network dependency.
 */
export class FakeAIProvider implements AIProvider {
  async complete(input: AICompleteInput): Promise<AIResponse> {
    const lastUserMessage = [...input.messages].reverse().find((m) => m.role === "user");
    return {
      content: `echo: ${lastUserMessage?.content ?? ""}`,
      usage: { inputTokens: 10, outputTokens: 5 },
      estimatedCostCents: 1,
      modelId: input.modelId,
      stopReason: "end_turn",
      requestId: input.requestId,
    };
  }
}
