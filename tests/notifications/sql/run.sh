#!/usr/bin/env bash
# Replays the repo's SQL files on a throwaway local PostgreSQL and runs the notification tests.
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=pgtest bash tests/notifications/sql/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
DB=subcore_notify_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f "$HERE/harness.sql"
for f in supabase-schema-fresh-install.sql supabase-migration-v3-store.sql supabase-migration-v4-security.sql supabase-migration-v5-notifications.sql; do
  echo "== applying $f"; $P -f "$ROOT/$f" >/dev/null
done
echo "== re-applying v5 (must be safe to re-run)"; $P -f "$ROOT/supabase-migration-v5-notifications.sql" >/dev/null
echo "== running tests"; $P -f "$HERE/notifications.test.sql"
echo "== rollback must remove everything v5 added and leave orders working, then v5 re-applies"
$P -f "$ROOT/supabase-migration-v5-ROLLBACK.sql" >/dev/null
$P -tA -c "SELECT CASE WHEN to_regclass('public.notification_log') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('notify_on_new_order','claim_notifications','finish_notification','retry_notification')) AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='notify_on_new_order_trg') THEN 'ROLLBACK OK' ELSE 'ROLLBACK INCOMPLETE' END" | tee /dev/stderr | grep -q 'ROLLBACK OK'
$P -f "$ROOT/supabase-migration-v5-notifications.sql" >/dev/null && echo "re-apply after rollback OK"
