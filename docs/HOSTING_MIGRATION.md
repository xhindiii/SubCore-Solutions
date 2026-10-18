# Hosting migration: GitHub Pages → Cloudflare (free plan)

Status: **prepared, not executed.** Nothing has been published and no DNS record has been changed.
GitHub stays the source-code home. The current site on GitHub Pages keeps running until you decide otherwise.

---------------------------------------------------------------------------------------------------

## 1. Why GitHub Pages should not stay the production host

What GitHub's own pages say (read on 2026-10-18):

- *About GitHub Pages / Additional Product Terms*: GitHub Pages "is not intended for or allowed to be used as a free web hosting service to run your online business, e-commerce site, or any other website that is primarily directed at either facilitating commercial transactions or providing commercial software as a service (SaaS)."
- *Usage limits*: soft limits of 100 GB bandwidth per month, 1 GB site size, 10 builds per hour. GitHub also says Pages sites "shouldn't be used for sensitive transactions like sending passwords or credit card numbers."
- GitHub Pages cannot send custom HTTP headers (no HSTS, no `frame-ancestors`, no `no-store` on the admin page), and on GitHub Free it needs a **public** repository, so SQL files, notes and tests are world-readable.

How this applies to SubCore: the site is an IT-services business with a shop (cash-on-delivery orders), an admin dashboard and an invoicing tool. That is commercial. It is not a legal opinion, and GitHub has not flagged the site, but the shop and admin are exactly what that clause describes. Moving costs nothing and removes the risk.

Today GitHub Pages also publishes the **whole repository** (tests, docs, SQL migrations, notes). The new setup publishes only the 59 files a browser needs.

## 2. Options compared

| Host | Free plan fit for a commercial site | Verdict |
|---|---|---|
| GitHub Pages (now) | Terms exclude online business / e-commerce / SaaS | Move away |
| Vercel Hobby | Vercel: Hobby is "restricted to non-commercial personal use only"; "advertising the sale of a product or service" counts as commercial | Not allowed. Needs Pro (paid) |
| Netlify Free | 300 credits per month; sites **pause** when the credits run out; I could not confirm a commercial-use statement | Possible, weaker |
| **Cloudflare (Workers static assets / Pages)** | Static file requests are free and unlimited; I found no commercial-use restriction in Cloudflare's service terms | **Chosen** |

Cloudflare also adds free HTTPS, DDoS protection, `_headers` support and DNS. Re-check Cloudflare's terms yourself when you create the account (https://www.cloudflare.com/terms/); terms can change.

## 3. Target architecture

```
Visitor / admin browser
   │ HTTPS
   ▼
Cloudflare (free)  ── serves ONLY dist/ (static files) + security headers
   │                     no server code, no secrets
   │ HTTPS, public anon key, protected by Row Level Security
   ▼
Supabase "SubCore Store" (unchanged)  ── Postgres, Auth, Edge Function send-notifications
   │ secrets live ONLY in Supabase secrets: RESEND_API_KEY, NOTIFY_WEBHOOK_SECRET, NOTIFY_TO, NOTIFY_FROM
   ▼
Resend (e-mail)
GitHub = source code only (can be made private after the move)
```

What does **not** change: Supabase project, database, tables, policies, Edge Function and its secrets, the admin login, the invoice tool, the domain name, every page URL (`about.html` stays `about.html`: `html_handling = "none"`), the Gmail contact address.

Where sensitive data lives:

| Data | Where | In GitHub / public files? |
|---|---|---|
| Orders, customers, inquiries, notification log | Supabase Postgres (RLS) | No |
| Admin passwords / sessions | Supabase Auth | No |
| Invoices made with the invoice tool | The browser of the person using it (local storage); export with Settings → Download backup | No. Keep the downloaded JSON files private, never commit them |
| API keys | Supabase secrets (Resend, webhook secret) | No |
| `SUPABASE_KEY` in `supabase-client.js` | Public **anon** key, public by design. Verified: its role is `anon` | Yes, intentionally |

`scripts/build-static.mjs` fails the build if it finds `service_role`, a Supabase secret key, a Resend key, a private key, or a JWT whose role is not `anon` in anything that would be published.

## 4. What was prepared (all on branch `dev/platform`)

| File | Purpose |
|---|---|
| `scripts/build-static.mjs` | Builds `dist/` with only public files; checks every page reference resolves; scans for secrets |
| `wrangler.jsonc` | Cloudflare config: serve `./dist`, keep exact URLs, real 404 page |
| `hosting/_headers` | HSTS, nosniff, referrer policy, frame protection, permissions policy; admin = `no-store` + `noindex` |
| `scripts/smoke-test.mjs` | Read-only check you run against the preview URL and again after cutover |
| `tests/deploy/emulate-and-smoke.mjs` | Local approximation used to test the smoke test itself |
| `tests/regression/baseline-compare.mjs` | Now also accepts `dist/` (repository-only files such as SQL and notes are expected to be unpublished) |

Tested here: `dist/` passes the full baseline comparison against the original site (184/184: every page, link, asset, form and layout) and the smoke test passes 49/49 against a local approximation. **Not tested here:** Cloudflare itself (the sandbox cannot reach it or install its tools). The preview step below is where the real behaviour is confirmed before anything goes live.

## 5. Step by step (about 45 minutes, no downtime)

### A. Before you start (5 min)
1. Find where the domain `subcoresolutions.online` is registered and log in (the registrar's DNS page).
2. Write down or screenshot **every** DNS record shown (type, name, value), and the current nameservers. This is your rollback sheet. Pay special attention to MX and TXT records (e-mail); GitHub Pages usually shows 4 `A` records (185.199.108–111.153) and a `www` CNAME.
3. If the registrar shows **DNSSEC** enabled, note it (it must be switched off before the nameserver change).

### B. Put the new files on `main` (3 min)
4. Open https://github.com/xhindiii/SubCore-Solutions/compare/main...dev/platform → **Create pull request** → **Merge pull request**.
   This also publishes the "delete order" admin feature on the current live site. The hosting files are inert there (they are just extra files). Wait 1–2 minutes and check https://subcoresolutions.online still loads.

### C. Create the Cloudflare site, preview only (15 min)
5. Create a free account at https://dash.cloudflare.com/sign-up (use `info.subcoresolutions@gmail.com`, turn on two-factor authentication).
6. **Workers & Pages → Create → Import a repository** (Git; button names may differ slightly). Authorize GitHub, pick `xhindiii/SubCore-Solutions`.
7. Settings on that screen:
   - Project / Worker name: `subcore-solutions` (must equal `name` in `wrangler.jsonc`)
   - Production branch: `main`
   - Root directory: leave empty (`/`)
   - Build command: `node scripts/build-static.mjs`
   - Deploy command: `npx wrangler deploy`
   - Environment variables: **none needed**. Do not add any keys.
8. **Save and Deploy.** When it finishes you get an address like `https://subcore-solutions.<your-account>.workers.dev`. This is the preview; the real domain is untouched.
9. Open it and check: home page, Shop, a product, add to cart, Contact, Projects, Services, `admin.html` login, a 404 (add `/nothing.html` to the address: you should get the site's "page not found" page).
10. Optional but recommended (needs Node.js 18+ on your computer): download the repository, run `node scripts/build-static.mjs`, then `node scripts/smoke-test.mjs https://subcore-solutions.<your-account>.workers.dev`. Every line must say PASS. Or send me the preview address and I will review the pages I can reach.
11. Test an order end to end on the preview (it uses the real Supabase, so it creates a real test order): place one, confirm it appears in admin, then cancel and delete it with the new Delete button.

If anything fails in C: nothing public changed. Fix, redeploy, or stop.

### D. Move the domain (the only step that affects visitors) (15 min + waiting)
Do this only after you tell me / yourself "go". Pick a quiet hour.
12. In Cloudflare: **Domains → Onboard a domain** → `subcoresolutions.online` → Free plan. Let it scan existing records.
13. **Compare Cloudflare's imported records with your rollback sheet from step 2.** Add anything missing (especially MX and TXT records). Cloudflare says the scan is not guaranteed to find everything.
14. If DNSSEC was on at the registrar, turn it off there first.
15. Delete the records that point to GitHub Pages in Cloudflare's DNS list (the 4 GitHub `A` records for the root, and any `CNAME` on the root or `www` pointing to `*.github.io`). Cloudflare will not attach a Custom Domain to a name that already has a CNAME.
16. At the registrar, replace the nameservers with the two Cloudflare gave you. Wait until Cloudflare shows the domain as **Active** (minutes to 24 h; the old site keeps working while you wait).
17. In Cloudflare **Workers & Pages → subcore-solutions → Settings → Domains & Routes → Add → Custom Domain**: add `subcoresolutions.online`, then `www.subcoresolutions.online` (optional: add a free Redirect Rule from `www` to the root name).
18. Run the smoke test again against `https://subcoresolutions.online` and click through the site, shop, admin login and one test order.
19. In Supabase → Authentication → URL Configuration, confirm the Site URL is still `https://subcoresolutions.online` (no change expected).

### E. Clean up (only after 7–14 quiet days)
20. GitHub repo → Settings → Pages → **Unpublish site** and remove the custom domain there (prevents anyone else claiming the domain through GitHub).
21. Optionally make the repository private (Settings → General → Danger Zone). Cloudflare's Git integration supports private repositories (confirm on its connect screen). Do this only after step 20, because Pages on a free private repo stops working, which would remove your rollback.
22. Optionally delete the `CNAME` file from the repo in a later change.

## 6. Rollback plan

| When | What to do | Time |
|---|---|---|
| Problem on the preview (before D) | Nothing to undo. Stop or fix | none |
| Problem after the nameserver change (D), site down or wrong | At the registrar put the **old nameservers** back (from step 2). GitHub Pages is still enabled and `CNAME` still in the repo, so the old site returns as DNS refreshes | minutes to a few hours |
| Missing e-mail or other DNS record | Re-create it in Cloudflare DNS from your rollback sheet | minutes |
| Bad site content after a deploy | Cloudflare → Worker → **Deployments / Version history → Rollback** to the previous version; or revert the commit on `main` | 1–2 min |
| Bad code on `main` | `git revert <commit>` (or restore tag `pre-hosting-migration`, see below); Cloudflare redeploys automatically | 2–3 min |
| Need the original project as it was before all this work | Tag `baseline-2026-10-18` (commit `4f42788`) | n/a |

Do not step 20 or 21 until you are sure; they are what makes the old path unavailable.

## 7. What stays your responsibility (limits of the free setup)

- Supabase **Free** has no automatic backups and pauses after 1 week of inactivity. Supabase markets Free for hobby projects and Pro for production. To keep it free: log in to admin at least weekly and use Settings → Download backup; store those files privately. The paid fix is Pro (daily backups, no pausing). See `DATABASE_AND_BACKUPS.md`.
- E-mail sending uses Resend's free test sender, which only delivers to the Resend account's own address. Delivering to arbitrary customers needs a verified domain (free on Resend) and DNS records, which would be added in Cloudflare DNS after step 16.
- Fiscalization and legal pages remain out of scope by your decision.
- I could not read your current DNS records or reach Cloudflare from this environment, so steps 2, 13 and 16 rely on you comparing the records.
- Cloudflare's free build allowance for Workers Builds: I could not confirm the exact number from the documentation I could reach. The build takes about a second, so it should not matter. If builds are ever unavailable, run `node scripts/build-static.mjs` then `npx wrangler deploy` from any computer, or upload the `dist` folder with Cloudflare Pages "Direct upload" (note: Pages redirects `about.html` to `/about`).

## 8. Quick reference

```
node scripts/build-static.mjs                         # build dist/ (also the Cloudflare build command)
node tests/deploy/emulate-and-smoke.mjs               # local approximation test
node scripts/smoke-test.mjs https://<url>             # real check of preview or production
git tag pre-hosting-migration                         # recoverable copy of main before the move
```

Sources:
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub Additional Product Terms (Pages): https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-pages
- Vercel fair use / commercial usage: https://vercel.com/docs/limits/fair-use-guidelines
- Netlify pricing: https://www.netlify.com/pricing/
- Cloudflare: static asset billing https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ · HTML handling https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/ · headers https://developers.cloudflare.com/workers/static-assets/headers/ · custom domains https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ · zone setup https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/ · terms https://www.cloudflare.com/terms/
- Supabase pricing: https://supabase.com/pricing
