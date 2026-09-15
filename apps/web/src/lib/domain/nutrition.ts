// Deterministic, pure, unit-tested functions — the LLM never does this arithmetic
// (IMPLEMENTATION_RULES.md #8, ARCHITECTURE.md §1 principle 2).

// ---------------------------------------------------------------------------------------------
// Cooking yield
// ---------------------------------------------------------------------------------------------

/** cookedGrams = rawGrams * yieldFactor (yieldFactor = cooked/raw, from cooking_yields). */
export function cookingYield(rawGrams: number, yieldFactor: number): number {
  if (rawGrams < 0) throw new Error("rawGrams must be >= 0");
  if (yieldFactor <= 0) throw new Error("yieldFactor must be > 0");
  return round2(rawGrams * yieldFactor);
}

/** Inverse of cookingYield: how much raw weight is needed to end up with `cookedGrams`. */
export function rawRequired(cookedGrams: number, yieldFactor: number): number {
  if (cookedGrams < 0) throw new Error("cookedGrams must be >= 0");
  if (yieldFactor <= 0) throw new Error("yieldFactor must be > 0");
  return round2(cookedGrams / yieldFactor);
}

export interface RecipeYieldItem {
  foodId: string;
  rawGrams: number;
  yieldFactor: number; // 1.0 for ingredients eaten raw / not cooked
}

export interface RecipeYieldResult {
  totalCookedGrams: number;
  perItem: { foodId: string; cookedGrams: number }[];
}

/** Consolidated cooked yield of a recipe made of several raw ingredients, each with its own
 * (possibly different) cooking yield factor — never a single factor applied to the whole dish. */
export function recipeYield(items: RecipeYieldItem[]): RecipeYieldResult {
  const perItem = items.map((item) => ({
    foodId: item.foodId,
    cookedGrams: cookingYield(item.rawGrams, item.yieldFactor),
  }));
  const totalCookedGrams = round2(perItem.reduce((sum, i) => sum + i.cookedGrams, 0));
  return { totalCookedGrams, perItem };
}

export interface FoodMacros {
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

export interface RecipeMacroItem {
  rawGrams: number;
  yieldFactor: number;
  food: FoodMacros;
}

export interface RecipeMacroProfile {
  totalCookedGrams: number;
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  caloriesPer100gCooked: number;
  proteinPer100gCooked: number;
  carbsPer100gCooked: number;
  fatPer100gCooked: number;
}

/**
 * Nutrition science simplification used deliberately here: cooking changes an ingredient's
 * WEIGHT (water loss/gain) but not the total calories/macros contributed by its dry matter —
 * so total nutrients are computed from RAW grams (as stored in foods/recipe_items), while
 * density (per 100g) is computed against the recipe's actual COOKED weight (via recipeYield).
 * This is what lets two people get different `plannedCookedGrams` for the same dish while both
 * hitting their own calorie target exactly (see generateWeeklyMealPlan).
 */
export function calculateRecipeMacros(items: RecipeMacroItem[]): RecipeMacroProfile {
  const { totalCookedGrams } = recipeYield(
    items.map((i, idx) => ({ foodId: String(idx), rawGrams: i.rawGrams, yieldFactor: i.yieldFactor }))
  );
  if (totalCookedGrams <= 0) throw new Error("recipe yields zero cooked grams");

  let totalCalories = 0;
  let totalProteinG = 0;
  let totalCarbsG = 0;
  let totalFatG = 0;
  for (const item of items) {
    const factor = item.rawGrams / 100;
    totalCalories += factor * item.food.caloriesPer100g;
    totalProteinG += factor * item.food.proteinPer100g;
    totalCarbsG += factor * item.food.carbsPer100g;
    totalFatG += factor * item.food.fatPer100g;
  }

  const scale = 100 / totalCookedGrams;
  return {
    totalCookedGrams,
    totalCalories: round2(totalCalories),
    totalProteinG: round2(totalProteinG),
    totalCarbsG: round2(totalCarbsG),
    totalFatG: round2(totalFatG),
    caloriesPer100gCooked: round2(totalCalories * scale),
    proteinPer100gCooked: round2(totalProteinG * scale),
    carbsPer100gCooked: round2(totalCarbsG * scale),
    fatPer100gCooked: round2(totalFatG * scale),
  };
}

// ---------------------------------------------------------------------------------------------
// Portion split
// ---------------------------------------------------------------------------------------------

export interface PortionTarget {
  personId: string;
  targetGrams: number;
}

export interface PortionAllocation {
  personId: string;
  allocatedGrams: number;
}

/**
 * Splits `totalCookedGrams` across people proportionally to how much each one wanted
 * (`targetGrams`), so the actual yield of a batch (which rarely matches the sum of individual
 * targets exactly) is distributed with nothing left over and nothing invented: the allocations
 * always sum to exactly `totalCookedGrams` (rounding remainder goes to the last person,
 * deterministically — never silently dropped).
 */
export function portionSplit(totalCookedGrams: number, targets: PortionTarget[]): PortionAllocation[] {
  if (targets.length === 0) throw new Error("portionSplit requires at least one target");
  const sumTargets = targets.reduce((sum, t) => sum + t.targetGrams, 0);
  if (sumTargets <= 0) throw new Error("sum of targetGrams must be > 0");

  let allocated = 0;
  return targets.map((t, i) => {
    const isLast = i === targets.length - 1;
    const allocatedGrams = isLast
      ? round2(totalCookedGrams - allocated)
      : round2(totalCookedGrams * (t.targetGrams / sumTargets));
    allocated = round2(allocated + allocatedGrams);
    return { personId: t.personId, allocatedGrams };
  });
}

// ---------------------------------------------------------------------------------------------
// Shopping quantity (whole-package purchasing)
// ---------------------------------------------------------------------------------------------

export interface ShoppingQuantityResult {
  buyQty: number; // integer number of whole packages
  totalBoughtGrams: number;
  surplusGrams: number;
}

/** Whole packages only — never "1.2 packages". This is what turns "1.2kg needed, 1kg packages"
 * into "buy 2 packages, 800g surplus", not a fractional-package cost estimate. */
export function shoppingQuantity(neededGrams: number, packageSizeGrams: number): ShoppingQuantityResult {
  if (neededGrams < 0) throw new Error("neededGrams must be >= 0");
  if (packageSizeGrams <= 0) throw new Error("packageSizeGrams must be > 0");
  if (neededGrams === 0) return { buyQty: 0, totalBoughtGrams: 0, surplusGrams: 0 };

  const buyQty = Math.ceil(neededGrams / packageSizeGrams);
  const totalBoughtGrams = round2(buyQty * packageSizeGrams);
  const surplusGrams = round2(totalBoughtGrams - neededGrams);
  return { buyQty, totalBoughtGrams, surplusGrams };
}

// ---------------------------------------------------------------------------------------------
// Weekly cost optimizer
// ---------------------------------------------------------------------------------------------

export interface NeededFoodItem {
  foodId: string;
  neededRawGrams: number; // already aggregated across every meal that uses this food this week
}

export interface PriceOffer {
  foodId: string;
  marketId: string;
  packageSizeGrams: number;
  priceCents: number;
}

export interface PantryStockItem {
  foodId: string;
  grams: number;
}

export interface ShoppingPlanItem {
  foodId: string;
  neededAfterPantryGrams: number;
  chosenOffer: PriceOffer | null;
  buyQty: number;
  totalBoughtGrams: number;
  surplusGrams: number;
  costCents: number;
  priceUnavailable: boolean;
}

export interface WeeklyCostOptimizerResult {
  items: ShoppingPlanItem[];
  totalCostCents: number;
  itemsWithoutPrice: string[]; // foodIds — surfaced explicitly, never silently priced at 0
}

/**
 * Minimizes REAL weekly cost: whole closed packages (shoppingQuantity), pantry stock consumed
 * first (reuse across meals — buying once for the week, not once per meal, is what
 * "reaproveitamento" means here), and the cheapest available price-per-gram offer per food.
 * Never invents a price (SECURITY_MODEL.md §7) — an item with no matching offer is reported in
 * `itemsWithoutPrice`, cost 0, `priceUnavailable: true`, never silently omitted or guessed.
 */
export function weeklyCostOptimizer(
  needed: NeededFoodItem[],
  offers: PriceOffer[],
  pantryStock: PantryStockItem[] = []
): WeeklyCostOptimizerResult {
  const pantryByFood = new Map(pantryStock.map((p) => [p.foodId, p.grams]));
  const offersByFood = new Map<string, PriceOffer[]>();
  for (const offer of offers) {
    if (!offersByFood.has(offer.foodId)) offersByFood.set(offer.foodId, []);
    offersByFood.get(offer.foodId)!.push(offer);
  }

  // Aggregate needed grams per food — multiple meals/recipes using the same food this week
  // are summed BEFORE purchasing, which is exactly the bulk-buy reuse the optimizer relies on.
  const neededByFood = new Map<string, number>();
  for (const item of needed) {
    neededByFood.set(item.foodId, (neededByFood.get(item.foodId) ?? 0) + item.neededRawGrams);
  }

  const items: ShoppingPlanItem[] = [];
  const itemsWithoutPrice: string[] = [];
  let totalCostCents = 0;

  for (const [foodId, totalNeeded] of neededByFood) {
    const pantry = pantryByFood.get(foodId) ?? 0;
    const neededAfterPantryGrams = Math.max(0, round2(totalNeeded - pantry));

    if (neededAfterPantryGrams === 0) {
      items.push({
        foodId,
        neededAfterPantryGrams: 0,
        chosenOffer: null,
        buyQty: 0,
        totalBoughtGrams: 0,
        surplusGrams: 0,
        costCents: 0,
        priceUnavailable: false,
      });
      continue;
    }

    const candidateOffers = offersByFood.get(foodId) ?? [];
    if (candidateOffers.length === 0) {
      itemsWithoutPrice.push(foodId);
      items.push({
        foodId,
        neededAfterPantryGrams,
        chosenOffer: null,
        buyQty: 0,
        totalBoughtGrams: 0,
        surplusGrams: 0,
        costCents: 0,
        priceUnavailable: true,
      });
      continue;
    }

    // Cheapest by price-per-gram among real, captured offers — never a computed/invented price.
    const cheapest = candidateOffers.reduce((best, offer) =>
      offer.priceCents / offer.packageSizeGrams < best.priceCents / best.packageSizeGrams ? offer : best
    );
    const { buyQty, totalBoughtGrams, surplusGrams } = shoppingQuantity(neededAfterPantryGrams, cheapest.packageSizeGrams);
    const costCents = buyQty * cheapest.priceCents;
    totalCostCents += costCents;

    items.push({
      foodId,
      neededAfterPantryGrams,
      chosenOffer: cheapest,
      buyQty,
      totalBoughtGrams,
      surplusGrams,
      costCents,
      priceUnavailable: false,
    });
  }

  return { items, totalCostCents, itemsWithoutPrice };
}

// ---------------------------------------------------------------------------------------------
// Individualized daily calorie/macro targets
// ---------------------------------------------------------------------------------------------

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type NutritionGoal = "lose_weight" | "maintain" | "gain_muscle";
export type BiologicalSex = "male" | "female";

const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENT_KCAL: Record<NutritionGoal, number> = {
  lose_weight: -500,
  maintain: 0,
  gain_muscle: 300,
};

export interface PersonBiometrics {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: BiologicalSex;
  activityLevel: ActivityLevel;
  goal: NutritionGoal;
}

export interface DailyTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Mifflin-St Jeor BMR x activity factor x goal adjustment, then a standard macro split
 * (2g protein/kg bodyweight, 25% of calories from fat, remainder carbs). A documented,
 * reproducible formula — not the LLM guessing a number (IMPLEMENTATION_RULES.md #8).
 */
export function calculateDailyTargets(p: PersonBiometrics): DailyTargets {
  if (p.weightKg <= 0 || p.heightCm <= 0 || p.age <= 0) {
    throw new Error("weightKg, heightCm and age must be positive");
  }
  const bmr =
    p.sex === "male"
      ? 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + 5
      : 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age - 161;
  const tdee = bmr * ACTIVITY_MULTIPLIER[p.activityLevel];
  const calories = Math.round(tdee + GOAL_ADJUSTMENT_KCAL[p.goal]);

  const proteinG = Math.round(p.weightKg * 2);
  const fatCalories = calories * 0.25;
  const fatG = Math.round(fatCalories / 9);
  const proteinCalories = proteinG * 4;
  const carbsCalories = Math.max(0, calories - proteinCalories - fatCalories);
  const carbsG = Math.round(carbsCalories / 4);

  return { calories, proteinG, carbsG, fatG };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
