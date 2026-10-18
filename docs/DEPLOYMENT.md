# Production deployment and rollback

**Nothing in this repository deploys itself.** GitHub Pages serves `main` today. GitHub's terms do not allow Pages to host an online business or shop, so a move to Cloudflare is prepared in `HOSTING_MIGRATION.md` (not executed); work is on `dev/platform`. Do not deploy, merge or run SQL on production without the owner's explicit approval (see gates in `IMPLEMENTATION_PLAN.md`).

## Pre-flight checklist (all must be ticked)
- [ ] `docs/TESTING.md` re-run is green on the exact commit to be released
- [ ] Production backup taken **today** and a test restore proven on staging
- [ ] Staging checks below done
- [ ] Owner has approved in writing: code, each migration, the function deployment
- [ ] Quiet period chosen; someone can place a test order afterwards

## Staging manual checklist
1. Admin sign-in as each role (admin / editor / staff); each sees only its sections.
2. Products: add, edit photo upload, hide, delete.
3. Portfolio: create → draft (not visible on `projects.html`) → publish (visible) → archive (hidden) → delete with confirmation.
4. Checkout on staging: order appears, stock drops, status `pending`, "cash on delivery / not paid" wording; cancel restocks.
5. Notification function in dry-run lists the order; one real send to a test inbox; no duplicate on retry.
6. Contact and quote forms create inquiries; honeypot blocks bots.
7. Promo: export PNG, JPG, PDF; open them; advert price differs from catalogue price and the catalogue is unchanged.
8. Reports: month totals vs the orders list; CSV opens in a spreadsheet.
9. Mobile width 375 px on home, shop, product, checkout, admin.
10. `grep` of the old contact e-mail on the deployed pages returns nothing.

## Deploy order
1. Backup production DB (and download storage photos).
2. Apply approved migrations one by one; after each, load the site and place no real orders.
3. Merge PR to `main`; wait for Pages to publish; hard-refresh and run checklist items 1, 4, 6, 9, 10 on production with a clearly labelled test order that you cancel and delete afterwards **(this writes production data — only with your approval)**.
4. Deploy the function in dry-run; flip dry-run off only after a verified send.

## Rollback
| What | How | Time |
|---|---|---|
| Website code | `git revert -m 1 <merge>` and push, or reset `main` to tag `baseline-2026-10-18` (original site) | minutes (Pages rebuild) |
| A migration | run its `-ROLLBACK.sql` (v4/v5/v6/v7), or restore the pre-migration dump | minutes |
| Notification function | set `NOTIFY_DRY_RUN=true`, or undeploy; unschedule with the instructions in `supabase-notify-schedule.sql` | minutes |
| Catastrophe | restore the dump into a new project, change the URL/key constants in `supabase-client.js` | hours |
The original site is always available as `baseline-2026-10-18`; the existing live site is never modified during development.
