-- ============================================================================
-- SubCore Solutions — PORTFOLIO (company projects) + SERVICES EXTRAS (v6)
-- Run AFTER supabase-migration-v4-security.sql. Safe to re-run.
--
-- BEFORE YOU RUN IT: run it on a STAGING project first, take a backup, and keep
-- supabase-migration-v6-ROLLBACK.sql to hand. It is additive: it adds two tables, two small
-- columns on `services`, one storage bucket and two helper functions. It does not change or
-- remove any existing column, row, policy, or the shop/order logic. It inserts NO projects:
-- the portfolio starts empty, and you add real projects from Admin -> Portfolio.
--
-- What it adds
--   projects          the portfolio. Only status = 'published' is readable by the public.
--   project_services  links a project to the services it delivered (also gives each service
--                     its "related projects").
--   services.cover_image / services.price_label   optional image and free-text price label.
--   storage bucket `portfolio-images`   public read; only admin/editor can write; images only
--                     (JPEG, PNG, WebP), 5 MB maximum per file — enforced by the server.
--   reorder_projects() / reorder_services()   save a drag-free "move up/down" order atomically.
-- ============================================================================

-- 1) Projects ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id               TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,78}$'),
  title            JSONB       NOT NULL,                       -- {"sq": "...", "en": "..."}
  category         JSONB       NOT NULL DEFAULT '{"sq":"Tjetër","en":"Other"}',
  summary          JSONB       NOT NULL DEFAULT '{"sq":"","en":""}',   -- short description
  description      JSONB       NOT NULL DEFAULT '{"sq":"","en":""}',   -- detailed description
  cover_image      TEXT        CHECK (cover_image IS NULL OR (cover_image ~ '^https://[^[:space:]]+$' AND length(cover_image) <= 500)),
  images           JSONB       NOT NULL DEFAULT '[]'
                   CHECK (jsonb_typeof(images) = 'array' AND jsonb_array_length(images) <= 12),
  technologies     TEXT[]      NOT NULL DEFAULT '{}' CHECK (cardinality(technologies) <= 30),
  completed_on     DATE,
  project_status   TEXT        NOT NULL DEFAULT 'completed' CHECK (project_status IN ('completed', 'ongoing', 'maintained')),
  url              TEXT        CHECK (url IS NULL OR (url ~* '^https?://[^[:space:]]+$' AND length(url) <= 300)),
  featured         BOOLEAN     NOT NULL DEFAULT false,
  display_order    INTEGER     NOT NULL DEFAULT 0,
  status           TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A project cannot go public without a title and a short description.
  CONSTRAINT projects_publishable CHECK (
    status <> 'published'
    OR (COALESCE(NULLIF(title ->> 'en', ''), NULLIF(title ->> 'sq', '')) IS NOT NULL
        AND COALESCE(NULLIF(summary ->> 'en', ''), NULLIF(summary ->> 'sq', '')) IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS projects_public_idx ON public.projects (status, display_order);

CREATE OR REPLACE FUNCTION public.projects_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS projects_touch_trg ON public.projects;
CREATE TRIGGER projects_touch_trg BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_touch();

-- 2) Links between projects and services -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_services (
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, service_id)
);
CREATE INDEX IF NOT EXISTS project_services_service_idx ON public.project_services (service_id);

-- 3) Row Level Security -----------------------------------------------------------------
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published projects" ON public.projects;
DROP POLICY IF EXISTS "Staff read all projects"        ON public.projects;
DROP POLICY IF EXISTS "Staff insert projects"          ON public.projects;
DROP POLICY IF EXISTS "Staff update projects"          ON public.projects;
DROP POLICY IF EXISTS "Admin delete projects"          ON public.projects;
CREATE POLICY "Public read published projects" ON public.projects FOR SELECT USING (status = 'published');
CREATE POLICY "Staff read all projects"  ON public.projects FOR SELECT USING (public.has_admin_role(ARRAY['admin', 'editor']));
CREATE POLICY "Staff insert projects"    ON public.projects FOR INSERT WITH CHECK (public.has_admin_role(ARRAY['admin', 'editor']));
CREATE POLICY "Staff update projects"    ON public.projects FOR UPDATE USING (public.has_admin_role(ARRAY['admin', 'editor']))
                                                                  WITH CHECK (public.has_admin_role(ARRAY['admin', 'editor']));
-- Permanent deletion is admin-only; editors archive instead.
CREATE POLICY "Admin delete projects"    ON public.projects FOR DELETE USING (public.has_admin_role(ARRAY['admin']));

DROP POLICY IF EXISTS "Public read project links" ON public.project_services;
DROP POLICY IF EXISTS "Staff read project links"  ON public.project_services;
DROP POLICY IF EXISTS "Staff write project links" ON public.project_services;
CREATE POLICY "Public read project links" ON public.project_services FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.status = 'published'));
CREATE POLICY "Staff read project links"  ON public.project_services FOR SELECT USING (public.has_admin_role(ARRAY['admin', 'editor']));
CREATE POLICY "Staff write project links" ON public.project_services FOR ALL
  USING (public.has_admin_role(ARRAY['admin', 'editor'])) WITH CHECK (public.has_admin_role(ARRAY['admin', 'editor']));

REVOKE ALL ON public.projects, public.project_services FROM anon, authenticated;
GRANT SELECT ON public.projects, public.project_services TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects, public.project_services TO authenticated;

-- 4) Optional extras on services (existing rows and the existing admin keep working) ------------
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS cover_image TEXT;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS price_label JSONB;   -- e.g. {"sq":"Sipas marrëveshjes","en":"On request"}
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_cover_https') THEN
    ALTER TABLE public.services ADD CONSTRAINT services_cover_https
      CHECK (cover_image IS NULL OR (cover_image ~ '^https://[^[:space:]]+$' AND length(cover_image) <= 500));
  END IF;
END $$;

-- 5) Reordering (atomic; runs with the caller's permissions, so Row Level Security applies) -----
CREATE OR REPLACE FUNCTION public.reorder_projects(p_ids TEXT[])
RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.projects p SET display_order = x.ord::int
    FROM unnest(p_ids[1:500]) WITH ORDINALITY AS x(id, ord) WHERE p.id = x.id;
$$;
CREATE OR REPLACE FUNCTION public.reorder_services(p_ids TEXT[])
RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.services s SET display_order = x.ord::int
    FROM unnest(p_ids[1:500]) WITH ORDINALITY AS x(id, ord) WHERE s.id = x.id;
$$;
REVOKE ALL ON FUNCTION public.reorder_projects(TEXT[]), public.reorder_services(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_projects(TEXT[]), public.reorder_services(TEXT[]) TO authenticated;

-- 6) Image storage: its own public bucket, images only, 5 MB max ------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('portfolio-images', 'portfolio-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Public read portfolio images"   ON storage.objects;
DROP POLICY IF EXISTS "Staff upload portfolio images"  ON storage.objects;
DROP POLICY IF EXISTS "Staff update portfolio images"  ON storage.objects;
DROP POLICY IF EXISTS "Staff delete portfolio images"  ON storage.objects;
CREATE POLICY "Public read portfolio images"  ON storage.objects FOR SELECT USING (bucket_id = 'portfolio-images');
CREATE POLICY "Staff upload portfolio images" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'portfolio-images' AND public.has_admin_role(ARRAY['admin', 'editor']));
CREATE POLICY "Staff update portfolio images" ON storage.objects FOR UPDATE
  USING (bucket_id = 'portfolio-images' AND public.has_admin_role(ARRAY['admin', 'editor']));
CREATE POLICY "Staff delete portfolio images" ON storage.objects FOR DELETE
  USING (bucket_id = 'portfolio-images' AND public.has_admin_role(ARRAY['admin', 'editor']));

-- 7) Activity log: record who changed what in the portfolio -------------------------------------
DROP TRIGGER IF EXISTS audit_projects ON public.projects;
CREATE TRIGGER audit_projects AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- Verify (after running):
--   SELECT count(*) FROM projects;                                   -- 0: nothing is invented
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'portfolio-images';
