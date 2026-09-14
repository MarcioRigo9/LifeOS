# ADR 020 — Visibilidade de dados entre membros do household

**Status:** Aceito (consolidação Fase 0.5) — decisão de produto confirmada, com extensibilidade reservada

## Contexto
Não havia definição sobre se Márcio e Brenda veem os dados um do outro por padrão (peso, medidas, decisões, gastos individuais) dentro do mesmo household.

## Decisão
Default: `visibility = household` — todo dado dentro de um household é visível a todos os seus membros ativos. O schema reserva extensibilidade futura para `visibility = private` por registro (ex.: uma coluna/enum em tabelas sensíveis específicas), sem exigir reescrita estrutural, mas essa granularidade **não é implementada na v1** — apenas o campo/enum existe como reservado, com valor fixo `household` até ser decidido o contrário.

## Alternativas consideradas
- Visibilidade privada por padrão com opt-in para compartilhar — rejeitada, contradiz o modelo de produto (household como unidade central de planejamento conjunto).

## Consequências
- Nenhuma tela precisa de controle de visibilidade granular na v1; a extensibilidade é apenas uma reserva de schema para não bloquear uma mudança de produto futura.
