-- ============================================================================
-- SubCore Solutions — ROLLBACK for supabase-migration-v7-promo-reports.sql
-- WARNING: deletes every saved promo template AND every purchase record. Export first
-- (Admin -> Reports -> Purchases -> Export CSV). Products, services, orders and invoices
-- are untouched.
-- ============================================================================
DROP TRIGGER  IF EXISTS audit_promo_templates ON public.promo_templates;
DROP TRIGGER  IF EXISTS audit_purchase_records ON public.purchase_records;
DROP TABLE    IF EXISTS public.promo_templates;
DROP TABLE    IF EXISTS public.purchase_records;
DROP FUNCTION IF EXISTS public.promo_templates_touch();
DROP FUNCTION IF EXISTS public.purchase_records_touch();
