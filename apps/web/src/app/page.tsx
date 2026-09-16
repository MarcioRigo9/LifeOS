"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dumbbell, UtensilsCrossed, Scale, Check, Circle, ArrowRight, Sparkles, Loader2, TrendingDown, TrendingUp, Minus, Package, Flame } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionCard, type DecisionSummary } from "@/components/decisions/decision-card";
import { useSession } from "@/components/providers/session-provider";
import { useFetch } from "@/lib/client/useFetch";
import { apiPost } from "@/lib/client/api";
import { formatWeekday } from "@/lib/utils";

interface DashboardData {
  planDayOfWeek: number;
  workout: {
    planId: string | null;
    items: { id: string; exercise_name: string; target_sets: number; min_reps: number; max_reps: number; target_load_kg: string | null }[];
    activeSession: { id: string; status: string } | null;
  };
  nutrition: {
    mealPlanId: string | null;
    items: { id: string; type: string; meal_name: string; recipe_name: string; planned_cooked_grams: string }[];
  };
  habits: { id: string; title: string; frequency: string | null; doneToday: boolean; loggedToday: boolean }[];
  pendingDecisions: DecisionSummary[];
  latestMeasurement: { weightKg: number; takenAt: string } | null;
  evolution: {
    sparkline: number[];
    deltaWeekKg: number | null;
    workoutAdherence30d: { completed: number; planned: number } | null;
  };
}

const MEAL_TYPE_LABEL: Record<string, string> = { breakfast: "Café da manhã", lunch: "Almoço", dinner: "Jantar", snack: "Lanche" };

/** Marmita = lunch (prepped ahead, reheated); fresh = dinner (cooked same day) — the same
 * lunch/dinner split the Nutrition Agent's constraint engine already enforces server-side. */
function mealPrepTag(type: string): "Marmita" | "Feito na hora" | null {
  if (type === "lunch") return "Marmita";
  if (type === "dinner") return "Feito na hora";
  return null;
}

function DayContextBanner({ items }: { items: DashboardData["nutrition"]["items"] }) {
  const lunch = items.find((i) => i.type === "lunch");
  const dinner = items.find((i) => i.type === "dinner");
  if (!lunch && !dinner) return null;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-gradient-to-br from-accent/60 to-transparent px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
      {lunch && (
        <span className="flex items-center gap-1.5">
          <Package className="size-3.5 text-primary" /> Almoço é <strong>{lunch.recipe_name}</strong>
          <Badge variant="outline" className="ml-0.5">
            Marmita
          </Badge>
        </span>
      )}
      {dinner && (
        <span className="flex items-center gap-1.5">
          <Flame className="size-3.5 text-primary" /> Jantar é <strong>{dinner.recipe_name}</strong>
          <Badge variant="outline" className="ml-0.5">
            Feito na hora
          </Badge>
        </span>
      )}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 160;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-primary">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EvolutionCard({ evolution, latestMeasurement }: { evolution: DashboardData["evolution"]; latestMeasurement: DashboardData["latestMeasurement"] }) {
  const { sparkline, deltaWeekKg, workoutAdherence30d } = evolution;
  const adherencePct = workoutAdherence30d && workoutAdherence30d.planned > 0 ? Math.round((workoutAdherence30d.completed / workoutAdherence30d.planned) * 100) : null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="size-4 text-primary" /> Evolução & progresso
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!latestMeasurement && sparkline.length === 0 ? (
          <EmptyRow text="Registre pesagens em Saúde para ver sua evolução aqui." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">Peso atual</p>
              <p className="text-2xl font-semibold tracking-tight">{latestMeasurement ? `${latestMeasurement.weightKg} kg` : "—"}</p>
              {deltaWeekKg !== null && (
                <span className={cnDelta(deltaWeekKg)}>
                  {deltaWeekKg < 0 ? <TrendingDown className="size-3.5" /> : deltaWeekKg > 0 ? <TrendingUp className="size-3.5" /> : <Minus className="size-3.5" />}
                  {deltaWeekKg > 0 ? "+" : ""}
                  {deltaWeekKg} kg na semana
                </span>
              )}
            </div>
            <div className="flex flex-col items-start gap-1">
              <p className="text-xs text-muted-foreground">Tendência</p>
              {sparkline.length >= 2 ? <Sparkline values={sparkline} /> : <p className="text-sm text-muted-foreground">Poucos registros ainda.</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">Aderência aos treinos (30 dias)</p>
              {adherencePct === null ? (
                <p className="text-sm text-muted-foreground">Sem plano ativo o suficiente ainda.</p>
              ) : (
                <>
                  <p className="text-2xl font-semibold tracking-tight">{adherencePct}%</p>
                  <p className="text-xs text-muted-foreground">
                    {workoutAdherence30d!.completed} de {workoutAdherence30d!.planned} treinos planejados
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function cnDelta(delta: number): string {
  const base = "flex items-center gap-1 text-xs font-medium";
  if (delta < 0) return `${base} text-success`;
  if (delta > 0) return `${base} text-warning`;
  return `${base} text-muted-foreground`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { householdId, activeProfileId, profiles, loading: sessionLoading } = useSession();
  const url = householdId && activeProfileId ? `/api/dashboard?householdId=${householdId}&profileId=${activeProfileId}` : null;
  const { data, loading, refresh } = useFetch<DashboardData>(url);
  const [startingSession, setStartingSession] = React.useState(false);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  async function startWorkout() {
    if (!householdId || !activeProfileId) return;
    setStartingSession(true);
    try {
      await apiPost("/api/fitness/sessions", { householdId, profileId: activeProfileId, workoutPlanId: data?.workout.planId });
      router.push("/fitness");
    } catch {
      toast.error("Não foi possível iniciar o treino.");
    } finally {
      setStartingSession(false);
    }
  }

  async function logHabit(habitId: string, completed: boolean) {
    if (!householdId || !activeProfileId) return;
    try {
      await apiPost(`/api/habits/${habitId}/log`, { householdId, profileId: activeProfileId, completed });
      toast.success(completed ? "Check-in registrado!" : "Marcado como não feito hoje.");
      refresh();
    } catch {
      toast.error("Já havia um registro para hoje.");
    }
  }

  const isLoading = sessionLoading || loading;

  return (
    <AppShell>
      <TopBar
        title={activeProfile ? `Olá, ${activeProfile.displayName.split(" ")[0]}` : "Hoje"}
        subtitle={new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date())}
      />

      <div className="flex flex-col gap-5 p-4 md:p-8">
        {isLoading && <DashboardSkeleton />}

        {!isLoading && data && (
          <>
            <DayContextBanner items={data.nutrition.items} />

            {data.pendingDecisions.length > 0 && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold text-muted-foreground">
                    {data.pendingDecisions.length === 1 ? "1 proposta aguardando aprovação" : `${data.pendingDecisions.length} propostas aguardando aprovação`}
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.pendingDecisions.map((d) => (
                    <DecisionCard key={d.id} decision={d} householdId={householdId!} onResolved={refresh} compact />
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex items-center gap-2">
                    <Dumbbell className="size-4 text-primary" /> Treino de hoje
                  </CardTitle>
                  <Badge variant="outline">{formatWeekday(data.planDayOfWeek)}</Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {data.workout.items.length === 0 ? (
                    <EmptyPlanState
                      icon={Dumbbell}
                      title="Nenhum treino planejado ainda"
                      description="Gere um plano semanal individualizado a partir do seu perfil e histórico."
                      href="/fitness"
                      cta="Gerar plano de treino"
                    />
                  ) : (
                    <>
                      <ul className="flex flex-col gap-1.5">
                        {data.workout.items.slice(0, 4).map((it) => (
                          <li key={it.id} className="flex items-center justify-between text-sm">
                            <span className="truncate">{it.exercise_name}</span>
                            <span className="shrink-0 text-muted-foreground">
                              {it.target_sets}x{it.min_reps}-{it.max_reps}
                              {it.target_load_kg ? ` · ${Number(it.target_load_kg)}kg` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {data.workout.items.length > 4 && (
                        <p className="text-xs text-muted-foreground">+{data.workout.items.length - 4} exercício(s)</p>
                      )}
                      {data.workout.activeSession ? (
                        <Button asChild variant="secondary">
                          <Link href="/fitness">
                            Continuar sessão <ArrowRight />
                          </Link>
                        </Button>
                      ) : (
                        <Button onClick={startWorkout} disabled={startingSession}>
                          {startingSession && <Loader2 className="animate-spin" />}
                          Iniciar treino
                        </Button>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex items-center gap-2">
                    <UtensilsCrossed className="size-4 text-primary" /> Refeições de hoje
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {data.nutrition.items.length === 0 ? (
                    <EmptyPlanState
                      icon={UtensilsCrossed}
                      title="Nenhum plano alimentar ainda"
                      description="Gere o cardápio da semana considerando as preferências e a logística de marmita do casal."
                      href="/nutrition"
                      cta="Gerar plano alimentar"
                    />
                  ) : (
                    <>
                      <ul className="flex flex-col gap-2">
                        {data.nutrition.items.map((it) => (
                          <li key={it.id} className="flex items-center justify-between text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{it.recipe_name}</p>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span>{MEAL_TYPE_LABEL[it.type] ?? it.type}</span>
                                {mealPrepTag(it.type) && <Badge variant="outline">{mealPrepTag(it.type)}</Badge>}
                              </div>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">{Math.round(Number(it.planned_cooked_grams))}g</span>
                          </li>
                        ))}
                      </ul>
                      <Button asChild variant="secondary">
                        <Link href="/nutrition">
                          Ver plano completo <ArrowRight />
                        </Link>
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Check className="size-4 text-primary" /> Hábitos de hoje
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {data.habits.length === 0 ? (
                    <EmptyRow text="Nenhum hábito cadastrado ainda." />
                  ) : (
                    data.habits.map((h) => (
                      <button
                        key={h.id}
                        disabled={h.loggedToday}
                        onClick={() => logHabit(h.id, true)}
                        className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default hover:not-disabled:bg-accent"
                      >
                        <span className={h.loggedToday && h.doneToday ? "text-muted-foreground line-through" : ""}>{h.title}</span>
                        {h.loggedToday ? (
                          h.doneToday ? (
                            <Badge variant="success">
                              <Check className="size-3" /> Feito
                            </Badge>
                          ) : (
                            <Badge variant="outline">Não feito</Badge>
                          )
                        ) : (
                          <Circle className="size-5 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              <EvolutionCard evolution={data.evolution} latestMeasurement={data.latestMeasurement} />
            </div>
            <Button asChild variant="ghost" size="sm" className="self-start text-muted-foreground">
              <Link href="/health">
                Registrar pesagem / ver histórico completo <ArrowRight />
              </Link>
            </Button>
          </>
        )}
      </div>
    </AppShell>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="rounded-lg bg-muted px-3 py-4 text-center text-sm text-muted-foreground">{text}</p>;
}

/** Constructive empty state (§3 redesign spec): an icon preview of what will exist plus a
 * primary CTA, instead of a bare "nothing here" line. */
function EmptyPlanState({
  icon: Icon,
  title,
  description,
  href,
  cta,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Button asChild size="sm">
        <Link href={href}>
          {cta} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
