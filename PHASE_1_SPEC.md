# PHASE_1_SPEC.md — LifeOS Fase 1 (Foundation)

> Contrato de implementação da Fase 1, produzido na consolidação de Fase 0.5. Referencia `ARCHITECTURE.md`, `DATA_MODEL_REVIEW.md`, `SECURITY_MODEL.md`, `AGENT_CONTRACTS.md` e os ADRs 011-022 em `docs/adr/`. Este documento é normativo: qualquer divergência durante a implementação deve ser resolvida a favor deste contrato ou tratada como um novo ADR, nunca implementada silenciosamente de outro jeito.

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
- `agent_memories`, `agent_decisions` (com `proposal_hash`/`status`/`expires_at`, ADR 013).
- `scheduled_jobs`, `job_runs` (schema completo, ADR 018/021) — **sem** o worker de polling completo ainda (isso é Fase 6); o schema nasce certo para não migrar depois.
- `agents`, `skills` (tabelas de registro/lookup) + loader de `SKILL.md` com allowlist por agente.
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
households, users, household_members, profiles, consents
goals, habits, habit_goal_links
agents, skills
conversations, messages
agent_memories, agent_decisions
scheduled_jobs, job_runs
audit_log
```

Convenções obrigatórias em toda tabela acima (ver `DATA_MODEL_REVIEW.md §1`): `id uuid`, `created_at`/`updated_at`, `household_id` + RLS, dinheiro nunca aparece nesta fase mas a convenção (`bigint` centavos + `currency`) já deve estar documentada para quando `market_prices` chegar na Fase 3.

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

Contrato de `AGENT_CONTRACTS.md §6` implementado com uma tabela de regras fixas versionada em código (não configuração solta), cobrindo pelo menos as ações desta fase (`goal.*`, `habit.*`, `profile.*`). Ação classificada MEDIUM/HIGH sempre gera uma `agent_decisions` pendente (ADR 013) — nunca executa direto.

## 12. Audit

`audit_log` (append-only, sem permissão de UPDATE/DELETE para o role de aplicação) registrando no mínimo: login, logout, falha de autenticação, alteração de profile/goal, execução de agente, criação/aprovação/rejeição de decisão, tentativa de acesso cross-household (dos testes de isolamento).

## 13. Testes obrigatórios (bloqueiam o gate, não só documentação)

- **Isolamento cross-household:** dois households de teste; toda rota autenticada tentando acessar recurso do outro household falha com 404; teste específico confirmando que a RLS sozinha bloqueia a linha mesmo com o `WHERE` da aplicação propositalmente omitido.
- **Sessão de membro removido:** deixa de funcionar dentro do TTL de revalidação.
- **Capability enforcement:** um agente de teste sem uma capability específica tem a ação negada mesmo que o prompt "peça".
- **Policy Engine:** uma ação marcada `suggestedRiskLevel: low` pelo agente de teste, mas classificada `high` pela regra fixa, é bloqueada até aprovação — prova de que o valor do agente não é autoritativo.
- **Aprovação versionada:** aprovar `proposalHash` A não autoriza execução de uma proposta B com hash diferente; aprovação expirada é rejeitada.
- **Concorrência otimista:** duas atualizações concorrentes em uma `goal` com a mesma `version` — a segunda falha com conflito explícito, não sobrescreve silenciosamente.
- **Unit tests** de qualquer função já existente em `packages/domain` (mesmo que ainda mínimo nesta fase).

## 14. Gate de saída da Fase 1 (critérios objetivos)

Todos os itens abaixo devem ser verdadeiros para declarar a Fase 1 concluída:

1. Login/logout funcionando com sessão em banco, rate limiting ativo.
2. Household criado com `timezone`/`locale`/`currency`/`module_finance_enabled`; perfis de Márcio e Brenda persistidos.
3. RLS habilitada e testada (ver §13) em toda tabela desta fase.
4. Um agente "hello world" responde através do Coordinator mínimo, com o turno completo persistido em `conversations`/`messages` e a execução registrada em `agent_runs` (incluindo custo/tokens).
5. Ao menos uma ação de teste classificada MEDIUM pelo Policy Engine gera uma proposta em `agent_decisions` e só executa após aprovação válida (hash + não expirada).
6. Todos os testes de §13 passam em CI.
7. Nenhuma tabela financeira existe (apenas o flag reservado) — confirma ADR 022.
