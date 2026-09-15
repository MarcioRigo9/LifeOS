import type { RiskLevel } from "@/lib/policy-engine/evaluateRisk";

// AGENT_CONTRACTS.md §8.1 — the only thing an executor ever interprets to act.
export interface ActionEnvelope {
  actionType: string;
  actionPayload: Record<string, unknown>;
  targetEntityIds: string[];
  expectedVersions: Record<string, number>;
  scope: {
    householdId: string;
    entityCount: number;
    reversible: boolean;
    financialImpactCents: number;
  };
}

export type DecisionStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "EXECUTING"
  | "EXECUTED"
  | "FAILED";

// AGENT_CONTRACTS.md §3 — the transient contract between Coordinator and a specialist.
// Never a table (ADR 021) — see agent_runs for the persisted execution record.
export interface AgentTask {
  taskId: string;
  requestId: string;
  agent: "nutrition" | "fitness" | "finance";
  goal: string;
  context: Record<string, unknown>;
  inputSchema?: unknown;
  outputSchema?: unknown;
  suggestedRiskLevel: RiskLevel;
  idempotencyKey: string;
  timeoutMs: number;
}

// AGENT_CONTRACTS.md §3 — what a specialist hands back to the Coordinator. Never a new
// invocation (AGENT_CONTRACTS.md §14: specialist -> Coordinator is a result, not delegation).
export interface AgentTaskResult {
  taskId: string;
  status: "completed" | "proposed" | "failed" | "timeout";
  output?: unknown;
  decisionId?: string; // present when status="proposed" (an agent_decisions row was created)
  error?: { code: string; message: string };
  tokenUsage?: { input: number; output: number };
  costCents?: number;
}
