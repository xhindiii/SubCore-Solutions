# Portfolio (Projects) and services management

The public **Projects** page (`projects.html`, one project per `project.html?id=…`) and the extra service options are managed from the admin dashboard — no source-code edits.

## Safe to install
`supabase-migration-v6-portfolio.sql` is additive (two new tables, two optional columns on `services`, one storage bucket, two small functions). It does **not** insert any project: the portfolio starts empty and the public page shows an honest "portfolio is being prepared" message until you publish real work. Run it on a **staging** project first, after a backup. Undo: `supabase-migration-v6-ROLLBACK.sql` (deletes projects and the optional service fields; uploaded image files stay in Storage until you delete the bucket there). Until the migration is installed, the whole site and the existing Services screen keep working exactly as before.

## What you can do (Admin → Portfolio)
- Add / edit projects: title, category, short and detailed description (Albanian + English), cover image, up to 11 more images, technologies, services delivered, completion month, state (completed / in progress / maintained), public link, featured flag, display order, status.
- **Status:** Draft, Published, Archived. Only *Published* is visible to visitors — enforced by the database (Row Level Security), not just the page. A project cannot be published without a title and a short description.
- **Preview** (in the form or the list) shows the real public card and project page, in Albanian or English, desktop or mobile width, before you publish.
- **Reorder** with the ↑ ↓ buttons (saved in one step on the server).
- **Archive** instead of deleting (confirmation asked; restore any time as a draft). **Permanent delete** is possible only for archived projects, only by an administrator, and only after a second confirmation; its images are removed too. Editors can archive but not delete.
- **Images:** JPEG, PNG or WebP only, 5 MB maximum. The browser checks the real file contents (a renamed program or an SVG is refused) and the storage bucket enforces type and size again on the server. Files are stored under generated names. Replaced/removed pictures are deleted after saving; pictures uploaded but never saved are deleted when you cancel.

## Services (Admin → Services)
Existing screen, extended: **Published** switch, ↑ ↓ ordering, optional **price label** (replaces the "from" price, e.g. "On request"), optional **cover image**, and **related portfolio projects**. Related projects appear as links on the public Services page; the service also appears on each project page under "Services delivered". If you leave the services list empty the built-in cards stay, as before.

## Roles
Admin and Editor can use Portfolio and Services; Staff cannot. Portfolio changes are recorded in the Activity log.

## Tests
- `PGHOST=… PGPORT=… PGUSER=… bash tests/notifications/sql/run.sh` (throwaway PostgreSQL only; includes the v6 tests and rollback check)
- `NODE_PATH=<playwright location> node tests/portfolio/public.e2e.mjs` and `…/admin.e2e.mjs` (real Chromium against an in-memory fake of Supabase: no real data, no network)

## Not verified
The browser tests use a fake backend. Real Supabase Storage, real Row Level Security through the live API and real image rendering from your Supabase URL must be checked on staging after installing the migration (add a project, upload an image, publish, open the public page in a private window).
