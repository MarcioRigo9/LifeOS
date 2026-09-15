-- Fase 5 (Coordinator avançado & cross-domain): habit_logs (per-day completion, append-only)
-- and weekly_reviews (persisted Weekly Review report artifact). Both household-scoped + RLS
-- (DATA_MODEL_REVIEW.md §1.1), same posture as the rest of the schema.

CREATE TABLE habit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  habit_id      uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  person_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  logged_date   date NOT NULL,
  completed     boolean NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX habit_logs_household_habit_idx ON habit_logs (household_id, habit_id, logged_date);
-- One completion record per habit per day — a correction is a new day, never editing the past
-- (append-only, same posture as measurements/workout_logs).
CREATE UNIQUE INDEX habit_logs_habit_date_unique ON habit_logs (habit_id, logged_date);

ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY habit_logs_household_scope ON habit_logs
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- The Weekly Review engine's persisted output (Fase 5 spec §2.2): one row per household per
-- reviewed week, holding the full structured report plus a pointer to the composite
-- agent_decisions proposal it produced (nullable — a quiet week with nothing to adjust produces
-- a review with no proposal at all).
CREATE TABLE weekly_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_start_date  date NOT NULL, -- the week being REVIEWED (the one that just ended)
  report_json      jsonb NOT NULL,
  decision_id      uuid REFERENCES agent_decisions(id),
  generated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX weekly_reviews_household_week_idx ON weekly_reviews (household_id, week_start_date DESC);

ALTER TABLE weekly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY weekly_reviews_household_scope ON weekly_reviews
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
