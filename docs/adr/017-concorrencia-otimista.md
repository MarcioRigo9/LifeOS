# ADR 017 — Concorrência otimista em entidades editáveis por humanos

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
Nenhum mecanismo impedia que Márcio e Brenda, editando o mesmo `meal_plan`/`workout_plan`/`goal` ao mesmo tempo, sobrescrevessem silenciosamente a edição um do outro (last-write-wins sem aviso).

## Decisão
`goals`, `meal_plans`, `workout_plans` e `agent_decisions` ganham coluna `version integer not null default 1`. Todo update relevante exige `WHERE version = :expected` e incrementa a versão; se a condição não bater (alguém editou entre a leitura e a escrita), a operação falha explicitamente e a UI trata o conflito (recarregar/mostrar diff) — nunca sobrescreve sem avisar.

## Alternativas consideradas
- Last-write-wins sem verificação — rejeitada, responde diretamente "não" à pergunta de concorrência levantada na revisão de segurança.
- Locking pessimista (transação longa segurando lock) — rejeitado como desnecessariamente complexo para edições de UI feitas por humanos, não processos concorrentes de alta frequência.

## Consequências
- Toda tela de edição desses recursos precisa carregar e reenviar a `version` atual como parte do payload de update.
