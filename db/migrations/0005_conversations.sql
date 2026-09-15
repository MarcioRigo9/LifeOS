-- conversations, messages (ADR 015, DATA_MODEL_REVIEW.md §2.5)

CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
CREATE INDEX conversations_household_id_idx ON conversations (household_id, started_at);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY conversations_household_scope ON conversations
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  person_id        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  role             text NOT NULL CHECK (role IN ('user', 'agent', 'system', 'tool')),
  agent_id         uuid REFERENCES agents(id),
  content          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_id_idx ON messages (conversation_id, created_at);
CREATE INDEX messages_household_id_idx ON messages (household_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_household_scope ON messages
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
