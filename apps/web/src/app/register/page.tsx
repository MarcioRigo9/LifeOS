"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";

export default function RegisterPage() {
  const router = useRouter();
  const [householdName, setHouseholdName] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiPost("/api/auth/register", { householdName, displayName, email, password });
      toast.success("Household criado! Bem-vindo.");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Não foi possível criar o household. Verifique os dados.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Nossa Vida</h1>
          <p className="text-sm text-muted-foreground">Crie o espaço do casal em menos de um minuto.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Criar household</CardTitle>
            <CardDescription>Vocês podem adicionar o segundo perfil depois.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="householdName">Nome do household</Label>
                <Input id="householdName" required placeholder="Família Silva" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="displayName">Seu nome</Label>
                <Input id="displayName" required placeholder="Márcio" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" size="lg" disabled={submitting} className="mt-2">
                {submitting && <Loader2 className="animate-spin" />}
                Criar household
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
