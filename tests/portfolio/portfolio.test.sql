-- Behaviour tests for supabase-migration-v6-portfolio.sql (throwaway local PostgreSQL only).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
CREATE OR REPLACE FUNCTION t_ok(name text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS TRUE THEN RAISE NOTICE 'PASS  %', name; ELSE RAISE EXCEPTION 'FAIL  %', name; END IF; END $$;
CREATE OR REPLACE FUNCTION t_fails(name text, stmt text, code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; RAISE EXCEPTION 'FAIL  % (statement was accepted)', name;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = code THEN RAISE NOTICE 'PASS  %', name; ELSE RAISE EXCEPTION 'FAIL  % (got % %)', name, SQLSTATE, SQLERRM; END IF;
  END;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff@example.test'),
  ('00000000-0000-0000-0000-0000000000d4', 'editor@example.test');
UPDATE admin_users SET auth_user_id = '00000000-0000-0000-0000-0000000000a1' WHERE role = 'admin';
INSERT INTO admin_users (auth_user_id, email, role) VALUES
  ('00000000-0000-0000-0000-0000000000b2', 'staff@example.test', 'staff'),
  ('00000000-0000-0000-0000-0000000000d4', 'editor@example.test', 'editor');
INSERT INTO services (id, name, description) VALUES ('s1', '{"en":"Web","sq":"Web"}', '{"en":"","sq":""}'), ('s2', '{"en":"Net","sq":"Net"}', '{"en":"","sq":""}');

CREATE OR REPLACE FUNCTION as_user(uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', uid, true); END $$;

-- 1. nothing is invented
SELECT t_ok('portfolio starts empty', (SELECT count(*) FROM projects) = 0);
SELECT t_ok('existing services untouched', (SELECT count(*) FROM services) = 2 AND (SELECT count(*) FROM services WHERE cover_image IS NOT NULL OR price_label IS NOT NULL) = 0);
SELECT t_ok('portfolio bucket is public, 5 MB, images only',
  (SELECT public AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'] FROM storage.buckets WHERE id = 'portfolio-images'));
SELECT t_ok('product bucket unchanged', (SELECT file_size_limit = 5242880 AND 'image/gif' = ANY(allowed_mime_types) FROM storage.buckets WHERE id = 'product-images'));

-- 2. editor can create / publish
DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000d4'); SET LOCAL ROLE authenticated;
  INSERT INTO projects (id, title, summary, status, display_order) VALUES ('draft-one', '{"en":"Draft","sq":"Draft"}', '{"en":"s","sq":"s"}', 'draft', 2);
  INSERT INTO projects (id, title, summary, status, display_order, featured, url) VALUES ('pub-one', '{"en":"Pub","sq":"Pub"}', '{"en":"s","sq":"s"}', 'published', 1, true, 'https://example.test/x');
  INSERT INTO projects (id, title, summary, status, display_order) VALUES ('arch-one', '{"en":"Arch","sq":"Arch"}', '{"en":"s","sq":"s"}', 'archived', 3);
  INSERT INTO project_services VALUES ('pub-one', 's1'), ('draft-one', 's2');
  RESET ROLE;
END $$;
SELECT t_ok('published_at is set when a project is published', (SELECT published_at IS NOT NULL FROM projects WHERE id = 'pub-one') AND (SELECT published_at IS NULL FROM projects WHERE id = 'draft-one'));

-- 3. the public sees published projects only
DO $$ DECLARE n int; l int; BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM projects;
  SELECT count(*) INTO l FROM project_services;
  RESET ROLE;
  PERFORM t_ok('visitor sees only the published project', n = 1);
  PERFORM t_ok('visitor sees links of published projects only', l = 1);
END $$;
DO $$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN INSERT INTO projects (id, title) VALUES ('hack', '{"en":"x"}'); RESET ROLE; RAISE EXCEPTION 'FAIL  visitor inserted a project';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; RAISE NOTICE 'PASS  visitor cannot insert projects'; END;
END $$;
DO $$ DECLARE n int; BEGIN
  SET LOCAL ROLE anon;
  UPDATE projects SET featured = false WHERE id = 'pub-one';  -- no UPDATE grant -> error expected
  RESET ROLE; RAISE EXCEPTION 'FAIL  visitor updated a project';
EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; RAISE NOTICE 'PASS  visitor cannot update projects';
END $$;

-- 4. staff (orders role) and strangers cannot read drafts or write
DO $$ DECLARE n int; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000b2'); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM projects; RESET ROLE;
  PERFORM t_ok('staff role sees published only (no drafts/archived)', n = 1);
  PERFORM as_user('00000000-0000-0000-0000-0000000000b2'); SET LOCAL ROLE authenticated;
  BEGIN INSERT INTO projects (id, title) VALUES ('staff-hack', '{"en":"x"}'); RESET ROLE; RAISE EXCEPTION 'FAIL  staff inserted a project';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; RAISE NOTICE 'PASS  staff role cannot insert projects'; END;
END $$;

-- 5. editor sees everything, may archive, may not hard-delete; admin may
DO $$ DECLARE n int; d int; BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000d4'); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM projects;
  UPDATE projects SET status = 'archived' WHERE id = 'draft-one';
  DELETE FROM projects WHERE id = 'arch-one'; GET DIAGNOSTICS d = ROW_COUNT;
  RESET ROLE;
  PERFORM t_ok('editor sees all 3 projects', n = 3);
  PERFORM t_ok('editor can archive', (SELECT status FROM projects WHERE id = 'draft-one') = 'archived');
  PERFORM t_ok('editor cannot permanently delete (0 rows)', d = 0 AND EXISTS (SELECT 1 FROM projects WHERE id = 'arch-one'));
  PERFORM as_user('00000000-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  DELETE FROM projects WHERE id = 'arch-one'; GET DIAGNOSTICS d = ROW_COUNT; RESET ROLE;
  PERFORM t_ok('admin can permanently delete', d = 1);
END $$;

-- 6. data rules
SELECT t_fails('cannot publish without a title', $q$INSERT INTO projects (id, title, summary, status) VALUES ('x1','{"en":""}','{"en":"s"}','published')$q$, '23514');
SELECT t_fails('cannot publish without a short description', $q$INSERT INTO projects (id, title, summary, status) VALUES ('x2','{"en":"t"}','{"en":"","sq":""}','published')$q$, '23514');
SELECT t_fails('javascript: URL rejected', $q$INSERT INTO projects (id, title, url) VALUES ('x3','{"en":"t"}','javascript:alert(1)')$q$, '23514');
SELECT t_fails('non-https cover image rejected', $q$INSERT INTO projects (id, title, cover_image) VALUES ('x4','{"en":"t"}','http://a/b.png')$q$, '23514');
SELECT t_fails('bad id rejected', $q$INSERT INTO projects (id, title) VALUES ('Bad Id!','{"en":"t"}')$q$, '23514');
SELECT t_fails('more than 12 images rejected', $q$INSERT INTO projects (id, title, images) VALUES ('x5','{"en":"t"}', (SELECT jsonb_agg('https://a/' || g) FROM generate_series(1,13) g))$q$, '23514');
SELECT t_fails('unknown status rejected', $q$INSERT INTO projects (id, title, status) VALUES ('x6','{"en":"t"}','live')$q$, '23514');
SELECT t_fails('link to a missing service rejected', $q$INSERT INTO project_services VALUES ('pub-one','nope')$q$, '23503');
SELECT t_fails('service cover must be https', $q$UPDATE services SET cover_image = 'ftp://x/y.png' WHERE id = 's1'$q$, '23514');

-- 7. deleting a service / project cleans up links, never other data
DELETE FROM services WHERE id = 's1';
SELECT t_ok('deleting a service removes only its links', NOT EXISTS (SELECT 1 FROM project_services WHERE service_id = 's1') AND EXISTS (SELECT 1 FROM projects WHERE id = 'pub-one'));

-- 8. reordering
DO $$ BEGIN
  PERFORM as_user('00000000-0000-0000-0000-0000000000d4'); SET LOCAL ROLE authenticated;
  INSERT INTO projects (id, title, summary, status, display_order) VALUES ('a', '{"en":"A"}', '{"en":"s"}', 'draft', 0), ('b', '{"en":"B"}', '{"en":"s"}', 'draft', 0);
  PERFORM reorder_projects(ARRAY['b','pub-one','a']);
  RESET ROLE;
  PERFORM t_ok('reorder_projects sets positions 1..n', (SELECT display_order FROM projects WHERE id='b') = 1 AND (SELECT display_order FROM projects WHERE id='pub-one') = 2 AND (SELECT display_order FROM projects WHERE id='a') = 3);
  SET LOCAL ROLE anon;
  BEGIN PERFORM reorder_projects(ARRAY['a']); RESET ROLE; RAISE EXCEPTION 'FAIL  visitor reordered';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; RAISE NOTICE 'PASS  visitor cannot call reorder_projects'; END;
  PERFORM as_user('00000000-0000-0000-0000-0000000000b2'); SET LOCAL ROLE authenticated;
  PERFORM reorder_services(ARRAY['s2']); RESET ROLE;
  PERFORM t_ok('staff-role reorder_services is blocked by RLS (no change)', (SELECT display_order FROM services WHERE id='s2') = 0);
END $$;

-- 9. audit log records portfolio changes
SELECT t_ok('activity log records project changes', EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'projects'));

-- 10. re-running the migration is harmless and keeps data
\i :migration
SELECT t_ok('re-run keeps projects', (SELECT count(*) FROM projects) = 4);
SELECT 'ALL PORTFOLIO SQL TESTS PASSED';
