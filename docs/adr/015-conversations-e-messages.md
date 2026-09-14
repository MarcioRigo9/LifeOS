# ADR 015 — Conversas persistidas como `conversations`/`messages`

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
A Fase 0 citava uma tabela `agent_sessions` sem granularidade de mensagem e sem propósito definido — insuficiente para reconstruir uma conversa, auditar o que foi dito, ou depurar uma decisão de um agente após um restart.

## Decisão
`agent_sessions` é removida do schema canônico. Em seu lugar: `conversations` (uma sessão de interação, com `household_id`, `started_at`, `ended_at`) e `messages` (cada turno: `conversation_id`, `person_id` nullable quando é o sistema/agente, `role` [`user|agent|system|tool`], `agent_id` nullable, `content`, `created_at`). Toda invocação do Coordinator persiste a mensagem do usuário **antes** de processar, e a resposta como nova mensagem — nunca processa sem persistir o turno primeiro.

## Alternativas consideradas
- Manter `agent_sessions` genérica sem tabela de mensagens — rejeitada, insuficiente para auditoria (ver `ARCHITECTURE_REVIEW.md` C3).

## Consequências
- `agent_runs` (execuções de agente) pode referenciar `conversation_id` (quando originado de chat ao vivo) ou `job_run_id` (quando originado do scheduler) — nunca os dois ausentes ao mesmo tempo sem contexto de origem.
