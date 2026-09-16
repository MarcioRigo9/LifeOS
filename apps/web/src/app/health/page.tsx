"use client";

import * as React from "react";
import { Plus, Loader2, ShieldAlert, Check } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger, SheetFooter, SheetClose } from "@/components/ui/sheet";
import { WeightChart } from "@/components/health/weight-chart";
import { useSession } from "@/components/providers/session-provider";
import { useFetch } from "@/lib/client/useFetch";
import { apiPost, ApiError } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface MeasurementRow {
  id: string;
  takenAt: string;
  weightKg: number;
  bodyFatPct: number | null;
  notes: string | null;
}

interface HistoryRow {
  id: string;
  category: string;
  title: string;
  details: string;
  active: boolean;
  recordedAt: string;
  source: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  injury: "Lesão",
  surgery: "Cirurgia",
  allergy: "Alergia",
  chronic_condition: "Condição crônica",
  continuous_medication: "Medicação contínua",
};

export default function HealthPage() {
  const { householdId, activeProfileId, loading: sessionLoading } = useSession();
  const measurementsUrl = householdId && activeProfileId ? `/api/health/measurements?householdId=${householdId}&personId=${activeProfileId}` : null;
  const { data: measurements, loading: measurementsLoading, refresh: refreshMeasurements } = useFetch<MeasurementRow[]>(measurementsUrl);
  const historyUrl = householdId && activeProfileId ? `/api/health/history?householdId=${householdId}&personId=${activeProfileId}` : null;
  const { data: history, loading: historyLoading, refresh: refreshHistory } = useFetch<HistoryRow[]>(historyUrl);

  const isLoading = sessionLoading || measurementsLoading;

  return (
    <AppShell>
      <TopBar title="Saúde" subtitle="Pesagens e histórico" />

      <div className="flex flex-col gap-5 p-4 md:p-8">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Tendência de peso</CardTitle>
            {householdId && activeProfileId && (
              <NewMeasurementSheet householdId={householdId} profileId={activeProfileId} onCreated={refreshMeasurements} />
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-40 w-full" /> : <WeightChart points={measurements ?? []} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Últimas pesagens</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !measurements || measurements.length === 0 ? (
              <EmptyRow text="Nenhuma pesagem registrada." />
            ) : (
              measurements.slice(0, 8).map((m) => (
                <div key={m.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                  <span className="text-muted-foreground">{formatDate(m.takenAt, { day: "2-digit", month: "short", year: "numeric" })}</span>
                  <span className="font-medium">{m.weightKg}kg</span>
                  {m.bodyFatPct !== null && <span className="text-xs text-muted-foreground">{m.bodyFatPct}% gordura</span>}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Histórico de saúde</CardTitle>
            {householdId && activeProfileId && <NewHistorySheet householdId={householdId} profileId={activeProfileId} onCreated={refreshHistory} />}
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {sessionLoading || historyLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : !history || history.length === 0 ? (
              <EmptyRow text="Nenhum registro qualitativo ainda." />
            ) : (
              history.map((h) => (
                <div key={h.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground" />
                        <p className="truncate text-sm font-medium">{h.title}</p>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{h.details}</p>
                    </div>
                    <Badge variant={h.active ? "warning" : "outline"} className="shrink-0">
                      {h.active ? "ativo" : "resolvido"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{CATEGORY_LABEL[h.category] ?? h.category} · {formatDate(h.recordedAt, { day: "2-digit", month: "short" })}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="rounded-lg bg-muted px-3 py-4 text-center text-sm text-muted-foreground">{text}</p>;
}

function NewMeasurementSheet({ householdId, profileId, onCreated }: { householdId: string; profileId: string; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [weight, setWeight] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiPost("/api/health/measurements", {
        householdId,
        personId: profileId,
        takenAt: new Date().toISOString(),
        weightKg: Number(weight),
        notes: notes || undefined,
      });
      toast.success("Pesagem registrada.");
      setWeight("");
      setNotes("");
      setOpen(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === "implausible_value" ? "Valor fora do plausível." : "Não foi possível registrar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus /> Nova pesagem
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Nova pesagem</SheetTitle>
          <SheetDescription>Registrada agora, para o perfil ativo.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="weightKg">Peso (kg)</Label>
            <Input id="weightKg" inputMode="decimal" required value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="82.5" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </SheetClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Check />}
              Salvar
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function NewHistorySheet({ householdId, profileId, onCreated }: { householdId: string; profileId: string; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState("injury");
  const [title, setTitle] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiPost("/api/health/history", { householdId, personId: profileId, category, title, details, source: "user_input" });
      toast.success("Registro salvo.");
      setTitle("");
      setDetails("");
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Não foi possível salvar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus /> Novo registro
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Novo registro de saúde</SheetTitle>
          <SheetDescription>Lesões, alergias, condições — usado para adaptar treinos com segurança.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category">Categoria</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm"
            >
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Título</Label>
            <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tendinite no ombro direito" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="details">Detalhes</Label>
            <Textarea id="details" required value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </SheetClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Check />}
              Salvar
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
