# ROADMAP.md — LifeOS

> Fases conforme seção 42 do prompt mestre. Cada fase só começa depois da anterior estar concluída e testada — não pular etapas.

## Fase 0 — Discovery ✅
- Estudo de Hermes Agent, OpenClaw, Khoj.
- PROJECT_DISCOVERY.md, ARCHITECTURE.md, DECISIONS.md, ROADMAP.md.
- **Gate de saída:** revisão humana. ✅ concluído, seguiu para Fase 0.5.

## Fase 0.5 — Architecture & Security Review ✅
- Revisão técnica crítica cruzada dos documentos de Fase 0 (contradições, dependências ocultas, decisões irreversíveis).
- ARCHITECTURE_REVIEW.md, SECURITY_MODEL.md, DATA_MODEL_REVIEW.md, AGENT_CONTRACTS.md.
- Consolidação final + closure pass: ADRs 011-023 (`docs/adr/`), `PHASE_1_SPEC.md`, `IMPLEMENTATION_RULES.md`, `ARCHITECTURE_CONSOLIDATION_RESULT.md`.
- **Gate de saída:** nenhuma decisão estrutural relevante em aberto (ver `ARCHITECTURE_CONSOLIDATION_RESULT.md`); aprovação humana explícita antes de iniciar Fase 1.

## Fase 1 — Foundation
- Setup do projeto (Next.js + TypeScript, monorepo), Docker Compose, Postgres com RLS habilitada desde a primeira migration (D014).
- Autenticação, usuários, household/casal (com `timezone`/`locale`/`currency`/`module_finance_enabled`), perfis individuais, `consents` (D019).
- Tabelas de goals e habits + `habit_goal_links` (schema + CRUD básico), com `version` para concorrência otimista (D017).
- **Coordinator mínimo** (D011): recebe entrada do usuário, monta contexto mínimo, invoca AI Provider, valida saída, respeita capabilities e Policy Engine, audita a execução — todo acesso de usuário a um especialista passa por ele desde já.
- Policy Engine (D012): risco calculado no servidor, nunca aceito do agente.
- `conversations`/`messages` (D015) — substituem a antiga `agent_sessions`.
- `agent_memories`/`agent_decisions` (com `proposal_hash`/`status`/`expires_at`, D013).
- `scheduled_jobs`/`job_runs` criadas com as colunas de concorrência/retry (D018), mesmo que o worker completo só rode na Fase 6.
- Sistema de skills: estrutura `SKILL.md` + loader com allowlist por agente, verificado por capability em runtime (não só documentado).
- AI Provider: contrato expandido (retry, timeout, custo, tracing, structured output) + implementação Anthropic.
- `audit_log` funcionando desde o primeiro evento de autenticação.
- Especificação completa e critérios de aceite em `PHASE_1_SPEC.md`.
- **Gate de saída:** ver critérios objetivos em `PHASE_1_SPEC.md` §Gate — inclui testes de isolamento cross-household (RLS + aplicação) e um agente "hello world" respondendo através do Coordinator mínimo, com aprovação humana simulada em ao menos uma ação MEDIUM.

## Fase 2 — Health (base)
- Perfis de saúde, peso, medidas, histórico.
- Estrutura básica para receber dados de Nutrição e Treino (sem os motores completos ainda).
- **Gate de saída:** registro e histórico de peso/medidas funcionando por pessoa.

## Fase 3 — Nutrition
- Alimentos, receitas, refeições, meal plans semanais individualizados.
- Motor determinístico de fator de cocção (`packages/domain`), testado.
- Pesquisa de preços (fonte/data/confiança) e otimizador de custo semanal.
- Geração de lista de compras e instruções de marmita.
- **Gate de saída:** gerar uma semana completa de refeições individualizada para Márcio e Brenda, com lista de compras e custo total real, testado com casos reais.

## Fase 4 — Fitness
- Exercícios, planos de treino individualizados, sessões, logs.
- Motor de progressão (carga/reps/séries/esforço percebido → próximo treino).
- **Gate de saída:** plano semanal de treino individualizado por pessoa com progressão baseada em histórico real.

## Fase 5 — Coordinator avançado
- Coordinator evolui do modo "mínimo" (Fase 1) para contexto global do household, memória compartilhada, roteamento entre múltiplos especialistas, delegação e síntese cross-domain (D011) — o contrato de invocação não muda, só a lógica interna de roteamento.
- Weekly Review: revisão integrada de saúde, nutrição, treino, hábitos, metas.
- **Gate de saída:** Coordinator responde a uma pergunta cruzando Nutrition + Fitness + metas, com decisão/aprovação humana registrada quando aplicável.

## Fase 6 — Automation
- Worker do scheduler rodando de fato sobre o schema `scheduled_jobs`/`job_runs` criado na Fase 1 (claim atômico, lease, retry/backoff, dead-letter — ADR 018).
- Weekly Planning (sábado), Shopping Preparation (domingo), Daily Check-in, notificações.
- Toda automação de risco médio/alto gera proposta, nunca aplica sozinha.
- **Gate de saída:** ciclo completo de sábado (revisar → planejar → gerar compras/treino → aguardar aprovação) executando de ponta a ponta em ambiente real.

## Fase 7 — Finance Ready
- Schema completo de finanças criado agora pela primeira vez (accounts, transactions, credit_cards, debts, budgets, financial_goals) — não existia antes desta fase (D022, supersede D009), seguindo desde a criação RLS (D014), dinheiro em minor units (D016) e concorrência otimista onde aplicável (D017).
- Capabilities do Finance Agent formalizadas a partir do stub reservado na Fase 1; Coordinator continua sem leitura de transações detalhadas (só agregados, ver `SECURITY_MODEL.md §4`).
- Módulo permanece desativado (`module_finance_enabled=false`) — Finance Agent em si **não é implementado** nesta fase.
- **Gate de saída:** schema e permissões prontos, revisados, sem funcionalidade financeira ativa exposta ao usuário.

---

## Fora do roadmap atual (explicitamente adiado)
- Finance Agent (implementação real) — pós Fase 7, mediante nova rodada de planejamento.
- Organização pessoal, agenda, tarefas, rotinas gerais — módulos futuros além da v1 descrita aqui.
- Qualquer canal além do app web (mensageria, mobile nativo).
