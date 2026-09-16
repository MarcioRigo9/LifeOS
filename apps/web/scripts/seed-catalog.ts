import pg from "pg";
const { Client } = pg;

// Seeds the GLOBAL reference catalogs (foods, cooking_yields, exercises — DATA_MODEL_REVIEW.md
// §1.1) with a reasonable starter set. These tables only ever get real content here or from a
// couple's own data entry — migrations intentionally define the schema only, never data
// (0012_nutrition_catalog.sql, 0015_fitness_catalog.sql), so a brand-new household otherwise has
// nothing to build meal/workout plans from. Idempotent (checks by name before inserting), safe
// to run repeatedly against any environment.
//
// Usage: DATABASE_URL_ADMIN=... npx tsx scripts/seed-catalog.ts

interface FoodSeed {
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  cookingYields?: { method: string; rawG: number; cookedG: number }[];
}

const FOODS: FoodSeed[] = [
  { name: "Peito de frango", category: "protein", calories: 165, protein: 31, carbs: 0, fat: 3.6, cookingYields: [{ method: "grilled", rawG: 100, cookedG: 70 }] },
  { name: "Arroz branco", category: "grain", calories: 130, protein: 2.7, carbs: 28, fat: 0.3, cookingYields: [{ method: "boiled", rawG: 100, cookedG: 250 }] },
  { name: "Feijão carioca", category: "legume", calories: 127, protein: 8.7, carbs: 22.8, fat: 0.5, cookingYields: [{ method: "boiled", rawG: 100, cookedG: 220 }] },
  { name: "Aveia em flocos", category: "grain", calories: 389, protein: 16.9, carbs: 66, fat: 6.9 },
  { name: "Banana", category: "fruit", calories: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  { name: "Ovo", category: "protein", calories: 155, protein: 13, carbs: 1.1, fat: 11, cookingYields: [{ method: "boiled", rawG: 100, cookedG: 90 }] },
  { name: "Batata-doce", category: "carb", calories: 86, protein: 1.6, carbs: 20, fat: 0.1, cookingYields: [{ method: "boiled", rawG: 100, cookedG: 95 }] },
  { name: "Brócolis", category: "vegetable", calories: 34, protein: 2.8, carbs: 6.6, fat: 0.4, cookingYields: [{ method: "steamed", rawG: 100, cookedG: 90 }] },
  { name: "Azeite de oliva", category: "fat", calories: 884, protein: 0, carbs: 0, fat: 100 },
  { name: "Leite desnatado", category: "dairy", calories: 34, protein: 3.4, carbs: 5, fat: 0.1 },
  { name: "Tilápia", category: "protein", calories: 96, protein: 20.1, carbs: 0, fat: 1.7, cookingYields: [{ method: "grilled", rawG: 100, cookedG: 75 }] },
  { name: "Whey protein", category: "supplement", calories: 400, protein: 80, carbs: 8, fat: 6 },
];

interface ExerciseSeed {
  name: string;
  primaryMuscleGroup: string;
  secondaryMuscleGroups?: string[];
  equipment?: string;
  movementPattern?: string;
  type: "compound" | "isolation";
  bodyRegion: string;
}

const EXERCISES: ExerciseSeed[] = [
  { name: "Supino reto", primaryMuscleGroup: "chest", secondaryMuscleGroups: ["shoulders", "triceps"], equipment: "barbell", movementPattern: "push", type: "compound", bodyRegion: "chest" },
  { name: "Agachamento livre", primaryMuscleGroup: "legs", secondaryMuscleGroups: ["glutes"], equipment: "barbell", movementPattern: "squat", type: "compound", bodyRegion: "knees" },
  { name: "Levantamento terra", primaryMuscleGroup: "back", secondaryMuscleGroups: ["legs", "glutes"], equipment: "barbell", movementPattern: "hinge", type: "compound", bodyRegion: "lower_back" },
  { name: "Desenvolvimento militar", primaryMuscleGroup: "shoulders", secondaryMuscleGroups: ["triceps"], equipment: "barbell", movementPattern: "push", type: "compound", bodyRegion: "shoulders" },
  { name: "Remada curvada", primaryMuscleGroup: "back", secondaryMuscleGroups: ["biceps"], equipment: "barbell", movementPattern: "pull", type: "compound", bodyRegion: "back" },
  { name: "Puxada na polia", primaryMuscleGroup: "back", secondaryMuscleGroups: ["biceps"], equipment: "cable", movementPattern: "pull", type: "compound", bodyRegion: "back" },
  { name: "Leg press", primaryMuscleGroup: "legs", equipment: "machine", movementPattern: "squat", type: "compound", bodyRegion: "knees" },
  { name: "Rosca direta", primaryMuscleGroup: "arms", equipment: "barbell", movementPattern: "isolation", type: "isolation", bodyRegion: "elbows" },
  { name: "Tríceps corda", primaryMuscleGroup: "arms", equipment: "cable", movementPattern: "isolation", type: "isolation", bodyRegion: "elbows" },
  { name: "Elevação lateral", primaryMuscleGroup: "shoulders", equipment: "dumbbell", movementPattern: "isolation", type: "isolation", bodyRegion: "shoulders" },
  { name: "Cadeira extensora", primaryMuscleGroup: "legs", equipment: "machine", movementPattern: "isolation", type: "isolation", bodyRegion: "knees" },
  { name: "Panturrilha em pé", primaryMuscleGroup: "legs", equipment: "machine", movementPattern: "isolation", type: "isolation", bodyRegion: "ankles" },
  { name: "Prancha abdominal", primaryMuscleGroup: "core", equipment: "bodyweight", movementPattern: "carry", type: "isolation", bodyRegion: "lower_back" },
];

async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("DATABASE_URL_ADMIN is not set.");
  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    let foodsInserted = 0;
    let yieldsInserted = 0;
    for (const food of FOODS) {
      const existing = await client.query<{ id: string }>("SELECT id FROM foods WHERE name = $1", [food.name]);
      let foodId = existing.rows[0]?.id;
      if (!foodId) {
        const res = await client.query<{ id: string }>(
          `INSERT INTO foods (name, category, calories_kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, fiber_g_per_100g)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [food.name, food.category, food.calories, food.protein, food.carbs, food.fat, food.fiber ?? null]
        );
        foodId = res.rows[0].id;
        foodsInserted++;
      }
      for (const y of food.cookingYields ?? []) {
        const existingYield = await client.query("SELECT id FROM cooking_yields WHERE food_id = $1 AND preparation_method = $2", [foodId, y.method]);
        if (existingYield.rowCount === 0) {
          await client.query(
            `INSERT INTO cooking_yields (food_id, preparation_method, raw_weight_g, cooked_weight_g, source, version)
             VALUES ($1, $2, $3, $4, 'seed-catalog', 1)`,
            [foodId, y.method, y.rawG, y.cookedG]
          );
          yieldsInserted++;
        }
      }
    }

    let exercisesInserted = 0;
    for (const ex of EXERCISES) {
      const existing = await client.query("SELECT id FROM exercises WHERE name = $1", [ex.name]);
      if (existing.rowCount === 0) {
        await client.query(
          `INSERT INTO exercises (name, primary_muscle_group, secondary_muscle_groups, equipment, movement_pattern, exercise_type, body_region)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ex.name, ex.primaryMuscleGroup, ex.secondaryMuscleGroups ?? [], ex.equipment ?? null, ex.movementPattern ?? null, ex.type, ex.bodyRegion]
        );
        exercisesInserted++;
      }
    }

    console.log(`Seeded ${foodsInserted} food(s), ${yieldsInserted} cooking yield(s), ${exercisesInserted} exercise(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
