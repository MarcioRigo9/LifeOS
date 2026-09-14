# ADR 011 — Coordinator existe desde a Fase 1

**Status:** Aceito (consolidação Fase 0.5)
**Supersede:** resolve a contradição C1 identificada em `ARCHITECTURE_REVIEW.md` entre `ROADMAP.md` (Coordinator só na Fase 5) e `PROJECT_DISCOVERY.md §4` ("Coordinator é único ponto de contato").

## Contexto
O Roadmap original colocava o Coordinator Agent apenas na Fase 5, mas o gate de saída da Fase 3 (Nutrition) já exigia um Nutrition Agent respondendo diretamente ao usuário — o que contradiz o princípio "agentes especializados nunca são isolados, Coordinator é o único ponto de contato."

## Decisão
O Coordinator existe desde a Fase 1, em duas versões de capacidade:
- **Fase 1 — Coordinator mínimo:** recebe a entrada do usuário, monta contexto mínimo (household/perfil/memória relevante), invoca o AI Provider, valida saída contra schema, respeita capabilities e Policy Engine, registra a execução (`agent_runs`). Não faz síntese cross-domain nem roteamento sofisticado — nas Fases 2-4 ele efetivamente repassa a intenção do usuário ao único especialista relevante daquele domínio.
- **Fase 5 — Coordinator avançado:** ganha contexto global do household, roteamento entre múltiplos especialistas, delegação, síntese cross-domain (ex.: Nutrition + Fitness + Goals) e Weekly Review.

Todo acesso do usuário a um especialista passa pelo Coordinator em todas as fases — nunca existe uma rota que fale diretamente com Nutrition/Fitness/Finance sem passar por ele.

## Alternativas consideradas
- Manter especialistas acessíveis diretamente nas Fases 2-4 e só introduzir o Coordinator na Fase 5 — rejeitada, pois exigiria retrabalho de rota/contrato quando o Coordinator chegasse, e contradiz o princípio "nunca isolados" durante quatro fases inteiras.

## Consequências
- O contrato `AgentTask`/`CoordinatorInvocation` (ver `AGENT_CONTRACTS.md`) é construído uma única vez na Fase 1 e não muda de forma quando o Coordinator ganha inteligência na Fase 5 — só a lógica interna de roteamento evolui.
- `ROADMAP.md` Fase 1 passa a listar explicitamente "Coordinator mínimo" como entregável.
