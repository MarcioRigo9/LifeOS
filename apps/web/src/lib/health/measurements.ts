import type { Pool, PoolClient } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { validatePlausibleRange } from "@/lib/domain/health";
import { logAudit } from "@/lib/audit";

export interface RecordMeasurementInput {
  householdId: string;
  userId: string;
  personId: string;
  takenAt: Date;
  weightKg: number;
  bodyFatPct?: number;
  muscleMassKg?: number;
  waistCm?: number;
  hipCm?: number;
  armCm?: number;
  notes?: string;
}

export interface MeasurementRow {
  id: string;
  personId: string;
  takenAt: Date;
  weightKg: number;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  waistCm: number | null;
  hipCm: number | null;
  armCm: number | null;
  notes: string | null;
}

/**
 * Validates every provided field against the business-plausible range (domain layer, not the
 * LLM — ARCHITECTURE.md §1 principle 2) before ever touching the database, then inserts a new
 * append-only row (DATA_MODEL_REVIEW.md §2.2 — corrections are new rows, never UPDATE).
 */
export async function recordMeasurement(pool: Pool, input: RecordMeasurementInput): Promise<MeasurementRow> {
  validatePlausibleRange("weight_kg", input.weightKg);
  if (input.bodyFatPct !== undefined) validatePlausibleRange("body_fat_pct", input.bodyFatPct);
  if (input.muscleMassKg !== undefined) validatePlausibleRange("muscle_mass_kg", input.muscleMassKg);
  if (input.waistCm !== undefined) validatePlausibleRange("waist_cm", input.waistCm);
  if (input.hipCm !== undefined) validatePlausibleRange("hip_cm", input.hipCm);
  if (input.armCm !== undefined) validatePlausibleRange("arm_cm", input.armCm);

  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    const res = await client.query(
      `INSERT INTO measurements
         (household_id, person_id, taken_at, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, hip_cm, arm_cm, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, person_id, taken_at, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, hip_cm, arm_cm, notes`,
      [
        input.householdId,
        input.personId,
        input.takenAt,
        input.weightKg,
        input.bodyFatPct ?? null,
        input.muscleMassKg ?? null,
        input.waistCm ?? null,
        input.hipCm ?? null,
        input.armCm ?? null,
        input.notes ?? null,
      ]
    );
    await logAudit(client, {
      householdId: input.householdId,
      actorType: "user",
      actorId: input.userId,
      eventType: "measurement.recorded",
      entityType: "measurements",
      entityId: res.rows[0].id,
    });
    return mapRow(res.rows[0]);
  });
}

export interface ListMeasurementsInput {
  householdId: string;
  userId: string;
  personId: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Filtered by person_id AND household_id (RLS enforces the household half unconditionally). */
export async function listMeasurements(pool: Pool, input: ListMeasurementsInput): Promise<MeasurementRow[]> {
  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    const conditions = ["person_id = $1"];
    const params: unknown[] = [input.personId];
    if (input.from) {
      params.push(input.from);
      conditions.push(`taken_at >= $${params.length}`);
    }
    if (input.to) {
      params.push(input.to);
      conditions.push(`taken_at <= $${params.length}`);
    }
    params.push(input.limit ?? 100);
    const res = await client.query(
      `SELECT id, person_id, taken_at, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, hip_cm, arm_cm, notes
       FROM measurements
       WHERE ${conditions.join(" AND ")}
       ORDER BY taken_at DESC
       LIMIT $${params.length}`,
      params
    );
    return res.rows.map(mapRow);
  });
}

/** Used internally by the Coordinator to build a short health summary for the active person. */
export async function getLatestMeasurement(client: PoolClient, personId: string): Promise<MeasurementRow | null> {
  const res = await client.query(
    `SELECT id, person_id, taken_at, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, hip_cm, arm_cm, notes
     FROM measurements WHERE person_id = $1 ORDER BY taken_at DESC LIMIT 1`,
    [personId]
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function getRecentMeasurements(
  client: PoolClient,
  personId: string,
  limit = 10
): Promise<MeasurementRow[]> {
  const res = await client.query(
    `SELECT id, person_id, taken_at, weight_kg, body_fat_pct, muscle_mass_kg, waist_cm, hip_cm, arm_cm, notes
     FROM measurements WHERE person_id = $1 ORDER BY taken_at DESC LIMIT $2`,
    [personId, limit]
  );
  return res.rows.map(mapRow);
}

function mapRow(row: Record<string, unknown>): MeasurementRow {
  return {
    id: row.id as string,
    personId: row.person_id as string,
    takenAt: row.taken_at as Date,
    weightKg: Number(row.weight_kg),
    bodyFatPct: row.body_fat_pct === null ? null : Number(row.body_fat_pct),
    muscleMassKg: row.muscle_mass_kg === null ? null : Number(row.muscle_mass_kg),
    waistCm: row.waist_cm === null ? null : Number(row.waist_cm),
    hipCm: row.hip_cm === null ? null : Number(row.hip_cm),
    armCm: row.arm_cm === null ? null : Number(row.arm_cm),
    notes: row.notes as string | null,
  };
}
