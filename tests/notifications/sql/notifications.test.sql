-- Behaviour tests for supabase-migration-v5-notifications.sql.
-- Run through run.sh on a throwaway local PostgreSQL (never on Supabase). Any FAIL aborts the run.
\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE FUNCTION t_ok(name text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS TRUE THEN RAISE NOTICE 'PASS  %', name; ELSE RAISE EXCEPTION 'FAIL  %', name; END IF; END $$;

-- ---- fixtures: catalogue, one admin, one staff member, one ordinary signed-in user ----
INSERT INTO categories (id, slug, name) VALUES ('c1', 'c1', '{"en":"C","sq":"C"}');
INSERT INTO products (id, name, description, price, currency, category, stock, available) VALUES
  ('p1', '{"en":"Cable","sq":"Kabllo"}', '{"en":"","sq":""}', 100, 'ALL', 'c1', 10, true),
  ('p2', '{"en":"Mouse","sq":"Maus"}',   '{"en":"","sq":""}',  50, 'ALL', 'c1',  3, true);
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'nobody@example.test');
UPDATE admin_users SET auth_user_id = '00000000-0000-0000-0000-0000000000a1' WHERE role = 'admin';
INSERT INTO admin_users (auth_user_id, email, role) VALUES ('00000000-0000-0000-0000-0000000000b2', 'staff@example.test', 'staff');

-- ---- 1. a customer order (placed as the anonymous visitor) queues exactly one notification ----
DO $$
DECLARE r RECORD; n INT; lg notification_log%ROWTYPE; stock1 INT;
BEGIN
  SET LOCAL ROLE anon;
  SELECT * INTO r FROM place_order('Test Customer', 'c@example.test', '+355 68 000 0000', 'Tirana, Rruga 1', 'note', '[{"id":"p1","qty":2}]'::jsonb);
  RESET ROLE;
  SELECT count(*) INTO n FROM notification_log;
  PERFORM t_ok('order placed by anon creates exactly one log row', n = 1);
  SELECT * INTO lg FROM notification_log LIMIT 1;
  PERFORM t_ok('row is pending, order_submitted, attempts 0', lg.status = 'pending' AND lg.event_type = 'order_submitted' AND lg.attempts = 0);
  PERFORM t_ok('dedupe key is order_submitted:<order id>', lg.dedupe_key = 'order_submitted:' || lg.order_id);
  SELECT stock INTO stock1 FROM products WHERE id = 'p1';
  PERFORM t_ok('existing place_order behaviour unchanged (stock reduced, number issued)', stock1 = 8 AND r.order_number LIKE 'SC-%');
  PERFORM t_ok('log table holds no customer data columns',
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_log'
                AND column_name ~* '(name|phone|email|address|notes|items)' AND column_name NOT IN ('order_number')));
  PERFORM t_ok('log row contains no customer text',
    NOT EXISTS (SELECT 1 FROM notification_log l WHERE to_jsonb(l)::text ~* '(Test Customer|c@example|Tirana|355 68)'));
END $$;

-- ---- 2. repeats and status changes never create more notifications ----
DO $$
DECLARE oid BIGINT; n INT;
BEGIN
  SELECT order_id INTO oid FROM notification_log LIMIT 1;
  UPDATE orders SET status = 'processing' WHERE id = oid;
  UPDATE orders SET status = 'cancelled'  WHERE id = oid;
  UPDATE orders SET status = 'pending'    WHERE id = oid;
  SELECT count(*) INTO n FROM notification_log;
  PERFORM t_ok('status changes do not create notifications', n = 1);
  BEGIN
    INSERT INTO notification_log (event_type, order_id, dedupe_key) VALUES ('order_submitted', oid, 'order_submitted:' || oid);
    RAISE EXCEPTION 'FAIL  duplicate key accepted';
  EXCEPTION WHEN unique_violation THEN PERFORM t_ok('duplicate notification for the same order is impossible', true);
  END;
  INSERT INTO notification_log (event_type, order_id, dedupe_key) VALUES ('order_submitted', oid, 'order_submitted:' || oid)
    ON CONFLICT (dedupe_key) DO NOTHING;
  SELECT count(*) INTO n FROM notification_log;
  PERFORM t_ok('retried insert with ON CONFLICT adds nothing', n = 1);
END $$;

-- ---- 3. a direct insert (older fallback path) is covered too; a broken log never blocks an order ----
DO $$
DECLARE n0 INT; n1 INT; r RECORD; ord_exists BOOLEAN;
BEGIN
  SELECT count(*) INTO n0 FROM notification_log;
  INSERT INTO orders (customer_name, customer_email, customer_phone, delivery_address, notes, items, total, status)
  VALUES ('Direct', '', '+355 68 111 1111', 'Tirana, Rruga 2', '', '[]'::jsonb, 10, 'pending');
  SELECT count(*) INTO n1 FROM notification_log;
  PERFORM t_ok('direct insert into orders is also queued (trigger sits on the table)', n1 = n0 + 1);

  ALTER TABLE notification_log ADD CONSTRAINT t_break CHECK (false) NOT VALID;
  SELECT * INTO r FROM place_order('Second Customer', '', '+355 68 222 2222', 'Tirana, Rruga 3', '', '[{"id":"p2","qty":1}]'::jsonb);
  ALTER TABLE notification_log DROP CONSTRAINT t_break;
  SELECT EXISTS (SELECT 1 FROM orders WHERE order_number = r.order_number) INTO ord_exists;
  PERFORM t_ok('order still succeeds when the notification cannot be queued', ord_exists);
  SELECT count(*) INTO n0 FROM notification_log;
  PERFORM t_ok('...and no half-written log row is left behind', n0 = n1);
END $$;

-- ---- 4. claiming ----
DO $$
DECLARE c1 INT; c2 INT; st TEXT; att INT;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO c1 FROM claim_notifications(50);
  SELECT count(*) INTO c2 FROM claim_notifications(50);
  RESET ROLE;
  PERFORM t_ok('first claim returns both queued notifications', c1 = 2);
  PERFORM t_ok('second claim returns nothing (rows are locked as sending)', c2 = 0);
  SELECT min(status), min(attempts) INTO st, att FROM notification_log;
  PERFORM t_ok('claimed rows are sending with attempts = 1', st = 'sending' AND att = 1);
  PERFORM t_ok('claim fills in the order number', NOT EXISTS (SELECT 1 FROM notification_log WHERE order_number IS NULL AND order_id IN (SELECT id FROM orders WHERE order_number IS NOT NULL)));
END $$;

-- ---- 5. transient failure -> failed + back-off; due again later; error codes are sanitised ----
DO $$
DECLARE a BIGINT; b BIGINT; ok1 BOOLEAN; r notification_log%ROWTYPE; c INT; att INT;
BEGIN
  SELECT min(id), max(id) INTO a, b FROM notification_log;
  SET LOCAL ROLE service_role;
  SELECT finish_notification(a, false, NULL, 'resend_429') INTO ok1;
  RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = a;
  PERFORM t_ok('failure is recorded as failed (NOT sent)', ok1 AND r.status = 'failed' AND r.sent_at IS NULL AND r.provider_id IS NULL);
  PERFORM t_ok('first retry is scheduled about 1 minute out', r.next_attempt_at > now() + interval '30 seconds' AND r.next_attempt_at < now() + interval '2 minutes');
  PERFORM t_ok('error code stored', r.last_error = 'resend_429');
  SET LOCAL ROLE service_role; SELECT count(*) INTO c FROM claim_notifications(50); RESET ROLE;
  PERFORM t_ok('failed row is not retried before it is due', c = 0);
  UPDATE notification_log SET next_attempt_at = now() - interval '1 second' WHERE id = a;
  SET LOCAL ROLE service_role; SELECT count(*), max(attempts) INTO c, att FROM claim_notifications(50); RESET ROLE;
  PERFORM t_ok('due failed row is claimed again with attempts = 2', c = 1 AND att = 2);

  SET LOCAL ROLE service_role; PERFORM finish_notification(b, false, NULL, 'x@y.test <script>alert(1)</script> ' || repeat('z', 200)); RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = b;
  PERFORM t_ok('error text is stripped of @, <, > and spaces and capped at 60 characters',
    r.last_error !~ '[@<> ()]' AND length(r.last_error) <= 60);
END $$;

-- ---- 6. dead letters ----
DO $$
DECLARE a BIGINT; r notification_log%ROWTYPE;
BEGIN
  SELECT min(id) INTO a FROM notification_log;
  UPDATE notification_log SET status = 'sending', attempts = 5, locked_at = now() WHERE id = a;
  SET LOCAL ROLE service_role; PERFORM finish_notification(a, false, NULL, 'resend_500'); RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = a;
  PERFORM t_ok('attempt 5 failing still schedules a retry', r.status = 'failed');
  UPDATE notification_log SET status = 'sending', attempts = 6, locked_at = now() WHERE id = a;
  SET LOCAL ROLE service_role; PERFORM finish_notification(a, false, NULL, 'resend_500'); RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = a;
  PERFORM t_ok('attempt 6 failing parks the notification as dead', r.status = 'dead');

  UPDATE notification_log SET status = 'sending', attempts = 1, locked_at = now() WHERE id = a;
  SET LOCAL ROLE service_role; PERFORM finish_notification(a, false, NULL, 'resend_422', true); RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = a;
  PERFORM t_ok('permanent errors go straight to dead', r.status = 'dead' AND r.last_error = 'resend_422');
END $$;

-- ---- 7. success path and double-report protection ----
DO $$
DECLARE b BIGINT; r notification_log%ROWTYPE; again BOOLEAN; again2 BOOLEAN;
BEGIN
  SELECT max(id) INTO b FROM notification_log;
  UPDATE notification_log SET status = 'sending', attempts = 1, locked_at = now(), last_error = 'old' WHERE id = b;
  SET LOCAL ROLE service_role; PERFORM finish_notification(b, true, 'msg_123'); RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = b;
  PERFORM t_ok('accepted message is marked sent with provider id and timestamp', r.status = 'sent' AND r.sent_at IS NOT NULL AND r.provider_id = 'msg_123' AND r.last_error IS NULL);
  SET LOCAL ROLE service_role;
  SELECT finish_notification(b, false, NULL, 'late_failure') INTO again;
  SELECT finish_notification(b, true, 'msg_999')            INTO again2;
  RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = b;
  PERFORM t_ok('a late or duplicate report cannot change a sent row', NOT again AND NOT again2 AND r.status = 'sent' AND r.provider_id = 'msg_123');
END $$;

-- ---- 8. crashed worker: stale lock is reclaimed, but not forever ----
DO $$
DECLARE a BIGINT; c INT; att INT; r notification_log%ROWTYPE;
BEGIN
  SELECT min(id) INTO a FROM notification_log;
  UPDATE notification_log SET status = 'sending', attempts = 2, locked_at = now() - interval '11 minutes' WHERE id = a;
  SET LOCAL ROLE service_role; SELECT count(*), max(attempts) INTO c, att FROM claim_notifications(50); RESET ROLE;
  PERFORM t_ok('a stuck sending row (>10 min) is claimed again', c = 1 AND att = 3);
  UPDATE notification_log SET status = 'sending', attempts = 6, locked_at = now() - interval '11 minutes' WHERE id = a;
  SET LOCAL ROLE service_role; SELECT count(*) INTO c FROM claim_notifications(50); RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = a;
  PERFORM t_ok('a stuck row that used all attempts is parked as dead, not retried', c = 0 AND r.status = 'dead' AND r.last_error = 'stale_lock');
  UPDATE notification_log SET status = 'sending', attempts = 1, locked_at = now() WHERE id = a;
  SET LOCAL ROLE service_role; SELECT count(*) INTO c FROM claim_notifications(50); RESET ROLE;
  PERFORM t_ok('a freshly locked row is left alone', c = 0);
END $$;

-- ---- 9. permissions: visitors and ordinary users have no access ----
DO $$
DECLARE n INT;
BEGIN
  BEGIN SET LOCAL ROLE anon; PERFORM * FROM claim_notifications(1); RAISE EXCEPTION 'FAIL  anon could claim';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('anon cannot call claim_notifications', true); END;
  BEGIN SET LOCAL ROLE authenticated; PERFORM * FROM claim_notifications(1); RAISE EXCEPTION 'FAIL  signed-in user could claim';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('signed-in users cannot call claim_notifications', true); END;
  BEGIN SET LOCAL ROLE anon; PERFORM finish_notification(1, true, 'x'); RAISE EXCEPTION 'FAIL  anon could finish';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('anon cannot call finish_notification', true); END;
  BEGIN SET LOCAL ROLE authenticated; PERFORM finish_notification(1, true, 'x'); RAISE EXCEPTION 'FAIL  signed-in user could finish';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('signed-in users cannot call finish_notification', true); END;
  BEGIN SET LOCAL ROLE anon; PERFORM count(*) FROM notification_log; RAISE EXCEPTION 'FAIL  anon could read the log';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('anon cannot read the log', true); END;
  BEGIN SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
        INSERT INTO notification_log (event_type, order_id, dedupe_key) VALUES ('order_submitted', 999, 'x'); RAISE EXCEPTION 'FAIL  admin could write the log from the browser';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('even an admin cannot write the log from the browser', true); END;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
  SELECT count(*) INTO n FROM notification_log; RESET ROLE;
  PERFORM t_ok('signed-in user without a team role sees no log rows', n = 0);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
  SELECT count(*) INTO n FROM notification_log; RESET ROLE;
  PERFORM t_ok('staff role sees no log rows', n = 0);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  SELECT count(*) INTO n FROM notification_log; RESET ROLE;
  PERFORM t_ok('admin sees the log', n = 2);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

-- ---- 10. manual retry ----
DO $$
DECLARE dead_id BIGINT; sent_id BIGINT; ok1 BOOLEAN; r notification_log%ROWTYPE;
BEGIN
  SELECT min(id) INTO dead_id FROM notification_log;
  UPDATE notification_log SET status = 'dead', attempts = 6, last_error = 'resend_500', locked_at = NULL WHERE id = dead_id;
  SELECT id INTO sent_id FROM notification_log WHERE status = 'sent' LIMIT 1;
  BEGIN SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
        PERFORM retry_notification(dead_id); RAISE EXCEPTION 'FAIL  staff could retry';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('staff cannot re-queue notifications', true); END;
  BEGIN SET LOCAL ROLE anon; PERFORM retry_notification(dead_id); RAISE EXCEPTION 'FAIL  anon could retry';
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('anon cannot re-queue notifications', true); END;

  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  SELECT retry_notification(dead_id) INTO ok1; RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = dead_id;
  PERFORM t_ok('admin can re-queue a dead notification (fresh attempts)', ok1 AND r.status = 'pending' AND r.attempts = 0 AND r.last_error IS NULL);

  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  SELECT retry_notification(sent_id) INTO ok1; RESET ROLE;
  SELECT * INTO r FROM notification_log WHERE id = sent_id;
  PERFORM t_ok('a SENT notification can never be re-queued (no duplicate e-mails)', NOT ok1 AND r.status = 'sent');

  SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  SELECT retry_notification(987654) INTO ok1; RESET ROLE;
  PERFORM t_ok('retrying an unknown id returns false', NOT ok1);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

-- ---- 11. the log survives deleting an order ----
DO $$
DECLARE oid BIGINT; n INT;
BEGIN
  SELECT order_id INTO oid FROM notification_log ORDER BY id LIMIT 1;
  DELETE FROM orders WHERE id = oid;
  SELECT count(*) INTO n FROM notification_log WHERE order_id = oid;
  PERFORM t_ok('deleting an order does not delete or break its log row', n = 1);
END $$;

-- ---- 12. nothing creates a payment_confirmed event today ----
SELECT t_ok('no payment_confirmed events exist (no payment system)', NOT EXISTS (SELECT 1 FROM notification_log WHERE event_type = 'payment_confirmed'));

\echo ALL SQL TESTS PASSED
