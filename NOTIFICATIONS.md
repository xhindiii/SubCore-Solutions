# Order e-mail notifications

Every new shop order sends one e-mail to the company Gmail address. Nothing is sent until you
deploy the function, set its secrets **and** switch dry-run off. Do all of this on a **staging**
Supabase project first.

## What you get
- Trigger: a new row in `orders` (written by `place_order()`), so the event is server-side and cannot be forged by a browser.
- Subject example: `[SubCore] New order submitted SC-000012 — 3 items, 5,400.5 ALL — unpaid, cash on delivery`.
- Body: event type, order reference, date/time (Europe/Tirane), customer name, phone (and e-mail if given), products and quantities, total and currency, payment status, fulfillment status, and a link to `admin.html#orders/<id>` (login required, no token in the link).
- Delivery address and notes are **not** e-mailed; they stay in the dashboard.
- **Payment status is always "NOT PAID — cash on delivery".** The shop has no payment system, so no order is ever reported as paid. The `payment_confirmed` event exists in the database but nothing creates it; the renderer refuses to say "paid" without a payment reference. Connect a payment provider before using it.
- Duplicates are impossible: one log row per order (unique key), single-claim locking, and an idempotency key on the e-mail request. A notification marked `sent` can never be re-queued.
- Failures: retried after 1 min, 5 min, 15 min, 1 h, 4 h; then marked `dead` and shown in **Admin → Notifications**, where an admin can press **Retry**. A row is marked `sent` only after the e-mail service accepted the message.
- The log (`notification_log`) holds no customer data: order id/number, status, attempts, short error code.

## Setup (staging first)
1. Back up. Run `supabase-migration-v5-notifications.sql`. (Undo: `supabase-migration-v5-ROLLBACK.sql`.)
2. Create an account with an e-mail service (the code uses **Resend**) and verify a sending **domain** you own. `NOTIFY_FROM` must be on that verified domain (for example `notifications@subcoresolutions.online`). It cannot be a Gmail address. It is a sender only, not a public contact address.
3. Set secrets (Supabase dashboard → Edge Functions → Secrets, or `supabase secrets set`). Never commit them:
   - `RESEND_API_KEY`
   - `NOTIFY_WEBHOOK_SECRET` (random, 24+ characters)
   - `NOTIFY_TO` = `info.subcoresolutions@gmail.com`
   - `NOTIFY_FROM` = `SubCore Solutions <notifications@your-verified-domain>`
   - `ADMIN_BASE_URL` (optional; default `https://subcoresolutions.online/admin.html`)
   - `NOTIFY_DRY_RUN` (leave unset or `true` while testing)
4. Deploy: `supabase functions deploy send-notifications --no-verify-jwt` (the shared secret protects it instead of a user JWT).
5. Dry-run test: place a test order on staging, then call the function with the header `x-notify-secret`. In dry-run it only lists what it would send and **sends nothing**.
6. When satisfied, set `NOTIFY_TO` to a test inbox you own for one real send, then to the Gmail address, and set `NOTIFY_DRY_RUN=false`.
7. Schedule it: edit placeholders in `supabase-notify-schedule.sql` and run it (it undoes cleanly; instructions inside).

## Tests (no e-mail is sent)
- `node --test tests/notifications/*.test.mjs tests/admin/*.test.mjs`
- `PGHOST=… PGPORT=… PGUSER=… bash tests/notifications/sql/run.sh` (needs a throwaway PostgreSQL; never point it at production)

## Known limits
- `index.ts` (the Deno entry point) is covered only indirectly: the logic is unit-tested, but the real Deno + Supabase + Resend wiring must be verified on staging.
- Existing orders are not back-filled; only new orders notify.
- Troubleshooting: Admin → Notifications shows the short error code (`resend_401` = bad API key, `resend_403`/`422` = sender domain not verified or invalid address, `resend_429` = rate limit, `order_not_found`, `render_error`).
