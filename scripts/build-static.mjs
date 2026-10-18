#!/usr/bin/env node
/* Builds ./dist = ONLY the files a visitor's browser needs. Everything else in the repo
   (tests, docs, SQL migrations, Supabase function code, notes, config) is NOT published.
   Safe to run repeatedly; it only writes inside ./dist. Fails (exit 1) when:
     - a local file referenced by an HTML page is missing from dist,
     - a secret-looking value is found in dist (service_role / secret keys / non-anon JWT / Resend key).
   Usage: node scripts/build-static.mjs            (from the repo root) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

// Root-level files published (by extension), minus an explicit deny-list.
const ROOT_EXT = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".xml", ".txt"]);
const ROOT_DENY = new Set(["package.json", "package-lock.json", "wrangler.jsonc", "wrangler.json", ".env.example"]);
// Directories published as a whole (only what pages actually load; verified by the reference check below).
const DIRS = ["img", "brand", "vendor"];
const DIR_DENY_EXT = new Set([".md", ".sql", ".map", ".ts"]);

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyFile(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => { const p = path.join(dir, e.name); return e.isDirectory() ? walk(p) : [p]; }); }

rm(dist); fs.mkdirSync(dist);
let count = 0;
for (const e of fs.readdirSync(root, { withFileTypes: true })) {
  if (e.isFile() && ROOT_EXT.has(path.extname(e.name).toLowerCase()) && !ROOT_DENY.has(e.name)) { copyFile(path.join(root, e.name), path.join(dist, e.name)); count++; }
}
for (const d of DIRS) {
  const src = path.join(root, d); if (!fs.existsSync(src)) continue;
  for (const f of walk(src)) { if (DIR_DENY_EXT.has(path.extname(f).toLowerCase())) continue; copyFile(f, path.join(dist, path.relative(root, f))); count++; }
}
copyFile(path.join(root, "hosting", "_headers"), path.join(dist, "_headers")); count++;

// 1) every local reference in every HTML page must exist in dist
const problems = [];
for (const page of fs.readdirSync(dist).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(dist, page), "utf8");
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const ref = m[1].split("#")[0].split("?")[0];
    if (!ref || /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(ref)) continue;
    const target = ref.startsWith("/") ? ref.slice(1) : ref;
    if (target === "" ) continue;
    if (!fs.existsSync(path.join(dist, target))) problems.push(`${page}: missing ${ref}`);
  }
}

// 2) secret scan of everything published
const SECRET_PATTERNS = [
  [/service_role/i, "the word service_role"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/\bre_[A-Za-z0-9]{20,}\b/, "Resend API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
];
for (const f of walk(dist)) {
  if (!/\.(html|js|css|json|webmanifest|txt|xml|svg)$|_headers$/.test(f)) continue;
  const text = fs.readFileSync(f, "utf8"); const rel = path.relative(dist, f);
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) problems.push(`${rel}: contains ${label}`);
  for (const j of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try { const role = JSON.parse(Buffer.from(j[1], "base64url").toString()).role; if (role !== "anon") problems.push(`${rel}: JWT with role "${role}" (only the public anon key may be published)`); } catch { /* not a JWT */ }
  }
}

if (problems.length) { console.error("BUILD FAILED:\n - " + problems.join("\n - ")); process.exit(1); }
console.log(`dist/ ready: ${count} files, all page references resolve, no secrets found.`);
