"use client";

import * as React from "react";
import { Send, Loader2, Bot, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionCard, type DecisionSummary } from "@/components/decisions/decision-card";
import { useSession } from "@/components/providers/session-provider";
import { useFetch } from "@/lib/client/useFetch";
import { apiPost } from "@/lib/client/api";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "agent" | "system" | "tool";
  content: string;
  created_at: string;
  agent_name: string | null;
}

interface ConversationData {
  conversationId: string | null;
  messages: Message[];
}

export default function CoordinatorPage() {
  const { householdId, activeProfileId, loading: sessionLoading } = useSession();
  const convUrl = householdId ? `/api/coordinator/conversation?householdId=${householdId}` : null;
  const { data, loading, refresh } = useFetch<ConversationData>(convUrl);
  const decisionsUrl = householdId ? `/api/decisions?householdId=${householdId}&status=PENDING` : null;
  const { data: decisions, refresh: refreshDecisions } = useFetch<DecisionSummary[]>(decisionsUrl);

  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [localMessages, setLocalMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (data) {
      setConversationId(data.conversationId);
      setLocalMessages(data.messages);
    }
  }, [data]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [localMessages]);

  async function send() {
    if (!input.trim() || !householdId || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);

    setLocalMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString(), agent_name: null },
    ]);

    try {
      const res = await apiPost<{ conversationId: string; reply: string }>("/api/coordinator", {
        householdId,
        message: text,
        conversationId: conversationId ?? undefined,
      });
      setConversationId(res.conversationId);
      setLocalMessages((prev) => [
        ...prev,
        { id: `local-reply-${Date.now()}`, role: "agent", content: res.reply, created_at: new Date().toISOString(), agent_name: "Coordinator" },
      ]);
      refreshDecisions();
    } catch {
      toast.error("Não consegui falar com o Coordinator agora.");
      refresh();
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isLoading = sessionLoading || loading;

  return (
    <AppShell>
      <TopBar title="Coordinator" subtitle="Peça planos, tire dúvidas, aprove decisões" />

      <div className="flex h-[calc(100dvh-140px)] flex-col md:h-[calc(100dvh-90px)]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 md:px-8">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-14 w-2/3" />
              <Skeleton className="ml-auto h-10 w-1/2" />
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-3">
              {localMessages.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                  <Bot className="size-8" />
                  <p className="text-sm">
                    Peça algo como <span className="font-medium text-foreground">&quot;monta o plano de treino da semana&quot;</span>
                  </p>
                </div>
              )}
              {localMessages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}

              {decisions && decisions.length > 0 && (
                <div className="mt-2 flex flex-col gap-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkles className="size-3.5" /> Propostas pendentes
                  </p>
                  {decisions.map((d) => (
                    <DecisionCard key={d.id} decision={d} householdId={householdId!} onResolved={refreshDecisions} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="safe-bottom border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={activeProfileId ? "Escreva uma mensagem..." : "Carregando..."}
              rows={1}
              className="max-h-32 min-h-[44px] resize-none py-2.5"
              disabled={!householdId}
            />
            <Button size="icon" onClick={send} disabled={sending || !input.trim()} aria-label="Enviar">
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
          isUser ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border border-border bg-card"
        )}
      >
        {!isUser && message.agent_name && <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">{message.agent_name}</p>}
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}
