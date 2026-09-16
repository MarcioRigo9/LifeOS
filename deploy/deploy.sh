#!/usr/bin/env bash
# Pre-deploy bootstrap + rolling(-ish) deploy for the LifeOS production stack.
# Run from the repo root on the VPS: ./deploy/deploy.sh [--seed-catalog]
#
# What it does, in order:
#   1. Validates .env.production has every mandatory variable set.
#   2. Builds the web/worker images.
#   3. Brings up (or reuses) a healthy db, then runs migrations as a one-off task using the
#      worker image (it already has tsx + scripts/ + DATABASE_URL_ADMIN — see
#      docker-compose.prod.yml's comment on the worker service).
#   4. Optionally seeds the global catalog (idempotent — scripts/seed-catalog.ts checks by name
#      before inserting) when --seed-catalog is passed.
#   5. Recreates only the containers whose image actually changed (web/worker/caddy) — db is
#      left running throughout, so active sessions and in-flight scheduler leases are never
#      torn down by a deploy (SECURITY_MODEL.md — leases expiring mid-deploy are recovered by
#      the worker's own reaper on the next poll, same as any other crash, ADR 018).
#   6. Waits for the web healthcheck and reports the final status.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"
COMPOSE="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"
SEED_CATALOG=false

for arg in "$@"; do
  case "$arg" in
    --seed-catalog) SEED_CATALOG=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

echo "==> Checking prerequisites"
command -v docker >/dev/null || { echo "docker is not installed." >&2; exit 1; }
docker compose version >/dev/null || { echo "docker compose (v2 plugin) is not available." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found — copy .env.production.example first." >&2; exit 1; }

echo "==> Validating $ENV_FILE"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
REQUIRED_VARS="POSTGRES_ADMIN_PASSWORD POSTGRES_RUNTIME_PASSWORD ANTHROPIC_API_KEY APP_URL ACME_EMAIL"
missing=""
for var in $REQUIRED_VARS; do
  if [ -z "${!var:-}" ]; then missing="$missing $var"; fi
done
if [ -n "$missing" ]; then
  echo "Missing required variables in $ENV_FILE:$missing" >&2
  exit 1
fi

echo "==> Building images"
$COMPOSE build

echo "==> Starting database (if not already running)"
$COMPOSE up -d db
echo "==> Waiting for database to report healthy"
for i in $(seq 1 30); do
  status="$($COMPOSE ps --format json db 2>/dev/null | grep -o '"Health":"[a-z]*"' | cut -d'"' -f4 || true)"
  if [ "$status" = "healthy" ]; then break; fi
  sleep 2
done
if [ "$status" != "healthy" ]; then
  echo "Database did not become healthy in time." >&2
  $COMPOSE logs db
  exit 1
fi

echo "==> Running pending migrations (0001-0023+, via the worker image's admin credentials)"
$COMPOSE run --rm worker npm run migrate

if [ "$SEED_CATALOG" = true ]; then
  echo "==> Seeding the global foods/exercises catalog (idempotent)"
  $COMPOSE run --rm worker npm run seed:catalog
fi

echo "==> Recreating web, worker and caddy with the newly built images"
$COMPOSE up -d --remove-orphans web worker caddy

echo "==> Waiting for the web service healthcheck"
for i in $(seq 1 30); do
  status="$($COMPOSE ps --format json web 2>/dev/null | grep -o '"Health":"[a-z]*"' | cut -d'"' -f4 || true)"
  if [ "$status" = "healthy" ]; then break; fi
  sleep 2
done
if [ "$status" != "healthy" ]; then
  echo "web did not become healthy in time — check logs with: $COMPOSE logs web" >&2
  exit 1
fi

echo "==> Deploy complete. Service status:"
$COMPOSE ps
