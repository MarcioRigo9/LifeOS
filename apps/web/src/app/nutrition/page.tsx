"use client";

import * as React from "react";
import Link from "next/link";
import { UtensilsCrossed, Loader2, Sparkles, Send, ShoppingCart, Check, ChefHat } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/components/providers/session-provider";
import { useFetch } from "@/lib/client/useFetch";
import { apiPost, ApiError } from "@/lib/client/api";
import { cn, formatCents, formatWeekday } from "@/lib/utils";

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const MEAL_TYPE_LABEL: Record<string, string> = { breakfast: "Café da manhã", lunch: "Almoço", dinner: "Jantar", snack: "Lanche" };

interface PlanData {
  plan: { id: string; status: string; week_start_date: string; version: number } | null;
  items: {
    id: string;
    day_of_week: number;
    type: string;
    meal_name: string;
    recipe_name: string;
    planned_cooked_grams: string;
    raw_grams_equivalent: number;
  }[];
  shoppingList: { id: string; status: string; total_cost_cents: number } | null;
}

interface ShoppingListData {
  list: { id: string; status: string; total_cost_cents: number; week_start_date: string } | null;
  items: { id: string; food_name: string; category: string | null; needed_raw_grams: string; buy_qty: number; surplus_grams: string; estimated_cost_cents: number; price_unavailable: boolean }[];
}

export default function NutritionPage() {
  const { householdId, activeProfileId, loading: sessionLoading } = useSession();
  const planUrl = householdId && activeProfileId ? `/api/nutrition/plan?householdId=${householdId}&profileId=${activeProfileId}` : null;
  const { data, loading, refresh } = useFetch<PlanData>(planUrl);
  const shoppingUrl = householdId ? `/api/nutrition/shopping-list?householdId=${householdId}` : null;
  const { data: shopping, loading: shoppingLoading, refresh: refreshShopping } = useFetch<ShoppingListData>(shoppingUrl);

  const [generating, setGenerating] = React.useState(false);
  const [activating, setActivating] = React.useState(false);
  const todayIndex = (new Date().getDay() + 6) % 7;

  async function generate() {
    if (!householdId) return;
    setGenerating(true);
    try {
      await apiPost("/api/nutrition/generate", { householdId });
      toast.success("Plano alimentar e lista de compras gerados (rascunho).");
      refresh();
      refreshShopping();
    } catch (err) {
      if (err instanceof ApiError && err.code === "incomplete_profile") {
        toast.error("Complete o perfil (biometria, meta, pesagem) primeiro.", { action: { label: "Ir para Perfil", onClick: () => (window.location.href = "/profile") } });
      } else if (err instanceof ApiError && err.code === "missing_meal_type") {
        toast.error("Faltam receitas para algum tipo de refeição (café/almoço/janta).", {
          action: { label: "Gerenciar receitas", onClick: () => (window.location.href = "/nutrition/recipes") },
        });
      } else {
        toast.error("Não foi possível gerar o plano.");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function activate() {
    if (!householdId || !data?.plan) return;
    setActivating(true);
    try {
      const res = await apiPost<{ outcome: string }>("/api/nutrition/plan/activate", { householdId, mealPlanId: data.plan.id });
      toast.success(res.outcome === "auto_execute" ? "Plano ativado." : "Proposta enviada para aprovação — veja o banner em Hoje.");
      refresh();
    } catch {
      toast.error("Não foi possível propor a ativação.");
    } finally {
      setActivating(false);
    }
  }

  const isLoading = sessionLoading || loading;

  return (
    <AppShell>
      <TopBar title="Nutrição" subtitle={data?.plan ? `Semana de ${formatDateBR(data.plan.week_start_date)} · ${data.plan.status}` : undefined} />

      <div className="flex flex-col gap-5 p-4 md:p-8">
        <Button asChild variant="secondary" size="sm" className="self-start">
          <Link href="/nutrition/recipes">
            <ChefHat /> Gerenciar receitas
          </Link>
        </Button>

        <Tabs defaultValue="plan">
          <TabsList className="grid w-full grid-cols-2 sm:w-80">
            <TabsTrigger value="plan">Plano semanal</TabsTrigger>
            <TabsTrigger value="shopping">Lista de compras</TabsTrigger>
          </TabsList>

          <TabsContent value="plan">
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : !data?.plan ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                  <UtensilsCrossed className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Nenhum plano alimentar ainda.</p>
                  <Button onClick={generate} disabled={generating}>
                    {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    Gerar plano da semana
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-4">
                {data.plan.status === "draft" && (
                  <Card className="border-warning/40 bg-warning/10">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <p className="text-sm">Plano em rascunho — proponha a ativação para valer pra semana.</p>
                      <Button size="sm" onClick={activate} disabled={activating}>
                        {activating ? <Loader2 className="animate-spin" /> : <Send />}
                        Propor ativação
                      </Button>
                    </CardContent>
                  </Card>
                )}

                <Tabs defaultValue={String(todayIndex)}>
                  <TabsList className="grid w-full grid-cols-7">
                    {DAYS.map((d) => (
                      <TabsTrigger key={d} value={String(d)} className="px-1 text-xs">
                        {formatWeekday(d).slice(0, 3)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {DAYS.map((d) => {
                    const dayItems = data.items.filter((it) => it.day_of_week === d);
                    return (
                      <TabsContent key={d} value={String(d)} className="flex flex-col gap-2">
                        {dayItems.length === 0 ? (
                          <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Sem refeições planejadas.</p>
                        ) : (
                          dayItems.map((it) => (
                            <Card key={it.id}>
                              <CardContent className="flex items-center justify-between gap-3 p-3.5">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{it.recipe_name}</p>
                                  <p className="text-xs text-muted-foreground">{MEAL_TYPE_LABEL[it.type] ?? it.type}</p>
                                </div>
                                <div className="shrink-0 text-right text-xs text-muted-foreground">
                                  <p>{Math.round(Number(it.planned_cooked_grams))}g cozido</p>
                                  <p>{Math.round(it.raw_grams_equivalent)}g cru</p>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </div>
            )}
          </TabsContent>

          <TabsContent value="shopping">
            <ShoppingListView loading={sessionLoading || shoppingLoading} data={shopping} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ShoppingListView({ loading, data }: { loading: boolean; data: ShoppingListData | null }) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!data?.list) return;
    try {
      const raw = window.localStorage.getItem(`lifeos:shopping:${data.list.id}`);
      setChecked(raw ? JSON.parse(raw) : {});
    } catch {
      setChecked({});
    }
  }, [data?.list]);

  function toggle(itemId: string) {
    if (!data?.list) return;
    setChecked((prev) => {
      const next = { ...prev, [itemId]: !prev[itemId] };
      try {
        window.localStorage.setItem(`lifeos:shopping:${data.list!.id}`, JSON.stringify(next));
      } catch {
        // best-effort only — a private window or blocked storage just means checkmarks don't persist
      }
      return next;
    });
  }

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!data?.list) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <ShoppingCart className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhuma lista de compras ainda — gere um plano alimentar primeiro.</p>
        </CardContent>
      </Card>
    );
  }

  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-muted-foreground">Total estimado</p>
            <p className="text-xl font-semibold">{formatCents(data.list.total_cost_cents)}</p>
          </div>
          <Badge variant="outline">
            {checkedCount}/{data.items.length} no carrinho
          </Badge>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-1.5">
        {data.items.map((item) => (
          <button
            key={item.id}
            onClick={() => toggle(item.id)}
            className={cn(
              "flex min-h-[52px] items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-accent",
              checked[item.id] && "bg-muted opacity-60"
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-md border-2",
                checked[item.id] ? "border-success bg-success text-success-foreground" : "border-input"
              )}
            >
              {checked[item.id] && <Check className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-medium", checked[item.id] && "line-through")}>{item.food_name}</p>
              <p className="text-xs text-muted-foreground">
                {item.buy_qty}x pacote · sobra {Math.round(Number(item.surplus_grams))}g
              </p>
            </div>
            <div className="shrink-0 text-right text-sm">
              {item.price_unavailable ? (
                <Badge variant="outline">sem preço</Badge>
              ) : (
                <span className="font-medium">{formatCents(item.estimated_cost_cents)}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatDateBR(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(iso));
}
