# ARCHITECTURE.md — LifeOS

> Detalhamento técnico da proposta descrita em PROJECT_DISCOVERY.md. Este documento evolui; decisões estruturais relevantes devem virar ADRs em `docs/adr/`.
>
> **Consolidado na Fase 0.5** (ver `ARCHITECTURE_CONSOLIDATION_RESULT.md` e ADRs 011-022). Este arquivo reflete a versão canônica pós-consolidação; onde o texto original divergia, a correção está marcada inline com o ADR correspondente.

## 1. Princípios

1. IA raciocina, software calcula, banco armazena, agentes especializados analisam, coordenador conecta.
2. Nenhum cálculo determinístico (custo, fator de cocção, progressão, orçamento) é delegado ao LLM.
3. Contexto mínimo: cada agente recebe só o que precisa, nunca o banco inteiro.
4. Toda ação de risco médio/alto exige aprovação humana explícita.
5. Simplicidade antes de escala: dois usuários, sem infraestrutura para milhões.
6. A arquitetura de hoje (Saúde/Nutrição/Treino) precisa suportar Finanças/Organização amanhã sem reescrita.

## 2. Visão de módulos

```
apps/web (Next.js)
  ├─ UI (App Router, mobile-first)
  └─ Route Handlers (API) ──────┐
                                 ▼
                     packages/agents (Coordinator, Nutrition, Fitness, Finance[stub])
                                 │
                     packages/domain (funções determinísticas)
                                 │
                     packages/ai-provider (abstração de LLM)
                                 │
                     packages/db (Postgres client, migrations)
                                 │
                     Scheduler (jobs table + worker Node)
```

Tudo roda em um único deploy (monólito modular) dentro de um único container de app + um container Postgres + proxy reverso. Reavaliar separação de processos apenas se o worker de agentes/scheduler precisar de recursos ou ciclo de deploy diferentes do app web — não antecipar essa divisão agora (seção 47 do prompt mestre).

## 3. Camada de agentes

### 3.1 Contrato de invocação

**Correção (ADR 011, ADR 012, ADR 021):** o Coordinator é o único ponto de entrada desde a Fase 1 (mínimo) até a Fase 5 (avançado) — nenhum especialista é acessível diretamente pelo usuário em nenhuma fase. `AgentTask` é um contrato **transiente** (nunca uma tabela — ver `agent_runs` para o registro persistido), e `riskLevel` deixa de ser autoritativo quando enviado pelo agente:

```ts
type AgentTask = {
  taskId: string
  requestId: string
  agent: "nutrition" | "fitness" | "finance"
  goal: string
  context: Record<string, unknown>   // apenas dados relevantes, já filtrados
  inputSchema: JSONSchema
  outputSchema: JSONSchema
  suggestedRiskLevel: "low" | "medium" | "high"   // apenas informativo — ver Policy Engine, §3.3
  idempotencyKey: string
  timeoutMs: number
}
```

A saída é validada contra `outputSchema` antes de ser aceita pelo Coordinator — inspirado no `delegate_task` do Hermes. Agentes especializados não recebem o histórico bruto de conversa do Coordinator, apenas o `context` explícito — isolamento de contexto, não herança automática. Contrato completo (incluindo a invocação do próprio Coordinator pelo usuário) em `AGENT_CONTRACTS.md`.

### 3.2 Contexto por agente (arquivos)

Cada agente em `packages/agents/<nome>/` tem:

```
<agente>/
  SOUL.md          # identidade e tom (o que o agente é, nunca muda em runtime)
  AGENTS.md        # regras operacionais, limites, "quando usar / quando não usar"
  capabilities.json # o que pode e não pode acessar/executar (lido pelo enforcement, não só documentado)
  skills.json      # allowlist de skills daquele domínio
```

Contexto compartilhado do household (não específico de um agente) fica em `packages/agents/shared/HOUSEHOLD.md` — este é o preenchimento da lacuna identificada na pesquisa: nem Hermes nem OpenClaw têm um tier de contexto verdadeiramente global entre agentes; no LifeOS ele é explícito e é o Coordinator quem o injeta nas chamadas a especialistas quando relevante.

`USER.md`/`MEMORY.md` não são arquivos estáticos no LifeOS — são **views geradas a partir do Postgres** (profiles, goals, agent_memories) no momento da invocação, montadas como um snapshot congelado para aquela sessão/task (padrão Hermes de estabilidade de cache e previsibilidade), não editáveis diretamente por texto solto.

### 3.3 Capabilities / permissões

`capabilities.json` por agente, aplicado por um middleware de enforcement (não apenas convenção):

```json
{
  "agent": "nutrition",
  "can": ["read:profiles", "read:preferences", "read:market_prices", "write:meal_plans", "write:shopping_lists"],
  "cannot": ["read:financial_accounts", "write:system_config", "execute:external_actions"]
}
```

O Coordinator tem seu próprio `capabilities.json` — explicitamente não tem acesso irrestrito só por coordenar. Mesmo após a Fase 7, o Coordinator nunca lê `transactions`/`accounts` detalhados — apenas agregados calculados pelo Finance Agent (ver `SECURITY_MODEL.md §4`).

### 3.3 Policy Engine (ADR 012)

O valor de `suggestedRiskLevel` enviado por um agente é apenas um sinal de UX. O risco autoritativo é recalculado no servidor por um Policy Engine determinístico (tipo de ação, escopo, reversibilidade, regras fixas) antes de qualquer capability check — nunca o inverso. Contrato completo em `AGENT_CONTRACTS.md §6`.

## 4. Camada de domínio (determinística)

Funções puras e testadas, sem LLM, em `packages/domain/`:

- `cookingYield(rawGrams, food): { cookedGrams, yieldFactor }`
- `shoppingQuantity(neededGrams, packageSizes[]): { buyQuantity, packaging, waste }`
- `weeklyCostOptimizer(mealPlan, marketPrices[]): { totalCost, breakdown, substitutions }`
- `portionSplit(totalPreparedGrams, people: {id, targetGrams}[]): allocations`
- `progressionEngine(workoutHistory): nextWorkoutParams`
- `goalProgress(goal): { percent, trend }`
- (futuro) `budgetProjection`, `debtPayoffPlan`, `installmentSchedule`

Cada função é unit-testada isoladamente (seção 43) e é a única fonte de verdade para o número — o LLM cita o resultado, nunca o recalcula.

## 5. Camada de IA (AI Provider)

Abstração única, sem chamadas diretas a SDKs espalhadas pelo código:

```ts
interface AIProvider {
  complete(input: { systemPrompt: string; messages: Message[]; tools?: ToolSpec[] }): Promise<AIResponse>
}
```

Implementações concretas (`AnthropicProvider`, futuramente `OpenAIProvider`, `LocalProvider`) ficam em `packages/ai-provider/`; agentes e skills nunca importam um SDK de modelo diretamente. Seleção de modelo por tarefa (modelo menor para tarefas simples, maior para decisões complexas) é config, não hardcode.

## 6. Skills

Formato `SKILL.md` (frontmatter YAML + corpo):

```yaml
---
name: cooking-yields
description: Calcula conversão cru/cozido e rendimento de alimentos
domain: nutrition
inputs: [food_id, raw_grams]
outputs: [cooked_grams, yield_factor]
tools_required: [domain.cookingYield]
permissions: [read:foods]
when_to_use: "Sempre que for necessário converter quantidade crua em preparada"
when_not_to_use: "Não usar para estimar calorias — usar skill de nutrição específica"
---
```

Descoberta: cada agente carrega apenas as skills listadas em seu `skills.json` (allowlist explícita, padrão OpenClaw) — não há descoberta automática global. Sem Curator autônomo na v1; versionamento manual via git.

## 7. Memória

Schema (corrigido pela consolidação — ver ADR 013):

```
agent_memories (id, household_id, person_id nullable, type, content_json,
                confidence, source_type, source_ref, created_at, superseded_by)
agent_decisions (id, household_id, agent, proposal_hash, context_json, recommendation_json,
                 risk_level, status, approved_by, approved_at, expires_at, created_at)
```

`type` ∈ {profile, preference, historical, goal, decision, context, learned_pattern}. Mudanças em `profile`/`goal` de impacto relevante passam por um fluxo de confirmação (proposta versionada em `agent_decisions`, ADR 013) antes de gravar — nunca write-through direto do LLM.

**Precedência entre memórias conflitantes** (antes não definida, corrigida na consolidação): correção humana confirmada sempre vence sobre inferência do agente, independentemente de data; entre dois fatos da mesma origem, o mais recente vence (`superseded_by`); `learned_pattern` nunca sobrescreve automaticamente um fato `profile`/`goal` confirmado — só coexiste como observação separada até confirmação humana explícita.

Montagem de contexto para uma invocação de agente: query filtrada por `household_id` + `type` relevante ao domínio do agente + limite de tamanho — nunca `SELECT *` de tudo. Este é o "snapshot congelado" por execução: montado uma vez no início, não recarregado a meio da execução.

## 8. Dados (schema completo)

Ver `DATA_MODEL_REVIEW.md §2` para o modelo canônico completo (corrigido na consolidação). Chaves de particionamento: tudo pendura de `household_id`; `profiles`/`measurements`/`workout_logs` também de `person_id`. **Correção (ADR 022, supersede D009):** as tabelas de finanças **não** existem desde a Fase 1 — só um flag `households.module_finance_enabled` e um registro reservado em `agents`/`skills`/`capabilities.json`; o schema completo (`accounts`, `transactions`, etc.) só é criado na Fase 7.

## 9. Scheduler / automações

**Correção (ADR 018, ADR 021):** o scheduler não usa mais o nome `agent_tasks` (reservado para o contrato transiente de invocação de agente, ver §3.1) — usa duas tabelas dedicadas:

```
scheduled_jobs (id, household_id, kind, cron_expr, timezone, next_run_at, status,
                attempts, max_attempts, lease_expires_at, locked_by, idempotency_key)
job_runs (id, scheduled_job_id, started_at, finished_at, status, result_summary, request_id)
```

Worker Node reivindica um job com uma única query atômica (`UPDATE scheduled_jobs SET status='running', lease_expires_at=..., locked_by=$worker WHERE status='pending' AND (lease_expires_at IS NULL OR lease_expires_at < now()) RETURNING *`) — nunca "ler e depois marcar". Um reaper periódico devolve a `pending` jobs cujo lease expirou (worker morto/restart). Backoff exponencial com jitter até `max_attempts`; ao esgotar, `status = dead_letter` + evento de auditoria. Cada disparo persiste em Postgres (não SQLite/JSON local), sobrevivendo a restarts sem depender de um processo único sempre ativo (lacuna que evitamos versus o cron do OpenClaw). Cenários completos de concorrência/crash em `ARCHITECTURE_REVIEW.md §7`.

Jobs de risco médio/alto (Weekly Planning, Shopping Preparation) **preparam e aguardam aprovação** em vez de aplicar mudanças diretamente — o `job_run` dispara um `AgentTask` cujo resultado vira uma proposta em `agent_decisions` (ADR 013), nunca é aplicado direto.

## 10. Segurança — enforcement técnico

Modelo completo em `SECURITY_MODEL.md`. Resumo:

- Middleware de autorização por `household_id` em toda query **mais** Row-Level Security do Postgres como segunda camada independente (ADR 014) — nunca só filtro de aplicação.
- Middleware de capabilities por agente antes de qualquer tool call, deny-by-default.
- Policy Engine determinando risco no servidor (ADR 012), nunca aceito do agente.
- Sanitização/marcação de conteúdo externo (resultado de busca de preço, texto de skill) como dado não confiável — nunca concatenado ao system prompt como instrução.
- Secrets via variáveis de ambiente/secret manager, nunca no repo.
- Logs estruturados sem PII sensível (sem senha, sem dado de saúde bruto em log de aplicação).

## 11. Deploy

Docker Compose: `web` (Next.js), `db` (Postgres), `worker` (scheduler), atrás de Caddy (HTTPS automático) ou Nginx + certbot, em VPS Oracle Cloud. Backups automáticos do Postgres (pg_dump agendado + retenção).

## 12. O que fica explicitamente fora da v1

- Finance Agent e schema financeiro completo — apenas flag/registro reservado até a Fase 7 (ADR 022).
- Sandboxing por container por sessão/agente (isolamento via `household_id`/capabilities + RLS a nível de aplicação/banco é suficiente para dois usuários confiáveis).
- Vector search / pgvector (só entra se/quando o volume de receitas/histórico justificar busca semântica).
- Multi-canal (WhatsApp, Telegram etc.) — um único app web.
- Visibilidade privada granular entre membros do household (ADR 020) — reservado no schema, não implementado.
