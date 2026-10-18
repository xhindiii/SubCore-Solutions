-- ============================================================================
-- SubCore Solutions — OPTIONAL schedule that runs the notification sender every minute.
-- Run only AFTER: (1) supabase-migration-v5-notifications.sql, (2) the Edge Function
-- `send-notifications` is deployed, (3) its secrets are set (see NOTIFICATIONS.md).
-- Do it on STAGING first. The function starts in DRY-RUN mode, so nothing is e-mailed
-- until you set NOTIFY_DRY_RUN=false.
--
-- REPLACE the two placeholders below before running. Never commit the real values:
--   <PROJECT_REF>     your Supabase project ref (the part before .supabase.co)
--   <NOTIFY_SECRET>   the SAME value as the NOTIFY_WEBHOOK_SECRET function secret
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Keep the secret in Vault rather than in the job text.
SELECT vault.create_secret('<NOTIFY_SECRET>', 'notify_webhook_secret')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'notify_webhook_secret');

-- Wrapper: calls the function only when something is actually due (cheap when idle).
CREATE OR REPLACE FUNCTION public.run_notification_sender()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM notification_log
     WHERE (status IN ('pending','failed') AND next_attempt_at <= now())
        OR (status = 'sending' AND locked_at < now() - interval '10 minutes')
  ) THEN RETURN; END IF;
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'notify_webhook_secret';
  PERFORM net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object('Content-Type','application/json','x-notify-secret', s),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000);
END $$;
REVOKE ALL ON FUNCTION public.run_notification_sender() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('subcore-send-notifications', '* * * * *', 'SELECT public.run_notification_sender()');

-- Check:  SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'subcore-send-notifications';
-- ---------------------------------------------------------------------------
-- UNDO (stops the schedule; orders and the log are untouched):
--   SELECT cron.unschedule('subcore-send-notifications');
--   DROP FUNCTION IF EXISTS public.run_notification_sender();
--   DELETE FROM vault.secrets WHERE name = 'notify_webhook_secret';
-- ---------------------------------------------------------------------------
