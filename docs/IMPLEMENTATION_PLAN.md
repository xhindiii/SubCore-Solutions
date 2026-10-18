# Implementation plan — from the dev branch to production

Nothing below happens without the owner's explicit approval at each gate. The live site stays untouched until Gate 4.

| Step | Action | Owner decision / gate | Rollback |
|---|---|---|---|
| 0 | Get the branch to GitHub: push `dev/platform` (assistant has no access) or apply the supplied bundle: `git fetch subcore-dev-platform.bundle dev/platform:dev/platform && git push origin dev/platform` | Provide push access or push yourself | delete the branch |
| 1 | Review the pull request (nothing deploys from a feature branch: GitHub Pages serves `main`) | **Gate 1**: approve code | close PR |
| 2 | Create the **staging** Supabase project (free) | **Gate 2** (approval to create a service) | delete project |
| 3 | On staging: run v3→v7 SQL, create test users for each role, import a copy of products | — | recreate project |
| 4 | On staging: deploy `send-notifications` in dry-run, then one real send to an inbox you own; verify Resend domain | owner supplies Resend account/domain | undeploy |
| 5 | Point a **preview copy** of the site at staging (change the two constants in `supabase-client.js` locally, never commit) and run the manual checklist in `DEPLOYMENT.md` | **Gate 3**: approve behaviour | — |
| 6 | Backup production (`DATABASE_AND_BACKUPS.md`), then run the migrations you approved on production, one at a time, in a quiet period | **Gate 4**: explicit go for each migration | `-ROLLBACK.sql` / restore dump |
| 7 | Merge the PR to `main` (deploys the site) | **Gate 5**: explicit go | `git revert` the merge / redeploy tag `baseline-2026-10-18` |
| 8 | Owner security actions: rotate password, MFA, leaked-password protection, min length | owner | — |
| 9 | Deploy the notification function on production with `NOTIFY_DRY_RUN` on, then off after one verified send | **Gate 6** | set dry-run back on |

Later, separately designed and tested on staging first: function-grant hardening migration (advisor warnings), Cloudflare in front of the domain, payment provider (before any "paid" status can exist), invoice-app integration after the fiscalization route is chosen, SRI/self-hosting for `supabase-js`.
