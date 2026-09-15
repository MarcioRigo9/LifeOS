-- Grants for lifeos_runtime on the Fase 5 tables (SECURITY_MODEL.md §3.1).

GRANT SELECT, INSERT ON habit_logs TO lifeos_runtime; -- append-only (unique constraint, no UPDATE/DELETE)
GRANT SELECT, INSERT ON weekly_reviews TO lifeos_runtime; -- append-only, one row per generated review
