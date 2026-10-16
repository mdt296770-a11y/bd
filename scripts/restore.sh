#!/usr/bin/env bash
# Usage: ./scripts/restore.sh <backup.dump> <target-database-url> [uploads.tar.gz]
# Restores into the TARGET database (it must already exist). Existing objects are dropped first (--clean).
# Practice on a scratch database first; never restore over production without a fresh backup.
set -euo pipefail
DUMP="${1:?backup .dump file}"; TARGET="${2:?target database url}"; UPLOADS="${3:-}"
pg_restore --clean --if-exists --no-owner --dbname="$TARGET" "$DUMP"
if [ -n "$UPLOADS" ]; then tar -xzf "$UPLOADS" -C "$(dirname "$0")/.."; fi
echo "Restore complete."
