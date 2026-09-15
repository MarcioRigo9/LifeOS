# VALIDATION_GATE.md — LifeOS

> Validação objetiva e binária da arquitetura/documentação antes da Fase 1. Nenhum código foi escrito nesta tarefa. Onde um critério falhou, a documentação foi corrigida e o critério foi reexecutado (registrado como Before/Correction/After) — nunca marcado PASS por intenção.

## Correções aplicadas durante esta validação (Before → After)

| # | Critério afetado | Before | Correction | After |
|---|---|---|---|---|
| 1 | ARCH-002 | FAIL — `ARCHITECTURE.md §1` princípio 1 listava só "IA/software/banco/agentes/coordenador", sem mencionar Policy Engine nem aprovação humana no mesmo enunciado canônico | Reescrito o princípio 1 para incluir explicitamente "Policy Engine controla ações (ADR 012), humano aprova impacto (ADR 013/023)" | PASS — `ARCHITECTURE.md` linha 9 |
| 2 | SCH-006 | FAIL — nenhuma regra normativa garantia que "Weekly Planning" não dispararia múltiplas vezes após indisponibilidade; só existia menção em `ARCHITECTURE_REVIEW.md` (registro histórico, não normativo) | Adicionada regra explícita em `AGENT_CONTRACTS.md §11` (jobs de planejamento fazem catch-up no máximo uma vez) e regra 24 em `IMPLEMENTATION_RULES.md` | PASS — `AGENT_CONTRACTS.md §11` (novo parágrafo), `IMPLEMENTATION_RULES.md` regra 24 |
| 3 | RULE-001 (optimistic concurrency) | FAIL — `IMPLEMENTATION_RULES.md` só tinha uma regra de `expectedVersions` no contexto de execução de decisão aprovada; nenhuma regra cobria edição direta via CRUD humano ignorando `version` | Adicionada regra 7 explícita cobrindo qualquer caminho de escrita em entidade versionada | PASS — `IMPLEMENTATION_RULES.md` regra 7 |

## Matriz de critérios

| ID | Critério | Severidade | Resultado | Evidência |
|---|---|---|---|---|
| ARCH-001 | Monólito modular | CRITICAL | PASS | `ARCHITECTURE.md §2` (diagrama: apps/web Next.js → packages/agents/domain/ai-provider/db, "monólito modular", "Nenhum microserviço"); `DECISIONS.md` D002/D010 |
| ARCH-002 | Princípio de responsabilidades | HIGH | PASS (corrigido, ver tabela acima) | `ARCHITECTURE.md §1` linha 9 + linha 12 (aprovação humana); `ARCHITECTURE.md §3.4-3.5` |
| ARCH-003 | Coordinator desde Fase 1 | CRITICAL | PASS | `ARCHITECTURE.md §3.1` linha 40 ("Coordinator é o único ponto de entrada desde a Fase 1... até a Fase 5"); `ROADMAP.md` linha 20 ("Coordinator mínimo (D011)... todo acesso de usuário a um especialista passa por ele desde já"); `docs/adr/011-coordinator-desde-fase1.md` |
| AGENT-001 | Delegação Coordinator→Specialist | CRITICAL | PASS | `AGENT_CONTRACTS.md §14` linhas 319-322 (regras fixas: especialista→especialista nunca) |
| AGENT-002 | Contexto mínimo | HIGH | PASS | `AGENT_CONTRACTS.md §1` (AgentContext filtrado); `§3` linha 69 (`context` só dados relevantes filtrados); `§4` (CapabilityCheck) |
| AGENT-003 | Structured Task | HIGH | PASS | `AGENT_CONTRACTS.md §3` linhas 63-75 — todos os campos exigidos presentes (`taskId`, `requestId`, `agent`, `goal`, `context`, `inputSchema`, `outputSchema`, `idempotencyKey`, `timeoutMs`, `suggestedRiskLevel`) |
| RISK-001 | Agente não controla risco | CRITICAL | PASS | `AGENT_CONTRACTS.md §6` linhas 129-131; `§8.2` linha 181 (comentário explícito) |
| RISK-002 | Policy Engine server-side | CRITICAL | PASS | `AGENT_CONTRACTS.md §6`; `SECURITY_MODEL.md §5` linhas 92-109 |
| RISK-003 | Teste de spoofing de risco | HIGH | PASS | `PHASE_1_SPEC.md §14` ("uma ação marcada `suggestedRiskLevel: low`... mas classificada `high`... é bloqueada até aprovação") |
| APPROVAL-001 | Proposal estruturada | CRITICAL | PASS | `AGENT_CONTRACTS.md §8.2` linhas 176-186 (`DecisionProposal`: todos os campos presentes) |
| APPROVAL-002 | Action Envelope | CRITICAL | PASS | `AGENT_CONTRACTS.md §8.1` linhas 156-171 |
| APPROVAL-003 | Hash | CRITICAL | PASS | `AGENT_CONTRACTS.md §8.3` linhas 200-207 (campos, algoritmo SHA-256, serialização canônica, momento do cálculo, validação) |
| APPROVAL-004 | Alteração após aprovação bloqueada | CRITICAL | PASS | `AGENT_CONTRACTS.md §8.3` linha 207 + `§8.2` linha 196 (imutabilidade); teste em `PHASE_1_SPEC.md §14` ("aprovar `proposalHash` A não autoriza execução de uma proposta B com hash diferente") |
| APPROVAL-005 | Expiração | HIGH | PASS | `AGENT_CONTRACTS.md §8.4` (`PENDING → EXPIRED`, `APPROVED → EXPIRED`); teste em `PHASE_1_SPEC.md §14` ("aprovação expirada é rejeitada") |
| EXEC-001 | Máquina de estados | CRITICAL | PASS | `AGENT_CONTRACTS.md §8.4` linhas 211-236 (7 estados + transições explícitas) |
| EXEC-002 | Execução única | CRITICAL | PASS | `AGENT_CONTRACTS.md §8.5` linhas 243-244 (claim atômico `UPDATE...RETURNING` + `decision_executions.decision_id` chave única) — mecanismo concreto, não apenas "é idempotente" |
| EXEC-003 | Crash durante execução | HIGH | PASS | `AGENT_CONTRACTS.md §8.6` linhas 250-259 (comportamento explícito passo a passo) |
| EXEC-004 | Resultado da execução | HIGH | PASS | `DATA_MODEL_REVIEW.md §2.5` linhas 130-132 (`decision_executions`: decision_id, request_id, started_at, finished_at, status, result_json, error_json) |
| SEC-001 | Household scope + RLS | CRITICAL | PASS | `SECURITY_MODEL.md §3.1` linha 56; `DATA_MODEL_REVIEW.md §1.1` linhas 13-29 |
| SEC-002 | Runtime role sem BYPASSRLS/SUPERUSER | CRITICAL | PASS | `SECURITY_MODEL.md §3.1` linha 60; `IMPLEMENTATION_RULES.md` regra 13 |
| SEC-003 | SET LOCAL transacional | CRITICAL | PASS | `SECURITY_MODEL.md §3.1` linha 57 |
| SEC-004 | Cross-household denied | CRITICAL | PASS | `SECURITY_MODEL.md §3.3` linha 69 (teste 404 especificado) |
| SEC-005 | RLS sem WHERE da aplicação | CRITICAL | PASS | `SECURITY_MODEL.md §3.3` linha 71 (teste específico especificado) |
| SEC-006 | Member removido | HIGH | PASS | `SECURITY_MODEL.md §2` linha 29 + `§3.3` linha 70 (teste) |
| DATA-001 | Profiles sem person_id autorreferente | CRITICAL | PASS | `DATA_MODEL_REVIEW.md §2.1` linhas 40, 48 |
| DATA-002 | Person references | HIGH | PASS | `DATA_MODEL_REVIEW.md §2.1` linha 48 (lista exaustiva `person_id → profiles.id`) |
| DATA-003 | Money BIGINT + currency | CRITICAL | PASS | `DATA_MODEL_REVIEW.md §1` linha 8; ADR 016; zero ocorrências de `float`/`double` monetário no repositório |
| DATA-004 | Quantity + unit | HIGH | PASS | `DATA_MODEL_REVIEW.md §1` linha 9 |
| DATA-005 | Versioning otimista | HIGH | PASS | `DATA_MODEL_REVIEW.md §1` linha 11; `§2.2` linha 65; schema `goals`/`meal_plans`/`workout_plans` com `version` |
| DATA-006 | Progression derivada | HIGH | PASS | `DATA_MODEL_REVIEW.md §2.4` linhas 109-111 |
| MEM-001 | Tipos de memória | MEDIUM | PASS | `ARCHITECTURE.md §7` linha 158 (7 tipos exatos) |
| MEM-002 | Provenance | HIGH | PASS | `DATA_MODEL_REVIEW.md §2.5` linhas 121-122 (`confidence`, `source_type`, `source_ref`, `created_at`, `superseded_by`) |
| MEM-003 | Learned pattern não sobrescreve | HIGH | PASS | `AGENT_CONTRACTS.md §7` linha 145; `DATA_MODEL_REVIEW.md §4` item 3 |
| CONV-001 | conversations/messages | HIGH | PASS | `DATA_MODEL_REVIEW.md §2.5` linhas 118-120 |
| CONV-002 | Reconstrução após crash | HIGH | PASS | `AGENT_CONTRACTS.md §2` linha 59 |
| AI-001 | Contrato canônico AI Provider | CRITICAL | PASS | `AGENT_CONTRACTS.md §13` linhas 285-313 — todos os campos exigidos presentes em request e response |
| AI-002 | Consistência ARCHITECTURE↔AGENT_CONTRACTS | HIGH | PASS | `ARCHITECTURE.md §5` linhas 111-125 (resumo idêntico em forma, aponta §13 como normativo) |
| TOOL-001 | Deny-by-default | CRITICAL | PASS | `AGENT_CONTRACTS.md §4` linha 108; `SECURITY_MODEL.md §4` linha 75 |
| TOOL-002 | Sem execução de código arbitrário | CRITICAL | PASS | `AGENT_CONTRACTS.md §5` linha 112; `SECURITY_MODEL.md §8` linha 141 |
| TOOL-003 | Markdown não é segurança | HIGH | PASS | `SECURITY_MODEL.md §8` linhas 138-140 |
| INJ-001 | Fontes untrusted listadas | HIGH | PASS | `SECURITY_MODEL.md §7` linhas 127-133 |
| INJ-002 | Schema validation não é suficiente sozinha | CRITICAL | PASS | `AGENT_CONTRACTS.md §1` (fluxo: Policy Engine → Capability Check → execução → output validado contra schema — três camadas em série, não uma isolada) |
| SCH-001 | Separação scheduled_jobs/job_runs/AgentTask | CRITICAL | PASS | `docs/adr/021-agenttask-vs-scheduledjob.md`; `AGENT_CONTRACTS.md` header linha 5; `§11` |
| SCH-002 | Atomic claim | CRITICAL | PASS | `AGENT_CONTRACTS.md §11` linha 275 (`UPDATE...WHERE status='pending'...RETURNING`) |
| SCH-003 | Lease | HIGH | PASS | `AGENT_CONTRACTS.md §11` linha 276 |
| SCH-004 | Retry: max_attempts/backoff/jitter | HIGH | PASS | `AGENT_CONTRACTS.md §10` linha 270 |
| SCH-005 | Dead letter | HIGH | PASS | `AGENT_CONTRACTS.md §10` linha 270; `§11` linha 276 |
| SCH-006 | Catch-up (Weekly Planning) | HIGH | PASS (corrigido, ver tabela acima) | `AGENT_CONTRACTS.md §11` (novo parágrafo "Regra de catch-up por tipo de job") |
| SCH-007 | Timezone do household | CRITICAL | PASS | `AGENT_CONTRACTS.md §11` linha 279; `DATA_MODEL_REVIEW.md §2.1` linha 36 (`households.timezone`) |
| PRIV-001 | Consent/export/delete/retention/audit | HIGH | PASS | `PHASE_1_SPEC.md §12` (tabela completa); `SECURITY_MODEL.md §12` |
| PRIV-002 | Sem invenção de obrigação legal | MEDIUM | PASS | `PHASE_1_SPEC.md §12` linha 88 ("isto não é um projeto jurídico, nenhuma obrigação legal além da baseline é presumida") |
| HEALTH-001 | Wellness/health-sensitive/medical | HIGH | PASS | `SECURITY_MODEL.md §13` (tabela de 3 níveis) |
| HEALTH-002 | Não diagnostica, mas organiza/explica | HIGH | PASS | `SECURITY_MODEL.md §13` coluna "Comportamento exigido"; `IMPLEMENTATION_RULES.md` regra 31 |
| FIN-001 | Finance Agent não implementado F1 | CRITICAL | PASS | `PHASE_1_SPEC.md §2` linha 26, `§3` linha 33; ADR 022 |
| FIN-002 | Finance reservado para fase do Roadmap | HIGH | PASS | `ROADMAP.md` Fase 7 (linhas 59-63); `DECISIONS.md` D022 |
| VIS-001 | visibility=household, não aberta | HIGH | PASS | `SECURITY_MODEL.md §12` linha 183 ("Não é uma questão em aberto"); `DECISIONS.md` D020; `docs/adr/020-visibilidade-household.md` |
| DOC-001 | Nenhum conceito obsoleto normativo | CRITICAL | PASS | Ver seção "Busca global de termos obsoletos" abaixo |
| DOC-002 | Single source of truth | HIGH | PASS | Ver "Teste de coerência" abaixo — 1 documento normativo por conceito, sem sobreposição de autoridade |
| DOC-003 | Roadmap consistente | HIGH | PASS | `ROADMAP.md` linha 54 (Fase 6: `scheduled_jobs`/`job_runs`, não `agent_tasks`) |
| SIMPLE-001 | Sem overengineering obrigatório | HIGH | PASS | `ARCHITECTURE.md §1` linha 13; `DECISIONS.md` D002/D010; `IMPLEMENTATION_RULES.md` regra 27 |
| PHASE1-001 | PHASE_1_SPEC.md suficientemente detalhado | CRITICAL | PASS | `PHASE_1_SPEC.md` §4 (arquitetura), §5 (banco), §6 (segurança), §7 (agent runtime), §8 (AI Provider), §9 (memory), §10 (skills), §11 (Policy Engine), §12 (privacidade), §13 (audit) — nenhuma decisão arquitetural deixada em aberto para o implementador |
| PHASE1-002 | Requisitos críticos têm testes | CRITICAL | PASS | `PHASE_1_SPEC.md §14` (9 categorias de teste cobrindo isolamento, capability, Policy Engine, aprovação, máquina de estados, execução idempotente, crash recovery, concorrência otimista, domain units) |
| RULE-001 | IMPLEMENTATION_RULES cobre a lista | CRITICAL | PASS (corrigido, ver tabela acima) | `IMPLEMENTATION_RULES.md` regras 7, 9, 13, 1-2, 2, 7, 21, 15 (float→9, BYPASSRLS→13, capability implícita→15, risk level LLM→1, proposta alterada→2, optimistic concurrency→7, jobs duplicados→21, arbitrary code→15/`AGENT_CONTRACTS.md §5`) |

## Busca global de termos obsoletos (DOC-001)

| Termo | Ocorrências normativas restantes | Classificação |
|---|---|---|
| `riskLevel` (sem "suggested") | Só em `AGENT_CONTRACTS.md §8.2` como campo de `DecisionProposal` (valor **já determinado pelo Policy Engine**, comentário explícito na linha) e em `§8.3` (campo incluído no hash) | VALID — este é o uso correto e intencional (risco autoritativo pós-Policy Engine, não o valor do agente) |
| `suggestedRiskLevel` | `AGENT_CONTRACTS.md §3`, `§6`; `IMPLEMENTATION_RULES.md` regra 1 | VALID |
| `agent_sessions` | `ADR 015` (contexto), `DATA_MODEL_REVIEW.md` (explicando a remoção), `ARCHITECTURE_REVIEW.md` (registro histórico), `ROADMAP.md` ("substituem a antiga agent_sessions") | HISTORICAL — todas as ocorrências dizem explicitamente que foi removida/substituída; nenhuma normativa |
| `agent_tasks` | `ADR 018`/`ADR 021` (contexto do problema), `DATA_MODEL_REVIEW.md`/`ARCHITECTURE.md` (explicando a renomeação), `ARCHITECTURE_REVIEW.md`/`ARCHITECTURE_CONSOLIDATION_RESULT.md`/`DECISIONS.md` (registro histórico) | HISTORICAL — todas marcadas como substituídas por `scheduled_jobs`/`job_runs`; nenhuma normativa |
| `progression` (como tabela) | `DATA_MODEL_REVIEW.md §2.4` (explicando que NÃO é tabela), `ARCHITECTURE_REVIEW.md` C5 (registro do problema), `IMPLEMENTATION_RULES.md` regra 28 (exemplo do que não fazer) | HISTORICAL/OBSOLETE-marcado — nenhuma ocorrência trata `progression` como tabela gravável |
| `progression` (skill/função) | `PROJECT_DISCOVERY.md` (`skills/fitness/progression/SKILL.md`), `ARCHITECTURE.md §4` (`progressionEngine`) | VALID — conceito diferente (skill/função determinística), não a tabela obsoleta |
| `profiles.person_id` | `ARCHITECTURE_REVIEW.md` (registro do problema original), `DATA_MODEL_REVIEW.md §2.1` (explicando que nunca deve existir) | HISTORICAL/OBSOLETE-marcado — schema atual usa `profiles.id` + `person_id → profiles.id` em outras tabelas |
| "Coordinator... Fase 5" | `ARCHITECTURE_REVIEW.md`/`ARCHITECTURE_CONSOLIDATION_RESULT.md`/`ADR 011` (todos descrevendo o problema original ou a correção "mínimo F1, avançado F5") | HISTORICAL — nenhum documento normativo vigente diz que o Coordinator só existe a partir da Fase 5 |
| `consent_recorded_at` | `SECURITY_MODEL.md §12`, `DATA_MODEL_REVIEW.md §2.1`, `ADR 019` (todos contrastando com a tabela `consents` atual), `ARCHITECTURE_REVIEW.md` (texto original preservado com anotação de refinamento) | HISTORICAL — coluna removida do schema (`DATA_MODEL_REVIEW.md` linha 36, `households` não a lista mais) |

**Conclusão DOC-001:** nenhum termo obsoleto é usado como regra normativa vigente em qualquer documento. PASS.

## Teste de coerência entre documentos (§23)

| Concept | Normative document | Referenced documents | Consistent? |
|---|---|---|---|
| Coordinator | `AGENT_CONTRACTS.md §1-2` | `ARCHITECTURE.md §3.1`, `ROADMAP.md` F1/F5, ADR 011 | YES |
| Risk | `AGENT_CONTRACTS.md §6` | `SECURITY_MODEL.md §5`, `ARCHITECTURE.md §3.4`, ADR 012 | YES |
| Approval | `AGENT_CONTRACTS.md §8` | `SECURITY_MODEL.md §6`, `ARCHITECTURE.md §3.5`, ADR 013/023 | YES |
| RLS | `SECURITY_MODEL.md §3` | `DATA_MODEL_REVIEW.md §1.1`, `PHASE_1_SPEC.md §6`, ADR 014 | YES |
| Memory | `AGENT_CONTRACTS.md §7` | `ARCHITECTURE.md §7`, `DATA_MODEL_REVIEW.md §2.5` | YES |
| Scheduler | `AGENT_CONTRACTS.md §11` | `ARCHITECTURE.md §9`, `DATA_MODEL_REVIEW.md §2.5`, ADR 018/021 | YES |
| AI Provider | `AGENT_CONTRACTS.md §13` | `ARCHITECTURE.md §5` (resumo consistente) | YES |
| Profiles | `DATA_MODEL_REVIEW.md §2.1` | `PHASE_1_SPEC.md §5` | YES |
| Money | `DATA_MODEL_REVIEW.md §1` | ADR 016, `IMPLEMENTATION_RULES.md` regra 9 | YES |
| Visibility | `DECISIONS.md` D020 / ADR 020 | `SECURITY_MODEL.md §12` | YES |
| Finance | `ROADMAP.md` Fase 7 / `DECISIONS.md` D022 | `ARCHITECTURE.md §8`/§12, `PHASE_1_SPEC.md §2-3` | YES |
| Privacy | `SECURITY_MODEL.md §12` | `PHASE_1_SPEC.md §12`, ADR 019 | YES |

**PASS** — todos os 12 conceitos consistentes.

## Resultado final

```text
TOTAL CRITERIA: 63
PASS: 63
FAIL: 0

CRITICAL: (30 total)
PASS: 30
FAIL: 0

HIGH: (31 total)
PASS: 31
FAIL: 0

MEDIUM: (2 total)
PASS: 2
FAIL: 0
```

```text
ARCHITECTURE STATUS:
PASS

PHASE 1 STATUS:
READY / NOT READY → READY FOR PHASE 1
```

**Nota (seção 29 do gate):** esta aprovação certifica que a arquitetura e os contratos estão suficientemente fechados para iniciar a implementação — não que o sistema já está seguro em produção. Segurança real exige, na Fase 1 e depois: testes de integração, testes de autorização/RLS de fato executados contra Postgres real, testes de concorrência sob carga, testes de prompt injection contra o AI Provider real, testes de scheduler sob crash real, e revisão de código.
