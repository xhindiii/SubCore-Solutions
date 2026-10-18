#!/usr/bin/env node
/* Post-deploy smoke test for the production host. Read-only: only sends GET requests.
   Usage:  node scripts/smoke-test.mjs https://<preview-or-production-url>
   Checks: every public page loads (200, no redirect), unknown URL gives a real 404 with the site's 404 page,
   repository-only files are NOT published, security headers are present, admin page is no-store + noindex.
   Exit code 1 if anything fails. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) { console.error("usage: node scripts/smoke-test.mjs https://your-site"); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
if (!fs.existsSync(dist)) { console.error("Run `node scripts/build-static.mjs` first (the page list comes from dist/)."); process.exit(2); }

let fails = 0, checks = 0;
const ok = (m) => { checks++; console.log("PASS  " + m); };
const bad = (m) => { checks++; fails++; console.log("FAIL  " + m); };
const get = (p) => fetch(base + p, { redirect: "manual", headers: { "user-agent": "subcore-smoke-test" } });

const pages = fs.readdirSync(dist).filter((f) => f.endsWith(".html") && f !== "404.html").sort();
for (const p of ["/", ...pages.map((f) => "/" + f)]) {
  const r = await get(p);
  const type = r.headers.get("content-type") || "";
  (r.status === 200 && /text\/html/.test(type) ? ok : bad)(`${p} -> ${r.status} ${type.split(";")[0]}${r.status >= 300 && r.status < 400 ? " (redirect to " + r.headers.get("location") + ")" : ""}`);
}
for (const p of ["/products.json", "/supabase-client.js", "/style.css", "/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/logo.png"]) {
  const r = await get(p); (r.status === 200 ? ok : bad)(`${p} -> ${r.status}`);
}

const nf = await get("/this-page-does-not-exist-" + Date.now() + ".html");
const nfBody = await nf.text();
(nf.status === 404 ? ok : bad)(`unknown URL returns HTTP 404 (got ${nf.status})`);
(/<html/i.test(nfBody) && /404|nuk u gjet|not found/i.test(nfBody) ? ok : bad)("unknown URL shows the site's own 404 page");

for (const p of ["/README.md", "/SECURITY.md", "/CNAME", "/LICENSE", "/.env.example", "/wrangler.jsonc", "/scripts/build-static.mjs", "/supabase-schema-fresh-install.sql", "/supabase-migration-v7-promo-reports.sql", "/supabase/functions/send-notifications/index.ts", "/docs/DEPLOYMENT.md", "/tests/regression/baseline-compare.mjs", "/legacy/supabase-schema.DEPRECATED.sql", "/hosting/_headers"]) {
  const r = await get(p); (r.status === 404 ? ok : bad)(`not published: ${p} -> ${r.status}`);
}

const h = (await get("/")).headers;
const need = [["strict-transport-security", /max-age=\d{7,}/], ["x-content-type-options", /nosniff/i], ["referrer-policy", /.+/], ["x-frame-options", /SAMEORIGIN|DENY/i], ["content-security-policy", /frame-ancestors/], ["permissions-policy", /camera=\(\)/]];
for (const [name, re] of need) (re.test(h.get(name) || "") ? ok : bad)(`header ${name}: ${h.get(name) || "(missing)"}`);

const a = await get("/admin.html");
(/no-store/.test(a.headers.get("cache-control") || "") ? ok : bad)(`admin.html cache-control: ${a.headers.get("cache-control") || "(missing)"}`);
(/noindex/.test(a.headers.get("x-robots-tag") || "") ? ok : bad)(`admin.html x-robots-tag: ${a.headers.get("x-robots-tag") || "(missing)"}`);

console.log(`\n${checks - fails}/${checks} checks passed${fails ? " — " + fails + " FAILED" : ""}`);
process.exit(fails ? 1 : 0);
