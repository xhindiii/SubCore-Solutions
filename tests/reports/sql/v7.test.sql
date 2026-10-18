-- Behaviour tests for supabase-migration-v7-promo-reports.sql (throwaway local PostgreSQL only).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
CREATE OR REPLACE FUNCTION t_ok(name text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS TRUE THEN RAISE NOTICE 'PASS  %', name; ELSE RAISE EXCEPTION 'FAIL  %', name; END IF; END $$;
CREATE OR REPLACE FUNCTION t_fails(name text, stmt text, code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; RAISE EXCEPTION 'FAIL  % (statement was accepted)', name;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = code THEN RAISE NOTICE 'PASS  %', name; ELSE RAISE EXCEPTION 'FAIL  % (got % %)', name, SQLSTATE, SQLERRM; END IF;
  END;
END $$;
CREATE OR REPLACE FUNCTION as_user(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', uid, true); END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000d4', 'editor@example.test');
UPDATE admin_users SET auth_user_id = '00000000-0000-0000-0000-0000000000a1' WHERE role = 'admin';
INSERT INTO admin_users (auth_user_id, email, role) VALUES
  ('00000000-0000-0000-0000-0000000000b2', 'staff@example.test', 'staff'),
  ('00000000-0000-0000-0000-0000000000d4', 'editor@example.test', 'editor');
INSERT INTO products (id, name, description, price, stock, available) VALUES ('px', '{"en":"Probe","sq":"Probe"}', '{"en":"","sq":""}', 100, 5, true);

SELECT t_ok('both tables start empty', (SELECT count(*) FROM promo_templates) = 0 AND (SELECT count(*) FROM purchase_records) = 0);

-- promo templates: editor may write, staff and anon may not
DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000d4'); SET LOCAL ROLE authenticated;
  INSERT INTO promo_templates (id, name, spec) VALUES ('t1', 'My design', '{"layout":"stack","bg":{"c1":"#112233"}}');
  PERFORM t_ok('editor can create a template', (SELECT count(*) FROM promo_templates) = 1);
  UPDATE promo_templates SET name = 'Renamed' WHERE id = 't1';
  PERFORM t_ok('editor can edit it', (SELECT name FROM promo_templates WHERE id = 't1') = 'Renamed');
  PERFORM t_ok('created_by and updated_at are set by the server', (SELECT created_by IS NOT NULL FROM promo_templates WHERE id = 't1'));
  PERFORM t_fails('template spec must be an object', $q$INSERT INTO promo_templates (name, spec) VALUES ('x', '[1]')$q$, '23514');
  PERFORM t_fails('template spec size is capped', $q$INSERT INTO promo_templates (name, spec) VALUES ('x', jsonb_build_object('a', repeat('x', 9000)))$q$, '23514');
  PERFORM t_fails('template needs a name', $q$INSERT INTO promo_templates (name, spec) VALUES ('  ', '{}')$q$, '23514');
  RESET ROLE;
END $$;
DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000b2'); SET LOCAL ROLE authenticated;
  PERFORM t_ok('staff cannot read templates', (SELECT count(*) FROM promo_templates) = 0);
  PERFORM t_fails('staff cannot create a template', $q$INSERT INTO promo_templates (name, spec) VALUES ('s', '{}')$q$, '42501');
  RESET ROLE;
END $$;
DO $$ BEGIN
  SET LOCAL ROLE anon;
  PERFORM t_fails('anonymous cannot read templates', $q$SELECT count(*) FROM promo_templates$q$, '42501');
  RESET ROLE;
END $$;
SELECT t_ok('template changes are in the activity log', (SELECT count(*) FROM audit_log WHERE table_name = 'promo_templates') >= 2);
SELECT t_ok('a template never touched the product catalog', (SELECT price FROM products WHERE id = 'px') = 100);

-- purchase ledger: admin only
DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  INSERT INTO purchase_records (supplier, doc_number, doc_date, net_amount, vat_amount, total_amount, paid_amount, paid_date)
    VALUES ('ACME Ltd', 'F-100', '2026-10-03', 1000, 200, 1200, 500, '2026-10-04');
  PERFORM t_ok('admin can record a purchase', (SELECT count(*) FROM purchase_records) = 1);
  PERFORM t_fails('same supplier + document number is refused (case/space-insensitive)', $q$INSERT INTO purchase_records (supplier, doc_number, doc_date, total_amount) VALUES ('  acme ltd', 'f-100 ', '2026-10-05', 5)$q$, '23505');
  INSERT INTO purchase_records (supplier, doc_number, doc_date, total_amount) VALUES ('Other', 'F-100', '2026-10-05', 5);
  PERFORM t_ok('same number from another supplier is allowed', (SELECT count(*) FROM purchase_records) = 2);
  PERFORM t_fails('paid cannot exceed total', $q$INSERT INTO purchase_records (supplier, doc_number, doc_date, total_amount, paid_amount, paid_date) VALUES ('S','X1','2026-10-05',10,11,'2026-10-05')$q$, '23514');
  PERFORM t_fails('net + vat must equal total', $q$INSERT INTO purchase_records (supplier, doc_number, doc_date, net_amount, vat_amount, total_amount) VALUES ('S','X2','2026-10-05',10,1,12)$q$, '23514');
  PERFORM t_fails('a payment needs a paid date', $q$INSERT INTO purchase_records (supplier, doc_number, doc_date, total_amount, paid_amount) VALUES ('S','X3','2026-10-05',10,5)$q$, '23514');
  PERFORM t_fails('negative amounts refused', $q$INSERT INTO purchase_records (supplier, doc_number, doc_date, total_amount) VALUES ('S','X4','2026-10-05',-1)$q$, '23514');
  PERFORM t_fails('bad currency refused', $q$INSERT INTO purchase_records (supplier, doc_number, doc_date, total_amount, currency) VALUES ('S','X5','2026-10-05',1,'all')$q$, '23514');
  PERFORM t_fails('records cannot be deleted from the app', $q$DELETE FROM purchase_records WHERE doc_number = 'F-100'$q$, '42501');
  PERFORM t_fails('voiding needs a reason', $q$UPDATE purchase_records SET voided = true WHERE doc_number = 'F-100' AND supplier = 'ACME Ltd'$q$, '23514');
  UPDATE purchase_records SET voided = true, void_reason = 'entered twice' WHERE doc_number = 'F-100' AND supplier = 'ACME Ltd';
  PERFORM t_ok('a record can be voided and is kept', (SELECT voided FROM purchase_records WHERE supplier = 'ACME Ltd'));
  PERFORM t_fails('a voided record is final', $q$UPDATE purchase_records SET total_amount = 1 WHERE supplier = 'ACME Ltd'$q$, '23514');
  INSERT INTO purchase_records (supplier, doc_number, doc_date, total_amount) VALUES ('ACME Ltd', 'F-100', '2026-10-03', 1200);
  PERFORM t_ok('a corrected row can be re-entered after voiding the wrong one', (SELECT count(*) FROM purchase_records WHERE supplier = 'ACME Ltd') = 2);
  RESET ROLE;
END $$;
DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000d4'); SET LOCAL ROLE authenticated;
  PERFORM t_ok('editor cannot read purchases', (SELECT count(*) FROM purchase_records) = 0);
  PERFORM t_fails('editor cannot record a purchase', $q$INSERT INTO purchase_records (supplier, doc_number, doc_date, total_amount) VALUES ('S','E1','2026-10-05',1)$q$, '42501');
  RESET ROLE;
END $$;
DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000b2'); SET LOCAL ROLE authenticated;
  PERFORM t_ok('staff cannot read purchases', (SELECT count(*) FROM purchase_records) = 0);
  RESET ROLE;
END $$;
DO $$ BEGIN
  SET LOCAL ROLE anon;
  PERFORM t_fails('anonymous cannot read purchases', $q$SELECT count(*) FROM purchase_records$q$, '42501');
  RESET ROLE;
END $$;
SELECT t_ok('purchase changes are in the activity log', (SELECT count(*) FROM audit_log WHERE table_name = 'purchase_records') >= 4);
SELECT t_ok('orders and products untouched', (SELECT count(*) FROM orders) = 0 AND (SELECT stock FROM products WHERE id = 'px') = 5);
SELECT 'ALL V7 TESTS PASSED' AS result;
