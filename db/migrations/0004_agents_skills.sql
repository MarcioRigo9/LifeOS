-- agents, skills: GLOBAL/system-scoped registries (DATA_MODEL_REVIEW.md §1.1). No household_id,
-- no RLS — read-only lookup tables for the application, written only by migrations/seed.

CREATE TABLE agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL,
  display_name  text NOT NULL
);
CREATE UNIQUE INDEX agents_key_unique ON agents (key);

CREATE TABLE skills (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key       text NOT NULL,
  domain    text NOT NULL,
  version   text NOT NULL,
  checksum  text NOT NULL
);
CREATE UNIQUE INDEX skills_key_unique ON skills (key);

INSERT INTO agents (key, display_name) VALUES
  ('coordinator', 'Coordinator'),
  ('nutrition', 'Nutrition Agent'),
  ('fitness', 'Personal Trainer Agent'),
  ('finance', 'Finance Agent (reservado, inativo até a Fase 7)');
