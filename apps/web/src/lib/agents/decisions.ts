import type { PoolClient, Pool } from "pg";
import { randomUUID } from "node:crypto";
import { evaluateRisk } from "@/lib/policy-engine/evaluateRisk";
import { computeProposalHash } from "./proposalHash";
import type { ActionEnvelope } from "./contracts";
import { withHouseholdContext } from "@/lib/db/pool";

export class DecisionError extends Error {
  constructor(
    public code:
      | "not_found"
      | "invalid_state"
      | "expired"
      | "hash_mismatch"
      | "not_approved",
    message?: string
  ) {
    super(message ?? code);
  }
}

export type CreateProposalResult =
  | { outcome: "auto_execute"; riskLevel: "low" }
  | {
      outcome: "proposed";
      decisionId: string;
      proposalHash: string;
      riskLevel: "medium" | "high";
      expiresAt: Date;
    };

const DEFAULT_PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000; // 48h, SECURITY_MODEL.md §6

/**
 * Runs the Policy Engine (server-authoritative — never the agent's suggestedRiskLevel) and,
 * for medium/high risk, writes an immutable PENDING proposal. AGENT_CONTRACTS.md §8.1-8.3.
 */
export async function createDecisionProposal(
  client: PoolClient,
  params: { householdId: string; agentKey: string; envelope: ActionEnvelope; ttlMs?: number }
): Promise<CreateProposalResult> {
  const riskLevel = evaluateRisk({
    actionType: params.envelope.actionType,
    scope: params.envelope.scope,
  });

  if (riskLevel === "low") {
    return { outcome: "auto_execute", riskLevel };
  }

  const proposalHash = computeProposalHash(params.envelope, riskLevel);
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? DEFAULT_PROPOSAL_TTL_MS));

  const agentRow = await client.query<{ id: string }>("SELECT id FROM agents WHERE key = $1", [
    params.agentKey,
  ]);
  if (agentRow.rowCount === 0) throw new Error(`Unknown agent key: ${params.agentKey}`);

  const res = await client.query<{ id: string }>(
    `INSERT INTO agent_decisions (household_id, agent_id, action_envelope_json, risk_level, proposal_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
     RETURNING id`,
    [
      params.householdId,
      agentRow.rows[0].id,
      JSON.stringify(params.envelope),
      riskLevel,
      proposalHash,
      expiresAt,
    ]
  );

  return {
    outcome: "proposed",
    decisionId: res.rows[0].id,
    proposalHash,
    riskLevel: riskLevel as "medium" | "high",
    expiresAt,
  };
}

interface DecisionRow {
  id: string;
  status: string;
  proposal_hash: string;
  expires_at: string;
  action_envelope_json: ActionEnvelope;
}

/** AGENT_CONTRACTS.md §8.2-8.3: PENDING -> APPROVED, only with a matching hash, before expiry. */
export async function approveDecision(
  client: PoolClient,
  params: { decisionId: string; proposalHash: string; approvedByProfileId: string }
): Promise<void> {
  const res = await client.query<DecisionRow>(
    "SELECT id, status, proposal_hash, expires_at FROM agent_decisions WHERE id = $1 FOR UPDATE",
    [params.decisionId]
  );
  if (res.rowCount === 0) throw new DecisionError("not_found");
  const row = res.rows[0];

  if (row.status !== "PENDING") {
    throw new DecisionError("invalid_state", `cannot approve a decision in status ${row.status}`);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await client.query("UPDATE agent_decisions SET status = 'EXPIRED' WHERE id = $1", [row.id]);
    throw new DecisionError("expired");
  }
  if (row.proposal_hash !== params.proposalHash) {
    // Bait-and-switch protection (ADR 013): the hash the human confirmed must match exactly.
    throw new DecisionError("hash_mismatch", "proposalHash does not match the stored proposal");
  }

  await client.query(
    "UPDATE agent_decisions SET status = 'APPROVED', approved_by = $2, approved_at = now() WHERE id = $1",
    [row.id, params.approvedByProfileId]
  );
}

export async function rejectDecision(client: PoolClient, decisionId: string): Promise<void> {
  const res = await client.query<{ status: string }>(
    "SELECT status FROM agent_decisions WHERE id = $1 FOR UPDATE",
    [decisionId]
  );
  if (res.rowCount === 0) throw new DecisionError("not_found");
  if (res.rows[0].status !== "PENDING") throw new DecisionError("invalid_state");
  await client.query("UPDATE agent_decisions SET status = 'REJECTED' WHERE id = $1", [decisionId]);
}

export type ExecutionOutcome =
  | { result: "already_claimed" }
  | { result: "executed"; output: Record<string, unknown> }
  | { result: "failed"; reason: string };

const EXECUTION_LEASE_MS = 30_000;
const MAX_EXECUTION_ATTEMPTS = 5;

/**
 * AGENT_CONTRACTS.md §8.5: atomic claim (APPROVED -> EXECUTING), then the business mutation
 * and the decision_executions row are written in the SAME transaction as the claim — so a
 * crash leaves only two observable states (§8.6), never a partial one.
 *
 * Only one concrete action type is implemented in Fase 1 (`goal.update_target`) — enough to
 * exercise and test the whole Approval -> Execution pipeline end to end. Additional action
 * types are added by extending the switch below as real agents are built (Fase 2+).
 */
export async function executeApprovedDecision(
  pool: Pool,
  params: { householdId: string; userId: string; decisionId: string; requestId: string }
): Promise<ExecutionOutcome> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const claim = await client.query<DecisionRow>(
      `UPDATE agent_decisions
       SET status = 'EXECUTING', execution_started_at = now(),
           execution_lease_expires_at = now() + interval '${EXECUTION_LEASE_MS} milliseconds'
       WHERE id = $1 AND status = 'APPROVED'
       RETURNING id, action_envelope_json`,
      [params.decisionId]
    );
    if (claim.rowCount === 0) {
      return { result: "already_claimed" };
    }

    const envelope = claim.rows[0].action_envelope_json;
    const startedAt = new Date();

    try {
      const output = await applyActionEnvelope(client, envelope);
      const finishedAt = new Date();
      await client.query(
        `INSERT INTO decision_executions (decision_id, household_id, request_id, started_at, finished_at, status, result_json)
         VALUES ($1, $2, $3, $4, $5, 'executed', $6)`,
        [params.decisionId, params.householdId, params.requestId, startedAt, finishedAt, JSON.stringify(output)]
      );
      await client.query("UPDATE agent_decisions SET status = 'EXECUTED' WHERE id = $1", [params.decisionId]);
      return { result: "executed", output };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const finishedAt = new Date();
      await client.query(
        `INSERT INTO decision_executions (decision_id, household_id, request_id, started_at, finished_at, status, error_json)
         VALUES ($1, $2, $3, $4, $5, 'failed', $6)`,
        [params.decisionId, params.householdId, params.requestId, startedAt, finishedAt, JSON.stringify({ message: reason })]
      );
      await client.query("UPDATE agent_decisions SET status = 'FAILED' WHERE id = $1", [params.decisionId]);
      return { result: "failed", reason };
    }
  });
}

class VersionConflictError extends Error {}

/** The executor allowlist (AGENT_CONTRACTS.md §8.1: actionType is never interpreted as free text). */
async function applyActionEnvelope(
  client: PoolClient,
  envelope: ActionEnvelope
): Promise<Record<string, unknown>> {
  switch (envelope.actionType) {
    case "goal.update_target": {
      const goalId = envelope.targetEntityIds[0];
      const expectedVersion = envelope.expectedVersions[`goal:${goalId}`];
      if (expectedVersion === undefined) throw new Error("missing expectedVersions for goal");

      const newTargetValue = envelope.actionPayload.newTargetValue;

      const res = await client.query<{ id: string; version: number }>(
        `UPDATE goals SET target_value = $1, version = version + 1
         WHERE id = $2 AND version = $3
         RETURNING id, version`,
        [newTargetValue, goalId, expectedVersion]
      );
      if (res.rowCount === 0) {
        throw new VersionConflictError(
          `goal ${goalId} version mismatch: expected ${expectedVersion}, action rejected`
        );
      }
      return { goalId: res.rows[0].id, newVersion: res.rows[0].version };
    }
    default:
      throw new Error(`Unknown actionType: ${envelope.actionType}`);
  }
}

/**
 * AGENT_CONTRACTS.md §8.6 — crash recovery reaper. Deterministic: existence of a
 * decision_executions row (not heuristics) decides what happened.
 */
export async function reapStuckExecutions(
  pool: Pool,
  params: { householdId: string; userId: string }
): Promise<{ reconciledExecuted: number; reconciledFailed: number; requeued: number; deadLettered: number }> {
  return withHouseholdContext(pool, params, async (client) => {
    const stuck = await client.query<{ id: string; attempts: number }>(
      `SELECT id, attempts FROM agent_decisions
       WHERE status = 'EXECUTING' AND execution_lease_expires_at < now()`
    );

    let reconciledExecuted = 0;
    let reconciledFailed = 0;
    let requeued = 0;
    let deadLettered = 0;

    for (const row of stuck.rows) {
      const exec = await client.query<{ status: string }>(
        "SELECT status FROM decision_executions WHERE decision_id = $1",
        [row.id]
      );
      if (exec.rowCount && exec.rows[0].status === "executed") {
        await client.query("UPDATE agent_decisions SET status = 'EXECUTED' WHERE id = $1", [row.id]);
        reconciledExecuted++;
      } else if (exec.rowCount && exec.rows[0].status === "failed") {
        await client.query("UPDATE agent_decisions SET status = 'FAILED' WHERE id = $1", [row.id]);
        reconciledFailed++;
      } else if (row.attempts + 1 >= MAX_EXECUTION_ATTEMPTS) {
        await client.query("UPDATE agent_decisions SET status = 'FAILED', attempts = attempts + 1 WHERE id = $1", [
          row.id,
        ]);
        deadLettered++;
      } else {
        await client.query(
          `UPDATE agent_decisions
           SET status = 'APPROVED', attempts = attempts + 1,
               execution_started_at = NULL, execution_lease_expires_at = NULL
           WHERE id = $1`,
          [row.id]
        );
        requeued++;
      }
    }

    return { reconciledExecuted, reconciledFailed, requeued, deadLettered };
  });
}

export function newRequestId(): string {
  return randomUUID();
}
