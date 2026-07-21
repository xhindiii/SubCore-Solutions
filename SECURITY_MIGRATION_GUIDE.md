# SubCore Solutions — Security Fix & Migration Guide

This explains exactly what changed, why, and the steps **you** need to do in
the Supabase dashboard (I can't do these for you — they touch your live
account and database).

## Why this was urgent

Your old `supabase-schema.sql` had RLS policies like:

```sql
CREATE POLICY "Admin upsert products" ON products FOR ALL USING (true);
```

`USING (true)` on `FOR ALL` means anyone with your public anon key — which
is visible to every visitor in `supabase-client.js` — could insert, update,
or delete products, services, orders, and site settings directly via the
Supabase REST API. The admin login screen never actually gated this; it just
set a value in `sessionStorage`; it didn't and couldn't restrict what the
database itself allowed.

On top of that, the default admin password (`Localadmin!`) was hardcoded in
the schema file, and the change-password feature in the admin panel was a
stub that didn't do anything.

## What changed in the code (already done)

| File | Change |
|---|---|
| `supabase-schema-v2-SECURITY-FIX.sql` | New migration. Links `admin_users` to real Supabase Auth, replaces every `USING (true)` admin policy with a real `is_admin()` check, locks `orders` to admin-only read/update, drops the old password RPC. |
| `supabase-client.js` | Rewritten to use the `supabase-js` SDK and `signInWithPassword()` instead of a custom RPC. Session handling (refresh, persistence) is now handled by Supabase itself, not a 30-minute `sessionStorage` timer. |
| `admin.js` | Auth functions now reflect a real Supabase Auth session. "Change password" actually works now. |
| All pages that load `supabase-client.js` | Added the `supabase-js` CDN script tag before it. |
| `shop-pages.js`, `shop-core.js` | Added a real `escapeHtml()` helper and applied it to product/category names, descriptions, and image URLs before they're inserted into the page — closes a stored-XSS hole that was especially dangerous combined with the open write access above. |

## Steps you need to do (in order)

### 1. Run the new SQL migration
In the Supabase dashboard → SQL Editor, run `supabase-schema-v2-SECURITY-FIX.sql`.
It's safe to run once; re-running it is also safe (it uses `IF NOT EXISTS` /
`DROP ... IF EXISTS` throughout).

### 2. Create a real admin login

**⚠️ Before you do this:** the request was to configure the account with
email `info.subcoresolutions@gmail.com` and password `Localadmin!`. That's
fine to set up functionally — the steps below do it — but flagging clearly:
this exact password was the **hardcoded default in the original, public
`supabase-schema.sql`** (see the warning banner now at the top of that
file). If this repo has ever been pushed to a public GitHub repo (the
`CNAME` / `LICENSE` / Pages setup suggests it has), that password is in the
commit history and effectively public no matter what you do to the live
account now. It'll work, but anyone who finds that repo history has your
admin password. Strongly recommend changing it right after your first
successful login — the in-panel "Change Password" form now actually works.

Go to **Authentication → Users → Add user** and create:
- Email: `info.subcoresolutions@gmail.com`
- Password: `Localadmin!` (or, better, a fresh password only you know)
- Leave "Auto Confirm User" checked so no email-verification step blocks login.

### 3. Link that new auth user to your admin profile
Copy the new user's UUID from the Authentication tab, then in the SQL Editor:

```sql
UPDATE admin_users
SET auth_user_id = '<paste-the-new-auth-user-uuid-here>'
WHERE email = 'info.subcoresolutions@gmail.com';
```

### 4. Deploy the updated files
Replace the old `supabase-client.js`, `admin.js`, `shop-core.js`,
`shop-pages.js`, and all the `.html` files with the versions in this
package.

### 5. (Recommended) Rotate your anon/publishable key
Settings → API → regenerate the anon key, then update `SUPABASE_URL` /
`SUPABASE_KEY` in `supabase-client.js` if it changes. Anon keys are *meant*
to be public — this step isn't strictly required once RLS is fixed — but
since this specific key has been sitting in a public repo with full write
access, it's a clean, cheap precaution.

### 6. Test before trusting it
- Log into `/admin.html` with the new credentials — should work.
- Log out, then in a private/incognito window, open dev tools and try
  calling the Supabase REST API directly for a write (e.g. a PATCH to
  `/rest/v1/products`) using the public anon key with no auth token — it
  should now be **rejected**.
- Place a test order through the storefront as a normal (logged-out) visitor
  — this should still work, since public checkout inserts are still allowed.

## Everything else from the audit (SEO/performance, done in this pass)

- Removed the render-blocking `@import` font load; replaced with a proper
  `<link rel="stylesheet">` + `preconnect`.
- Added `defer` to every script tag site-wide.
- Added `robots.txt`, `sitemap.xml`, `LocalBusiness` structured data on the
  homepage, missing canonical tags, and `noindex` on cart/checkout.
- Per-product dynamic `<title>`, meta description, and canonical URL on the
  product page.

## Still open (not done in this pass, listed honestly)

- Admin dashboard's own `innerHTML` templates (`admin.js`) don't yet use
  `escapeHtml()` — lower risk since it's the authenticated admin viewing
  their own data, but worth doing for defense in depth.
- No full visual/responsive UI redesign or cross-browser QA pass yet.
- Product images going through `admin.js`'s base64 upload rather than
  Supabase Storage — works, but bloats the DB and slows catalog loads as you
  add more products. Worth migrating to Storage once you have a moment.
