# Phase 5 — Integration with the existing invoicing application: findings and blockers

Date: 2026-10-18. Status: **investigation only. No integration was built, nothing was changed in the invoicing app, its numbering or any data, and no fiscal claim is made.** Where information or access is missing this document says so instead of guessing.

## 1. Summary
| Question | Answer |
|---|---|
| Do I have the invoicing app's source? | Yes, 32 files in the Project (`subcore-invoice/…`). It is **not** in the website's GitHub repo. I cannot confirm it is the complete, current version or where (if anywhere) it is deployed. |
| Does it have an API? | **No.** It is a browser-only app (vanilla JS). There is no server, no endpoint, no authentication. |
| Does it have a database I can reuse or connect? | **No.** All data is in one browser's `localStorage` (key `subcore_invoicing_v1`). There is nothing server-side to connect to. |
| Supported integration method | **Files only**: JSON/CSV catalogue import, JSON backup/restore, CSV/JSON export. |
| Is it a fiscalization application? | **No.** Its own README, user guide and printed footer state that it prepares commercial invoices "outside a fiscalization system". A PDF or an "issued" status is not fiscalization. |
| Do you have a separate fiscalization system? | **Unknown — you have not told me.** If one exists I have no name, access, documentation or credentials for it. |
| Can I safely integrate now? | Not beyond file-level data sharing. The fiscal side is blocked (section 5). |

## 2. What the invoicing app is (from its source and docs)
- Bilingual SQ/EN invoice preparation tool, A4 print layout, tests reported passing in its own docs (I did **not** run them).
- **Money model:** integer minor units, half-up rounding, prices treated as **excluding VAT**. VAT rates/categories are configured by the user; none assumed.
- **Numbering:** `prefix + optional year + padded sequence`, counter in the browser, only moves forward; used numbers are never reused or renumbered. **This is client-side**, so two browsers/devices would each have their own counter — a real risk of duplicate numbers once more than one browser is used.
- **Invoice lifecycle:** draft → issued (frozen snapshot of seller, customer, lines) → cancelled; paid / partial / overdue are derived from recorded payments.
- **Customers:** no customer table. Each invoice carries its own customer block (kind, name, tax id, address, email, phone).
- **Catalogue:** local, starts empty, no stock. Shop products can be imported through `tools/export-shop-products.js` (reads public products, copies name/SKU/category/price, skips stock; flags that the shop's VAT basis is unknown). Import is idempotent by source id.
- **Fiscal fields:** only a free-text "external fiscal reference" (`fiscalRef`) and an editable footer note. Nothing registers an invoice with the tax authority; no QR, no identifiers.
- **Company data left blank on purpose:** legal name, address, NUIS, registration, bank, IBAN. Default contact email is already the approved Gmail.
- Stale text: its README and `docs/PRODUCTION-READINESS.md` (Project copies) still mention the old domain address in one sentence each. That is documentation only, not the public site; I left the Project documents untouched.

## 3. How the website and the invoicing app line up
| Concept | Website (Supabase) | Invoicing app | Gap / risk |
|---|---|---|---|
| Products | `products`: text id, bilingual name, `NUMERIC(10,2)` price, currency, sku, category, stock | `catalogue` items, own ids, minor units, tax category, no stock | Shop prices have **unknown VAT basis**; app assumes ex-VAT. Must be decided by you/accountant before any automatic sync. Categories differ (shop 14 vs app list; a mapping exists in the export tool). |
| Services | `services` (+ new price label/cover) | catalogue items of type service | No shared id. Shop services are "from" prices, not invoice line prices. |
| Customers | none (orders embed name/phone/email/address; `inquiries`) | per-invoice customer block | No customer master data anywhere. A shared `customers` table would be new. Privacy review needed. |
| Orders | `orders` (`SC-000123`, items snapshot, total, cash on delivery, status pending/processing/completed/cancelled) | `invoices` | An order is **not** an invoice. Order totals include shipping and have no per-line VAT. There is no link today. |
| Numbering | order numbers server-side; invoice numbers browser-side | independent | Two unrelated sequences. Invoice numbers must stay untouched and continue seamlessly. |
| Payments | none (cash on delivery, no payment system) | manual payment records | Nothing to reconcile automatically. |
| Company details | `website_settings` | `settings.company` | Duplicated; should become one source once a backend exists. |
| Purchases | **no data source** | none | "Purchase records" and the purchase half of monthly reports have no input data today (supplier bills are not captured anywhere). |

## 4. Albanian fiscalization — what I could and could not verify
**Important limit:** the official Tax Authority (tatime.gov.al) pages I tried to open were not retrievable from this environment, so **nothing below is confirmed against the official legal text or specifications.** It comes from secondary sources (consultancy and e-invoicing vendor pages, one Tax Authority notice summary). Several of these sources disagree or leave gaps. Treat it as a briefing to take to your accountant, not as legal advice or a compliance statement.

Reported by the secondary sources (consistent across at least two unless noted):
- Albania runs a **central, real-time clearance/fiscalization system** run by the General Directorate of Taxes (DPT) with AKSHI (the national IT agency) providing infrastructure and certificates. Invoices are reported to it and receive a unique **NIVF** identifier that is shown on the invoice with a **QR code** for verification.
- Legal basis named: **Law No. 87/2019** (invoicing/turnover monitoring) with **Instruction No. 16 (3 Apr 2020)**; penalties are attributed to **Law No. 83/2022** by one source only; Law 79/2025 is mentioned for VAT returns. Exact titles and current consolidated versions not verified.
- Rollout dates quoted: B2G Jan 2021; B2B (non-cash) July 2021; cash transactions Sept 2021. Cash B2B cap reduced to 100,000 lekë from 1 Jan 2026 and a POS mandate with 2026 deadlines are claimed by one consultancy page only — **unverified**.
- Technical format: **XML (UBL 2.1 or UN/CEFACT 16B)**, **digitally signed** with an **AKSHI electronic certificate** (a `.pfx` file obtained through an e-Albania business account; reported cost ~4,000 lekë/year — unverified). Establishments and invoicing devices/software must be registered with the Tax Authority.
- Two ways to comply are reported: the Tax Authority's **free web portal** (manual entry; suited to low volume) or **certified software / a certified provider** (API integration, offline modes). A DPT notice (2021) refers to published technical specifications (e-invoice service technical v3 / functional v2, fiscalization technical v7) and to lists of "certified entities" and "certified fiscal devices"; **current versions, the test environment and any software-certification process were not verifiable.**
- Retention: at least 5 years in original electronic form (one source also mentions 10 years as unclear).
- **"NSLF"** (named in your brief) appears in none of the sources I could open, so I cannot describe it.

What this means for the project:
1. **Generating a PDF from the invoicing app is not fiscalization.** Do not present those PDFs as fiscal invoices.
2. A custom direct integration with the DPT web services would need: an AKSHI certificate owned by the business, the current official specifications and test environment, XML signing, error/offline handling, registration of the issuing software/establishment, and (per the notice) possibly certification. None of that is available to me, and a mistake would affect legal validity. I will not build or simulate it.
3. The safe options are: (a) keep fiscalizing through the Tax Authority portal or a certified provider and record the result's reference in `fiscalRef` (already supported); (b) later integrate with a **certified provider's documented API**, once you choose one and give me its documentation and sandbox.

## 5. Blockers (nothing below was guessed)
| # | Blocker | Needed from you |
|---|---|---|
| B1 | Fiscalization route unknown | Which route you use today (DPT portal, a certified software/provider — name and API docs/sandbox), or confirmation it is not yet set up. Your accountant's confirmation of your obligations (VAT status, B2B/B2C mix). |
| B2 | Official specifications not verified | Official DPT/AKSHI documents (or accountant/provider confirmation). I could not open tatime.gov.al. |
| B3 | Invoice app completeness and deployment | Is the Project copy the current, complete source? Is it deployed anywhere? Export of existing invoices (Settings → Data → Download backup) **stored safely before any change** — this is the only copy of your historical invoices and numbering. |
| B4 | Company legal data | Legal name, address, NUIS, bank/IBAN for consistent company details. I have none and will not invent them. |
| B5 | VAT basis of shop prices | Do shop prices include VAT? Which VAT rates/categories apply to which items? |
| B6 | Staging backend | A staging Supabase project to build and test on (production data/structure must not be touched without approval). |
| B7 | Customer data policy | Whether a shared customer table is wanted (privacy implications; the privacy page is still a draft). |
| B8 | Push access to the repository | Not available in this session (see the main report). |

## 6. Recommended path (each step additive, staging first, approval before production)
1. **Now (no risk): keep the apps separate** and share data by file: the existing shop-product export → invoice catalogue import. Back up the invoicing app's data. Fill company legal data in the app.
2. **Host and secure the invoicing app** behind a login (Supabase Auth, same admin roles) at its own path or sub-domain, unchanged functionally. Add `docs` for access control. (Needs B3, B6.)
3. **Move its data from `localStorage` to Supabase tables** with row-level security — draft model in section 7 — using a **server-side atomic numbering sequence** seeded from the highest existing number so numbering continues without gaps or reuse; migrate existing invoices as frozen records with their original numbers and snapshots; keep JSON backup/export. Do not renumber, do not edit historical invoices. (Needs B3, B4, B5, B6.)
4. **Shared catalogue:** one `catalog` view/table feeding both the shop and invoice picker, with explicit VAT category per item (needs B5). Orders → draft invoice creation only as a *manual, reviewed* action ("Create invoice draft from order"), never automatic issuing.
5. **Fiscalization (after B1/B2):** either record the portal/provider reference in `fiscalRef`, or integrate a **certified provider's API** in a Supabase Edge Function with the certificate/keys in secrets (never in the repo). Invoices may be marked "fiscalized" only when the authority/provider returns the identifiers; until then the system prints "prepared outside a fiscalization system" as it does today.
6. **Monthly reports:** sales from invoices (and orders as a secondary view) are feasible after step 3. **Purchases need a purchase-bill record that does not exist yet** (new feature, to be designed with the accountant).

## 7. Draft data model (sketch for discussion — NOT a migration, not applied anywhere)
`customers(id, kind, name, tax_id, address, city, country, email, phone, created_at)` ·
`invoices(id, number UNIQUE, status, type, currency, issue_date, due_date, seller JSONB snapshot, customer JSONB snapshot, customer_id NULL, order_id NULL, fiscal_ref, notes, payment_terms, issued_at, cancelled_at, cancel_reason, created_by, created_at)` ·
`invoice_items(id, invoice_id, position, name, description, sku, qty_thousandths, unit, unit_price_minor, discount_type, discount_value, vat_bp, catalog_ref NULL)` ·
`invoice_payments(id, invoice_id, date, method, amount_minor, note)` ·
`invoice_numbering(year, prefix, next_value)` advanced by a `SECURITY DEFINER` function inside the same transaction that issues the invoice ·
`purchases(...)` — to be designed. Issued invoices immutable (no update/delete policy; cancellation by status change only); audit trigger on all tables; RLS: admin full, editor/staff per decision.

## 8. What was not done
No code was written for the integration, no production or staging data was read or changed, the invoicing app files were not modified, no invoice numbers were generated, and no claim of legal compliance is made anywhere in the system.
