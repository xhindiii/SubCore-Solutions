-- ============================================================================
-- Rollback for supabase-migration-v4-security.sql
-- Restores the v3 behaviour: every admin_users member may do everything.
-- It keeps audit_log and its data (drop it manually only if you are sure:
--   DROP TABLE audit_log;   -- destructive, needs your explicit decision).
-- ============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE (schemaname = 'public' AND tablename IN ('categories','products','services','website_settings','orders','inquiries','admin_users')
           AND (policyname ILIKE 'admin%' OR policyname ILIKE 'catalogue%' OR policyname ILIKE 'desk%'))
       OR (schemaname = 'storage' AND tablename = 'objects' AND policyname ILIKE 'admin%product images')
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename); END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','products','services','website_settings'] LOOP
    EXECUTE format('CREATE POLICY "Admin insert %1$s" ON %1$I FOR INSERT WITH CHECK (is_admin())', t);
    EXECUTE format('CREATE POLICY "Admin update %1$s" ON %1$I FOR UPDATE USING (is_admin()) WITH CHECK (is_admin())', t);
    EXECUTE format('CREATE POLICY "Admin delete %1$s" ON %1$I FOR DELETE USING (is_admin())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['orders','inquiries'] LOOP
    EXECUTE format('CREATE POLICY "Admin read %1$s" ON %1$I FOR SELECT USING (is_admin())', t);
    EXECUTE format('CREATE POLICY "Admin update %1$s" ON %1$I FOR UPDATE USING (is_admin()) WITH CHECK (is_admin())', t);
    EXECUTE format('CREATE POLICY "Admin delete %1$s" ON %1$I FOR DELETE USING (is_admin())', t);
  END LOOP;
END $$;
CREATE POLICY "Admin read own row" ON admin_users FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY "Admin upload product images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images' AND public.is_admin());
CREATE POLICY "Admin update product images" ON storage.objects FOR UPDATE USING (bucket_id = 'product-images' AND public.is_admin());
CREATE POLICY "Admin delete product images" ON storage.objects FOR DELETE USING (bucket_id = 'product-images' AND public.is_admin());

DROP TRIGGER IF EXISTS guard_last_admin_trg ON admin_users;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','categories','services','website_settings','orders','inquiries','admin_users'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON %1$I', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.admin_add_member(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.guard_last_admin();
DROP FUNCTION IF EXISTS public.audit_trigger();
DROP FUNCTION IF EXISTS public.audit_pick(TEXT, JSONB);
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
-- has_admin_role()/admin_role() are harmless and left in place.
