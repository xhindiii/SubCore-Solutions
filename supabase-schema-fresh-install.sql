-- ============================================================================
-- SubCore Solutions — FRESH INSTALL SCHEMA (secure from the start)
-- Run this ONCE in the SQL Editor of a brand-new Supabase project.
-- Do NOT run supabase-schema.sql (the old one) or
-- supabase-schema-v2-SECURITY-FIX.sql — this file replaces both for a
-- new project. Those two are only relevant if you already had data in an
-- older, insecure project you're migrating from.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Categories --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Products ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name JSONB NOT NULL,
  description JSONB NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT REFERENCES categories(id),
  image TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  available BOOLEAN NOT NULL DEFAULT true,
  featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Orders ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  delivery_address TEXT,
  notes TEXT,
  items JSONB NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Services ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name JSONB NOT NULL,
  description JSONB NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  icon TEXT,
  featured BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER DEFAULT 0,
  available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Website Settings ------------------------------------------------------
CREATE TABLE IF NOT EXISTS website_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Admin Users ---------------------------------------------------------------
-- NOTE: no password_hash column here. Passwords are no longer managed by
-- this table at all — Supabase Auth (auth.users) owns authentication.
-- This table only links an authenticated Supabase Auth user to an admin
-- profile (name, role).
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

-- Enable RLS everywhere -------------------------------------------------
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_settings ENABLE ROW LEVEL SECURITY;

-- is_admin(): true only for an authenticated Supabase Auth user linked in
-- admin_users. This is the single real gate everything else checks.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE auth_user_id = auth.uid()
  );
$$;

-- Public read access (storefront) ----------------------------------------
CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Public read products" ON products FOR SELECT USING (true);
CREATE POLICY "Public read services" ON services FOR SELECT USING (true);
CREATE POLICY "Public read website settings" ON website_settings FOR SELECT USING (true);

-- Public can place an order (checkout), but not read/edit orders --------
CREATE POLICY "Public insert orders" ON orders FOR INSERT WITH CHECK (true);

-- Admin-only writes -------------------------------------------------------
CREATE POLICY "Admin write categories" ON categories FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admin update categories" ON categories FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin delete categories" ON categories FOR DELETE USING (is_admin());

CREATE POLICY "Admin write products" ON products FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admin update products" ON products FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin delete products" ON products FOR DELETE USING (is_admin());

CREATE POLICY "Admin write services" ON services FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admin update services" ON services FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin delete services" ON services FOR DELETE USING (is_admin());

CREATE POLICY "Admin write settings" ON website_settings FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admin update settings" ON website_settings FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin delete settings" ON website_settings FOR DELETE USING (is_admin());

CREATE POLICY "Admin read orders" ON orders FOR SELECT USING (is_admin());
CREATE POLICY "Admin update orders" ON orders FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin delete orders" ON orders FOR DELETE USING (is_admin());

CREATE POLICY "Admin read own row" ON admin_users FOR SELECT USING (auth_user_id = auth.uid());

-- Seed the admin profile row (unlinked for now — you'll link it to a real
-- Supabase Auth user in Step 4 of the setup, below).
INSERT INTO admin_users (email, full_name, role)
VALUES ('info.subcoresolutions@gmail.com', 'Admin User', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Seed starting website content ------------------------------------------
INSERT INTO website_settings (key, value) VALUES
  ('company_info', '{"name": "SubCore Solutions", "tagline": "Professional IT infrastructure, networking, and support for businesses across Albania.", "email": "info@subcoresolutions.online", "phone": "+355 68 666 1686", "whatsapp": "355686661686"}'),
  ('homepage_hero', '{"title_en": "Advanced IT Infrastructure & Innovation", "title_sq": "Infrastrukturë IT e Avancuar & Inovacion", "subtitle_en": "Professional IT solutions for businesses and individuals.", "subtitle_sq": "Zgjidhje profesionale IT për biznese dhe individë."}'),
  ('contact_info', '{"email": "info@subcoresolutions.online", "secondary_email": "info.subcoresolutions@gmail.com", "phone": "+355 68 666 1686", "address": "Albania"}')
ON CONFLICT (key) DO NOTHING;
