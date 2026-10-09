# SubCore Solutions

Website and online shop for SubCore Solutions (IT services, Albania). Plain HTML, CSS and JavaScript on GitHub Pages, with Supabase for the database, login and product photos. Albanian by default, English with the SQ/EN switch.

## Pages

| Page | File |
|---|---|
| Home | `index.html` |
| Services (with FAQ and request form) | `services.html` |
| Shop with filters | `shop.html` |
| Product | `product.html?id=…` |
| Cart and checkout (pay on delivery) | `cart.html`, `checkout.html` |
| Request IT support / quote / consultation / site visit / product question | `quote.html` |
| Students, About, Contact, FAQ | `students.html`, `about.html`, `contact.html`, `faq.html` |
| Privacy & cookies, Terms, Delivery/returns/warranty | `privacy.html`, `terms.html`, `shipping-returns.html` |
| Admin panel | `admin.html` |

## One-time setup (about 10 minutes)

1. In Supabase, open **SQL Editor** and run `supabase-schema-fresh-install.sql` (new project) — or, if the tables already exist, run `supabase-migration-v3-store.sql` only. Both are safe to re-run.
2. Run `supabase-migration-v3-store.sql` (skip only if it already ran). It adds brand, SKU, sale price, extra photos and specifications to products, order numbers, stock checks at checkout, the enquiries table and the `product-images` bucket.
3. **Authentication → Users → Add user**: create your admin login with a strong password.
4. Link it to the admin profile (SQL Editor):
   ```sql
   UPDATE admin_users SET auth_user_id = '<user id from step 3>' WHERE email = 'info.subcoresolutions@gmail.com';
   ```
5. Run `supabase-migration-v4-security.sql` — roles (admin / editor / staff), the activity log, the last-admin guard and role-based database rules. Back up first (see **Backups**). To undo it: `supabase-migration-v4-ROLLBACK.sql`.
6. Open `/admin.html` on your site and sign in.

Order of the SQL files for a new project: `supabase-schema-fresh-install.sql` → `supabase-migration-v3-store.sql` → `supabase-migration-v4-security.sql`. Everything in `legacy/` is kept only for reference and must not be run.

## Using the admin panel

- **Products** — Add product: names and descriptions in both languages (one is enough, the other is copied), photos (upload or paste a link, first one is the main photo), price, optional old price, stock, category, brand, SKU, specifications. Stock, Visible and Featured can be changed directly in the list. Duplicate saves time for similar items.
- **Categories** — become the category filter in the shop. Brands, price range, availability and sale filters are built automatically from your products.
- **Orders** — every checkout arrives with a number like `SC-000012`. Call or WhatsApp the customer, set the status. Cancelling an order puts the items back in stock.
- **Enquiries** — contact-form messages and "Request this service" submissions.
- **Services** — optional. If you add services here they replace the built-in list on the site.
- **Team** (admin) — add people and choose a role. *Admin*: everything. *Editor*: products, categories, services. *Staff*: orders and enquiries. Create the person's login in Supabase → Authentication → Users first, then add the same email here. The last admin cannot be removed or demoted.
- **Activity** (admin) — who changed what and when (customer details are not copied into the log).
- Lists have search, filters, sorting (products) and pages of 20; **Export CSV** on Products, Orders, Enquiries and Activity.
- **Settings** — delivery fee and free-delivery threshold, change password, JSON backup.

Products that are hidden or have no stock are never ordered; the server re-checks stock and takes prices from the database, not from the visitor's browser.

## Editing text

Page copy lives in `translations.js` and `translations-extra.js` (both languages). Prices, phone and WhatsApp number: `WHATSAPP_NUMBER` at the top of `shop-core.js`.

## Security notes

- The key in `supabase-client.js` is the public anon key. What protects the data is Row Level Security (see the SQL files). Only a signed-in admin can change products, orders, services and settings.
- If the old admin password (the old default) was ever used, change it — it was public in the repository history.
- Never put the Supabase `service_role` key in this repository.
- More detail, the audit findings and what to rotate: see `SECURITY.md`.

## Backups

- Supabase → Database → Backups (daily on paid plans). On the free plan run `pg_dump` yourself, or use **Settings → Download backup** for products, categories and services (JSON), and **Export CSV** for orders and enquiries.
- Take a backup before running any migration. Each migration has a rollback note or file.
- Product photos live in the `product-images` storage bucket; download them from Supabase → Storage if you need a copy.

## Brand

Palette is derived from the supplied logo: slate `#18252d` (logo background), `#1e2f38`, muted blue-grey `#78909a` (logo subtitle), soft cyan `#7eb8c9` as accent, teal `#176f86` for buttons on light pages. The logo is the original artwork supplied by the owner (`brand/logo-original.png`); `logo.png`/`logo-1x.png` are transparent crops of it for dark surfaces, `icon-*.png`/`favicon.*` use its "S" glyph. `logo.svg` is the legacy text-based file and is not used by the pages. Decorative network/circuit backgrounds are in `img/`.

## Before launch

The privacy, terms and delivery/returns pages are practical drafts based on how the site works. Have them reviewed (and add your company registration details) before publishing.
