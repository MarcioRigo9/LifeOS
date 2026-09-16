"use client";

import * as React from "react";
import { X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export interface FoodCookingMethod {
  method: string;
  yieldFactor: number;
}

export interface FoodOption {
  id: string;
  name: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  cookingMethods: FoodCookingMethod[];
}

export interface IngredientState {
  key: string;
  food: FoodOption | null;
  rawGrams: string;
  method: string; // "" = eaten raw, no cooking step
}

export function IngredientRow({
  householdId,
  ingredient,
  onChange,
  onRemove,
}: {
  householdId: string;
  ingredient: IngredientState;
  onChange: (next: IngredientState) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = React.useState(ingredient.food?.name ?? "");
  const [results, setResults] = React.useState<FoodOption[]>([]);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const rows = await apiGet<
          { id: string; name: string; calories_kcal_per_100g: string; protein_g_per_100g: string; carbs_g_per_100g: string; fat_g_per_100g: string; cooking_methods: FoodCookingMethod[] }[]
        >(`/api/nutrition/foods?householdId=${householdId}&search=${encodeURIComponent(query)}`);
        setResults(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            caloriesPer100g: Number(r.calories_kcal_per_100g),
            proteinPer100g: Number(r.protein_g_per_100g),
            carbsPer100g: Number(r.carbs_g_per_100g),
            fatPer100g: Number(r.fat_g_per_100g),
            cookingMethods: r.cooking_methods,
          }))
        );
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open, householdId]);

  function selectFood(food: FoodOption) {
    setQuery(food.name);
    setOpen(false);
    onChange({ ...ingredient, food, method: "" });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                if (ingredient.food && e.target.value !== ingredient.food.name) onChange({ ...ingredient, food: null });
              }}
              onFocus={() => setOpen(true)}
              placeholder="Buscar alimento..."
              className="pl-9"
            />
          </div>
          {open && results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
              {results.map((food) => (
                <li key={food.id}>
                  <button
                    type="button"
                    onClick={() => selectFood(food)}
                    className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{food.name}</span>
                    <span className="text-xs text-muted-foreground">{food.caloriesPer100g} kcal/100g</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remover ingrediente">
          <X />
        </Button>
      </div>

      {ingredient.food && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            inputMode="decimal"
            placeholder="gramas (cru)"
            value={ingredient.rawGrams}
            onChange={(e) => onChange({ ...ingredient, rawGrams: e.target.value })}
          />
          <select
            value={ingredient.method}
            onChange={(e) => onChange({ ...ingredient, method: e.target.value })}
            className={cn("h-11 rounded-lg border border-input bg-transparent px-3 text-sm", !ingredient.food.cookingMethods.length && "opacity-50")}
            disabled={ingredient.food.cookingMethods.length === 0}
          >
            <option value="">Cru / sem cocção</option>
            {ingredient.food.cookingMethods.map((m) => (
              <option key={m.method} value={m.method}>
                {m.method}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
