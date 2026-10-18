# Monthly sales and purchase reports (Admin → Reports, admin only)

Three **separate** record sources. They are never added together, because the same sale can exist as a shop order *and* as an invoice.

| Source | Where the data comes from | What it can tell you |
|---|---|---|
| **Sales — shop orders** | the `orders` table | ordered amounts (goods, delivery, total), counts, by month/product/customer |
| **Sales — invoices** | a backup file exported from the invoice app, loaded in this browser tab | invoiced, received, outstanding, overdue, net, VAT, discounts, counts |
| **Purchases** | the `purchase_records` ledger (entered by hand) | recorded total, paid, outstanding, VAT where entered, by supplier |
| **Sales vs purchases** | one sales source vs the purchases | a *difference of recorded documents* — **not profit** |

Filters: date range (with This month / Last month / This year / All), customer, product, invoice status, supplier. Exports: CSV of
documents, CSV by month, and Print / save as PDF (the print view hides the dashboard and adds a header with period and caveats).
Months are calendar months in Albanian time (UTC+1, UTC+2 in summer time); a late-evening order belongs to the local day.

## What is NOT counted (always listed under "Not counted", never silently dropped)
* **Cancelled** orders and invoices, **voided** purchases.
* **Drafts** (invoices not yet issued).
* **Demo invoices**: the invoice app's fictitious sample invoices (`demo: true`, numbered DEMO-xxxx) are never counted.
* **Suspected duplicates**: a repeated invoice number; the same supplier + document number; or an order with the same phone, items
  and total within 10 minutes of an earlier one. The earliest is counted. Tick "Also count suspected duplicates" to include them.
* **Corrections / credit documents** (invoices that reference another invoice or are typed credit/correction). The current invoice
  app has no such type; this only triggers if a later version adds one.
* Orders/purchases without a valid date.

## Invoiced is not received; ordered is not paid
* **Shop orders** are cash on delivery and store **no payment, VAT or discount data**. Reports say "not recorded" — they do not show 0.
* **Invoices**: *Invoiced* = issued invoice total. *Received* = payments recorded on those invoices (grouped by invoice month, not
  by payment date). *Outstanding* = invoiced − received (an overpayment is a warning, never negative debt). *Overdue* = outstanding on
  invoices past their due date. Net, VAT and discounts are produced by the invoice app's own engine (`vendor/invoice`, an unmodified
  copy; see its README).
* **Purchases**: *Recorded* = document total, *Paid* = what you entered as paid, *Outstanding* = difference.
* Currencies are never mixed or converted: every total is shown per currency.

## "Sales minus purchases" is not profit
The comparison tab shows `sales documents − purchase documents` per currency and says so on screen and in print. It ignores stock on
hand, cost of goods actually sold, expenses, salaries, depreciation, taxes, returns and timing. Ask your accountant for profit.

## Loading invoices
In the invoice app use its backup export (JSON; Settings → Data). In Reports → Sales — invoices choose that file. It is validated (must come from the
SubCore invoice app; unreadable records are skipped and counted), kept **in memory only** and gone when you close or reload the tab.
Nothing is uploaded or stored. Fiscalization status is **not** verified here; a `fiscalRef` is only exported in the CSV
if the invoice has one. See `docs/PHASE5-INVOICING-INTEGRATION.md` for why a live link to the invoice app is not possible yet.

## Purchase ledger
* Needs `supabase-migration-v7-promo-reports.sql` (table `purchase_records`, **admin only**, undo: `supabase-migration-v7-ROLLBACK.sql`).
* "Add purchase": supplier, document number and date, optional net and VAT, total (net + VAT must equal the total), currency,
  paid amount and date. The database also refuses: paid > total, negative amounts, a payment without a date, and a second row with the
  same supplier + document number.
* **Records are never deleted.** A wrong record is **voided** (reason required, kept for the audit trail, excluded from reports,
  cannot be changed again); then enter the corrected document. Payments are updated with "Record payment".
* Entries are typed by a person and are **not verified against supplier documents**.
* Changes appear in Admin → Activity.

## Tests
`node --test tests/reports/` (calculation core, vendored-file integrity), `tests/reports/sql/v7.test.sql` (via
`tests/notifications/sql/run.sh`), `node tests/reports/admin.e2e.mjs` (real Chromium: filters, invoice import, purchase ledger,
CSV, print-to-PDF text check, missing-table behaviour). The vendored engine also passes the invoice app's own original test file
(`node tests/vendor-invoice/calc.test.js`, 30 tests).
