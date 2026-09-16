"use client";

import * as React from "react";
import { Dumbbell, Loader2, Sparkles, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ActiveWorkoutSession } from "@/components/fitness/active-session";
import { useSession } from "@/components/providers/session-provider";
import { useFetch } from "@/lib/client/useFetch";
import { apiPost, ApiError } from "@/lib/client/api";
import { formatWeekday } from "@/lib/utils";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

interface FitnessPlanData {
  plan: { id: string; status: string; week_start_date: string; version: number } | null;
  items: {
    id: string;
    day_of_week: number;
    order_index: number;
    target_sets: number;
    min_reps: number;
    max_reps: number;
    target_rpe: string;
    target_load_kg: string | null;
    exercise_id: string;
    exercise_name: string;
    primary_muscle_group: string;
    exercise_type: string;
  }[];
  activeSession: { id: string; performed_at: string; status: string; sets: never[] } | null;
  recentSessions: { id: string; performed_at: string; status: string; duration_minutes: number | null }[];
}

export default function FitnessPage() {
  const { householdId, activeProfileId, loading: sessionLoading } = useSession();
  const url = householdId && activeProfileId ? `/api/fitness/plan?householdId=${householdId}&profileId=${activeProfileId}` : null;
  const { data, loading, refresh } = useFetch<FitnessPlanData>(url);
  const [generating, setGenerating] = React.useState(false);
  const [activating, setActivating] = React.useState(false);

  const todayIndex = (new Date().getDay() + 6) % 7;

  async function generate() {
    if (!householdId) return;
    setGenerating(true);
    try {
      await apiPost("/api/fitness/generate", { householdId });
      toast.success("Plano de treino gerado (rascunho).");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === "incomplete_profile" ? "Complete o perfil (meta e uma pesagem) primeiro." : "Não foi possível gerar o plano.");
    } finally {
      setGenerating(false);
    }
  }

  async function activate() {
    if (!householdId || !data?.plan) return;
    setActivating(true);
    try {
      const res = await apiPost<{ outcome: string }>("/api/fitness/plan/activate", { householdId, workoutPlanId: data.plan.id });
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
      <TopBar title="Treino" subtitle={data?.plan ? `Semana de ${formatDateBR(data.plan.week_start_date)} · ${data.plan.status}` : undefined} />

      <div className="flex flex-col gap-5 p-4 md:p-8">
        {isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {!isLoading && data?.activeSession && (
          <ActiveWorkoutSession
            householdId={householdId!}
            sessionId={data.activeSession.id}
            items={data.items.filter((it) => it.day_of_week === todayIndex)}
            loggedSets={data.activeSession.sets}
            onCompleted={refresh}
            onSetLogged={refresh}
          />
        )}

        {!isLoading && !data?.activeSession && !data?.plan && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Dumbbell className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhum plano de treino ainda.</p>
              <Button onClick={generate} disabled={generating}>
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Gerar plano da semana
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !data?.activeSession && data?.plan && (
          <>
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
                  <TabsContent key={d} value={String(d)}>
                    {dayItems.length === 0 ? (
                      <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Dia de descanso.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {dayItems.map((it) => (
                          <Card key={it.id}>
                            <CardContent className="flex items-center justify-between gap-3 p-3.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{it.exercise_name}</p>
                                <p className="text-xs text-muted-foreground capitalize">{it.primary_muscle_group}</p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <Badge variant="outline">
                                  {it.target_sets}x{it.min_reps}-{it.max_reps}
                                </Badge>
                                {it.target_load_kg && <span className="text-xs text-muted-foreground">{Number(it.target_load_kg)}kg</span>}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          </>
        )}
      </div>
    </AppShell>
  );
}

function formatDateBR(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(iso));
}
