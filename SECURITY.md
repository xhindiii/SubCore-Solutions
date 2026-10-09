# Security notes — SubCore Solutions

Last reviewed: 9 Oct 2026. Scope: this repository (static site + Supabase). Nothing here was tested against the live production database.

## What protects the data

| Layer | How |
|---|---|
| Public site | Only the Supabase **anon** key is in the browser (verified: the token's role is `anon`). It can only do what Row Level Security (RLS) allows. |
| Orders | Checkout calls `place_order()`: stock and prices are re-checked on the server, totals are computed there. Visitors cannot read or insert orders directly. |
| Enquiries | Visitors can insert only (length-limited, status `new`); only staff/admin can read. |
| Admin | Supabase Auth login + `admin_users` row. v4 adds roles (admin / editor / staff) enforced by RLS, an append-only `audit_log`, and a guard so the last admin cannot be removed. |
| Browser | Content-Security-Policy meta tag on every page (scripts only from this site and jsdelivr, connections only to Supabase, no plugins, no foreign forms); `referrer` policy; admin page is `noindex`. Output from the database is HTML-escaped before it is shown; CSV exports neutralise spreadsheet formulas. |

## Findings from the audit

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | The original schema file seeded an admin account with a **fixed, published password** (still visible in git history). | Seed removed; file moved to `legacy/` and marked DO-NOT-RUN. The password remains in history, so treat it as public: **it must not be used for any account** (see actions). |
| 2 | Medium | Every admin could do everything (no least-privilege). | Fixed in v4 (roles + RLS). |
| 3 | Medium | No record of who changed what. | Fixed in v4 (`audit_log`, trigger-written, admin-read-only). |
| 4 | Low | No Content-Security-Policy. | Added as a meta tag (GitHub Pages cannot send headers). `frame-ancestors`, HSTS and `X-Content-Type-Options` cannot be set from a meta tag; put Cloudflare (free) in front of the domain to add them. |
| 5 | Low | `supabase-js` loaded from a CDN without Subresource Integrity. | **Not changed.** The sandbox used for this work could not download the file to compute a trustworthy hash, and a guessed hash would break the site. To add it: `curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js \| openssl dgst -sha384 -binary \| openssl base64 -A`, then add `integrity="sha384-…" crossorigin="anonymous"` to the `<script>` tag on every page (`gen.py` head/foot and `admin.html`). Self-hosting the file removes the CDN from the trust chain entirely. |
| 6 | Info | Public read on `products` returns hidden items too (`available=false`). Storefront code filters them; prices of hidden items are not secret. | Accepted; change the policy to `available OR is_admin()` if hidden products must be private. |
| 7 | Info | No secrets, private keys or service-role tokens found in the working tree or in the 5 commits of history (pattern scan; the only token found is the public anon key). | OK |
| 8 | Info | Dependency scan: the only third-party runtime code is `supabase-js 2.45.4` (CDN). `npm audit` is not applicable (no `package.json`), and the registry was not reachable from the sandbox to compare with the latest release. | Check https://github.com/supabase/supabase-js/releases and bump the version in the script URL when convenient. |

## Actions for the site owner

1. **Make sure no account uses the old default password.** In Supabase → Authentication → Users, reset the password of `info.subcoresolutions@gmail.com` to a new long unique one (a password manager is ideal) and turn on MFA for the Supabase dashboard login.
2. Run `supabase-migration-v4-security.sql` (after a backup). Then open **Admin → Team** and confirm you are listed as *Admin*.
3. In Supabase → Authentication → Settings: enable leaked-password protection, set a minimum password length ≥ 10, keep email confirmations on, and review the rate limits.
4. Optional but recommended: put the domain behind Cloudflare (free) for security headers, and add a CAPTCHA (Cloudflare Turnstile) to the quote/contact forms if spam appears.
5. Rewriting git history to erase the old password is possible but disruptive and **was not done**; because the password must be treated as public anyway, rotation (step 1) is the real fix.

## Reporting

Email info@subcoresolutions.online.
