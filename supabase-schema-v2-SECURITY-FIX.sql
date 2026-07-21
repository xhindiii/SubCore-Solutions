-- ============================================================================
-- SubCore Solutions — SECURITY FIX MIGRATION
-- Run this in the Supabase SQL Editor AFTER the original supabase-schema.sql
-- has already been applied once. This migration is safe to re-run.
--
-- WHAT THIS FIXES:
-- The original schema created RLS policies like:
--     CREATE POLICY "Admin upsert products" ON products FOR ALL USING (true);
-- "USING (true)" means ANY visitor using the public anon key (the same key
-- that is embedded in supabase-client.js and visible to everyone) could
-- insert/update/delete products, services, orders, and site settings —
-- with no login required. The admin login screen in admin.html never
-- actually gated any of this; it only checked a password and set a value
-- in sessionStorage, which has zero bearing on what Supabase itself allows.
--
-- This migration:
--   1. Links your admin account to real Supabase Auth (so "admin" means an
--      authenticated Supabase session, not a client-side flag).
--   2. Replaces every "USING (true)" admin policy with a check against
--      is_admin(), which only returns true for an authenticated, linked
--      admin user.
--   3. Locks the `orders` table down so customer PII (name/email/phone/
--      address) can only be read by an admin, not the public.
-- ============================================================================

-- 1) Link admin_users to Supabase Auth ---------------------------------------
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2) is_admin() helper --------------------------------------------------------
-- Returns true only if the currently authenticated Supabase Auth user
-- (auth.uid()) is linked to a row in admin_users. SECURITY DEFINER so it can
-- read admin_users even though admin_users itself has no public SELECT policy.
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

-- 3) Drop the old wide-open policies -----------------------------------------
DROP POLICY IF EXISTS "Admin upsert categories" ON categories;
DROP POLICY IF EXISTS "Admin upsert products" ON products;
DROP POLICY IF EXISTS "Admin manage orders" ON orders;
DROP POLICY IF EXISTS "Admin manage services" ON services;
DROP POLICY IF EXISTS "Admin manage settings" ON website_settings;

-- 4) Replace with policies that require a real authenticated admin ----------
-- Categories / Products / Services / Settings: public can still read (this
-- is a public storefront), but only an authenticated admin can write.
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

-- Orders: the public may still INSERT (checkout must keep working for
-- anonymous customers), but only an admin may read, update, or delete —
-- this is what stops random visitors from browsing every customer's name,
-- email, phone number, and delivery address.
CREATE POLICY "Admin read orders" ON orders FOR SELECT USING (is_admin());
CREATE POLICY "Admin update orders" ON orders FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin delete orders" ON orders FOR DELETE USING (is_admin());
-- ("Public insert orders" from the original schema is left in place.)

-- admin_users: no public policies at all. Only the admin's own row is
-- readable, and only by that authenticated admin (used to show their name
-- in the dashboard). All writes to this table should be done from the
-- Supabase dashboard or a service-role context, never from the browser.
CREATE POLICY "Admin read own row" ON admin_users FOR SELECT USING (auth_user_id = auth.uid());

-- 5) Remove the legacy password-based RPC ------------------------------------
-- Real authentication now goes through supabase.auth.signInWithPassword()
-- (Supabase Auth), not a hand-rolled RPC. Drop the old function so it can't
-- be called anymore, and so nobody can brute-force it via the REST API.
DROP FUNCTION IF EXISTS verify_admin_password(TEXT, TEXT);

-- ============================================================================
-- MANUAL STEPS YOU STILL NEED TO DO IN THE SUPABASE DASHBOARD:
--
-- 1. Go to Authentication → Users → "Add user" and create a user with your
--    real admin email and a strong new password (NOT "Localadmin!" — that
--    password is public in your GitHub history and must be treated as
--    burned regardless of anything else you do).
--
-- 2. Copy that new user's UUID, then run:
--      UPDATE admin_users
--      SET auth_user_id = '<paste-the-new-auth-user-uuid-here>'
--      WHERE email = 'info.subcoresolutions@gmail.com';
--
-- 3. (Recommended, not strictly required) Rotate your anon/publishable key
--    in Settings → API, since the old one has been sitting in a repo with
--    wide-open write access. Anon keys are meant to be public, but since
--    this one already had elevated abilities, treat it as a clean break.
--
-- 4. Deploy the updated supabase-client.js / admin.js from this audit —
--    they now call supabase.auth.signInWithPassword() instead of the old
--    RPC, and stop relying on sessionStorage as if it were a security
--    boundary.
-- ============================================================================
