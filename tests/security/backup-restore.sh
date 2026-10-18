#!/usr/bin/env bash
# Phase 9 — proves the backup/restore procedure in docs/DATABASE_AND_BACKUPS.md on a THROWAWAY local PostgreSQL:
#  A) full dump -> restore into an empty database -> identical rows, policies, triggers, functions, and RLS still enforced
#  B) "rebuild" path: fresh database from the repo's SQL files + data-only dump restored into it -> identical rows
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=pgtest bash tests/security/backup-restore.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
fail() { echo "FAIL: $*"; exit 1; }
SRC=subcore_br_src; A=subcore_br_a; B=subcore_br_b; OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
mk() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" 2>/dev/null; psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$ROOT/tests/notifications/sql/harness.sql"; }
schema() { for f in supabase-schema-fresh-install.sql supabase-migration-v3-store.sql supabase-migration-v4-security.sql supabase-migration-v5-notifications.sql supabase-migration-v6-portfolio.sql supabase-migration-v7-promo-reports.sql; do psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$ROOT/$f" >/dev/null 2>&1; done; }
TABLES="categories products orders services website_settings admin_users inquiries audit_log notification_log projects project_services promo_templates purchase_records"
fingerprint() { for t in $TABLES; do echo "$t $(psql -tA -d "$1" -c "SELECT count(*) || ' ' || coalesce(md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)), 'empty') FROM $t x")"; done; }
structure() { psql -tA -d "$1" -c "SELECT 'policies ' || count(*) FROM pg_policies WHERE schemaname='public' UNION ALL SELECT 'triggers ' || count(*) FROM pg_trigger WHERE NOT tgisinternal UNION ALL SELECT 'functions ' || count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace UNION ALL SELECT 'rls-tables ' || count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity ORDER BY 1"; }

mk $SRC; schema $SRC
psql -v ON_ERROR_STOP=1 -q -d $SRC <<'SQL'
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-0000000000a1','admin@t.test');
INSERT INTO admin_users(auth_user_id,email,role) VALUES ('00000000-0000-0000-0000-0000000000a1','admin@t.test','admin');
INSERT INTO categories(id,name,slug) VALUES ('c1','{"sq":"K","en":"C"}','c1');
INSERT INTO products(id,name,description,price,category,stock,available) SELECT 'p'||g, jsonb_build_object('sq','Produkt '||g,'en','Product '||g), '{"sq":"","en":""}', g*1.5, 'c1', 10, true FROM generate_series(1,90) g;
SELECT place_order('Test Cust','','+355681234567','Tirane','', '[{"id":"p1","qty":2}]'::jsonb);
INSERT INTO inquiries(name,message) VALUES ('Visitor','hello ë ç — unicode');
INSERT INTO projects(id,title,summary,status) VALUES ('pr1','{"sq":"P","en":"P"}','{"sq":"s","en":"s"}','published');
INSERT INTO promo_templates(name,spec) VALUES ('t','{"layout":"stack"}');
INSERT INTO purchase_records(supplier,doc_number,doc_date,net_amount,vat_amount,total_amount) VALUES ('Sup','D1','2026-01-01',100,20,120);
SQL
fingerprint $SRC > "$OUT/src.fp"; structure $SRC > "$OUT/src.st"
echo "source: $(grep -c . "$OUT/src.fp") tables fingerprinted, orders=$(psql -tA -d $SRC -c 'select count(*) from orders'), products=$(psql -tA -d $SRC -c 'select count(*) from products')"

echo "== A) full dump -> restore into an empty database"
pg_dump -Fc --no-owner --no-privileges -d $SRC -f "$OUT/full.dump"
mk $A
pg_restore --no-owner -d $A "$OUT/full.dump" 2>"$OUT/restore.log" || true
true  # (schema "auth"/"storage" already exist from the Supabase stand-in; that notice is expected)
fingerprint $A > "$OUT/a.fp"; structure $A > "$OUT/a.st"
diff "$OUT/src.fp" "$OUT/a.fp" || fail "A: tables differ"; echo "A: every table identical (row count + checksum)"
diff "$OUT/src.st" "$OUT/a.st" || fail "A: structure differs"; echo "A: policies/triggers/functions/RLS flags identical"
# RLS must still be enforced after restore
psql -tA -d $A -c "SET ROLE anon; SELECT count(*) FROM orders" | grep -qx 0 || fail "A: anon can see orders"; echo "A: anon still sees 0 orders after restore (RLS enforced)"
psql -tA -d $A -c "SET ROLE anon; SELECT count(*) FROM products" | grep -qx 90 || fail "A: catalogue not visible"; echo "A: anon still sees the public catalogue (90 products)"

echo "== B) rebuild from the repo's SQL files, then restore data only"
# public tables + the auth users they point to (on Supabase: dump the auth schema data too, see docs)
pg_dump -Fc --data-only --disable-triggers --no-owner -t "public.*" -t auth.users -d $SRC -f "$OUT/data.dump"
mk $B; schema $B
# a freshly built database already holds the installer's default rows (settings, bootstrap admin): empty the tables first
psql -v ON_ERROR_STOP=1 -q -d $B -c "TRUNCATE auth.users, $(echo $TABLES | sed 's/ /, /g') RESTART IDENTITY CASCADE"
# triggers off so audit/notify triggers do not fire again and duplicate rows
pg_restore --data-only --disable-triggers --no-owner -d $B "$OUT/data.dump" 2>"$OUT/restoreb.log" || true
if grep -qi "error" "$OUT/restoreb.log"; then cat "$OUT/restoreb.log"; fail "B: restore errors"; fi
fingerprint $B > "$OUT/b.fp"
diff "$OUT/src.fp" "$OUT/b.fp" || fail "B: tables differ"; echo "B: every table identical after data-only restore"
psql -tA -d $B -c "SELECT count(*) FROM orders WHERE order_number IS NOT NULL" | grep -qx 1 || fail "B: order numbers lost"; echo "B: order numbers preserved"
echo "BACKUP/RESTORE ROUND-TRIP OK"
psql -q -d postgres -c "DROP DATABASE $SRC" -c "DROP DATABASE $A" -c "DROP DATABASE $B"
