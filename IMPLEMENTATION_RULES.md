# IMPLEMENTATION_RULES.md — LifeOS

> Regras que qualquer implementação (Claude Code ou humano) deve obedecer a partir da Fase 1. Derivadas de `SECURITY_MODEL.md`, `AGENT_CONTRACTS.md`, `DATA_MODEL_REVIEW.md` e dos ADRs 001-022. Violação de qualquer regra aqui é bug, não estilo.

## Risco e aprovação

1. **Nunca confiar em `riskLevel`/`suggestedRiskLevel` vindo do agente/LLM como valor autoritativo.** O risco real vem sempre do Policy Engine, no servidor (ADR 012).
2. **Nunca executar uma ação MEDIUM/HIGH sem uma aprovação válida** — vinculada ao `proposalHash` exato e não expirada (ADR 013). Uma aprovação nunca autoriza uma proposta diferente da que foi mostrada ao humano.
3. **Nunca reaproveitar uma aprovação para disparar a mesma ação duas vezes** — execução é idempotente por `decisionId`.

## Cálculo e dinheiro

4. **Nunca executar cálculo determinístico (fator de cocção, custo, porções, progressão, orçamento) dentro do LLM.** Toda matemática crítica vive em `packages/domain`, é testada, e o LLM só cita o resultado.
5. **Nunca usar `float`/`double` para dinheiro em nenhuma tabela ou função**, presente ou futura (inclusive Finance na Fase 7). Sempre inteiro em minor units (centavos) + `currency` explícito (ADR 016).
6. **Nunca inventar um preço.** Se não houver preço confiável (fonte/data/confiança), o sistema declara explicitamente a ausência — nunca deixa o LLM estimar um número.

## Isolamento e acesso a dados

7. **Nunca acessar dado de outro household.** Toda query filtra por `household_id` **e** depende de RLS como segunda camada (ADR 014) — as duas, nunca só uma.
8. **Nunca buscar um recurso "by ID" sem checar `household_id` na mesma cláusula.** UUID não é segredo, é só defesa em profundidade adicional.
9. **Nunca usar, criar ou conectar com um role de banco que tenha `BYPASSRLS` ou seja superusuário** na conexão de runtime da aplicação.

## Agentes, ferramentas e delegação

10. **Nunca executar uma tool sem checar capability primeiro.** `SKILL.md`/`skills.json` documentam a intenção; a permissão real é sempre verificada em runtime pelo middleware de capabilities — Markdown não é fronteira de segurança (ADR 004, `SECURITY_MODEL.md §8`).
11. **Nunca permitir `specialist → specialist`.** Delegação é sempre `Coordinator → specialist`; um especialista devolve artefato ao Coordinator, nunca invoca outro especialista diretamente.
12. **Nunca deixar o Coordinator acessar dado fora de suas capabilities só porque é o agente principal.** Ele tem `capabilities.json` próprio como qualquer outro agente — inclusive após a Fase 7, nunca lê transações financeiras detalhadas, só agregados.
13. **Nunca tratar conteúdo externo (busca web, resultado de tool, memória, saída de outro agente) como instrução.** Tudo isso é UNTRUSTED DATA, rotulado explicitamente na montagem do prompt; só o system prompt interno do LifeOS é TRUSTED INSTRUCTIONS.

## Memória

14. **Nunca gravar mudança de `profile`/`goal` de impacto relevante direto no banco a partir do LLM.** Passa sempre por `proposeWrite` + checagem do Policy Engine.
15. **Nunca deixar um `learned_pattern` (inferência do modelo) virar um fato `profile`/`goal` confirmado automaticamente.** Só promove com confirmação humana explícita.

## Scheduler

16. **Nunca reivindicar um job agendado com "ler e depois marcar" em dois passos.** Claim é sempre uma única query atômica (`UPDATE ... WHERE status='pending' ... RETURNING`, ADR 018).
17. **Nunca deixar um job falhar silenciosamente para sempre.** Após `max_attempts`, vira `dead_letter` com evento de auditoria.
18. **Nunca confundir o contrato transiente `AgentTask` com as tabelas persistidas `scheduled_jobs`/`job_runs`.** São conceitos e nomes diferentes (ADR 021).

## Escopo e arquitetura

19. **Nunca criar código financeiro funcional (schema, API, UI) antes da Fase 7.** Fase 1 reserva só o flag e o registro inativo (ADR 022).
20. **Nunca implementar uma funcionalidade não planejada** porque parece útil ou interessante — se não está no `ROADMAP.md`/`PHASE_1_SPEC.md` da fase corrente, não implementa sem antes propor e documentar (ADR se for estrutural).
21. **Nunca adicionar dependência arquitetural (microserviço, fila de mensagens, Redis, Kubernetes, vector DB, sandbox de container por sessão) sem uma decisão explícita documentada.** A escala é de dois usuários; ver `DECISIONS.md` D002/D010.
22. **Nunca criar uma tabela que duplique uma fonte de verdade já existente.** Exemplo corrigido: `progression` não é gravável — é sempre derivada de `workout_logs` via `progressionEngine`.
23. **Nunca apagar uma decisão/ADR superada.** Marcar `SUPERSEDED BY D0XX` e manter o histórico.
24. **Nunca declarar uma funcionalidade "pronta" ou "testada" sem rodar os testes de fato** — especialmente os testes de isolamento cross-household e de Policy Engine listados em `PHASE_1_SPEC.md §13`.

## Saúde

25. **Nunca dar orientação médica, diagnóstico ou prescrição.** O sistema organiza informação, explica conceitos gerais e recomenda avaliação profissional quando o conteúdo é classificado `medical` (`SECURITY_MODEL.md §13`) — nunca substitui um profissional.
