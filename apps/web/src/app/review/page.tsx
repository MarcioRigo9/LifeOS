"use client";

import * as React from "react";
import { RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { DecisionCard, type DecisionSummary } from "@/components/decisions/decision-card";
import { useSession } from "@/components/providers/session-provider";
import { useFetch } from "@/lib/client/useFetch";
import { apiPost } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface ReviewReport {
  weekStartDate: string;
  people: {
    personId: string;
    displayName: string;
    weighIns: { count: number; trend: { direction: "gaining" | "losing" | "stable"; deltaKg: number } | null };
    training: { completedSessions: number; plannedSessionsPerWeek: number; volumeChangePct: number | null } | null;
    nutrition: { plannedMealCount: number } | null;
    suggestedCalorieAdjustmentKcal: number;
  }[];
  habits: { habitId: string; title: string; completedCount: number; totalLogged: number; missedCount: number; adherencePct: number }[];
  deviations: string[];
}

interface ReviewData {
  review: { id: string; week_start_date: string; report_json: ReviewReport; generated_at: string } | null;
  decision: DecisionSummary & { status: string } | null;
}

const TREND_ICON = { gaining: TrendingUp, losing: TrendingDown, stable: Minus };

export default function ReviewPage() {
  const { householdId, loading: sessionLoading } = useSession();
  const url = householdId ? `/api/review/latest?householdId=${householdId}` : null;
  const { data, loading, refresh } = useFetch<ReviewData>(url);
  const [running, setRunning] = React.useState(false);

  async function run() {
    if (!householdId) return;
    setRunning(true);
    try {
      await apiPost("/api/review/run", { householdId });
      toast.success("Weekly Review gerado.");
      refresh();
    } catch {
      toast.error("Não foi possível rodar a revisão agora.");
    } finally {
      setRunning(false);
    }
  }

  const isLoading = sessionLoading || loading;
  const report = data?.review?.report_json;

  return (
    <AppShell>
      <TopBar title="Revisão semanal" subtitle="Rituais de sábado/domingo" />

      <div className="flex flex-col gap-5 p-4 md:p-8">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">
                {data?.review ? `Última revisão: semana de ${formatDate(data.review.week_start_date, { day: "2-digit", month: "short" })}` : "Nenhuma revisão gerada ainda"}
              </p>
              {data?.review && (
                <p className="text-xs text-muted-foreground">
                  Gerada em {formatDate(data.review.generated_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
            <Button onClick={run} disabled={running}>
              {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Rodar revisão agora
            </Button>
          </CardContent>
        </Card>

        {isLoading && <Skeleton className="h-64 w-full" />}

        {!isLoading && report && (
          <>
            {report.deviations.length > 0 && (
              <Card className="border-warning/40 bg-warning/10">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="size-4 text-warning" /> Desvios identificados
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-1 text-sm">
                    {report.deviations.map((d, i) => (
                      <li key={i}>• {d}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {data?.decision && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-muted-foreground">Proposta da próxima semana</p>
                {data.decision.status === "PENDING" ? (
                  <DecisionCard decision={data.decision} householdId={householdId!} onResolved={refresh} />
                ) : (
                  <Card>
                    <CardContent className="flex items-center justify-between p-4">
                      <span className="text-sm">Status da proposta</span>
                      <Badge variant={data.decision.status === "EXECUTED" ? "success" : "outline"}>{data.decision.status}</Badge>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {report.people.map((p) => {
                const TrendIcon = p.weighIns.trend ? TREND_ICON[p.weighIns.trend.direction] : Minus;
                return (
                  <Card key={p.personId}>
                    <CardHeader>
                      <CardTitle>{p.displayName}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Pesagens na semana</span>
                        <span className="flex items-center gap-1 font-medium">
                          <TrendIcon className="size-3.5" />
                          {p.weighIns.count}
                          {p.weighIns.trend && ` (${p.weighIns.trend.deltaKg > 0 ? "+" : ""}${p.weighIns.trend.deltaKg}kg)`}
                        </span>
                      </div>
                      {p.training && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Treinos</span>
                          <span className="font-medium">
                            {p.training.completedSessions}/{p.training.plannedSessionsPerWeek}
                            {p.training.volumeChangePct !== null && ` · volume ${p.training.volumeChangePct > 0 ? "+" : ""}${p.training.volumeChangePct}%`}
                          </span>
                        </div>
                      )}
                      {p.nutrition && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Refeições planejadas</span>
                          <span className="font-medium">{p.nutrition.plannedMealCount}</span>
                        </div>
                      )}
                      {p.suggestedCalorieAdjustmentKcal !== 0 && (
                        <Badge variant="accent" className="w-fit">
                          Ajuste calórico sugerido: {p.suggestedCalorieAdjustmentKcal > 0 ? "+" : ""}
                          {p.suggestedCalorieAdjustmentKcal} kcal
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {report.habits.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="size-4 text-primary" /> Adesão a hábitos
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {report.habits.map((h) => (
                    <div key={h.habitId}>
                      <div className="flex items-center justify-between text-sm">
                        <span>{h.title}</span>
                        <span className="text-muted-foreground">
                          {h.completedCount}/{h.totalLogged} · {h.adherencePct}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${h.adherencePct}%` }} />
                      </div>
                      <Separator className="mt-3" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!isLoading && !report && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              Nenhuma revisão ainda — clique em &quot;Rodar revisão agora&quot; para gerar a primeira.
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
