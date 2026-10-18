-- ============================================================================
-- SubCore Solutions — INVOICING (v8)
-- Run AFTER supabase-migration-v4-security.sql (v5/v6/v7 are independent). Safe to re-run.
--
-- BEFORE YOU RUN IT: staging first, take a backup, keep supabase-migration-v8-ROLLBACK.sql to hand.
-- Purely additive: new tables, one view, new functions. It does NOT change products, services, orders,
-- website_settings, place_order(), policies of existing tables, or any existing row. One side effect, on
-- purpose: an order that has an invoice cannot be deleted (the invoice keeps its reference to it).
--
-- What it adds
--   invoice_settings   private company / invoice settings (one row). NOT website_settings, because that table is public.
--   customers          customer records for invoicing. Archived, never deleted if invoiced.
--   invoices           header + frozen totals. Drafts are editable; issued invoices are immutable.
--   invoice_items      line snapshots (name, SKU, description, unit price, VAT rate) taken from the real catalogue or order.
--   invoice_payments   payments; a wrong payment is REVERSED (kept, flagged), never deleted.
--   invoice_counters   server-side numbering counter (one row per prefix + year).
--   invoice_events     append-only history: who did what, when.
--   invoice_overview   view: invoice + paid amount + balance + derived status (draft/issued/partial/paid/overdue/cancelled).
--
-- Security model
--   Admin role only (has_admin_role(['admin'])), enforced by the database. The browser can READ these tables (RLS) but cannot
--   INSERT/UPDATE/DELETE them: every change goes through the invoice_* / customer_* functions below, which re-check the role,
--   take prices and names from the real products / services / orders (never from the browser), compute every amount on the
--   server, allocate invoice numbers in the same transaction that issues the invoice, and write the history.
--
-- Numbering policy: drafts have no number. The number SUB-INV-2026-000001 (prefix, year of the issue date, sequence) is
--   assigned at the moment of issue, under a row lock, inside the issuing transaction. A failed request rolls the counter
--   back with it, so there are no gaps from failures; an issued or cancelled number is never reused.
-- Rounding: every amount is rounded half-up to 2 decimals per line; the overall discount is shared between lines
--   proportionally (rounding remainder to the largest line); VAT is calculated per line after discounts. Totals are sums of
--   the rounded line figures, so screen, PDF, CSV and reports can never disagree by a cent.
-- This is NOT fiscalization. fiscal_ref is only a free-text note for a reference you obtained elsewhere.
-- ============================================================================

-- 0) Helpers -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_today() RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Europe/Tirane')::date;
$$;

CREATE OR REPLACE FUNCTION public.inv_require_admin() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_admin_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Only an admin can manage invoices.' USING ERRCODE = '42501';
  END IF;
END $$;

-- 1) Tables -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_settings (
  id          SMALLINT PRIMARY KEY CHECK (id = 1),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND length(data::text) <= 8000),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID
);
INSERT INTO public.invoice_settings (id, data) VALUES (1, jsonb_build_object(
  'currency', 'ALL', 'prefix', 'SUB-INV', 'number_digits', 6, 'payment_terms_days', 14, 'language', 'sq'))
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'business')),
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  tax_id      TEXT NOT NULL DEFAULT '' CHECK (length(tax_id) <= 40),
  address     TEXT NOT NULL DEFAULT '' CHECK (length(address) <= 200),
  city        TEXT NOT NULL DEFAULT '' CHECK (length(city) <= 80),
  country     TEXT NOT NULL DEFAULT '' CHECK (length(country) <= 80),
  email       TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 160),
  phone       TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  notes       TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_name_idx ON public.customers (lower(name));

CREATE TABLE IF NOT EXISTS public.invoice_counters (
  scope       TEXT PRIMARY KEY,
  last_value  BIGINT NOT NULL CHECK (last_value >= 0)
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_token           UUID UNIQUE,
  number                 TEXT UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'cancelled')),
  currency               TEXT NOT NULL DEFAULT 'ALL' CHECK (currency ~ '^[A-Z]{3}$'),
  issue_date             DATE NOT NULL,
  due_date               DATE,
  customer_id            UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer               JSONB NOT NULL CHECK (jsonb_typeof(customer) = 'object'),
  seller                 JSONB CHECK (seller IS NULL OR jsonb_typeof(seller) = 'object'),
  order_id               BIGINT REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_ref              TEXT,
  source_order_total     NUMERIC(14,2),
  payment_method         TEXT NOT NULL DEFAULT '' CHECK (payment_method IN ('', 'cash', 'bank_transfer', 'card', 'other')),
  payment_terms          TEXT NOT NULL DEFAULT '' CHECK (length(payment_terms) <= 300),
  notes                  TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  footer                 TEXT NOT NULL DEFAULT '' CHECK (length(footer) <= 400),
  overall_discount_type  TEXT NOT NULL DEFAULT 'amount' CHECK (overall_discount_type IN ('percent', 'amount')),
  overall_discount_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (overall_discount_value >= 0),
  shipping               NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping >= 0),
  shipping_vat_rate      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (shipping_vat_rate BETWEEN 0 AND 100),
  gross_total            NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_discount_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
  overall_discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total                  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  fiscal_ref             TEXT NOT NULL DEFAULT '' CHECK (length(fiscal_ref) <= 120),
  issued_at              TIMESTAMPTZ,
  issued_by              UUID,
  cancelled_at           TIMESTAMPTZ,
  cancelled_by           UUID,
  cancel_reason          TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 300),
  created_by             UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_number_when_issued CHECK ((status = 'draft' AND number IS NULL) OR (status <> 'draft' AND number IS NOT NULL)),
  CONSTRAINT invoice_cancel_reason_needed CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND length(trim(cancel_reason)) >= 3)),
  CONSTRAINT invoice_due_after_issue CHECK (due_date IS NULL OR due_date >= issue_date)
);
-- One live invoice per order. A cancelled invoice frees the order for a corrected one.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_live_per_order ON public.invoices (order_id) WHERE order_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS invoices_customer_idx ON public.invoices (customer_id);
CREATE INDEX IF NOT EXISTS invoices_issue_date_idx ON public.invoices (issue_date DESC);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices (status);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  position              INTEGER NOT NULL CHECK (position >= 1),
  kind                  TEXT NOT NULL CHECK (kind IN ('product', 'service', 'order', 'custom')),
  source_id             TEXT,          -- products.id / services.id at the time of the snapshot (no FK on purpose: history must outlive the product)
  order_line            INTEGER,       -- index into orders.items for lines taken from an order
  sku                   TEXT NOT NULL DEFAULT '' CHECK (length(sku) <= 80),
  name                  TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description           TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  unit                  TEXT NOT NULL DEFAULT 'pcs' CHECK (length(unit) BETWEEN 1 AND 20),
  qty                   NUMERIC(12,3) NOT NULL CHECK (qty > 0 AND qty <= 100000),
  unit_price            NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_type         TEXT NOT NULL DEFAULT 'amount' CHECK (discount_type IN ('percent', 'amount')),
  discount_value        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  vat_rate              NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate BETWEEN 0 AND 100),
  line_gross            NUMERIC(14,2) NOT NULL,
  line_discount         NUMERIC(14,2) NOT NULL,
  line_net              NUMERIC(14,2) NOT NULL,
  overall_discount_share NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_tax              NUMERIC(14,2) NOT NULL,
  line_total            NUMERIC(14,2) NOT NULL,
  UNIQUE (invoice_id, position)
);
CREATE INDEX IF NOT EXISTS invoice_items_source_idx ON public.invoice_items (source_id);

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_token   UUID UNIQUE,
  invoice_id     UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  paid_on        DATE NOT NULL,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method         TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'card', 'other')),
  reference      TEXT NOT NULL DEFAULT '' CHECK (length(reference) <= 120),
  note           TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  recorded_by    UUID,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed       BOOLEAN NOT NULL DEFAULT false,
  reversed_at    TIMESTAMPTZ,
  reversed_by    UUID,
  reverse_reason TEXT CHECK (reverse_reason IS NULL OR length(reverse_reason) <= 300),
  CONSTRAINT payment_reverse_reason CHECK (NOT reversed OR (reverse_reason IS NOT NULL AND length(trim(reverse_reason)) >= 3))
);
CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON public.invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_payments_paid_on_idx ON public.invoice_payments (paid_on DESC);

CREATE TABLE IF NOT EXISTS public.invoice_events (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     UUID,
  actor_email  TEXT,
  invoice_id   UUID,
  action       TEXT NOT NULL,
  detail       JSONB
);
CREATE INDEX IF NOT EXISTS invoice_events_invoice_idx ON public.invoice_events (invoice_id, at);

-- 2) Overview view (RLS of the base tables applies: security_invoker) ------------------------------------
CREATE OR REPLACE VIEW public.invoice_overview WITH (security_invoker = true) AS
SELECT i.*,
       COALESCE(p.paid, 0)                              AS paid_amount,
       i.total - COALESCE(p.paid, 0)                    AS balance,
       (i.status = 'issued' AND i.total - COALESCE(p.paid, 0) > 0 AND i.due_date IS NOT NULL AND i.due_date < public.inv_today()) AS is_overdue,
       CASE
         WHEN i.status = 'draft'     THEN 'draft'
         WHEN i.status = 'cancelled' THEN 'cancelled'
         WHEN i.total - COALESCE(p.paid, 0) <= 0 THEN 'paid'
         WHEN i.due_date IS NOT NULL AND i.due_date < public.inv_today() THEN 'overdue'
         WHEN COALESCE(p.paid, 0) > 0 THEN 'partial'
         ELSE 'issued'
       END                                              AS display_status
FROM public.invoices i
LEFT JOIN (SELECT invoice_id, sum(amount) AS paid FROM public.invoice_payments WHERE NOT reversed GROUP BY invoice_id) p ON p.invoice_id = i.id;

-- 3) Immutability guards (defence in depth: the browser has no write grants at all) ------------------------
CREATE OR REPLACE FUNCTION public.inv_via_rpc() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.invoice_rpc', true), '') = '1';
$$;

CREATE OR REPLACE FUNCTION public.invoices_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE keep TEXT[] := ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'fiscal_ref', 'updated_at'];
BEGIN
  IF NOT public.inv_via_rpc() THEN RAISE EXCEPTION 'Invoices can only be changed through the invoice functions.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'An issued invoice cannot be deleted. Cancel it instead.' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled invoice cannot be changed.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'issued' THEN
    IF NEW.status NOT IN ('issued', 'cancelled') THEN RAISE EXCEPTION 'An issued invoice cannot go back to draft.' USING ERRCODE = 'check_violation'; END IF;
    IF (to_jsonb(NEW) - keep) IS DISTINCT FROM (to_jsonb(OLD) - keep) THEN
      RAISE EXCEPTION 'An issued invoice cannot be edited. Cancel it and issue a corrected one.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoices_guard_trg ON public.invoices;
CREATE TRIGGER invoices_guard_trg BEFORE UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_guard();

CREATE OR REPLACE FUNCTION public.invoice_items_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE st TEXT; inv UUID := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  IF NOT public.inv_via_rpc() THEN RAISE EXCEPTION 'Invoice lines can only be changed through the invoice functions.' USING ERRCODE = '42501'; END IF;
  SELECT status INTO st FROM public.invoices WHERE id = inv;
  -- st is NULL when the parent draft is being deleted (cascade): allowed.
  IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'The lines of an issued invoice cannot be changed.' USING ERRCODE = 'check_violation'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS invoice_items_guard_trg ON public.invoice_items;
CREATE TRIGGER invoice_items_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.invoice_items_guard();

CREATE OR REPLACE FUNCTION public.invoice_payments_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE keep TEXT[] := ARRAY['reversed', 'reversed_at', 'reversed_by', 'reverse_reason'];
BEGIN
  IF NOT public.inv_via_rpc() THEN RAISE EXCEPTION 'Payments can only be changed through the invoice functions.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A payment cannot be deleted. Reverse it instead.' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.reversed THEN RAISE EXCEPTION 'A reversed payment is final.' USING ERRCODE = 'check_violation'; END IF;
    IF (to_jsonb(NEW) - keep) IS DISTINCT FROM (to_jsonb(OLD) - keep) THEN RAISE EXCEPTION 'A recorded payment cannot be edited. Reverse it and record a new one.' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_payments_guard_trg ON public.invoice_payments;
CREATE TRIGGER invoice_payments_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.invoice_payments_guard();

CREATE OR REPLACE FUNCTION public.invoice_events_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN RAISE EXCEPTION 'The invoice history is append-only.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_events_guard_trg ON public.invoice_events;
CREATE TRIGGER invoice_events_guard_trg BEFORE UPDATE OR DELETE ON public.invoice_events FOR EACH ROW EXECUTE FUNCTION public.invoice_events_guard();

-- 4) Row Level Security + grants: admin may READ; nobody may write directly -----------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_settings', 'customers', 'invoice_counters', 'invoices', 'invoice_items', 'invoice_payments', 'invoice_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Admin read %1$s" ON public.%1$I FOR SELECT USING (public.has_admin_role(ARRAY[''admin'']))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON public.invoice_overview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoice_overview TO authenticated;
-- The numbering counter is internal: the browser never needs to read it.
REVOKE SELECT ON public.invoice_counters FROM authenticated;

-- 5) Pure money maths (same rules as invoices-core.js; both are tested against each other) -----------------
CREATE OR REPLACE FUNCTION public.invoice_compute(p_items JSONB, p_disc_type TEXT, p_disc_value NUMERIC, p_shipping NUMERIC, p_ship_vat NUMERIC)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n INT := COALESCE(jsonb_array_length(p_items), 0);
  i INT; q NUMERIC; pr NUMERIC; dt TEXT; dv NUMERIC; vr NUMERIC;
  gross NUMERIC[] := '{}'; ldisc NUMERIC[] := '{}'; net NUMERIC[] := '{}'; share NUMERIC[] := '{}'; vat NUMERIC[] := '{}';
  sum_gross NUMERIC := 0; sum_ldisc NUMERIC := 0; sum_net NUMERIC := 0; odisc NUMERIC := 0; alloc NUMERIC := 0; big INT := 1;
  taxable NUMERIC; tax NUMERIC; ltotal NUMERIC; sum_taxable NUMERIC := 0; sum_tax NUMERIC := 0;
  ship NUMERIC := COALESCE(p_shipping, 0); ship_tax NUMERIC;
  lines JSONB := '[]'::jsonb;
BEGIN
  FOR i IN 1..n LOOP
    q  := (p_items -> (i - 1) ->> 'qty')::numeric;
    pr := (p_items -> (i - 1) ->> 'unit_price')::numeric;
    dt := COALESCE(p_items -> (i - 1) ->> 'discount_type', 'amount');
    dv := COALESCE((p_items -> (i - 1) ->> 'discount_value')::numeric, 0);
    vr := COALESCE((p_items -> (i - 1) ->> 'vat_rate')::numeric, 0);
    gross[i] := round(q * pr, 2);
    ldisc[i] := CASE WHEN dt = 'percent' THEN round(gross[i] * dv / 100, 2) ELSE least(dv, gross[i]) END;
    net[i]   := gross[i] - ldisc[i];
    vat[i]   := vr;
    sum_gross := sum_gross + gross[i]; sum_ldisc := sum_ldisc + ldisc[i]; sum_net := sum_net + net[i];
    IF net[i] > net[big] THEN big := i; END IF;
  END LOOP;

  odisc := CASE WHEN COALESCE(p_disc_type, 'amount') = 'percent' THEN round(sum_net * COALESCE(p_disc_value, 0) / 100, 2)
                ELSE least(COALESCE(p_disc_value, 0), sum_net) END;
  FOR i IN 1..n LOOP
    share[i] := CASE WHEN sum_net > 0 THEN round(odisc * net[i] / sum_net, 2) ELSE 0 END;
    alloc := alloc + share[i];
  END LOOP;
  IF n > 0 THEN share[big] := share[big] + (odisc - alloc); END IF;

  FOR i IN 1..n LOOP
    taxable := net[i] - share[i];
    tax := round(taxable * vat[i] / 100, 2);
    ltotal := taxable + tax;
    sum_taxable := sum_taxable + taxable; sum_tax := sum_tax + tax;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'line_gross', gross[i], 'line_discount', ldisc[i], 'line_net', net[i], 'overall_discount_share', share[i],
      'line_tax', tax, 'line_total', ltotal));
  END LOOP;

  ship_tax := round(ship * COALESCE(p_ship_vat, 0) / 100, 2);
  RETURN jsonb_build_object(
    'lines', lines,
    'gross_total', sum_gross, 'line_discount_total', sum_ldisc, 'overall_discount_total', odisc,
    'taxable_total', sum_taxable, 'shipping', ship, 'shipping_tax', ship_tax,
    'tax_total', sum_tax + ship_tax, 'total', sum_taxable + ship + sum_tax + ship_tax);
END $$;

-- 6) Small validators ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_text(v TEXT, maxlen INT, label TEXT, required BOOLEAN DEFAULT false) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE t TEXT := btrim(COALESCE(v, ''));
BEGIN
  IF required AND length(t) = 0 THEN RAISE EXCEPTION 'invalid_input: % is required', label USING ERRCODE = 'check_violation'; END IF;
  IF length(t) > maxlen THEN RAISE EXCEPTION 'invalid_input: % is too long (max % characters)', label, maxlen USING ERRCODE = 'check_violation'; END IF;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.inv_num(v TEXT, label TEXT, lo NUMERIC, hi NUMERIC, dflt NUMERIC DEFAULT NULL) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x NUMERIC;
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN
    IF dflt IS NULL THEN RAISE EXCEPTION 'invalid_input: % is required', label USING ERRCODE = 'check_violation'; END IF;
    RETURN dflt;
  END IF;
  BEGIN x := v::numeric; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid_input: % must be a number', label USING ERRCODE = 'check_violation'; END;
  IF x < lo OR x > hi THEN RAISE EXCEPTION 'invalid_input: % must be between % and %', label, lo, hi USING ERRCODE = 'check_violation'; END IF;
  RETURN x;
END $$;

CREATE OR REPLACE FUNCTION public.inv_event(p_invoice UUID, p_action TEXT, p_detail JSONB DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mail TEXT;
BEGIN
  SELECT email INTO mail FROM admin_users WHERE auth_user_id = auth.uid();
  INSERT INTO invoice_events (actor_id, actor_email, invoice_id, action, detail) VALUES (auth.uid(), mail, p_invoice, p_action, p_detail);
END $$;

CREATE OR REPLACE FUNCTION public.inv_name(j JSONB, lang TEXT, fallback TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    CASE WHEN jsonb_typeof(j) = 'string' THEN NULLIF(j #>> '{}', '')
         WHEN jsonb_typeof(j) = 'object' THEN COALESCE(NULLIF(j ->> lang, ''), NULLIF(j ->> CASE WHEN lang = 'sq' THEN 'en' ELSE 'sq' END, '')) END,
    fallback);
$$;

-- 7) Settings -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_settings_save(p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d JSONB;
BEGIN
  PERFORM inv_require_admin();
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'invalid_input: settings must be an object' USING ERRCODE = 'check_violation'; END IF;
  d := jsonb_build_object(
    'company_name',  inv_text(p ->> 'company_name', 120, 'Company name'),
    'address',       inv_text(p ->> 'address', 200, 'Address'),
    'city',          inv_text(p ->> 'city', 80, 'City'),
    'country',       inv_text(p ->> 'country', 80, 'Country'),
    'email',         inv_text(p ->> 'email', 160, 'E-mail'),
    'phone',         inv_text(p ->> 'phone', 40, 'Phone'),
    'tax_id',        inv_text(p ->> 'tax_id', 40, 'Tax ID'),
    'registration_no', inv_text(p ->> 'registration_no', 60, 'Registration number'),
    'bank_name',     inv_text(p ->> 'bank_name', 120, 'Bank'),
    'iban',          inv_text(p ->> 'iban', 40, 'IBAN'),
    'swift',         inv_text(p ->> 'swift', 20, 'SWIFT'),
    'payment_terms_text', inv_text(p ->> 'payment_terms_text', 300, 'Payment terms'),
    'footer',        inv_text(p ->> 'footer', 400, 'Footer'),
    'notes_default', inv_text(p ->> 'notes_default', 400, 'Default notes'),
    'payment_terms_days', inv_num(p ->> 'payment_terms_days', 'Payment terms (days)', 0, 365, 14),
    'number_digits', inv_num(p ->> 'number_digits', 'Number length', 4, 9, 6),
    'language',      CASE WHEN p ->> 'language' IN ('sq', 'en') THEN p ->> 'language' ELSE 'sq' END);
  IF COALESCE(p ->> 'prefix', '') !~ '^[A-Z0-9]{1,10}(-[A-Z0-9]{1,10}){0,2}$' THEN
    RAISE EXCEPTION 'invalid_input: the number prefix must be capital letters, digits and dashes, e.g. SUB-INV' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(p ->> 'currency', '') !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'invalid_input: currency must be a 3-letter code such as ALL' USING ERRCODE = 'check_violation'; END IF;
  d := d || jsonb_build_object('prefix', p ->> 'prefix', 'currency', p ->> 'currency');
  -- No tax rate is assumed: unset stays unset (treated as 0 and flagged in the screen).
  IF p ? 'default_vat_rate' AND NULLIF(btrim(p ->> 'default_vat_rate'), '') IS NOT NULL THEN
    d := d || jsonb_build_object('default_vat_rate', inv_num(p ->> 'default_vat_rate', 'Default VAT rate', 0, 100));
  END IF;
  PERFORM set_config('app.invoice_rpc', '1', true);
  INSERT INTO invoice_settings (id, data, updated_by) VALUES (1, d, auth.uid())
  ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = auth.uid();
  PERFORM inv_event(NULL, 'settings_saved', jsonb_build_object('prefix', d ->> 'prefix', 'currency', d ->> 'currency'));
  RETURN d;
END $$;

-- 8) Customers ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_save(p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID; k TEXT := CASE WHEN p ->> 'kind' = 'business' THEN 'business' ELSE 'person' END;
BEGIN
  PERFORM inv_require_admin();
  PERFORM set_config('app.invoice_rpc', '1', true);
  IF length(btrim(COALESCE(p ->> 'name', ''))) < 2 THEN RAISE EXCEPTION 'invalid_input: the customer name needs at least 2 characters' USING ERRCODE = 'check_violation'; END IF;
  IF NULLIF(p ->> 'id', '') IS NULL THEN
    INSERT INTO customers (kind, name, tax_id, address, city, country, email, phone, notes, created_by)
    VALUES (k, inv_text(p ->> 'name', 120, 'Name', true), inv_text(p ->> 'tax_id', 40, 'Tax ID'), inv_text(p ->> 'address', 200, 'Address'),
            inv_text(p ->> 'city', 80, 'City'), inv_text(p ->> 'country', 80, 'Country'), inv_text(p ->> 'email', 160, 'E-mail'),
            inv_text(p ->> 'phone', 40, 'Phone'), inv_text(p ->> 'notes', 500, 'Notes'), auth.uid())
    RETURNING id INTO cid;
    PERFORM inv_event(NULL, 'customer_created', jsonb_build_object('customer_id', cid));
  ELSE
    cid := (p ->> 'id')::uuid;
    UPDATE customers SET kind = k, name = inv_text(p ->> 'name', 120, 'Name', true), tax_id = inv_text(p ->> 'tax_id', 40, 'Tax ID'),
      address = inv_text(p ->> 'address', 200, 'Address'), city = inv_text(p ->> 'city', 80, 'City'), country = inv_text(p ->> 'country', 80, 'Country'),
      email = inv_text(p ->> 'email', 160, 'E-mail'), phone = inv_text(p ->> 'phone', 40, 'Phone'), notes = inv_text(p ->> 'notes', 500, 'Notes'), updated_at = now()
    WHERE id = cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found: customer' USING ERRCODE = 'no_data_found'; END IF;
    PERFORM inv_event(NULL, 'customer_updated', jsonb_build_object('customer_id', cid));
  END IF;
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.customer_set_archived(p_id UUID, p_archived BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM inv_require_admin();
  UPDATE customers SET archived = COALESCE(p_archived, false), updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: customer' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM inv_event(NULL, CASE WHEN p_archived THEN 'customer_archived' ELSE 'customer_restored' END, jsonb_build_object('customer_id', p_id));
END $$;

-- 9) Save a draft (create or edit) -----------------------------------------------------------------------------------------
-- p_invoice: { id?, client_token?, customer_id?, customer{name,kind,tax_id,address,city,country,email,phone}, issue_date, due_date?,
--              currency, payment_method, payment_terms, notes, footer, overall_discount_type, overall_discount_value,
--              shipping, shipping_vat_rate, order_id? }
-- p_items:   [ { kind: product|service|custom|order, source_id?, order_line?, name?, description?, unit?, qty, unit_price?,
--                discount_type, discount_value, vat_rate } ]
-- Prices of catalogue lines and of order lines are read here from the database; whatever the browser sends is ignored.
CREATE OR REPLACE FUNCTION public.invoice_save_draft(p_invoice JSONB, p_items JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg JSONB; lang TEXT; inv_id UUID; cur invoices%ROWTYPE; is_new BOOLEAN := false;
  v_currency TEXT; v_issue DATE; v_due DATE; v_cust JSONB; v_cust_id UUID;
  v_order orders%ROWTYPE; v_order_id BIGINT; v_ship NUMERIC; v_ship_vat NUMERIC;
  v_disc_type TEXT; v_disc_value NUMERIC;
  it JSONB; norm JSONB := '[]'::jsonb; o JSONB; pos INT := 0; k TEXT; prod products%ROWTYPE; svc services%ROWTYPE;
  qty NUMERIC; price NUMERIC; dtype TEXT; dval NUMERIC; vrate NUMERIC; nm TEXT; descr TEXT; sku TEXT; unit TEXT;
  comp JSONB; i INT; ln JSONB; ol INT; oitems JSONB; def_vat NUMERIC; pm TEXT; ocur TEXT;
BEGIN
  PERFORM inv_require_admin();
  PERFORM set_config('app.invoice_rpc', '1', true);
  IF p_invoice IS NULL OR jsonb_typeof(p_invoice) <> 'object' THEN RAISE EXCEPTION 'invalid_input: invoice missing' USING ERRCODE = 'check_violation'; END IF;
  IF p_items IS NULL THEN p_items := '[]'::jsonb; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'invalid_input: at most 100 lines' USING ERRCODE = 'check_violation'; END IF;

  SELECT data INTO cfg FROM invoice_settings WHERE id = 1;
  cfg := COALESCE(cfg, '{}'::jsonb);
  lang := CASE WHEN cfg ->> 'language' = 'en' THEN 'en' ELSE 'sq' END;
  def_vat := COALESCE((cfg ->> 'default_vat_rate')::numeric, 0);

  -- existing draft, or idempotent create
  IF NULLIF(p_invoice ->> 'id', '') IS NOT NULL THEN
    SELECT * INTO cur FROM invoices WHERE id = (p_invoice ->> 'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found: invoice' USING ERRCODE = 'no_data_found'; END IF;
    IF cur.status <> 'draft' THEN RAISE EXCEPTION 'not_draft: only a draft can be edited' USING ERRCODE = 'check_violation'; END IF;
    inv_id := cur.id; v_order_id := cur.order_id;
  ELSE
    IF NULLIF(p_invoice ->> 'client_token', '') IS NOT NULL THEN
      SELECT id INTO inv_id FROM invoices WHERE client_token = (p_invoice ->> 'client_token')::uuid;
      IF inv_id IS NOT NULL THEN RETURN inv_id; END IF;   -- the same click/submission arriving twice
    END IF;
    is_new := true; v_order_id := NULLIF(p_invoice ->> 'order_id', '')::bigint;
  END IF;

  -- header
  v_currency := COALESCE(NULLIF(p_invoice ->> 'currency', ''), cfg ->> 'currency', 'ALL');
  IF v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'invalid_input: currency must be a 3-letter code' USING ERRCODE = 'check_violation'; END IF;
  v_issue := COALESCE(NULLIF(p_invoice ->> 'issue_date', '')::date, inv_today());
  IF v_issue > inv_today() + 7 THEN RAISE EXCEPTION 'invalid_input: the issue date cannot be more than 7 days in the future' USING ERRCODE = 'check_violation'; END IF;
  v_due := NULLIF(p_invoice ->> 'due_date', '')::date;
  IF v_due IS NOT NULL AND v_due < v_issue THEN RAISE EXCEPTION 'invalid_input: the due date cannot be before the issue date' USING ERRCODE = 'check_violation'; END IF;
  pm := COALESCE(p_invoice ->> 'payment_method', '');
  IF pm NOT IN ('', 'cash', 'bank_transfer', 'card', 'other') THEN RAISE EXCEPTION 'invalid_input: unknown payment method' USING ERRCODE = 'check_violation'; END IF;
  v_disc_type := CASE WHEN p_invoice ->> 'overall_discount_type' = 'percent' THEN 'percent' ELSE 'amount' END;
  v_disc_value := inv_num(p_invoice ->> 'overall_discount_value', 'Overall discount', 0, CASE WHEN v_disc_type = 'percent' THEN 100 ELSE 99999999999 END, 0);
  v_ship := inv_num(p_invoice ->> 'shipping', 'Delivery charge', 0, 99999999999, 0);
  v_ship_vat := inv_num(p_invoice ->> 'shipping_vat_rate', 'Delivery VAT rate', 0, 100, def_vat);

  -- customer (the link is validated; the printed details are the admin's reviewed snapshot)
  v_cust_id := NULLIF(p_invoice ->> 'customer_id', '')::uuid;
  IF v_cust_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id = v_cust_id) THEN RAISE EXCEPTION 'not_found: customer' USING ERRCODE = 'no_data_found'; END IF;
  o := COALESCE(p_invoice -> 'customer', '{}'::jsonb);
  v_cust := jsonb_build_object('kind', CASE WHEN o ->> 'kind' = 'business' THEN 'business' ELSE 'person' END,
    'name', inv_text(o ->> 'name', 120, 'Customer name', true), 'tax_id', inv_text(o ->> 'tax_id', 40, 'Customer tax ID'),
    'address', inv_text(o ->> 'address', 200, 'Customer address'), 'city', inv_text(o ->> 'city', 80, 'Customer city'),
    'country', inv_text(o ->> 'country', 80, 'Customer country'), 'email', inv_text(o ->> 'email', 160, 'Customer e-mail'),
    'phone', inv_text(o ->> 'phone', 40, 'Customer phone'));
  IF length(v_cust ->> 'name') < 2 THEN RAISE EXCEPTION 'invalid_input: the customer name needs at least 2 characters' USING ERRCODE = 'check_violation'; END IF;

  -- source order: its lines and delivery come from the order as recorded, not from the browser
  IF v_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM orders WHERE id = v_order_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found: order' USING ERRCODE = 'no_data_found'; END IF;
    IF EXISTS (SELECT 1 FROM invoices WHERE order_id = v_order_id AND status <> 'cancelled' AND id IS DISTINCT FROM inv_id) THEN
      RAISE EXCEPTION 'order_already_invoiced: this order already has an invoice' USING ERRCODE = 'unique_violation';
    END IF;
    oitems := v_order.items;
    v_ship := COALESCE(v_order.shipping, 0);
    ol := 0;
    FOR i IN 0 .. jsonb_array_length(oitems) - 1 LOOP
      it := oitems -> i;
      ocur := COALESCE(NULLIF(it ->> 'currency', ''), v_currency);
      IF ocur <> v_currency THEN RAISE EXCEPTION 'currency_mismatch: the order is in % but the invoice currency is %', ocur, v_currency USING ERRCODE = 'check_violation'; END IF;
      o := (SELECT x FROM jsonb_array_elements(p_items) x WHERE x ->> 'kind' = 'order' AND (x ->> 'order_line')::int = i LIMIT 1);
      o := COALESCE(o, '{}'::jsonb);
      dtype := CASE WHEN o ->> 'discount_type' = 'percent' THEN 'percent' ELSE 'amount' END;
      dval := inv_num(o ->> 'discount_value', 'Discount', 0, CASE WHEN dtype = 'percent' THEN 100 ELSE 99999999999 END, 0);
      vrate := inv_num(o ->> 'vat_rate', 'VAT rate', 0, 100, def_vat);
      norm := norm || jsonb_build_array(jsonb_build_object(
        'kind', 'order', 'source_id', it ->> 'id', 'order_line', i, 'sku', COALESCE(it ->> 'sku', ''),
        'name', inv_name(it -> 'name', lang, COALESCE(it ->> 'id', 'Item')),
        'description', inv_text(o ->> 'description', 500, 'Description'), 'unit', COALESCE(NULLIF(inv_text(o ->> 'unit', 20, 'Unit'), ''), 'pcs'),
        'qty', (it ->> 'qty')::numeric, 'unit_price', (it ->> 'price')::numeric, 'discount_type', dtype, 'discount_value', dval, 'vat_rate', vrate));
    END LOOP;
  END IF;

  -- remaining lines: catalogue products / services (price from the database) and custom lines
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    k := COALESCE(it ->> 'kind', '');
    CONTINUE WHEN k = 'order';
    IF k NOT IN ('product', 'service', 'custom') THEN RAISE EXCEPTION 'invalid_input: unknown line type' USING ERRCODE = 'check_violation'; END IF;
    qty := inv_num(it ->> 'qty', 'Quantity', 0.001, 100000);
    dtype := CASE WHEN it ->> 'discount_type' = 'percent' THEN 'percent' ELSE 'amount' END;
    dval := inv_num(it ->> 'discount_value', 'Discount', 0, CASE WHEN dtype = 'percent' THEN 100 ELSE 99999999999 END, 0);
    vrate := inv_num(it ->> 'vat_rate', 'VAT rate', 0, 100, def_vat);
    unit := COALESCE(NULLIF(inv_text(it ->> 'unit', 20, 'Unit'), ''), 'pcs');
    descr := inv_text(it ->> 'description', 500, 'Description');
    IF k = 'product' THEN
      SELECT * INTO prod FROM products WHERE id = it ->> 'source_id';
      IF NOT FOUND THEN RAISE EXCEPTION 'not_found: product % does not exist', COALESCE(it ->> 'source_id', '?') USING ERRCODE = 'no_data_found'; END IF;
      IF prod.currency <> v_currency THEN RAISE EXCEPTION 'currency_mismatch: product % is priced in %, the invoice is in %', prod.id, prod.currency, v_currency USING ERRCODE = 'check_violation'; END IF;
      nm := inv_name(prod.name, lang, prod.id); price := prod.price; sku := COALESCE(prod.sku, '');
      IF descr = '' THEN descr := left(COALESCE(inv_name(prod.description, lang, ''), ''), 500); END IF;
      norm := norm || jsonb_build_array(jsonb_build_object('kind', 'product', 'source_id', prod.id, 'sku', sku, 'name', nm, 'description', descr, 'unit', unit,
        'qty', qty, 'unit_price', price, 'discount_type', dtype, 'discount_value', dval, 'vat_rate', vrate));
    ELSIF k = 'service' THEN
      SELECT * INTO svc FROM services WHERE id = it ->> 'source_id';
      IF NOT FOUND THEN RAISE EXCEPTION 'not_found: service % does not exist', COALESCE(it ->> 'source_id', '?') USING ERRCODE = 'no_data_found'; END IF;
      IF svc.currency <> v_currency THEN RAISE EXCEPTION 'currency_mismatch: service % is priced in %, the invoice is in %', svc.id, svc.currency, v_currency USING ERRCODE = 'check_violation'; END IF;
      -- A service with a price in the catalogue uses it. A "from / on request" service (price 0) needs the admin to type the agreed price.
      price := CASE WHEN svc.price > 0 THEN svc.price ELSE inv_num(it ->> 'unit_price', 'Price', 0, 99999999999) END;
      nm := inv_name(svc.name, lang, svc.id);
      IF descr = '' THEN descr := left(COALESCE(inv_name(svc.description, lang, ''), ''), 500); END IF;
      norm := norm || jsonb_build_array(jsonb_build_object('kind', 'service', 'source_id', svc.id, 'sku', '', 'name', nm, 'description', descr, 'unit', unit,
        'qty', qty, 'unit_price', price, 'discount_type', dtype, 'discount_value', dval, 'vat_rate', vrate));
    ELSE
      nm := inv_text(it ->> 'name', 200, 'Line name', true);
      norm := norm || jsonb_build_array(jsonb_build_object('kind', 'custom', 'source_id', NULL, 'sku', inv_text(it ->> 'sku', 80, 'SKU'), 'name', nm, 'description', descr, 'unit', unit,
        'qty', qty, 'unit_price', inv_num(it ->> 'unit_price', 'Price', 0, 99999999999), 'discount_type', dtype, 'discount_value', dval, 'vat_rate', vrate));
    END IF;
  END LOOP;
  IF jsonb_array_length(norm) > 100 THEN RAISE EXCEPTION 'invalid_input: at most 100 lines' USING ERRCODE = 'check_violation'; END IF;

  comp := invoice_compute(norm, v_disc_type, v_disc_value, v_ship, v_ship_vat);

  IF is_new THEN
    INSERT INTO invoices (client_token, status, currency, issue_date, due_date, customer_id, customer, order_id, order_ref, source_order_total,
      payment_method, payment_terms, notes, footer, overall_discount_type, overall_discount_value, shipping, shipping_vat_rate, created_by)
    VALUES (NULLIF(p_invoice ->> 'client_token', '')::uuid, 'draft', v_currency, v_issue, v_due, v_cust_id, v_cust, v_order_id,
      CASE WHEN v_order_id IS NULL THEN NULL ELSE COALESCE(v_order.order_number, '#' || v_order.id) END, CASE WHEN v_order_id IS NULL THEN NULL ELSE v_order.total END,
      pm, inv_text(p_invoice ->> 'payment_terms', 300, 'Payment terms'), inv_text(p_invoice ->> 'notes', 1000, 'Notes'), inv_text(p_invoice ->> 'footer', 400, 'Footer'),
      v_disc_type, v_disc_value, v_ship, v_ship_vat, auth.uid())
    RETURNING id INTO inv_id;
  ELSE
    UPDATE invoices SET currency = v_currency, issue_date = v_issue, due_date = v_due, customer_id = v_cust_id, customer = v_cust,
      payment_method = pm, payment_terms = inv_text(p_invoice ->> 'payment_terms', 300, 'Payment terms'), notes = inv_text(p_invoice ->> 'notes', 1000, 'Notes'),
      footer = inv_text(p_invoice ->> 'footer', 400, 'Footer'), overall_discount_type = v_disc_type, overall_discount_value = v_disc_value,
      shipping = v_ship, shipping_vat_rate = v_ship_vat, updated_at = now()
    WHERE id = inv_id;
    DELETE FROM invoice_items WHERE invoice_id = inv_id;
  END IF;

  FOR i IN 0 .. jsonb_array_length(norm) - 1 LOOP
    o := norm -> i; ln := comp -> 'lines' -> i; pos := pos + 1;
    INSERT INTO invoice_items (invoice_id, position, kind, source_id, order_line, sku, name, description, unit, qty, unit_price, discount_type, discount_value, vat_rate,
      line_gross, line_discount, line_net, overall_discount_share, line_tax, line_total)
    VALUES (inv_id, pos, o ->> 'kind', o ->> 'source_id', NULLIF(o ->> 'order_line', '')::int, o ->> 'sku', o ->> 'name', o ->> 'description', o ->> 'unit',
      (o ->> 'qty')::numeric, (o ->> 'unit_price')::numeric, o ->> 'discount_type', (o ->> 'discount_value')::numeric, (o ->> 'vat_rate')::numeric,
      (ln ->> 'line_gross')::numeric, (ln ->> 'line_discount')::numeric, (ln ->> 'line_net')::numeric, (ln ->> 'overall_discount_share')::numeric,
      (ln ->> 'line_tax')::numeric, (ln ->> 'line_total')::numeric);
  END LOOP;

  UPDATE invoices SET gross_total = (comp ->> 'gross_total')::numeric, line_discount_total = (comp ->> 'line_discount_total')::numeric,
    overall_discount_total = (comp ->> 'overall_discount_total')::numeric, taxable_total = (comp ->> 'taxable_total')::numeric,
    tax_total = (comp ->> 'tax_total')::numeric, total = (comp ->> 'total')::numeric
  WHERE id = inv_id;

  PERFORM inv_event(inv_id, CASE WHEN is_new THEN 'draft_created' ELSE 'draft_updated' END,
    jsonb_build_object('lines', jsonb_array_length(norm), 'total', (comp ->> 'total')::numeric, 'order_id', v_order_id));
  RETURN inv_id;
END $$;

CREATE OR REPLACE FUNCTION public.invoice_delete_draft(p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur invoices%ROWTYPE;
BEGIN
  PERFORM inv_require_admin();
  PERFORM set_config('app.invoice_rpc', '1', true);
  SELECT * INTO cur FROM invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: invoice' USING ERRCODE = 'no_data_found'; END IF;
  IF cur.status <> 'draft' THEN RAISE EXCEPTION 'not_draft: only a draft can be deleted (a numbered invoice is cancelled, never deleted)' USING ERRCODE = 'check_violation'; END IF;
  DELETE FROM invoices WHERE id = p_id;
  PERFORM inv_event(p_id, 'draft_deleted', jsonb_build_object('order_id', cur.order_id));
END $$;

-- 10) Issue: freeze + number, atomically -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_issue(p_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur invoices%ROWTYPE; cfg JSONB; v_seller JSONB; prefix TEXT; digits INT; yr INT; seq BIGINT; num TEXT; due DATE; stale TEXT;
BEGIN
  PERFORM inv_require_admin();
  PERFORM set_config('app.invoice_rpc', '1', true);
  SELECT * INTO cur FROM invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: invoice' USING ERRCODE = 'no_data_found'; END IF;
  -- Pressing "Issue" twice (or a retry after a lost response) returns the same invoice: it never takes a second number.
  IF cur.status = 'issued' THEN RETURN jsonb_build_object('id', cur.id, 'number', cur.number, 'already', true); END IF;
  IF cur.status = 'cancelled' THEN RAISE EXCEPTION 'not_draft: a cancelled invoice cannot be issued' USING ERRCODE = 'check_violation'; END IF;

  SELECT data INTO cfg FROM invoice_settings WHERE id = 1;
  cfg := COALESCE(cfg, '{}'::jsonb);
  IF length(btrim(COALESCE(cfg ->> 'company_name', ''))) = 0 THEN
    RAISE EXCEPTION 'company_not_configured: enter your company details in Invoice settings before issuing an invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = cur.id) THEN RAISE EXCEPTION 'invalid_input: add at least one line before issuing' USING ERRCODE = 'check_violation'; END IF;
  IF length(btrim(COALESCE(cur.customer ->> 'name', ''))) < 2 THEN RAISE EXCEPTION 'invalid_input: the customer name is missing' USING ERRCODE = 'check_violation'; END IF;

  -- Catalogue lines must still match the catalogue (a price changed since the draft was saved): save the draft again to refresh, then issue.
  SELECT string_agg(ii.name, ', ') INTO stale FROM invoice_items ii
  WHERE ii.invoice_id = cur.id AND (
        (ii.kind = 'product' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = ii.source_id AND p.price = ii.unit_price))
     OR (ii.kind = 'service' AND EXISTS (SELECT 1 FROM services s WHERE s.id = ii.source_id AND s.price > 0 AND s.price <> ii.unit_price))
     OR (ii.kind = 'service' AND NOT EXISTS (SELECT 1 FROM services s WHERE s.id = ii.source_id))
     OR (ii.kind = 'product' AND ii.source_id IS NULL));
  IF stale IS NOT NULL THEN RAISE EXCEPTION 'price_changed: the catalogue price or availability changed for: %. Open the draft, press Save to refresh the prices, then issue.', stale USING ERRCODE = 'check_violation'; END IF;

  prefix := COALESCE(cfg ->> 'prefix', 'SUB-INV');
  digits := COALESCE((cfg ->> 'number_digits')::int, 6);
  yr := extract(year FROM cur.issue_date)::int;
  -- The counter row is locked by this statement until the transaction ends: concurrent issues queue here and get consecutive numbers.
  INSERT INTO invoice_counters (scope, last_value) VALUES (prefix || '-' || yr, 1)
  ON CONFLICT (scope) DO UPDATE SET last_value = invoice_counters.last_value + 1
  RETURNING last_value INTO seq;
  num := prefix || '-' || yr || '-' || lpad(seq::text, digits, '0');

  due := COALESCE(cur.due_date, cur.issue_date + COALESCE((cfg ->> 'payment_terms_days')::int, 14));
  v_seller := jsonb_strip_nulls(jsonb_build_object(
    'company_name', cfg ->> 'company_name', 'address', cfg ->> 'address', 'city', cfg ->> 'city', 'country', cfg ->> 'country',
    'email', cfg ->> 'email', 'phone', cfg ->> 'phone', 'tax_id', cfg ->> 'tax_id', 'registration_no', cfg ->> 'registration_no',
    'bank_name', cfg ->> 'bank_name', 'iban', cfg ->> 'iban', 'swift', cfg ->> 'swift', 'language', COALESCE(cfg ->> 'language', 'sq')));

  UPDATE invoices SET status = 'issued', number = num, seller = v_seller, due_date = due,
    payment_terms = CASE WHEN payment_terms = '' THEN COALESCE(cfg ->> 'payment_terms_text', '') ELSE payment_terms END,
    footer = CASE WHEN footer = '' THEN COALESCE(cfg ->> 'footer', '') ELSE footer END,
    issued_at = now(), issued_by = auth.uid(), updated_at = now()
  WHERE id = cur.id;
  PERFORM inv_event(cur.id, 'issued', jsonb_build_object('number', num, 'total', cur.total, 'order_id', cur.order_id));
  RETURN jsonb_build_object('id', cur.id, 'number', num, 'already', false);
END $$;

-- 11) Cancel / correct ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_cancel(p_id UUID, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur invoices%ROWTYPE;
BEGIN
  PERFORM inv_require_admin();
  PERFORM set_config('app.invoice_rpc', '1', true);
  SELECT * INTO cur FROM invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: invoice' USING ERRCODE = 'no_data_found'; END IF;
  IF cur.status <> 'issued' THEN RAISE EXCEPTION 'not_issued: only an issued invoice can be cancelled' USING ERRCODE = 'check_violation'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'invalid_input: give a reason (at least 3 characters)' USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM invoice_payments WHERE invoice_id = cur.id AND NOT reversed) THEN
    RAISE EXCEPTION 'has_payments: reverse the recorded payments first' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE invoices SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = inv_text(p_reason, 300, 'Reason', true), updated_at = now() WHERE id = cur.id;
  PERFORM inv_event(cur.id, 'cancelled', jsonb_build_object('number', cur.number, 'reason', btrim(p_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.invoice_set_fiscal_ref(p_id UUID, p_ref TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur invoices%ROWTYPE;
BEGIN
  PERFORM inv_require_admin();
  PERFORM set_config('app.invoice_rpc', '1', true);
  SELECT * INTO cur FROM invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: invoice' USING ERRCODE = 'no_data_found'; END IF;
  IF cur.status <> 'issued' THEN RAISE EXCEPTION 'not_issued: only an issued invoice can carry a reference' USING ERRCODE = 'check_violation'; END IF;
  UPDATE invoices SET fiscal_ref = inv_text(p_ref, 120, 'Reference'), updated_at = now() WHERE id = cur.id;
  PERFORM inv_event(cur.id, 'reference_noted', jsonb_build_object('number', cur.number));
END $$;

-- 12) Payments ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_record_payment(p_invoice UUID, p_paid_on DATE, p_amount NUMERIC, p_method TEXT, p_reference TEXT, p_note TEXT, p_token UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur invoices%ROWTYPE; paid NUMERIC; pid UUID; d DATE := COALESCE(p_paid_on, inv_today());
BEGIN
  PERFORM inv_require_admin();
  PERFORM set_config('app.invoice_rpc', '1', true);
  SELECT * INTO cur FROM invoices WHERE id = p_invoice FOR UPDATE;      -- serialises concurrent payments on one invoice
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: invoice' USING ERRCODE = 'no_data_found'; END IF;
  IF p_token IS NOT NULL THEN
    SELECT id INTO pid FROM invoice_payments WHERE client_token = p_token;
    IF pid IS NOT NULL THEN RETURN pid; END IF;                         -- the same submission arriving twice
  END IF;
  IF cur.status <> 'issued' THEN RAISE EXCEPTION 'not_issued: payments can only be recorded on an issued invoice' USING ERRCODE = 'check_violation'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN RAISE EXCEPTION 'invalid_input: the amount must be positive with at most 2 decimals' USING ERRCODE = 'check_violation'; END IF;
  IF p_method NOT IN ('cash', 'bank_transfer', 'card', 'other') THEN RAISE EXCEPTION 'invalid_input: choose a payment method' USING ERRCODE = 'check_violation'; END IF;
  IF d > inv_today() THEN RAISE EXCEPTION 'invalid_input: the payment date cannot be in the future' USING ERRCODE = 'check_violation'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO paid FROM invoice_payments WHERE invoice_id = cur.id AND NOT reversed;
  IF p_amount > cur.total - paid THEN RAISE EXCEPTION 'overpayment: only % is still outstanding on this invoice', cur.total - paid USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO invoice_payments (client_token, invoice_id, paid_on, amount, method, reference, note, recorded_by)
  VALUES (p_token, cur.id, d, p_amount, p_method, inv_text(p_reference, 120, 'Reference'), inv_text(p_note, 300, 'Note'), auth.uid())
  RETURNING id INTO pid;
  PERFORM inv_event(cur.id, 'payment_recorded', jsonb_build_object('payment_id', pid, 'amount', p_amount, 'method', p_method, 'number', cur.number));
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION public.invoice_reverse_payment(p_payment UUID, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pay invoice_payments%ROWTYPE; inv invoices%ROWTYPE;
BEGIN
  PERFORM inv_require_admin();
  PERFORM set_config('app.invoice_rpc', '1', true);
  SELECT * INTO pay FROM invoice_payments WHERE id = p_payment;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: payment' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO inv FROM invoices WHERE id = pay.invoice_id FOR UPDATE;
  SELECT * INTO pay FROM invoice_payments WHERE id = p_payment FOR UPDATE;
  IF pay.reversed THEN RAISE EXCEPTION 'invalid_input: this payment is already reversed' USING ERRCODE = 'check_violation'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'invalid_input: give a reason (at least 3 characters)' USING ERRCODE = 'check_violation'; END IF;
  UPDATE invoice_payments SET reversed = true, reversed_at = now(), reversed_by = auth.uid(), reverse_reason = inv_text(p_reason, 300, 'Reason', true) WHERE id = p_payment;
  PERFORM inv_event(inv.id, 'payment_reversed', jsonb_build_object('payment_id', p_payment, 'amount', pay.amount, 'reason', btrim(p_reason), 'number', inv.number));
END $$;

-- 13) Function privileges: signed-in team members only; the role check inside decides ------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'inv_require_admin()', 'inv_event(uuid,text,jsonb)', 'inv_via_rpc()', 'invoices_guard()', 'invoice_items_guard()', 'invoice_payments_guard()', 'invoice_events_guard()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'invoice_settings_save(jsonb)', 'customer_save(jsonb)', 'customer_set_archived(uuid,boolean)', 'invoice_save_draft(jsonb,jsonb)', 'invoice_delete_draft(uuid)',
    'invoice_issue(uuid)', 'invoice_cancel(uuid,text)', 'invoice_set_fiscal_ref(uuid,text)', 'invoice_record_payment(uuid,date,numeric,text,text,text,uuid)',
    'invoice_reverse_payment(uuid,text)', 'invoice_compute(jsonb,text,numeric,numeric,numeric)', 'inv_today()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Verify (after running):
--   SELECT count(*) FROM invoices;                    -- 0: nothing is invented
--   SELECT data FROM invoice_settings;                -- defaults only; company details are yours to enter in Admin -> Invoices -> Settings
--   SELECT to_regclass('public.invoice_overview');    -- the view exists
