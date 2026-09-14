# AGENT_CONTRACTS.md — LifeOS (Fase 0.5)

> Contratos formais que a camada de agentes deve implementar na Fase 1, revisados a partir da proposta inicial em `ARCHITECTURE.md §3-5`. Especificação, não implementação — nenhum código foi escrito.
>
> **Consolidado (ADR 021):** `AgentTask` é sempre um contrato **transiente** (nunca uma tabela). O scheduler usa tabelas próprias, nomeadas sem sobreposição: `scheduled_jobs`/`job_runs` (ver §11). Um job agendado, ao disparar, cria um `AgentTask` transiente processado pelo Coordinator — os dois conceitos não compartilham nome nem tabela.

## 1. Visão geral do fluxo de invocação

```
Usuário ──▶ Coordinator (único ponto de entrada, D011)
              │
              │  monta AgentContext (household, perfil, memória filtrada, HOUSEHOLD.md)
              ▼
        AgentTask (contrato validado por schema)
              │
              ▼
     Policy Engine (risco real, servidor) ──▶ Capability Check
              │
              ▼
   Especialista (Nutrition | Fitness | Finance*) executa,
   usa apenas tools/skills da sua allowlist
              │
              ▼
      Output validado contra outputSchema
              │
              ▼
   Se LOW → aplica e audita
   Se MEDIUM/HIGH → cria agent_decisions (proposta versionada) e aguarda aprovação
              │
              ▼
        Coordinator sintetiza resposta ao usuário
```

*Finance Agent: contrato reservado, não implementado até a Fase 7.

## 2. Contrato de invocação do Coordinator (ausente na Fase 0 — adicionado aqui)

```ts
type CoordinatorInvocation = {
  requestId: string
  householdId: string
  personId: string          // quem está falando, dentro do household
  conversationId: string
  message: string
  attachments?: Attachment[]
}

type CoordinatorResponse = {
  requestId: string
  conversationId: string
  reply: string
  delegatedTasks: AgentTaskResult[]   // 0..n — pode responder sem delegar
  pendingApprovals: string[]          // ids de agent_decisions criadas nesta invocação, se houver
}
```

Toda invocação do Coordinator grava uma linha em `messages` (role=user) antes de processar e uma linha (role=agent) com a resposta — nunca processa sem persistir o turno primeiro (garante reconstrução de conversa mesmo se o processo morrer no meio).

## 3. Contrato `AgentTask` (revisado)

```ts
type AgentTask = {
  taskId: string
  requestId: string                 // correlação com a invocação do Coordinator/scheduler que originou
  agent: "nutrition" | "fitness" | "finance"   // Coordinator não se autoinvoca — nunca aparece aqui
  goal: string
  context: Record<string, unknown>  // apenas dados relevantes, já filtrados por household/person
  inputSchema: JSONSchema
  outputSchema: JSONSchema
  suggestedRiskLevel: "low" | "medium" | "high"   // ⚠ apenas informativo — nunca autoritativo (ver §6)
  idempotencyKey: string             // obrigatório — ver §11
  timeoutMs: number                  // obrigatório — ver §9
}
```

Mudanças em relação à proposta original: `riskLevel` renomeado para `suggestedRiskLevel` para deixar explícito que não é a fonte de verdade; `idempotencyKey` e `timeoutMs` adicionados (ausentes antes); `requestId` adicionado para tracing ponta a ponta.

Saída:

```ts
type AgentTaskResult = {
  taskId: string
  status: "completed" | "proposed" | "failed" | "timeout"
  output?: unknown              // validado contra outputSchema quando status=completed/proposed
  decisionId?: string           // presente quando status=proposed (vira agent_decisions)
  error?: { code: string; message: string }
  tokenUsage?: { input: number; output: number }
  costCents?: number
}
```

## 4. Capabilities — contrato de enforcement

`capabilities.json` deixa de ser apenas convenção documentada e passa a ser carregado por um middleware que intercepta **toda** tentativa de leitura/escrita/tool-call antes de chegar ao agente:

```ts
interface CapabilityCheck {
  agent: string
  action: `read:${string}` | `write:${string}` | `execute:${string}` | `delegate:${string}`
  resourceHouseholdId: string
}

function checkCapability(check: CapabilityCheck): "allow" | "deny"
```

Regra: **deny-by-default**. Uma ação só é permitida se estiver explicitamente em `can`; estar ausente de `cannot` não é suficiente para permitir. `delegate:*` só existe no `capabilities.json` do Coordinator — especialistas nunca têm essa capability (impede delegação em cadeia, conforme D0 já registrado na Fase 0).

## 5. Contrato de tool calling

- Toda tool exposta a um agente é uma função nomeada e registrada explicitamente (allowlist), nunca execução de código livre gerado pelo modelo.
- Toda chamada de tool passa pelo `CapabilityCheck` antes de executar.
- Resultado de uma tool é sempre tratado como UNTRUSTED DATA na montagem do próximo turno do prompt (ver `SECURITY_MODEL.md §7`), rotulado explicitamente.
- Toda chamada de tool é registrada (nome, argumentos, resultado resumido, duração) vinculada ao `agent_run` corrente, para auditoria.

## 6. Contrato do Risk/Policy Engine

```ts
interface RiskPolicy {
  evaluate(input: {
    actionType: string        // ex.: "meal_plan.create", "goal.delete", "workout_log.create"
    scope: { entityCount: number; reversible: boolean; financialImpactCents?: number }
    agent: string
  }): "low" | "medium" | "high"
}
```

- Implementado como função determinística no servidor com uma tabela de regras fixas (ex.: `workout_log.create` → sempre `low`; `meal_plan.apply` → sempre `medium`; `goal.delete` ou qualquer ação com `financialImpactCents` acima de um limiar → `high`).
- O `suggestedRiskLevel` vindo do agente é **logado para análise/UX**, mas nunca substitui o resultado de `RiskPolicy.evaluate`.
- Regra dura: nenhuma ação classificada como `medium`/`high` pelo Policy Engine executa sem passar pelo fluxo de aprovação (§8), independentemente do que o agente "achou".

## 7. Contrato de memória

```ts
interface MemoryStore {
  read(householdId: string, types: MemoryType[], personId?: string): MemoryItem[]   // sempre filtrado, nunca "read all"
  proposeWrite(item: MemoryItemDraft): { requiresApproval: boolean }
  commit(itemId: string, approvalRef?: string): void
}
```

- `proposeWrite` para `type ∈ {profile, goal}` **sempre** retorna `requiresApproval: true` quando a mudança é classificada como impacto relevante pelo Policy Engine (reaproveita §6) — nunca grava direto.
- `proposeWrite` para `type ∈ {historical, decision}` é append-only e não exige aprovação (são fatos observados/registrados, não interpretações).
- `proposeWrite` para `type = learned_pattern` sempre marca `confidence < 1.0` e nunca é promovido automaticamente a `profile`/`goal` — promoção exige ação humana explícita (resolve a pergunta "como impedir que uma inferência vire fato permanente", `DATA_MODEL_REVIEW.md §4`).
- Toda leitura de memória para montar contexto de um agente é limitada por tamanho (top-N por relevância/recência) — nunca o histórico completo.

## 8. Contrato de decisões e aprovações

```ts
interface DecisionProposal {
  decisionId: string
  householdId: string
  agent: string
  proposalHash: string        // hash determinístico do conteúdo proposto
  recommendation: unknown
  riskLevel: "medium" | "high"
  expiresAt: string           // ISO — proposta não aprovada após esse prazo vira "expired"
}

interface Approval {
  decisionId: string
  proposalHash: string        // deve bater exatamente com o hash vigente da proposta
  approvedBy: string           // person_id de quem aprovou
  approvedAt: string
}
```

- `Approval.proposalHash` divergente do hash atual da proposta é rejeitado (proteção contra bait-and-switch, D013).
- Execução da ação aprovada usa a própria `decisionId` como chave de idempotência — reprocessar a mesma aprovação não duplica o efeito.
- Proposta expirada (`status = expired`) não pode mais ser aprovada; o agente precisa gerar uma nova proposta com dados atualizados.

## 9. Timeout e execução

- Todo `AgentTask` carrega `timeoutMs` obrigatório (default por tipo de agente, ex.: 60s para chamadas simples, mais para geração de plano semanal completo).
- Estourar o timeout marca o `agent_run` como `status=timeout`, libera o `agent_task` correspondente (se originado do scheduler) para retry conforme política (§11), e não deixa o worker travado esperando indefinidamente.

## 10. Retries e backoff

- Retry só se aplica a falhas técnicas (timeout, erro de provider, erro de rede) — nunca a uma saída que falhou validação de `outputSchema` sem reformular o input (evita repetir o mesmo erro de forma determinística).
- Backoff exponencial com jitter; `max_attempts` por tipo de job (config, não hardcode); após esgotar, status `dead_letter` + evento de auditoria (nunca falha silenciosa).

## 11. Scheduler: `scheduled_jobs` / `job_runs` (ADR 018, ADR 021) e idempotência

- Entidades persistidas, distintas de `AgentTask`: `scheduled_jobs (id, household_id, kind, cron_expr, timezone, next_run_at, status, attempts, max_attempts, lease_expires_at, locked_by, idempotency_key)` e `job_runs (id, scheduled_job_id, started_at, finished_at, status, result_summary, request_id)`.
- Claim de job é atômico: `UPDATE scheduled_jobs SET status='running', lease_expires_at=now()+lease, locked_by=$worker WHERE status='pending' AND (lease_expires_at IS NULL OR lease_expires_at < now()) RETURNING *` — nunca "select then update" em dois passos.
- Um reaper periódico devolve a `pending` jobs cujo `lease_expires_at` expirou (worker morto/restart) e incrementa `attempts`; ao esgotar `max_attempts`, status vira `dead_letter` (nunca retry infinito nem falha silenciosa).
- Ao disparar, um `job_run` cria um `AgentTask` transiente com `idempotencyKey` derivada do job (ex.: `"weekly-planning:{household_id}:{week_start_date}"`), permitindo que um retry seguro reconheça "isso já foi feito" antes de repetir efeitos colaterais.
- Efeitos colaterais externos (ex.: notificação) são registrados com sua própria chave de idempotência antes do disparo, para que um retry não reenvie a mesma notificação duas vezes.
- Timezone do job é sempre explícito (herdado de `households.timezone`); janela de catch-up configurável evita tanto perder execuções durante downtime quanto rodar múltiplas vezes para disparos perdidos.

## 12. Observabilidade / tracing

Todo `agent_run` registra: `request_id`, `agent`, `task_kind`, `started_at`, `finished_at`, `status`, `token_usage_json` (input/output tokens), `cost_cents` (estimado a partir do preço do modelo usado), `model_id`, `prompt_version`. `request_id` se propaga da invocação do Coordinator (ou do job do scheduler) até toda tool call e todo agent_run derivado, permitindo reconstruir a árvore completa de uma interação para depuração.

## 13. Contrato do AI Provider (expandido)

Proposta original (`ARCHITECTURE.md §5`) era magra demais para um sistema com decisões de saúde/custo real. Contrato revisado:

```ts
interface AIProvider {
  complete(input: {
    requestId: string
    systemPrompt: string
    messages: Message[]
    tools?: ToolSpec[]
    outputSchema?: JSONSchema        // força structured output quando presente
    modelId: string                  // explícito, nunca "o modelo default" implícito
    timeoutMs: number
    maxRetries: number
  }): Promise<AIResponse>
}

type AIResponse = {
  content: string | null
  toolCalls?: ToolCall[]
  structuredOutput?: unknown         // validado contra outputSchema antes de retornar
  usage: { inputTokens: number; outputTokens: number }
  estimatedCostCents: number
  modelId: string
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error"
  requestId: string
}
```

Itens adicionados que não existiam na proposta da Fase 0: `outputSchema`/structured output obrigatório quando aplicável, `requestId` de ponta a ponta, `usage`/`estimatedCostCents` (requisito do prompt mestre seção 45, sem o qual não há como o sistema "considerar custo de inferência"), `stopReason` explícito incluindo `refusal` (o sistema precisa saber diferenciar "o modelo recusou" de "o modelo terminou normalmente" para lidar com os limites de saúde de `SECURITY_MODEL.md §13`), timeout e retry como parte do contrato (não deixado para cada implementação decidir por conta própria).

## 14. Delegação — regras fixas

- Coordinator → especialista: permitido, único sentido permitido.
- Especialista → especialista: **nunca** (sem cadeias de delegação, conforme já decidido na Fase 0).
- Especialista → Coordinator: não é "delegação", é retorno de resultado (`AgentTaskResult`), fluxo de resposta, não uma nova invocação.
- Coordinator → Coordinator: proibido (sem recursão), enforced pelo próprio `CapabilityCheck` (`delegate:coordinator` nunca existe em nenhum `capabilities.json`).

## 15. O que fica pendente para a Fase 1 decidir na implementação (não bloqueante nesta revisão)

- Biblioteca exata de validação de JSON Schema (ex.: zod/ajv) — detalhe de implementação, não arquitetural.
- Escolha do modelo default por tipo de tarefa (pode evoluir por configuração, não exige decisão agora).
- Formato exato de serialização de `content_json`/`context_json` (JSON já é suficiente como decisão de tipo de coluna).
