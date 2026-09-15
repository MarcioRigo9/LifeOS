# ARCHITECTURE CONSOLIDATION RESULT — LifeOS (Fase 0.5, final)

> Relatório de fechamento da consolidação arquitetural. Nenhum código foi criado nesta etapa. **Atualizado pelo closure pass pré-implementação** (seção "Closure pass" abaixo) — a consolidação original (linhas 5-53) é preservada como registro; o closure pass fecha o que ainda restava ambíguo depois dela.

## Resolved (contradições/lacunas resolvidas)

| # | Problema | Resolução |
|---|---|---|
| C1 | Roadmap colocava Coordinator só na Fase 5, mas Fase 3 já exigia especialista respondendo direto ao usuário | ADR 011 — Coordinator mínimo desde a Fase 1, avançado na Fase 5 |
| C2 | `riskLevel` sem dono, potencialmente autoatribuído pelo agente | ADR 012 — Policy Engine no servidor é a autoridade exclusiva |
| C3 | Nenhuma tabela de conversa/mensagem; `agent_sessions` sem granularidade | ADR 015 — `conversations`/`messages` |
| C4 | Isolamento de household só por `WHERE` de aplicação | ADR 014 — RLS como segunda camada, role sem `BYPASSRLS` |
| C5 | `progression` proposta como tabela própria, duas fontes de verdade | Corrigido em `DATA_MODEL_REVIEW.md §2.4` — sempre derivada de `workout_logs` |
| — | Aprovação humana sem vínculo a proposta versionada | ADR 013 — `proposal_hash` + expiração |
| — | Dinheiro sem convenção de tipo | ADR 016 — inteiro em minor units |
| — | Concorrência não tratada em planos/metas editáveis | ADR 017 — `version` otimista |
| — | Scheduler com claim não-atômico, sem retry/dead-letter, nome ambíguo (`agent_tasks`) | ADR 018 + ADR 021 — `scheduled_jobs`/`job_runs` com claim atômico, lease, backoff, dead-letter |
| — | Sem baseline de privacidade/LGPD | ADR 019 — tabela `consents` |
| — | Visibilidade de dados entre Márcio e Brenda indefinida | ADR 020 — default `household` (total), extensível no futuro |
| — | `market_prices`/`cooking_yields` sem colunas definidas; `weeklyCostOptimizer` sem especificação formal | Fechado em `DATA_MODEL_REVIEW.md §2.3` (função objetivo + restrições hard/soft) |
| — | Contrato de AI Provider magro (sem retry/timeout/custo/tracing) | Fechado em `AGENT_CONTRACTS.md §13` |
| — | `households` sem timezone/locale/currency/module_finance_enabled | Adicionado em `PHASE_1_SPEC.md §5` e `DATA_MODEL_REVIEW.md §2.1` |
| — | Tabelas financeiras descritas como existentes desde a Fase 1 | ADR 022 (supersede D009) — reservado só como flag/registro; schema completo só na Fase 7 |

## Superseded

- **D009** ("tabelas de finanças existem desde a Fase 1") → **SUPERSEDED BY D022**. Marcado em `DECISIONS.md`, texto original preservado com a anotação.

Nenhuma outra decisão de D001-D010 foi superada — D001, D002, D003, D004, D005, D006, D007, D008, D010 permanecem válidas e foram reafirmadas durante a revisão (`ARCHITECTURE_REVIEW.md §2`).

## New ADRs

`docs/adr/011` a `docs/adr/023`:

011 Coordinator desde Fase 1 · 012 Policy Engine · 013 Propostas versionadas com hash · 014 PostgreSQL RLS · 015 Conversations/Messages · 016 Dinheiro em minor units · 017 Concorrência otimista · 018 Scheduler durável · 019 Privacidade/LGPD baseline · 020 Visibilidade household · 021 AgentTask vs ScheduledJob · 022 Finance schema somente Fase 7 (consolidação original) · **023 ActionEnvelope e execução idempotente (closure pass)**.

## Open Decisions

Nenhuma decisão estrutural relevante permanece em aberto. Os itens que exigiam uma escolha (visibilidade entre membros, convenção monetária, dono do risco, modelo de aprovação, nome/separação do scheduler, escopo do Finance na Fase 1) foram todos fechados como ADR nesta consolidação.

Itens que **não são decisões em aberto**, mas trabalho de implementação natural de fases futuras (não bloqueiam Fase 1): colunas finais de `exercises`/`workout_*` (Fase 4), UI de aprovação humana (Fase 1 entrega o backend do fluxo; a UI evolui com o produto), tabelas financeiras completas (Fase 7).

## Phase 1 Blockers

Nenhum. Todas as 8 condições listadas em `ARCHITECTURE_REVIEW.md §9` (GO WITH CONDITIONS) foram incorporadas a `PHASE_1_SPEC.md` como escopo obrigatório e a `IMPLEMENTATION_RULES.md` como regras permanentes.

## Phase 1 Ready

## YES

A arquitetura tem agora uma única interpretação possível para household, profiles, Coordinator, specialists, AgentTask, scheduler, capabilities, Policy Engine, risk, approval, memory, skills, RLS, conversations, messages, agent runs, deterministic domain, market prices, cooking yields, money, audit, privacy e Finance future — consolidada em `ARCHITECTURE.md`, `DATA_MODEL_REVIEW.md`, `SECURITY_MODEL.md`, `AGENT_CONTRACTS.md`, `PHASE_1_SPEC.md`, `IMPLEMENTATION_RULES.md` e nos 22 ADRs de `docs/adr/`.

**A implementação da Fase 1 não começa, no entanto, até aprovação humana explícita** — nenhum código, migration, Docker ou dependência foi criado nesta etapa, conforme exigido.

---

## Closure pass — fechamento pré-implementação

Rodada adicional de revisão cruzada de todos os 12 documentos normativos + 12 ADRs existentes, para eliminar ambiguidades que sobreviveram à consolidação original.

### O que foi corrigido

| Item | Onde estava | Correção |
|---|---|---|
| Approval/Execution fechado como dado estruturado | `AGENT_CONTRACTS.md §8` era genérico (`recommendation: unknown`, 4 estados) | `ActionEnvelope` formal, hash sobre representação canônica definida, máquina de estados de 7 estados com transições explícitas, execução idempotente, recuperação de crash determinística (ADR 023) |
| Contrato de AI Provider divergente entre documentos | `ARCHITECTURE.md §5` mostrava uma interface mais simples que `AGENT_CONTRACTS.md §13` | `AGENT_CONTRACTS.md §13` declarado normativo; `ARCHITECTURE.md §5` reescrito como resumo consistente |
| `ROADMAP.md` Fase 6 ainda citava `agent_tasks` como tabela do scheduler | `ROADMAP.md` | Corrigido para `scheduled_jobs`/`job_runs` |
| D020 (visibilidade) ainda descrita como "questão em aberto" em `SECURITY_MODEL.md` e `ARCHITECTURE_REVIEW.md` | Dois documentos | Ambos fechados: `visibility = household` (v1), enum `household\|private` reservado para o futuro, sem ambiguidade restante |
| `profiles.person_id` (FK circular) | `DATA_MODEL_REVIEW.md §2.1` deixava como "ajuste a fazer na migration real" | Fechado definitivamente: `profiles.id` é a identidade; `profiles.user_id` nullable; toda outra tabela usa `person_id → profiles.id`, nunca `profiles.person_id` |
| `households.consent_recorded_at` sobrevivendo ao lado da tabela `consents` | `DATA_MODEL_REVIEW.md §2.1` | Coluna solta removida; `consents` é a única fonte |
| Regra de `household_id` ampla demais ("toda tabela precisa") | `DATA_MODEL_REVIEW.md §1` | Refinada em §1.1: household-scoped vs. global/system-scoped (`agents`, `skills`, `foods`, `cooking_yields`, `exercises` são globais, sem RLS de household) |
| Escopo de LGPD da Fase 1 implícito | `PHASE_1_SPEC.md` mencionava `consents` mas não fechava exportação/exclusão/retenção como escopo obrigatório | Nova seção 12 dedicada, com tabela explícita do que está dentro/fora e por quê |
| Capabilities matrix do Coordinator citava `agent_tasks` como algo que ele escreve | `SECURITY_MODEL.md §4` | Corrigido para `messages`/`agent_decisions`/`agent_runs` |
| Referências à decisão de risco em `DECISIONS.md` D006/D007 sem apontar para o refinamento | `DECISIONS.md` | Anotadas com "Refinado por D012/D018" |

### O que foi decidido (novo nesta rodada)

- **D023/ADR 023** — `ActionEnvelope`, máquina de estados de 7 estados, execução idempotente por `decisionId` com `decision_executions` (tabela nova, chave única), recuperação de crash determinística.
- Classificação explícita household-scoped vs. global/system-scoped para toda tabela do schema (`DATA_MODEL_REVIEW.md §1.1`).
- Escopo fechado de LGPD/privacidade para a Fase 1 (`PHASE_1_SPEC.md §12`): `consents`, exportação mínima, exclusão documentada, retenção documentada, auditoria — todos dentro do escopo, nenhum adiado.

### O que foi superseded

- Texto original de D019 em `ARCHITECTURE_REVIEW.md` (campo solto `consent_recorded_at`) — marcado inline como refinado pela versão final (tabela `consents`).
- Texto original de D020 em `ARCHITECTURE_REVIEW.md` ("pendente de decisão do usuário") — marcado inline como fechado.
- Nenhuma decisão D001-D022 foi revertida nesta rodada — apenas D006/D007 ganharam anotação de refinamento (não mudaram de sentido).

### Conflitos restantes (busca global)

Nenhum. Ver varredura de termos obsoletos na resposta final desta tarefa — todas as ocorrências restantes de `riskLevel`, `agent_sessions`, `agent_tasks`, `progression`, `profiles.person_id`, "Coordinator... Fase 5" e `consent_recorded_at` em todo o repositório são citações históricas explicitamente marcadas (dentro de ADRs "Contexto", do próprio `ARCHITECTURE_REVIEW.md`, ou de `DECISIONS.md` com anotação de refinamento) — nenhuma aparece como afirmação normativa vigente.

### Decisões arquiteturais em aberto

**NENHUMA.**

### Matriz de consistência

| Conceito | Documento normativo | Estado |
|---|---|---|
| Coordinator (mínimo F1 / avançado F5) | `AGENT_CONTRACTS.md §1-2` | fechado |
| Risk Policy | `AGENT_CONTRACTS.md §6` / `SECURITY_MODEL.md §5` | fechado |
| Approval | `AGENT_CONTRACTS.md §8.2` | fechado |
| Proposal Hash | `AGENT_CONTRACTS.md §8.3` | fechado |
| Action Envelope | `AGENT_CONTRACTS.md §8.1` | fechado |
| Decision State Machine | `AGENT_CONTRACTS.md §8.4` | fechado |
| Execution / Idempotência / Crash Recovery | `AGENT_CONTRACTS.md §8.5-8.6` | fechado |
| RLS / household vs. global scoping | `SECURITY_MODEL.md §3` / `DATA_MODEL_REVIEW.md §1.1` | fechado |
| Memory | `AGENT_CONTRACTS.md §7` / `ARCHITECTURE.md §7` | fechado |
| Scheduler (`scheduled_jobs`/`job_runs`) | `AGENT_CONTRACTS.md §11` | fechado |
| AI Provider | `AGENT_CONTRACTS.md §13` | fechado |
| Profiles | `DATA_MODEL_REVIEW.md §2.1` | fechado |
| Money | `DATA_MODEL_REVIEW.md §1` (ADR 016) | fechado |
| Visibility (D020) | `DECISIONS.md` / ADR 020 | fechado |
| Privacy / LGPD | `SECURITY_MODEL.md §12` / `PHASE_1_SPEC.md §12` | fechado |
| Finance | `ROADMAP.md` / `DECISIONS.md` D022 | reservado para F7 (por design, não pendência) |

### Status final

```text
READY FOR PHASE 1
```
