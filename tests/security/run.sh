#!/usr/bin/env bash
# Rebuilds a throwaway DB from the repo's SQL (v3..v7), runs the authorization matrix and diffs it with the
# frozen expectation. Usage: PGHOST=/tmp PGPORT=54329 PGUSER=pgtest bash tests/security/run.sh [--update]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; DB=subcore_matrix
psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" 2>/dev/null
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f "$ROOT/tests/notifications/sql/harness.sql"
for f in supabase-schema-fresh-install.sql supabase-migration-v3-store.sql supabase-migration-v4-security.sql supabase-migration-v5-notifications.sql supabase-migration-v6-portfolio.sql supabase-migration-v7-promo-reports.sql; do
  $P -f "$ROOT/$f" >/dev/null 2>&1 || { echo "failed to apply $f"; exit 1; }
done
$P -f "$HERE/rls-matrix.sql" > "$HERE/rls-matrix.actual"
if [ "${1:-}" = "--update" ]; then cp "$HERE/rls-matrix.actual" "$HERE/rls-matrix.expected"; echo "expected file updated"; exit 0; fi
if diff -u "$HERE/rls-matrix.expected" "$HERE/rls-matrix.actual"; then echo "AUTHORIZATION MATRIX UNCHANGED ($(wc -l < "$HERE/rls-matrix.actual") cells)"; else echo "AUTHORIZATION MATRIX CHANGED"; exit 1; fi
