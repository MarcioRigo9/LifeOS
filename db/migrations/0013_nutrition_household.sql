-- Fase 3 (Nutrition): household-scoped tables — recipes, meals, meal_plans, markets, shopping.
-- All household-scoped tables use denormalized household_id + RLS (DATA_MODEL_REVIEW.md §1.1).

CREATE TABLE recipes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name           text NOT NULL,
  instructions   text,
  servings       integer NOT NULL DEFAULT 1 CHECK (servings > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recipes_household_id_idx ON recipes (household_id);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY recipes_household_scope ON recipes
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- Ingredients in RAW weight (DATA_MODEL_REVIEW.md §2.3) — cooking_yield_id pins the exact
-- cooking_yields row used at the time the recipe item was created, so a later correction to
-- cooking_yields (new version) never silently changes an existing recipe's computed yield
-- (immutability requirement in this phase's test battery).
CREATE TABLE recipe_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recipe_id        uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  food_id          uuid NOT NULL REFERENCES foods(id),
  cooking_yield_id uuid REFERENCES cooking_yields(id), -- null when the food is eaten raw (no cooking step)
  raw_grams        numeric(7,2) NOT NULL CHECK (raw_grams > 0)
);
CREATE INDEX recipe_items_recipe_id_idx ON recipe_items (recipe_id);
CREATE INDEX recipe_items_household_id_idx ON recipe_items (household_id);

ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_items FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_items_household_scope ON recipe_items
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE meals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recipe_id     uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meals_household_id_idx ON meals (household_id);

ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals FORCE ROW LEVEL SECURITY;
CREATE POLICY meals_household_scope ON meals
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE meal_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'active', 'archived')),
  version        integer NOT NULL DEFAULT 1,
  approved_by    uuid REFERENCES profiles(id),
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meal_plans_household_week_idx ON meal_plans (household_id, week_start_date);

ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY meal_plans_household_scope ON meal_plans
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE meal_plan_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  meal_plan_id   uuid NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  meal_id        uuid NOT NULL REFERENCES meals(id),
  person_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day_of_week    smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Monday .. 6=Sunday
  planned_cooked_grams numeric(7,2) NOT NULL CHECK (planned_cooked_grams > 0)
);
CREATE INDEX meal_plan_items_plan_idx ON meal_plan_items (meal_plan_id);
CREATE INDEX meal_plan_items_household_id_idx ON meal_plan_items (household_id);

ALTER TABLE meal_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_items FORCE ROW LEVEL SECURITY;
CREATE POLICY meal_plan_items_household_scope ON meal_plan_items
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE markets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          text NOT NULL,
  location      text
);
CREATE INDEX markets_household_id_idx ON markets (household_id);

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets FORCE ROW LEVEL SECURITY;
CREATE POLICY markets_household_scope ON markets
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- Real prices only (SECURITY_MODEL.md §7: web content is UNTRUSTED DATA, never invented).
-- captured_at is never overwritten — a new capture is a new row, giving a real price history.
CREATE TABLE market_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  market_id      uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  food_id        uuid NOT NULL REFERENCES foods(id),
  brand          text,
  package_size_g numeric(7,2) NOT NULL CHECK (package_size_g > 0),
  package_unit   text NOT NULL DEFAULT 'g',
  price_cents    bigint NOT NULL CHECK (price_cents > 0),
  currency       char(3) NOT NULL DEFAULT 'BRL',
  captured_at    timestamptz NOT NULL,
  source         text NOT NULL,
  source_url     text,
  confidence     numeric(3,2) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  promo          boolean NOT NULL DEFAULT false
);
CREATE INDEX market_prices_food_captured_idx ON market_prices (household_id, food_id, captured_at DESC);
-- Same capture repeated for the same offer is a duplicate, not a new price point.
CREATE UNIQUE INDEX market_prices_offer_capture_unique ON market_prices (market_id, food_id, package_size_g, captured_at);

ALTER TABLE market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY market_prices_household_scope ON market_prices
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE shopping_lists (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  meal_plan_id   uuid NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'active', 'archived')),
  version        integer NOT NULL DEFAULT 1,
  total_cost_cents bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shopping_lists_household_id_idx ON shopping_lists (household_id);

ALTER TABLE shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY shopping_lists_household_scope ON shopping_lists
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE shopping_list_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  shopping_list_id      uuid NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  food_id               uuid NOT NULL REFERENCES foods(id),
  needed_raw_grams      numeric(9,2) NOT NULL CHECK (needed_raw_grams >= 0),
  market_price_id       uuid REFERENCES market_prices(id),
  buy_qty               integer NOT NULL DEFAULT 0 CHECK (buy_qty >= 0),
  surplus_grams         numeric(9,2) NOT NULL DEFAULT 0 CHECK (surplus_grams >= 0),
  estimated_cost_cents  bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_cents >= 0),
  price_unavailable     boolean NOT NULL DEFAULT false -- explicit "we don't know the price", never a guessed price
);
CREATE INDEX shopping_list_items_list_idx ON shopping_list_items (shopping_list_id);
CREATE INDEX shopping_list_items_household_id_idx ON shopping_list_items (household_id);

ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_items FORCE ROW LEVEL SECURITY;
CREATE POLICY shopping_list_items_household_scope ON shopping_list_items
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

-- Individualized macro targets (needed to compute per-person calories/macros for the weekly
-- plan). Nullable: a profile can exist without these set yet.
ALTER TABLE profiles ADD COLUMN activity_level text
  CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active'));
ALTER TABLE profiles ADD COLUMN nutrition_goal text
  CHECK (nutrition_goal IN ('lose_weight', 'maintain', 'gain_muscle'));
