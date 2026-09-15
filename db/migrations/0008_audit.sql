-- audit_log: append-only (SECURITY_MODEL.md §9). UPDATE/DELETE privileges are revoked from
-- the runtime role in 0010_grants.sql — enforced at the database level, not just convention.

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_type    text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id      text,
  event_type    text NOT NULL,
  entity_type   text,
  entity_id     text,
  before_json   jsonb,
  after_json    jsonb,
  reason        text,
  request_id    uuid,
  agent_run_id  uuid REFERENCES agent_runs(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_household_id_idx ON audit_log (household_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_household_scope ON audit_log
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
