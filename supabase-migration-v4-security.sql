-- ============================================================================
-- SubCore Solutions — SECURITY & ROLES MIGRATION (v4)
-- Run AFTER supabase-migration-v3-store.sql. Safe to re-run.
--
-- BEFORE YOU RUN IT: take a backup (Supabase Dashboard → Database → Backups, or
-- `pg_dump`), and keep supabase-migration-v4-ROLLBACK.sql to hand.
-- This migration changes policies and adds objects only. It does not drop tables,
-- delete rows or touch product / order / customer data.
--
-- What it does
--   1. Roles on admin_users: admin (everything), editor (catalogue: products,
--      categories, services, images), staff (orders and enquiries).
--   2. Replaces the blanket "any admin can do everything" policies with
--      role-based policies (enforced by the database, not by the admin screen).
--   3. audit_log: an append-only record of every change made through the admin
--      (who, when, what), written by triggers; only admins can read it.
--   4. Guard so the last remaining admin cannot be demoted or removed.
--   5. admin_add_member(): lets an admin attach an existing Auth user to a role.
-- ============================================================================

-- 1) Roles --------------------------------------------------------------------
-- Any role value outside the three known ones becomes the least-privileged one.
UPDATE admin_users SET role = 'staff' WHERE role NOT IN ('admin', 'editor', 'staff');
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN ('admin', 'editor', 'staff'));

CREATE OR REPLACE FUNCTION public.admin_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT role FROM admin_users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_admin_role(roles TEXT[])
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(public.admin_role() = ANY (roles), false);
$$;

-- is_admin() keeps its meaning ("signed-in member of the team") for older code.
-- These two only report the caller's own role (empty/false for visitors), so they stay
-- executable by everyone: policies that call them must not error for anonymous visitors.
GRANT EXECUTE ON FUNCTION public.admin_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_admin_role(TEXT[]) TO anon, authenticated;

-- 2) Role-based policies --------------------------------------------------------
-- Remove every previous "Admin ..." policy on these tables (public read and the
-- public insert policies are left alone), then create the role-based set.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE (schemaname = 'public' AND tablename IN ('categories','products','services','website_settings','orders','inquiries','admin_users')
           AND (policyname ILIKE 'admin%' OR policyname ILIKE 'catalogue%' OR policyname ILIKE 'desk%'))
       OR (schemaname = 'storage' AND tablename = 'objects' AND policyname ILIKE 'admin%product images')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Catalogue: admin + editor
CREATE POLICY "Catalogue insert categories" ON categories FOR INSERT WITH CHECK (has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Catalogue update categories" ON categories FOR UPDATE USING (has_admin_role(ARRAY['admin','editor'])) WITH CHECK (has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Catalogue delete categories" ON categories FOR DELETE USING (has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Catalogue insert products"   ON products   FOR INSERT WITH CHECK (has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Catalogue update products"   ON products   FOR UPDATE USING (has_admin_role(ARRAY['admin','editor'])) WITH CHECK (has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Catalogue delete products"   ON products   FOR DELETE USING (has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Catalogue insert services"   ON services   FOR INSERT WITH CHECK (has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Catalogue update services"   ON services   FOR UPDATE USING (has_admin_role(ARRAY['admin','editor'])) WITH CHECK (has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Catalogue delete services"   ON services   FOR DELETE USING (has_admin_role(ARRAY['admin','editor']));

-- Site settings (delivery fees etc.): admin only
CREATE POLICY "Admin insert settings" ON website_settings FOR INSERT WITH CHECK (has_admin_role(ARRAY['admin']));
CREATE POLICY "Admin update settings" ON website_settings FOR UPDATE USING (has_admin_role(ARRAY['admin'])) WITH CHECK (has_admin_role(ARRAY['admin']));
CREATE POLICY "Admin delete settings" ON website_settings FOR DELETE USING (has_admin_role(ARRAY['admin']));

-- Orders and enquiries: admin + staff read/update, only admin deletes
CREATE POLICY "Desk read orders"       ON orders    FOR SELECT USING (has_admin_role(ARRAY['admin','staff']));
CREATE POLICY "Desk update orders"     ON orders    FOR UPDATE USING (has_admin_role(ARRAY['admin','staff'])) WITH CHECK (has_admin_role(ARRAY['admin','staff']));
CREATE POLICY "Admin delete orders"    ON orders    FOR DELETE USING (has_admin_role(ARRAY['admin']));
CREATE POLICY "Desk read inquiries"    ON inquiries FOR SELECT USING (has_admin_role(ARRAY['admin','staff']));
CREATE POLICY "Desk update inquiries"  ON inquiries FOR UPDATE USING (has_admin_role(ARRAY['admin','staff'])) WITH CHECK (has_admin_role(ARRAY['admin','staff']));
CREATE POLICY "Admin delete inquiries" ON inquiries FOR DELETE USING (has_admin_role(ARRAY['admin']));

-- Team: everyone reads their own row, admins read and manage all rows
CREATE POLICY "Admin read team"   ON admin_users FOR SELECT USING (auth_user_id = auth.uid() OR has_admin_role(ARRAY['admin']));
CREATE POLICY "Admin update team" ON admin_users FOR UPDATE USING (has_admin_role(ARRAY['admin'])) WITH CHECK (has_admin_role(ARRAY['admin']));
CREATE POLICY "Admin delete team" ON admin_users FOR DELETE USING (has_admin_role(ARRAY['admin']));

-- Product images (storage): admin + editor may write; everyone may read
CREATE POLICY "Admin upload product images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images' AND public.has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Admin update product images" ON storage.objects FOR UPDATE USING (bucket_id = 'product-images' AND public.has_admin_role(ARRAY['admin','editor']));
CREATE POLICY "Admin delete product images" ON storage.objects FOR DELETE USING (bucket_id = 'product-images' AND public.has_admin_role(ARRAY['admin','editor']));

-- 3) Audit log -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID,
  actor_email TEXT,
  action      TEXT NOT NULL,           -- INSERT / UPDATE / DELETE
  table_name  TEXT NOT NULL,
  row_id      TEXT,
  old_data    JSONB,
  new_data    JSONB
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin read audit log" ON audit_log;
CREATE POLICY "Admin read audit log" ON audit_log FOR SELECT USING (has_admin_role(ARRAY['admin']));
-- No insert/update/delete policy exists, so nobody can edit the log from the browser.
REVOKE ALL ON audit_log FROM anon, authenticated;
GRANT SELECT ON audit_log TO authenticated;

-- Customer data is kept out of the log: orders and enquiries record only the fields below.
CREATE OR REPLACE FUNCTION public.audit_pick(tbl TEXT, j JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN j IS NULL THEN NULL
    WHEN tbl = 'orders'      THEN jsonb_build_object('id', j->'id', 'order_number', j->'order_number', 'status', j->'status', 'total', j->'total')
    WHEN tbl = 'inquiries'   THEN jsonb_build_object('id', j->'id', 'type', j->'type', 'status', j->'status')
    WHEN tbl = 'admin_users' THEN jsonb_build_object('id', j->'id', 'email', j->'email', 'role', j->'role')
    ELSE j
  END;
$$;

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  mail TEXT;
  o JSONB; n JSONB; rid TEXT;
BEGIN
  -- Public submissions (customer orders, contact forms) arrive without a user: not logged.
  IF uid IS NULL AND TG_TABLE_NAME IN ('orders', 'inquiries') AND TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  SELECT email INTO mail FROM admin_users WHERE auth_user_id = uid;
  IF TG_OP <> 'INSERT' THEN o := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN n := to_jsonb(NEW); END IF;
  rid := COALESCE(n->>'id', n->>'key', o->>'id', o->>'key');
  -- Skip no-op updates
  IF TG_OP = 'UPDATE' AND o = n THEN RETURN NEW; END IF;
  INSERT INTO audit_log (actor_id, actor_email, action, table_name, row_id, old_data, new_data)
  VALUES (uid, mail, TG_OP, TG_TABLE_NAME, rid, audit_pick(TG_TABLE_NAME, o), audit_pick(TG_TABLE_NAME, n));
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.audit_trigger() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','categories','services','website_settings','orders','inquiries','admin_users'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON %1$I', t);
    EXECUTE format('CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()', t);
  END LOOP;
END $$;

-- 4) Never lock yourself out: the last admin cannot be demoted or removed ---------------
CREATE OR REPLACE FUNCTION public.guard_last_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'admin' AND (TG_OP = 'DELETE' OR NEW.role <> 'admin') THEN
    IF NOT EXISTS (SELECT 1 FROM admin_users WHERE role = 'admin' AND id <> OLD.id) THEN
      RAISE EXCEPTION 'There must always be at least one admin.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS guard_last_admin_trg ON admin_users;
CREATE TRIGGER guard_last_admin_trg BEFORE UPDATE OF role OR DELETE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_admin();

-- 5) Add a team member ---------------------------------------------------------------
-- Step 1 (Supabase → Authentication → Users → Add user) creates the login.
-- Step 2 (the Team screen, or this function) gives that login a role.
CREATE OR REPLACE FUNCTION public.admin_add_member(p_email TEXT, p_role TEXT, p_name TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE uid UUID;
BEGIN
  IF public.admin_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only an admin can add team members.' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('admin', 'editor', 'staff') THEN RAISE EXCEPTION 'Unknown role.' USING ERRCODE = '22023'; END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'No login exists for that email yet. Create the user in Supabase Authentication first.' USING ERRCODE = 'no_data_found'; END IF;
  INSERT INTO admin_users (auth_user_id, email, full_name, role)
  VALUES (uid, lower(trim(p_email)), NULLIF(trim(COALESCE(p_name, '')), ''), p_role)
  ON CONFLICT (email) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, role = EXCLUDED.role,
    full_name = COALESCE(EXCLUDED.full_name, admin_users.full_name);
END $$;
REVOKE ALL ON FUNCTION public.admin_add_member(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_member(TEXT, TEXT, TEXT) TO authenticated;

-- Verify (run these after; each should return what the comment says) -----------------
--   SELECT email, role FROM admin_users;                        -- you, as 'admin'
--   SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' ORDER BY 2, 1;
--   SELECT count(*) FROM audit_log;                              -- grows as you edit in the admin
