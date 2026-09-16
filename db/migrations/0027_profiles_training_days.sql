-- Fixes the workout-split bug (every exercise on every one of 3 hardcoded days): the split
-- builder (lib/domain/fitness.ts's buildWeeklySplit) needs to know how many days/week a person
-- trains to choose between PPL (3), Upper/Lower (4) or a 5-day split. Nullable, like
-- activity_level/nutrition_goal (0013_nutrition_household.sql) — gatherWeeklyWorkoutPlanningContext
-- defaults a NULL value to 3 (the most common split) rather than blocking plan generation.
ALTER TABLE profiles ADD COLUMN training_days_per_week smallint
  CHECK (training_days_per_week IS NULL OR training_days_per_week IN (3, 4, 5));
