-- ROLLBACK for supabase-migration-v8-invoicing.sql
-- WARNING: this permanently deletes every invoice, invoice line, payment, customer, invoice event, numbering counter and
-- the invoice settings. Download a backup / export the invoices first. It touches NO product, service, order or other
-- existing table. Run in the Supabase SQL editor only after you decide to remove the invoicing feature.
BEGIN;
DROP VIEW IF EXISTS invoice_overview;
DROP FUNCTION IF EXISTS invoice_reverse_payment(uuid, text);
DROP FUNCTION IF EXISTS invoice_record_payment(uuid, date, numeric, text, text, text, uuid);
DROP FUNCTION IF EXISTS invoice_set_fiscal_ref(uuid, text);
DROP FUNCTION IF EXISTS invoice_cancel(uuid, text);
DROP FUNCTION IF EXISTS invoice_issue(uuid);
DROP FUNCTION IF EXISTS invoice_delete_draft(uuid);
DROP FUNCTION IF EXISTS invoice_save_draft(jsonb, jsonb);
DROP FUNCTION IF EXISTS customer_set_archived(uuid, boolean);
DROP FUNCTION IF EXISTS customer_save(jsonb);
DROP FUNCTION IF EXISTS invoice_settings_save(jsonb);
DROP FUNCTION IF EXISTS invoice_compute(jsonb, text, numeric, numeric, numeric);
DROP TABLE IF EXISTS invoice_events CASCADE;
DROP TABLE IF EXISTS invoice_payments CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS invoice_counters CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS invoice_settings CASCADE;
DROP FUNCTION IF EXISTS inv_event(uuid, text, jsonb);
DROP FUNCTION IF EXISTS inv_name(jsonb, text, text);
DROP FUNCTION IF EXISTS invoices_guard() CASCADE;
DROP FUNCTION IF EXISTS invoice_items_guard() CASCADE;
DROP FUNCTION IF EXISTS invoice_payments_guard() CASCADE;
DROP FUNCTION IF EXISTS invoice_events_guard() CASCADE;
DROP FUNCTION IF EXISTS inv_num(text, text, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS inv_text(text, int, text, boolean);
DROP FUNCTION IF EXISTS inv_via_rpc();
DROP FUNCTION IF EXISTS inv_require_admin();
DROP FUNCTION IF EXISTS inv_today();
COMMIT;
