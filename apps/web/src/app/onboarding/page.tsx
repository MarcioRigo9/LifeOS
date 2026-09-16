"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight, ArrowLeft, Check, Loader2, UtensilsCrossed, Ban, Heart, Target, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useSession } from "@/components/providers/session-provider";
import { apiPatch, apiPost, apiGet } from "@/lib/client/api";
import { QUICK_DIETARY_TAGS, type ActivityLevel, type NutritionGoal } from "@/lib/domain/nutrition";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "who", title: "Quem é você", icon: User },
  { key: "routine", title: "Rotina & logística", icon: UtensilsCrossed },
  { key: "reheat", title: "Restrições de requente", icon: Ban },
  { key: "preferences", title: "Preferências e aversões", icon: Heart },
  { key: "goals", title: "Metas e ponto de partida", icon: Target },
] as const;

const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: "Sedentário",
  light: "Leve (1-3x/semana)",
  moderate: "Moderado (3-5x/semana)",
  active: "Ativo (6-7x/semana)",
  very_active: "Muito ativo (físico + treino diário)",
};
const GOAL_LABEL: Record<NutritionGoal, string> = { lose_weight: "Perder peso", maintain: "Manter", gain_muscle: "Ganhar massa" };

interface Goal {
  id: string;
  person_id: string;
  metric: string | null;
  target_value: string;
}

function TagPicker({ selected, onToggle, extra, onAddExtra }: { selected: string[]; onToggle: (tag: string) => void; extra: string; onAddExtra: (v: string) => void }) {
  const [draft, setDraft] = React.useState("");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {QUICK_DIETARY_TAGS.map((tag) => {
          const active = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggle(tag)}
              className={cn(
                "min-h-[40px] rounded-full border px-4 text-sm font-medium transition-colors",
                active ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-accent"
              )}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Input placeholder="Outro alimento (opcional)" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (!draft.trim()) return;
            onAddExtra(draft.trim());
            setDraft("");
          }}
        >
          Adicionar
        </Button>
      </div>
      {selected.filter((t) => !QUICK_DIETARY_TAGS.includes(t)).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected
            .filter((t) => !QUICK_DIETARY_TAGS.includes(t))
            .map((tag) => (
              <Badge key={tag} variant="outline" className="cursor-pointer" onClick={() => onToggle(tag)}>
                {tag} ✕
              </Badge>
            ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Toque para marcar/desmarcar. {extra}</p>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { householdId, profiles, activeProfileId, setActiveProfileId, loading: sessionLoading } = useSession();

  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);

  const [personId, setPersonId] = React.useState<string | null>(null);
  const [lunchLogistics, setLunchLogistics] = React.useState<"prepped_sunday" | "fresh">("prepped_sunday");
  const [dinnerLogistics, setDinnerLogistics] = React.useState<"prepped_sunday" | "fresh">("fresh");
  const [reheatIntolerantFoods, setReheatIntolerantFoods] = React.useState<string[]>([]);
  const [dislikedFoods, setDislikedFoods] = React.useState<string[]>([]);
  const [macroNotes, setMacroNotes] = React.useState("");
  const [currentWeightKg, setCurrentWeightKg] = React.useState("");
  const [targetWeightKg, setTargetWeightKg] = React.useState("");
  const [activityLevel, setActivityLevel] = React.useState<ActivityLevel | "">("");
  const [nutritionGoal, setNutritionGoal] = React.useState<NutritionGoal | "">("");
  const [trainingDaysPerWeek, setTrainingDaysPerWeek] = React.useState("");

  React.useEffect(() => {
    if (!personId && activeProfileId) setPersonId(activeProfileId);
  }, [activeProfileId, personId]);

  function toggleTag(list: string[], setList: (v: string[]) => void, tag: string) {
    setList(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]);
  }

  async function finish() {
    if (!householdId || !personId) return;
    setSubmitting(true);
    try {
      if (activityLevel || nutritionGoal) {
        await apiPatch(`/api/profiles/${personId}`, {
          householdId,
          activityLevel: activityLevel || undefined,
          nutritionGoal: nutritionGoal || undefined,
        });
      }

      if (currentWeightKg) {
        await apiPost("/api/health/measurements", {
          householdId,
          personId,
          takenAt: new Date().toISOString(),
          weightKg: Number(currentWeightKg),
        });
      }

      if (targetWeightKg) {
        const existingGoals = await apiGet<Goal[]>(`/api/goals?householdId=${householdId}&personId=${personId}`);
        const weightGoal = existingGoals.find((g) => g.metric === "weight_kg");
        if (!weightGoal) {
          await apiPost("/api/goals", { householdId, personId, title: "Peso alvo", metric: "weight_kg", targetValue: Number(targetWeightKg) });
        } else if (Number(weightGoal.target_value) !== Number(targetWeightKg)) {
          await apiPost(`/api/goals/${weightGoal.id}/propose-target`, { householdId, newTargetValue: Number(targetWeightKg) });
        }
      }

      const notesLines = [macroNotes.trim(), trainingDaysPerWeek ? `Dias de treino disponíveis por semana: ${trainingDaysPerWeek}` : ""].filter(Boolean);
      await apiPatch("/api/nutrition/dietary-preferences", {
        householdId,
        personId,
        dislikedFoods,
        reheatIntolerantFoods,
        prepSchedule: { lunch: lunchLogistics, dinner: dinnerLogistics },
        notes: notesLines.length > 0 ? notesLines.join("\n") : null,
      });

      toast.success("Preferências salvas!");
      router.push("/profile");
    } catch {
      toast.error("Não foi possível salvar suas preferências. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (step === 0 && !personId) {
      toast.error("Selecione quem está respondendo.");
      return;
    }
    if (step === STEPS.length - 1) {
      finish();
      return;
    }
    setStep((s) => s + 1);
  }

  const isLoading = sessionLoading;
  const activePerson = profiles.find((p) => p.id === personId);

  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Preferências do casal</h1>
          <p className="text-sm text-muted-foreground">Cinco passos rápidos para o plano alimentar respeitar a rotina de vocês.</p>
        </div>

        <div className="mb-6 flex flex-col gap-2">
          <Progress value={((step + 1) / STEPS.length) * 100} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Passo {step + 1} de {STEPS.length}
            </span>
            <span className="font-medium text-foreground">{STEPS[step].title}</span>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">Carregando…</CardContent>
          </Card>
        ) : (
          <Card>
            {step === 0 && (
              <>
                <CardHeader>
                  <CardTitle>Quem é você?</CardTitle>
                  <CardDescription>Cada resposta fica salva no perfil da pessoa certa.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPersonId(p.id);
                        setActiveProfileId(p.id);
                      }}
                      className={cn(
                        "flex min-h-[56px] items-center gap-3 rounded-xl border px-4 text-left transition-colors",
                        personId === p.id ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                      )}
                    >
                      <div className="flex size-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                        {p.displayName.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="font-medium">{p.displayName}</span>
                      {personId === p.id && <Check className="ml-auto size-4 text-primary" />}
                    </button>
                  ))}
                </CardContent>
              </>
            )}

            {step === 1 && (
              <>
                <CardHeader>
                  <CardTitle>Como funciona o almoço durante a semana?</CardTitle>
                  <CardDescription>{activePerson?.displayName ?? "Você"}, isso define como o plano de segunda a sexta é montado.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <RadioCard
                    name="lunch"
                    value="prepped_sunday"
                    current={lunchLogistics}
                    onChange={setLunchLogistics}
                    title="Marmita feita no domingo"
                    description="O almoço é preparado uma vez e requentado ao longo da semana."
                  />
                  <RadioCard
                    name="lunch"
                    value="fresh"
                    current={lunchLogistics}
                    onChange={setLunchLogistics}
                    title="Cozinha na hora"
                    description="O almoço é preparado no próprio dia."
                  />
                  <div className="border-t border-border pt-4">
                    <p className="mb-3 text-sm font-medium">E o jantar?</p>
                    <div className="flex gap-2">
                      <Button type="button" variant={dinnerLogistics === "fresh" ? "default" : "outline"} onClick={() => setDinnerLogistics("fresh")} className="flex-1">
                        Fresco
                      </Button>
                      <Button
                        type="button"
                        variant={dinnerLogistics === "prepped_sunday" ? "default" : "outline"}
                        onClick={() => setDinnerLogistics("prepped_sunday")}
                        className="flex-1"
                      >
                        Marmita
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </>
            )}

            {step === 2 && (
              <>
                <CardHeader>
                  <CardTitle>O que você não tolera requentar na marmita?</CardTitle>
                  <CardDescription>
                    Esses alimentos nunca entram no almoço de marmita de {activePerson?.displayName ?? "você"} — só em refeições frescas (jantar).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TagPicker
                    selected={reheatIntolerantFoods}
                    onToggle={(tag) => toggleTag(reheatIntolerantFoods, setReheatIntolerantFoods, tag)}
                    onAddExtra={(v) => setReheatIntolerantFoods((cur) => [...cur, v])}
                    extra=""
                  />
                </CardContent>
              </>
            )}

            {step === 3 && (
              <>
                <CardHeader>
                  <CardTitle>Preferências e aversões</CardTitle>
                  <CardDescription>Alimentos que {activePerson?.displayName ?? "você"} não come, em nenhuma refeição.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <TagPicker
                    selected={dislikedFoods}
                    onToggle={(tag) => toggleTag(dislikedFoods, setDislikedFoods, tag)}
                    onAddExtra={(v) => setDislikedFoods((cur) => [...cur, v])}
                    extra=""
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="macroNotes">Preferências de carnes, carboidratos e vegetais (opcional)</Label>
                    <Textarea
                      id="macroNotes"
                      placeholder="Ex.: prefere frango e peixe a carne vermelha; arroz integral em vez de branco; gosta de brócolis e abobrinha."
                      value={macroNotes}
                      onChange={(e) => setMacroNotes(e.target.value)}
                    />
                  </div>
                </CardContent>
              </>
            )}

            {step === 4 && (
              <>
                <CardHeader>
                  <CardTitle>Metas e ponto de partida</CardTitle>
                  <CardDescription>Usado para calcular metas calóricas e treinos individualizados.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="currentWeight">Peso atual (kg)</Label>
                      <Input id="currentWeight" inputMode="decimal" value={currentWeightKg} onChange={(e) => setCurrentWeightKg(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="targetWeight">Peso alvo (kg)</Label>
                      <Input id="targetWeight" inputMode="decimal" value={targetWeightKg} onChange={(e) => setTargetWeightKg(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="activityLevel">Nível de atividade</Label>
                    <select
                      id="activityLevel"
                      value={activityLevel}
                      onChange={(e) => setActivityLevel(e.target.value as ActivityLevel)}
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
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nutritionGoal">Meta nutricional</Label>
                    <select
                      id="nutritionGoal"
                      value={nutritionGoal}
                      onChange={(e) => setNutritionGoal(e.target.value as NutritionGoal)}
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
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="trainingDays">Dias disponíveis de treino por semana</Label>
                    <Input id="trainingDays" inputMode="numeric" placeholder="Ex.: 4" value={trainingDaysPerWeek} onChange={(e) => setTrainingDaysPerWeek(e.target.value)} />
                  </div>
                </CardContent>
              </>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border p-6 pt-4">
              <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || submitting}>
                <ArrowLeft /> Voltar
              </Button>
              <Button type="button" onClick={next} disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" /> : step === STEPS.length - 1 ? <Check /> : null}
                {step === STEPS.length - 1 ? "Concluir" : "Próximo"}
                {step < STEPS.length - 1 && <ArrowRight />}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}

function RadioCard({
  name,
  value,
  current,
  onChange,
  title,
  description,
}: {
  name: string;
  value: "prepped_sunday" | "fresh";
  current: string;
  onChange: (v: "prepped_sunday" | "fresh") => void;
  title: string;
  description: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={active}
      data-radio-group={name}
      className={cn(
        "flex min-h-[64px] flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors",
        active ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
      )}
    >
      <span className="flex items-center gap-2 font-medium">
        {title}
        {active && <Check className="size-4 text-primary" />}
      </span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}
