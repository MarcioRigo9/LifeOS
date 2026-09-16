"use client";

import * as React from "react";
import Link from "next/link";
import { ChefHat, Plus, Search, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger, SheetFooter, SheetClose } from "@/components/ui/sheet";
import { IngredientRow, type IngredientState, type FoodOption } from "@/components/nutrition/ingredient-row";
import { FoodCreateModal } from "@/components/nutrition/food-create-modal";
import { useSession } from "@/components/providers/session-provider";
import { useFetch } from "@/lib/client/useFetch";
import { apiPost, ApiError } from "@/lib/client/api";
import { calculateRecipeMacros } from "@/lib/domain/nutrition";

interface RecipeListItem {
  id: string;
  name: string;
  instructions: string | null;
  servings: number;
  created_at: string;
  macros: { totalCalories: number; totalProteinG: number; totalCarbsG: number; totalFatG: number; totalCookedGrams: number } | null;
}

export default function RecipesPage() {
  const { householdId, loading: sessionLoading } = useSession();
  const [search, setSearch] = React.useState("");
  const url = householdId ? `/api/nutrition/recipes?householdId=${householdId}${search ? `&search=${encodeURIComponent(search)}` : ""}` : null;
  const { data: recipes, loading, refresh } = useFetch<RecipeListItem[]>(url);

  const isLoading = sessionLoading || loading;

  return (
    <AppShell>
      <TopBar title="Receitas" subtitle="Catálogo do household" />

      <div className="flex flex-col gap-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar receita..." className="pl-9" />
          </div>
          {householdId && <RecipeCreateSheet householdId={householdId} onCreated={refresh} />}
          <Button asChild variant="ghost" size="sm" className="ml-auto">
            <Link href="/nutrition">Voltar ao plano</Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : !recipes || recipes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <ChefHat className="size-8" />
              Nenhuma receita ainda — crie a primeira acima.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} householdId={householdId!} onChanged={refresh} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RecipeCard({ recipe, householdId, onChanged }: { recipe: RecipeListItem; householdId: string; onChanged: () => void }) {
  const perServing = recipe.macros
    ? {
        calories: Math.round(recipe.macros.totalCalories / recipe.servings),
        protein: Math.round(recipe.macros.totalProteinG / recipe.servings),
        carbs: Math.round(recipe.macros.totalCarbsG / recipe.servings),
        fat: Math.round(recipe.macros.totalFatG / recipe.servings),
      }
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{recipe.name}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {recipe.servings} porç{recipe.servings === 1 ? "ão" : "ões"}
          {recipe.macros && ` · ${Math.round(recipe.macros.totalCookedGrams)}g cozido total`}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {perServing && (
          <div className="grid grid-cols-4 gap-1.5 text-center">
            <MiniStat label="kcal" value={perServing.calories} />
            <MiniStat label="prot" value={`${perServing.protein}g`} />
            <MiniStat label="carb" value={`${perServing.carbs}g`} />
            <MiniStat label="gord" value={`${perServing.fat}g`} />
          </div>
        )}
        <AddAsMealButton recipeId={recipe.id} recipeName={recipe.name} householdId={householdId} onDone={onChanged} />
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-muted px-1.5 py-1.5">
      <p className="text-xs font-semibold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

const MEAL_TYPES = [
  { value: "breakfast", label: "Café da manhã" },
  { value: "lunch", label: "Almoço" },
  { value: "dinner", label: "Jantar" },
  { value: "snack", label: "Lanche" },
] as const;

function AddAsMealButton({ recipeId, recipeName, householdId, onDone }: { recipeId: string; recipeName: string; householdId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState<(typeof MEAL_TYPES)[number]["value"]>("lunch");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      await apiPost(`/api/nutrition/recipes/${recipeId}/meals`, { householdId, name: recipeName, type });
      toast.success("Adicionada ao pool de refeições — já entra no próximo plano gerado.");
      setOpen(false);
      onDone();
    } catch {
      toast.error("Não foi possível adicionar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          <Plus /> Usar em refeição
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Adicionar como refeição</SheetTitle>
          <SheetDescription>&quot;{recipeName}&quot; entra no pool que o gerador de plano semanal usa.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mealType">Tipo</Label>
          <select
            id="mealType"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {MEAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </SheetClose>
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Check />}
            Adicionar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

let ingredientKeyCounter = 0;

function RecipeCreateSheet({ householdId, onCreated }: { householdId: string; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [servings, setServings] = React.useState("2");
  const [ingredients, setIngredients] = React.useState<IngredientState[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  function addIngredient() {
    ingredientKeyCounter++;
    setIngredients((prev) => [...prev, { key: `ing-${ingredientKeyCounter}`, food: null, rawGrams: "", method: "" }]);
  }

  function updateIngredient(key: string, next: IngredientState) {
    setIngredients((prev) => prev.map((i) => (i.key === key ? next : i)));
  }

  function removeIngredient(key: string) {
    setIngredients((prev) => prev.filter((i) => i.key !== key));
  }

  function onFoodCreated(food: FoodOption) {
    // The newly-created food becomes the LAST empty (or newest) ingredient row's selection —
    // simplest, predictable behavior: append it as a new ready-to-use row.
    ingredientKeyCounter++;
    setIngredients((prev) => [...prev, { key: `ing-${ingredientKeyCounter}`, food, rawGrams: "", method: "" }]);
  }

  // Live preview — reuses domain/nutrition.ts's OWN pure functions (recipeYield,
  // calculateRecipeMacros) client-side, never a re-implementation of the formula in this
  // component (Fase Frontend Extension §2: "não faça contas manuais no componente React").
  const ready = ingredients.filter((i) => i.food && Number(i.rawGrams) > 0);
  const preview = React.useMemo(() => {
    if (ready.length === 0) return null;
    try {
      const items = ready.map((i) => {
        const yieldFactor = i.method ? i.food!.cookingMethods.find((m) => m.method === i.method)?.yieldFactor ?? 1 : 1;
        return { rawGrams: Number(i.rawGrams), yieldFactor, food: i.food! };
      });
      return calculateRecipeMacros(items);
    } catch {
      return null;
    }
  }, [ready]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || ready.length === 0) {
      toast.error("Dê um nome e adicione ao menos um ingrediente com peso.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/nutrition/recipes", {
        householdId,
        name,
        instructions: instructions || undefined,
        servings: Number(servings) || 1,
        items: ready.map((i) => ({ foodId: i.food!.id, rawGrams: Number(i.rawGrams), preparationMethod: i.method || undefined })),
      });
      toast.success("Receita criada.");
      setOpen(false);
      setName("");
      setInstructions("");
      setServings("2");
      setIngredients([]);
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === "missing_cooking_yield" ? "Fator de cocção não encontrado para um ingrediente." : "Não foi possível criar a receita.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus /> Nova receita
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Nova receita</SheetTitle>
          <SheetDescription>Rendimento cru/cozido e macros calculados em tempo real.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="recipeName">Nome</Label>
              <Input id="recipeName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Frango grelhado com arroz" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="servings">Porções</Label>
              <Input id="servings" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="instructions">Modo de preparo (opcional)</Label>
            <Textarea id="instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} />
          </div>

          <div className="flex items-center justify-between">
            <Label>Ingredientes</Label>
            <FoodCreateModal householdId={householdId} onCreated={onFoodCreated} />
          </div>

          <div className="flex flex-col gap-2">
            {ingredients.map((ing) => (
              <IngredientRow
                key={ing.key}
                householdId={householdId}
                ingredient={ing}
                onChange={(next) => updateIngredient(ing.key, next)}
                onRemove={() => removeIngredient(ing.key)}
              />
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addIngredient}>
              <Plus /> Adicionar ingrediente
            </Button>
          </div>

          {preview && (
            <div className="rounded-lg border border-primary/30 bg-accent/40 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Prévia (receita inteira)</p>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <PreviewStat label="cru" value={`${Math.round(ready.reduce((s, i) => s + Number(i.rawGrams), 0))}g`} />
                <PreviewStat label="cozido" value={`${Math.round(preview.totalCookedGrams)}g`} />
                <PreviewStat label="kcal" value={Math.round(preview.totalCalories)} />
                <PreviewStat label="prot" value={`${Math.round(preview.totalProteinG)}g`} />
                <PreviewStat label="carb+gord" value={`${Math.round(preview.totalCarbsG)}g / ${Math.round(preview.totalFatG)}g`} />
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
              Criar receita
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function PreviewStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
