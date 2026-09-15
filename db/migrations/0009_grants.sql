-- Grants for lifeos_runtime (SECURITY_MODEL.md §3.1, IMPLEMENTATION_RULES.md #13).
-- lifeos_runtime owns nothing and has none of SUPERUSER/BYPASSRLS — RLS policies from the
-- previous migrations apply to it unconditionally. These GRANTs are the *only* access it has;
-- table ownership stays with lifeos_admin.

GRANT USAGE ON SCHEMA public TO lifeos_runtime;

GRANT SELECT, INSERT, UPDATE ON households TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON users TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO lifeos_runtime; -- delete = logout/revoke
GRANT SELECT, INSERT, UPDATE ON household_members TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON profiles TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON consents TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON goals TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON habits TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON habit_goal_links TO lifeos_runtime;
GRANT SELECT ON agents TO lifeos_runtime;
GRANT SELECT ON skills TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON conversations TO lifeos_runtime;
GRANT SELECT, INSERT ON messages TO lifeos_runtime; -- messages are append-only by convention
GRANT SELECT, INSERT ON agent_memories TO lifeos_runtime; -- append-only (superseded_by, not UPDATE)
GRANT SELECT, INSERT, UPDATE ON agent_decisions TO lifeos_runtime;
GRANT SELECT, INSERT ON decision_executions TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON scheduled_jobs TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON job_runs TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE ON agent_runs TO lifeos_runtime;

-- audit_log: append-only, enforced at grant level, not just convention.
GRANT SELECT, INSERT ON audit_log TO lifeos_runtime;

-- Sequences aren't used (all PKs are gen_random_uuid()), so no sequence grants needed.
