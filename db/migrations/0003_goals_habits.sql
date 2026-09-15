-- goals, habits, habit_goal_links (DATA_MODEL_REVIEW.md §2.2)

CREATE TABLE goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id      uuid REFERENCES profiles(id) ON DELETE SET NULL, -- nullable: household-wide goals belong to no single person
  title          text NOT NULL,
  metric         text,
  target_value   numeric,
  current_value  numeric,
  start_value    numeric,
  deadline       date,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goals_household_id_idx ON goals (household_id, created_at);
CREATE TRIGGER goals_set_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals FORCE ROW LEVEL SECURITY;
CREATE POLICY goals_household_scope ON goals
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE habits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title         text NOT NULL,
  frequency     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX habits_household_id_idx ON habits (household_id);

ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits FORCE ROW LEVEL SECURITY;
CREATE POLICY habits_household_scope ON habits
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE habit_goal_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  habit_id      uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  goal_id       uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX habit_goal_links_unique ON habit_goal_links (habit_id, goal_id);

ALTER TABLE habit_goal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_goal_links FORCE ROW LEVEL SECURITY;
CREATE POLICY habit_goal_links_household_scope ON habit_goal_links
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
