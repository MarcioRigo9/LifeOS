"use client";

import * as React from "react";
import { Check, Loader2, Flag } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiPost } from "@/lib/client/api";

interface PlanItem {
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
}

interface LoggedSet {
  id: string;
  exercise_id: string;
  set_number: number;
  reps: number;
  load_kg: string;
  rpe: string | null;
  completed: boolean;
}

export function ActiveWorkoutSession({
  householdId,
  sessionId,
  items,
  loggedSets,
  onCompleted,
  onSetLogged,
}: {
  householdId: string;
  sessionId: string;
  items: PlanItem[];
  loggedSets: LoggedSet[];
  onCompleted: () => void;
  onSetLogged: () => void;
}) {
  const [completing, setCompleting] = React.useState(false);

  const setsByExercise = React.useMemo(() => {
    const map = new Map<string, LoggedSet[]>();
    for (const s of loggedSets) {
      if (!map.has(s.exercise_id)) map.set(s.exercise_id, []);
      map.get(s.exercise_id)!.push(s);
    }
    return map;
  }, [loggedSets]);

  const totalTargetSets = items.reduce((sum, it) => sum + it.target_sets, 0);
  const totalLoggedSets = loggedSets.length;

  async function complete() {
    setCompleting(true);
    try {
      await apiPost(`/api/fitness/sessions/${sessionId}/complete`, { householdId });
      toast.success("Treino concluído! Bom trabalho.");
      onCompleted();
    } catch {
      toast.error("Não foi possível concluir agora.");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-primary/30 bg-accent/40">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">Sessão em andamento</p>
            <p className="text-xs text-muted-foreground">
              {totalLoggedSets} de {totalTargetSets} séries registradas
            </p>
          </div>
          <Button onClick={complete} disabled={completing} variant="success">
            {completing ? <Loader2 className="animate-spin" /> : <Flag />}
            Concluir treino
          </Button>
        </CardContent>
      </Card>

      {items.map((item) => (
        <ExerciseSetCard
          key={item.id}
          householdId={householdId}
          sessionId={sessionId}
          item={item}
          logged={setsByExercise.get(item.exercise_id) ?? []}
          onSetLogged={onSetLogged}
        />
      ))}
    </div>
  );
}

function ExerciseSetCard({
  householdId,
  sessionId,
  item,
  logged,
  onSetLogged,
}: {
  householdId: string;
  sessionId: string;
  item: PlanItem;
  logged: LoggedSet[];
  onSetLogged: () => void;
}) {
  const loggedNumbers = new Set(logged.map((l) => l.set_number));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{item.exercise_name}</span>
          <Badge variant="outline">
            {item.min_reps}-{item.max_reps} reps · RPE {Number(item.target_rpe)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: item.target_sets }, (_, i) => i + 1).map((setNumber) => {
          const done = logged.find((l) => l.set_number === setNumber);
          return done ? (
            <div key={setNumber} className="flex items-center gap-3 rounded-lg bg-success/10 px-3 py-2.5 text-sm">
              <Check className="size-4 shrink-0 text-success" />
              <span className="font-medium">Série {setNumber}</span>
              <span className="ml-auto text-muted-foreground">
                {done.reps} reps · {Number(done.load_kg)}kg{done.rpe ? ` · RPE ${Number(done.rpe)}` : ""}
              </span>
            </div>
          ) : (
            <SetInputRow
              key={setNumber}
              householdId={householdId}
              sessionId={sessionId}
              exerciseId={item.exercise_id}
              setNumber={setNumber}
              defaultReps={item.max_reps}
              defaultLoad={item.target_load_kg ? Number(item.target_load_kg) : undefined}
              onLogged={onSetLogged}
            />
          );
        })}
        {!loggedNumbers.size ? null : null}
      </CardContent>
    </Card>
  );
}

function SetInputRow({
  householdId,
  sessionId,
  exerciseId,
  setNumber,
  defaultReps,
  defaultLoad,
  onLogged,
}: {
  householdId: string;
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  defaultReps: number;
  defaultLoad?: number;
  onLogged: () => void;
}) {
  const [reps, setReps] = React.useState(String(defaultReps));
  const [load, setLoad] = React.useState(defaultLoad !== undefined ? String(defaultLoad) : "");
  const [rpe, setRpe] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit() {
    if (!reps || !load) {
      toast.error("Preencha repetições e carga.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost(`/api/fitness/sessions/${sessionId}/sets`, {
        householdId,
        exerciseId,
        setNumber,
        reps: Number(reps),
        loadKg: Number(load),
        rpe: rpe ? Number(rpe) : undefined,
      });
      onLogged();
    } catch {
      toast.error("Valor fora do plausível — confira reps/carga/RPE.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
      <span className="w-14 shrink-0 text-sm font-medium text-muted-foreground">Série {setNumber}</span>
      <Input
        inputMode="numeric"
        placeholder="reps"
        value={reps}
        onChange={(e) => setReps(e.target.value)}
        className="h-9 w-16 px-2 text-center"
      />
      <Input
        inputMode="decimal"
        placeholder="kg"
        value={load}
        onChange={(e) => setLoad(e.target.value)}
        className="h-9 w-16 px-2 text-center"
      />
      <Input
        inputMode="decimal"
        placeholder="RPE"
        value={rpe}
        onChange={(e) => setRpe(e.target.value)}
        className="h-9 w-16 px-2 text-center"
      />
      <Button size="sm" className="ml-auto" onClick={submit} disabled={submitting}>
        {submitting ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
    </div>
  );
}
