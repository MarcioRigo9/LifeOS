import type { Pool, PoolClient } from "pg";
import { withHouseholdContext } from "@/lib/db/pool";
import { recipeYield, portionSplit, foodNameMatchesAnyTag, type DailyTargets, type NeededFoodItem } from "@/lib/domain/nutrition";
import { getRecipeIngredients, getRecipeMacroProfile } from "./recipes";
import { listMealsByType, type MealType } from "./meals";
import { createDecisionProposal, type CreateProposalResult } from "@/lib/agents/decisions";
import { logAudit } from "@/lib/audit";

// Calorie share per meal slot — documented, fixed, not the LLM guessing (IMPLEMENTATION_RULES.md #8).
const SLOT_SHARE: Record<"breakfast" | "lunch" | "dinner", number> = {
  breakfast: 0.25,
  lunch: 0.4,
  dinner: 0.35,
};
const MAIN_SLOTS: ("breakfast" | "lunch" | "dinner")[] = ["breakfast", "lunch", "dinner"];
const DAYS_PER_WEEK = 7;

export interface WeeklyPlanPerson {
  personId: string;
  dailyTargets: DailyTargets;
}

export interface GenerateWeeklyPlanInput {
  householdId: string;
  userId: string;
  weekStartDate: Date;
  people: WeeklyPlanPerson[];
}

export interface GeneratedPlanItem {
  personId: string;
  dayOfWeek: number;
  type: "breakfast" | "lunch" | "dinner";
  mealId: string;
  plannedCookedGrams: number;
}

export interface GenerateWeeklyPlanResult {
  mealPlanId: string;
  items: GeneratedPlanItem[];
}

/**
 * Deterministic weekly assembler: rotates through the household's available meals per slot
 * (round-robin by day index — the same small set of recipes recurring across the week is what
 * makes batch cooking/marmitas and bulk ingredient buying meaningful, not an implementation
 * accident), and sizes each person's cooked-gram portion from THEIR OWN daily calorie target
 * and the chosen recipe's actual calorie density (never a shared, generic portion).
 */
export async function generateWeeklyMealPlan(pool: Pool, input: GenerateWeeklyPlanInput): Promise<GenerateWeeklyPlanResult> {
  if (input.people.length === 0) throw new Error("at least one person is required");

  const mealsByType: Record<"breakfast" | "lunch" | "dinner", { id: string; recipeId: string }[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
  };
  for (const type of MAIN_SLOTS) {
    const meals = await listMealsByType(pool, { householdId: input.householdId, userId: input.userId, type });
    if (meals.length === 0) throw new Error(`no meals of type "${type}" available for this household`);
    mealsByType[type] = meals.map((m) => ({ id: m.id, recipeId: m.recipeId }));
  }

  return withHouseholdContext(pool, { userId: input.userId, householdId: input.householdId }, async (client) => {
    const planRes = await client.query<{ id: string }>(
      `INSERT INTO meal_plans (household_id, week_start_date, status) VALUES ($1, $2, 'draft') RETURNING id`,
      [input.householdId, input.weekStartDate]
    );
    const mealPlanId = planRes.rows[0].id;

    const macroProfileCache = new Map<string, Awaited<ReturnType<typeof getRecipeMacroProfile>>>();
    async function macroProfileFor(recipeId: string) {
      if (!macroProfileCache.has(recipeId)) {
        macroProfileCache.set(recipeId, await getRecipeMacroProfile(client, recipeId));
      }
      return macroProfileCache.get(recipeId)!;
    }

    // Food names per candidate recipe, batched once — needed to test each option against a
    // person's dietary_preferences (dislikes / reheat-intolerances) before it's ever allocated.
    const allRecipeIds = [...new Set(Object.values(mealsByType).flat().map((m) => m.recipeId))];
    const foodNamesByRecipe = new Map<string, string[]>();
    if (allRecipeIds.length > 0) {
      const namesRes = await client.query<{ recipe_id: string; name: string }>(
        `SELECT ri.recipe_id, f.name FROM recipe_items ri JOIN foods f ON f.id = ri.food_id WHERE ri.recipe_id = ANY($1)`,
        [allRecipeIds]
      );
      for (const row of namesRes.rows) {
        const arr = foodNamesByRecipe.get(row.recipe_id) ?? [];
        arr.push(row.name);
        foodNamesByRecipe.set(row.recipe_id, arr);
      }
    }

    const prefsRes = await client.query<{ person_id: string; disliked_foods: string[]; reheat_intolerant_foods: string[] }>(
      `SELECT person_id, disliked_foods, reheat_intolerant_foods FROM dietary_preferences
       WHERE household_id = $1 AND person_id = ANY($2)`,
      [input.householdId, input.people.map((p) => p.personId)]
    );
    const prefsByPerson = new Map(prefsRes.rows.map((r) => [r.person_id, r]));

    const items: GeneratedPlanItem[] = [];
    for (const person of input.people) {
      const prefs = prefsByPerson.get(person.personId);

      // Filtered once per person/slot (not per day): dislikes are excluded from every slot;
      // reheat-intolerant foods are excluded ONLY from lunch, since lunch is the household's
      // Mon-Fri marmita slot (prepped ahead, then reheated) while dinner is cooked fresh — the
      // household's stated logistics (prep_schedule) map directly onto this app's existing
      // lunch/dinner meal-type split, no separate "fresh vs. prepped" flag needed.
      const personMealsByType: Record<"breakfast" | "lunch" | "dinner", { id: string; recipeId: string }[]> = {
        breakfast: mealsByType.breakfast,
        lunch: mealsByType.lunch,
        dinner: mealsByType.dinner,
      };
      if (prefs) {
        for (const type of MAIN_SLOTS) {
          const excludedTags = type === "lunch" ? [...prefs.disliked_foods, ...prefs.reheat_intolerant_foods] : prefs.disliked_foods;
          if (excludedTags.length === 0) continue;
          const filtered = mealsByType[type].filter((m) => {
            const foodNames = foodNamesByRecipe.get(m.recipeId) ?? [];
            return !foodNames.some((name) => foodNameMatchesAnyTag(name, excludedTags));
          });
          if (filtered.length === 0) {
            throw new Error(
              `no ${type} meals available for person ${person.personId} that respect their dietary preferences ` +
                `(excluded: ${excludedTags.join(", ")}) — add a recipe without these foods`
            );
          }
          personMealsByType[type] = filtered;
        }
      }

      for (let day = 0; day < DAYS_PER_WEEK; day++) {
        for (const type of MAIN_SLOTS) {
          const options = personMealsByType[type];
          const meal = options[day % options.length]; // round-robin: recurs across the week on purpose
          const profile = await macroProfileFor(meal.recipeId);

          const targetCaloriesForSlot = person.dailyTargets.calories * SLOT_SHARE[type];
          const plannedCookedGrams = Math.round((targetCaloriesForSlot / profile.caloriesPer100gCooked) * 100 * 100) / 100;

          await client.query(
            `INSERT INTO meal_plan_items (household_id, meal_plan_id, meal_id, person_id, day_of_week, planned_cooked_grams)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [input.householdId, mealPlanId, meal.id, person.personId, day, plannedCookedGrams]
          );
          items.push({ personId: person.personId, dayOfWeek: day, type, mealId: meal.id, plannedCookedGrams });
        }
      }
    }

    await logAudit(client, {
      householdId: input.householdId,
      actorType: "user",
      actorId: input.userId,
      eventType: "meal_plan.generated",
      entityType: "meal_plans",
      entityId: mealPlanId,
    });

    return { mealPlanId, items };
  });
}

/**
 * Scales each meal_plan_item's ingredients from the recipe's raw grams (recipeYield's basis)
 * to the actual planned portion, then sums by food across the whole week — the aggregation
 * step that turns "used in 6 different meals" into "buy once" (weeklyCostOptimizer input).
 */
export async function aggregateNeededRawIngredients(client: PoolClient, mealPlanId: string): Promise<NeededFoodItem[]> {
  const itemsRes = await client.query<{ meal_id: string; planned_cooked_grams: string }>(
    `SELECT mpi.meal_id, mpi.planned_cooked_grams FROM meal_plan_items mpi WHERE mpi.meal_plan_id = $1`,
    [mealPlanId]
  );

  const recipeIdByMeal = new Map<string, string>();
  const recipeIngredientsCache = new Map<string, Awaited<ReturnType<typeof getRecipeIngredients>>>();
  const needed = new Map<string, number>();

  for (const row of itemsRes.rows) {
    let recipeId = recipeIdByMeal.get(row.meal_id);
    if (!recipeId) {
      const mealRes = await client.query<{ recipe_id: string }>("SELECT recipe_id FROM meals WHERE id = $1", [row.meal_id]);
      recipeId = mealRes.rows[0].recipe_id;
      recipeIdByMeal.set(row.meal_id, recipeId);
    }

    let ingredients = recipeIngredientsCache.get(recipeId);
    if (!ingredients) {
      ingredients = await getRecipeIngredients(client, recipeId);
      recipeIngredientsCache.set(recipeId, ingredients);
    }

    const { totalCookedGrams } = recipeYield(
      ingredients.map((i, idx) => ({ foodId: String(idx), rawGrams: i.rawGrams, yieldFactor: i.yieldFactor }))
    );
    const scale = Number(row.planned_cooked_grams) / totalCookedGrams;

    for (const ingredient of ingredients) {
      needed.set(ingredient.foodId, (needed.get(ingredient.foodId) ?? 0) + ingredient.rawGrams * scale);
    }
  }

  return Array.from(needed.entries()).map(([foodId, neededRawGrams]) => ({
    foodId,
    neededRawGrams: Math.round(neededRawGrams * 100) / 100,
  }));
}

export interface WeeklyNutritionSummary {
  activeMealPlanId: string | null;
  plannedMealCount: number;
}

/** Whether the household has an ACTIVE plan for the given week and how many meals it planned for
 * this person — used by the Weekly Review engine (Fase 5 §2.2) via handleWeeklyNutritionSummaryTask.
 * The Coordinator never queries meal_plans directly (AGENT_CONTRACTS.md §14: Nutrition domain
 * data always goes through the Nutrition Agent). */
export async function getWeeklyNutritionSummary(
  client: PoolClient,
  params: { householdId: string; personId: string; weekStartDate: Date }
): Promise<WeeklyNutritionSummary> {
  const planRes = await client.query<{ id: string }>(
    `SELECT id FROM meal_plans WHERE household_id = $1 AND status = 'active' AND week_start_date = $2 LIMIT 1`,
    [params.householdId, params.weekStartDate]
  );
  if (planRes.rowCount === 0) return { activeMealPlanId: null, plannedMealCount: 0 };

  const itemsRes = await client.query<{ count: string }>(
    `SELECT count(*) AS count FROM meal_plan_items WHERE meal_plan_id = $1 AND person_id = $2`,
    [planRes.rows[0].id, params.personId]
  );
  return { activeMealPlanId: planRes.rows[0].id, plannedMealCount: Number(itemsRes.rows[0].count) };
}

/**
 * Human-in-the-loop gate (SECURITY_MODEL.md §5-6, AGENT_CONTRACTS.md §8): activating/changing
 * an ACTIVE meal_plan is never applied directly. This always goes through the Policy Engine
 * (which classifies `meal_plan.activate` as MEDIUM, see evaluateRisk.ts) and produces a
 * DecisionProposal — the caller must separately approve + execute it (decisions.ts) before the
 * plan's status actually changes.
 */
export async function proposeMealPlanActivation(
  pool: Pool,
  params: { householdId: string; userId: string; mealPlanId: string }
): Promise<CreateProposalResult> {
  return withHouseholdContext(pool, { userId: params.userId, householdId: params.householdId }, async (client) => {
    const res = await client.query<{ id: string; version: number; status: string }>(
      "SELECT id, version, status FROM meal_plans WHERE id = $1",
      [params.mealPlanId]
    );
    if (res.rowCount === 0) throw new Error("meal plan not found");
    const plan = res.rows[0];

    return createDecisionProposal(client, {
      householdId: params.householdId,
      agentKey: "nutrition",
      envelope: {
        actionType: "meal_plan.activate",
        actionPayload: { newStatus: "active" },
        targetEntityIds: [plan.id],
        expectedVersions: { [`meal_plan:${plan.id}`]: plan.version },
        scope: { householdId: params.householdId, entityCount: 1, reversible: true, financialImpactCents: 0 },
      },
    });
  });
}
