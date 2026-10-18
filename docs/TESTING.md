# Testing report (Phase 9)

Run on 2026-10-18 on branch `dev/platform` (all in a sandbox: fake Supabase in the browser, throwaway local PostgreSQL 16, **no network to production, no production data read or written, no e-mail sent**).

| # | Area | How | Result |
|---|---|---|---|
| 1 | Existing site vs original baseline | `tests/regression/baseline-compare.mjs`: tag `baseline-2026-10-18` vs dev, 16 baseline pages × 3 viewports (375/768/1280) | **184/184 checks**: every page exists, no file deleted/renamed, no new JS errors, no new failed asset requests, no new horizontal overflow, same main heading, every baseline link still present. Added: `projects.html`, `project.html`, a Projects nav link, the new Gmail mailto. Removed: only the old contact mailto (approved, Phase 3) |
| 2 | Forms | same script | contact form → `inquiries` insert; quote form → `inquiries` insert; checkout → `place_order` with the cart items — identical on baseline and dev |
| 3 | Portfolio workflow (add, edit, publish, archive, drafts private) | `tests/portfolio/admin.e2e.mjs` (11), `public.e2e.mjs` (11), SQL `portfolio.test.sql` | all pass; draft/archived invisible to anon (also in the RLS matrix: anon sees 1 of 3 projects) |
| 4 | Notification e-mails | `tests/notifications/*.test.mjs` + SQL suite | pass; renderer never says "paid" without a payment reference; **nothing was sent** |
| 5 | Order and payment statuses | SQL tests of `place_order` (status `pending`, cash on delivery, stock check, restock on cancel) | pass |
| 6 | Old contact e-mail | repo-wide search | **0 occurrences** outside the regression test that names it on purpose |
| 7 | Catalogue sync | `tests/regression/catalogue-sync` (logic of the invoice app's export tool against 90 fake products) | 7/7: count, ids, exact prices, currency, no stock/images leak. The import side is covered by the invoice app's own `tests/catalogue.mjs` (kept in the Project; not re-run here) |
| 8 | Promo PNG/JPG/PDF | `tests/promo` (15 unit + 15 browser) | real files validated with PIL and poppler; advert price never written to the catalogue |
| 9 | Report reconciliation | `tests/reports/reconcile.property.test.mjs`: 6 properties × 60 random seeds (orders, purchases, invoices) | pass. Totals = sum of rows; months add up to totals; counted + excluded = input; cancelled/duplicates/voided/drafts never counted; month assignment checked against an independent calendar incl. DST/month edges. Sabotaging the month logic or the cancelled filter makes it fail |
| 10 | Authentication / authorization | `tests/security/run.sh` → `rls-matrix.sql` (354 cells, diffed with a frozen expectation) | matches intent: anon cannot read orders/inquiries/purchases/audit/notifications; staff cannot touch catalogue; editor cannot read orders; only admin reads the ledger; audit/notification logs are immutable for everyone |
| 11 | Persistence + backups | `tests/security/backup-restore.sh` | full restore and rebuild-from-SQL both identical; RLS still enforced after restore |
| 12 | Unit / integration | `node --test` over notifications, admin, reports, promo = **75 pass**; vendored invoice calc suite **30 pass** | pass |
| 13 | SQL migrations | `tests/notifications/sql/run.sh` (v5, v6, v7: apply, re-run, test, rollback, re-apply) | 110 PASS lines, exit 0 |
| 14 | Browser suites | portfolio admin 11, portfolio public 11, promo 15, reports 11 | all pass |
| 15 | Build / lint | the site has no build step and no linter configured; `node --check` on all 29 JS/MJS files | clean |
| 16 | Secrets in public files | pattern scan (service_role, `sb_secret`, Resend keys, JWTs) | none |

## Failures found and fixed during testing
- Regression script's first quote-form probe failed on baseline and dev alike (message under the 10-character minimum in my fixture) — test bug, fixed.
- RLS probe fixtures violated check constraints (name < 2 chars, published project without summary, storage grants missing in the stand-in) — fixture bugs, fixed; no product bug found.
- Backup procedure B first failed on duplicate rows because the installer seeds default rows — procedure corrected (empty tables first) and documented.
No product defect was found in this pass.

## NOT verified (cannot be, from here)
- Fiscalization (not implemented; needs the authorised test process of the tax authority — see Phase 5 doc).
- Real e-mail delivery, the Deno entry point `index.ts`, the Resend domain — staging only.
- v5/v6/v7 on a real Supabase project (only on a local Postgres stand-in).
- Hosted `pg_dump`/restore, storage-file backup.
- GitHub Pages settings (HTTPS enforcement, custom domain), real HTTP headers.
- Real devices / Safari / Firefox (Chromium only).
- The invoice app end-to-end in the website (no integration exists).
- Pixel-level visual diff against the baseline was not done; the layout checks above are structural.

## Re-running everything
```bash
export PGHOST=/tmp PGPORT=54329 PGUSER=pgtest NODE_PATH=/opt/npm-tools/node_modules PW_PATH=/opt/npm-tools/node_modules/playwright
bash tests/notifications/sql/run.sh && bash tests/security/run.sh && bash tests/security/backup-restore.sh
node --test tests/notifications/*.test.mjs tests/admin/*.test.mjs tests/reports/*.test.mjs tests/promo/*.test.mjs
for f in tests/portfolio/admin.e2e.mjs tests/portfolio/public.e2e.mjs tests/promo/admin.e2e.mjs tests/reports/admin.e2e.mjs; do node $f; done
git worktree add /tmp/base baseline-2026-10-18 && node tests/regression/baseline-compare.mjs /tmp/base .
node tests/regression/catalogue-sync/run.mjs tests/regression/catalogue-sync/export-logic.copy.js
```
