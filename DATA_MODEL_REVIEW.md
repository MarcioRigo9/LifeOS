# DATA_MODEL_REVIEW.md — LifeOS (Fase 0.5)

> Revisão do modelo de dados proposto em `PROJECT_DISCOVERY.md §7` / `ARCHITECTURE.md §8`. Nenhuma migration foi criada — este documento especifica o que precisa existir antes de escrever a primeira migration da Fase 1.

## 1. Convenções globais (aplicam-se a todas as tabelas abaixo)

- Toda tabela de domínio tem `id uuid default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz` (atualizado por trigger, não pela aplicação).
- Toda tabela de dado do household tem `household_id uuid not null references households(id)` com RLS habilitada (ver `SECURITY_MODEL.md §3.1`).
- Tabelas com dado por pessoa também têm `person_id uuid not null references profiles(id)`.
- Dinheiro: `bigint` em centavos + `currency char(3) default 'BRL'` (D016) — nunca `float`.
- Quantidade: `numeric` + coluna de unidade explícita (`unit` enum: `g`, `ml`, `unidade`, `kg`, `l`) — nunca número solto sem unidade.
- Soft delete: tabelas que alimentam histórico/auditoria (measurements, workout_logs, agent_decisions, audit_log) são **append-only**, sem delete físico; tabelas de configuração/planejamento (meal_plans, workout_plans, goals) usam `deleted_at timestamptz null` (soft delete) em vez de DELETE físico, para permitir recuperação e manter integridade referencial com histórico que as referencia.
- Concorrência: tabelas mutáveis por humanos (ver §3) têm `version integer not null default 1`.

## 2. Revisão por grupo de entidades

### 2.1 Household / Users / Profiles

```
households (id, name, timezone, locale, currency, module_finance_enabled bool default false,
            consent_recorded_at, created_at)
users (id, email unique, password_hash, created_at, last_login_at)
household_members (id, household_id, user_id, role enum(owner,member), joined_at, removed_at null)
profiles (id, household_id, person_id?, display_name, birth_date, sex, height_cm,
          created_at, updated_at)
```

**Correções em relação à Fase 0:**
- `timezone`/`locale`/`currency`/`module_finance_enabled` não existiam em nenhum documento — obrigatórios agora (bloqueia Fase 1, ver `ARCHITECTURE_REVIEW.md` R08).
- `household_members.removed_at` é necessário para suportar a revalidação de sessão descrita em `SECURITY_MODEL.md §2` — sem isso não dá para "desativar" um membro sem apagar histórico.
- `profiles` não deveria ter uma FK circular consigo mesma (`person_id?`) — a nota é que **profile = pessoa**; a coluna citada em outras tabelas como `person_id` deve referenciar `profiles.id` diretamente, e `profiles` não precisa de `person_id` próprio. Ajuste de nomenclatura a fazer na migration real.
- Ownership: um `profile` pertence a exatamente um `household_id` e um `user_id` (1:1 usuário-perfil na v1, já que são só duas pessoas reais controlando suas próprias contas) — confirmar que não é intenção ter perfis "fantasmas" sem usuário de login associado (ex.: perfil de um filho, futuro). Se for uma possibilidade futura, `profiles.user_id` deve ser nullable desde já.

### 2.2 Goals / Habits / Measurements / Health History

```
goals (id, household_id, person_id null, title, metric, target_value, current_value,
       start_value, deadline, status enum(active,completed,abandoned), version, created_at)
habits (id, household_id, person_id, title, frequency, created_at)
habit_goal_links (habit_id, goal_id)   -- N:N explícita, ausente na Fase 0
measurements (id, household_id, person_id, taken_at, weight_kg, body_fat_pct, ...)
health_history (id, household_id, person_id, category, note, recorded_at, source)
```

**Correções:**
- **Faltava a tabela de junção `habit_goal_links`** — o prompt mestre exige que hábitos se relacionem com metas, mas o schema da Fase 0 não tinha nenhum mecanismo de relacionamento N:N entre eles.
- `goals.person_id` deve ser **nullable** (metas de casal, ex. "guardar R$X", não pertencem a uma pessoa só) — isso não estava explícito.
- Sobreposição `measurements` vs `health_history` não estava esclarecida. Definição proposta: `measurements` é estritamente numérica/estruturada e de alta frequência (peso, medidas corporais); `health_history` é qualitativa/esparsa (condições, lesões, observações relevantes) — devem ter dono de escrita diferente (measurements alimentado por Fitness/Health; health_history por check-ins e input manual) e essa distinção precisa ficar documentada para não virarem duas tabelas fazendo a mesma coisa.
- `goals` precisa de `version` (D017) — duas pessoas podem editar a mesma meta de casal ao mesmo tempo.

### 2.3 Nutrition

```
foods (id, name, category, ...)
cooking_yields (id, food_id, preparation_method, raw_weight_g, cooked_weight_g,
                yield_factor generated always as (cooked_weight_g / raw_weight_g) stored,
                source, version, created_at)
recipes (id, household_id?, name, instructions, servings, ...)
recipe_items (recipe_id, food_id, raw_grams)          -- ausente na Fase 0
meals (id, name, type enum(breakfast,lunch,dinner,snack), ...)
meal_plans (id, household_id, week_start_date, version, status, approved_by, approved_at)
meal_plan_items (id, meal_plan_id, meal_id, person_id, day_of_week, planned_grams)
markets (id, household_id?, name, location)
market_prices (id, market_id, food_id, brand, package_size, package_unit, price_cents,
               currency, captured_at, source, source_url, confidence, promo bool)
shopping_lists (id, household_id, meal_plan_id, status, version)
shopping_list_items (id, shopping_list_id, food_id, needed_qty, buy_qty, package_suggestion,
                      estimated_cost_cents, market_id)
```

**Correções (respondendo diretamente às Partes 13-16 do pedido de revisão):**
- **`cooking_yields` não pode ter "um fator por alimento"** — precisa ser por **combinação de alimento + método de preparo** (`preparation_method`), com `source`/`version` para permitir correção sem quebrar histórico já calculado (planos antigos referenciam a versão que usaram, não recalculam retroativamente).
- **Faltava `recipe_items`** — sem uma tabela ligando receita a alimentos com quantidade crua, não há como calcular o fator de cocção agregado de uma receita composta.
- **`market_prices` não tinha nenhuma coluna definida** na Fase 0 — a lista mínima (`source`, `source_url`, `location` via `markets.location`, `captured_at`, `product`/`food_id`, `brand`, `package_size`, `package_unit`, `price_cents`, `currency`, `confidence`, `availability`/`promo`) precisa existir desde a primeira migration da Fase 3; sem `captured_at` versionado (não sobrescrever preço antigo), perde-se histórico de preço.
- **`weeklyCostOptimizer` precisa de especificação formal**, não pode continuar como "função genérica":
  - **Função objetivo:** minimizar `Σ (buy_qty_i × price_per_unit_i)` para todos os itens `i` da lista de compras da semana.
  - **Restrições rígidas:** necessidades nutricionais mínimas por pessoa (não decididas pelo otimizador, vêm do plano); preferências/restrições alimentares (exclusão total de itens); embalagens disponíveis (quantidade a comprar é sempre um múltiplo inteiro do tamanho de embalagem, com sobra registrada); estoque existente subtraído da necessidade antes de otimizar.
  - **Restrições flexíveis (soft):** variedade mínima (ex.: não repetir a mesma proteína principal mais que N vezes/semana) e minimização de desperdício como termo secundário do custo (sobra tem custo "afundado" contabilizado).
  - **Abordagem recomendada:** heurística gulosa determinística (ordenar por custo por porção útil, aplicar restrições rígidas como filtro) é suficiente para o volume de um household — **não** é necessário um solver de programação linear completo nesta escala, mas a função precisa ser especificada e testada com casos reais antes da Fase 3, não implementada ad-hoc.
- `meal_plans`/`shopping_lists` precisam de `version` (D017) e de um `status` que distinga rascunho/proposto/aprovado, alinhado ao Risk Engine (`SECURITY_MODEL.md §5`) — a "aprovação" de um plano semanal é exatamente o tipo de ação MEDIUM/HIGH que precisa do modelo de proposta versionada (D013), não apenas um boolean.

### 2.4 Fitness

```
exercises (id, name, muscle_groups, equipment, ...)
workout_plans (id, household_id, person_id, week_start_date, version, status)
workout_plan_items (id, workout_plan_id, exercise_id, day_of_week, target_sets, target_reps)
workout_sessions (id, household_id, person_id, workout_plan_item_id null, performed_at, status)
workout_logs (id, workout_session_id, exercise_id, set_number, reps, load_kg, rpe, notes)
-- "progression" NÃO é uma tabela própria — ver correção abaixo
```

**Correção principal (resolve C5 de `ARCHITECTURE_REVIEW.md`):**
- `progression` **não deve ser uma tabela gravável independente.** O estado de progressão (próxima carga/reps sugerida por exercício/pessoa) é **derivado** de `workout_logs` pela função `progressionEngine`. Se for persistido, deve ser como uma tabela de **cache/snapshot recalculável** (ex. `progression_state`, sempre reconstruível a partir de `workout_logs` do zero), nunca como fonte de verdade paralela — caso contrário há dois lugares que podem divergir sobre "qual é a carga atual do supino do Márcio."
- Cadeia de dependência correta: `workout_plans` (o que está previsto) → `workout_sessions` (uma execução real, pode ou não corresponder a um item do plano) → `workout_logs` (séries individuais) → `progressionEngine(workout_logs)` → sugestão para o próximo `workout_plan`. Isso não estava explícito em nenhum documento da Fase 0.

### 2.5 Agentes, memória, conversas, scheduler [Consolidado — ver ADR 015, 018, 019, 021]

```
agents (id, key unique ('coordinator'|'nutrition'|'fitness'|'finance'), display_name)
skills (id, key unique, domain, version, checksum)
conversations (id, household_id, started_at, ended_at null)
messages (id, conversation_id, household_id, person_id null,
          role enum(user,agent,system,tool), agent_id null, content, created_at)
agent_memories (id, household_id, person_id null, type, content_json,
                confidence, source_type, source_ref, created_at, superseded_by null)
agent_decisions (id, household_id, agent_id, proposal_hash, context_json,
                 recommendation_json, risk_level, status enum(pending,approved,rejected,expired),
                 approved_by null, approved_at null, expires_at, created_at)

-- scheduler: entidades PERSISTIDAS, nome distinto do contrato transiente AgentTask (ADR 021)
scheduled_jobs (id, household_id, kind, cron_expr, timezone, next_run_at, status,
                attempts, max_attempts, lease_expires_at, locked_by null, idempotency_key)
job_runs (id, scheduled_job_id, started_at, finished_at, status, result_summary, request_id)

-- execução de agente (originada de conversa viva OU de um job_run — nunca ambos ausentes)
agent_runs (id, request_id, conversation_id null, job_run_id null, agent_id,
            started_at, finished_at, result_json, token_usage_json, cost_cents,
            model_id, prompt_version, status)

audit_log (id, household_id, actor_type, actor_id, event_type, entity_type,
           entity_id, before_json, after_json, reason, request_id, created_at)
consents (id, household_id, user_id, purpose, policy_version, consented_at, revoked_at null)
```

**Correções (resolve C3 de `ARCHITECTURE_REVIEW.md`):**
- **`conversations`/`messages` são as tabelas que faltavam por completo.** `agent_sessions`, citada na Fase 0, não tem granularidade de mensagem — sem isso, nenhuma sessão de agente é auditável ou reconstruível. `agent_sessions` é removida do schema canônico (ADR 015).
- `agents`/`skills` como tabelas servem **apenas como registro/lookup** (chave estrangeira para logs e auditoria), não como fonte de configuração — a configuração real (`capabilities.json`, `SOUL.md`, `SKILL.md`) continua versionada em arquivo/git.
- `agent_decisions` ganhou `proposal_hash`, `status`, `expires_at` (ADR 013) — o modelo anterior (`user_decision` solto) não suportava aprovação vinculada e expirável.
- **O scheduler não usa mais o nome `agent_tasks`** (ADR 021) — esse nome ficava ambíguo com o contrato transiente `AgentTask` de invocação de agente. As tabelas persistidas do scheduler são `scheduled_jobs`/`job_runs`, com `attempts`, `max_attempts`, `lease_expires_at`, `locked_by` (ADR 018) necessários para o claim atômico e recuperação de falhas (`ARCHITECTURE_REVIEW.md §7`).
- `agent_runs` ganhou `token_usage_json`, `cost_cents`, `request_id`, `model_id`, `prompt_version`, e referências opcionais a `conversation_id`/`job_run_id` (uma execução de agente sempre tem origem rastreável, seja uma conversa viva ou um disparo do scheduler) — sem isso não há como atender ao requisito de custo/observabilidade do prompt mestre (seção 45).
- `consents` (ADR 019) substitui um campo solto de consentimento — permite múltiplos propósitos e revogação granular.

### 2.6 Finance (reservado, Fase 7)

```
accounts, transactions, credit_cards, debts, budgets, financial_goals
```
Sem alteração de schema recomendada nesta revisão além de: todas essas tabelas devem seguir a mesma convenção de dinheiro em centavos (D016) e RLS (D014) desde que forem criadas — não é aceitável que a Fase 7 crie essas tabelas com um padrão monetário diferente do resto do sistema.

## 3. Constraints, índices e versionamento — checklist

| Item | Status na Fase 0 | Correção |
|---|---|---|
| FK `household_id` em toda tabela de domínio | Implícito, não formalizado | Formalizar + RLS (D014) |
| Unique constraint em `household_members(household_id, user_id)` | Ausente | Adicionar |
| Índice em `(household_id, created_at)` nas tabelas de série temporal (measurements, workout_logs) | Ausente | Adicionar — consultas de histórico serão frequentes |
| Índice único em `market_prices(market_id, food_id, package_size, captured_at)` | Ausente (tabela nem existia em detalhe) | Adicionar — permite histórico de preço sem duplicar por corrida de coleta |
| `version` para concorrência otimista em goals/meal_plans/workout_plans/agent_decisions | Ausente | Adicionar (D017) |
| Soft delete vs. append-only definidos por tabela | Não diferenciado | Ver convenção em §1 |
| `agent_decisions.proposal_hash` único por proposta | Ausente | Adicionar (D013) |
| Trigger de `updated_at` | Não mencionado | Padronizar via trigger, não aplicação |

## 4. Perguntas obrigatórias do pedido de revisão

**"Se dois usuários modificarem o mesmo plano simultaneamente, o que acontece?"**
Hoje: nada os impede — última escrita vence silenciosamente. Correção: `version` (D017) em `meal_plans`/`workout_plans`/`goals`; update exige `WHERE version = :expected`, e um conflito retorna erro explícito para a UI resolver (mostrar diff, pedir para recarregar), nunca sobrescrever silenciosamente.

**"Se um agente executar duas vezes a mesma tarefa, o que acontece?"**
Hoje: possível, porque o claim de `scheduled_jobs` (antes chamada `agent_tasks` — renomeada por ADR 021) não é atômico. Correção: claim via `UPDATE ... WHERE status='pending' AND (lease_expires_at IS NULL OR lease_expires_at < now()) RETURNING *` em uma única query (D018), nunca "ler e depois marcar" em dois passos.

**"Se uma operação for parcialmente concluída e o processo morrer, o que acontece?"**
Hoje: não especificado. Correção: toda mudança de estado relevante (ex.: gerar plano + lista de compras) ocorre dentro de uma transação Postgres única, ou é dividida em etapas idempotentes onde cada etapa grava seu próprio resultado antes de disparar a próxima — nunca side-effects externos (ex. notificação) antes do commit da etapa correspondente. `agent_runs` registra o estado da execução para permitir retomar/reprocessar com segurança.

**"Se uma memória antiga entrar em conflito com uma nova memória, qual vence?"**
Hoje: campo `superseded_by` existe, mas a regra de precedência não estava definida. Correção — ordem de precedência explícita:
1. Correção confirmada por humano sempre vence sobre inferência do agente, independentemente de data.
2. Entre dois fatos do mesmo tipo de origem (ambos humanos, ou ambos inferidos), o mais recente (`created_at`) vence e marca o anterior como `superseded_by`.
3. `learned_pattern` (inferido) nunca sobrescreve um fato de `profile`/`goal` confirmado — só pode coexistir como uma observação separada, nunca "virar" um fato permanente automaticamente (é exatamente o requisito do prompt mestre de que inferência do modelo não vira fato sem confirmação humana).

## 5. Pontos que precisam ser corrigidos antes da implementação (resumo acionável)

1. Adicionar `conversations`/`messages` (substituindo o uso vago de `agent_sessions`).
2. Adicionar `households.timezone/locale/currency/module_finance_enabled`.
3. Definir dinheiro como inteiro em centavos em todo o schema, sem exceção.
4. Adicionar `version` em `goals`, `meal_plans`, `workout_plans`, `agent_decisions`.
5. Especificar colunas completas de `market_prices` e `cooking_yields` (com `preparation_method`).
6. Adicionar `recipe_items` e `habit_goal_links` (relações N:N que faltavam).
7. Remover `progression` como tabela independente; tratar como estado derivado de `workout_logs`.
8. Adicionar `attempts/max_attempts/lease_expires_at/locked_by` em `scheduled_jobs` (renomeada de `agent_tasks`, ADR 021).
9. Adicionar `proposal_hash/status/expires_at` em `agent_decisions`.
10. Habilitar RLS em toda tabela com `household_id` antes de qualquer dado real ser inserido, com role de aplicação sem `BYPASSRLS`.
11. Criar `consents` (ADR 019) e confirmar que nenhuma tabela financeira é criada antes da Fase 7 (ADR 022).
