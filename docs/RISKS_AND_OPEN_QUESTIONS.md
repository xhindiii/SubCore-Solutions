# Risks and open questions

## Open questions for the owner
1. Push access: can the assistant be authorised for `xhindiii/subcore-solutions`, or will you push the bundle?
2. Create a free staging Supabase project? (needed for any safe test of v5–v7)
3. Backups: upgrade to Pro (from $25/month) or run the scheduled `pg_dump` yourself?
4. E-mail provider: Resend assumed (needs a verified sending domain you own; Gmail cannot be the sender).
5. Are the 2 existing orders tests (to exclude from reports)?
6. Fiscalization: which route — certified third-party software/service, or direct integration with the tax authority's test process? Who is the contact?
7. Is the invoice app complete and where will it be hosted? Where does it export backups?
8. Are shop prices VAT-inclusive?
9. Company legal data (registration number, address) for the legal pages.
10. OK to put Cloudflare in front of the domain? **Now also required by hosting terms:** GitHub Pages may not host an online business/shop; plan in `HOSTING_MIGRATION.md`. Needs your go-ahead before the DNS step.

## Risks
| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Hosting on GitHub Pages conflicts with GitHub's terms for online businesses/e-commerce | Site could be unpublished by GitHub | Low-Medium | Move to Cloudflare (prepared; do not remove GitHub Pages until verified) |
| DNS move drops a record (e.g. MX/TXT) | Mail or subdomain breaks | Medium | Compare Cloudflare's imported records with the saved list before switching nameservers |
| No automatic backups (Free plan) | Total data loss if the project is deleted/corrupted | Medium | Decide #3 now; manual dump before anything else |
| Project pauses after a week of inactivity (Free) | Shop and checkout stop working | Medium | Pro plan or keepalive/activity |
| Old admin password public in history | Account takeover | Medium until rotated | Rotate + MFA |
| Migrations never run on a real project | Surprise at go-live | Medium | Staging first (plan step 3) |
| Edge Function wiring untested (Deno + Resend) | No order e-mails | Medium | Staging dry-run, one real send |
| RLS helper functions executable by `anon` | Information leak of a role name only | Low | Hardening designed on staging; blind revokes could break RLS |
| Hidden products readable via API | Prices of hidden items exposed | Low | Accepted or change the policy |
| Invoice data lives only in a browser | Loss with the browser profile | Medium | Regular invoice-app backups; decide on a server store with fiscalization |
| Fiscalization not implemented | Invoices cannot be legally fiscal | Certain today | Phase 5 document; do not issue fiscal invoices from this tool |
| Tested on Chromium only | Browser-specific bugs | Low–Medium | Manual check on Safari/Firefox/mobile before release |
| `supabase-js` from a CDN without SRI | Supply-chain risk | Low | Self-host or add SRI |
| No payment system | Orders are never "paid"; reports show ordered, not received | By design | Add a provider before using paid statuses |
