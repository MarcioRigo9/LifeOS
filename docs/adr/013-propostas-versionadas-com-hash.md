# ADR 013 — Aprovações vinculadas a uma proposta versionada e com expiração

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
O modelo original de `agent_decisions` tinha apenas um campo solto `user_decision: approved/rejected`, sem vínculo a uma versão específica do conteúdo proposto — abrindo brecha para replay (reaproveitar uma aprovação antiga) ou bait-and-switch (aprovar a proposta X e o sistema executar uma versão Y diferente gerada depois).

## Decisão
Toda proposta de risco MEDIUM/HIGH (`DecisionProposal`) carrega um `proposalHash` imutável, `status` (`pending|approved|rejected|expired`) e `expiresAt`. Uma `Approval` referencia `decisionId` **e** `proposalHash`; se o hash não bater com o vigente, a aprovação é rejeitada. Propostas expiradas não podem mais ser aprovadas — o agente precisa gerar uma nova proposta com dados atualizados. A execução da ação aprovada usa `decisionId` como chave de idempotência (uma aprovação não pode disparar a ação duas vezes).

## Alternativas consideradas
- Campo solto `user_decision` sem hash/expiração — rejeitada (vulnerabilidade identificada na revisão de segurança).

## Consequências
- `agent_decisions` ganha as colunas `proposal_hash`, `status`, `expires_at` desde a primeira migration (Fase 1).
- Toda aprovação/rejeição é auditada (`audit_log`) com o hash exato aprovado.
