-- Grants for the Fase 4 tables (SECURITY_MODEL.md §3.1, same posture as 0009/0011/0014_grants.sql).

-- Global catalog: read-only for the application, same posture as foods/cooking_yields/agents.
GRANT SELECT ON exercises TO lifeos_runtime;

-- workout_plans: has an approval workflow (status/version) — never deleted, only archived.
GRANT SELECT, INSERT, UPDATE ON workout_plans TO lifeos_runtime;
-- workout_plan_items: draft-state composition, same lifecycle latitude as meal_plan_items.
GRANT SELECT, INSERT, UPDATE, DELETE ON workout_plan_items TO lifeos_runtime;

-- workout_sessions: UPDATE is needed for the in_progress -> completed/skipped transition and
-- for duration/notes captured along the way; the append-only-once-concluded guarantee comes
-- from the trigger in 0016, not from withholding UPDATE here.
GRANT SELECT, INSERT, UPDATE ON workout_sessions TO lifeos_runtime;

-- workout_logs: pure append-only, no UPDATE/DELETE at all — a correction is a new row
-- (DATA_MODEL_REVIEW.md §2.4, same posture as measurements in Fase 2).
GRANT SELECT, INSERT ON workout_logs TO lifeos_runtime;
