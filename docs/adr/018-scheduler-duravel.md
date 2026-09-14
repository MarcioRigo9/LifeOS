# ADR 018 — Scheduler durável com claim atômico, lease, retry e dead-letter

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
O modelo original descrevia o scheduler de forma vaga ("marca `pending_slot_at` antes de disparar"), sem claim atômico, sem mecanismo de recuperação de worker morto, sem política de retry/backoff, e usando o mesmo nome `agent_tasks` tanto para jobs agendados quanto para o conceito de tarefa delegada a um agente — uma sobreposição de nomes que gera ambiguidade (ver ADR 021).

## Decisão
O scheduler usa duas tabelas dedicadas, distintas de qualquer conceito de "tarefa de agente":
- `scheduled_jobs`: definição do job (`kind`, `cron_expr`, `timezone`, `next_run_at`, `status`, `attempts`, `max_attempts`, `lease_expires_at`, `locked_by`, `idempotency_key`).
- `job_runs`: uma linha por disparo/tentativa (`scheduled_job_id`, `started_at`, `finished_at`, `status`, `result_summary`, `request_id`).

Claim de um job é uma única query atômica (`UPDATE scheduled_jobs SET status='running', lease_expires_at=now()+interval, locked_by=$worker WHERE status='pending' AND (lease_expires_at IS NULL OR lease_expires_at < now()) RETURNING *`), nunca "ler e depois marcar" em dois passos. Um "reaper" periódico devolve a `pending` jobs cujo `lease_expires_at` expirou sem conclusão (worker morto/VPS reiniciada). Retry usa backoff exponencial com jitter até `max_attempts`; ao esgotar, status vira `dead_letter` e gera evento de auditoria — nunca fica retentando para sempre nem falha silenciosamente. Timezone do job é explícito (herdado de `households.timezone`), e uma janela de catch-up configurável evita tanto perder execuções during downtime quanto rodar múltiplas vezes para múltiplos disparos perdidos.

## Alternativas consideradas
- Cron do SO ou scheduler dependente de processo único sempre ativo — rejeitado (lacuna já identificada no OpenClaw na Fase 0; não sobreviveria a restart do container sem duplicar/perder jobs).
- Fila externa dedicada (ex. mensageria) — rejeitada como overengineering para dois usuários.

## Consequências
- Cada disparo de `scheduled_jobs` que envolve IA cria um ou mais `agent_runs` (via Coordinator), mantendo a separação entre "o scheduler decidiu que é hora" e "o agente executou algo".
