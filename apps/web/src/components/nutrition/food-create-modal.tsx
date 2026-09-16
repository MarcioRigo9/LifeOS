"use client";

import * as React from "react";
import { Plus, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger, SheetFooter, SheetClose } from "@/components/ui/sheet";
import { apiPost } from "@/lib/client/api";
import type { FoodOption } from "./ingredient-row";

/** Writes to the GLOBAL foods/cooking_yields catalog (0023_nutrition_catalog_write_grants.sql) —
 * the new food is visible to the whole catalog, not private to this household (foods has no
 * household_id column, same shared-reference-data posture as exercises). */
export function FoodCreateModal({ householdId, onCreated }: { householdId: string; onCreated: (food: FoodOption) => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [calories, setCalories] = React.useState("");
  const [protein, setProtein] = React.useState("");
  const [carbs, setCarbs] = React.useState("");
  const [fat, setFat] = React.useState("");
  const [addYield, setAddYield] = React.useState(false);
  const [method, setMethod] = React.useState("");
  const [rawWeight, setRawWeight] = React.useState("100");
  const [cookedWeight, setCookedWeight] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setName("");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setAddYield(false);
    setMethod("");
    setRawWeight("100");
    setCookedWeight("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !calories || !protein || !carbs || !fat) {
      toast.error("Preencha nome e macros.");
      return;
    }
    setSubmitting(true);
    try {
      const cookingYield =
        addYield && method && rawWeight && cookedWeight
          ? { method, rawWeightG: Number(rawWeight), cookedWeightG: Number(cookedWeight) }
          : undefined;
      const res = await apiPost<{ foodId: string; cookingYieldId: string | null }>("/api/nutrition/foods", {
        householdId,
        name,
        caloriesPer100g: Number(calories),
        proteinPer100g: Number(protein),
        carbsPer100g: Number(carbs),
        fatPer100g: Number(fat),
        cookingYield,
      });
      onCreated({
        id: res.foodId,
        name,
        caloriesPer100g: Number(calories),
        proteinPer100g: Number(protein),
        carbsPer100g: Number(carbs),
        fatPer100g: Number(fat),
        cookingMethods: cookingYield ? [{ method: cookingYield.method, yieldFactor: Number(cookedWeight) / Number(rawWeight) }] : [],
      });
      toast.success(`"${name}" adicionado ao catálogo.`);
      setOpen(false);
      reset();
    } catch {
      toast.error("Não foi possível cadastrar o alimento.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <Plus /> Novo alimento
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Novo alimento</SheetTitle>
          <SheetDescription>Entra no catálogo compartilhado (macros por 100g).</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="foodName">Nome</Label>
            <Input id="foodName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Quinoa" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="foodCalories">Calorias /100g</Label>
              <Input id="foodCalories" inputMode="decimal" required value={calories} onChange={(e) => setCalories(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="foodProtein">Proteína /100g</Label>
              <Input id="foodProtein" inputMode="decimal" required value={protein} onChange={(e) => setProtein(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="foodCarbs">Carboidrato /100g</Label>
              <Input id="foodCarbs" inputMode="decimal" required value={carbs} onChange={(e) => setCarbs(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="foodFat">Gordura /100g</Label>
              <Input id="foodFat" inputMode="decimal" required value={fat} onChange={(e) => setFat(e.target.value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={addYield} onChange={(e) => setAddYield(e.target.checked)} className="size-4" />
            Este alimento é cozido (definir fator de cocção)
          </label>

          {addYield && (
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted p-3">
              <div className="col-span-3 flex flex-col gap-1.5">
                <Label htmlFor="method">Método de preparo</Label>
                <Input id="method" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="grelhado, cozido, assado..." />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rawWeight">Peso cru (g)</Label>
                <Input id="rawWeight" inputMode="decimal" value={rawWeight} onChange={(e) => setRawWeight(e.target.value)} />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="cookedWeight">Peso cozido (g)</Label>
                <Input id="cookedWeight" inputMode="decimal" value={cookedWeight} onChange={(e) => setCookedWeight(e.target.value)} />
              </div>
            </div>
          )}

          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </SheetClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Check />}
              Adicionar ao catálogo
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
