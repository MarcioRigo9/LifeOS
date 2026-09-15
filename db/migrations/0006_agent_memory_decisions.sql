-- agent_memories, agent_decisions, decision_executions
-- (ADR 013, ADR 023, AGENT_CONTRACTS.md §7-8, DATA_MODEL_REVIEW.md §2.5)

CREATE TABLE agent_memories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type           text NOT NULL CHECK (type IN ('profile', 'preference', 'historical', 'goal', 'decision', 'context', 'learned_pattern')),
  content_json   jsonb NOT NULL,
  confidence     numeric NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source_type    text NOT NULL CHECK (source_type IN ('human_confirmed', 'agent_inferred', 'system')),
  source_ref     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  superseded_by  uuid REFERENCES agent_memories(id)
);
CREATE INDEX agent_memories_household_type_idx ON agent_memories (household_id, type, created_at DESC);

ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_memories_household_scope ON agent_memories
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- learned_pattern must never masquerade as a human-confirmed fact (AGENT_CONTRACTS.md §7,
-- IMPLEMENTATION_RULES.md #20): confidence is forced below 1.0 for inferred memories.
ALTER TABLE agent_memories ADD CONSTRAINT agent_memories_learned_pattern_confidence
  CHECK (type <> 'learned_pattern' OR confidence < 1.0);

CREATE TABLE agent_decisions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id                uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  agent_id                    uuid NOT NULL REFERENCES agents(id),
  action_envelope_json        jsonb NOT NULL,
  risk_level                  text NOT NULL CHECK (risk_level IN ('medium', 'high')),
  proposal_hash               text NOT NULL,
  status                      text NOT NULL DEFAULT 'PENDING'
                               CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTING', 'EXECUTED', 'FAILED')),
  approved_by                 uuid REFERENCES profiles(id),
  approved_at                 timestamptz,
  expires_at                  timestamptz NOT NULL,
  execution_started_at        timestamptz,
  execution_lease_expires_at  timestamptz,
  attempts                    integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_decisions_household_status_idx ON agent_decisions (household_id, status);
CREATE UNIQUE INDEX agent_decisions_proposal_hash_unique ON agent_decisions (proposal_hash);

ALTER TABLE agent_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_decisions_household_scope ON agent_decisions
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- Defense in depth (AGENT_CONTRACTS.md §8.4): the valid state machine is enforced twice —
-- once in application code, once here at the database level, so a bug in the app layer
-- cannot silently skip a state or perform an arbitrary transition.
CREATE OR REPLACE FUNCTION enforce_decision_transition()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF (OLD.status, NEW.status) NOT IN (
      ('PENDING', 'APPROVED'), ('PENDING', 'REJECTED'), ('PENDING', 'EXPIRED'),
      ('APPROVED', 'EXECUTING'), ('APPROVED', 'EXPIRED'),
      ('EXECUTING', 'EXECUTED'), ('EXECUTING', 'FAILED'),
      -- Not a business transition: infrastructure recovery only (AGENT_CONTRACTS.md §8.6),
      -- used exclusively by the crash-recovery reaper to requeue a decision whose execution
      -- lease expired with no decision_executions row (i.e. the transaction never committed).
      ('EXECUTING', 'APPROVED')
    ) THEN
      RAISE EXCEPTION 'invalid agent_decisions status transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_decisions_enforce_transition
  BEFORE UPDATE ON agent_decisions
  FOR EACH ROW EXECUTE FUNCTION enforce_decision_transition();

CREATE TABLE decision_executions (
  decision_id  uuid PRIMARY KEY REFERENCES agent_decisions(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  request_id   uuid NOT NULL,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL,
  status       text NOT NULL CHECK (status IN ('executed', 'failed')),
  result_json  jsonb,
  error_json   jsonb
);

ALTER TABLE decision_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_executions_household_scope ON decision_executions
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
