-- Fase 4 (Fitness): global catalog — exercises.
-- (ROADMAP.md Fase 4, DATA_MODEL_REVIEW.md §1.1 §2.4)
-- GLOBAL/system-scoped: an exercise definition is objective reference data, same posture as
-- foods/cooking_yields (Fase 3) and agents/skills (Fase 1). No household_id, no RLS.

CREATE TABLE exercises (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  primary_muscle_group   text NOT NULL,
  secondary_muscle_groups text[] NOT NULL DEFAULT '{}',
  equipment              text,
  movement_pattern       text, -- e.g. 'push', 'pull', 'hinge', 'squat', 'carry', 'isolation'
  exercise_type          text NOT NULL CHECK (exercise_type IN ('compound', 'isolation')),
  -- Joint/region stressed — used to filter out exercises contraindicated by an active
  -- health_history entry (e.g. shoulder tendinitis -> exclude body_region='shoulders').
  -- Deliberately a single coarse tag, not a clinical model (SECURITY_MODEL.md §13 — this is
  -- wellness-tier exclusion logic, not a medical judgment).
  body_region            text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exercises_body_region_idx ON exercises (body_region);
