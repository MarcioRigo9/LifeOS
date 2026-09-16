-- Frontend extension (cadastros de apoio): lets the app write to the GLOBAL foods/cooking_yields
-- catalog (0014_nutrition_grants.sql previously restricted these to SELECT only — "written only
-- by migrations/seed/admin"). Deliberate, narrow, user-confirmed exception: this app is built
-- for a single trusted household (ARCHITECTURE.md — "dois usuários confiáveis"), foods/cooking_yields
-- carry no household_id column (DATA_MODEL_REVIEW.md §1.1: shared reference data, same posture as
-- exercises), and without this the couple has no way to register an ingredient the app doesn't
-- already know about except a developer manually running scripts/seed-catalog.ts. Still no DELETE:
-- corrections are new cooking_yields VERSIONS (the immutability convention recipe_items already
-- relies on via cooking_yield_id pinning), never destructive edits.

GRANT INSERT, UPDATE ON foods TO lifeos_runtime;
GRANT INSERT, UPDATE ON cooking_yields TO lifeos_runtime;
