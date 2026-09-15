-- Runs once when the Postgres data volume is first initialized (docker-entrypoint-initdb.d).
-- Creates the runtime role used by the application at request time.
--
-- lifeos_admin (POSTGRES_USER) is the initial superuser — used ONLY for running migrations
-- (packages/db migrate script) and administrative tasks. The application NEVER connects as
-- lifeos_admin at request time (IMPLEMENTATION_RULES.md #13, SECURITY_MODEL.md §3.1).
--
-- lifeos_runtime is what the app connects as for every request. It explicitly has none of
-- SUPERUSER / BYPASSRLS / CREATEDB / CREATEROLE, and does not own any table — so Row-Level
-- Security policies always apply to it, even if application code forgets a WHERE clause
-- (ADR 014).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'lifeos_runtime') THEN
    CREATE ROLE lifeos_runtime LOGIN PASSWORD 'lifeos_runtime_dev_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE lifeos TO lifeos_runtime;
