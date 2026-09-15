import Anthropic from "@anthropic-ai/sdk";
import type { AICompleteInput, AIProvider, AIResponse, StopReason } from "./types";

// Rough per-model pricing table (USD per million tokens), converted to an estimated BRL-cents
// figure is NOT done here (currency conversion is out of scope) — estimatedCostCents is a
// deliberately simple integer-cents proxy on the model's own USD price, sufficient for the
// Fase 1 requirement of "não chamar o LLM sem considerar custo" (prompt mestre seção 45).
const PRICE_PER_MILLION_TOKENS_USD_CENTS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 300, output: 1500 },
  "claude-haiku-4-5": { input: 80, output: 400 },
};

function estimateCostCents(modelId: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_PER_MILLION_TOKENS_USD_CENTS[modelId] ?? PRICE_PER_MILLION_TOKENS_USD_CENTS["claude-haiku-4-5"];
  const cents = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.ceil(cents);
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "error";
  }
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(input: AICompleteInput): Promise<AIResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= input.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

      try {
        const response = await this.client.messages.create(
          {
            model: input.modelId,
            max_tokens: 1024,
            system: input.systemPrompt,
            messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
            tools: input.tools?.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
          },
          { signal: controller.signal }
        );

        clearTimeout(timeout);

        const textBlock = response.content.find((b) => b.type === "text");
        const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

        return {
          content: textBlock && textBlock.type === "text" ? textBlock.text : null,
          toolCalls: toolUseBlocks.map((b) =>
            b.type === "tool_use" ? { name: b.name, input: b.input as Record<string, unknown> } : { name: "", input: {} }
          ),
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
          estimatedCostCents: estimateCostCents(
            input.modelId,
            response.usage.input_tokens,
            response.usage.output_tokens
          ),
          modelId: response.model,
          stopReason: mapStopReason(response.stop_reason),
          requestId: input.requestId,
        };
      } catch (err) {
        clearTimeout(timeout);
        lastError = err;
        // Retry only technical failures (timeout/network/provider) per AGENT_CONTRACTS.md §10 —
        // never retry a semantic/validation failure, which this catch block never sees anyway
        // since output-schema validation happens by the caller, after complete() returns.
        if (attempt === input.maxRetries) break;
      }
    }

    // lastError is intentionally surfaced as stopReason="error" rather than thrown — callers
    // (Coordinator) branch on stopReason, matching the normative AIResponse contract instead
    // of a try/catch-based control flow.
    void lastError;
    return {
      content: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostCents: 0,
      modelId: input.modelId,
      stopReason: "error",
      requestId: input.requestId,
    } satisfies AIResponse;
  }
}
