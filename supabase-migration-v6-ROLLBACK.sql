-- ============================================================================
-- SubCore Solutions — ROLLBACK for supabase-migration-v6-portfolio.sql
-- WARNING: this deletes every project and project/service link, and the two optional
-- services columns (cover_image, price_label). Export or back up first. Uploaded image files
-- in the `portfolio-images` bucket are NOT deleted by SQL: remove that bucket in
-- Supabase -> Storage if you want them gone. Existing services, products and orders are untouched.
-- ============================================================================
DROP TRIGGER  IF EXISTS audit_projects ON public.projects;
DROP POLICY   IF EXISTS "Public read portfolio images"  ON storage.objects;
DROP POLICY   IF EXISTS "Staff upload portfolio images" ON storage.objects;
DROP POLICY   IF EXISTS "Staff update portfolio images" ON storage.objects;
DROP POLICY   IF EXISTS "Staff delete portfolio images" ON storage.objects;
DROP FUNCTION IF EXISTS public.reorder_projects(TEXT[]);
DROP FUNCTION IF EXISTS public.reorder_services(TEXT[]);
DROP TABLE    IF EXISTS public.project_services;
DROP TABLE    IF EXISTS public.projects;
DROP FUNCTION IF EXISTS public.projects_touch();
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_cover_https;
ALTER TABLE public.services DROP COLUMN IF EXISTS cover_image;
ALTER TABLE public.services DROP COLUMN IF EXISTS price_label;
