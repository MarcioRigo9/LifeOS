#!/bin/sh
# Runs once, right after 01-roles.sql, ONLY on first container initialization (the official
# postgres image only executes docker-entrypoint-initdb.d/* when the data directory is empty —
# never on a restart of an already-initialized volume). 01-roles.sql itself stays untouched and
# still carries its hardcoded dev-only password (safe: that file is also what local `docker
# compose up` uses, and dev secrets being public is fine) — this script is what gives production
# a real, non-committed lifeos_runtime password, via docker-compose.prod.yml's
# POSTGRES_RUNTIME_PASSWORD (SECURITY_MODEL.md §3.1: no secrets in the repo).
set -e

if [ -z "$POSTGRES_RUNTIME_PASSWORD" ]; then
  echo "02-set-runtime-password.sh: POSTGRES_RUNTIME_PASSWORD not set — leaving the dev-default password in place." >&2
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  ALTER ROLE lifeos_runtime PASSWORD '$POSTGRES_RUNTIME_PASSWORD';
EOSQL
