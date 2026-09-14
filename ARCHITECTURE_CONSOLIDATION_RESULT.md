# ARCHITECTURE CONSOLIDATION RESULT — LifeOS (Fase 0.5, final)

> Relatório de fechamento da consolidação arquitetural. Nenhum código foi criado nesta etapa.

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

`docs/adr/011` a `docs/adr/022` — todos criados nesta consolidação:

011 Coordinator desde Fase 1 · 012 Policy Engine · 013 Propostas versionadas com hash · 014 PostgreSQL RLS · 015 Conversations/Messages · 016 Dinheiro em minor units · 017 Concorrência otimista · 018 Scheduler durável · 019 Privacidade/LGPD baseline · 020 Visibilidade household · 021 AgentTask vs ScheduledJob · 022 Finance schema somente Fase 7.

## Open Decisions

Nenhuma decisão estrutural relevante permanece em aberto. Os itens que exigiam uma escolha (visibilidade entre membros, convenção monetária, dono do risco, modelo de aprovação, nome/separação do scheduler, escopo do Finance na Fase 1) foram todos fechados como ADR nesta consolidação.

Itens que **não são decisões em aberto**, mas trabalho de implementação natural de fases futuras (não bloqueiam Fase 1): colunas finais de `exercises`/`workout_*` (Fase 4), UI de aprovação humana (Fase 1 entrega o backend do fluxo; a UI evolui com o produto), tabelas financeiras completas (Fase 7).

## Phase 1 Blockers

Nenhum. Todas as 8 condições listadas em `ARCHITECTURE_REVIEW.md §9` (GO WITH CONDITIONS) foram incorporadas a `PHASE_1_SPEC.md` como escopo obrigatório e a `IMPLEMENTATION_RULES.md` como regras permanentes.

## Phase 1 Ready

## YES

A arquitetura tem agora uma única interpretação possível para household, profiles, Coordinator, specialists, AgentTask, scheduler, capabilities, Policy Engine, risk, approval, memory, skills, RLS, conversations, messages, agent runs, deterministic domain, market prices, cooking yields, money, audit, privacy e Finance future — consolidada em `ARCHITECTURE.md`, `DATA_MODEL_REVIEW.md`, `SECURITY_MODEL.md`, `AGENT_CONTRACTS.md`, `PHASE_1_SPEC.md`, `IMPLEMENTATION_RULES.md` e nos 22 ADRs de `docs/adr/`.

**A implementação da Fase 1 não começa, no entanto, até aprovação humana explícita** — nenhum código, migration, Docker ou dependência foi criado nesta etapa, conforme exigido.
