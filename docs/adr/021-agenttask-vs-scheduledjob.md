# ADR 021 — Separação entre `AgentTask` (contrato transiente) e `ScheduledJob`/`JobRun` (entidades persistidas)

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
O nome `agent_tasks` era usado simultaneamente para (a) o conceito de contrato de invocação de um agente especializado pelo Coordinator e (b) a tabela de jobs agendados do scheduler — uma sobreposição de nomes que gera ambiguidade sobre o que persiste, o que é transiente, e como um se relaciona com o outro.

## Decisão
Dois conceitos distintos, nomeados sem sobreposição:
- **`AgentTask`**: contrato de invocação **transiente** (não é uma tabela), trocado em memória entre Coordinator e especialista dentro de uma única execução. Seu resultado é registrado em `agent_runs` (tabela), não em uma tabela `agent_tasks`.
- **`scheduled_jobs`/`job_runs`** (ADR 018): entidades **persistidas** do scheduler, que existem independentemente de qualquer conversa em andamento, e cujo disparo eventualmente cria um `AgentTask` transiente processado pelo Coordinator.

Fluxo completo: `scheduled_jobs → worker (claim atômico + lease) → job_runs → AgentTask (transiente) → Coordinator → agent_runs`.

## Alternativas consideradas
- Manter um único conceito `agent_tasks` cobrindo os dois casos — rejeitado, é exatamente a ambiguidade que motivou este ADR.

## Consequências
- `AGENT_CONTRACTS.md` e `DATA_MODEL_REVIEW.md` usam terminologia consistente: nunca chamar a tabela do scheduler de `agent_tasks`.
