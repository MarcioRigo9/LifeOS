import { describe, expect, it } from "vitest";
import {
  cookingYield,
  rawRequired,
  recipeYield,
  portionSplit,
  shoppingQuantity,
  weeklyCostOptimizer,
  calculateDailyTargets,
  calculateRecipeMacros,
  foodNameMatchesTag,
  foodNameMatchesAnyTag,
} from "@/lib/domain/nutrition";

describe("foodNameMatchesTag / foodNameMatchesAnyTag", () => {
  it("matches the critical example: 'Frango' tag excludes 'Peito de frango'", () => {
    expect(foodNameMatchesTag("Peito de frango", "Frango")).toBe(true);
  });

  it("matches a broad category tag against a specific catalog item via curated aliases", () => {
    expect(foodNameMatchesTag("Tilápia", "Peixe")).toBe(true);
    expect(foodNameMatchesTag("Salmão grelhado", "peixe")).toBe(true);
  });

  it("is accent- and case-insensitive", () => {
    expect(foodNameMatchesTag("TILÁPIA", "peixe")).toBe(true);
    expect(foodNameMatchesTag("tilapia", "PEIXE")).toBe(true);
  });

  it("falls back to plain substring match for tags with no curated alias", () => {
    expect(foodNameMatchesTag("Brócolis", "Brócolis")).toBe(true);
    expect(foodNameMatchesTag("Brócolis", "Couve")).toBe(false);
  });

  it("does not match unrelated foods", () => {
    expect(foodNameMatchesTag("Arroz branco", "Frango")).toBe(false);
  });

  it("foodNameMatchesAnyTag matches if ANY tag matches", () => {
    expect(foodNameMatchesAnyTag("Peito de frango", ["Ovos", "Frango"])).toBe(true);
    expect(foodNameMatchesAnyTag("Peito de frango", ["Ovos", "Peixe"])).toBe(false);
  });
});

describe("cookingYield / rawRequired", () => {
  it("converts raw to cooked and back exactly (round-trip)", () => {
    const cooked = cookingYield(100, 0.75); // e.g. rice loses water... wait, gains: yieldFactor > 1 typically for rice
    expect(cooked).toBe(75);
    expect(rawRequired(75, 0.75)).toBe(100);
  });

  it("supports yield factors > 1 (e.g. rice absorbing water: 100g raw -> 250g cooked)", () => {
    expect(cookingYield(100, 2.5)).toBe(250);
    expect(rawRequired(250, 2.5)).toBe(100);
  });

  it("rejects non-positive yield factors", () => {
    expect(() => cookingYield(100, 0)).toThrow();
    expect(() => cookingYield(100, -1)).toThrow();
  });
});

describe("recipeYield", () => {
  it("consolidates multiple ingredients, each with its own yield factor", () => {
    const result = recipeYield([
      { foodId: "chicken", rawGrams: 200, yieldFactor: 0.7 }, // grilled chicken loses water
      { foodId: "rice", rawGrams: 100, yieldFactor: 2.5 }, // rice absorbs water
    ]);
    expect(result.perItem).toEqual([
      { foodId: "chicken", cookedGrams: 140 },
      { foodId: "rice", cookedGrams: 250 },
    ]);
    expect(result.totalCookedGrams).toBe(390);
  });
});

describe("portionSplit", () => {
  it("splits the actual cooked total proportionally to targets, summing exactly (no residue)", () => {
    // Recipe yielded 480g, but Márcio wanted 300g and Brenda wanted 200g (sum 500, not 480).
    const allocations = portionSplit(480, [
      { personId: "marcio", targetGrams: 300 },
      { personId: "brenda", targetGrams: 200 },
    ]);
    const sum = allocations.reduce((s, a) => s + a.allocatedGrams, 0);
    expect(Math.round(sum * 100) / 100).toBe(480);
    expect(allocations[0].allocatedGrams).toBe(288); // 480 * 300/500
    expect(allocations[1].allocatedGrams).toBe(192); // remainder, exact
  });

  it("handles a single target (gets everything)", () => {
    const allocations = portionSplit(150, [{ personId: "solo", targetGrams: 999 }]);
    expect(allocations).toEqual([{ personId: "solo", allocatedGrams: 150 }]);
  });
});

describe("shoppingQuantity — whole packages only", () => {
  it("the exact required scenario: 1.2kg needed, 1kg packages -> 2 packages, 800g surplus", () => {
    const result = shoppingQuantity(1200, 1000);
    expect(result.buyQty).toBe(2);
    expect(result.totalBoughtGrams).toBe(2000);
    expect(result.surplusGrams).toBe(800);
  });

  it("exact multiples need no surplus", () => {
    expect(shoppingQuantity(2000, 1000)).toEqual({ buyQty: 2, totalBoughtGrams: 2000, surplusGrams: 0 });
  });

  it("zero needed means zero bought", () => {
    expect(shoppingQuantity(0, 1000)).toEqual({ buyQty: 0, totalBoughtGrams: 0, surplusGrams: 0 });
  });
});

describe("weeklyCostOptimizer", () => {
  it("the exact required scenario: never 1.2 x R$20 = R$24 — always whole packages, R$40 with 800g surplus", () => {
    const result = weeklyCostOptimizer(
      [{ foodId: "chicken-breast", neededRawGrams: 1200 }],
      [{ foodId: "chicken-breast", marketId: "market-1", packageSizeGrams: 1000, priceCents: 2000 }]
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].buyQty).toBe(2);
    expect(result.items[0].costCents).toBe(4000); // R$ 40,00 — NOT 2400 (R$ 24,00)
    expect(result.items[0].surplusGrams).toBe(800);
    expect(result.totalCostCents).toBe(4000);
  });

  it("aggregates the same food needed across multiple meals before buying once (reaproveitamento)", () => {
    const result = weeklyCostOptimizer(
      [
        { foodId: "chicken-breast", neededRawGrams: 400 }, // Monday lunch
        { foodId: "chicken-breast", neededRawGrams: 400 }, // Wednesday dinner
        { foodId: "chicken-breast", neededRawGrams: 400 }, // marmitas
      ],
      [{ foodId: "chicken-breast", marketId: "m1", packageSizeGrams: 1000, priceCents: 2000 }]
    );
    // Aggregated to 1200g total, same as buying once for the whole week.
    expect(result.items[0].neededAfterPantryGrams).toBe(1200);
    expect(result.items[0].buyQty).toBe(2);
  });

  it("picks the cheapest price-per-gram offer among several markets", () => {
    const result = weeklyCostOptimizer(
      [{ foodId: "rice", neededRawGrams: 1000 }],
      [
        { foodId: "rice", marketId: "expensive", packageSizeGrams: 1000, priceCents: 800 },
        { foodId: "rice", marketId: "cheap", packageSizeGrams: 5000, priceCents: 2500 }, // 0.5/g vs 0.8/g
      ]
    );
    expect(result.items[0].chosenOffer?.marketId).toBe("cheap");
  });

  it("subtracts pantry stock before buying anything", () => {
    const result = weeklyCostOptimizer(
      [{ foodId: "rice", neededRawGrams: 1000 }],
      [{ foodId: "rice", marketId: "m1", packageSizeGrams: 1000, priceCents: 800 }],
      [{ foodId: "rice", grams: 1000 }] // already have exactly enough
    );
    expect(result.items[0].buyQty).toBe(0);
    expect(result.items[0].costCents).toBe(0);
    expect(result.totalCostCents).toBe(0);
  });

  it("never invents a price — an item with no offer is explicitly flagged, cost stays 0", () => {
    const result = weeklyCostOptimizer([{ foodId: "truffle", neededRawGrams: 50 }], []);
    expect(result.items[0].priceUnavailable).toBe(true);
    expect(result.items[0].costCents).toBe(0);
    expect(result.itemsWithoutPrice).toEqual(["truffle"]);
  });
});

describe("calculateRecipeMacros", () => {
  it("computes total nutrients from RAW grams, but density per the recipe's COOKED weight", () => {
    // 200g raw chicken (yield 0.7 -> 140g cooked), 100g raw rice (yield 2.5 -> 250g cooked).
    const profile = calculateRecipeMacros([
      { rawGrams: 200, yieldFactor: 0.7, food: { caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 } },
      { rawGrams: 100, yieldFactor: 2.5, food: { caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 } },
    ]);
    expect(profile.totalCookedGrams).toBe(390); // 140 + 250
    // Total calories from RAW grams: chicken 200*1.65=330, rice 100*1.30=130 -> 460 total.
    expect(profile.totalCalories).toBe(460);
    // Density is against cooked weight: 460 / 390 * 100 ≈ 117.95
    expect(profile.caloriesPer100gCooked).toBeCloseTo(117.95, 1);
  });
});

describe("calculateDailyTargets", () => {
  it("computes individualized targets that differ between two different people (Márcio vs Brenda)", () => {
    const marcio = calculateDailyTargets({
      weightKg: 85,
      heightCm: 178,
      age: 35,
      sex: "male",
      activityLevel: "moderate",
      goal: "lose_weight",
    });
    const brenda = calculateDailyTargets({
      weightKg: 62,
      heightCm: 165,
      age: 32,
      sex: "female",
      activityLevel: "light",
      goal: "maintain",
    });

    expect(marcio.calories).not.toBe(brenda.calories);
    expect(marcio.proteinG).toBe(170); // 85kg * 2g/kg
    expect(brenda.proteinG).toBe(124); // 62kg * 2g/kg
    expect(marcio.calories).toBeGreaterThan(0);
    expect(brenda.calories).toBeGreaterThan(0);
  });

  it("a deficit goal produces fewer calories than maintenance, all else equal", () => {
    const base = { weightKg: 80, heightCm: 175, age: 30, sex: "male" as const, activityLevel: "moderate" as const };
    const maintain = calculateDailyTargets({ ...base, goal: "maintain" });
    const lose = calculateDailyTargets({ ...base, goal: "lose_weight" });
    const gain = calculateDailyTargets({ ...base, goal: "gain_muscle" });
    expect(lose.calories).toBeLessThan(maintain.calories);
    expect(gain.calories).toBeGreaterThan(maintain.calories);
  });
});
