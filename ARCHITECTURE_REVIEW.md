# ARCHITECTURE_REVIEW.md — LifeOS (Fase 0.5)

> Revisão técnica crítica de `PROJECT_DISCOVERY.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`. Nenhum código foi criado. Este documento não substitui os quatro anteriores — aponta o que precisa ser corrigido/decidido antes de autorizar a Fase 1.

---

## 1. Resumo executivo

A direção geral da Fase 0 está correta: household como unidade central, monólito modular em Postgres, camada determinística separada da IA, agentes com capabilities explícitas, scheduler próprio. Nenhum desses pilares precisa ser jogado fora.

Mas os documentos descrevem a **forma** da arquitetura sem fechar vários **mecanismos de segurança e concorrência** que são exatamente os que causam incidentes reais (vazamento entre households, jobs duplicados, memória contaminada por inferência do LLM, agente autoatribuindo risco baixo a uma ação perigosa). Também há uma contradição real de sequenciamento entre o ROADMAP e a arquitetura de agentes, e lacunas de schema (preços, fator de cocção, sessões de conversa, dinheiro) que serão caras de corrigir depois que a Fase 1 já tiver migrations em produção.

Nada disso invalida a arquitetura escolhida. Mas nada disso deveria ser resolvido "durante" a Fase 1 de forma improvisada — precisa ser decidido agora, porque a própria Fase 1 é quem cria essas tabelas e contratos.

**Veredito: GO WITH CONDITIONS.** Ver §8.

## 2. Pontos aprovados (validados nesta revisão)

- **D001** (household como unidade central) — correto, coerente com o produto, custo de reverter é alto mas a decisão é a certa desde o início.
- **D002** (monólito modular, sem microserviço) — correto para dois usuários; ponto de extração futuro (worker separado) está bem identificado.
- **D005** (matemática determinística fora do LLM) — correto e bem aplicado nos exemplos de `packages/domain`.
- **D008** (nenhum código copiado de Hermes/OpenClaw/Khoj) — correto, sem ressalvas.
- **D010** (stack simples, sem Kubernetes/filas) — correto para a escala declarada.
- Princípio de contexto mínimo por agente (ARCHITECTURE.md §1.3) — correto na intenção; falta apenas o mecanismo de enforcement (ver §4).
- Separação entre arquivos de identidade estáticos (`SOUL.md`/`AGENTS.md`, versionados em git) e memória mutável (Postgres) — correta e bem justificada em D003.

## 3. Contradições encontradas

### C1 — [CRITICAL] Sequenciamento do Roadmap contradiz o modelo de agentes
`PROJECT_DISCOVERY.md §4` afirma: *"Coordinator: único ponto de contato do usuário [...] agentes especializados [...] nunca isolados."* Mas `ROADMAP.md` coloca o **Coordinator apenas na Fase 5**, enquanto a **Fase 3 (Nutrition)** já exige como gate de saída *"gerar uma semana completa de refeições individualizada [...] testado com casos reais"* — ou seja, o Nutrition Agent precisa estar operacional e acessível antes de existir um Coordinator. Isso significa que, na prática, da Fase 2 à Fase 4, ou (a) o usuário fala diretamente com os especialistas sem coordenação — contradizendo o princípio "nunca isolados" — ou (b) existe uma rota de acesso direto temporária que precisará ser removida/refeita na Fase 5.
**Por que importa:** o contrato `AgentTask` e o middleware de capabilities são construídos na **Fase 1**, antes dessa ambiguidade ser resolvida. Se o formato do contrato assumir "Coordinator sempre invoca", mas a Fase 3 for implementada com acesso direto, o contrato terá que ser retrabalhado.
**Recomendação:** decidir agora uma das duas opções e documentar como ADR novo (ver D011 em §6):
- (a) Coordinator existe desde a Fase 1 como um roteador "burro" (sem síntese cross-domain ainda), e Fases 2-4 sempre passam por ele; a inteligência cross-domain do Coordinator só amadurece na Fase 5. **Recomendado** — mantém o princípio "nunca isolados" verdadeiro desde o início e evita retrabalho de rota.
- (b) Fases 2-4 expõem os especialistas diretamente via API interna (sem LLM roteador), e o "Nutrition Agent"/"Fitness Agent" citados nos gates das Fases 3-4 são, na prática, apenas a camada determinística + prompt único sem coordenação — e isso deve ficar dito explicitamente no Roadmap, não implícito.

### C2 — [HIGH] `riskLevel` como campo do payload do agente, sem dono definido
`ARCHITECTURE.md §3.1` define `AgentTask.riskLevel` como parte do payload, mas não diz **quem o preenche**. Se for o próprio agente/LLM que declara `"riskLevel": "low"` para escapar de aprovação, o mecanismo de Human-in-the-Loop inteiro (D007) fica sem valor. Nenhum dos quatro documentos afirma que o risco é calculado no servidor.
**Recomendação:** ver §6 D012 (Policy Engine) e `AGENT_CONTRACTS.md`.

### C3 — [HIGH] Tabelas citadas sem contrato definido em nenhum documento
`PROJECT_DISCOVERY.md §7` lista `agent_sessions`, `agents`, `skills` como tabelas, mas **nenhuma coluna, relação ou propósito é definido** em `ARCHITECTURE.md` (que só detalha `agent_memories`, `agent_decisions`, `agent_tasks`, `agent_runs`). Mais grave: **não existe nenhuma tabela para armazenar as mensagens da conversa** entre o usuário e o Coordinator — `agent_sessions` sozinha (sem uma tabela de mensagens/turns) não é suficiente para reconstruir uma sessão, auditar o que foi dito, ou depurar uma decisão do agente.
**Recomendação:** ver `DATA_MODEL_REVIEW.md §2.5` e D015 em §6.

### C4 — [MEDIUM] Isolamento de household descrito de forma inconsistente
`ARCHITECTURE.md §10` diz *"Middleware de autorização por household_id em toda query"*; mas o prompt de revisão do usuário explicitamente rejeita `WHERE household_id = ...` como proteção suficiente, e nenhum documento da Fase 0 menciona verificação de ownership em buscas por ID (apenas em listagens), nem Row-Level Security do Postgres como camada adicional. Isso não é uma contradição textual, mas uma lacuna que o próprio texto da Fase 0 trata como "resolvido" quando não está. Ver `SECURITY_MODEL.md §3`.

### C5 — [LOW] `progression` como tabela própria vs. valor derivado
`PROJECT_DISCOVERY.md §7` lista `progression` como tabela ao lado de `workout_logs`/`workout_sessions`, mas `ARCHITECTURE.md §4` também lista `progressionEngine(workoutHistory)` como função determinística que **deriva** o próximo treino a partir do histórico. Se `progression` for uma tabela gravável independentemente, existem duas fontes de verdade (o log bruto e o estado derivado) que podem divergir. Ver `DATA_MODEL_REVIEW.md §2.4`.

## 4. Dependências ocultas (coisas que a Fase 1 precisa mas o Roadmap não lista)

| Dependência oculta | Onde é necessária | Por que não pode esperar |
|---|---|---|
| Tabela de mensagens/turns de conversa | Fase 1 (gate: "agente hello world respondendo") | Sem isso não há nem como completar o próprio gate de saída da Fase 1 de forma auditável |
| Policy Engine (risco determinado no servidor) | Fase 1 (o contrato `AgentTask` nasce aqui) | Mudar o formato do contrato depois de Fases 2-4 já consumirem `riskLevel` do jeito errado é retrabalho em cascata |
| Modelo de aprovação vinculado a uma proposta específica (não só um campo `user_decision`) | Fase 1 (`agent_decisions` é criada aqui) | Mesma razão — schema usado por todas as fases seguintes |
| Postgres RLS (ou equivalente) como segunda camada de isolamento | Fase 1 (todo o schema multi-household nasce aqui) | Adicionar RLS depois de dezenas de tabelas e queries já escritas é uma migração invasiva |
| Definição de dinheiro como inteiro (centavos), não float | Fase 1/Fase 7 (schema de `market_prices` chega na Fase 3, finance na Fase 7, mas o padrão precisa ser definido agora) | Trocar tipo de coluna monetária depois de dados reais existirem é doloroso e arriscado |
| `households.timezone`/`locale`/`currency` | Fase 1 (household é criado aqui) | Fase 6 (scheduler) depende de timezone; adicionar depois exige migração de dados de todos os jobs já agendados |
| Contrato expandido de `AI Provider` (retry, timeout, custo, tracing, structured output) | Fase 1 (é implementado aqui) | Todos os agentes das fases seguintes dependem dessa interface; estreitá-la ou trocá-la depois quebra todo mundo |
| Colunas de execução do scheduler (`attempts`, `lease_expires_at`, `locked_by`, `dead_letter`) | Fase 1 (schema de `agent_tasks`/`agent_runs` nasce aqui, mesmo que o worker completo só chegue na Fase 6) | Adicionar colunas depois é barato migration-wise, mas **desenhar a lógica de claim atômico depois que jobs já rodam sem ela** é que é caro — melhor decidir a estratégia agora |

## 5. Decisões irreversíveis / caras de mudar

| Decisão | Classificação | Nota |
|---|---|---|
| Household como unidade central (D001) | **HIGH** (mas já correta) | Migrar para modelo user-first depois seria uma reescrita de schema quase total. Confirmado como certo. |
| Dinheiro como float vs. inteiro (centavos) | **CRITICAL** se decidido errado | Trocar tipo depois de haver transações reais é uma migração de dados arriscada com risco de perda de precisão silenciosa. Decidir agora (D016). |
| Ausência de RLS desde o início | **HIGH** | Tecnicamente reversível (dá para ligar RLS depois), mas cada mês sem ela é um mês de exposição a um único `WHERE` esquecido vazando dados entre casais — e a Fase 7 (Finanças) aumenta drasticamente o custo de um vazamento. |
| Formato do contrato `AgentTask`/`riskLevel` | **HIGH** | Uma vez que Fases 2-6 estejam construídas sobre um contrato onde o agente "sugere" seu próprio risco, mover a lógica para o servidor exige tocar em todos os agentes de uma vez. |
| Ausência de tabela de mensagens/conversas | **MEDIUM-HIGH** | Reversível, mas sessões antigas (Fases 1-4) ficam sem histórico reconstruível se a tabela só chegar depois. |
| Sequenciamento Coordinator (Fase 5) vs. especialistas (Fase 3) | **MEDIUM** | Não é uma decisão de schema, é de sequenciamento de produto — barato de corrigir agora (mudar a ordem/âmbito do Roadmap), caro de corrigir depois de código de rota já escrito assumindo acesso direto. |

## 6. Decisões novas propostas (ADRs candidatos)

### D011 — Coordinator é o único ponto de entrada desde a Fase 1
**Decisão:** mesmo em Fases 2-4, toda interação do usuário passa por um Coordinator "fino" (roteamento simples, sem síntese cross-domain ainda), nunca diretamente por Nutrition/Fitness.
**Alternativas:** acesso direto aos especialistas nas fases iniciais (rejeitada — contradiz "agentes nunca isolados" e obriga retrabalho de rota na Fase 5).
**Impacto:** resolve C1. Ajuste de escopo no Roadmap (não neste ciclo de revisão — recomendação para quando o Roadmap for revisado).

### D012 — Nível de risco é determinado pelo servidor (Policy Engine), nunca pelo agente
**Decisão:** o LLM pode **sugerir** um risco, mas o valor autoritativo de `riskLevel` é calculado por uma função determinística do servidor a partir do tipo de ação, do escopo dos dados afetados e de regras fixas (allowlist de ações "seguras por definição").
**Alternativas:** confiar no campo enviado pelo agente (rejeitada — é a vulnerabilidade central identificada na Parte 6 da revisão solicitada).
**Impacto:** resolve C2. Detalhado em `AGENT_CONTRACTS.md §6`.

### D013 — Aprovações são vinculadas a uma proposta específica, versionada e com expiração
**Decisão:** toda aprovação humana referencia um hash/versão imutável da proposta que foi aprovada; aprovações expiram (ex.: 24-48h) e não podem ser reaproveitadas para uma proposta diferente, mesmo que pareça "parecida".
**Alternativas:** campo solto `user_decision: approved/rejected` sem vínculo a uma versão (rejeitado — abre brecha para replay/bait-and-switch: aprovar plano A e o sistema aplicar uma versão B levemente diferente).
**Impacto:** detalhado em `SECURITY_MODEL.md §7` e `AGENT_CONTRACTS.md §8`.

### D014 — Row-Level Security do Postgres como segunda camada de isolamento por household
**Decisão:** toda tabela com `household_id` tem política RLS ativada, além do filtro na aplicação. Aplicação conecta com um role de banco que só enxerga linhas do household setado via `SET app.household_id` na transação.
**Alternativas:** confiar somente em `WHERE household_id = ...` no ORM/queries (rejeitado — um único endpoint sem o filtro é um vazamento total entre casais).
**Impacto:** detalhado em `SECURITY_MODEL.md §3`.

### D015 — Conversas são persistidas em tabelas explícitas (`conversations`, `messages`)
**Decisão:** toda troca entre usuário e Coordinator (e entre Coordinator e especialista) é persistida como linha, com `household_id`, `person_id` (quem enviou), `role`, `content`, `agent`, `created_at`.
**Alternativas:** depender só de `agent_sessions` sem granularidade de mensagem (rejeitado — insuficiente para auditoria/depuração, ver C3).
**Impacto:** detalhado em `DATA_MODEL_REVIEW.md §2.5`.

### D016 — Valores monetários armazenados como inteiro (centavos/minor units), nunca float
**Decisão:** toda coluna de preço/custo/orçamento é `bigint` em centavos com `currency` explícito (default BRL), nunca `float`/`numeric` decimal solto sem essa convenção.
**Alternativas:** `decimal`/`numeric` do Postgres (aceitável tecnicamente, mas menos ergonômico para os cálculos determinísticos que vão fazer muita soma/multiplicação — inteiro em centavos evita qualquer ambiguidade de arredondamento entre linguagem e banco).
**Impacto:** aplica-se a `market_prices`, `shopping_list_items`, e todo o futuro módulo de finanças.

### D017 — Concorrência otimista em entidades editáveis (meal_plans, workout_plans, goals)
**Decisão:** essas tabelas têm coluna `version` (int, incrementada a cada update) ou `updated_at` checado via `WHERE version = :expected`; update que não bate a versão retorna conflito para a UI resolver (não sobrescreve silenciosamente).
**Alternativas:** last-write-wins sem verificação (rejeitado — responde diretamente à pergunta "dois usuários editando o mesmo plano" com perda silenciosa de dados).
**Impacto:** detalhado em `DATA_MODEL_REVIEW.md §3`.

### D018 — Scheduler usa claim atômico + lease + retry/backoff + dead-letter
**Decisão:** `agent_tasks` ganha `status`, `attempts`, `max_attempts`, `lease_expires_at`, `locked_by`; a reivindicação de um job é um único `UPDATE ... WHERE status='pending' AND (lease_expires_at IS NULL OR lease_expires_at < now()) RETURNING *` (ou `SELECT ... FOR UPDATE SKIP LOCKED`), nunca um "marcar depois de ler".
**Alternativas:** o texto atual ("marca `pending_slot_at` antes de disparar") deixado como está (rejeitado — não é atômico, permite corrida entre dois workers).
**Impacto:** detalhado em `AGENT_CONTRACTS.md §11` e cenários do §7 abaixo.

### D019 — Baseline de privacidade/LGPD desde a Fase 1
**[Texto original desta revisão — refinado depois: a versão final usa uma tabela `consents` dedicada, não um campo solto. Ver `DECISIONS.md` D019 / `docs/adr/019-privacidade-lgpd-baseline.md`.]**
**Decisão (original):** `users`/`households` ganham `consent_recorded_at`, e existe um caminho (mesmo manual/admin na v1) para exportar e apagar os dados de um household, dado que o sistema armazena dados de saúde (sensíveis por definição na LGPD) e, no futuro, financeiros.
**Alternativas:** tratar privacidade "quando chegar em Finanças" (rejeitado — dado de saúde já é sensível desde a Fase 2, e adicionar isso retroativamente é mais caro).
**Impacto:** detalhado em `SECURITY_MODEL.md §12`.

### D020 — Visibilidade de dados entre membros do household
**[FECHADA no closure pass pré-implementação — ver `DECISIONS.md` D020 e `docs/adr/020-visibilidade-household.md`.]** Esta seção é preservada como registro do que estava em aberto no momento desta revisão (Fase 0.5); na época: *"Márcio e Brenda compartilham o household, mas o sistema deve assumir visibilidade total entre os dois (peso, medidas, decisões, gastos individuais) por padrão, ou deve haver algum campo privado por pessoa? Nenhum documento da Fase 0 respondia isso."* A decisão final, tomada depois: `visibility = household` (total) por padrão na v1, com um enum reservado (`household | private`) para granularidade futura por registro — não é mais uma questão em aberto.

## 7. Cenários de scheduler — respostas obrigatórias antes da Fase 6

| Cenário | Resposta exigida |
|---|---|
| A. Dois workers simultâneos | Claim atômico (D018) — só um `UPDATE` ganha a linha. |
| B. Worker morre durante execução | `lease_expires_at` expira; um "reaper" periódico devolve o job a `pending` e incrementa `attempts`. |
| C. VPS reinicia | Igual a B — o estado vive no Postgres, não em memória do worker; nenhum job "some". |
| D. IA demora 10 minutos | Timeout por task (distinto do intervalo do cron); ao estourar, marca falha e segue política de retry, sem travar o worker para outros jobs. |
| E. IA responde mas processo morre antes do commit | Resultado só é considerado "efetivado" dentro da mesma transação que atualiza o status do job; qualquer efeito colateral externo (ex.: notificação) usa uma idempotency key gravada antes do disparo, para não duplicar ao reprocessar. |
| F. Job executa duas vezes | Impedido pela combinação de A + E. |
| G. Job fica preso | Coberto por B (lease) + H (dead-letter). |
| H. Job falha 5 vezes | Após `max_attempts`, status vira `dead_letter`, gera evento de auditoria/alerta, exige intervenção humana — nunca fica retentando para sempre. |
| I. Horário agendado passou offline | Janela de catch-up configurável por tipo de job; jobs como "Weekly Planning" **não** devem rodar múltiplas vezes para múltiplos sábados perdidos — rodar uma vez com os dados mais recentes e registrar que houve atraso. |
| J. Mudança de timezone | `households.timezone` (IANA) explícito; `cron_expr` sempre avaliado nesse timezone; mudança de timezone do household recalcula `next_run_at` futuros, nunca reescreve execuções passadas. |

## 8. Matriz de risco

| ID | Problema | Severidade | Probabilidade | Impacto | Recomendação | Bloqueia Fase 1? |
|---|---|---|---|---|---|---|
| R01 | Isolamento de household só por `WHERE` na aplicação, sem RLS | CRITICAL | Alta (basta um endpoint sem filtro) | Vazamento de dados de saúde/financeiros entre casais | D014 — RLS obrigatório | **Sim** |
| R02 | `riskLevel` potencialmente autoatribuído pelo agente | CRITICAL | Média | Ação de alto impacto executada sem aprovação | D012 — Policy Engine server-side | **Sim** |
| R03 | Ausência de tabela de mensagens/conversa | HIGH | Alta (gate da Fase 1 já precisa disso) | Impossível auditar decisões de IA, retrabalho de schema | D015 | **Sim** |
| R04 | Aprovação não vinculada a proposta versionada | HIGH | Média | Replay/bait-and-switch em aprovação humana | D013 | **Sim** |
| R05 | Dinheiro sem convenção de tipo (float vs inteiro) | CRITICAL se ignorado | Certa se não decidido agora | Erros de arredondamento em custo/orçamento, retrabalho de migração | D016 | **Sim** |
| R06 | Claim de job não-atômico (`pending_slot_at`) | HIGH | Média-alta sob concorrência real | Jobs duplicados/perdidos | D018 | Não bloqueia Fase 1, mas schema deve nascer certo (ver §4) |
| R07 | Contradição Fase 3 (Nutrition standalone) vs. Coordinator só na Fase 5 | HIGH | Certa se não resolvida | Retrabalho de rota/contrato entre fases | D011 | **Sim** (decisão, não implementação) |
| R08 | Ausência de timezone/locale/currency explícitos no household | MEDIUM | Alta | Jobs agendados no horário errado, ambiguidade de moeda | Adicionar campos na Fase 1 | **Sim** (schema) |
| R09 | Falta de colunas para `market_prices`/`cooking_yields` | MEDIUM | Certa (necessário na Fase 3) | Retrabalho de schema na Fase 3 | Definir agora (ver `DATA_MODEL_REVIEW.md`) | Não bloqueia Fase 1 |
| R10 | Concorrência otimista ausente em planos editáveis | MEDIUM | Baixa-média (2 usuários, mas casal edita junto) | Perda silenciosa de edição | D017 | Não bloqueia Fase 1, mas incluir no schema da Fase 1/3 |
| R11 | Ausência de baseline LGPD (export/delete/consent) | MEDIUM | Baixa no curto prazo, alta relevância legal depois | Risco de compliance com dado de saúde | D019 | Não bloqueia, mas recomendado desde já |
| R12 | Visibilidade de dados entre membros do household indefinida | LOW-MEDIUM | N/A (é uma decisão de produto, não bug) | Retrabalho de UI/UX se decidido tarde | Perguntar ao usuário antes da Fase 2 | Não bloqueia Fase 1 |
| R13 | `weeklyCostOptimizer`/`cooking_yields` sem especificação matemática formal | MEDIUM | Certa se implementado "no chute" | Otimização de custo incorreta ou instável | Formalizar função objetivo/restrições antes da Fase 3 | Não bloqueia Fase 1 |
| R14 | Contrato `AI Provider` muito magro (sem retry/timeout/custo/tracing) | HIGH | Alta | Todos os agentes futuros herdam a limitação | Expandir contrato agora (ver `AGENT_CONTRACTS.md`) | **Sim** |
| R15 | Ausência de diferenciação wellness/health-sensitive/medical | MEDIUM | Média | Orientação de saúde inadequada sem escalar para humano/profissional | Formalizar antes da Fase 2 (perfis de saúde) | Recomendado antes da Fase 2 |

## 9. GO / GO WITH CONDITIONS / NO-GO

## GO WITH CONDITIONS

A arquitetura escolhida (household-first, monólito modular, Postgres único, camada determinística separada da IA, agentes com capabilities explícitas, scheduler próprio) está correta e não precisa ser redesenhada. Porém a Fase 1 **não deve começar** até que as seguintes condições — todas marcadas "Sim" na coluna "Bloqueia Fase 1?" da matriz acima — estejam resolvidas ao menos como decisão documentada (ADR) e, quando aplicável, como parte do schema inicial:

1. RLS por household definido como parte do schema desde a primeira migration (D014).
2. Risco determinado no servidor via Policy Engine, não pelo agente (D012).
3. Schema de conversas/mensagens incluído na Fase 1 (D015).
4. Modelo de aprovação vinculada a proposta versionada, com expiração (D013).
5. Convenção monetária (inteiro/centavos + moeda) fechada antes de qualquer coluna de preço ser criada (D016).
6. Decisão explícita sobre o papel do Coordinator nas Fases 2-4 (D011), mesmo que a implementação completa continue na Fase 5.
7. Campos de timezone/locale/currency no household desde a criação da tabela.
8. Contrato de `AI Provider` expandido (estrutura de retry/timeout/custo/tracing) antes de implementar a primeira chamada real.

Os itens restantes da matriz (R06, R09, R10, R11, R12, R13, R15) não bloqueiam o início da Fase 1, mas devem ser resolvidos antes das fases que os exigem (indicado em cada linha) — não devem ser esquecidos "para depois" sem dono.

## 10. Status pós-consolidação

Todas as 8 condições listadas acima foram fechadas como decisão formal (ADRs 011-022 em `docs/adr/`) na consolidação de Fase 0.5, e um closure pass posterior (ADR 023) fechou o que ainda restava ambíguo em Approval/Execution, AI Provider, visibilidade e escopo de LGPD. Ver `ARCHITECTURE_CONSOLIDATION_RESULT.md` para o relatório final de prontidão e `PHASE_1_SPEC.md` para o contrato de implementação resultante. Este documento permanece como registro do processo de revisão que originou essas decisões — não precisa ser reaberto a menos que uma nova contradição seja encontrada durante a implementação da Fase 1.
