# ADR 019 — Baseline de privacidade/LGPD desde a Fase 1

**Status:** Aceito (consolidação Fase 0.5)

## Contexto
O sistema armazena dados de saúde (sensíveis por definição na LGPD) desde a Fase 2, e dados financeiros a partir da Fase 7. A Fase 0 não estabelecia nenhum mecanismo de consentimento, exportação ou exclusão.

## Decisão
Criar uma tabela dedicada `consents` (`household_id`, `user_id`, `purpose`, `policy_version`, `consented_at`, `revoked_at`) em vez de um único campo solto `consent_recorded_at`. Documentar (mesmo que a execução inicial seja um script administrativo, não uma feature de UI): caminho de exportação de todos os dados de um household; caminho de exclusão/anonimização em cascata, respeitando o que precisa permanecer em `audit_log` por necessidade operacional; retenção por tipo de dado (histórico de saúde não é apagado "por engano" via cascade de outra exclusão). Nenhuma obrigação jurídica específica além dessa baseline é presumida sem validação jurídica futura.

## Alternativas consideradas
- Adiar privacidade para quando o módulo financeiro chegar — rejeitado, dado de saúde já é sensível desde a Fase 2 e retrofitting é mais caro.

## Consequências
- `users`/`households` não precisam mais de `consent_recorded_at` solto — a tabela `consents` é a fonte de verdade, permitindo múltiplos propósitos de consentimento e revogação granular.
