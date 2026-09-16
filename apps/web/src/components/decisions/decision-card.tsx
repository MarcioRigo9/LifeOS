"use client";

import * as React from "react";
import { Check, X, ShieldAlert, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { apiPost } from "@/lib/client/api";
import { decisionTitle, decisionSummary, type ActionEnvelopeLike } from "@/lib/client/decisionFormat";
import { cn } from "@/lib/utils";

export interface DecisionSummary {
  id: string;
  riskLevel: "medium" | "high";
  proposalHash: string;
  agentName: string;
  actionEnvelope: ActionEnvelopeLike;
  expiresAt: string;
  createdAt: string;
}

/**
 * The Action Card required by the Coordinator hub spec (§2.2) — every medium/high-risk proposal
 * renders here with its Policy Engine risk level, affected entities, proposal_hash and explicit
 * Approve/Reject buttons. Reused on the dashboard banner, the chat and the Review screen so the
 * approval flow looks and behaves identically everywhere it appears.
 */
export function DecisionCard({
  decision,
  householdId,
  onResolved,
  compact = false,
}: {
  decision: DecisionSummary;
  householdId: string;
  onResolved?: () => void;
  compact?: boolean;
}) {
  const [pending, setPending] = React.useState<"approve" | "reject" | null>(null);

  async function approve() {
    setPending("approve");
    try {
      await apiPost(`/api/decisions/${decision.id}/approve`, { householdId, proposalHash: decision.proposalHash });
      toast.success("Proposta aprovada e aplicada.");
      onResolved?.();
    } catch {
      toast.error("Não foi possível aprovar agora. Tente de novo.");
    } finally {
      setPending(null);
    }
  }

  async function reject() {
    setPending("reject");
    try {
      await apiPost(`/api/decisions/${decision.id}/reject`, { householdId });
      toast("Proposta rejeitada.");
      onResolved?.();
    } catch {
      toast.error("Não foi possível rejeitar agora. Tente de novo.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className={cn("border-primary/20", compact && "shadow-none")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <ShieldAlert className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">{decisionTitle(decision.actionEnvelope.actionType)}</p>
              <p className="text-xs text-muted-foreground">{decision.agentName}</p>
            </div>
          </div>
          <Badge variant={decision.riskLevel === "high" ? "destructive" : "warning"} className="shrink-0 uppercase">
            {decision.riskLevel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{decisionSummary(decision.actionEnvelope)}</p>
        <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
          <KeyRound className="size-3 shrink-0" />
          <span className="truncate font-mono">{decision.proposalHash}</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="success" className="flex-1" onClick={approve} disabled={pending !== null}>
            {pending === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
            Aprovar
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={reject} disabled={pending !== null}>
            {pending === "reject" ? <Loader2 className="animate-spin" /> : <X />}
            Rejeitar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
