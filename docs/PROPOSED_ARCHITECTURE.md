# Proposed architecture — backend, database, storage, security (Phase 8)

Status: **recommendation only.** No new service has been chosen or created, no production data was touched, no migration was run.
Anything marked **[APPROVAL]** needs the owner's decision before it happens.

## 1. What exists today
- Public site: static HTML/CSS/vanilla JS on GitHub Pages (domain `subcoresolutions.online`).
- Backend: one Supabase project, "SubCore Store" (eu-west-1, Postgres 17), **Free plan**. Only project in the organisation: there is no staging project and no branch.
- Database: 90 products, 14 categories, 2 orders, 1 admin, 141 audit rows (read-only look on 2026-10-18). RLS is on for every table; roles admin / editor / staff; checkout goes through the `place_order()` function.
- Auth: Supabase Auth (email + password). Storage: public bucket `product-images`.
- No Edge Functions deployed, no migration history recorded (SQL files were run by hand).
- Invoice generator: separate, browser-only app (data in the browser's localStorage). Not connected to the website. See `docs/PHASE5-INVOICING-INTEGRATION.md`.

## 2. Options compared
| Option | Fits existing tech | Migration of production data | Recurring cost (approx., verify) | Maintenance burden | Verdict |
|---|---|---|---|---|---|
| **A. Stay on Supabase** (add a staging project, migrations in git, Edge Functions for server work) | Yes — everything already uses it; all new phases (v5–v7, notification function) are written for it | **None** | Free: $0 but **no automatic backups** and projects pause after a week of inactivity. Pro: from $25/month incl. daily backups kept 7 days; PITR add-on $100/month | Low (managed) | **Recommended** |
| B. Firebase / Firestore | No — rewrite of every query, RLS rules → security rules, SQL reports lost | Yes, full | Pay-as-you-go | Medium | Not recommended: forces a rewrite |
| C. Self-hosted VPS (Node + Postgres + object storage) | No — auth, API, storage, TLS, patching all have to be built and run by you | Yes, full | VPS ≈ $5–20/month + your time | **High** (security patches, backups, uptime are yours) | Not recommended for one person |
| D. Cloudflare Workers + D1/R2 | Partly (Workers could host the email function) | Yes, full (D1 is SQLite, not Postgres) | Free tier then low | Medium | Not for the database. Cloudflare **is** recommended in front of the domain (section 5) |

Reasons for A: zero data migration, RLS already designed and tested (354-cell matrix), the admin panel, notifications, portfolio, promo and reports code all target it. Switching would add risk and cost without a requirement that Supabase cannot meet.

**[APPROVAL] Decision requested:** confirm Supabase stays the backend. The plan upgrade and a second project are separate decisions (section 4).

## 3. Requirement-by-requirement
| Requirement | How it is met | State |
|---|---|---|
| Secure admin authentication | Supabase Auth; admin login linked through `admin_users`. Owner actions: rotate the old default password (it is in git history), turn on MFA for the Supabase dashboard, enable leaked-password protection, min password length ≥ 10 | Code done; **owner actions open** (`SECURITY.md`) |
| Server-side authorization | RLS + `has_admin_role()`; roles enforced in the database, not the browser. Verified by `tests/security/rls-matrix.sql` (anon / signed-in-no-role / staff / editor / admin × 15 tables/buckets × 4 operations + function privileges) | Done (v4–v7) |
| Persistent database storage | Postgres on Supabase | Done |
| Secure file uploads | Storage buckets `product-images`, `portfolio-images`: admin/editor write only, MIME and size limits in the bucket, validated client-side too | Done (v3, v6) |
| Common web vulnerabilities | Output escaping everywhere, CSP meta tag on every page, CSV formula neutralising, honeypot on forms, length-limited public inserts, no `innerHTML` from raw data. Missing: real HTTP headers (GitHub Pages cannot send them) → Cloudflare | Mostly done |
| Secret management | Only the public anon key is in the repo (scan clean). Email key, webhook secret, recipient live in Supabase function secrets, never in files. Service-role key is never used by the website | Done by design; secrets not yet created |
| HTTPS | GitHub Pages serves HTTPS on the custom domain (enforce-HTTPS setting to be confirmed in the repo settings — not verifiable from here); Supabase is HTTPS only | Confirm setting |
| Backup and restore | See `docs/DATABASE_AND_BACKUPS.md`. **Free plan has no automatic backups** | **Gap — needs decision** |
| Safe migrations | Numbered, idempotent SQL files, each with a ROLLBACK file; each replayed on a throwaway database (apply, re-run, rollback, re-apply) | Done; apply order on staging first |
| Separate dev / production | Needs a **second Supabase project** (staging). The Free plan allows 2 active projects | **[APPROVAL]** to create |
| No privileged keys in public files | Verified by scan of all `*.html/*.js` outside tests | Done |
| No unnecessary exposure of customer / invoice / purchasing data | See section 6 | Reviewed |

## 4. Environments and cost decision
- **Production**: current project. Do not experiment on it.
- **Staging**: a second Supabase project (free) — run v4→v7 there, deploy the email function in dry-run, run the manual checks in `docs/DEPLOYMENT.md`. Alternative: Supabase branching, but it needs the Pro plan.
- **Local**: throwaway PostgreSQL with `tests/notifications/sql/harness.sql` (already used by every SQL test).
- **Cost options** (owner picks): (1) stay Free and run the scheduled `pg_dump` described in `DATABASE_AND_BACKUPS.md` — $0 but you own the backups and the pause-after-inactivity risk; (2) **Pro from $25/month** — daily backups (7 days), no pausing, more storage; recommended once real customers order. PITR ($100/month) is not justified for this volume.
- Prices above come from https://supabase.com/pricing.md as read on 2026-10-18; confirm before deciding.

## 5. Edge protection (optional, recommended)
Cloudflare (free) in front of the domain adds HSTS, `X-Content-Type-Options`, `frame-ancestors`, a WAF and Turnstile (CAPTCHA) for forms. Changing DNS/name servers touches the domain configuration → **[APPROVAL]**, and must be done outside business hours with the rollback in `DEPLOYMENT.md`.

## 6. Data exposure review
| Data | Who can read | Notes |
|---|---|---|
| Products, categories, public settings, published projects, services | Everyone (intended) | Hidden products (`available=false`) are also readable through the API — accepted finding, prices are not secret |
| Orders (name, phone, address) | admin, staff | anon/editor: 0 rows (tested) |
| Inquiries | admin, staff | |
| Notification log | admin | holds no customer data |
| Audit log | admin | append-only, customer data not copied |
| Purchase ledger (suppliers, amounts) | **admin only** | no DELETE (void instead) |
| Promo templates | admin, editor | |
| Invoices | **not in the cloud at all** | stay in the invoice app's browser storage; reports import a backup file in memory only |
| Email content | recipient only | address and notes deliberately not e-mailed |

Live Supabase advisor warnings (2026-10-18, read-only): `audit_pick` has a mutable search_path; `anon` can execute SECURITY DEFINER helpers (`admin_role`, `has_admin_role`, `guard_last_admin`, `orders_restock`, `place_order`); `authenticated` can also execute `admin_add_member`, `is_admin`; leaked-password protection is off. `place_order` is intended. The others return only a role name or are trigger functions; but **revoking EXECUTE blindly can break RLS** (policies call `has_admin_role` as the visitor). A hardening migration was therefore **not written**; it should be designed and tested on staging first (listed in `IMPLEMENTATION_PLAN.md`).

## 7. What was deliberately not done
No service created, no plan changed, no data migrated, no function deployed, no secret created.
