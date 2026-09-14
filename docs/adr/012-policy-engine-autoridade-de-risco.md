# ADR 012 — Policy Engine é a autoridade exclusiva de risco

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
A proposta original do contrato `AgentTask` incluía um campo `riskLevel` preenchido pelo próprio agente/LLM, sem um dono de servidor definido — permitindo, em tese, que um agente comprometido ou mal instruído declarasse `"riskLevel": "low"` para uma ação de alto impacto e escapasse da aprovação humana.

## Decisão
O agente pode enviar apenas `suggestedRiskLevel` (informativo, usado no máximo para UX). O risco real e autoritativo (`riskLevel`) é sempre calculado no servidor por um **Policy Engine** determinístico, a partir de: tipo de ação, escopo/quantidade de dados afetados, reversibilidade, e uma tabela de regras fixas (allowlist de ações intrinsecamente LOW). O valor sugerido pelo agente nunca substitui o valor calculado pelo Policy Engine.

Fluxo: `Agent → suggestedRiskLevel → Policy Engine → riskLevel real → Capability Check → LOW (executa) | MEDIUM/HIGH (gera proposta, aguarda aprovação)`.

## Alternativas consideradas
- Confiar no `riskLevel` enviado pelo agente — rejeitada, é a vulnerabilidade central que motivou este ADR.
- Aprovação manual para toda ação, independentemente de risco — rejeitada, fricção excessiva incompatível com automação útil no dia a dia.

## Consequências
- Toda ação de agente passa obrigatoriamente pelo Policy Engine antes de executar, mesmo ações aparentemente triviais.
- A tabela de regras de risco é código versionado, revisável e testável — não configuração implícita dentro de um prompt.
