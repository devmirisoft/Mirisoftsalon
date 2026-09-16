#!/usr/bin/env bash
# Read-only: dumps TARGET_DATABASE_URL to a local file. Touches nothing else.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(grep -E '^TARGET_DATABASE_URL=' .env | sed 's/^/export /')"
remote="$TARGET_DATABASE_URL"
case "$remote" in
  *sslmode=*) ;;
  *\?*) remote="$remote&sslmode=require" ;;
  *) remote="$remote?sslmode=require" ;;
esac
out="${1:-${TMPDIR:-/tmp}/salon-remote.dump}"
PGCONNECT_TIMEOUT=30 pg_dump -w -Fc --no-owner --no-privileges "$remote" -f "$out"
echo "wrote $out ($(wc -c <"$out") bytes)"
