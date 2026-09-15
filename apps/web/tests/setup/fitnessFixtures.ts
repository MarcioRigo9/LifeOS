import { withTestAdminClient } from "./testDb";

export interface FitnessCatalog {
  benchPressId: string; // chest, compound — never contraindicated by tracked regions
  squatId: string; // knees, compound
  deadliftId: string; // lower_back, compound
  overheadPressId: string; // shoulders, compound
  rowId: string; // back, compound — never contraindicated
  bicepCurlId: string; // elbows, isolation
  lateralRaiseId: string; // shoulders, isolation
}

let cached: FitnessCatalog | null = null;

async function ensureExercise(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { id: string }[] }> },
  name: string,
  params: { primaryMuscleGroup: string; exerciseType: "compound" | "isolation"; bodyRegion: string }
): Promise<string> {
  const existing = await client.query("SELECT id FROM exercises WHERE name = $1", [name]);
  if (existing.rows[0]) return existing.rows[0].id;
  const res = await client.query(
    `INSERT INTO exercises (name, primary_muscle_group, exercise_type, body_region) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, params.primaryMuscleGroup, params.exerciseType, params.bodyRegion]
  );
  return res.rows[0].id;
}

/** Idempotent — seeds the GLOBAL exercises catalog once per test session (never truncated
 * between tests, DATA_MODEL_REVIEW.md §1.1, same pattern as nutritionFixtures.ts). */
export async function seedFitnessCatalog(): Promise<FitnessCatalog> {
  if (cached) return cached;
  cached = await withTestAdminClient(async (client) => {
    const benchPressId = await ensureExercise(client, "Supino reto", { primaryMuscleGroup: "chest", exerciseType: "compound", bodyRegion: "chest" });
    const squatId = await ensureExercise(client, "Agachamento livre", { primaryMuscleGroup: "legs", exerciseType: "compound", bodyRegion: "knees" });
    const deadliftId = await ensureExercise(client, "Levantamento terra", { primaryMuscleGroup: "back", exerciseType: "compound", bodyRegion: "lower_back" });
    const overheadPressId = await ensureExercise(client, "Desenvolvimento militar", { primaryMuscleGroup: "shoulders", exerciseType: "compound", bodyRegion: "shoulders" });
    const rowId = await ensureExercise(client, "Remada curvada", { primaryMuscleGroup: "back", exerciseType: "compound", bodyRegion: "back" });
    const bicepCurlId = await ensureExercise(client, "Rosca direta", { primaryMuscleGroup: "arms", exerciseType: "isolation", bodyRegion: "elbows" });
    const lateralRaiseId = await ensureExercise(client, "Elevação lateral", { primaryMuscleGroup: "shoulders", exerciseType: "isolation", bodyRegion: "shoulders" });

    return { benchPressId, squatId, deadliftId, overheadPressId, rowId, bicepCurlId, lateralRaiseId };
  });
  return cached;
}
