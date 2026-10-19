# Invoices / Faturat — built-in invoicing (branch `dev/platform`)

Status: **implemented and tested on a throwaway local database and in real Chromium. Not deployed. Not applied to your Supabase project.**
Nothing here touches DNS, hosting, GitHub Pages/Cloudflare, or production data. `main` is unchanged.

## 1. What it is

A new **Invoices / Faturat** section inside the existing admin panel (same login, admin role only), with seven tabs:
Dashboard · All invoices · Create invoice · Customers · Payments · Reports · Invoice settings.
Invoices are stored in your existing Supabase project, use your **real shop products and services**, can be created from **real orders**,
get a unique number only when issued, produce an **A4 PDF**, track **partial payments and balances**, and feed monthly reports and CSV exports.

It is **separate from the old standalone invoice app** (`subcore-invoice`, browser-only). That app is untouched and still works; its backup file can still be loaded in Admin → Reports.
Old invoices are *not* imported automatically into the new module (see limitations).

**Fiscalization: not implemented, and never simulated.** These are informal commercial invoices. Every issued/cancelled PDF says
*“Dokument informal; nuk është faturë e fiskalizuar (pa NIVF/NSLF)”* and carries no NIVF/NSLF/QR data. Drafts are watermarked DRAFT and have no number.

## 2. Files

Added: `supabase-migration-v8-invoicing.sql`, `supabase-migration-v8-ROLLBACK.sql`, `invoices-core.js` (maths, statuses, reports, CSV, WhatsApp text),
`invoice-pdf.js` (A4 PDF), `admin-invoices.js` (all seven screens), `vendor/pdf-lib.min.js` (pdf-lib 1.17.1, MIT, unmodified),
`docs/INVOICING.md`, tests in `tests/invoicing/` (`invoicing.test.sql`, `run-db-tests.sh`, `concurrency.sh`, `parity.mjs`, `core.test.mjs`, `e2e.mjs`).
Modified (additive only): `admin.js` (nav entry, data loading, “Create invoice / Open invoice” in the order panel, friendlier message if an order with an invoice is deleted),
`admin.html` (4 script tags), `admin.css` (small block at the end), `supabase-client.js` (new methods, nothing existing changed),
`tests/security/run.sh` + `rls-matrix.expected` (matrix now includes v8: 354 → 420 cells, **no existing cell changed**).
No public page, product, order, checkout, WhatsApp/Instagram/TikTok link was changed.

## 3. Products, services and orders

* The editor’s product and service pickers read the **same live lists the Products/Services screens use** (no second catalogue; a product added in the shop is selectable immediately — tested).
* The browser never decides a catalogue price. On every save and again at issue, the **database reads the current price, SKU and name** from `products` / `services` and stores a **snapshot on the invoice line**.
  Services with price 0 (“on request”) require you to type the agreed price. Custom lines are free text.
* **Price changes later never rewrite an issued invoice** (lines are frozen and the database refuses edits). If a catalogue price changed between saving a draft and issuing it, issuing is **blocked** with a clear message and one click refreshes the draft to the new prices for review. A product that is later deleted keeps its history (no foreign key on purpose).
* **Create invoice from an order** (button in the order panel; becomes **Open invoice** once one exists): lines, quantities, unit prices and delivery come **from the order exactly as recorded** (server-side — the browser cannot change them), even if the shop price has since moved. You can review/edit customer details, add VAT or discounts, and add extra lines before issuing. If the total then differs from the order total, the screen says so.
* Only **one live invoice per order** (database unique index). Cancelling an invoice frees the order for a corrected one. Order ↔ invoice links work both ways.
* **Nothing is automatic**: issuing an invoice or recording a payment never changes order status, order payment state or stock.
* An order that has an invoice cannot be deleted (database foreign key; the admin shows a plain explanation).

## 4. Numbering and concurrency

* Format `PREFIX-YEAR-000001` (default `SUB-INV`; prefix and digit count configurable; counter restarts each calendar year, Europe/Tirane).
* A number is taken **only inside `invoice_issue()`**, with an atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` on a counter row, in the same transaction as marking the invoice issued. Drafts have no number, so deleting drafts leaves **no gaps**; a failed/blocked issue consumes nothing; cancelled numbers are never reused. `number` also has a database UNIQUE constraint.
* Issuing the same invoice twice returns the same number (idempotent). Saving the same draft twice (double-click/retry) creates one draft (client token). Recording the same payment twice records one payment (client token).
* Verified: 12 and 20 simultaneous sessions → all numbers unique and gap-free (`tests/invoicing/concurrency.sh`).

## 5. Lifecycle, payments, corrections

`draft → issued → (partly paid → paid | overdue) ` or `cancelled`. Overdue is derived (past due date with a balance). Issued invoices cannot be edited: **correct a mistake by cancelling (reason required) and issuing a new invoice**. An invoice with active payments cannot be cancelled until those payments are reversed.
Payments: full or partial, amount ≤ balance, no future dates, methods cash/bank transfer/card/other, reference & note. **Reversals** keep the original row (marked reversed with reason, who, when) and restore the balance — payments are never edited or deleted. Every action writes an append-only history (who/when) shown in the invoice panel.

## 6. Security design

* All eight tables are **admin-read-only via RLS** (`has_admin_role(ARRAY['admin'])`); the numbering counter is not readable at all. Browsers have **no INSERT/UPDATE/DELETE privilege**: every change is a `SECURITY DEFINER` function that re-checks the admin role, validates input, and sets a flag that guard triggers require (so even a stray SQL write is refused).
* Anonymous users, staff and editors can read/write nothing (tested). Helper functions are not executable by `anon`/`authenticated`.
* Issued invoices, their lines, payments and history are protected by triggers (immutable / append-only).
* Invoice settings live in a **private table** (the existing `website_settings` is public-readable, so it is deliberately not used).
* No service-role key or secret is in any browser file. **No new environment variables or credentials are needed.**
* Invoice PDFs are generated in the browser from rows the admin is already allowed to read; nothing is uploaded or published; there are **no public invoice links**.

## 7. Settings (Invoices → Invoice settings)

Company name (required to issue), tax ID (NIPT), registration no., address, phone, e-mail, bank/IBAN/SWIFT, number prefix & digits, default currency (ALL), default payment term (14 days), **default VAT % (empty = none)**, language of PDF/WhatsApp text (sq/en), default terms, notes, footer. Nothing is pre-filled with invented data and **no tax rate is assumed**; with no VAT typed, the screen says no VAT is applied. Company details are copied onto each invoice at issue time.

## 8. PDF, print, WhatsApp

* **Download** (invoice panel → Download) gives `SUB-INV-YYYY-000001.pdf`: logo, seller/buyer, lines (SKU, description, qty, price, discount, VAT, total), subtotal, discounts, taxable amount, delivery, VAT, total, paid & balance, bank details, terms, notes, footer; multi-page with repeated headers; Albanian letters (ë, ç) verified by extracting the PDF text. Figures are the frozen database values — identical to the screen, CSV and reports.
* **Open PDF / Preview PDF** opens it in a new tab for viewing and **printing with the browser’s print command**. *Not verified here:* headless Chromium has no PDF viewer, and the admin page’s strict Content-Security-Policy (`object-src 'none'`) may stop some browsers from showing a PDF opened from the page. If a blank tab appears, use **Download** and open the file — please tell me and I will add an in-page preview.
* **WhatsApp** opens `wa.me/<customer phone>` with a short text (invoice number, amount, due date) using the customer’s saved phone; you attach the downloaded PDF yourself. Nothing is sent or recorded by the system; it never claims delivery or payment.

## 9. Reports

Dashboard: invoiced, received, outstanding, overdue per currency (never mixed), drafts, overdue list, and an *orders vs invoices* panel (orders without an invoice, invoice totals that differ from the order). Reports: date range, by month (invoiced/VAT/received), by customer, order reconciliation, CSV for invoices, payments and months. Invoiced = issued in the period (cancelled/drafts excluded); received = payments dated in the period (reversals excluded); outstanding/overdue = today. A visible warning appears if *invoiced ≠ paid + still owed*.

## 10. Migration — safe way to apply

`supabase-migration-v8-invoicing.sql` is **additive and idempotent**: it only creates new tables/functions/policies/view; it does not alter or read-modify any existing table, product, order or setting (verified: existing rows/objects untouched; re-running is safe).
Because the website and admin use **one** Supabase project, a dev/platform preview can only show invoices once v8 exists in *that* project. Options:
1. **Recommended: staging first.** Create a free second Supabase project, run in order `supabase-schema-fresh-install.sql`, v3, v4, v5, v6, v7, v8 (see `docs/DEPLOYMENT.md`), and point a *local copy* of `supabase-client.js` at it. Test everything there.
2. **Production** (only when you approve): free plan has **no automatic backups** → first export (Table editor → export, or `pg_dump`) per `docs/DATABASE_AND_BACKUPS.md`; then run v8 once in the SQL editor; then check: `select count(*) from invoices;` → 0, `select data from invoice_settings;` → defaults only.
Until v8 exists the admin shows a yellow notice and the Invoices tab explains how to install it; everything else keeps working.

## 11. Rollback

* Remove the feature from the database: run `supabase-migration-v8-ROLLBACK.sql` (drops only the invoicing objects; **deletes all invoices, customers, payments and invoice settings — export first**). Tested: rollback leaves 0 invoicing objects and untouched products/orders; v8 can be re-applied afterwards.
* Remove it from the site: nothing is deployed from this branch. If it is ever merged and must be undone, revert the merge commit (the site files above are additive); the original project is preserved at commit `4f42788` and `main` as it was before the hosting work at `c4d7eb5` (see `docs/HOSTING_MIGRATION.md`, “Rollback”).

## 12. Tests — what was actually executed (all on a throwaway local PostgreSQL 16 and local Chromium; **none against your real Supabase**)

| Area | Result |
|---|---|
| Invoicing database behaviour (`tests/invoicing/invoicing.test.sql`) | **116 checks pass**: permissions (anon/staff/editor/admin), settings validation, exact maths, server-side prices, price-change guard, numbering, idempotency, immutability, payments/overpayment/reversal, cancel rules, order invoices (original prices, duplicate prevention, stock/status untouched), history, history of deleted/changed products |
| Concurrency | 12 and 20 simultaneous issues: unique, gap-free |
| JS ↔ SQL maths parity (`parity.mjs`) | 3,000 random invoices identical to the cent |
| JS unit tests (`core.test.mjs`) | 12 pass |
| End-to-end in Chromium against the real SQL (`e2e.mjs`) | **18 pass**: admin-only visibility, install notice, 7 tabs, settings, customers, create from real products/service/custom line (screen total = server total), price-change block + refresh, issue → `SUB-INV-YYYY-000001`, PDF download & text (ë, ç, totals, no fiscal claims), immutability, partial/full payment, double-click safety, overpayment refused, reversal, order → invoice (original prices, duplicate refused, order untouched, links both ways), new product selectable, dashboard/report/CSV reconcile with the database, WhatsApp, cancel rules, number never reused, 390 px mobile layout, no JS errors, no direct table writes from the page |
| Regression | Original-site comparison **184/184** (working tree and built `dist/`), build + smoke 49/49, all existing suites pass (87 unit, 30 vendor calc, orders, portfolio admin/public, promo, reports e2e, notifications, v7/portfolio SQL), security matrix: no existing cell changed |

**Not executed / not possible here:** anything against the real Supabase project or real data (including “migrations preserve production data” — verified only on a local database seeded with the same schema); real admin login with real credentials (the existing login path is unchanged and its tests use a stand-in); browser PDF *viewer* and physical printing; Safari/Firefox/real phones; the Cloudflare preview build of this branch; checkout of the public site against real Supabase.

## 13. Limitations

* Not fiscalized (by decision). `invoice_set_fiscal_ref()` exists in the database for a future free-text reference but has no screen and no meaning to any tax authority.
* No import of old standalone-app invoices (they stay in that app / its backup file); numbering of the new module starts at 1 (set a different prefix such as `SUB-INV` vs the old app’s to avoid confusion).
* One currency per invoice; products priced in another currency cannot be added to it. Reports never add currencies together.
* No e-mailing of invoices, no credit-note document type (cancel & re-issue instead), no recurring invoices, single seller entity, no per-user permissions beyond admin.
* Free Supabase plan: no automatic backups and the project pauses after a week of inactivity — keep your regular export habit.

## 14. How to test on `dev/platform`

1. Get the branch preview URL for `dev/platform` from Cloudflare (Workers Builds → your project → Deployments → the `dev/platform` build) or run locally: `git checkout dev/platform && node scripts/build-static.mjs && npx wrangler dev` (needs network) — or open the files through any static server.
2. Apply `supabase-migration-v8-invoicing.sql` to **staging** (see §10), reload `/admin.html`, sign in.
3. Invoices / Faturat → **Invoice settings**: fill company name etc. → Save.
4. **Customers** → New customer. **Create invoice** → pick the customer, add a product, a service, a custom line, VAT, a discount → Save draft → check totals → **Issue invoice** → note the number → **Download** the PDF.
5. Change a product price in Products, create another draft with it → it uses the new price; the first invoice does not change.
6. Orders → open an order → **Create invoice** → check prices equal the order → save, issue. Try again on the same order → it shows **Open invoice**.
7. Record a partial payment, then the rest; reverse one; check balance and status; try to cancel while paid (blocked).
8. Reports → date range, CSV; compare with Dashboard. Try WhatsApp on a customer with a phone.
9. Log in as an editor/staff user: no Invoices menu, and the database refuses direct access.
10. Automated: `bash tests/invoicing/run-db-tests.sh`, `node tests/invoicing/parity.mjs`, `node tests/invoicing/e2e.mjs` (needs the local PostgreSQL & Playwright described in `docs/TESTING.md`).
