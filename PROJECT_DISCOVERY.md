# PROJECT_DISCOVERY.md — NOSSA VIDA / LifeOS

> Fase 0 — Discovery. Este documento é o resultado do estudo de Hermes Agent, OpenClaw e Khoj, aplicado à visão do LifeOS descrita no prompt mestre. Nenhum código foi escrito nesta fase.
>
> **Nota de consolidação (Fase 0.5):** a Fase 0.5 encontrou contradições e lacunas neste documento (detalhes em `ARCHITECTURE_REVIEW.md` e ADRs 011-022 em `docs/adr/`). O texto abaixo é preservado como registro histórico da Fase 0; onde foi corrigido, a seção traz uma nota `[Corrigido na Fase 0.5]`. A versão canônica e vigente da arquitetura está em `ARCHITECTURE.md` + `DATA_MODEL_REVIEW.md` + `AGENT_CONTRACTS.md` + `SECURITY_MODEL.md`.

---

## 1. Visão do produto

LifeOS ("Nossa Vida") é uma plataforma pessoal de gestão da vida de um casal (Márcio + Brenda), não um app de dieta/academia/finanças isolado. A unidade central de dados é o **household** (casal), não o usuário individual — cada pessoa tem perfil, metas e histórico próprios, mas compartilha metas de casal, orçamento e planejamento.

Primeira versão: Saúde, Nutrição, Treino, Hábitos, Metas, Histórico, IA.
Versões futuras: Finanças, Dívidas, Orçamento, Organização, Agenda, Tarefas.

Princípio-guia: **a IA raciocina, o software calcula, o banco armazena, os agentes especializados analisam, o coordenador conecta tudo.** O LifeOS não é "um chatbot com páginas" — é uma aplicação estruturada onde a IA é uma camada de inteligência sobre dados, regras e ferramentas determinísticas.

## 2. Requisitos (resumo)

- Perfis individuais (Márcio, Brenda) dentro de um household compartilhado.
- Planejamento alimentar semanal completo, individualizado, com fator de cocção obrigatório calculado em software.
- Pesquisa de preços reais (nunca inventados), com fonte/data/confiança, e otimização de custo real da semana (não só menor nº de itens).
- Lista de compras e instruções de marmita geradas a partir de dados estruturados.
- Treino individualizado por pessoa, com progressão registrada e adaptação por check-in.
- Weekly Review aos sábados como ritual central de planejamento (preparar, nunca executar sozinho ações relevantes sem aprovação).
- Metas e Hábitos como entidades centrais, relacionáveis entre módulos.
- Memória persistente estruturada (não só histórico bruto de conversa).
- Agentes especializados com permissões próprias, coordenados por um Coordinator Agent, nunca isolados.
- Segurança de dados pessoais sensíveis (saúde e, futuramente, finanças) como requisito de primeira classe.
- Arquitetura desacoplada de fornecedor de IA.
- Simplicidade operacional: o sistema é para duas pessoas, não uma plataforma multi-tenant de larga escala.

## 3. Arquitetura proposta (visão geral)

Aplicação web única (Next.js) servindo o casal, com um **backend de agentes** desacoplado da camada de apresentação, um banco Postgres como única fonte de verdade estruturada, e um **scheduler durável** próprio para automações (Weekly Planning, check-ins). Nenhum microserviço, nenhuma fila de mensagens, nenhum Kubernetes — a escala é de duas pessoas.

```
                         NOSSA VIDA (Next.js app)
                                  │
                       ┌──────────┴──────────┐
                       │   API Layer (BFF)   │  ← valida, autoriza, chama agentes ou DB direto
                       └──────────┬──────────┘
                                  │
                        ┌─────────┴─────────┐
                        │  Coordinator Agent │  ← contexto global, memória, roteamento
                        └─────────┬─────────┘
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
     Nutrition Agent     Personal Trainer Agent   (Finance Agent — futuro, desativado)
              │                   │                   │
              └───────────────────┴───────────────────┘
                                  │
                    Deterministic Services Layer
           (fator de cocção, custo, porções, progressão, orçamento)
                                  │
                            PostgreSQL (única store)
                                  │
                    Scheduler durável (jobs table, ledger)
```

Cada agente especializado é invocado como uma **tarefa delegada com contrato de entrada/saída estruturado** (JSON schema), nunca como um chat solto — inspirado no padrão `delegate_task` do Hermes e no contrato "artifact de retorno" do OpenClaw (ver seção 15).

## 4. Arquitetura de agentes

- **Coordinator Agent**: único ponto de contato do usuário. Mantém contexto global do household (metas, prioridades, memória de decisões), decide se responde diretamente ou delega a um especialista, e sintetiza respostas integradas (ex.: gasto com delivery + sugestão de refeições mais baratas). Nunca delega para o próprio Coordinator (sem recursão) e não tem acesso irrestrito só por ser o agente principal — suas permissões são explícitas como as dos demais.
- **Nutrition Agent**: planejamento alimentar, receitas, compras, custo, marmitas — ver seção 13 do prompt mestre.
- **Personal Trainer Agent**: avaliação, planos de treino, progressão, adaptação — ver seção 20 do prompt mestre.
- **Finance Agent (futuro, desativado)**: arquitetura, tabelas e capabilities preparadas desde já; agente não implementado ainda.

Cada agente tem:
1. Um **workspace/contexto próprio** (arquivos de identidade e regras — ver seção 5), inspirado no modelo de workspace por agente do OpenClaw.
2. Uma **allowlist de skills** (quais skills daquele domínio ele pode usar).
3. Um **capability set explícito** (o que pode e não pode consultar/executar — seção 8 abaixo).
4. Um **contrato de entrada/saída estruturado** quando chamado pelo Coordinator (JSON schema validado), inspirado no `delegate_task` do Hermes.

Especialistas **não delegam mais adiante** (sem cadeias de delegação) — apenas devolvem resultados/artefatos ao Coordinator, replicando o padrão "specialists return artifacts, allowAgents empty" do OpenClaw.

## 5. Arquitetura de memória

Memória **não** é histórico bruto de chat. É estruturada em camadas, majoritariamente em Postgres (não em arquivos Markdown soltos, ao contrário de Hermes/OpenClaw — LifeOS lida com dados tabulares/quantitativos, não uma base documental):

| Camada | Conteúdo | Exemplo | Mutabilidade |
|---|---|---|---|
| **Profile Memory** | Dados relativamente permanentes por pessoa | idade, altura, restrições | requer confirmação humana para mudanças de impacto |
| **Preference Memory** | Preferências | "Márcio não gosta de quiabo" | IA pode propor, humano confirma mudanças relevantes |
| **Historical Memory** | Séries temporais | peso, medidas, treinos, refeições | append-only |
| **Goal Memory** | Metas ativas/concluídas | "perder 5kg até dez/2026" | editável com auditoria |
| **Decision Memory** | Decisões registradas do casal | "priorizar refeições de baixo custo" | append-only, referenciável pelo Coordinator |
| **Context Memory** | Situação atual (snapshot) | semana atual, sprint de metas | recalculada periodicamente |
| **Learned Patterns** | Padrões identificados pelo sistema | "adesão cai às quintas" | gerada por análise, marcada como inferida (não fato) |

Do Hermes, adotamos o padrão de **snapshot congelado por sessão**: no início de uma sessão de agente, um resumo compacto e limitado (ex.: perfil + metas ativas + decisões recentes) é montado uma vez e injetado no prompt — não o banco inteiro. Mudanças de memória durante a sessão são persistidas no Postgres mas só entram no contexto do agente na próxima invocação, preservando previsibilidade e controlando custo de tokens (ver seção 46 do prompt mestre, contexto mínimo).

**IMPORTANTE**: a IA não pode alterar Profile Memory nem Goal Memory de forma silenciosa quando o impacto for relevante — toda mudança de alto impacto passa por confirmação humana (ligação direta com Human-in-the-Loop, seção 8).

## 6. Arquitetura de skills

Estrutura de diretórios conforme prompt mestre (seção 11), com skills descritas como manifestos `SKILL.md` (frontmatter YAML + corpo em Markdown), inspirados no formato do Hermes/`agentskills.io`:

```
skills/
  nutrition/
    meal-planning/SKILL.md
    food-preferences/SKILL.md
    grocery-research/SKILL.md
    cooking-yields/SKILL.md
    meal-prep/SKILL.md
    nutrition-safety/SKILL.md
  fitness/
    workout-planning/SKILL.md
    exercise-library/SKILL.md
    progression/SKILL.md
    workout-adaptation/SKILL.md
    training-history/SKILL.md
  life/
    goal-management/SKILL.md
    habit-management/SKILL.md
    weekly-review/SKILL.md
    routines/SKILL.md
  finance/            # inativo na v1, estrutura presente
    budget-analysis/SKILL.md
    debt-management/SKILL.md
    expense-analysis/SKILL.md
    financial-goals/SKILL.md
```

Cada `SKILL.md` documenta: finalidade, quando usar, quando não usar, entradas, saídas, regras, limitações, ferramentas necessárias, permissões — exatamente como pedido na seção 11 do prompt mestre.

Do **OpenClaw** adotamos o conceito mais importante identificado na pesquisa: **skills scoped por agente via allowlist explícita**, não apenas por pasta — uma skill pode existir num pool comum, mas só é exposta aos agentes configurados para usá-la (`agent.skills = [...]`). Isso evita, por exemplo, que o Personal Trainer "veja" skills de análise de orçamento.

Do **Hermes** não adotamos (por ora) o Curator autônomo que cria/arquiva skills sozinho — overengineering para dois usuários; skills serão criadas e versionadas por nós, manualmente, na v1. Fica documentado como possível evolução futura (ver seção 15).

## 7. Arquitetura de dados

**[Corrigido na Fase 0.5 — ver `DATA_MODEL_REVIEW.md` para o schema canônico completo com colunas.]** Lista de entidades atualizada (finanças deixam de existir como schema na v1; `agent_sessions`/`progression` removidas; `conversations`/`messages`/`scheduled_jobs`/`job_runs`/`consents`/`habit_goal_links`/`recipe_items` adicionadas):

```
households, users, household_members
profiles, goals, habits, habit_goal_links, measurements, health_history

-- nutrition
foods, recipes, recipe_items, meals, meal_plans, meal_plan_items,
cooking_yields, markets, market_prices,
shopping_lists, shopping_list_items

-- fitness
exercises, workout_plans, workout_plan_items, workout_sessions, workout_logs
-- (progressão é derivada de workout_logs, não é uma tabela própria)

-- agents / conversas
agents, skills, conversations, messages, agent_memories, agent_decisions

-- scheduler
scheduled_jobs, job_runs

-- segurança/privacidade
audit_log, consents

-- finance (apenas reservado na v1: households.module_finance_enabled + registro em agents/skills;
--          schema completo só criado na Fase 7 — ADR 022)
```

Detalhamento completo em `DATA_MODEL_REVIEW.md` e `ARCHITECTURE.md`.

## 8. Segurança

Modelo de defesa em camadas, adaptado do checklist de segurança do Hermes (approval modes + blocklist + boundary de execução + proteção de paths) e do modelo de permissões por agente do OpenClaw/Khoj:

- Autenticação forte (NextAuth/Auth.js ou equivalente), sessões seguras, isolamento por household.
- **Sistema de capabilities por agente**: cada agente declara o que PODE e NÃO PODE fazer (ex.: Nutrition Agent pode consultar preferências e pesquisar preços; não pode acessar dados financeiros detalhados nem alterar configurações administrativas). Coordinator não tem acesso irrestrito por padrão.
- Classificação de risco por ação — **LOW** (executa automaticamente), **MEDIUM** (prepara e pede confirmação), **HIGH** (nunca executa sem confirmação explícita) — aplicada a toda ação que um agente proponha.
- Proteção contra prompt injection: qualquer conteúdo externo (resultado de busca de preço, texto colado, resposta de API) é tratado como dado, nunca como instrução — nenhuma fonte externa pode alterar regras do sistema ou conceder privilégios a um agente (alinhado ao scanner de injeção do Hermes/OpenClaw).
- Validação server-side, proteção contra SQL injection/XSS/CSRF, secrets fora do código, logs sem dados sensíveis, rate limiting, auditoria, backups.
- Dados de saúde e (futuramente) financeiros tratados como sensíveis por padrão: criptografia em repouso quando aplicável, e o sistema nunca se apresenta como conselho médico — reforça a busca de avaliação profissional quando cabível (seção 31 do prompt mestre).

## 9. Automações

Scheduler próprio em Postgres (jobs table + ledger de execuções), não dependente de um processo sempre ativo como gap identificado no OpenClaw — inspirado no padrão de idempotência do Hermes (pending-slot + ledger, catch-up em janela de tolerância, sem duplo disparo após restart). Exemplos de jobs: Weekly Planning (sábado), Shopping Preparation (domingo), Daily Check-in, Weekly Review, Monthly Life Review. Toda automação relevante **prepara e aguarda aprovação** — nunca executa ação de impacto sozinha (seção 24 do prompt mestre).

## 10. Stack recomendada

- **Frontend**: Next.js + TypeScript (App Router), mobile-first.
- **Backend**: rotas de API do próprio Next.js (Route Handlers) para CRUD e BFF; camada de agentes como módulo de serviço separado dentro do mesmo monorepo (não um microserviço à parte) — reavaliar separação apenas se a carga de execução de agentes justificar.
- **Banco**: PostgreSQL único.
- **IA**: camada de abstração própria ("AI Provider"), desacoplada de fornecedor — ver seção ARCHITECTURE.md.
- **Infra**: Docker Compose, VPS Oracle Cloud, Nginx ou Caddy como proxy reverso, HTTPS obrigatório (Let's Encrypt).
- **Scheduler**: worker interno (cron table + processo Node de polling), não serviço externo.
- **MCP**: usado seletivamente (ex.: busca web para preços) — nunca adicionado "porque é possível".

## 11. Estrutura de diretórios (proposta inicial)

```
lifeos/
  apps/web/                 # Next.js app
  packages/
    domain/                 # regras determinísticas (cocção, custo, progressão)
    agents/
      coordinator/
      nutrition/
      fitness/
      finance/ (stub)
    skills/                 # SKILL.md por domínio
    ai-provider/             # abstração de LLM
    db/                     # schema, migrations, client Postgres
  docs/
    adr/
  ARCHITECTURE.md
  DECISIONS.md
  ROADMAP.md
  PROJECT_DISCOVERY.md
```

## 12. Riscos

- **Overengineering**: tentação de replicar Curator autônomo, MCP excessivo, ou separar prematuramente em microserviços. Mitigação: seguir seção 47 do prompt mestre à risca.
- **IA decidindo sem aprovação**: risco de o Coordinator/Weekly Planning executar mudanças relevantes sem check humano. Mitigação: framework LOW/MEDIUM/HIGH obrigatório desde a Fase 1.
- **Preços inventados**: LLM "alucinar" preço de mercado. Mitigação: função determinística de busca de preço com fonte/data/confiança; se ausente, o sistema declara explicitamente a ausência.
- **Cálculo de cocção/custo delegado ao LLM**: risco de erro silencioso. Mitigação: funções determinísticas testadas (seção 15/30).
- **Memória mutável sem controle**: LLM alterando Profile/Goal Memory livremente. Mitigação: confirmação humana obrigatória para mudanças de alto impacto.
- **Vazamento entre domínios de agentes**: Nutrition Agent acessando dados financeiros por falta de capability enforcement. Mitigação: capabilities explícitas testadas (seção 43 do prompt mestre).
- **Migração futura para Finance**: schema/API mal desenhados agora que exijam retrabalho. Mitigação: Fase 7 (Finance Ready) já reserva schema e capabilities desde a Fase 1.

## 13. Decisões

Ver DECISIONS.md para o log completo com alternativas consideradas.

## 14. O que NÃO devemos copiar dos projetos estudados

- **Hermes — Curator autônomo de skills** (criação/arquivamento automático de skills com telemetria própria): overengineering para dois usuários; skills serão geridas manualmente na v1.
- **Hermes — múltiplas superfícies de entrada (25+ adaptadores de mensageria)**: LifeOS não precisa de gateway multi-canal agora; um único app web basta.
- **OpenClaw — sandbox Docker por sessão/canal como modelo de isolamento multiusuário**: desnecessário para um household de duas pessoas; isolamento será por household_id a nível de aplicação/banco, não por container.
- **OpenClaw — cron dependente de processo gateway sempre ativo**: identificado como lacuna real do próprio projeto; não replicar — construir scheduler durável próprio (seção 9).
- **Khoj — ausência de memória estruturada** (personalização baseada só em RAG sobre documentos do usuário): explicitamente insuficiente para o que o LifeOS precisa (perfis, metas, histórico quantitativo); não copiar esse vazio, preencher com tabelas Postgres estruturadas.
- **Khoj/Hermes — arquitetura multi-cliente ampla** (apps mobile/desktop/Obsidian/Emacs/WhatsApp): fora de escopo; LifeOS é um app web único mobile-first.
- Nenhum código-fonte de nenhum dos três projetos será incorporado — apenas conceitos.

## 15. Ideias que devemos incorporar

- **Hermes**: memória em duas camadas (arquivo/tabela limitado + snapshot congelado por sessão, cache-friendly); contrato de delegação com saída estruturada validada por schema (`delegate_task`); padrão de agendamento idempotente com pending-slot + ledger de execuções; filtragem de tools por allowlist/denylist; tratamento de conteúdo externo como potencialmente malicioso (anti prompt-injection).
- **OpenClaw**: workspace por agente com arquivos de contexto padronizados (adaptar AGENTS.md/SOUL.md/USER.md/MEMORY.md para o LifeOS, mais um HOUSEHOLD.md próprio para contexto compartilhado — lacuna que o OpenClaw não resolve nativamente); skills num pool comum com allowlist explícita por agente; especialistas devolvem "artefatos" ao coordenador sem delegar adiante; distinção entre "compact" (resumir sessão) e "reset" (nova sessão).
- **Khoj**: uso de Postgres + pgvector para eventual busca semântica (ex.: receitas, histórico de refeições) caso volume justifique — mas só quando necessário, não desde o dia 1; estrutura simples de "agente = persona + modelo + ferramentas + prompt" como ponto de partida para o schema da tabela `agents`.

## 16. Roadmap

Ver ROADMAP.md para o detalhamento fase a fase (Fase 0 a Fase 7), conforme seção 42 do prompt mestre.
