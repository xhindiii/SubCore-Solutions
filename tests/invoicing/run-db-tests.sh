#!/usr/bin/env bash
# Builds a throwaway database from the repo's SQL (harness + schema + v3..v8) and runs the invoicing behaviour tests.
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=pgtest bash tests/invoicing/run-db-tests.sh   (a local PostgreSQL 14+; never your real Supabase)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
DB=${DB:-subcore_inv_test}
psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" 2>/dev/null
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f tests/notifications/sql/harness.sql >/dev/null 2>&1
for f in supabase-schema-fresh-install.sql supabase-migration-v3-store.sql supabase-migration-v4-security.sql supabase-migration-v5-notifications.sql supabase-migration-v6-portfolio.sql supabase-migration-v7-promo-reports.sql supabase-migration-v8-invoicing.sql; do
  $P -f "$f" >/dev/null 2>&1 || { echo "failed to apply $f"; exit 1; }
done
OUT=$(mktemp)
if $P -f tests/invoicing/invoicing.test.sql > "$OUT" 2>&1 && grep -q "ALL INVOICING DATABASE TESTS PASSED" "$OUT"; then
  echo "invoicing database tests: $(grep -c 'PASS' "$OUT") checks passed"
else grep -E "ERROR|FAIL|CONTEXT" "$OUT" | head; echo "INVOICING DATABASE TESTS FAILED"; exit 1; fi
