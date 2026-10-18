# Phases 6 and 7 — promo graphics generator and monthly reports

Date: 2026-10-18. Branch `dev/platform` (not pushed — no push access from this session). **Nothing deployed, no migration run on any real database, no real e-mail sent.**

## What now exists
| Area | Where | Who |
|---|---|---|
| Promo graphics generator | Admin → Promo graphics (`admin-promo.js`, `promo-render.js`, `PROMO.md`) | admin, editor |
| Monthly sales and purchase reports | Admin → Reports (`admin-reports.js`, `reports-core.js`, `REPORTS.md`) | admin only |
| Purchase ledger + saved promo templates | `supabase-migration-v7-promo-reports.sql` (+ ROLLBACK) | additive; **not yet run** |
| Invoice engine copy used for invoice maths | `vendor/invoice/` (unmodified, hash-checked) | — |

## Phase 6 — your requirements
* Select product → loads name, description, price, previous (compare) price, currency, photo (copied, editable). ✔
* Upload/replace image (JPEG/PNG/WebP ≤ 5 MB, magic-byte check; stays in the browser, never uploaded). ✔
* Advertised price, optional previous price, optional offer text. ✔  A "-N%" badge appears only if the previous price really is higher.
* Saved editable templates (4 built-in + your own in `promo_templates`); layout, image placement/shape/size, fonts, colours, badge, price style, CTA, logo and contact lines are all editable; no manual editing of exported images needed. ✔
* Live preview, then export **PNG, JPG, PDF**. Formats: Instagram square/portrait, Story (also WhatsApp status), Facebook 1200×630, WhatsApp 1200×900, A4 portrait/landscape, A5 (300 dpi, PDF at exact paper size). ✔
* Company branding and contact details from the site (logo, phone, the approved Gmail, website, Instagram). ✔
* **Advert price never touches catalogue or invoices:** no code path writes to products/services/orders; tests export adverts and assert zero writes and an unchanged catalogue price. ✔
* Files are canvas renders, not screenshots: tests validate exact pixel sizes, PNG/JPEG signatures, PDF page size (A4 = 595×842 pt), embedded 2480×3508 image, poppler rendering, and that pixels are the design colours.

## Phase 7 — your requirements
* Monthly sales totals (shop orders; invoices) and monthly purchase totals; date range, product, customer, supplier filters; invoice counts; payment status and outstanding; tax and discount (invoices); print (header + caveats) and CSV (documents, by month). ✔
* **No double counting:** cancelled orders/invoices, voided purchases, drafts, the invoice app's DEMO invoices, repeated invoice numbers, repeated supplier document numbers, suspected duplicate orders (same phone + items + total within 10 min) and correction/credit documents are excluded and listed under "Not counted". Tick-box to include suspected duplicates.
* **Invoiced vs received:** invoices show invoiced, received (payments recorded on them), outstanding and overdue; purchases show recorded, paid, outstanding. Shop orders show "ordered" only.
* **Not profit:** the comparison tab is titled "Difference of recorded documents", says "This is not profit" and lists what it ignores; never mixes currencies.
* "Where supported": the shop stores **no payment, VAT or discount data**, so for orders those say "not recorded" (not 0). Supplier filters work on the purchase ledger only.

## Decisions I made that you should confirm
1. **Purchases are a new manual ledger** (`purchase_records`, admin only, void instead of delete). There was no purchase data anywhere; I did not invent any. Entries are not verified against supplier documents.
2. **Invoices are reported from the invoice app's backup file**, loaded in the browser tab and not stored, because the invoice app has no API or database (Phase 5). A live feed needs the decisions in `docs/PHASE5-INVOICING-INTEGRATION.md`.
3. Orders and invoices are **never added together** (the same sale can be both).
4. Shop prices' VAT basis is still unknown, so shop-order totals are reported as stored.
5. Months use Albanian local time (UTC+1/+2).

## Verification (all passing locally)
SQL: v5/v6/v7 apply, behaviour tests, re-run, rollback, re-apply. Node: 68 tests (+ the invoice app's own 30 against the vendored engine). Chromium e2e: public portfolio, admin portfolio, promo (15 checks), reports (11 checks incl. print-to-PDF text, CSV safety, missing-table behaviour, mobile). Old contact e-mail: no occurrences.

## Not verified / limits
* Migration v7 has not been run on a real Supabase project (only a local PostgreSQL 16 replica of the schema); RLS was tested with that replica's role emulation.
* Product photos hosted on another domain can block canvas export; the page then asks for an upload.
* PDFs contain the artwork as an image (no selectable text). No print bleed/crop marks. System fonts only.
* Reports cannot say whether an invoice was fiscalized; fiscalization remains blocked as documented in Phase 5.

## To use it
1. Review the branch; 2. run `supabase-migration-v7-promo-reports.sql` on staging (optional — the promo generator and the order/invoice reports work without it); 3. deploy when you approve.

## Still open from earlier phases
Push access to the repo; staging Supabase; e-mail provider (Resend assumed); whether the 2 existing orders are tests; fiscalization route; completeness and deployment of the invoice app; VAT basis of shop prices; company legal data.
