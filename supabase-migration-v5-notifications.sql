-- ============================================================================
-- SubCore Solutions — ORDER E-MAIL NOTIFICATIONS (v5)
-- Run AFTER supabase-migration-v4-security.sql. Safe to re-run.
--
-- BEFORE YOU RUN IT: run it on a STAGING project first, take a backup, and keep
-- supabase-migration-v5-ROLLBACK.sql to hand. This migration is purely additive:
-- it adds one table, a few functions and one trigger on `orders`. It does not alter
-- any existing column, policy or row, and it does not change place_order().
--
-- How it works
--   1. A trigger on `orders` writes ONE row into `notification_log` for every new order
--      (a unique key makes a second row for the same order impossible). The trigger can
--      never block or fail a customer's order: if logging fails, the order still succeeds.
--   2. The Edge Function `send-notifications` (supabase/functions/send-notifications) claims
--      pending rows, reads the order on the server, sends the e-mail through the e-mail
--      service and only then marks the row `sent`. Failures are retried with back-off and
--      end as `dead` after 6 attempts; an admin can re-queue them (Admin -> Notifications).
--   3. The log holds NO customer data: only order id/number, event type, status, attempt
--      count and a short error code.
--
-- Event types
--   order_submitted    a customer placed an order (created by the trigger below).
--   payment_confirmed  RESERVED for a future payment provider. Nothing creates this event
--                      today: the shop only offers cash on delivery and has no payment
--                      system, so no order can be reported as paid.
-- ============================================================================

-- 1) Log / outbox table ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_log (
  id              BIGSERIAL PRIMARY KEY,
  event_type      TEXT        NOT NULL CHECK (event_type IN ('order_submitted', 'payment_confirmed')),
  order_id        BIGINT      NOT NULL,   -- deliberately no foreign key: the log outlives a deleted order
  order_number    TEXT,
  dedupe_key      TEXT        NOT NULL UNIQUE,
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  last_error      TEXT,                   -- short code only, e.g. resend_429 — never customer data
  provider_id     TEXT,                   -- id returned by the e-mail service once it ACCEPTED the message
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notification_log_due_idx ON public.notification_log (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS notification_log_order_idx ON public.notification_log (order_id);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin read notification log" ON public.notification_log;
CREATE POLICY "Admin read notification log" ON public.notification_log
  FOR SELECT USING (public.has_admin_role(ARRAY['admin']));
-- No insert/update/delete policy: the browser can never write to this table.
REVOKE ALL ON public.notification_log FROM anon, authenticated;
GRANT SELECT ON public.notification_log TO authenticated;

-- 2) Trigger: one notification per new order --------------------------------------
CREATE OR REPLACE FUNCTION public.notify_on_new_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.notification_log (event_type, order_id, order_number, dedupe_key)
    VALUES ('order_submitted', NEW.id, NEW.order_number, 'order_submitted:' || NEW.id)
    ON CONFLICT (dedupe_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Never let notification bookkeeping break a customer's order.
    RAISE WARNING 'notify_on_new_order: could not queue notification for order % (%)', NEW.id, SQLSTATE;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_on_new_order() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_on_new_order_trg ON public.orders;
CREATE TRIGGER notify_on_new_order_trg AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_order();

-- 3) Worker functions (callable ONLY by the server-side service role) ----------------
-- Claims up to p_limit due rows. FOR UPDATE SKIP LOCKED means two workers can never take
-- the same row. A row stuck in `sending` for 10 minutes (crashed worker) becomes due again;
-- once it has used all 6 attempts it is parked as `dead` instead.
CREATE OR REPLACE FUNCTION public.claim_notifications(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (id BIGINT, event_type TEXT, order_id BIGINT, attempts INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE notification_log n
     SET status = 'dead', last_error = 'stale_lock', locked_at = NULL
   WHERE n.status = 'sending' AND n.locked_at < now() - interval '10 minutes' AND n.attempts >= 6;

  RETURN QUERY
  WITH picked AS (
    SELECT l.id FROM notification_log l
     WHERE (l.status IN ('pending', 'failed') AND l.next_attempt_at <= now())
        OR (l.status = 'sending' AND l.locked_at < now() - interval '10 minutes' AND l.attempts < 6)
     ORDER BY l.next_attempt_at, l.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE notification_log n
       SET status = 'sending', attempts = n.attempts + 1, locked_at = now(),
           order_number = COALESCE((SELECT o.order_number FROM orders o WHERE o.id = n.order_id), n.order_number)
      FROM picked WHERE n.id = picked.id
    RETURNING n.id, n.event_type, n.order_id, n.attempts
  )
  SELECT upd.id, upd.event_type, upd.order_id, upd.attempts FROM upd ORDER BY upd.id;
END $$;

-- Records the outcome. `sent` is written ONLY with ok = true, which the function passes
-- only after the e-mail service accepted the message. Returns false if the row is not in
-- `sending` any more (so a late or duplicate report can never overwrite the truth).
CREATE OR REPLACE FUNCTION public.finish_notification(
  p_id BIGINT, p_ok BOOLEAN, p_provider_id TEXT DEFAULT NULL, p_error TEXT DEFAULT NULL, p_permanent BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec notification_log%ROWTYPE;
  code TEXT := left(regexp_replace(COALESCE(p_error, ''), '[^A-Za-z0-9_.:-]', '', 'g'), 60);
  delay INTERVAL;
BEGIN
  SELECT * INTO rec FROM notification_log WHERE id = p_id AND status = 'sending' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_ok THEN
    UPDATE notification_log
       SET status = 'sent', sent_at = now(), provider_id = left(COALESCE(p_provider_id, ''), 120),
           last_error = NULL, locked_at = NULL
     WHERE id = p_id;
  ELSIF p_permanent OR rec.attempts >= 6 THEN
    UPDATE notification_log SET status = 'dead', last_error = NULLIF(code, ''), locked_at = NULL WHERE id = p_id;
  ELSE
    delay := CASE rec.attempts WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes'
                               WHEN 3 THEN interval '15 minutes' WHEN 4 THEN interval '1 hour'
                               ELSE interval '4 hours' END;
    UPDATE notification_log
       SET status = 'failed', last_error = NULLIF(code, ''), locked_at = NULL, next_attempt_at = now() + delay
     WHERE id = p_id;
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.claim_notifications(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_notification(BIGINT, BOOLEAN, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notifications(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_notification(BIGINT, BOOLEAN, TEXT, TEXT, BOOLEAN) TO service_role;

-- 4) Manual retry (admin only) -----------------------------------------------------------
-- Puts a failed or dead notification back in the queue with a fresh set of attempts.
-- A notification that was already sent can NOT be re-queued (that would create a duplicate).
CREATE OR REPLACE FUNCTION public.retry_notification(p_id BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  IF public.admin_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can retry notifications.' USING ERRCODE = '42501';
  END IF;
  UPDATE notification_log
     SET status = 'pending', attempts = 0, next_attempt_at = now(), locked_at = NULL, last_error = NULL
   WHERE id = p_id AND status IN ('failed', 'dead');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;
REVOKE ALL ON FUNCTION public.retry_notification(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_notification(BIGINT) TO authenticated;

-- Verify (run after; each should return what the comment says) ----------------------------
--   SELECT tgname FROM pg_trigger WHERE tgname = 'notify_on_new_order_trg';   -- one row
--   SELECT status, count(*) FROM notification_log GROUP BY 1;                  -- grows with new orders
-- Existing orders are NOT back-filled: only orders placed after this migration notify you.
