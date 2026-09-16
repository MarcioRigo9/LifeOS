"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dumbbell, UtensilsCrossed, Scale, Check, Circle, ArrowRight, Sparkles, Loader2 } from "lucide-react";
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
}

const MEAL_TYPE_LABEL: Record<string, string> = { breakfast: "Café da manhã", lunch: "Almoço", dinner: "Jantar", snack: "Lanche" };

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
                    <EmptyRow text="Sem treino planejado para hoje." />
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
                    <EmptyRow text="Sem plano alimentar para hoje." />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {data.nutrition.items.map((it) => (
                        <li key={it.id} className="flex items-center justify-between text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{it.recipe_name}</p>
                            <p className="text-xs text-muted-foreground">{MEAL_TYPE_LABEL[it.type] ?? it.type}</p>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">{Math.round(Number(it.planned_cooked_grams))}g</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button asChild variant="secondary">
                    <Link href="/nutrition">
                      Ver plano completo <ArrowRight />
                    </Link>
                  </Button>
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

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="size-4 text-primary" /> Última pesagem
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {data.latestMeasurement ? (
                    <div>
                      <p className="text-2xl font-semibold tracking-tight">{data.latestMeasurement.weightKg} kg</p>
                      <p className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(data.latestMeasurement.takenAt))}
                      </p>
                    </div>
                  ) : (
                    <EmptyRow text="Nenhuma pesagem registrada." />
                  )}
                  <Button asChild variant="secondary">
                    <Link href="/health">
                      Registrar / ver histórico <ArrowRight />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="rounded-lg bg-muted px-3 py-4 text-center text-sm text-muted-foreground">{text}</p>;
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
