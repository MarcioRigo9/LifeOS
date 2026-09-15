-- households, users, sessions, household_members, profiles, consents
-- (DATA_MODEL_REVIEW.md §1.1, §2.1)

CREATE TABLE households (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  timezone                 text NOT NULL DEFAULT 'America/Sao_Paulo',
  locale                   text NOT NULL DEFAULT 'pt-BR',
  currency                 char(3) NOT NULL DEFAULT 'BRL',
  module_finance_enabled   boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- households is self-scoped: the row's own id IS the household scope (DATA_MODEL_REVIEW §1.1).
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE households FORCE ROW LEVEL SECURITY;
CREATE POLICY households_scope ON households
  USING (id = app_household_id())
  WITH CHECK (id = app_household_id());

-- users: global/system-scoped (identity is not household data). No household RLS — protected
-- by application query discipline (findByEmail only during login; findById elsewhere) per
-- DATA_MODEL_REVIEW.md §1.1. No RLS is enabled here on purpose.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE UNIQUE INDEX users_email_unique ON users (email);

-- sessions: also global/system-scoped, looked up by opaque token before any household/user
-- context can be established (bootstrap of the bootstrap). Never exposes a listing endpoint.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE household_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz
);
CREATE UNIQUE INDEX household_members_household_user_unique ON household_members (household_id, user_id);
CREATE INDEX household_members_user_id_idx ON household_members (user_id);

ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members FORCE ROW LEVEL SECURITY;
-- Standard household-scoped access (see all members of the household you're currently in).
CREATE POLICY household_members_household_scope ON household_members
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
-- Bootstrap exception: a user can always see their OWN membership rows, even before
-- app.household_id is known — this is how login resolves "which household(s) am I in".
-- Multiple permissive policies on the same command are OR'd by Postgres.
CREATE POLICY household_members_self_visibility ON household_members
  FOR SELECT
  USING (user_id = app_user_id());

CREATE TABLE profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  display_name  text NOT NULL,
  birth_date    date,
  sex           text,
  height_cm     numeric,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_household_id_idx ON profiles (household_id);
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_household_scope ON profiles
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());

CREATE TABLE consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose        text NOT NULL,
  policy_version text NOT NULL,
  consented_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);
CREATE INDEX consents_household_id_idx ON consents (household_id);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY consents_household_scope ON consents
  USING (household_id = app_household_id())
  WITH CHECK (household_id = app_household_id());
