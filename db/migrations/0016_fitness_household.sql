-- Fase 4 (Fitness): household-scoped tables — workout_plans -> workout_plan_items ->
-- workout_sessions -> workout_logs. All household-scoped tables use denormalized household_id
-- + RLS (DATA_MODEL_REVIEW.md §1.1), segregated per person_id (DATA_MODEL_REVIEW.md §2.4).

CREATE TABLE workout_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'active', 'archived')),
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workout_plans_household_person_idx ON workout_plans (household_id, person_id, week_start_date);
CREATE TRIGGER workout_plans_set_updated_at BEFORE UPDATE ON workout_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE workout_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY workout_plans_household_scope ON workout_plans
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE workout_plan_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  workout_plan_id uuid NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  exercise_id  uuid NOT NULL REFERENCES exercises(id),
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Monday .. 6=Sunday
  order_index  smallint NOT NULL DEFAULT 0,
  target_sets  smallint NOT NULL CHECK (target_sets > 0),
  min_reps     smallint NOT NULL CHECK (min_reps > 0),
  max_reps     smallint NOT NULL CHECK (max_reps >= min_reps),
  target_rpe   numeric(3,1) NOT NULL CHECK (target_rpe >= 1.0 AND target_rpe <= 10.0),
  target_load_kg numeric(5,2) CHECK (target_load_kg IS NULL OR target_load_kg > 0)
);
CREATE INDEX workout_plan_items_plan_idx ON workout_plan_items (workout_plan_id);
CREATE INDEX workout_plan_items_household_id_idx ON workout_plan_items (household_id);

ALTER TABLE workout_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_plan_items FORCE ROW LEVEL SECURITY;
CREATE POLICY workout_plan_items_household_scope ON workout_plan_items
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE workout_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  workout_plan_id uuid REFERENCES workout_plans(id) ON DELETE SET NULL, -- nullable: an ad-hoc session need not follow a plan
  performed_at    timestamptz NOT NULL,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  status          text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'skipped')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workout_sessions_household_person_idx ON workout_sessions (household_id, person_id, performed_at DESC);

ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY workout_sessions_household_scope ON workout_sessions
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- Append-only once concluded (IMPLEMENTATION_RULES.md pattern from Fase 2's measurements, here
-- enforced with a trigger rather than a blanket no-UPDATE grant, because a session legitimately
-- needs to transition in_progress -> completed/skipped and gather duration/notes along the way
-- — the thing that must never change is a session that has ALREADY been marked completed/skipped.
CREATE OR REPLACE FUNCTION enforce_workout_session_immutable_once_concluded()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('completed', 'skipped') THEN
    RAISE EXCEPTION 'workout_sessions row % is already % — concluded sessions are append-only', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workout_sessions_enforce_append_only
  BEFORE UPDATE ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_workout_session_immutable_once_concluded();

-- Pure append-only, series-by-series (DATA_MODEL_REVIEW.md §2.4) — a correction is a new row,
-- never an UPDATE (enforced at grant level, 0017_fitness_grants.sql, same posture as
-- measurements in Fase 2).
CREATE TABLE workout_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  workout_session_id uuid NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id        uuid NOT NULL REFERENCES exercises(id),
  set_number         smallint NOT NULL CHECK (set_number > 0),
  reps               smallint NOT NULL CHECK (reps > 0),
  load_kg            numeric(5,2) NOT NULL CHECK (load_kg > 0),
  rpe                numeric(3,1) CHECK (rpe IS NULL OR (rpe >= 1.0 AND rpe <= 10.0)),
  completed          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workout_logs_household_person_idx ON workout_logs (household_id, workout_session_id, exercise_id);
CREATE UNIQUE INDEX workout_logs_session_exercise_set_unique ON workout_logs (workout_session_id, exercise_id, set_number);

ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY workout_logs_household_scope ON workout_logs
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
