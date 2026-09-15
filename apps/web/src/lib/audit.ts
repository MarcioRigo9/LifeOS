import type { PoolClient } from "pg";

export interface AuditEvent {
  householdId: string;
  actorType: "user" | "agent" | "system";
  actorId?: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string;
  requestId?: string;
}

/** SECURITY_MODEL.md §9 — append-only (enforced again at the grant level, see 0009_grants.sql). */
export async function logAudit(client: PoolClient, event: AuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (household_id, actor_type, actor_id, event_type, entity_type, entity_id, before_json, after_json, reason, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      event.householdId,
      event.actorType,
      event.actorId ?? null,
      event.eventType,
      event.entityType ?? null,
      event.entityId ?? null,
      event.beforeJson ? JSON.stringify(event.beforeJson) : null,
      event.afterJson ? JSON.stringify(event.afterJson) : null,
      event.reason ?? null,
      event.requestId ?? null,
    ]
  );
}
