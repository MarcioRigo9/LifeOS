import type { Pool } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { logAudit } from "@/lib/audit";

export type HealthCategory = "injury" | "surgery" | "allergy" | "chronic_condition" | "continuous_medication";
export type HealthSource = "user_input" | "checkin" | "doctor_report";

export interface RecordHealthEventInput {
  householdId: string;
  userId: string;
  personId: string;
  category: HealthCategory;
  title: string;
  details: string;
  recordedAt: Date;
  source: HealthSource;
}

export interface HealthHistoryRow {
  id: string;
  personId: string;
  category: HealthCategory;
  title: string;
  details: string;
  active: boolean;
  recordedAt: Date;
  source: HealthSource;
}

export async function recordHealthEvent(pool: Pool, input: RecordHealthEventInput): Promise<HealthHistoryRow> {
  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    const res = await client.query(
      `INSERT INTO health_history (household_id, person_id, category, title, details, recorded_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, person_id, category, title, details, active, recorded_at, source`,
      [input.householdId, input.personId, input.category, input.title, input.details, input.recordedAt, input.source]
    );
    await logAudit(client, {
      householdId: input.householdId,
      actorType: "user",
      actorId: input.userId,
      eventType: "health_history.recorded",
      entityType: "health_history",
      entityId: res.rows[0].id,
    });
    return mapRow(res.rows[0]);
  });
}

export async function listHealthHistory(
  pool: Pool,
  params: { householdId: string; userId: string; personId: string; activeOnly?: boolean }
): Promise<HealthHistoryRow[]> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const conditions = ["person_id = $1"];
    const args: unknown[] = [params.personId];
    if (params.activeOnly) conditions.push("active = true");
    const res = await client.query(
      `SELECT id, person_id, category, title, details, active, recorded_at, source
       FROM health_history WHERE ${conditions.join(" AND ")} ORDER BY recorded_at DESC`,
      args
    );
    return res.rows.map(mapRow);
  });
}

/** The one legitimate mutation on this table — marking a condition resolved (grant-enforced to
 * the `active` column only, db/migrations/0011_health_grants.sql). */
export async function markHealthEventResolved(
  pool: Pool,
  params: { householdId: string; userId: string; eventId: string }
): Promise<void> {
  await withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    await client.query("UPDATE health_history SET active = false WHERE id = $1", [params.eventId]);
    await logAudit(client, {
      householdId: params.householdId,
      actorType: "user",
      actorId: params.userId,
      eventType: "health_history.resolved",
      entityType: "health_history",
      entityId: params.eventId,
    });
  });
}

function mapRow(row: Record<string, unknown>): HealthHistoryRow {
  return {
    id: row.id as string,
    personId: row.person_id as string,
    category: row.category as HealthCategory,
    title: row.title as string,
    details: row.details as string,
    active: row.active as boolean,
    recordedAt: row.recorded_at as Date,
    source: row.source as HealthSource,
  };
}
