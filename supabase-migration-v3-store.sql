-- ============================================================================
-- SubCore Solutions — STORE & INQUIRIES MIGRATION (v3)
-- Run once in the Supabase SQL Editor, AFTER the schema you already use
-- (supabase-schema-fresh-install.sql, or the original + v2 security fix).
-- Safe to re-run.
--
-- What it adds:
--   1. Richer products: brand, SKU, compare-at price, several images, specs.
--   2. Order numbers (SC-000123) and server-side order validation:
--      place_order() checks stock, takes prices from the database (never
--      from the browser), adds shipping, reduces stock and returns the number.
--      Cancelling an order puts the stock back.
--   3. An `inquiries` table for the contact form and "Request this service".
--   4. A public storage bucket `product-images` that only the admin can write.
-- ============================================================================

-- 1) Products ----------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku           TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_price NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS images        JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS specs         JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_nonneg;
ALTER TABLE products ADD CONSTRAINT products_price_nonneg CHECK (price >= 0 AND stock >= 0);

-- 2) Orders ------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number TEXT UNIQUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping     NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ALTER COLUMN customer_email DROP NOT NULL;

-- The browser no longer inserts orders directly once place_order() exists.
DROP POLICY IF EXISTS "Public insert orders" ON orders;

CREATE OR REPLACE FUNCTION place_order(
  p_name    TEXT,
  p_email   TEXT,
  p_phone   TEXT,
  p_address TEXT,
  p_notes   TEXT,
  p_items   JSONB
)
RETURNS TABLE (order_number TEXT, total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it         JSONB;
  prod       products%ROWTYPE;
  qty        INTEGER;
  subtotal   NUMERIC(10,2) := 0;
  ship       NUMERIC(10,2) := 0;
  snapshot   JSONB := '[]'::jsonb;
  cfg        JSONB;
  fee        NUMERIC := 0;
  free_over  NUMERIC := 0;
  new_id     BIGINT;
  num        TEXT;
BEGIN
  IF coalesce(length(trim(p_name)), 0) < 2 OR length(p_name) > 120 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF coalesce(length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')), 0) < 8 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF coalesce(length(trim(p_address)), 0) < 5 OR length(p_address) > 400 THEN
    RAISE EXCEPTION 'invalid_address';
  END IF;
  IF length(coalesce(p_notes, '')) > 1000 OR length(coalesce(p_email, '')) > 160 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    qty := (it->>'qty')::INTEGER;
    IF qty IS NULL OR qty < 1 OR qty > 99 THEN RAISE EXCEPTION 'invalid_items'; END IF;

    SELECT * INTO prod FROM products WHERE id = it->>'id' FOR UPDATE;
    IF NOT FOUND OR NOT prod.available THEN RAISE EXCEPTION 'out_of_stock: unavailable %', it->>'id'; END IF;
    IF prod.stock < qty THEN RAISE EXCEPTION 'out_of_stock: %', it->>'id'; END IF;

    UPDATE products SET stock = stock - qty WHERE id = prod.id;
    subtotal := subtotal + prod.price * qty;
    snapshot := snapshot || jsonb_build_array(jsonb_build_object(
      'id', prod.id, 'name', prod.name, 'sku', prod.sku, 'qty', qty, 'price', prod.price, 'currency', prod.currency));
  END LOOP;

  SELECT value INTO cfg FROM website_settings WHERE key = 'shop_settings';
  IF cfg IS NOT NULL THEN
    fee       := coalesce((cfg->>'shipping_fee')::NUMERIC, 0);
    free_over := coalesce((cfg->>'free_shipping_over')::NUMERIC, 0);
  END IF;
  ship := CASE WHEN free_over > 0 AND subtotal >= free_over THEN 0 ELSE fee END;

  INSERT INTO orders (customer_name, customer_email, customer_phone, delivery_address, notes, items, total, shipping, status)
  VALUES (trim(p_name), coalesce(trim(p_email), ''), trim(p_phone), trim(p_address), coalesce(trim(p_notes), ''),
          snapshot, subtotal + ship, ship, 'pending')
  RETURNING id INTO new_id;

  num := 'SC-' || lpad(new_id::TEXT, 6, '0');
  UPDATE orders SET order_number = num WHERE id = new_id;

  RETURN QUERY SELECT num, subtotal + ship;
END;
$$;

REVOKE ALL ON FUNCTION place_order(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION place_order(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- Put stock back when an order is cancelled (and take it again if re-opened).
CREATE OR REPLACE FUNCTION orders_restock() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it JSONB; dir INTEGER := 0;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN dir := 1;
  ELSIF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN dir := -1;
  END IF;
  IF dir <> 0 THEN
    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      UPDATE products SET stock = greatest(0, stock + dir * (it->>'qty')::INTEGER) WHERE id = it->>'id';
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_restock_trg ON orders;
CREATE TRIGGER orders_restock_trg AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_restock();

-- 3) Inquiries (contact form + service requests) -----------------------------
CREATE TABLE IF NOT EXISTS inquiries (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL DEFAULT 'contact',
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  service    TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  lang       TEXT NOT NULL DEFAULT 'sq',
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Request types: contact form, service request, and the Request IT support / quote page.
ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS inquiries_type_check;
ALTER TABLE inquiries ADD CONSTRAINT inquiries_type_check
  CHECK (type IN ('contact', 'service', 'support', 'quote', 'consult', 'visit', 'product'));
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert inquiries" ON inquiries;
CREATE POLICY "Public insert inquiries" ON inquiries FOR INSERT
  WITH CHECK (
    status = 'new'
    AND length(trim(name)) BETWEEN 2 AND 120
    AND length(email) <= 160 AND length(phone) <= 40
    AND length(service) <= 80 AND length(message) <= 4000
  );
DROP POLICY IF EXISTS "Admin read inquiries"   ON inquiries;
DROP POLICY IF EXISTS "Admin update inquiries" ON inquiries;
DROP POLICY IF EXISTS "Admin delete inquiries" ON inquiries;
CREATE POLICY "Admin read inquiries"   ON inquiries FOR SELECT USING (is_admin());
CREATE POLICY "Admin update inquiries" ON inquiries FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin delete inquiries" ON inquiries FOR DELETE USING (is_admin());

-- 4) Product image storage -----------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

DROP POLICY IF EXISTS "Public read product images"   ON storage.objects;
DROP POLICY IF EXISTS "Admin upload product images"  ON storage.objects;
DROP POLICY IF EXISTS "Admin update product images"  ON storage.objects;
DROP POLICY IF EXISTS "Admin delete product images"  ON storage.objects;
CREATE POLICY "Public read product images"  ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
CREATE POLICY "Admin upload product images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images' AND public.is_admin());
CREATE POLICY "Admin update product images" ON storage.objects FOR UPDATE USING (bucket_id = 'product-images' AND public.is_admin());
CREATE POLICY "Admin delete product images" ON storage.objects FOR DELETE USING (bucket_id = 'product-images' AND public.is_admin());

-- 5) Default shop settings (only if you have not set them yet) ----------------
INSERT INTO website_settings (key, value)
VALUES ('shop_settings', '{"shipping_fee": 0, "free_shipping_over": 0}'::jsonb)
ON CONFLICT (key) DO NOTHING;
