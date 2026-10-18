-- ============================================================================
-- OPTIONAL, ONE-TIME: point the stored company contact settings at the approved Gmail address.
-- NOT run automatically. It changes production data, so run it only after you approve it,
-- after a backup, and preferably on staging first. The public website does not read these two
-- settings today (the address is written in the page files), so this only keeps the database
-- tidy and consistent for the admin dashboard and future features.
--
-- Preview first (read-only):
--   SELECT key, value FROM website_settings WHERE key IN ('company_info','contact_info');
-- ============================================================================
UPDATE website_settings
   SET value = jsonb_set(value, '{email}', to_jsonb('info.subcoresolutions@gmail.com'::text))
 WHERE key IN ('company_info', 'contact_info')
   AND value ->> 'email' IS DISTINCT FROM 'info.subcoresolutions@gmail.com';

-- contact_info also holds the same Gmail as "secondary_email": remove the duplicate.
UPDATE website_settings SET value = value - 'secondary_email'
 WHERE key = 'contact_info' AND value ? 'secondary_email';
-- Undo: restore from the backup you took before running this.
