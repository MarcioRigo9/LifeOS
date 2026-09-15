-- Grants for the Fase 2 tables (SECURITY_MODEL.md §3.1, same posture as 0009_grants.sql).

-- measurements: append-only, enforced at the grant level — no UPDATE, no DELETE, ever.
-- A correction is a new row (IMPLEMENTATION_RULES.md / this migration's own CHECK comments).
GRANT SELECT, INSERT ON measurements TO lifeos_runtime;

-- health_history: append-only for every column except `active` (marking a condition resolved
-- is the one legitimate mutation) — a column-level GRANT makes this a database-enforced fact,
-- not just an application convention.
GRANT SELECT, INSERT ON health_history TO lifeos_runtime;
GRANT UPDATE (active) ON health_history TO lifeos_runtime;
