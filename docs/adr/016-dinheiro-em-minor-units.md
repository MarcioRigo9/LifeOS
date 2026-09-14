# ADR 016 — Valores monetários sempre como inteiro em minor units (centavos)

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
Nenhum documento da Fase 0 fixava uma convenção de tipo para dinheiro. Deixar essa decisão para quando a primeira coluna de preço fosse criada (Fase 3) arrisca inconsistência entre tabelas e, se `float`/`decimal` sem convenção for usado, erros de arredondamento silenciosos em cálculos de custo.

## Decisão
Todo valor monetário é `BIGINT` em unidade monetária mínima (centavos para BRL: R$ 19,90 → `1990`), sempre acompanhado de `currency CHAR(3)` explícito. O household tem uma moeda padrão (`households.currency`, default `BRL`), mas dados capturados externamente (ex.: preço de mercado) preservam a moeda real da fonte, mesmo que hoje só exista BRL em uso. Nunca usar `float`/`double` para dinheiro em nenhuma tabela, presente ou futura (inclusive o schema financeiro reservado para a Fase 7).

## Alternativas consideradas
- `numeric`/`decimal` do Postgres — tecnicamente aceitável, mas rejeitada em favor de inteiro em centavos por simplicidade de manipulação nas funções determinísticas de `packages/domain` e para eliminar qualquer ambiguidade de casas decimais entre banco e aplicação.

## Consequências
- Toda função determinística que opera sobre custo (`weeklyCostOptimizer`, futuras `budgetProjection`/`debtPayoffPlan`) recebe e retorna valores em centavos inteiros.
