# SECURITY_MODEL.md — LifeOS (Fase 0.5)

> Modelo de segurança consolidado, produzido na revisão pré-implementação. Referencia problemas identificados em `ARCHITECTURE_REVIEW.md`. Nenhum código foi criado.

## 1. Threat model

Adversários e cenários relevantes para um app self-hosted de dois usuários com dados de saúde e (futuro) financeiros:

| Ator | Motivação/cenário | Vetor |
|---|---|---|
| Atacante externo anônimo | Varredura oportunista, exploração de vulnerabilidade web comum | IDOR, injeção, credenciais fracas, exposição de porta |
| Conteúdo externo malicioso | Página de mercado/preço manipulada para injetar instruções | Prompt injection via resultado de busca/ferramenta |
| Dependência/skill comprometida | Pacote npm ou skill mal escrita com efeito colateral não previsto | Execução de ferramenta além do escopo declarado |
| Um dos dois usuários contra o outro (não hostil, mas erro) | Edição simultânea, aprovação de algo por engano | Concorrência, UX de aprovação mal desenhada |
| Operador do sistema (nós mesmos) | Erro operacional: backup não testado, secret vazado em log | Processo, não código |
| Vazamento entre households (se o produto crescer para outros casais no futuro) | Bug de isolamento | Falta de RLS, cache mal particionado, IDOR |

O modelo assume que **os dois membros do household confiam um no outro** por padrão (não é um sistema adversarial interno), mas a arquitetura deve continuar correta mesmo que o produto cresça para múltiplos households — daí o requisito de isolamento robusto mesmo com apenas um household real hoje.

## 2. Autenticação

- Framework: NextAuth/Auth.js (ou equivalente) com sessões em banco (não apenas JWT stateless), para permitir revogação imediata.
- Senhas: hashing com Argon2id (preferencial) ou bcrypt custo ≥ 12; nunca armazenar em texto plano nem logar.
- Expiração de sessão: TTL curto (ex.: 12-24h) + renovação deslizante; logout invalida a sessão no banco, não só o cookie do cliente.
- Cookies: `httpOnly`, `secure`, `sameSite=lax` (ou `strict` se o fluxo permitir).
- 2FA: não obrigatório na v1 dado o porte da equipe, mas o schema de `users` deve reservar campo para TOTP futuro (barato de adicionar agora, custoso de encaixar depois).
- Recuperação de acesso: token de reset de senha único, expira em minutos, invalidado após uso, enviado só por canal já verificado (e-mail).
- Rate limiting de login: contador por IP **e** por conta (para não permitir nem brute-force distribuído nem foco numa conta específica), com backoff progressivo; alerta simples se exceder limiar.
- Revalidação de sessão: a cada request sensível, confirmar que o `household_member` ainda está ativo (não só confiar em um claim embutido em token de longa duração) — cobre o caso de remoção de um membro do household.

## 3. Autorização e isolamento de household — a parte que a Fase 0 subestimou

O texto da Fase 0 tratava `WHERE household_id = ...` como a proteção. **Isso é necessário, mas não suficiente.** Modelo revisado, em camadas:

```
requisição
   │
   ▼
1) Autenticação (quem é o usuário)
   │
   ▼
2) Resolução de household_member ATIVO (não confiar em claim antigo)
   │
   ▼
3) Toda query de aplicação filtra por household_id (camada 1 de defesa)
   │
   ▼
4) Row-Level Security do Postgres (camada 2 de defesa, independente do código da aplicação)
   │
   ▼
5) Toda busca "by ID" confirma ownership explicitamente — não assumir que UUID não-adivinhável é suficiente
```

### 3.1 Row-Level Security (RLS) — obrigatório (D014)

- Toda tabela com `household_id` tem `ENABLE ROW LEVEL SECURITY` e uma policy do tipo `USING (household_id = current_setting('app.household_id')::uuid)`.
- A conexão da aplicação executa `SET LOCAL app.household_id = $1` no início de cada transação, a partir do household resolvido na etapa 2 — nunca a partir de um valor vindo diretamente do payload do cliente sem validação.
- Isso garante que **mesmo um bug de aplicação que esqueça o `WHERE`** ainda não vaza dados — a query simplesmente não vê linhas de outro household no nível do banco.
- Sem RLS, um único endpoint mal revisado é um vazamento total entre casais; com RLS, é necessário um bug duplo (aplicação E política) para vazar.
- **Regra adicional (consolidação):** o role de banco usado pela conexão da aplicação **nunca** tem `BYPASSRLS` nem é superusuário/owner das tabelas — caso contrário a política é ignorada silenciosamente para essa conexão e a proteção acima não existe de fato. Ferramentas administrativas (migrations, backup) usam um role separado, distinto do role de runtime da aplicação.

### 3.2 Autorização "by ID" (proteção contra IDOR)

- Todo endpoint que busca um recurso por ID (`GET /meal-plans/:id`, `GET /goals/:id`, etc.) deve incluir `household_id` na cláusula de busca (`WHERE id = :id AND household_id = :household_id`), nunca `WHERE id = :id` seguido de checagem depois (janela de erro) — e a RLS acima cobre isso mesmo se esquecido.
- IDs são UUIDv4 (não sequenciais) como defesa em profundidade adicional, mas **nunca tratados como segredo** — a autorização real vem da RLS + filtro, não da dificuldade de adivinhar o UUID.

### 3.3 Testes obrigatórios de isolamento (bloqueiam merge, não só documentação)

- Criar dois households de teste; para cada endpoint autenticado, tentar acessar um recurso do household B autenticado como household A → deve falhar com 404 (não 403, para não confirmar existência do recurso).
- Testar que uma sessão de um membro removido do household deixa de funcionar dentro do TTL de revalidação.
- Testar que a RLS sozinha (sem filtro de aplicação) já bloqueia a linha, via teste de integração que executa a query "esquecendo" o `WHERE` propositalmente.

## 4. Capabilities por agente

`capabilities.json` é aplicado por um middleware de enforcement no servidor, **antes** de qualquer chamada de ferramenta ser executada — nunca apenas documentado ou confiado ao prompt. Modelo deny-by-default: se uma ação não está explicitamente em `can`, é negada, mesmo que não esteja listada em `cannot`.

### Matriz de capabilities (ver detalhamento completo em `AGENT_CONTRACTS.md §4`)

| Agent | Read | Write | Tools | Delegate |
|---|---|---|---|---|
| Coordinator | profiles, goals, habits, agent_memories (resumo), agent_decisions (histórico) de todo o household | messages, agent_decisions (criar/registrar proposta), agent_runs | Nenhuma ferramenta de domínio direto — só delega | Pode delegar para Nutrition/Fitness/(Finance); não pode delegar para si mesmo (sem recursão) |
| Nutrition | profiles (nutrição-relevante), preferences, foods, recipes, market_prices, meal_plans, shopping_lists | meal_plans, meal_plan_items, shopping_lists, shopping_list_items | `domain.cookingYield`, `domain.shoppingQuantity`, `domain.weeklyCostOptimizer`, busca de preço (MCP/web, sandboxed) | Não delega — devolve artefato ao Coordinator |
| Fitness | profiles (treino-relevante), exercises, workout_plans, workout_sessions, workout_logs | workout_plans, workout_sessions, workout_logs | `domain.progressionEngine` | Não delega |
| Finance (futuro, desativado) | accounts, transactions, budgets, debts (quando `module_enabled=true`) | transactions (categorização), budgets, financial_goals | `domain.budgetProjection`, `domain.debtPayoffPlan` (futuros) | Não delega |

**Permissão excessiva identificada:** nenhuma nos agentes especialistas conforme desenhado — mas o próprio `AgentTask` (ARCHITECTURE.md) não impõe explicitamente que o Coordinator **não pode** ler `financial_accounts` antes do módulo estar habilitado. Recomenda-se que o `capabilities.json` do Coordinator inclua `cannot: ["read:financial_accounts_detail"]` mesmo depois da Fase 7, deixando a leitura financeira exclusiva do Finance Agent — o Coordinator recebe apenas agregados (ex.: "gasto total do mês"), nunca transações individuais, para reduzir superfície de exposição de dado sensível no agente mais "genérico".

## 5. Risk Engine (Policy Engine) — obrigatório, não opcional

Fluxo revisado, substituindo o modelo atual onde `riskLevel` viaja no payload sem dono definido:

```
Agente propõe uma ação (com um risco "sugerido", apenas informativo)
        ↓
Policy Engine (servidor) recalcula o risco real a partir de:
   - tipo de ação (ex.: "criar meal_plan" vs "excluir goal")
   - escopo/quantidade de dados afetados
   - se a ação é reversível
   - regras fixas (allowlist de ações intrinsecamente LOW)
        ↓
Verificação de capability (o agente pode sequer propor essa ação?)
        ↓
Se LOW → executa e registra
Se MEDIUM/HIGH → cria proposta pendente vinculada a uma versão (D013), aguarda aprovação
        ↓
Execução (só após aprovação válida, não expirada, vinculada à proposta exata)
```

O agente **nunca** consegue fazer uma ação de alto impacto declarando `"riskLevel": "low"` — o valor que o agente envia é ignorado para fins de gate, usado no máximo como sinal de UX (ex.: destacar "a IA considerou isso de baixo risco, mas o sistema exige confirmação porque X").

## 6. Human-in-the-loop — modelo de aprovação seguro

**Fechado definitivamente e normativo em `AGENT_CONTRACTS.md §8` (ADR 013, ADR 023)** — esta seção resume, não redefine.

- Toda proposta de risco MEDIUM/HIGH é um `DecisionProposal` imutável carregando um `ActionEnvelope` estruturado (nunca texto livre) e um `proposal_hash` calculado uma única vez sobre esse envelope + risco.
- A aprovação referencia `decisionId` + `proposalHash` exato; hash divergente é rejeitado (protege contra bait-and-switch).
- Propostas não são editadas — uma proposta diferente é sempre uma nova proposta com novo `decisionId`/hash; a antiga fica `REJECTED`/`EXPIRED`.
- Aprovações/propostas expiram (`expiresAt`) — não podem autorizar execução tardia com dados desatualizados.
- Máquina de estados fechada: `PENDING → APPROVED → EXECUTING → EXECUTED|FAILED`, com `REJECTED`/`EXPIRED` como saídas terminais — sem atalhos nem transições arbitrárias.
- Execução é idempotente por `decisionId` (claim atômico + `decision_executions` com `decision_id` único) e recupera de crash de forma determinística (existe registro de execução? reconcilia; não existe? seguro retentar).
- Toda aprovação/rejeição/execução é auditada: quem, quando, hash aprovado, resultado.

## 7. Prompt injection — separação TRUSTED vs UNTRUSTED

Regra arquitetural única e não-negociável: **nenhum conteúdo que não seja o system prompt/regras internas do LifeOS pode ser interpretado como instrução.**

Fontes sempre tratadas como UNTRUSTED DATA (nunca como instrução, mesmo que pareçam comandos):
- Resultado de busca de preço na web / conteúdo de página de mercado.
- Texto livre digitado pelo usuário dentro de um campo de dado (ex.: nome de receita, observação de check-in).
- Resposta de uma ferramenta/skill.
- Saída de um agente especialista quando recebida pelo Coordinator (o Coordinator trata o retorno de Nutrition/Fitness como dado estruturado validado por schema, não como novo prompt de sistema).
- Conteúdo de memória (`agent_memories`) — mesmo memória "confirmada" é injetada como dado rotulado (`<memory>...</memory>`), nunca concatenada de forma indistinguível do system prompt.

Mecanismo: todo conteúdo externo é envolvido em um bloco delimitado e rotulado explicitamente como dado (ex.: tags estruturadas) na montagem do prompt, e a resposta do modelo é sempre validada contra o `outputSchema` esperado — uma tentativa de injeção que faça o modelo "decidir" executar uma ferramenta fora do schema é rejeitada na validação, não na confiança do prompt.

## 8. Segurança de skills e ferramentas

**Markdown não é fronteira de segurança** — confirmado e aplicado assim:

- `SKILL.md` é documentação para humanos e para o modelo entender quando usar a skill; a permissão real (`permissions: [...]` no frontmatter) é **espelhada e verificada** pelo mesmo middleware de capabilities do agente, em runtime — se uma skill declarar `write:shopping_lists` mas o agente que a invoca não tiver essa capability, a chamada é rejeitada no servidor, independentemente do que o Markdown diz.
- Toda ferramenta exposta a um agente passa por allowlist explícita (nome da função, nunca "qualquer código"); não existe execução de código arbitrário gerado pelo modelo.
- Versão da skill é registrada (hash do arquivo ou número de versão) em cada `agent_run` que a utilizou, para auditoria — se uma skill for alterada, é possível saber quais execuções passadas usaram qual versão.
- Alterações em `SKILL.md` (arquivo versionado em git) passam por revisão humana normal (PR), já que não há Curator autônomo na v1 (D004).

## 9. Auditoria

Tabela `audit_log` (append-only, sem UPDATE/DELETE permitido a nível de permissão de banco):

```
id, household_id, actor_type (user|agent|system), actor_id, event_type,
entity_type, entity_id, before_json, after_json, reason, request_id,
agent_run_id nullable, created_at
```

Eventos mínimos obrigatórios: login, logout, alteração de dado sensível (profile/goal/measurement), execução de agente, chamada de ferramenta, alteração de memória, criação de decisão/proposta, aprovação, rejeição, execução de job agendado, evento de segurança (falha de auth, tentativa de acesso cross-household, rate limit atingido).

Acesso ao próprio `audit_log` é isolado por household (mesma RLS) e somente leitura para usuários finais.

## 10. Secrets

- Nunca no repositório; variáveis de ambiente no host, injetadas via Docker Compose `env_file` fora do controle de versão.
- Chave de API do provedor de IA, credenciais de banco, secret de sessão: rotação manual documentada (não há orçamento para um vault dedicado nesta escala, mas o processo de rotação deve estar escrito em `SETUP.md`/`DEPLOY.md`).
- Logs nunca incluem valores de secrets nem corpo de requisições de autenticação.

## 11. Backup e recuperação

`pg_dump` agendado **não é uma estratégia completa** por si só. Modelo mínimo:

- Backup diário completo + WAL archiving (se o volume justificar point-in-time recovery; caso contrário, ao menos dois backups completos diários).
- Armazenamento **fora da própria VPS** (ex.: bucket de object storage separado), criptografado em repouso.
- Retenção: ex. 14 diários + 6 mensais.
- **Restore drill obrigatório e recorrente**: restaurar o backup mais recente em um banco descartável e validar integridade (contagem de linhas, checksum) — sem isso, não se sabe se o backup é restaurável até o dia em que for tarde demais.
- RPO alvo: ≤ 24h. RTO alvo: algumas horas (documentar o número real depois de medir o primeiro restore).

## 12. Privacidade e dados sensíveis (LGPD)

O sistema armazena dados de saúde desde a Fase 2 (sensíveis por definição na LGPD) e dados financeiros a partir da Fase 7. Baseline mínimo desde a Fase 1 (ADR 019):

- Consentimento registrado numa tabela dedicada `consents (id, household_id, user_id, purpose, policy_version, consented_at, revoked_at)` — não um campo solto `consent_recorded_at` — permitindo múltiplos propósitos de consentimento e revogação granular por propósito.
- Caminho para exportação de todos os dados de um household (mesmo que inicialmente seja um script administrativo, não uma feature de UI).
- Caminho para exclusão (`deletion_requested_at` + rotina de apagar/anonimizar em cascata, respeitando o que precisa ficar em `audit_log` por obrigação legal/operacional, se aplicável).
- Retenção documentada por tipo de dado (histórico de saúde não deve ser apagado "por engano" via cascade de outra exclusão).
- **Visibilidade entre membros do household — fechada (ADR 020, `DECISIONS.md` D020):** política da v1 é `visibility = household` — dados dentro de um household são visíveis a todos os seus membros ativos, sem exceção. Não é uma questão em aberto. O schema reserva um enum de dois valores (`household | private`) para uma granularidade futura por registro, mas nenhuma tabela da v1 usa o valor `private` — é possibilidade documentada para depois, não funcionalidade da Fase 1.

## 13. Segurança de saúde (wellness vs. health-sensitive vs. medical)

| Nível | Exemplos | Comportamento exigido |
|---|---|---|
| Wellness | dicas gerais de hábito, hidratação, treino padrão | Sem restrição especial |
| Health-sensitive | tendência de peso, sono, energia, medidas | Discutir sem linguagem diagnóstica; sinalizar padrões preocupantes (ex.: perda de peso rápida não intencional) sugerindo avaliação profissional |
| Medical | sintomas, lesões, medicação, dietas terapêuticas (diabetes, renal, gestação) | Sistema recusa orientação médica específica, direciona a um profissional, registra como evento de segurança/saúde no audit log; detecção inicial pode ser por palavras-chave determinísticas, não só julgamento do LLM |

## 14. Deployment — pontos de segurança a fechar antes do primeiro deploy real

- Postgres **nunca** exposto publicamente (porta só acessível dentro da rede Docker interna, não mapeada para o host publicamente).
- Firewall do VPS restringindo portas expostas a 80/443 (e SSH com chave, não senha).
- Healthchecks e `restart: unless-stopped` nos containers, mas sem auto-restart mascarar falhas repetidas sem alerta.
- Estratégia de update com possibilidade de rollback (manter a imagem anterior disponível até confirmar que o deploy novo está saudável).
