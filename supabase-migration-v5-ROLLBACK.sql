-- ============================================================================
-- SubCore Solutions — ROLLBACK for supabase-migration-v5-notifications.sql
-- Removes the notification trigger, functions and table. Orders, products and every
-- other table are untouched. WARNING: the notification history (notification_log) is
-- deleted. Export it first if you want to keep it.
-- Also stop the schedule if you created it (see supabase-notify-schedule.sql, "Undo").
-- ============================================================================
DROP TRIGGER  IF EXISTS notify_on_new_order_trg ON public.orders;
DROP FUNCTION IF EXISTS public.notify_on_new_order();
DROP FUNCTION IF EXISTS public.claim_notifications(INTEGER);
DROP FUNCTION IF EXISTS public.finish_notification(BIGINT, BOOLEAN, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.retry_notification(BIGINT);
DROP TABLE    IF EXISTS public.notification_log;
