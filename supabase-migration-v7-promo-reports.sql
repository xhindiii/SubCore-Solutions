-- ============================================================================
-- SubCore Solutions — PROMO TEMPLATES + PURCHASE LEDGER (v7)
-- Run AFTER supabase-migration-v4-security.sql (v5/v6 are independent). Safe to re-run.
--
-- BEFORE YOU RUN IT: staging first, take a backup, keep supabase-migration-v7-ROLLBACK.sql
-- to hand. Purely additive: two new tables. It does not touch products, services, orders,
-- invoices or any existing column, policy or row.
--
--   promo_templates   saved, editable designs for the promotional-graphic generator.
--                     A template holds LAYOUT/STYLE settings only (colours, fonts, positions, texts).
--                     It never holds a product price or product data, and never an image.
--                     Admin + editor can read and write.
--   purchase_records  a simple purchase ledger for the monthly purchase report (supplier, document
--                     number, date, amounts, paid amount). Entered by hand, so it is NOT verified
--                     against supplier documents. ADMIN ONLY (financial data). Rows can never be
--                     deleted from the app: a wrong row is VOIDED (kept, flagged, excluded from reports).
-- ============================================================================

-- 1) Promo templates ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.promo_templates (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  spec        JSONB NOT NULL CHECK (jsonb_typeof(spec) = 'object' AND length(spec::text) <= 8000),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.promo_templates_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS promo_templates_touch_trg ON public.promo_templates;
CREATE TRIGGER promo_templates_touch_trg BEFORE INSERT OR UPDATE ON public.promo_templates
  FOR EACH ROW EXECUTE FUNCTION public.promo_templates_touch();

ALTER TABLE public.promo_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read promo templates"   ON public.promo_templates;
DROP POLICY IF EXISTS "Staff write promo templates"  ON public.promo_templates;
CREATE POLICY "Staff read promo templates"  ON public.promo_templates FOR SELECT USING (public.has_admin_role(ARRAY['admin', 'editor']));
CREATE POLICY "Staff write promo templates" ON public.promo_templates FOR ALL
  USING (public.has_admin_role(ARRAY['admin', 'editor'])) WITH CHECK (public.has_admin_role(ARRAY['admin', 'editor']));
REVOKE ALL ON public.promo_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_templates TO authenticated;

DROP TRIGGER IF EXISTS audit_promo_templates ON public.promo_templates;
CREATE TRIGGER audit_promo_templates AFTER INSERT OR UPDATE OR DELETE ON public.promo_templates
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- 2) Purchase ledger -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_records (
  id            BIGSERIAL PRIMARY KEY,
  supplier      TEXT NOT NULL CHECK (length(trim(supplier)) BETWEEN 1 AND 120),
  doc_number    TEXT NOT NULL CHECK (length(trim(doc_number)) BETWEEN 1 AND 60),
  doc_date      DATE NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'ALL' CHECK (currency ~ '^[A-Z]{3}$'),
  net_amount    NUMERIC(14,2) CHECK (net_amount IS NULL OR net_amount >= 0),
  vat_amount    NUMERIC(14,2) CHECK (vat_amount IS NULL OR vat_amount >= 0),
  total_amount  NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  paid_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  paid_date     DATE,
  note          TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  voided        BOOLEAN NOT NULL DEFAULT false,
  void_reason   TEXT CHECK (void_reason IS NULL OR length(void_reason) <= 300),
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchase_paid_le_total CHECK (paid_amount <= total_amount),
  CONSTRAINT purchase_net_vat_total CHECK (net_amount IS NULL OR vat_amount IS NULL OR net_amount + vat_amount = total_amount),
  CONSTRAINT purchase_paid_date_needed CHECK (paid_amount = 0 OR paid_date IS NOT NULL),
  CONSTRAINT purchase_void_reason CHECK (NOT voided OR (void_reason IS NOT NULL AND length(trim(void_reason)) > 0))
);
-- The same supplier document can be recorded only once (voided rows do not block re-entering a corrected one).
CREATE UNIQUE INDEX IF NOT EXISTS purchase_records_unique_doc
  ON public.purchase_records (lower(trim(supplier)), lower(trim(doc_number))) WHERE NOT voided;
CREATE INDEX IF NOT EXISTS purchase_records_date_idx ON public.purchase_records (doc_date);

CREATE OR REPLACE FUNCTION public.purchase_records_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  -- A voided record is final: it cannot be un-voided or edited (record a new, correct row instead).
  IF TG_OP = 'UPDATE' AND OLD.voided THEN
    RAISE EXCEPTION 'A voided purchase record cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS purchase_records_touch_trg ON public.purchase_records;
CREATE TRIGGER purchase_records_touch_trg BEFORE INSERT OR UPDATE ON public.purchase_records
  FOR EACH ROW EXECUTE FUNCTION public.purchase_records_touch();

ALTER TABLE public.purchase_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin read purchases"   ON public.purchase_records;
DROP POLICY IF EXISTS "Admin insert purchases" ON public.purchase_records;
DROP POLICY IF EXISTS "Admin update purchases" ON public.purchase_records;
CREATE POLICY "Admin read purchases"   ON public.purchase_records FOR SELECT USING (public.has_admin_role(ARRAY['admin']));
CREATE POLICY "Admin insert purchases" ON public.purchase_records FOR INSERT WITH CHECK (public.has_admin_role(ARRAY['admin']));
CREATE POLICY "Admin update purchases" ON public.purchase_records FOR UPDATE
  USING (public.has_admin_role(ARRAY['admin'])) WITH CHECK (public.has_admin_role(ARRAY['admin']));
-- No DELETE policy and no DELETE grant: purchase records are voided, never deleted.
REVOKE ALL ON public.purchase_records FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.purchase_records TO authenticated;
GRANT USAGE ON SEQUENCE public.purchase_records_id_seq TO authenticated;

DROP TRIGGER IF EXISTS audit_purchase_records ON public.purchase_records;
CREATE TRIGGER audit_purchase_records AFTER INSERT OR UPDATE ON public.purchase_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- Verify (after running):
--   SELECT count(*) FROM promo_templates;   -- 0 (the four built-in designs live in the app, not here)
--   SELECT count(*) FROM purchase_records;  -- 0: nothing is invented
