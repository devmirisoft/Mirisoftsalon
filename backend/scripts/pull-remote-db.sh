#!/usr/bin/env bash
# Replaces the local database with a copy of TARGET_DATABASE_URL.
# The local public schema is dropped and rebuilt from the remote dump, so
# anything only present locally (seed data) is gone afterwards.
#
# Usage: ./scripts/pull-remote-db.sh --yes
set -euo pipefail

cd "$(dirname "$0")/.."
eval "$(grep -E '^(DATABASE_URL|TARGET_DATABASE_URL)=' .env | sed 's/^/export /')"

: "${DATABASE_URL:?DATABASE_URL missing from .env}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL missing from .env}"

remote="$TARGET_DATABASE_URL"
case "$remote" in
  *sslmode=*) ;;
  *\?*) remote="$remote&sslmode=require" ;;
  *) remote="$remote?sslmode=require" ;;
esac
# psql/pg_dump reject Prisma's ?schema= parameter.
local_url="${DATABASE_URL%%\?*}"

if [ "${1:-}" != "--yes" ]; then
  echo "This DROPS the local public schema in $(psql -w "$local_url" -Atc 'select current_database()')"
  echo "and replaces it with the remote copy. Re-run with --yes to proceed."
  exit 1
fi

dump="${TMPDIR:-/tmp}/salon-remote.dump"
echo "==> dumping remote"
PGCONNECT_TIMEOUT=30 pg_dump -w -Fc --no-owner --no-privileges "$remote" -f "$dump"
echo "    $(wc -c <"$dump") bytes"

echo "==> resetting local schema"
psql -w -v ON_ERROR_STOP=1 "$local_url" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

echo "==> restoring"
pg_restore -d "$local_url" --no-owner --no-privileges "$dump"

echo "==> local row counts"
psql -w "$local_url" -c "analyze;" >/dev/null
psql -w "$local_url" -c \
  "select relname, n_live_tup from pg_stat_user_tables where n_live_tup > 0 order by n_live_tup desc limit 15;"
