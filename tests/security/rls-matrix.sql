-- Phase 9 — authorization matrix. LOCAL THROWAWAY DATABASE ONLY (needs tests/notifications/sql/harness.sql
-- and migrations v3..v7 applied). For each role (anon, staff, editor, admin) and each table it tries
-- SELECT / INSERT / UPDATE / DELETE with the real RLS policies and records what happened.
-- Every write is rolled back, so the seed data never changes. Output is diffed with rls-matrix.expected.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
-- ---------- seed (as superuser) ----------
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-0000000000a1','admin@t.test'),('00000000-0000-0000-0000-0000000000e1','editor@t.test'),
 ('00000000-0000-0000-0000-0000000000f1','staff@t.test'),('00000000-0000-0000-0000-0000000000c1','random-signed-in@t.test');
INSERT INTO admin_users(auth_user_id,email,role) VALUES
 ('00000000-0000-0000-0000-0000000000a1','admin@t.test','admin'),('00000000-0000-0000-0000-0000000000e1','editor@t.test','editor'),
 ('00000000-0000-0000-0000-0000000000f1','staff@t.test','staff');
INSERT INTO categories(id,name,slug) VALUES ('c1','{"sq":"K","en":"C"}','c1');
INSERT INTO products(id,name,description,price,available,category) VALUES
 ('p-live','{"sq":"A","en":"A"}','{"sq":"","en":""}',10,true,'c1'),('p-hidden','{"sq":"B","en":"B"}','{"sq":"","en":""}',10,false,'c1');
INSERT INTO services(id,name,description,available) VALUES ('s-live','{"sq":"S","en":"S"}','{"sq":"","en":""}',true),('s-hidden','{"sq":"H","en":"H"}','{"sq":"","en":""}',false);
INSERT INTO website_settings(key,value) VALUES ('k1','{"a":1}');
INSERT INTO orders(customer_name,customer_email,customer_phone,delivery_address,items,total) VALUES ('Cust','c@t.test','+355','addr','[]',10);
INSERT INTO inquiries(name,message) VALUES ('Visitor','hello');
INSERT INTO projects(id,title,summary,status) VALUES ('pr-pub','{"sq":"P","en":"P"}','{"sq":"s","en":"s"}','published'),('pr-draft','{"sq":"D","en":"D"}','{"sq":"s","en":"s"}','draft'),('pr-arch','{"sq":"A","en":"A"}','{"sq":"s","en":"s"}','archived');
INSERT INTO project_services(project_id,service_id) VALUES ('pr-pub','s-live'),('pr-draft','s-live');
INSERT INTO promo_templates(name,spec) VALUES ('t','{}');
INSERT INTO purchase_records(supplier,doc_number,doc_date,net_amount,vat_amount,total_amount) VALUES ('Sup','D1','2026-01-01',100,20,120);
INSERT INTO storage.objects(bucket_id,name) VALUES ('product-images','seed.png'),('portfolio-images','seed.png');

GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT ALL ON storage.objects TO anon, authenticated;
CREATE TABLE _matrix(role text, subject text, op text, result text);
GRANT ALL ON _matrix TO PUBLIC;

-- subject | select-sql | insert-sql | update-sql | delete-sql
CREATE TABLE _probe(subject text, sel text, ins text, upd text, del text);
INSERT INTO _probe VALUES
 ('categories','SELECT * FROM categories',$$INSERT INTO categories(id,name,slug) VALUES ('cx','{"sq":"x","en":"x"}','cx')$$,$$UPDATE categories SET slug='z'$$,'DELETE FROM categories'),
 ('products','SELECT * FROM products',$$INSERT INTO products(id,name,description,price) VALUES ('px','{"sq":"x","en":"x"}','{"sq":"","en":""}',1)$$,$$UPDATE products SET price=1$$,'DELETE FROM products'),
 ('services','SELECT * FROM services',$$INSERT INTO services(id,name,description) VALUES ('sx','{"sq":"x","en":"x"}','{"sq":"","en":""}')$$,$$UPDATE services SET available=true$$,'DELETE FROM services'),
 ('website_settings','SELECT * FROM website_settings',$$INSERT INTO website_settings(key,value) VALUES ('kx','{}')$$,$$UPDATE website_settings SET value='{"a":2}'$$,'DELETE FROM website_settings'),
 ('orders','SELECT * FROM orders',$$INSERT INTO orders(customer_name,customer_email,items,total) VALUES ('x','x@t.test','[]',1)$$,$$UPDATE orders SET status='processing'$$,'DELETE FROM orders'),
 ('inquiries','SELECT * FROM inquiries',$$INSERT INTO inquiries(name,message) VALUES ('Visitor 2','y')$$,$$UPDATE inquiries SET status='done'$$,'DELETE FROM inquiries'),
 ('admin_users','SELECT * FROM admin_users',$$INSERT INTO admin_users(email,role) VALUES ('new@t.test','admin')$$,$$UPDATE admin_users SET role='admin'$$,'DELETE FROM admin_users'),
 ('audit_log','SELECT * FROM audit_log',$$INSERT INTO audit_log(action,table_name) VALUES ('x','y')$$,$$UPDATE audit_log SET action='tampered'$$,'DELETE FROM audit_log'),
 ('notification_log','SELECT * FROM notification_log',$$INSERT INTO notification_log(dedupe_key,event_type,order_id) VALUES ('k','order.created',1)$$,$$UPDATE notification_log SET status='sent'$$,'DELETE FROM notification_log'),
 ('projects','SELECT * FROM projects',$$INSERT INTO projects(id,title,summary,status) VALUES ('prx','{"sq":"x","en":"x"}','{"sq":"s","en":"s"}','published')$$,$$UPDATE projects SET display_order=5$$,'DELETE FROM projects'),
 ('project_services','SELECT * FROM project_services',$$INSERT INTO project_services(project_id,service_id) VALUES ('pr-arch','s-live')$$,$$UPDATE project_services SET service_id='s-live'$$,'DELETE FROM project_services'),
 ('promo_templates','SELECT * FROM promo_templates',$$INSERT INTO promo_templates(name,spec) VALUES ('x','{}')$$,$$UPDATE promo_templates SET name='y'$$,'DELETE FROM promo_templates'),
 ('purchase_records','SELECT * FROM purchase_records',$$INSERT INTO purchase_records(supplier,doc_number,doc_date,net_amount,vat_amount,total_amount) VALUES ('S2','D2','2026-01-02',10,2,12)$$,$$UPDATE purchase_records SET note='n'$$,'DELETE FROM purchase_records'),
 ('storage:product-images','SELECT * FROM storage.objects WHERE bucket_id=''product-images''',$$INSERT INTO storage.objects(bucket_id,name) VALUES ('product-images','x.png')$$,$$UPDATE storage.objects SET name='y.png' WHERE bucket_id='product-images'$$,$$DELETE FROM storage.objects WHERE bucket_id='product-images'$$),
 ('storage:portfolio-images','SELECT * FROM storage.objects WHERE bucket_id=''portfolio-images''',$$INSERT INTO storage.objects(bucket_id,name) VALUES ('portfolio-images','x.png')$$,$$UPDATE storage.objects SET name='y.png' WHERE bucket_id='portfolio-images'$$,$$DELETE FROM storage.objects WHERE bucket_id='portfolio-images'$$);
GRANT SELECT ON _probe TO PUBLIC;

CREATE FUNCTION _run(p_role text, p_sub text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r record; n bigint; res text; op text; stmt text;
BEGIN
  FOR r IN SELECT * FROM _probe ORDER BY subject LOOP
    FOREACH op IN ARRAY ARRAY['select','insert','update','delete'] LOOP
      stmt := CASE op WHEN 'select' THEN r.sel WHEN 'insert' THEN r.ins WHEN 'update' THEN r.upd ELSE r.del END;
      res := NULL;
      PERFORM set_config('request.jwt.claim.sub', p_sub, true);
      BEGIN
        EXECUTE 'SET LOCAL ROLE ' || p_role;
        EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT;
        res := CASE WHEN op='select' THEN n || ' row(s) visible' WHEN n>0 THEN 'allowed' ELSE 'denied (0 rows)' END;
        RAISE EXCEPTION 'probe_rollback';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'probe_rollback' THEN
          res := 'denied (' || CASE SQLSTATE WHEN '42501' THEN 'permission/RLS' WHEN '23505' THEN 'unique' WHEN '23514' THEN 'check' WHEN '23503' THEN 'fk' ELSE SQLSTATE || ' ' || left(SQLERRM,60) END || ')';
        END IF;
      END;
      RESET ROLE;
      INSERT INTO _matrix VALUES (p_role || CASE WHEN p_sub='' THEN '' ELSE '/' || p_role_label(p_sub) END, r.subject, op, res);
    END LOOP;
  END LOOP;
END $f$;
CREATE FUNCTION p_role_label(sub text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE sub WHEN '00000000-0000-0000-0000-0000000000a1' THEN 'admin' WHEN '00000000-0000-0000-0000-0000000000e1' THEN 'editor'
   WHEN '00000000-0000-0000-0000-0000000000f1' THEN 'staff' WHEN '00000000-0000-0000-0000-0000000000c1' THEN 'signed-in-no-role' ELSE sub END $$;
GRANT EXECUTE ON FUNCTION p_role_label(text) TO PUBLIC;

\o /dev/null
SELECT _run('anon','');
SELECT _run('authenticated','00000000-0000-0000-0000-0000000000c1');
SELECT _run('authenticated','00000000-0000-0000-0000-0000000000f1');
SELECT _run('authenticated','00000000-0000-0000-0000-0000000000e1');
SELECT _run('authenticated','00000000-0000-0000-0000-0000000000a1');
\o

-- function EXECUTE privileges (public schema, excluding extension functions)
INSERT INTO _matrix
SELECT rl, 'fn:' || p.proname, 'execute', CASE WHEN has_function_privilege(rl, p.oid, 'EXECUTE') THEN 'allowed' ELSE 'denied' END
FROM pg_proc p CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) v(rl)
WHERE p.pronamespace='public'::regnamespace
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
  AND p.proname NOT IN ('p_role_label','_run');

COPY (SELECT role, subject, op, result FROM _matrix ORDER BY subject, op, role) TO STDOUT WITH (FORMAT csv, DELIMITER '|');
