# DECISIONS.md — LifeOS

> Log de decisões arquiteturais. D001-D010 vêm da Fase 0 (Discovery). D011-D022 vêm da consolidação de Fase 0.5 (Architecture & Security Review) e têm ADR completo em `docs/adr/`. Quando uma decisão é substituída, ela permanece aqui marcada `SUPERSEDED BY D0XX` — nunca é apagada.

---

### D001 — Unidade central de dados é o household, não o usuário
**Decisão:** todo dado pendura de `household_id`; perfis individuais (`person_id`) existem dentro do household.
**Alternativas consideradas:** modelar como contas de usuário independentes com "compartilhamento" via convite (padrão SaaS multi-tenant clássico).
**Por quê:** o produto é para um casal desde o design, não um usuário single-player com colaboração bolt-on; simplifica queries de metas/orçamento compartilhados.

### D002 — Backend como módulo dentro do monorepo Next.js, não microserviço separado
**Decisão:** Route Handlers do Next.js + `packages/agents` no mesmo processo/deploy.
**Alternativas consideradas:** backend separado (Node/Fastify ou similar) desde o início.
**Por quê:** dois usuários não justificam separação de deploy; separar depois é simples se a carga de agentes justificar, e evita overengineering (seção 47 do prompt mestre).

### D003 — Memória estruturada em Postgres, não arquivos Markdown soltos
**Decisão:** `agent_memories`/`agent_decisions` como tabelas, com tipos (profile/preference/historical/goal/decision/context/learned_pattern).
**Alternativas consideradas:** replicar o modelo de arquivos MEMORY.md/USER.md do Hermes/OpenClaw.
**Por quê:** LifeOS lida com dados quantitativos e relacionáveis (peso ao longo do tempo, metas com progresso, preços), que pedem schema e queries — não uma base documental. O padrão de *snapshot congelado por sessão* do Hermes é adotado conceitualmente (montagem pontual do contexto), mas a fonte é o banco, não arquivos.

### D004 — Skills como manifestos `SKILL.md` com allowlist explícita por agente
**Decisão:** skills documentadas em Markdown+frontmatter, mas cada agente só enxerga as skills listadas em seu `skills.json`.
**Alternativas consideradas:** (a) skills globais acessíveis a qualquer agente; (b) Curator autônomo (Hermes) criando/arquivando skills sozinho.
**Por quê:** allowlist explícita (padrão OpenClaw) evita vazamento de capacidades entre domínios (ex.: Trainer "enxergar" skill de orçamento) com uma implementação simples. Curator autônomo é overengineering para dois usuários — skills serão versionadas manualmente por nós.

### D005 — Cálculos determinísticos nunca são responsabilidade do LLM
**Decisão:** fator de cocção, custo, porções, progressão, orçamento são funções puras testadas em `packages/domain`.
**Alternativas consideradas:** deixar o LLM estimar/calcular a partir de dados brutos.
**Por quê:** requisito explícito e não negociável do prompt mestre (seções 15, 17, 30) — precisão e auditabilidade exigem software determinístico.

### D006 — Scheduler próprio em Postgres, não dependente de processo único sempre ativo
**Decisão:** tabela `agent_tasks` + worker de polling + ledger `agent_runs`, com padrão pending-slot para evitar disparo duplo.
**Alternativas consideradas:** cron do SO; scheduler que só roda dentro do processo principal do app (modelo identificado como lacuna no OpenClaw).
**Por quê:** precisa sobreviver a restart de container sem perder/duplicar execuções; fila externa (ex. mensageria dedicada) seria overengineering nesta escala.

### D007 — Human-in-the-loop obrigatório por nível de risco (LOW/MEDIUM/HIGH)
**Decisão:** toda ação proposta por um agente carrega um `riskLevel`; MEDIUM/HIGH nunca executam sem confirmação explícita.
**Alternativas consideradas:** aprovação genérica "sempre perguntar" (fricção excessiva) ou "confiar na IA" (risco).
**Por quê:** requisito explícito do prompt mestre (seção 38); permite automação real (ex.: registrar um treino) sem abrir mão de controle em decisões de peso (ex.: aplicar um novo plano de compras).

### D008 — Nenhum código dos projetos de referência é incorporado
**Decisão:** Hermes, OpenClaw e Khoj são estudados apenas por conceito; zero dependência ou código copiado.
**Por quê:** requisito explícito do prompt mestre — evitar um "Frankenstein" de três projetos com licenças, estilos e trade-offs distintos.

### D009 — ~~Finance Agent: schema e capabilities reservados, agente não implementado~~
**⚠ SUPERSEDED BY D022.** A formulação original ("tabelas de finanças existem desde a Fase 1") contradizia o próprio `ROADMAP.md`, que sempre colocou o schema financeiro completo na Fase 7. D022 mantém a intenção (arquitetura preparada, agente não implementado) mas corrige o que é criado em cada fase: só flags/registro/capabilities reservados na Fase 1, tabelas completas somente na Fase 7.

### D010 — Stack: Next.js + TypeScript + Postgres + Docker Compose + Caddy/Nginx em VPS única
**Decisão:** sem Kubernetes, sem microserviços, sem fila de mensagens.
**Por quê:** requisito explícito de simplicidade (seção 47) — dois usuários, arquitetura simples + segura + escalável o suficiente + fácil de manter.

---

## Fase 0.5 — Consolidação (ver `docs/adr/` para o texto completo de cada ADR)

### D011 — Coordinator existe desde a Fase 1 (ADR 011)
**Decisão:** Coordinator "mínimo" desde a Fase 1 (recebe entrada, monta contexto, invoca AI Provider, valida saída, respeita capabilities/Policy Engine, audita); Coordinator "avançado" (roteamento cross-domain, síntese, Weekly Review) chega na Fase 5. Todo acesso a especialista passa pelo Coordinator em qualquer fase.
**Por quê:** resolve contradição entre Roadmap (Coordinator só na F5) e o princípio "agentes nunca isolados" (que a Fase 3 já violaria sem isso).

### D012 — Policy Engine é a autoridade exclusiva de risco (ADR 012)
**Decisão:** agente envia só `suggestedRiskLevel` (informativo); o `riskLevel` real é calculado no servidor por um Policy Engine determinístico. O agente nunca pode se autoatribuir risco baixo para escapar de aprovação.
**Por quê:** o formato anterior permitia, em tese, que o próprio LLM decidisse não precisar de aprovação humana.

### D013 — Aprovações vinculadas a proposta versionada com hash e expiração (ADR 013)
**Decisão:** `agent_decisions` ganha `proposal_hash`, `status`, `expires_at`; aprovação só é válida para o hash exato e dentro do prazo; execução é idempotente por `decisionId`.
**Por quê:** um campo solto `user_decision` permitia replay e bait-and-switch (aprovar X, sistema aplicar Y).

### D014 — PostgreSQL RLS como segunda camada de isolamento (ADR 014)
**Decisão:** toda tabela com `household_id` tem RLS habilitada, além do filtro de aplicação; role de banco da aplicação não tem `BYPASSRLS`.
**Por quê:** filtro só na aplicação é um único ponto de falha para vazamento entre households.

### D015 — Conversas persistidas como `conversations`/`messages` (ADR 015)
**Decisão:** substitui a vaga `agent_sessions` por tabelas com granularidade de mensagem, ligadas a `agent_runs`.
**Por quê:** sem isso, nenhuma sessão de agente é auditável ou reconstruível após um restart.

### D016 — Dinheiro sempre como inteiro em minor units (ADR 016)
**Decisão:** toda coluna monetária é `BIGINT` em centavos + `currency CHAR(3)`, nunca `float`.
**Por quê:** elimina ambiguidade de arredondamento; migrar o tipo depois de haver dados reais seria caro e arriscado.

### D017 — Concorrência otimista em entidades editáveis (ADR 017)
**Decisão:** `goals`/`meal_plans`/`workout_plans`/`agent_decisions` ganham `version`; update exige `WHERE version = :expected`.
**Por quê:** sem isso, dois membros do household editando o mesmo plano se sobrescrevem silenciosamente.

### D018 — Scheduler durável com claim atômico, lease, retry e dead-letter (ADR 018)
**Decisão:** `scheduled_jobs`/`job_runs` (não mais `agent_tasks`) com claim atômico via `UPDATE ... RETURNING`, lease/reaper para workers mortos, backoff exponencial, `dead_letter` após `max_attempts`, timezone explícito, catch-up configurável.
**Por quê:** o modelo anterior ("marca antes de disparar") não era atômico e não sobrevivia a crash/restart sem duplicar ou perder execuções.

### D019 — Baseline de privacidade/LGPD desde a Fase 1 (ADR 019)
**Decisão:** tabela `consents` (não um campo solto), caminho de exportação/exclusão documentado desde já.
**Por quê:** dado de saúde já é sensível desde a Fase 2; retrofitting depois é mais caro.

### D020 — Visibilidade de dados entre membros do household (ADR 020)
**Decisão:** default `visibility = household` (total entre os dois), com campo reservado (não implementado) para granularidade privada futura.
**Por quê:** pergunta em aberto na Fase 0; confirmada como decisão de produto nesta consolidação.

### D021 — `AgentTask` (transiente) separado de `ScheduledJob`/`JobRun` (persistidos) (ADR 021)
**Decisão:** `AgentTask` nunca é uma tabela — é o contrato de invocação em memória entre Coordinator e especialista, registrado via `agent_runs`. `scheduled_jobs`/`job_runs` são as entidades persistidas do scheduler.
**Por quê:** o nome `agent_tasks` sendo usado para os dois conceitos causava ambiguidade real sobre o que persiste e o que é transiente.

### D022 — Schema financeiro completo somente na Fase 7 (ADR 022) — **supersede D009**
**Decisão:** Fase 1 reserva só `module_finance_enabled`, registro em `agents`/`skills`, e um `capabilities.json` de exemplo — não cria `accounts/transactions/credit_cards/debts/budgets/financial_goals`. Essas tabelas nascem na Fase 7, já seguindo D014/D016/D017.
**Por quê:** criar schema financeiro completo quatro fases antes do uso real não tem benefício e aumenta superfície de dado sensível sem necessidade; alinha `ARCHITECTURE.md`/`DECISIONS.md` ao que `ROADMAP.md` sempre disse.
