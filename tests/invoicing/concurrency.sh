#!/usr/bin/env bash
# Many simultaneous sessions each create + issue an invoice against the throwaway DB built by tests/invoicing/e2e.mjs or run-db-tests.sh.
# Every number must be unique and gap-free. Usage: PGHOST=/tmp PGPORT=54329 PGUSER=pgtest bash tests/invoicing/concurrency.sh [sessions=20]
set -euo pipefail
DB=${DB:-subcore_inv_test}; N=${1:-20}; OUT=$(mktemp -d)
psql -q -d "$DB" -c "UPDATE invoice_settings SET data = data || '{\"company_name\":\"Concurrency Test\"}'::jsonb" >/dev/null 2>&1 || true
before=$(psql -q -At -d "$DB" -c "SELECT count(*) FROM invoices WHERE number IS NOT NULL")
for i in $(seq 1 "$N"); do
  psql -q -At -d "$DB" -c "SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1'; SET ROLE authenticated; SELECT invoice_issue(invoice_save_draft(jsonb_build_object('customer', jsonb_build_object('name','Concurrent $i')), '[{\"kind\":\"custom\",\"name\":\"x\",\"qty\":1,\"unit_price\":10}]'::jsonb))->>'number'" > "$OUT/$i.txt" 2>&1 &
done
wait
ok=$(cat "$OUT"/*.txt | grep -c '^SUB-INV-' || true)
dups=$(cat "$OUT"/*.txt | grep '^SUB-INV-' | sort | uniq -d | wc -l)
read -r total distinct maxn < <(psql -q -At -F ' ' -d "$DB" -c "SELECT count(*), count(DISTINCT number), max(right(number,6))::int FROM invoices WHERE number IS NOT NULL")
echo "sessions=$N issued_ok=$ok duplicate_numbers=$dups total_numbered=$total distinct=$distinct highest_sequence=$maxn (before: $before)"
[ "$ok" = "$N" ] && [ "$dups" = "0" ] && [ "$total" = "$distinct" ] && [ "$maxn" = "$total" ] && echo "CONCURRENCY OK: unique, gap-free" || { echo "CONCURRENCY FAILED"; cat "$OUT"/*.txt | head; exit 1; }
