# Promo graphics generator (Admin → Promo graphics)

Makes ready-to-post adverts from your shop products. Everything is drawn from the design you see, at full resolution, into a real
**PNG, JPG or PDF file** (not a screenshot of the dashboard).

Who can use it: **admin** and **editor**. Staff cannot see it.

## Workflow
1. **Product** – pick one; its name, description, price, previous (compare) price, currency and photo are *copied* into the advert.
   Or leave it empty and type everything.
2. **Image** – "Upload image" / "Replace image" (JPEG, PNG or WebP, up to 5 MB; checked by file signature, not file name), or
   "Use product photo". Uploaded images stay in your browser and are used only for the export — they are not uploaded or saved.
3. **Text and price** – title, description, **advertised price**, optional **previous price**, optional **offer text** (for example
   "Buy 2, get 1 free"), currency (ALL/EUR/USD/GBP), advert language (Shqip/English).
4. **Template** – four built-in templates (Classic, Dark & Bold, Image Impact, Clean Print) plus your own saved ones.
5. **Format** – Instagram square (1080×1080) and portrait (1080×1350), Story / WhatsApp status (1080×1920, keeps the top and bottom
   10% free of text), Facebook post (1200×630), WhatsApp sharing (1200×900), print A4 portrait/landscape and A5 (300 dpi).
6. **Export** – PNG, JPG or PDF. The PDF page is the exact paper size for print formats (A4 = 210×297 mm); its content is the artwork
   as one image, so text in it is not selectable.

## The advertised price never changes anything else
The price, previous price and offer exist only inside the advert. This page has **no code path that writes to products, services,
orders or invoices** (automated tests export adverts and then assert that no write reached those tables, and that the catalogue
price is unchanged). If the advertised price differs from the catalogue price the page says so.
A discount badge ("-15%") is only drawn when the previous price is genuinely higher than the advertised price.

## Templates
Every setting is editable: layout (image on top / beside text / full-photo overlay), alignment, background (solid or gradient), colours,
fonts, text sizes, image fit/shape/frame/shadow/size/position, badge, price style, call-to-action text, logo and which contact lines
are shown (phone, e-mail, website, Instagram). Branding comes from the company details already on the website (logo, phone,
`info.subcoresolutions@gmail.com`, subcoresolutions.online, @subcore_solutions).
The brand logo is white lettering, so it is placed on a dark chip automatically when the background is light.

* Built-in templates are fixed; change settings, then **Save as new template**.
* Saved templates need `supabase-migration-v7-promo-reports.sql` (table `promo_templates`; undo with
  `supabase-migration-v7-ROLLBACK.sql`). Without it the four built-in templates still work and the page says so.
* A saved template contains look-and-feel only — never a product, a price or an image. Size is capped at 8 KB in the database.

## Technical notes
* `promo-render.js` – pure engine (spec sanitizer, price parsing, canvas drawing, PDF writer). No network, no Supabase.
* `admin-promo.js` – the screen. Only database access: read/save/delete rows of `promo_templates`.
* A product photo hosted on another domain can taint the canvas and block export; if that happens the page asks you to upload a copy.
  Photos from your own Supabase storage or the website are fine.
* Tests: `node --test tests/promo/` (engine, with a recording fake canvas) and
  `node tests/promo/admin.e2e.mjs` (real Chromium; validates the exported PNG/JPG/PDF with Pillow and poppler: signature, exact pixel
  size, A4 page size, embedded 2480×3508 image, rendering).

## Known limits
* Fonts are system fonts (sans-serif, serif, rounded, monospace) so exports look the same on every computer without external font files.
* One product per advert. No bleed/crop marks for professional printers (use the A4/A5 PDF for office printing).
* No background removal or photo editing; use a clean product photo.
