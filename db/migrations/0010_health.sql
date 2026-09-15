-- Fase 2 (Health — Base): measurements, health_history
-- (ROADMAP.md Fase 2, DATA_MODEL_REVIEW.md §2.2, SECURITY_MODEL.md §13)

CREATE TABLE measurements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  taken_at         timestamptz NOT NULL,
  weight_kg        numeric(5,2) NOT NULL,
  body_fat_pct     numeric(4,2),
  muscle_mass_kg   numeric(5,2),
  waist_cm         numeric(5,2),
  hip_cm           numeric(5,2),
  arm_cm           numeric(5,2),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Loose DB-level sanity bound, defense in depth — the real business validation (20-350kg,
  -- IMPLEMENTATION_RULES.md style "never trust a single layer") lives in packages/domain
  -- (src/lib/domain/health.ts), which rejects with a precise, user-facing message before a
  -- row is ever attempted. This CHECK exists only to make a corrupted/buggy caller impossible,
  -- not to be the primary validation.
  CONSTRAINT measurements_weight_sane CHECK (weight_kg > 0 AND weight_kg < 500),
  CONSTRAINT measurements_body_fat_sane CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 100))
);
CREATE INDEX measurements_household_person_taken_idx ON measurements (household_id, person_id, taken_at DESC);

ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements FORCE ROW LEVEL SECURITY;
CREATE POLICY measurements_household_scope ON measurements
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE health_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('injury', 'surgery', 'allergy', 'chronic_condition', 'continuous_medication')),
  title        text NOT NULL,
  details      text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  recorded_at  timestamptz NOT NULL,
  source       text NOT NULL CHECK (source IN ('user_input', 'checkin', 'doctor_report')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_history_household_person_recorded_idx ON health_history (household_id, person_id, recorded_at DESC);

ALTER TABLE health_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_history FORCE ROW LEVEL SECURITY;
CREATE POLICY health_history_household_scope ON health_history
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
