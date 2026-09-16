-- Dietary preferences & household meal-prep logistics (redesign phase): per-person food
-- rejections/reheat-intolerances and the couple's weekly prep schedule (marmita vs. fresh),
-- consumed by the Nutrition Agent's weekly plan assembler (mealPlans.ts) to keep it from ever
-- allocating a reheat-intolerant food to that person's Mon-Fri lunch (marmita) slot.
-- Denormalized household_id + RLS, same pattern as every other household-scoped table
-- (DATA_MODEL_REVIEW.md §1.1). One row per person — UNIQUE(person_id) makes upsert well-defined.

CREATE TABLE dietary_preferences (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id             uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  person_id                uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Free-text food labels (not food_id references — this is a couple self-tagging broad
  -- categories like "Frango" or "Peixe", not picking exact catalog rows). Matched against
  -- foods.name via foodNameMatchesAnyTag (lib/domain/nutrition.ts) at plan-generation time.
  disliked_foods           text[] NOT NULL DEFAULT '{}',
  reheat_intolerant_foods  text[] NOT NULL DEFAULT '{}',
  -- Weekly prep logistics, e.g. {"lunch": "prepped_sunday", "dinner": "fresh"} — validated at
  -- the API boundary (Zod), not by the schema; informational today, read by the UI, not yet by
  -- the assembler itself (which already infers marmita=lunch / fresh=dinner from meal type).
  prep_schedule             jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id)
);
CREATE INDEX dietary_preferences_household_id_idx ON dietary_preferences (household_id);
CREATE TRIGGER dietary_preferences_set_updated_at BEFORE UPDATE ON dietary_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE dietary_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE dietary_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY dietary_preferences_household_scope ON dietary_preferences
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
