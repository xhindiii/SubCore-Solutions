/* Shared test harness: static server for the repo + an in-memory fake of Supabase (no network, no real data),
   so admin screens can be exercised in real Chromium. Every write is recorded in window.__writes. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const { chromium } = require(process.env.PW_PATH || "playwright");

export const ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/json", ".ico": "image/x-icon" };

export async function startServer() {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  return { server, base: "http://127.0.0.1:" + server.address().port + "/" };
}

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const png = () => Buffer.from(PNG_B64, "base64");

export const FAKE = (role) => `(() => {
  const T = { projects: [], project_services: [], services: [], products: [], categories: [], orders: [], inquiries: [], website_settings: [], audit_log: [], notification_log: [],
    promo_templates: [], purchase_records: [],
    admin_users: [{ id: "a1", email: "o@x.test", full_name: "Owner", role: ${JSON.stringify(role)}, auth_user_id: "u1" }] };
  window.__T = T; window.__writes = []; window.__rpc = []; window.__missing = window.__missing || [];
  let seq = 100;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function qb(t) {
    const f = { filters: [], op: "select", payload: null, single: false };
    const q = {
      select: () => q, order: () => q, limit: () => q, single: () => { f.single = true; return q; },
      eq: (c, v) => { f.filters.push((r) => r[c] === v); return q; }, in: (c, vs) => { f.filters.push((r) => vs.includes(r[c])); return q; },
      insert: (p) => { f.op = "insert"; f.payload = p; return q; }, upsert: (p) => { f.op = "upsert"; f.payload = p; return q; },
      update: (p) => { f.op = "update"; f.payload = p; return q; }, delete: () => { f.op = "delete"; return q; },
      then(res, rej) {
        let out = { data: null, error: null };
        if (window.__missing.includes(t)) { out.error = { code: "42P01", message: 'relation "public.' + t + '" does not exist' }; return Promise.resolve(out).then(res, rej); }
        const rows = T[t]; const m = (r) => f.filters.every((fn) => fn(r));
        if (f.op !== "select") window.__writes.push({ table: t, op: f.op, payload: clone(f.payload) });
        if (f.op === "select") out.data = clone(rows.filter(m));
        else if (f.op === "insert") {
          const made = [].concat(clone(f.payload)).map((p) => { if (p.id === undefined) p.id = (t === "purchase_records") ? ++seq : "gen-" + (++seq); return p; });
          if (t === "purchase_records") { for (const p of made) { const dup = rows.find((r) => !r.voided && r.supplier.trim().toLowerCase() === p.supplier.trim().toLowerCase() && r.doc_number.trim().toLowerCase() === p.doc_number.trim().toLowerCase());
            if (dup) { out.error = { code: "23505", message: "duplicate key value violates unique constraint" }; return Promise.resolve(out).then(res, rej); } } }
          rows.push(...made); out.data = f.single ? made[0] : made;
        }
        else if (f.op === "upsert") { const p = clone(f.payload); const i = rows.findIndex((r) => r.id === p.id); if (i >= 0) rows[i] = Object.assign(rows[i], p); else rows.push(p); out.data = [p]; }
        else if (f.op === "update") { const hit = rows.filter(m); hit.forEach((r) => Object.assign(r, clone(f.payload))); out.data = f.single ? (hit[0] ? clone(hit[0]) : null) : []; }
        else if (f.op === "delete") { T[t] = rows.filter((r) => !m(r)); out.data = []; }
        return Promise.resolve(out).then(res, rej);
      }
    };
    return q;
  }
  window.supabase = { createClient: () => ({
    from: qb,
    rpc: async (name, args) => { window.__rpc.push([name, args]); return { data: null, error: null }; },
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: "https://x.supabase.co/" + p } }), remove: async () => ({ error: null }) }) }
  }) };
})();`;

export async function openAdmin(browser, base, { role = "admin", hash = "#dashboard", seed, missing = [], viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await page.route(/cdn\.jsdelivr\.net|fonts\.g/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.addInitScript(FAKE(role));
  if (missing.length) await page.addInitScript(`window.__missing = ${JSON.stringify(missing)};`);
  if (seed) await page.addInitScript(`(() => { const s = ${JSON.stringify(seed)}; Object.keys(s).forEach((k) => window.__T[k].push(...s[k])); })();`);
  await page.goto(base + "admin.html" + hash);
  await page.waitForSelector("#app:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}
export const T = (page, k) => page.evaluate((k) => JSON.parse(JSON.stringify(window.__T[k])), k);
export const W = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__writes)));
