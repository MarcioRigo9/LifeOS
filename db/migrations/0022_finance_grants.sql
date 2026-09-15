-- Grants for lifeos_runtime on the Fase 7 finance tables (SECURITY_MODEL.md §3.1).

GRANT SELECT, INSERT, UPDATE ON financial_accounts TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON financial_credit_cards TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON financial_categories TO lifeos_runtime;
-- Append-only, same posture as measurements/workout_logs/market_prices: a correction is a new
-- transaction (e.g. a refund), never an UPDATE erasing what happened.
GRANT SELECT, INSERT ON financial_transactions TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON financial_debts TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON financial_budgets TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON financial_goals TO lifeos_runtime;
