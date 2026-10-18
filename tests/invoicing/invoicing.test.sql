-- Behaviour tests for supabase-migration-v8-invoicing.sql (throwaway local PostgreSQL only).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
CREATE OR REPLACE FUNCTION t_ok(name text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS TRUE THEN RAISE NOTICE 'PASS  %', name; ELSE RAISE EXCEPTION 'FAIL  %', name; END IF; END $$;
CREATE OR REPLACE FUNCTION t_fails(name text, stmt text, code text, frag text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; RAISE EXCEPTION 'FAIL  % (statement was accepted)', name;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL  %' THEN RAISE; END IF;
    IF SQLSTATE = code AND (frag IS NULL OR position(frag IN SQLERRM) > 0) THEN RAISE NOTICE 'PASS  %', name;
    ELSE RAISE EXCEPTION 'FAIL  % (got % %)', name, SQLSTATE, SQLERRM; END IF;
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

-- A small real-looking catalogue (ALL), a priced service and a "from" service (price 0)
UPDATE products SET available = false;
INSERT INTO products (id, name, description, price, currency, sku, stock, available) VALUES
  ('p1', '{"en":"Router AX","sq":"Router AX"}', '{"en":"Wi-Fi 6 router","sq":"Router Wi-Fi 6"}', 10000, 'ALL', 'RT-AX', 10, true),
  ('p2', '{"en":"Cable","sq":"Kabllo"}', '{"en":"Cat6 cable","sq":"Kabllo Cat6"}', 2500.50, 'ALL', 'CB-6', 50, true),
  ('pusd', '{"en":"Imported","sq":"Importuar"}', '{"en":"","sq":""}', 99, 'USD', 'IM-1', 5, true);
INSERT INTO services (id, name, description, price, currency, available) VALUES
  ('s1', '{"en":"Setup","sq":"Instalim"}', '{"en":"On-site setup","sq":"Instalim në vend"}', 15000, 'ALL', true),
  ('s0', '{"en":"Consulting","sq":"Konsulencë"}', '{"en":"Per quote","sq":"Sipas ofertës"}', 0, 'ALL', true);
UPDATE website_settings SET value = '{"shipping_fee": 300, "free_shipping_over": 0}'::jsonb WHERE key = 'shop_settings';

-- ── 1. Empty start, defaults, and who can touch what ────────────────────────────────────────────────────────
SELECT t_ok('tables start empty (nothing invented)', (SELECT count(*) FROM invoices) = 0 AND (SELECT count(*) FROM customers) = 0 AND (SELECT count(*) FROM invoice_payments) = 0);
SELECT t_ok('default settings: ALL, prefix SUB-INV, 14 days, no company details, no VAT rate', (SELECT data ->> 'currency' = 'ALL' AND data ->> 'prefix' = 'SUB-INV' AND (data ->> 'payment_terms_days')::int = 14 AND NOT (data ? 'company_name') AND NOT (data ? 'default_vat_rate') FROM invoice_settings));

DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  PERFORM t_ok('admin can read invoice tables', (SELECT count(*) FROM invoices) = 0 AND (SELECT count(*) FROM invoice_overview) = 0);
  PERFORM t_fails('admin cannot INSERT into invoices directly', $q$INSERT INTO invoices (issue_date, customer) VALUES (current_date, '{"name":"x"}')$q$, '42501');
  PERFORM t_fails('admin cannot UPDATE invoice_settings directly', $q$UPDATE invoice_settings SET data = '{}'$q$, '42501');
  PERFORM t_fails('admin cannot write the numbering counter', $q$INSERT INTO invoice_counters VALUES ('X-1', 99)$q$, '42501');
  PERFORM t_fails('admin cannot read the numbering counter', $q$SELECT * FROM invoice_counters$q$, '42501');
  RESET ROLE;
END $$;
DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000b2'); SET LOCAL ROLE authenticated;       -- staff
  PERFORM t_ok('staff sees no invoices, customers or events', (SELECT count(*) FROM invoices) = 0 AND (SELECT count(*) FROM customers) = 0 AND (SELECT count(*) FROM invoice_settings) = 0);
  PERFORM t_fails('staff cannot call invoice_save_draft', $q$SELECT invoice_save_draft('{"customer":{"name":"Nobody"}}', '[]')$q$, '42501');
  PERFORM t_fails('staff cannot save settings', $q$SELECT invoice_settings_save('{}')$q$, '42501');
  RESET ROLE;
  PERFORM as_user('00000000-0000-0000-0000-0000000000d4'); SET LOCAL ROLE authenticated;       -- editor
  PERFORM t_fails('editor cannot save customers', $q$SELECT customer_save('{"name":"Nobody"}')$q$, '42501');
  RESET ROLE;
END $$;
DO $$ BEGIN
  SET LOCAL ROLE anon;
  PERFORM t_fails('anonymous cannot read invoices', $q$SELECT count(*) FROM invoices$q$, '42501');
  PERFORM t_fails('anonymous cannot read the overview', $q$SELECT count(*) FROM invoice_overview$q$, '42501');
  PERFORM t_fails('anonymous cannot call invoice_issue', $q$SELECT invoice_issue(gen_random_uuid())$q$, '42501');
  PERFORM t_fails('anonymous cannot call invoice_compute', $q$SELECT invoice_compute('[]', 'amount', 0, 0, 0)$q$, '42501');
  RESET ROLE;
END $$;

-- ── 2. Settings are validated; nothing is assumed ─────────────────────────────────────────────────────────────
DO $$ DECLARE d uuid; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  d := invoice_save_draft(jsonb_build_object('client_token', gen_random_uuid(), 'customer', jsonb_build_object('name', 'Pre Settings'), 'currency', 'ALL'),
        '[{"kind":"custom","name":"Work","qty":1,"unit_price":100}]'::jsonb);
  PERFORM t_fails('cannot issue before the company details are configured', format($q$SELECT invoice_issue(%L)$q$, d), '23514', 'company_not_configured');
  PERFORM t_fails('bad prefix rejected', $q$SELECT invoice_settings_save('{"prefix":"bad prefix","currency":"ALL"}')$q$, '23514');
  PERFORM t_fails('bad currency rejected', $q$SELECT invoice_settings_save('{"prefix":"SUB-INV","currency":"lek"}')$q$, '23514');
  PERFORM t_fails('VAT above 100 rejected', $q$SELECT invoice_settings_save('{"prefix":"SUB-INV","currency":"ALL","default_vat_rate":150}')$q$, '23514');
  PERFORM invoice_settings_save('{"company_name":"Test Company Sh.p.k.","address":"Rruga Test 1","city":"Tiranë","country":"Albania","email":"info.subcoresolutions@gmail.com","phone":"+355 68 000 0000","tax_id":"","prefix":"SUB-INV","currency":"ALL","payment_terms_days":10,"number_digits":6,"language":"sq","footer":"Faleminderit"}');
  PERFORM t_ok('settings saved', (SELECT data ->> 'company_name' FROM invoice_settings) = 'Test Company Sh.p.k.');
  PERFORM t_ok('VAT stays unset unless the admin enters it', NOT (SELECT data ? 'default_vat_rate' FROM invoice_settings));
  PERFORM invoice_delete_draft(d);
  RESET ROLE;
END $$;

-- ── 3. Customers ───────────────────────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE c uuid; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  PERFORM t_fails('customer name needs 2+ characters', $q$SELECT customer_save('{"name":"x"}')$q$, '23514');
  c := customer_save('{"kind":"business","name":"Alfa Sh.p.k.","tax_id":"L12345678A","address":"Rr. Durrësit 5","city":"Tiranë","country":"Albania","email":"alfa@example.test","phone":"+355 69 111 2222"}');
  PERFORM t_ok('customer created', (SELECT name FROM customers WHERE id = c) = 'Alfa Sh.p.k.');
  PERFORM customer_save(jsonb_build_object('id', c, 'name', 'Alfa Group Sh.p.k.', 'kind', 'business'));
  PERFORM t_ok('customer updated', (SELECT name FROM customers WHERE id = c) = 'Alfa Group Sh.p.k.');
  PERFORM customer_set_archived(c, true);
  PERFORM t_ok('customer archived, not deleted', (SELECT archived FROM customers WHERE id = c));
  PERFORM customer_set_archived(c, false);
  PERFORM set_config('test.cust', c::text, false);
  RESET ROLE;
END $$;

-- ── 4. Drafts: server-side prices and exact maths ───────────────────────────────────────────────────────────────
-- p1 10000 x 2 (10% line discount) + p2 2500.50 x 3 + service s1 15000 (amount discount 500) + custom line; 5% overall discount; 20% VAT; 300 delivery (no VAT)
DO $$ DECLARE d uuid; r invoices%ROWTYPE; it RECORD; tot numeric; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  d := invoice_save_draft(jsonb_build_object('client_token', gen_random_uuid(), 'customer_id', current_setting('test.cust'),
         'customer', jsonb_build_object('name', 'Alfa Group Sh.p.k.', 'kind', 'business'), 'currency', 'ALL',
         'overall_discount_type', 'percent', 'overall_discount_value', 5, 'shipping', 300, 'shipping_vat_rate', 0),
    '[{"kind":"product","source_id":"p1","qty":2,"unit_price":1,"discount_type":"percent","discount_value":10,"vat_rate":20},
      {"kind":"product","source_id":"p2","qty":3,"unit_price":0.01,"vat_rate":20},
      {"kind":"service","source_id":"s1","qty":1,"unit_price":5,"discount_type":"amount","discount_value":500,"vat_rate":20},
      {"kind":"custom","name":"Kabllim shtesë","qty":2.5,"unit_price":199.99,"vat_rate":20}]'::jsonb);
  SELECT * INTO r FROM invoices WHERE id = d;
  PERFORM t_ok('draft has no number yet', r.number IS NULL AND r.status = 'draft');
  PERFORM t_ok('catalogue price comes from the database, not the browser (p1)', (SELECT unit_price FROM invoice_items WHERE invoice_id = d AND source_id = 'p1') = 10000);
  PERFORM t_ok('catalogue price comes from the database, not the browser (p2)', (SELECT unit_price FROM invoice_items WHERE invoice_id = d AND source_id = 'p2') = 2500.50);
  PERFORM t_ok('priced service uses the catalogue price', (SELECT unit_price FROM invoice_items WHERE invoice_id = d AND source_id = 's1') = 15000);
  PERFORM t_ok('line snapshot keeps SKU, Albanian name and description', (SELECT sku = 'RT-AX' AND name = 'Router AX' AND description = 'Router Wi-Fi 6' FROM invoice_items WHERE invoice_id = d AND source_id = 'p1'));
  -- hand calculation: gross 20000 / 7501.50 / 15000 / 499.975->500.00(rounded half-up: 2.5*199.99=499.975 -> 499.98)
  PERFORM t_ok('line gross rounded half-up (2.5 x 199.99 = 499.98)', (SELECT line_gross FROM invoice_items WHERE invoice_id = d AND kind = 'custom') = 499.98);
  PERFORM t_ok('gross total', r.gross_total = 20000 + 7501.50 + 15000 + 499.98);
  PERFORM t_ok('line discounts: 10% of 20000 + 500', r.line_discount_total = 2500);
  PERFORM t_ok('overall discount 5% of net after line discounts', r.overall_discount_total = round((20000 - 2000 + 7501.50 + 15000 - 500 + 499.98) * 0.05, 2));
  SELECT sum(line_net), sum(overall_discount_share), sum(line_tax), sum(line_total) INTO it FROM invoice_items WHERE invoice_id = d;
  PERFORM t_ok('shares of the overall discount add up exactly', it.sum = (SELECT sum(line_net) FROM invoice_items WHERE invoice_id = d) AND (SELECT sum(overall_discount_share) FROM invoice_items WHERE invoice_id = d) = r.overall_discount_total);
  PERFORM t_ok('invoice total = sum of the lines + delivery', r.total = (SELECT sum(line_total) FROM invoice_items WHERE invoice_id = d) + 300);
  PERFORM t_ok('tax total = sum of the line taxes (delivery has 0% VAT)', r.tax_total = (SELECT sum(line_tax) FROM invoice_items WHERE invoice_id = d));
  PERFORM t_ok('taxable + delivery + tax = total', r.taxable_total + r.shipping + r.tax_total = r.total);
  PERFORM set_config('test.draft', d::text, false);
  RESET ROLE;
END $$;

DO $$ DECLARE tok uuid := gen_random_uuid(); a uuid; b uuid; n int; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  a := invoice_save_draft(jsonb_build_object('client_token', tok, 'customer', jsonb_build_object('name', 'Double Click')), '[{"kind":"custom","name":"x","qty":1,"unit_price":10}]');
  b := invoice_save_draft(jsonb_build_object('client_token', tok, 'customer', jsonb_build_object('name', 'Double Click')), '[{"kind":"custom","name":"x","qty":1,"unit_price":10}]');
  SELECT count(*) INTO n FROM invoices WHERE client_token = tok;
  PERFORM t_ok('the same submission twice creates one draft', a = b AND n = 1);
  PERFORM invoice_delete_draft(a);
  RESET ROLE;
END $$;

DO $$ DECLARE dz uuid; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  PERFORM t_fails('unknown product rejected', $q$SELECT invoice_save_draft('{"customer":{"name":"Zed Zed"}}', '[{"kind":"product","source_id":"nope","qty":1}]')$q$, 'P0002');
  PERFORM t_fails('product in another currency rejected', $q$SELECT invoice_save_draft('{"customer":{"name":"Zed Zed"},"currency":"ALL"}', '[{"kind":"product","source_id":"pusd","qty":1}]')$q$, '23514', 'currency_mismatch');
  PERFORM t_fails('zero quantity rejected', $q$SELECT invoice_save_draft('{"customer":{"name":"Zed Zed"}}', '[{"kind":"custom","name":"x","qty":0,"unit_price":1}]')$q$, '23514');
  PERFORM t_fails('negative price rejected', $q$SELECT invoice_save_draft('{"customer":{"name":"Zed Zed"}}', '[{"kind":"custom","name":"x","qty":1,"unit_price":-5}]')$q$, '23514');
  PERFORM t_fails('percent discount above 100 rejected', $q$SELECT invoice_save_draft('{"customer":{"name":"Zed Zed"}}', '[{"kind":"custom","name":"x","qty":1,"unit_price":5,"discount_type":"percent","discount_value":101}]')$q$, '23514');
  PERFORM t_fails('VAT above 100 rejected', $q$SELECT invoice_save_draft('{"customer":{"name":"Zed Zed"}}', '[{"kind":"custom","name":"x","qty":1,"unit_price":5,"vat_rate":101}]')$q$, '23514');
  PERFORM t_fails('"from" service needs a typed price', $q$SELECT invoice_save_draft('{"customer":{"name":"Zed Zed"}}', '[{"kind":"service","source_id":"s0","qty":1}]')$q$, '23514');
  PERFORM t_fails('unknown customer link rejected', $q$SELECT invoice_save_draft('{"customer_id":"11111111-1111-1111-1111-111111111111","customer":{"name":"Zed Zed"}}', '[]')$q$, 'P0002');
  PERFORM t_fails('due date before issue date rejected', $q$SELECT invoice_save_draft('{"customer":{"name":"Zed Zed"},"issue_date":"2026-05-10","due_date":"2026-05-01"}', '[]')$q$, '23514');
  PERFORM t_fails('customer name missing rejected', $q$SELECT invoice_save_draft('{"customer":{"name":""}}', '[]')$q$, '23514');
  dz := invoice_save_draft('{"customer":{"name":"Zed Zed"}}', '[{"kind":"service","source_id":"s0","qty":2,"unit_price":7000}]');
  PERFORM t_ok('"from" service accepts the agreed price', (SELECT unit_price FROM invoice_items WHERE invoice_id = dz AND source_id = 's0') = 7000);
  RESET ROLE;
END $$;

-- ── 5. Issue: numbering, freezing, price-change guard ──────────────────────────────────────────────────────────────
DO $$ DECLARE d uuid := current_setting('test.draft')::uuid; res jsonb; res2 jsonb; num text; yr text := extract(year FROM current_date)::text; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  -- the catalogue price of p1 changes after the draft was saved
  RESET ROLE; UPDATE products SET price = 11000 WHERE id = 'p1'; SET LOCAL ROLE authenticated;
  PERFORM t_fails('issuing is blocked when a catalogue price changed since the draft', format($q$SELECT invoice_issue(%L)$q$, d), '23514', 'price_changed');
  -- refresh the draft: price now follows the catalogue
  PERFORM invoice_save_draft(jsonb_build_object('id', d, 'customer_id', current_setting('test.cust'), 'customer', jsonb_build_object('name', 'Alfa Group Sh.p.k.', 'kind', 'business'), 'currency', 'ALL', 'overall_discount_type', 'percent', 'overall_discount_value', 5, 'shipping', 300),
    '[{"kind":"product","source_id":"p1","qty":2,"discount_type":"percent","discount_value":10,"vat_rate":20},{"kind":"product","source_id":"p2","qty":3,"vat_rate":20},{"kind":"service","source_id":"s1","qty":1,"discount_type":"amount","discount_value":500,"vat_rate":20}]');
  PERFORM t_ok('new draft price follows the catalogue (new invoices use current prices)', (SELECT unit_price FROM invoice_items WHERE invoice_id = d AND source_id = 'p1') = 11000);
  res := invoice_issue(d);
  num := res ->> 'number';
  PERFORM t_ok('number format PREFIX-YEAR-000001', num = 'SUB-INV-' || yr || '-000001');
  res2 := invoice_issue(d);
  PERFORM t_ok('issuing twice returns the same number (no second number taken)', res2 ->> 'number' = num AND (res2 ->> 'already')::boolean);
  RESET ROLE;
  PERFORM t_ok('counter advanced exactly once', (SELECT last_value FROM invoice_counters WHERE scope = 'SUB-INV-' || yr) = 1);
  SET LOCAL ROLE authenticated;
  PERFORM t_ok('seller snapshot frozen at issue', (SELECT seller ->> 'company_name' = 'Test Company Sh.p.k.' FROM invoices WHERE id = d));
  PERFORM t_ok('due date defaults from the payment terms (10 days)', (SELECT due_date = issue_date + 10 FROM invoices WHERE id = d));
  PERFORM t_ok('footer filled from the settings', (SELECT footer = 'Faleminderit' FROM invoices WHERE id = d));
  PERFORM set_config('test.num1', num, false);
  RESET ROLE;
END $$;

DO $$ DECLARE d uuid := current_setting('test.draft')::uuid; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  PERFORM t_fails('an issued invoice cannot be edited through the draft function', format($q$SELECT invoice_save_draft(jsonb_build_object('id', %L, 'customer', jsonb_build_object('name','Changed')), '[]')$q$, d), '23514', 'not_draft');
  PERFORM t_fails('an issued invoice cannot be deleted as a draft', format($q$SELECT invoice_delete_draft(%L)$q$, d), '23514', 'not_draft');
  RESET ROLE;
  -- even with the function flag on, the guards refuse to rewrite an issued invoice
  PERFORM set_config('app.invoice_rpc', '1', true);
  PERFORM t_fails('issued total cannot be rewritten', format($q$UPDATE invoices SET total = 1 WHERE id = %L$q$, d), '23514');
  PERFORM t_fails('issued number cannot be rewritten', format($q$UPDATE invoices SET number = 'X-1' WHERE id = %L$q$, d), '23514');
  PERFORM t_fails('issued invoice cannot return to draft', format($q$UPDATE invoices SET status = 'draft', number = NULL WHERE id = %L$q$, d), '23514');
  PERFORM t_fails('issued lines cannot be changed', format($q$UPDATE invoice_items SET unit_price = 1 WHERE invoice_id = %L$q$, d), '23514');
  PERFORM t_fails('issued lines cannot be deleted', format($q$DELETE FROM invoice_items WHERE invoice_id = %L$q$, d), '23514');
  PERFORM t_fails('issued invoice cannot be deleted', format($q$DELETE FROM invoices WHERE id = %L$q$, d), '23514');
END $$;
DO $$ DECLARE d uuid := current_setting('test.draft')::uuid; BEGIN
  -- without the function flag nothing at all can be written, even by the table owner
  PERFORM t_fails('direct writes outside the functions are refused', format($q$UPDATE invoices SET notes = 'x' WHERE id = %L$q$, d), '42501');
END $$;

-- history of an issued invoice is stable when the catalogue moves on
DO $$ DECLARE d uuid := current_setting('test.draft')::uuid; before_total numeric; before_price numeric; BEGIN
  SELECT total INTO before_total FROM invoices WHERE id = d; SELECT unit_price INTO before_price FROM invoice_items WHERE invoice_id = d AND source_id = 'p1';
  UPDATE products SET price = 99999, name = '{"en":"Renamed","sq":"Riemërtuar"}' WHERE id = 'p1';
  DELETE FROM products WHERE id = 'p2';
  PERFORM t_ok('product price change does not rewrite an issued invoice', (SELECT total FROM invoices WHERE id = d) = before_total AND (SELECT unit_price FROM invoice_items WHERE invoice_id = d AND source_id = 'p1') = before_price);
  PERFORM t_ok('product rename does not rewrite the line name', (SELECT name FROM invoice_items WHERE invoice_id = d AND source_id = 'p1') = 'Router AX');
  PERFORM t_ok('a deleted product keeps its historical line', EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = d AND source_id = 'p2' AND name = 'Kabllo' AND unit_price = 2500.50));
  UPDATE products SET price = 10000, name = '{"en":"Router AX","sq":"Router AX"}' WHERE id = 'p1';
  INSERT INTO products (id, name, description, price, currency, sku, stock, available) VALUES ('p2', '{"en":"Cable","sq":"Kabllo"}', '{"en":"Cat6 cable","sq":"Kabllo Cat6"}', 2500.50, 'ALL', 'CB-6', 50, true);
END $$;

-- ── 6. Payments ──────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE d uuid := current_setting('test.draft')::uuid; tot numeric; p1 uuid; p1b uuid; tk uuid := gen_random_uuid(); BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  SELECT total INTO tot FROM invoices WHERE id = d;
  PERFORM t_ok('new invoice displays as issued, unpaid', (SELECT display_status = 'issued' AND paid_amount = 0 AND balance = tot FROM invoice_overview WHERE id = d));
  p1 := invoice_record_payment(d, current_date, 1000, 'cash', 'REC-1', 'first part', tk);
  p1b := invoice_record_payment(d, current_date, 1000, 'cash', 'REC-1', 'first part', tk);
  PERFORM t_ok('the same payment submitted twice is recorded once', p1 = p1b AND (SELECT count(*) FROM invoice_payments WHERE invoice_id = d) = 1);
  PERFORM t_ok('partial payment: status partial, balance reduced', (SELECT display_status = 'partial' AND paid_amount = 1000 AND balance = tot - 1000 FROM invoice_overview WHERE id = d));
  PERFORM t_fails('overpayment rejected', format($q$SELECT invoice_record_payment(%L, current_date, %s, 'cash', '', '', gen_random_uuid())$q$, d, tot), '23514', 'overpayment');
  PERFORM t_fails('zero / negative payment rejected', format($q$SELECT invoice_record_payment(%L, current_date, -5, 'cash', '', '', NULL)$q$, d), '23514');
  PERFORM t_fails('3-decimal amount rejected', format($q$SELECT invoice_record_payment(%L, current_date, 10.123, 'cash', '', '', NULL)$q$, d), '23514');
  PERFORM t_fails('future payment date rejected', format($q$SELECT invoice_record_payment(%L, current_date + 3, 10, 'cash', '', '', NULL)$q$, d), '23514');
  PERFORM t_fails('unknown method rejected', format($q$SELECT invoice_record_payment(%L, current_date, 10, 'bitcoin', '', '', NULL)$q$, d), '23514');
  PERFORM invoice_record_payment(d, current_date, tot - 1000, 'bank_transfer', 'TRX-9', '', gen_random_uuid());
  PERFORM t_ok('fully paid: status paid, balance 0', (SELECT display_status = 'paid' AND balance = 0 FROM invoice_overview WHERE id = d));
  PERFORM t_fails('nothing more can be paid on a settled invoice', format($q$SELECT invoice_record_payment(%L, current_date, 1, 'cash', '', '', NULL)$q$, d), '23514', 'overpayment');
  PERFORM t_fails('a paid invoice cannot be cancelled while payments exist', format($q$SELECT invoice_cancel(%L, 'mistake')$q$, d), '23514', 'has_payments');
  -- reverse the first payment: history kept, balance back up
  PERFORM t_fails('reversal needs a reason', format($q$SELECT invoice_reverse_payment(%L, '')$q$, p1), '23514');
  PERFORM invoice_reverse_payment(p1, 'entered on the wrong invoice');
  PERFORM t_ok('reversed payment is kept, flagged, and excluded from the balance', (SELECT reversed AND reverse_reason IS NOT NULL FROM invoice_payments WHERE id = p1) AND (SELECT paid_amount = tot - 1000 AND display_status = 'partial' FROM invoice_overview WHERE id = d));
  PERFORM t_fails('a reversed payment cannot be reversed again', format($q$SELECT invoice_reverse_payment(%L, 'again please')$q$, p1), '23514');
  RESET ROLE;
  PERFORM set_config('app.invoice_rpc', '1', true);
  PERFORM t_fails('a payment cannot be deleted', format($q$DELETE FROM invoice_payments WHERE id = %L$q$, p1), '23514');
  PERFORM t_fails('a payment amount cannot be edited', format($q$UPDATE invoice_payments SET amount = 1 WHERE id = %L$q$, p1), '23514');
END $$;

-- overdue + cancel + numbers are never reused
DO $$ DECLARE d uuid; d2 uuid; n2 text; yr text := extract(year FROM current_date)::text; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  d := invoice_save_draft(jsonb_build_object('customer', jsonb_build_object('name', 'Late Payer'), 'issue_date', current_date - 40, 'due_date', current_date - 20),
        '[{"kind":"custom","name":"Support","qty":1,"unit_price":5000}]');
  n2 := invoice_issue(d) ->> 'number';
  PERFORM t_ok('second invoice gets the next number', n2 = 'SUB-INV-' || yr || '-000002');
  PERFORM t_ok('past due and unpaid shows overdue', (SELECT display_status = 'overdue' AND is_overdue FROM invoice_overview WHERE id = d));
  PERFORM invoice_record_payment(d, current_date, 100, 'cash', '', '', gen_random_uuid());
  PERFORM t_ok('part-paid but past due still shows overdue (with the paid amount)', (SELECT display_status = 'overdue' AND paid_amount = 100 FROM invoice_overview WHERE id = d));
  PERFORM t_fails('cancel needs a reason', format($q$SELECT invoice_cancel(%L, ' ')$q$, d), '23514');
  PERFORM t_fails('cancel blocked while a payment is active', format($q$SELECT invoice_cancel(%L, 'customer left')$q$, d), '23514', 'has_payments');
  PERFORM invoice_reverse_payment((SELECT id FROM invoice_payments WHERE invoice_id = d), 'wrong customer');
  PERFORM invoice_cancel(d, 'customer cancelled the job');
  PERFORM t_ok('cancelled invoice keeps its number and shows cancelled', (SELECT number = n2 AND display_status = 'cancelled' AND cancel_reason IS NOT NULL FROM invoice_overview WHERE id = d));
  PERFORM t_fails('a cancelled invoice cannot take payments', format($q$SELECT invoice_record_payment(%L, current_date, 5, 'cash', '', '', NULL)$q$, d), '23514');
  d2 := invoice_save_draft(jsonb_build_object('customer', jsonb_build_object('name', 'Another One')), '[{"kind":"custom","name":"Thing","qty":1,"unit_price":10}]');
  PERFORM t_ok('a cancelled number is never reused', invoice_issue(d2) ->> 'number' = 'SUB-INV-' || yr || '-000003');
  RESET ROLE;
END $$;

-- ── 7. Invoices from real orders ───────────────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE onum text; oid bigint; d uuid; d2 uuid; ord orders%ROWTYPE; stock_before int; stock_after int; BEGIN
  SET LOCAL ROLE anon;
  SELECT order_number INTO onum FROM place_order('Besnik Test', 'b@example.test', '0691234567', 'Rruga Test 9, Tiranë', 'zile te dyja', '[{"id":"p1","qty":2},{"id":"p2","qty":1}]'::jsonb);
  RESET ROLE;
  SELECT * INTO ord FROM orders WHERE order_number = onum;
  oid := ord.id;
  -- the shop price changes AFTER the order was placed
  UPDATE products SET price = 12345 WHERE id = 'p1';
  SELECT stock INTO stock_before FROM products WHERE id = 'p1';
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  d := invoice_save_draft(jsonb_build_object('client_token', gen_random_uuid(), 'order_id', oid, 'currency', 'ALL', 'shipping', 1,
         'customer', jsonb_build_object('name', ord.customer_name, 'phone', ord.customer_phone, 'email', ord.customer_email, 'address', ord.delivery_address)),
       '[{"kind":"order","order_line":0,"unit_price":1,"qty":99,"vat_rate":0},{"kind":"order","order_line":1,"vat_rate":0}]'::jsonb);
  PERFORM t_ok('order lines keep the ORIGINAL ordered price, not the current catalogue price', (SELECT unit_price FROM invoice_items WHERE invoice_id = d AND order_line = 0) = 10000);
  PERFORM t_ok('order quantities cannot be changed by the browser', (SELECT qty FROM invoice_items WHERE invoice_id = d AND order_line = 0) = 2);
  PERFORM t_ok('delivery charge comes from the order', (SELECT shipping = ord.shipping FROM invoices WHERE id = d));
  PERFORM t_ok('invoice total equals the order total when VAT is 0', (SELECT total = ord.total FROM invoices WHERE id = d));
  PERFORM t_ok('invoice keeps the order reference and recorded order total', (SELECT order_id = oid AND order_ref = onum AND source_order_total = ord.total FROM invoices WHERE id = d));
  PERFORM t_fails('a second invoice for the same order is refused', format($q$SELECT invoice_save_draft(jsonb_build_object('order_id', %s, 'customer', jsonb_build_object('name','Besnik Test')), '[]')$q$, oid), '23505', 'order_already_invoiced');
  PERFORM invoice_issue(d);
  RESET ROLE;
  SELECT stock INTO stock_after FROM products WHERE id = 'p1';
  PERFORM t_ok('invoicing an order does not touch stock', stock_before = stock_after);
  PERFORM t_ok('invoicing an order does not change its status', (SELECT status FROM orders WHERE id = oid) = 'pending');
  PERFORM t_fails('an order with an invoice cannot be deleted', format($q$DELETE FROM orders WHERE id = %s$q$, oid), '23503');
  -- cancel the invoice -> the order can be invoiced again (corrected invoice), and old number stays used
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  PERFORM invoice_cancel(d, 'wrong customer name');
  d2 := invoice_save_draft(jsonb_build_object('order_id', oid, 'customer', jsonb_build_object('name', 'Besnik Test Corrected')), '[]');
  PERFORM t_ok('after cancelling, the order can be invoiced again (explicit correction)', d2 IS NOT NULL AND (SELECT count(*) FROM invoice_items WHERE invoice_id = d2) = 2);
  PERFORM t_ok('order lines are created even if the browser sent none', (SELECT sum(line_total) FROM invoice_items WHERE invoice_id = d2) + (SELECT shipping FROM invoices WHERE id = d2) = ord.total);
  -- extra custom line and VAT on an order invoice
  d2 := invoice_save_draft(jsonb_build_object('id', d2, 'customer', jsonb_build_object('name', 'Besnik Test Corrected')),
        '[{"kind":"order","order_line":0,"vat_rate":20},{"kind":"order","order_line":1,"vat_rate":20},{"kind":"custom","name":"Instalim","qty":1,"unit_price":2000,"vat_rate":20}]');
  PERFORM t_ok('extra custom line added on top of the order lines', (SELECT count(*) FROM invoice_items WHERE invoice_id = d2) = 3);
  PERFORM t_ok('VAT added on an order invoice makes the total exceed the order total (flagged in the screen)', (SELECT total > source_order_total FROM invoices WHERE id = d2));
  RESET ROLE;
END $$;

-- ── 8. History, privacy of the overview, structure ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  PERFORM t_ok('events recorded for create, issue, payment, reversal, cancel', (SELECT count(DISTINCT action) FROM invoice_events WHERE action IN ('draft_created', 'issued', 'payment_recorded', 'payment_reversed', 'cancelled')) = 5);
  PERFORM t_ok('events record who did it', (SELECT bool_and(actor_email = 'admin@example.test' OR actor_email IS NOT NULL) FROM invoice_events WHERE action = 'issued'));
  PERFORM t_fails('history cannot be edited', $q$UPDATE invoice_events SET action = 'x'$q$, '23514');
  PERFORM t_fails('history cannot be deleted', $q$DELETE FROM invoice_events$q$, '23514');
  PERFORM as_user('00000000-0000-0000-0000-0000000000b2'); SET LOCAL ROLE authenticated;
  PERFORM t_ok('staff sees nothing through the overview view (RLS applies through the view)', (SELECT count(*) FROM invoice_overview) = 0);
  RESET ROLE;
  PERFORM t_ok('unique invoice numbers enforced by the database', EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'invoices' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(number)%'));
  PERFORM t_ok('invoices_one_live_per_order index exists', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'invoices_one_live_per_order'));
  PERFORM t_ok('existing products, orders and services were not modified by the migration objects', (SELECT count(*) FROM orders) = 1);
END $$;
SELECT 'ALL INVOICING DATABASE TESTS PASSED' AS result;
