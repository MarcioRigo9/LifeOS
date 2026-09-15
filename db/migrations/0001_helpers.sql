CREATE EXTENSION IF NOT EXISTS citext;

-- Shared trigger function to keep updated_at current on every UPDATE.
-- (DATA_MODEL_REVIEW.md §1: "Trigger de updated_at ... Padronizar via trigger, não aplicação")
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- RLS session-context helpers. IMPORTANT: current_setting(name, true) returns NULL only for a
-- custom GUC that was NEVER set in this backend's lifetime; once it has been SET LOCAL at least
-- once (even in an earlier, already-committed transaction on a pooled connection) it reverts to
-- '' (empty string) rather than NULL when unset again. Casting '' straight to ::uuid throws,
-- which would turn "forgot to set household context" into a hard error instead of the intended
-- fail-closed "zero rows" (SECURITY_MODEL.md §3.1). NULLIF(..., '') normalizes both cases to a
-- real NULL before the cast, so every RLS policy fails closed the same way regardless of what a
-- previous transaction on the same pooled connection happened to set.
CREATE OR REPLACE FUNCTION app_household_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.household_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;
