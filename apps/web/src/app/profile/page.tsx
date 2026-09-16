"use client";

import * as React from "react";
import { Loader2, Check, Target, Flame } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/components/providers/session-provider";
import { useFetch } from "@/lib/client/useFetch";
import { apiPost, apiPatch, ApiError } from "@/lib/client/api";
import { calculateDailyTargets, type ActivityLevel, type NutritionGoal, type BiologicalSex } from "@/lib/domain/nutrition";

interface ProfileData {
  id: string;
  display_name: string;
  birth_date: string | null;
  sex: BiologicalSex | null;
  height_cm: string | null;
  activity_level: ActivityLevel | null;
  nutrition_goal: NutritionGoal | null;
}

interface Measurement {
  weightKg: number;
  takenAt: string;
}

interface Goal {
  id: string;
  title: string;
  metric: string | null;
  target_value: string;
  current_value: string | null;
  version: number;
}

const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: "Sedentário",
  light: "Leve (1-3x/semana)",
  moderate: "Moderado (3-5x/semana)",
  active: "Ativo (6-7x/semana)",
  very_active: "Muito ativo (físico + treino diário)",
};
const GOAL_LABEL: Record<NutritionGoal, string> = { lose_weight: "Perder peso", maintain: "Manter", gain_muscle: "Ganhar massa" };

function ageFromBirthDate(birthDate: string): number {
  const bd = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - bd.getFullYear();
  if (now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) age--;
  return age;
}

export default function ProfilePage() {
  const { householdId, activeProfileId, loading: sessionLoading } = useSession();
  const profileUrl = householdId && activeProfileId ? `/api/profiles/${activeProfileId}?householdId=${householdId}` : null;
  const { data: profile, loading: profileLoading, refresh: refreshProfile, setData: setProfile } = useFetch<ProfileData>(profileUrl);
  const measurementsUrl = householdId && activeProfileId ? `/api/health/measurements?householdId=${householdId}&personId=${activeProfileId}` : null;
  const { data: measurements } = useFetch<Measurement[]>(measurementsUrl);
  const goalsUrl = householdId && activeProfileId ? `/api/goals?householdId=${householdId}&personId=${activeProfileId}` : null;
  const { data: goals, refresh: refreshGoals } = useFetch<Goal[]>(goalsUrl);

  const [form, setForm] = React.useState<Partial<ProfileData>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!householdId || !activeProfileId) return;
    setSaving(true);
    try {
      const updated = await apiPatch<ProfileData>(`/api/profiles/${activeProfileId}`, {
        householdId,
        displayName: form.display_name,
        birthDate: form.birth_date || undefined,
        sex: form.sex || undefined,
        heightCm: form.height_cm ? Number(form.height_cm) : undefined,
        activityLevel: form.activity_level || undefined,
        nutritionGoal: form.nutrition_goal || undefined,
      });
      setProfile(updated);
      toast.success("Perfil atualizado.");
    } catch {
      toast.error("Não foi possível salvar o perfil.");
    } finally {
      setSaving(false);
    }
  }

  const latestWeight = measurements?.[0]?.weightKg;
  const targets =
    form.birth_date && form.sex && form.height_cm && form.activity_level && form.nutrition_goal && latestWeight
      ? calculateDailyTargets({
          weightKg: latestWeight,
          heightCm: Number(form.height_cm),
          age: ageFromBirthDate(form.birth_date),
          sex: form.sex,
          activityLevel: form.activity_level,
          goal: form.nutrition_goal,
        })
      : null;

  const weightGoal = goals?.find((g) => g.metric === "weight_kg");

  const isLoading = sessionLoading || profileLoading;

  return (
    <AppShell>
      <TopBar title="Perfil" subtitle={profile?.display_name} />

      <div className="flex flex-col gap-5 p-4 md:p-8">
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Dados do perfil</CardTitle>
                <CardDescription>Usados para calcular metas calóricas e treinos individualizados.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={save} className="flex flex-col gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="displayName">Nome</Label>
                      <Input
                        id="displayName"
                        value={form.display_name ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="birthDate">Data de nascimento</Label>
                      <Input
                        id="birthDate"
                        type="date"
                        value={form.birth_date?.slice(0, 10) ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="sex">Sexo biológico</Label>
                      <select
                        id="sex"
                        value={form.sex ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value as BiologicalSex }))}
                        className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm"
                      >
                        <option value="">Selecione</option>
                        <option value="male">Masculino</option>
                        <option value="female">Feminino</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="heightCm">Altura (cm)</Label>
                      <Input
                        id="heightCm"
                        inputMode="decimal"
                        value={form.height_cm ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, height_cm: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="activityLevel">Nível de atividade</Label>
                      <select
                        id="activityLevel"
                        value={form.activity_level ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, activity_level: e.target.value as ActivityLevel }))}
                        className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm"
                      >
                        <option value="">Selecione</option>
                        {Object.entries(ACTIVITY_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="nutritionGoal">Meta nutricional (define a divisão de macros)</Label>
                      <select
                        id="nutritionGoal"
                        value={form.nutrition_goal ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, nutrition_goal: e.target.value as NutritionGoal }))}
                        className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm"
                      >
                        <option value="">Selecione</option>
                        {Object.entries(GOAL_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <Button type="submit" disabled={saving} className="self-start">
                    {saving ? <Loader2 className="animate-spin" /> : <Check />}
                    Salvar perfil
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Flame className="size-4 text-primary" /> Faixa calórica diária estimada
                </CardTitle>
                <CardDescription>
                  Calculada por <code>calculateDailyTargets</code> (Mifflin-St Jeor) a partir do perfil acima e da última pesagem — nunca um
                  valor digitado à mão.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!targets ? (
                  <p className="rounded-lg bg-muted px-3 py-4 text-center text-sm text-muted-foreground">
                    Complete o perfil e registre uma pesagem em <strong>Saúde</strong> para ver a estimativa.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Calorias" value={`${targets.calories} kcal`} />
                    <Stat label="Proteína" value={`${targets.proteinG} g`} />
                    <Stat label="Carboidrato" value={`${targets.carbsG} g`} />
                    <Stat label="Gordura" value={`${targets.fatG} g`} />
                  </div>
                )}
              </CardContent>
            </Card>

            <WeightGoalCard householdId={householdId!} activeProfileId={activeProfileId!} goal={weightGoal} onChanged={refreshGoals} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-3 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function WeightGoalCard({
  householdId,
  activeProfileId,
  goal,
  onChanged,
}: {
  householdId: string;
  activeProfileId: string;
  goal?: Goal;
  onChanged: () => void;
}) {
  const [value, setValue] = React.useState(goal ? String(Number(goal.target_value)) : "");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setValue(goal ? String(Number(goal.target_value)) : "");
  }, [goal]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    setSubmitting(true);
    try {
      if (!goal) {
        await apiPost("/api/goals", { householdId, personId: activeProfileId, title: "Peso alvo", metric: "weight_kg", targetValue: Number(value) });
        toast.success("Meta de peso criada.");
      } else {
        const res = await apiPost<{ outcome: string }>(`/api/goals/${goal.id}/propose-target`, { householdId, newTargetValue: Number(value) });
        toast.success(
          res.outcome === "proposed" ? "Alteração de meta enviada para aprovação — veja o banner em Hoje." : "Meta atualizada."
        );
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? "Não foi possível salvar a meta." : "Erro inesperado.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4 text-primary" /> Peso alvo
        </CardTitle>
        <CardDescription>
          {goal ? "Alterar a meta exige aprovação (risco médio) — mesma trilha de Approve/Reject do Coordinator." : "Criar a meta é aplicado direto."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="targetWeight">Peso alvo (kg)</Label>
            <Input id="targetWeight" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Check />}
            {goal ? "Propor alteração" : "Criar meta"}
          </Button>
        </form>
        {goal?.current_value && (
          <Badge variant="outline" className="mt-3">
            Atual: {Number(goal.current_value)}kg
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
