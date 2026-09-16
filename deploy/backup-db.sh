#!/usr/bin/env bash
# Daily compressed pg_dump with a 7-day local retention window. Intended to run from cron on the
# VPS (see DEPLOY.md for the crontab line) — never touches lifeos_runtime, connects as
# lifeos_admin only for the duration of the dump (pg_dump run INSIDE the db container, so the
# admin credential never needs to leave the Docker-internal network).
#
# Usage: ./deploy/backup-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"
COMPOSE="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"
BACKUP_DIR="./backups"
RETENTION_DAYS=7
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/lifeos-$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"

echo "==> Dumping database to $OUT_FILE"
# Custom format (-Fc): compressed by default AND restorable selectively (pg_restore --list),
# unlike a flat gzip'd SQL file — the better default for real disaster recovery, not just size.
$COMPOSE exec -T db pg_dump -U lifeos_admin -Fc lifeos > "$OUT_FILE"

size="$(du -h "$OUT_FILE" | cut -f1)"
echo "==> Backup written: $OUT_FILE ($size)"

echo "==> Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'lifeos-*.dump' -mtime "+$RETENTION_DAYS" -print -delete

echo "==> Current backups:"
ls -lh "$BACKUP_DIR"/lifeos-*.dump 2>/dev/null || echo "(none)"

# --- Restore (disaster recovery drill — run manually, never automatically) --------------------
# 1. Copy the .dump file onto the target host (or use the one already in ./backups).
# 2. With a running (but presumably empty/fresh) db container:
#      docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
#        pg_restore -U lifeos_admin -d lifeos --clean --if-exists < ./backups/lifeos-<TIMESTAMP>.dump
# 3. Verify: docker compose ... exec db psql -U lifeos_admin -d lifeos -c "SELECT count(*) FROM households;"
# Test this restore path periodically against a scratch database, not production, before you
# actually need it — an untested backup is not a backup.
