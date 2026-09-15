# ADR 023 — ActionEnvelope, máquina de estados e execução idempotente

**Status:** Aceito (closure pass pré-implementação)
**Estende:** ADR 013 (propostas versionadas com hash) — ADR 013 permanece válido para o princípio de vínculo hash+expiração; este ADR fecha o formato exato do que é hasheado e como a execução de fato acontece.

## Contexto

O fechamento pré-implementação identificou que, apesar de ADR 013 já vincular aprovações a um hash de proposta, o conteúdo hasheado (`recommendation: unknown`) não era estruturado o bastante para o servidor executar a ação sem reinterpretar linguagem natural — o próprio objetivo do human-in-the-loop. Faltava também uma máquina de estados fechada para `agent_decisions` (só existiam `pending/approved/rejected/expired`, sem representar a execução em si), uma definição precisa de como a execução é idempotente, e um comportamento explícito para o cenário `APPROVED → EXECUTING → processo morre`.

## Decisão

1. **`ActionEnvelope`** é o formato canônico do que uma proposta representa: `actionType` (identificador de ação registrada, allowlist), `actionPayload` (parâmetros estruturados), `targetEntityIds`, `expectedVersions` (concorrência otimista, ADR 017 — revalidado no momento da execução, não só na criação), `scope` (`householdId`, `entityCount`, `reversible`, `financialImpactCents`).
2. `DecisionProposal.action: ActionEnvelope` substitui `recommendation: unknown`.
3. **`proposalHash`** = SHA-256 sobre serialização JSON canônica (chaves ordenadas, sem espaços, equivalente a JCS/RFC 8785) de `actionType, actionPayload, targetEntityIds, expectedVersions, scope, riskLevel`. Calculado uma única vez na criação; propostas são imutáveis — uma proposta diferente é sempre uma nova proposta com novo `decisionId`.
4. **Máquina de estados:** `PENDING → APPROVED → EXECUTING → EXECUTED|FAILED`, com `REJECTED`/`EXPIRED` como saídas terminais a partir de `PENDING` ou `APPROVED`. Nenhuma outra transição é válida — em particular, `FAILED` é terminal (sem retry automático da mesma decisão; uma nova proposta é gerada se necessário).
5. **Execução idempotente:** `decisionId` é a chave de idempotência. Claim atômico `APPROVED → EXECUTING` via `UPDATE ... WHERE status='APPROVED' RETURNING` (mesmo padrão do scheduler, ADR 018). Uma tabela separada `decision_executions` (chave única em `decision_id`) registra o resultado, gravada **na mesma transação** que a ação de negócio.
6. **Recuperação de crash:** um reaper encontra `EXECUTING` com lease expirado e decide deterministicamente a partir da existência (ou não) de uma linha em `decision_executions` para aquele `decisionId` — nunca precisa "verificar o efeito" heuristicamente no domínio, porque a atomicidade da transação do item 5 garante que só existem dois estados possíveis: nada aconteceu, ou tudo aconteceu.

## Alternativas consideradas

- Manter a proposta como texto/recomendação livre interpretada pelo executor no momento de aplicar — rejeitada: reintroduz exatamente o problema que o human-in-the-loop existe para evitar (a IA "decidindo" o que fazer sem controle determinístico).
- Permitir `FAILED → EXECUTING` (retry automático) — rejeitada: uma falha pode ser um conflito de `expectedVersions` (dados mudaram desde a aprovação); reexecutar cegamente arrisca aplicar uma ação sobre premissas inválidas. Gerar nova proposta força uma nova checagem de risco/versões.
- Guardar o resultado de execução dentro de `agent_decisions` em vez de uma tabela separada — rejeitada: `decision_executions` com `decision_id` único dá uma segunda camada de proteção contra execução duplicada (constraint de banco), independente do claim atômico por status.

## Consequências

- `agent_decisions` ganha `action_envelope_json`, `execution_started_at`, `execution_lease_expires_at`, `attempts`, e o enum de status expandido.
- `decision_executions` é criada como entidade nova (ver `DATA_MODEL_REVIEW.md §2.5`).
- `AGENT_CONTRACTS.md §8` é a referência normativa completa; `ARCHITECTURE.md §3.4` e `SECURITY_MODEL.md §6` resumem sem contradizer.
