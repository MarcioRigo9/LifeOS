// Normative contract: AGENT_CONTRACTS.md §13.

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AICompleteInput {
  requestId: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolSpec[];
  outputSchema?: Record<string, unknown>;
  modelId: string;
  timeoutMs: number;
  maxRetries: number;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error";

export interface AIResponse {
  content: string | null;
  toolCalls?: ToolCall[];
  structuredOutput?: unknown;
  usage: { inputTokens: number; outputTokens: number };
  estimatedCostCents: number;
  modelId: string;
  stopReason: StopReason;
  requestId: string;
}

export interface AIProvider {
  complete(input: AICompleteInput): Promise<AIResponse>;
}
