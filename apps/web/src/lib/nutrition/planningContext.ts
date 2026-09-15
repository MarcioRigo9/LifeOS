import type { PoolClient } from "pg";
import { calculateDailyTargets, type ActivityLevel, type NutritionGoal, type BiologicalSex } from "@/lib/domain/nutrition";
import { getLatestMeasurement } from "@/lib/health/measurements";
import type { WeeklyPlanPerson } from "./mealPlans";

function ageFromBirthDate(birthDate: Date): number {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birthDate.getMonth() ||
    (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate());
  if (!hasHadBirthdayThisYear) age--;
  return age;
}

export interface MissingPlanningData {
  personId: string;
  displayName: string;
  missing: string[];
}

export interface GatherPlanningContextResult {
  ready: WeeklyPlanPerson[];
  incomplete: MissingPlanningData[];
}

/**
 * Builds each profile's individualized daily targets from their own biometrics
 * (profiles.birth_date/sex/height_cm + activity_level/nutrition_goal + latest measurement) —
 * this is what makes the Coordinator's delegated meal-plan request individualized per person
 * instead of a shared generic target. Profiles missing a required field are reported, not
 * silently skipped or defaulted (IMPLEMENTATION_RULES.md — never invent a value).
 */
export async function gatherWeeklyPlanningContext(client: PoolClient, householdId: string): Promise<GatherPlanningContextResult> {
  const res = await client.query<{
    id: string;
    display_name: string;
    birth_date: Date | null;
    sex: string | null;
    height_cm: string | null;
    activity_level: ActivityLevel | null;
    nutrition_goal: NutritionGoal | null;
  }>(
    `SELECT id, display_name, birth_date, sex, height_cm, activity_level, nutrition_goal
     FROM profiles WHERE household_id = $1`,
    [householdId]
  );

  const ready: WeeklyPlanPerson[] = [];
  const incomplete: MissingPlanningData[] = [];

  for (const row of res.rows) {
    const missing: string[] = [];
    if (!row.birth_date) missing.push("birth_date");
    if (!row.sex) missing.push("sex");
    if (!row.height_cm) missing.push("height_cm");
    if (!row.activity_level) missing.push("activity_level");
    if (!row.nutrition_goal) missing.push("nutrition_goal");

    const latest = await getLatestMeasurement(client, row.id);
    if (!latest) missing.push("measurement (peso)");

    if (missing.length > 0) {
      incomplete.push({ personId: row.id, displayName: row.display_name, missing });
      continue;
    }

    const targets = calculateDailyTargets({
      weightKg: latest!.weightKg,
      heightCm: Number(row.height_cm),
      age: ageFromBirthDate(row.birth_date!),
      sex: row.sex as BiologicalSex,
      activityLevel: row.activity_level!,
      goal: row.nutrition_goal!,
    });
    ready.push({ personId: row.id, dailyTargets: targets });
  }

  return { ready, incomplete };
}

export function nextMonday(from: Date = new Date()): Date {
  const result = new Date(from);
  const day = result.getDay(); // 0=Sunday..6=Saturday
  const daysUntilMonday = day === 1 ? 7 : ((1 - day + 7) % 7) || 7;
  result.setDate(result.getDate() + daysUntilMonday);
  result.setHours(0, 0, 0, 0);
  return result;
}
