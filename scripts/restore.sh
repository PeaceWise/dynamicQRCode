#!/usr/bin/env bash
# Restores the database from a backup file made by scripts/backup.sh.
#
# Usage:   scripts/restore.sh backups/qr-20260101-030000.db
set -euo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"

cd "$(dirname "$0")/.."
FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: scripts/restore.sh backups/qr-YYYYMMDD-HHMMSS.db"
  echo "Available backups:"; ls -1 backups/qr-*.db 2>/dev/null || echo "  (none found)"
  exit 1
fi
FILE_ABS="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"

echo "This REPLACES all current links, scan history and change history"
echo "with the contents of: $FILE"
read -r -p "Type yes to continue: " answer
[ "$answer" = "yes" ] || { echo "Cancelled."; exit 1; }

echo "1/4 Backing up the current database first (just in case)..."
scripts/backup.sh || echo "    (Could not back up the current database - continuing anyway.)"

echo "2/4 Stopping the app..."
docker compose stop app

echo "3/4 Copying the backup into place..."
docker compose run --rm --no-deps -T -v "$FILE_ABS:/restore.db:ro" app \
  sh -c 'cp /restore.db /data/qr.db && rm -f /data/qr.db-wal /data/qr.db-shm'

echo "4/4 Starting the app..."
docker compose start app
echo "Restore complete."
