# ADR 022 — Schema financeiro completo somente na Fase 7 (supersede D009)

**Status:** Aceito (consolidação Fase 0.5) — **SUPERSEDES D009**

## Contexto
`DECISIONS.md` D009 (Fase 0) afirmava que "tabelas de finanças e capabilities.json de um futuro Finance Agent existem desde a Fase 1, com `module_enabled=false`" — e `ARCHITECTURE.md §8/§12` repetiam essa mesma ideia de schema financeiro completo presente desde a Fase 1. Isso contradizia o próprio `ROADMAP.md`, que sempre colocou a criação do schema financeiro completo apenas na Fase 7. A consolidação resolve a favor do Roadmap: criar tabelas financeiras completas quatro fases antes de serem usadas é trabalho antecipado sem necessidade e aumenta a superfície de dado sensível exposta sem uso real.

## Decisão
Na Fase 1, apenas o seguinte é reservado (não o schema completo):
- `households.module_finance_enabled boolean default false`.
- Uma entrada de registro em `agents` (`key='finance'`) e em `skills` (domínio `finance/`, conforme já estruturado nos manifestos `SKILL.md`), marcadas como inativas.
- Um `capabilities.json` de exemplo/reservado para o Finance Agent, versionado mas não carregado por nenhum middleware ativo.

As tabelas `accounts`, `transactions`, `credit_cards`, `debts`, `budgets`, `financial_goals` são criadas **somente na Fase 7**, seguindo desde a criação as convenções canônicas já fixadas (RLS — ADR 014; dinheiro em minor units — ADR 016; concorrência otimista onde aplicável — ADR 017).

## Alternativas consideradas
- Criar o schema financeiro completo na Fase 1 "para não precisar migrar depois" (posição original de D009) — rejeitada: adicionar tabelas novas na Fase 7 é uma migration aditiva simples (não é uma migração de dados existentes, já que não há dados financeiros antes disso); manter tabelas vazias por seis fases não traz benefício real e aumenta a superfície de auditoria/RLS a manter sem necessidade.

## Consequências
- `ARCHITECTURE.md` e `DECISIONS.md` são atualizados para remover a afirmação de que o schema financeiro existe desde a Fase 1, mantendo D009 visível no histórico com a marcação `SUPERSEDED BY D022`.
