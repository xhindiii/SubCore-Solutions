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
2. If you did not run the fresh-install file, also run `supabase-migration-v3-store.sql` now. It adds brand, SKU, sale price, extra photos and specifications to products, order numbers, stock checks at checkout, the enquiries table and the `product-images` bucket.
3. **Authentication → Users → Add user**: create your admin login with a strong password.
4. Link it to the admin profile (SQL Editor):
   ```sql
   UPDATE admin_users SET auth_user_id = '<user id from step 3>' WHERE email = 'info.subcoresolutions@gmail.com';
   ```
5. Open `/admin.html` on your site and sign in.

## Using the admin panel

- **Products** — Add product: names and descriptions in both languages (one is enough, the other is copied), photos (upload or paste a link, first one is the main photo), price, optional old price, stock, category, brand, SKU, specifications. Stock, Visible and Featured can be changed directly in the list. Duplicate saves time for similar items.
- **Categories** — become the category filter in the shop. Brands, price range, availability and sale filters are built automatically from your products.
- **Orders** — every checkout arrives with a number like `SC-000012`. Call or WhatsApp the customer, set the status. Cancelling an order puts the items back in stock.
- **Enquiries** — contact-form messages and "Request this service" submissions.
- **Services** — optional. If you add services here they replace the built-in list on the site.
- **Settings** — delivery fee and free-delivery threshold, change password, JSON backup.

Products that are hidden or have no stock are never ordered; the server re-checks stock and takes prices from the database, not from the visitor's browser.

## Editing text

Page copy lives in `translations.js` and `translations-extra.js` (both languages). Prices, phone and WhatsApp number: `WHATSAPP_NUMBER` at the top of `shop-core.js`.

## Security notes

- The key in `supabase-client.js` is the public anon key. What protects the data is Row Level Security (see the SQL files). Only a signed-in admin can change products, orders, services and settings.
- If the old admin password (`Localadmin!`) was ever used, change it — it was public in the repository history.
- Never put the Supabase `service_role` key in this repository.

## Brand

Palette is derived from the supplied logo: slate `#18252d` (logo background), `#1e2f38`, muted blue-grey `#78909a` (logo subtitle), soft cyan `#7eb8c9` as accent, teal `#176f86` for buttons on light pages. The logo is the original artwork supplied by the owner (`brand/logo-original.png`); `logo.png`/`logo-1x.png` are transparent crops of it for dark surfaces, `icon-*.png`/`favicon.*` use its "S" glyph. `logo.svg` is the legacy text-based file and is not used by the pages. Decorative network/circuit backgrounds are in `img/`.

## Before launch

The privacy, terms and delivery/returns pages are practical drafts based on how the site works. Have them reviewed (and add your company registration details) before publishing.
