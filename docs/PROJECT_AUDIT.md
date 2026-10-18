# Project audit — current state

Baseline: git tag `baseline-2026-10-18` (commit `4f42788`) is the untouched original. All work lives on branch `dev/platform`. The full Phase 1 audit is kept in the Claude Project (`SubCore-Phase1-Audit.md`); this page is the consolidated, current picture.

## Public website (preserved)
16 pages — index, services, shop, product, cart, checkout, quote, students, about, contact, faq, privacy, terms, shipping-returns, 404, admin — static HTML/CSS/JS on GitHub Pages, Albanian default with SQ/EN switch, shop and admin backed by Supabase. `tests/regression` proves all of them still load, link and submit as before (184/184).

## What was added (all additive)
| Phase | Addition | Doc |
|---|---|---|
| 2 | Order e-mail notifications (DB trigger + Edge Function, dry-run by default, not deployed) | `NOTIFICATIONS.md` |
| 3 | Old contact e-mail removed; single Gmail everywhere | — |
| 4 | Admin-managed portfolio (`projects.html`, `project.html`) and richer services | `PORTFOLIO.md` |
| 5 | Invoicing-integration investigation — integration and fiscalization **blocked**, nothing faked | `docs/PHASE5-INVOICING-INTEGRATION.md` |
| 6 | Promo generator (PNG/JPG/PDF, saved templates) | `PROMO.md` |
| 7 | Monthly sales/purchase reports, purchase ledger | `REPORTS.md` |
| 8–9 | Architecture review, security matrix, backup/restore proof, regression suite | this folder |

## Live backend facts (read-only, 2026-10-18)
Supabase "SubCore Store", eu-west-1, Postgres 17.6, healthy, Free plan, single project. Rows: products 90, categories 14, orders 2, services 0, website_settings 1, admin_users 1, inquiries 0, audit_log 141. No Edge Functions, no recorded migrations. v5/v6/v7 **not applied**.

## Findings that still need the owner
1. Old default admin password is in git history → rotate, enable MFA (`SECURITY.md`).
2. **No automatic backups on the Free plan** (`DATABASE_AND_BACKUPS.md`).
3. No staging environment.
4. 2 existing orders: are they tests? (reports and notifications would otherwise treat them as real).
5. Fiscalization route and invoice-app deployment undecided (Phase 5).
6. Shop prices: VAT-inclusive or not is not recorded anywhere.
7. Company legal data for the privacy/terms pages is missing.
8. Supabase advisor warnings (function execute grants, mutable search_path, leaked-password protection).
9. GitHub push access for this work is not available to the assistant (`xhindiii/subcore-solutions` not in the authorised set) — changes are delivered as a git bundle.
