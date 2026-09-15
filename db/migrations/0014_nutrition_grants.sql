-- Grants for the Fase 3 tables (SECURITY_MODEL.md §3.1, same posture as 0009/0011_grants.sql).

-- Global catalog: read-only for the application, written only by migrations/seed/admin —
-- same posture as agents/skills/exercises (DATA_MODEL_REVIEW.md §1.1).
GRANT SELECT ON foods TO lifeos_runtime;
GRANT SELECT ON cooking_yields TO lifeos_runtime;

-- Household content — the couple's own recipes/ingredients/named meals, full lifecycle.
GRANT SELECT, INSERT, UPDATE, DELETE ON recipes TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_items TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON meals TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON markets TO lifeos_runtime;

-- meal_plans: has an approval workflow (status/version) — never deleted, only archived.
GRANT SELECT, INSERT, UPDATE ON meal_plans TO lifeos_runtime;
-- meal_plan_items: draft-state composition, same lifecycle latitude as habit_goal_links.
GRANT SELECT, INSERT, UPDATE, DELETE ON meal_plan_items TO lifeos_runtime;

-- market_prices: append-only price history — a new capture is a new row, never an overwrite.
GRANT SELECT, INSERT ON market_prices TO lifeos_runtime;

-- shopping_lists: derived from a meal_plan, same "archived not deleted" posture.
GRANT SELECT, INSERT, UPDATE ON shopping_lists TO lifeos_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON shopping_list_items TO lifeos_runtime;
