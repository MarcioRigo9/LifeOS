# ADR 014 — PostgreSQL Row-Level Security como segunda camada de isolamento

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
O modelo original de isolamento dependia inteiramente de `WHERE household_id = ...` no código da aplicação. Um único endpoint sem esse filtro (erro humano, refactor, nova rota) causaria vazamento total de dados entre households.

## Decisão
Toda tabela com `household_id` tem RLS habilitada (`ENABLE ROW LEVEL SECURITY`) com policy `USING (household_id = current_setting('app.household_id')::uuid)`. A aplicação executa `SET LOCAL app.household_id = $1` no início de cada transação, com o valor resolvido a partir da sessão autenticada (nunca aceito diretamente do payload do cliente). O role de banco usado pela aplicação **não** tem privilégio `BYPASSRLS` nem é superusuário — a política é sempre aplicada, mesmo que o código da aplicação tenha um bug.

## Alternativas consideradas
- Confiar somente em filtro de aplicação — rejeitada (é exatamente a fragilidade identificada; um único bug vaza tudo).
- Isolamento por schema/banco separado por household — rejeitada como overengineering nesta escala (dois usuários hoje); RLS dá a mesma garantia de isolamento sem a complexidade operacional de múltiplos schemas/bancos.

## Consequências
- Testes de isolamento obrigatórios (ver `PHASE_1_SPEC.md`) incluem uma verificação de que a RLS sozinha bloqueia acesso cross-household mesmo quando o `WHERE` da aplicação é propositalmente omitido no teste.
- Toda nova tabela com `household_id` precisa nascer com sua policy RLS — parte do checklist de code review desde a Fase 1.
