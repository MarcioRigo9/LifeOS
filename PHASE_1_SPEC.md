# PHASE_1_SPEC.md — LifeOS Fase 1 (Foundation)

> Contrato de implementação da Fase 1, produzido na consolidação de Fase 0.5 e fechado no closure pass pré-implementação. Referencia `ARCHITECTURE.md`, `DATA_MODEL_REVIEW.md`, `SECURITY_MODEL.md`, `AGENT_CONTRACTS.md` e os ADRs 011-023 em `docs/adr/`. Este documento é normativo: qualquer divergência durante a implementação deve ser resolvida a favor deste contrato ou tratada como um novo ADR, nunca implementada silenciosamente de outro jeito.

## 1. Objetivo

Entregar a fundação sobre a qual todas as fases seguintes (Health, Nutrition, Fitness, Coordinator avançado, Automation, Finance Ready) são construídas: autenticação, household/perfis, Coordinator mínimo, Policy Engine, capabilities, memória, skills, AI Provider, scheduler (schema, sem worker completo) e auditoria — todos com as correções de segurança/concorrência definidas na Fase 0.5, para que nenhuma fase seguinte precise retrabalhar schema ou contrato.

## 2. Escopo

- Setup do monorepo (Next.js + TypeScript, App Router), Docker Compose, Postgres.
- Autenticação (NextAuth/Auth.js ou equivalente), sessões em banco, rate limiting de login.
- `households` (com `timezone`, `locale`, `currency`, `module_finance_enabled`), `users`, `household_members` (com `removed_at`), `profiles`.
- `consents` (ADR 019).
- `goals`, `habits`, `habit_goal_links` — CRUD básico, com `version` (ADR 017) em `goals`.
- RLS habilitada em toda tabela com `household_id`, com role de aplicação sem `BYPASSRLS` (ADR 014).
- `conversations`, `messages` (ADR 015).
- `agent_memories`, `agent_decisions` (com `action_envelope_json`/`proposal_hash`/máquina de estados completa, ADR 013/023), `decision_executions` (ADR 023).
- `scheduled_jobs`, `job_runs` (schema completo, ADR 018/021) — **sem** o worker de polling completo ainda (isso é Fase 6); o schema nasce certo para não migrar depois.
- `agents`, `skills` (tabelas de registro/lookup, **globais/system-scoped**, sem `household_id`/RLS — ver `DATA_MODEL_REVIEW.md §1.1`) + loader de `SKILL.md` com allowlist por agente.
- `capabilities.json` por agente + middleware de enforcement (deny-by-default).
- Policy Engine mínimo (regras fixas por tipo de ação, ADR 012).
- Coordinator mínimo (ADR 011): `CoordinatorInvocation` → contexto mínimo → AI Provider → validação de saída → capability check → Policy Engine → execução (LOW) ou proposta (MEDIUM/HIGH) → resposta.
- AI Provider: contrato expandido (retry, timeout, custo, tracing, structured output) + implementação Anthropic.
- `audit_log` funcionando desde o primeiro evento de autenticação.
- Reserva do módulo Finance: `households.module_finance_enabled=false` + registro inativo em `agents`/`skills` (ADR 022) — **sem** tabelas financeiras.

## 3. Fora do escopo (explicitamente adiado)

- Nutrition Agent, Fitness Agent com lógica real de domínio (Fases 2-4).
- Coordinator avançado (roteamento cross-domain, síntese, Weekly Review) — Fase 5.
- Worker de scheduler rodando de fato (Fase 6) — só o schema nasce agora.
- Qualquer tabela ou UI financeira (Fase 7).
- `market_prices`, `cooking_yields`, `recipe_items`, `exercises`, `workout_*` — chegam com Fases 3-4.
- Visibilidade privada granular entre membros do household (reservado, não implementado — ADR 020).

## 4. Arquitetura

Monólito modular conforme `ARCHITECTURE.md §2`: `apps/web` (Next.js) → `packages/agents` (Coordinator mínimo) → `packages/domain` (vazio/stub nesta fase, populado a partir da Fase 3) → `packages/ai-provider` → `packages/db`. Nenhum microserviço, fila ou container adicional além de `web`/`db` nesta fase (worker do scheduler só entra em Fase 6, mesmo container quando entrar).

## 5. Banco (tabelas desta fase)

```
households, users, household_members, profiles, consents      -- household-scoped (exceto users, ver §1.1)
goals, habits, habit_goal_links                                -- household-scoped
agents, skills                                                 -- GLOBAL/system-scoped, sem household_id/RLS
conversations, messages                                        -- household-scoped
agent_memories, agent_decisions, decision_executions            -- household-scoped
scheduled_jobs, job_runs                                       -- household-scoped
audit_log                                                       -- household-scoped
```

Convenções obrigatórias (ver `DATA_MODEL_REVIEW.md §1`/`§1.1`): `id uuid`, `created_at`/`updated_at`; tabelas household-scoped têm `household_id` + RLS; `agents`/`skills` são a exceção explícita (catálogo global, sem RLS de household — proteção é só de escrita administrativa). Dinheiro nunca aparece nesta fase mas a convenção (`bigint` centavos + `currency`) já deve estar documentada para quando `market_prices` chegar na Fase 3. `profiles` não tem coluna própria de `person_id` — `profiles.id` é a identidade da pessoa; `user_id` é nullable.

## 6. Segurança

- Autenticação: ver `SECURITY_MODEL.md §2` (Argon2id/bcrypt, sessão em banco, TTL curto + renovação, rate limiting por IP e por conta, revalidação de `household_member` ativo por request sensível).
- Autorização: filtro de aplicação por `household_id` **e** RLS (ADR 014); toda busca "by ID" inclui `household_id` na cláusula.
- Capabilities: middleware deny-by-default (`AGENT_CONTRACTS.md §4`).
- Policy Engine: regras fixas mínimas para as ações desta fase (ex.: `goal.create` → low; `goal.delete` → medium; `profile.update` campos sensíveis → medium).
- Prompt injection: toda mensagem/memória/resultado de tool é tratada como UNTRUSTED DATA na montagem do prompt (`SECURITY_MODEL.md §7`) — aplica-se mesmo sem tools de domínio reais ainda, porque o Coordinator já processa texto livre do usuário.

## 7. Agent Runtime

- `CoordinatorInvocation`/`CoordinatorResponse` (`AGENT_CONTRACTS.md §2`) implementados de ponta a ponta.
- `AgentTask` como contrato transiente (`AGENT_CONTRACTS.md §3`) — mesmo que nesta fase o único "especialista" seja um agente de teste/echo, o contrato deve ser o definitivo, não um placeholder que muda na Fase 2.
- Toda invocação persiste `messages` antes de processar (nunca processa sem persistir o turno primeiro).
- `agent_runs` registra toda execução com `request_id`, `token_usage_json`, `cost_cents`, `model_id`.

## 8. AI Provider

Contrato de `AGENT_CONTRACTS.md §13` implementado com `AnthropicProvider` como única implementação concreta desta fase; `packages/domain`/`packages/agents` nunca importam o SDK da Anthropic diretamente, apenas a interface `AIProvider`.

## 9. Memory

`MemoryStore` (`AGENT_CONTRACTS.md §7`) implementado: leitura sempre filtrada por household/tipo/limite; escrita em `profile`/`goal` sempre passando por `proposeWrite` com checagem de impacto via Policy Engine; `learned_pattern` nunca promovido automaticamente a fato confirmado.

## 10. Skills

Loader de `SKILL.md` (frontmatter + corpo) com allowlist por agente via `skills.json`; permissões declaradas no frontmatter são espelhadas e verificadas pelo mesmo middleware de capabilities em runtime (`SECURITY_MODEL.md §8`) — Markdown nunca é a fronteira de segurança real.

## 11. Policy Engine

Contrato de `AGENT_CONTRACTS.md §6` implementado com uma tabela de regras fixas versionada em código (não configuração solta), cobrindo pelo menos as ações desta fase (`goal.*`, `habit.*`, `profile.*`). Ação classificada MEDIUM/HIGH sempre gera uma `agent_decisions` pendente com `ActionEnvelope` estruturado (ADR 013/023) — nunca executa direto, e nunca com uma "recomendação" em texto livre no lugar do envelope.

## 12. Privacidade / LGPD — escopo fechado da Fase 1 (ADR 019, closure pass)

Sem ambiguidade: a Fase 1 **inclui** os mecanismos técnicos abaixo (UI pode ser mínima/administrativa — isto não é um projeto jurídico, nenhuma obrigação legal além da baseline é presumida):

| Mecanismo | Escopo na Fase 1 | Notas |
|---|---|---|
| `consents` (registro de consentimento) | **Sim** — tabela criada e escrita no cadastro do household/usuário | Schema em `DATA_MODEL_REVIEW.md §2.1` |
| Exportação de dados | **Sim, mínima** — um script/endpoint administrativo que despeja todos os dados de um household em JSON | Não precisa de UI de usuário final nesta fase |
| Exclusão | **Sim, documentada** — rotina (script/admin) que apaga/anonimiza em cascata, respeitando o que precisa permanecer em `audit_log` | A ordem de cascata (o que apaga primeiro, o que fica anonimizado vs. removido) deve estar escrita antes de implementar, não descoberta durante |
| Retenção | **Sim, documentada** — por tipo de dado (ex.: `audit_log` não expira automaticamente; `measurements` não é apagado por cascade de outra exclusão) | Não exige automação de expiração nesta fase, só a política escrita |
| Auditoria | **Sim** — `audit_log` (§13) já cobre este requisito | — |

Nada aqui é adiado para uma fase futura por decisão desta rodada de fechamento — se algo desta lista não for viável dentro da Fase 1 por um motivo técnico concreto descoberto durante a implementação, isso é uma decisão nova (pare, documente o motivo, registre em ADR, só então continue — não adie silenciosamente).

## 13. Audit

`audit_log` (append-only, sem permissão de UPDATE/DELETE para o role de aplicação) registrando no mínimo: login, logout, falha de autenticação, alteração de profile/goal, execução de agente, criação/aprovação/rejeição de decisão, tentativa de acesso cross-household (dos testes de isolamento).

## 14. Testes obrigatórios (bloqueiam o gate, não só documentação)

- **Isolamento cross-household:** dois households de teste; toda rota autenticada tentando acessar recurso do outro household falha com 404; teste específico confirmando que a RLS sozinha bloqueia a linha mesmo com o `WHERE` da aplicação propositalmente omitido; teste confirmando que `agents`/`skills` (globais) continuam legíveis por qualquer household autenticado (não devem ter RLS de household aplicada por engano).
- **Sessão de membro removido:** deixa de funcionar dentro do TTL de revalidação.
- **Capability enforcement:** um agente de teste sem uma capability específica tem a ação negada mesmo que o prompt "peça".
- **Policy Engine:** uma ação marcada `suggestedRiskLevel: low` pelo agente de teste, mas classificada `high` pela regra fixa, é bloqueada até aprovação — prova de que o valor do agente não é autoritativo.
- **Aprovação versionada:** aprovar `proposalHash` A não autoriza execução de uma proposta B com hash diferente; aprovação expirada é rejeitada.
- **Máquina de estados da decisão (ADR 023):** transições inválidas (ex.: `REJECTED → APPROVED`, `PENDING → EXECUTING` pulando `APPROVED`) são rejeitadas pelo servidor.
- **Execução idempotente:** aprovar e "executar" duas vezes concorrentemente a mesma `decisionId` resulta em exatamente uma linha em `decision_executions` e um único efeito de negócio aplicado.
- **Recuperação de crash de execução:** simular uma decisão presa em `EXECUTING` com lease expirado e sem linha em `decision_executions` — o reaper devolve para `APPROVED` e uma nova tentativa é possível; simular o mesmo cenário mas com uma linha `executed` já presente — o reaper reconcilia para `EXECUTED` sem reexecutar.
- **Concorrência otimista:** duas atualizações concorrentes em uma `goal` com a mesma `version` — a segunda falha com conflito explícito, não sobrescreve silenciosamente; uma execução cujo `expectedVersions` não bate mais no momento da execução falha (`FAILED`), não aplica a ação sobre dado desatualizado.
- **Unit tests** de qualquer função já existente em `packages/domain` (mesmo que ainda mínimo nesta fase).

## 15. Gate de saída da Fase 1 (critérios objetivos)

Todos os itens abaixo devem ser verdadeiros para declarar a Fase 1 concluída:

1. Login/logout funcionando com sessão em banco, rate limiting ativo.
2. Household criado com `timezone`/`locale`/`currency`/`module_finance_enabled`; perfis de Márcio e Brenda persistidos (`profiles.id` como identidade, sem `person_id` próprio).
3. RLS habilitada e testada (ver §14) em toda tabela household-scoped desta fase; `agents`/`skills` confirmadas como globais (sem RLS de household).
4. Um agente "hello world" responde através do Coordinator mínimo, com o turno completo persistido em `conversations`/`messages` e a execução registrada em `agent_runs` (incluindo custo/tokens).
5. Ao menos uma ação de teste classificada MEDIUM pelo Policy Engine gera uma proposta (`ActionEnvelope` + `proposal_hash`) em `agent_decisions`, percorre `PENDING → APPROVED → EXECUTING → EXECUTED` corretamente, e só executa após aprovação válida (hash + não expirada) — com o resultado registrado em `decision_executions`.
6. `consents` grava um registro real no fluxo de cadastro; existe (mesmo que administrativo) um caminho de exportação e um de exclusão documentados e funcionais para um household de teste.
7. Todos os testes de §14 passam em CI.
8. Nenhuma tabela financeira existe (apenas o flag reservado) — confirma ADR 022.
