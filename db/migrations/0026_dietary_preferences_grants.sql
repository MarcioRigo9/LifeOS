-- Household-owned content, full lifecycle (create/edit/clear preferences) — same grant shape as
-- recipes/meals/meal_plans (0014_nutrition_grants.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON dietary_preferences TO lifeos_runtime;
