# AGENT_CONTRACTS.md — LifeOS (Fase 0.5)

> Contratos formais que a camada de agentes deve implementar na Fase 1, revisados a partir da proposta inicial em `ARCHITECTURE.md §3-5`. Especificação, não implementação — nenhum código foi escrito.
>
> **Consolidado (ADR 021):** `AgentTask` é sempre um contrato **transiente** (nunca uma tabela). O scheduler usa tabelas próprias, nomeadas sem sobreposição: `scheduled_jobs`/`job_runs` (ver §11). Um job agendado, ao disparar, cria um `AgentTask` transiente processado pelo Coordinator — os dois conceitos não compartilham nome nem tabela.
>
> **Este documento é a referência normativa** para o contrato de AI Provider (§13) e para o modelo de Approval/Execution — `ActionEnvelope`, hash de proposta, máquina de estados, idempotência e recuperação de crash (§8, ADR 023). `ARCHITECTURE.md` pode resumir essas seções, mas nunca apresentar uma forma divergente — em caso de conflito, este documento prevalece.

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

## 8. Contrato de decisões e aprovações (ADR 013, ADR 023 — normativo)

Fecha definitivamente a cadeia `Decision Proposal → Approval → Execution` como uma sequência de dados estruturados que o servidor consegue executar sem reinterpretar linguagem natural em nenhum ponto.

### 8.1 `ActionEnvelope` — a ação executável

Todo `DecisionProposal` carrega, em vez de uma `recommendation: unknown` solta, um `ActionEnvelope` estruturado: a única coisa que o executor de fato interpreta para agir.

```ts
type ActionEnvelope = {
  actionType: string                          // ex.: "goal.update", "meal_plan.apply", "shopping_list.create"
  actionPayload: Record<string, unknown>       // parâmetros estruturados da ação — nunca texto livre
  targetEntityIds: string[]                    // ids das entidades lidas/afetadas — usado em autorização e auditoria
  expectedVersions: Record<string, number>     // "goal:uuid" → version esperada (ADR 017) — checado NO MOMENTO DA EXECUÇÃO, não só na criação da proposta
  scope: {
    householdId: string
    entityCount: number
    reversible: boolean
    financialImpactCents: number               // 0 quando não há impacto financeiro
  }
}
```

`actionType` é sempre um identificador de uma ação conhecida e registrada no executor (allowlist, igual a tools — nunca uma string arbitrária interpretada livremente). `expectedVersions` é a ponte entre este contrato e a concorrência otimista (ADR 017): a execução só prossegue se as versões atuais das entidades baterem exatamente com o que foi proposto.

### 8.2 `DecisionProposal` / `Approval`

```ts
interface DecisionProposal {
  decisionId: string
  householdId: string
  agent: string
  action: ActionEnvelope
  riskLevel: "medium" | "high"      // já determinado pelo Policy Engine (§6) — nunca o suggestedRiskLevel do agente
  proposalHash: string              // ver §8.3 — calculado uma única vez, na criação
  status: DecisionStatus            // ver §8.4
  createdAt: string
  expiresAt: string                 // proposta não aprovada após esse prazo vira EXPIRED
}

interface Approval {
  decisionId: string
  proposalHash: string              // deve bater exatamente com o proposal_hash armazenado (imutável) da proposta
  approvedBy: string                  // person_id de quem aprovou
  approvedAt: string
}
```

**Imutabilidade:** uma `DecisionProposal` nunca é alterada em memória depois de criada. Se o agente precisa propor algo diferente (novos dados, novo cálculo), isso é uma **nova** `DecisionProposal` com novo `decisionId`/`proposalHash` — a antiga é marcada `EXPIRED` ou `REJECTED`, nunca sobrescrita. Isso é o que torna a comparação de hash em `Approval` uma simples igualdade contra um valor fixo, não um "recálculo" sujeito a condição de corrida.

### 8.3 `proposalHash` — o que protege e como é calculado

**Campos incluídos na representação canônica** (mínimo obrigatório): `actionType`, `actionPayload`, `targetEntityIds`, `expectedVersions`, `scope`, `riskLevel`. Isso é deliberado: o hash protege a **ação executável**, não o texto da recomendação — é isso que impede `aprovar proposta A → sistema executa B`.

- **Algoritmo:** SHA-256, hex-encoded.
- **Serialização canônica:** JSON com chaves ordenadas alfabeticamente em todos os níveis (recursivamente), sem espaços em branco, UTF-8 — equivalente a JCS (RFC 8785). Arrays preservam ordem (não são reordenados).
- **Campos opcionais/ausentes:** qualquer chave com valor `undefined` é omitida da serialização; um valor `null` explícito é preservado como `null` (distinto de ausente) — nunca normalizar `null` para ausente ou vice-versa, para não colidir hashes de propostas semanticamente diferentes.
- **Normalização de números:** valores monetários são sempre inteiros (ADR 016) — nunca serializar como float, o que já elimina ambiguidade de representação.
- **Momento do cálculo:** uma única vez, no instante em que o Policy Engine termina de classificar o risco e a `DecisionProposal` é criada — nunca recalculado depois a partir de uma cópia enviada pelo cliente.
- **Validação de uma `Approval`:** o servidor busca a `DecisionProposal` pelo `decisionId` (fonte de verdade é o banco, nunca o payload do cliente), compara `approval.proposalHash` contra o `proposal_hash` armazenado (imutável) daquela linha. Divergência → aprovação rejeitada (proteção contra bait-and-switch, ADR 013).

### 8.4 Máquina de estados (`agent_decisions.status`)

```text
PENDING     — proposta criada, aguardando decisão humana
APPROVED    — humano aprovou; ainda não iniciou execução
REJECTED    — humano rejeitou (terminal)
EXPIRED     — prazo esgotado sem decisão, ou aprovada mas não executada a tempo (terminal)
EXECUTING   — execução em andamento (claim atômico, ver §8.5)
EXECUTED    — execução concluída com sucesso (terminal)
FAILED      — execução tentada e falhou de forma definitiva (terminal)
```

**Transições válidas — qualquer outra é rejeitada pelo servidor:**

```text
PENDING   → APPROVED     (aprovação válida, hash bate, dentro do prazo)
PENDING   → REJECTED     (rejeição humana)
PENDING   → EXPIRED      (expiresAt passou sem decisão)

APPROVED  → EXECUTING    (claim atômico pelo executor)
APPROVED  → EXPIRED      (aprovada mas não reivindicada para execução dentro do prazo — protege contra
                           executar uma ação aprovada há muito tempo sobre dados já desatualizados)

EXECUTING → EXECUTED     (transação de execução commitada com sucesso)
EXECUTING → FAILED       (execução rodou e falhou — ex.: expectedVersions não bateu, erro de negócio)
```

**Não existem** transições `FAILED → EXECUTING`, `REJECTED → APPROVED`, `EXPIRED → APPROVED` nem qualquer atalho pulando `APPROVED`. `FAILED` é deliberadamente terminal: se a execução falhou (seja por conflito de versão, seja por erro de negócio), a resposta correta é gerar uma **nova** proposta com dados atualizados — nunca tentar de novo silenciosamente sobre premissas que já se mostraram inválidas. Isso é consistente com a regra de imutabilidade do §8.2.

A única exceção — não é uma transição de estado de negócio, é recuperação de infraestrutura — está no §8.6 (crash durante `EXECUTING` sem que a execução de fato tenha rodado).

### 8.5 Execução idempotente

- `decisionId` é a chave de idempotência da execução — nunca a `proposalHash` sozinha (duas propostas distintas podem, em teoria, ter o mesmo conteúdo/hash; `decisionId` é sempre único).
- **Claim atômico**, mesmo padrão do scheduler (ADR 018): `UPDATE agent_decisions SET status='EXECUTING', execution_started_at=now(), execution_lease_expires_at=now()+lease WHERE id=$1 AND status='APPROVED' RETURNING *`. Uma segunda tentativa concorrente encontra `status` já diferente de `APPROVED` e a query afeta zero linhas — sem exceção nem lock explícito necessário.
- **`decision_executions`** (entidade separada, não misturada em `agent_decisions` — ver `DATA_MODEL_REVIEW.md §2.5`) registra o resultado: `decision_id` (chave única — no máximo uma linha por decisão), `request_id`, `started_at`, `finished_at`, `status` (`executed`/`failed`), `result_json`, `error_json`. A constraint de unicidade em `decision_id` é uma segunda camada de proteção contra execução duplicada, independente do claim atômico.
- **A ação de negócio e a gravação em `decision_executions` acontecem na mesma transação de banco.** Isso é o que torna a recuperação de crash (§8.6) determinística: ou as duas coisas aconteceram, ou nenhuma aconteceu — nunca um estado intermediário observável.
- No momento da execução (dentro dessa mesma transação), o executor **revalida `expectedVersions`** contra o estado atual das entidades em `targetEntityIds`. Divergência → a transação não aplica a ação de negócio, grava `decision_executions.status='failed'` com o motivo, e `agent_decisions.status` vai para `FAILED` — nunca aplica a ação sobre dados que mudaram desde a aprovação.

### 8.6 Recuperação após crash (`APPROVED → EXECUTING → processo morre`)

Comportamento explícito, não implícito:

1. Um reaper periódico (mesmo mecanismo do scheduler, ADR 018) procura `agent_decisions` com `status='EXECUTING'` e `execution_lease_expires_at` no passado.
2. Para cada uma, verifica se existe uma linha em `decision_executions` para aquele `decision_id`:
   - **Existe, com `status='executed'`:** a transação de execução já tinha commitado antes do crash (o worker morreu só depois, ex. ao enviar uma resposta). O reaper apenas reconcilia `agent_decisions.status → EXECUTED`. Nada é reexecutado.
   - **Existe, com `status='failed'`:** idem, reconcilia para `FAILED`. Terminal, nova proposta necessária se for o caso.
   - **Não existe nenhuma linha:** a transação nunca commitou — o crash aconteceu antes de qualquer efeito colateral real. Seguro reivindicar de novo: `agent_decisions.status → APPROVED`, incrementa `attempts`. Elegível para novo claim (§8.5), até `max_attempts` (mesma política de backoff do scheduler, §10-11).
3. Ao esgotar `max_attempts` sem sucesso, `status → FAILED` (terminal) com evento de auditoria — nunca fica preso em `EXECUTING` nem tenta para sempre.

Este é o mecanismo que torna a árvore `EXECUTING → EXECUTED | FAILED` segura mesmo com o worker morrendo a qualquer momento: a atomicidade da transação (§8.5) elimina qualquer estado ambíguo, e o reaper só precisa checar "existe `decision_executions`?" para saber o que fazer — nunca precisa "verificar o efeito" heuristicamente no domínio de negócio.

## 9. Timeout e execução

- Todo `AgentTask` carrega `timeoutMs` obrigatório (default por tipo de agente, ex.: 60s para chamadas simples, mais para geração de plano semanal completo).
- Estourar o timeout marca o `agent_run` como `status=timeout`, libera o `job_run` correspondente (se originado do scheduler, ver §11) para retry conforme política, e não deixa o worker travado esperando indefinidamente.
- Este é o timeout da **invocação de um agente** (`AgentTask`), distinto do `execution_lease_expires_at` de uma decisão aprovada em execução (§8.5-8.6) — são dois relógios diferentes: um agente pode responder dentro do timeout e ainda assim gerar uma proposta cuja execução (depois de aprovada) tem seu próprio lease.

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
- **Regra de catch-up por tipo de job (fecha o cenário "sistema ficou fora do ar por 3 sábados"):** jobs de planejamento (`weekly-planning`, `shopping-preparation`) catch-up no máximo **uma vez**, usando os dados mais recentes disponíveis no momento em que o sistema volta — nunca disparam uma vez por ocorrência perdida. `next_run_at` é recalculado para o próximo horário futuro (não para cada slot perdido); o `job_run` resultante registra em `result_summary` que houve atraso. Jobs de registro/logging (`daily-check-in`) podem ter política de catch-up diferente (configurável por `kind`), mas o default nunca é "rodar N vezes para N ocorrências perdidas".

## 12. Observabilidade / tracing

Todo `agent_run` registra: `request_id`, `agent`, `task_kind`, `started_at`, `finished_at`, `status`, `token_usage_json` (input/output tokens), `cost_cents` (estimado a partir do preço do modelo usado), `model_id`, `prompt_version`. `request_id` se propaga da invocação do Coordinator (ou do job do scheduler) até toda tool call e todo agent_run derivado, permitindo reconstruir a árvore completa de uma interação para depuração.

## 13. Contrato do AI Provider (normativo)

Este é o contrato canônico do AI Provider. `ARCHITECTURE.md §5` apresenta um resumo dele — se algum dia divergir, esta seção prevalece.

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
