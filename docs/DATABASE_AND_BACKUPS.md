# Database, migrations and backups

## Migrations (order and safety)
`supabase-schema-fresh-install.sql` → `v3-store` → `v4-security` → optional `v5-notifications` → `v6-portfolio` → `v7-promo-reports`. Every file is idempotent and has a `-ROLLBACK.sql` (v3 and the fresh install have none; they predate this work). Production currently has the schema up to v4-equivalent plus whatever the earlier owner ran by hand; **v5, v6, v7 are not applied anywhere**.
Procedure for each migration: (1) backup, (2) apply on staging, run the checks in `DEPLOYMENT.md`, (3) owner approves, (4) apply on production in a quiet period, (5) keep the rollback file at hand. Never edit a migration after it has been applied; add a new numbered file.
Replay proof: `bash tests/notifications/sql/run.sh` (apply, re-run, test, rollback, re-apply for v5, v6, v7 — all pass).

## Backup situation — IMPORTANT
The organisation is on the Supabase **Free plan: automatic backups are not included** and projects pause after a week without activity (https://supabase.com/pricing.md, 2026-10-18). Today there is therefore no provider-side recovery copy of the shop. Choose one:
1. **Upgrade to Pro (from $25/month)**: daily backups, 7 days kept, restore from the dashboard. Still take a manual dump before every migration.
2. **Stay Free and dump yourself** (weekly at least, and before every migration):
   ```bash
   # connection string: Supabase → Project Settings → Database (use the pooler/direct URI; the password stays on your machine)
   pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-privileges -n public -f subcore-$(date +%F).dump
   pg_dump "$SUPABASE_DB_URL" -Fc --data-only -t auth.users -t auth.identities -f subcore-auth-$(date +%F).dump
   ```
   Store copies off the machine (encrypted drive / second cloud). Storage files (product and portfolio photos) are **not** in the dump: download them from Supabase → Storage or with the Storage API; the photos can also be re-uploaded from the originals.
3. Complement either option with the in-app **Settings → Download backup** (products, categories, services JSON) and the CSV exports.

## Restore procedures (proven locally)
`bash tests/security/backup-restore.sh` on a throwaway PostgreSQL proved:
- **A. Full restore** of a dump into an empty database: all 13 tables identical (row count + checksum), same policies / triggers / functions / RLS flags, anon still sees 0 orders and the public catalogue.
- **B. Rebuild**: fresh database from the repo's SQL files + data-only restore (tables emptied first, because the installer seeds default rows; triggers disabled during load) gives identical rows, order numbers preserved.
Not proven (needs a real Supabase project): `pg_dump` against the hosted database, the `auth` schema restore, `session_replication_role`/`--disable-triggers` permissions on the hosted `postgres` role, and storage-file restore. **Run a restore drill on the staging project once and write the date here:** `drill date: ______`.

## Rollback of a bad migration
Apply the matching `-ROLLBACK.sql` (tested to remove exactly what the migration added and to leave orders working), or restore the pre-migration dump.
