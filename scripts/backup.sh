#!/usr/bin/env bash
# Usage: DATABASE_URL=postgres://... ./scripts/backup.sh [output-dir]
# Creates <dir>/sunpop-YYYYmmdd-HHMMSS.dump (database) and .uploads.tar.gz (uploaded images).
set -euo pipefail
cd "$(dirname "$0")/.."
# Read only DATABASE_URL from .env (the file is not shell-safe: values may contain spaces)
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"; fi
: "${DATABASE_URL:?DATABASE_URL is required}"
OUT="${1:-./backups}"; mkdir -p "$OUT"; STAMP="$(date +%Y%m%d-%H%M%S)"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$OUT/sunpop-$STAMP.dump"
tar -czf "$OUT/sunpop-$STAMP.uploads.tar.gz" -C . uploads
echo "Backup written: $OUT/sunpop-$STAMP.dump and .uploads.tar.gz"
# Keep the newest 14 backups, delete older ones
ls -1t "$OUT"/sunpop-*.dump 2>/dev/null | tail -n +15 | while read -r f; do rm -f "$f" "${f%.dump}.uploads.tar.gz"; done
