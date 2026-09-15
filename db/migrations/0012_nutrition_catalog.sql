-- Fase 3 (Nutrition): global catalog tables — foods, cooking_yields.
-- (ROADMAP.md Fase 3, DATA_MODEL_REVIEW.md §1.1 §2.3)
-- GLOBAL/system-scoped: objective reference data, not household opinion. No household_id,
-- no RLS — same posture as agents/skills/exercises (DATA_MODEL_REVIEW.md §1.1).

CREATE TABLE foods (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  category                 text,
  calories_kcal_per_100g   numeric(6,2) NOT NULL,
  protein_g_per_100g       numeric(5,2) NOT NULL,
  carbs_g_per_100g         numeric(5,2) NOT NULL,
  fat_g_per_100g           numeric(5,2) NOT NULL,
  fiber_g_per_100g         numeric(5,2),
  micronutrients_json      jsonb, -- extensibility escape hatch, avoids an unbounded column list
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX foods_name_idx ON foods (name);

-- Fator de cocção por (food_id, preparation_method) — nunca "um fator por alimento"
-- (DATA_MODEL_REVIEW.md §2.3). yield_factor is a GENERATED column: it is never entered
-- directly, only ever derived from raw_weight_g/cooked_weight_g, so it can never drift out of
-- sync with the two measurements it's computed from.
CREATE TABLE cooking_yields (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id          uuid NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  preparation_method text NOT NULL,
  raw_weight_g     numeric(7,2) NOT NULL CHECK (raw_weight_g > 0),
  cooked_weight_g  numeric(7,2) NOT NULL CHECK (cooked_weight_g > 0),
  yield_factor     numeric(6,4) GENERATED ALWAYS AS (cooked_weight_g / raw_weight_g) STORED,
  source           text NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- A given (food, method) can be re-versioned (corrected) without breaking history: old
-- meal_plan_items/recipe_items reference the cooking_yields ROW id they were computed with,
-- never "food_id + method" resolved live — see recipe_items.cooking_yield_id below.
CREATE UNIQUE INDEX cooking_yields_food_method_version_unique ON cooking_yields (food_id, preparation_method, version);
CREATE INDEX cooking_yields_food_method_idx ON cooking_yields (food_id, preparation_method);
