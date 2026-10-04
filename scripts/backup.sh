#!/usr/bin/env bash
# Safely backs up the live database to ./backups/qr-YYYYMMDD-HHMMSS.db
# Uses SQLite's online backup API inside the running container (never a raw
# file copy), so it is safe to run while the app is serving scans.
#
# Usage:   scripts/backup.sh
# Keeps the last 30 days of backups (change with KEEP_DAYS=60 scripts/backup.sh).
set -euo pipefail

# cron runs with a minimal PATH; make sure the docker command can be found.
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"

cd "$(dirname "$0")/.."
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="/data/backup-$STAMP.db"
OUT="backups/qr-$STAMP.db"

mkdir -p backups
docker compose exec -T app node dist/backup.js "$TMP"
docker compose cp "app:$TMP" "$OUT"
docker compose exec -T app rm -f "$TMP" "$TMP-wal" "$TMP-shm"

find backups -name 'qr-*.db' -type f -mtime +"$KEEP_DAYS" -delete
echo "Saved $OUT"
