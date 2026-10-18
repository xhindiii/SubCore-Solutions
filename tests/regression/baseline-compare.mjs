/* Phase 9 — regression check: every page of the ORIGINAL site (git tag baseline-2026-10-18)
   is loaded next to the same page on the current branch, in a real browser, with Supabase
   replaced by an in-page fake (no network, no production data, no e-mail).
   Checks per page: loads, no JS errors, all local assets/links resolve, no horizontal scroll at
   3 viewports, baseline navigation links still present, main headings still present.
   Plus: contact + quote forms insert into `inquiries`, checkout calls place_order.
   Run:  git worktree add /tmp/base baseline-2026-10-18
         NODE_PATH=/opt/npm-tools/node_modules PW_PATH=/opt/npm-tools/node_modules/playwright \
         node tests/regression/baseline-compare.mjs /tmp/base .
   Exit code 1 on any regression. Differences that are intended are listed in EXPECTED. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const [baseDir, devDir] = process.argv.slice(2).map((p) => path.resolve(p));
if (!baseDir || !devDir) { console.error("usage: baseline-compare.mjs <baseline-dir> <dev-dir>"); process.exit(2); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/json", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain" };
function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split("?")[0]); const f = path.join(root, u === "/" ? "index.html" : u);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("nf"); }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
    });
    s.listen(0, () => resolve({ s, base: "http://127.0.0.1:" + s.address().port + "/" }));
  });
}

const PRODUCT = { id: "p1", name: { sq: "Produkt test", en: "Test product" }, description: { sq: "d", en: "d" }, price: 10, currency: "ALL", stock: 5, available: true, featured: true, category_id: "c1", image: null, images: [], sku: "T-1", brand: "B", specs: {}, compare_price: null, created_at: "2026-01-01T00:00:00Z" };
const FAKE = `(() => {
  window.__calls = [];
  const data = { products: [${JSON.stringify(PRODUCT)}], categories: [{ id: "c1", name: { sq: "Kat", en: "Cat" }, slug: "cat", display_order: 1 }], services: [], website_settings: [], projects: [], project_services: [] };
  function qb(t) { const q = { select: () => q, order: () => q, eq: () => q, limit: () => q, in: () => q, neq: () => q, single: () => q, maybeSingle: () => q,
    insert: (row) => { window.__calls.push({ op: "insert", table: t, row }); return Promise.resolve({ data: null, error: null }); },
    then(res, rej) { return Promise.resolve({ data: data[t] || [], error: null }).then(res, rej); } }; return q; }
  window.supabase = { createClient: () => ({ from: qb,
    rpc: async (fn, args) => { window.__calls.push({ op: "rpc", fn, args }); return { data: [{ order_number: "SC-TEST-1", total: 10 }], error: null }; },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: null } }) },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } }) };
})();`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// Differences that are intended and approved in earlier phases.
const EXPECTED = {
  hrefRemovedOk: [/^mailto:info@subcoresolutions\.online/i],   // Phase 3: old contact e-mail removed
  hrefAddedOk: [/projects\.html/, /project\.html/, /mailto:info\.subcoresolutions@gmail\.com/]
};

const browser = await chromium.launch();
const VIEWPORTS = [{ w: 375, h: 800 }, { w: 768, h: 900 }, { w: 1280, h: 900 }];
let failures = 0, checks = 0;
const out = [];
const ok = (m) => { checks++; out.push("PASS  " + m); };
const bad = (m) => { checks++; failures++; out.push("FAIL  " + m); };

async function visit(base, file, vp, query = "", pre) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const errors = [], badAssets = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { const u = r.url(); if (u.startsWith(base) && r.status() >= 400 && !/favicon|robots/.test(u)) badAssets.push(r.status() + " " + u.replace(base, "")); });
  await page.route(/cdn\.jsdelivr\.net|fonts\.g/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.addInitScript(FAKE);
  if (pre) await page.addInitScript(pre);
  await page.goto(base + file + query, { waitUntil: "load" });
  await page.waitForTimeout(350);
  return { page, ctx, errors, badAssets };
}
const facts = (page) => page.evaluate(() => ({
  title: document.title,
  h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
  hrefs: [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")))].sort(),
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  bodyText: document.body.innerText.length
}));

const B = await serve(baseDir), D = await serve(devDir);
const basePages = fs.readdirSync(baseDir).filter((f) => f.endsWith(".html")).sort();
const devPages = fs.readdirSync(devDir).filter((f) => f.endsWith(".html")).sort();
const missing = basePages.filter((p) => !devPages.includes(p));
(missing.length ? bad : ok)("every baseline page still exists on dev (" + basePages.length + " pages)" + (missing.length ? " — MISSING: " + missing.join(", ") : ""));
const added = devPages.filter((p) => !basePages.includes(p));
out.push("INFO  pages added on dev: " + (added.join(", ") || "none"));

// Non-HTML assets referenced by baseline must still exist
const walk = (d, rel = "") => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === ".git" || e.name === "tests" || e.name === "node_modules" ? [] : e.isDirectory() ? walk(path.join(d, e.name), rel + e.name + "/") : [rel + e.name]);
const baseFiles = walk(baseDir), devFiles = new Set(walk(devDir));
// When the dev folder is the built public bundle (scripts/build-static.mjs, recognisable by its _headers file),
// repository-only files are intentionally NOT published: SQL, Markdown notes, CNAME, LICENSE, dotfiles.
// Every other baseline file (pages, scripts, styles, images, data) must still be there.
const IS_BUNDLE = devFiles.has("_headers");
const UNPUBLISHED_OK = /(\.sql|\.md)$|^(CNAME|LICENSE|\.gitignore|\.env\.example)$/;
const lostFiles = baseFiles.filter((f) => !devFiles.has(f) && !(IS_BUNDLE && UNPUBLISHED_OK.test(f)));
if (IS_BUNDLE) out.push("INFO  dev folder is the built public bundle: repository-only files (sql, md, CNAME, LICENSE, dotfiles) are expected to be unpublished");
(lostFiles.length ? bad : ok)("no baseline file was deleted or renamed (" + baseFiles.length + " files)" + (lostFiles.length ? " — LOST: " + lostFiles.join(", ") : ""));

for (const file of basePages) {
  if (!devPages.includes(file)) continue;
  const query = file === "product.html" ? "?id=p1" : "";
  let bf, df;
  for (const vp of VIEWPORTS) {
    const b = await visit(B.base, file, vp, query), d = await visit(D.base, file, vp, query);
    bf = await facts(b.page); df = await facts(d.page);
    const tag = file + " @" + vp.w;
    (d.errors.length === b.errors.length ? ok : bad)(tag + " JS errors: baseline " + b.errors.length + ", dev " + d.errors.length + (d.errors.length ? " — " + d.errors[0] : ""));
    (d.badAssets.length <= b.badAssets.length ? ok : bad)(tag + " failed local requests: baseline " + b.badAssets.length + ", dev " + d.badAssets.length + (d.badAssets.length ? " — " + d.badAssets.join("; ") : ""));
    (df.overflow <= Math.max(bf.overflow, 0) ? ok : bad)(tag + " horizontal overflow: baseline " + bf.overflow + "px, dev " + df.overflow + "px");
    await b.ctx.close(); await d.ctx.close();
  }
  (JSON.stringify(df.h1) === JSON.stringify(bf.h1) ? ok : bad)(file + " main heading unchanged " + JSON.stringify(bf.h1) + (JSON.stringify(df.h1) === JSON.stringify(bf.h1) ? "" : " → " + JSON.stringify(df.h1)));
  const lost = bf.hrefs.filter((h) => !df.hrefs.includes(h) && !EXPECTED.hrefRemovedOk.some((re) => re.test(h)));
  (lost.length ? bad : ok)(file + " every baseline link still present" + (lost.length ? " — LOST: " + lost.join(", ") : ""));
  const newer = df.hrefs.filter((h) => !bf.hrefs.includes(h));
  if (newer.length) out.push("INFO  " + file + " links added: " + newer.join(", "));
}

// ---- forms ----
async function formTest(name, base, file, fill, expect) {
  const { page, ctx } = await visit(base, file, { w: 1280, h: 900 });
  await fill(page);
  await page.waitForTimeout(500);
  const calls = await page.evaluate(() => window.__calls);
  const r = expect(calls); await ctx.close(); return r;
}
const contactFill = async (p) => {
  await p.fill("#name", "Test Person"); await p.fill("#email", "test@example.test"); await p.fill("#phone", "+355 69 123 4567");
  await p.selectOption("#service", "other"); await p.fill("#message", "Mesazh testues, pa dërgim real.");
  await p.click("#contact-form button[type=submit]");
};
const contactExpect = (c) => c.some((x) => x.op === "insert" && x.table === "inquiries" && x.row.name === "Test Person" && x.row.message.includes("Mesazh"));
for (const [label, b] of [["baseline", B.base], ["dev", D.base]]) {
  (await formTest("contact", b, "contact.html", contactFill, contactExpect) ? ok : bad)("contact form submits an inquiry (" + label + ")");
}
const quoteExists = fs.readFileSync(path.join(devDir, "quote.html"), "utf8");
const quoteFill = async (p) => {
  const f = p.locator("#quote-form");
  for (const el of await f.locator("input[name],textarea[name],select[name]").all()) {
    const n = await el.getAttribute("name"), t = await el.getAttribute("type"), tag = await el.evaluate((e) => e.tagName);
    if (n === "website" || t === "checkbox" || t === "radio" || t === "hidden") continue;
    if (tag === "SELECT") { const v = await el.evaluate((e) => [...e.options].map((o) => o.value).filter(Boolean)[0]); if (v) await el.selectOption(v); }
    else if (t === "email") await el.fill("test@example.test"); else if (t === "tel") await el.fill("+355 69 123 4567");
    else if (t === "number") await el.fill("5"); else await el.fill(n === "message" ? "Mesazh testues për kërkesën." : "Test").catch(() => {});
  }
  for (const c of await f.locator("input[type=checkbox]").all()) await c.check().catch(() => {});
  await f.locator("button[type=submit]").click();
};
const quoteExpect = (c) => c.some((x) => x.op === "insert" && x.table === "inquiries");
for (const [label, b] of [["baseline", B.base], ["dev", D.base]]) {
  (await formTest("quote", b, "quote.html", quoteFill, quoteExpect) ? ok : bad)("quote form submits an inquiry (" + label + ")");
}
const cartPre = `localStorage.setItem("subcore_cart", JSON.stringify([{ id: "p1", qty: 2 }]));`;
for (const [label, b] of [["baseline", B.base], ["dev", D.base]]) {
  const { page, ctx, errors } = await visit(b, "checkout.html", { w: 1280, h: 900 }, "", cartPre);
  await page.waitForSelector("#checkout-form", { timeout: 4000 }).catch(() => {});
  let placed = false;
  if (await page.locator("#checkout-form").count()) {
    await page.fill("#co-name", "Test Person"); await page.fill("#co-phone", "+355 69 123 4567"); await page.fill("#co-city", "Tiranë"); await page.fill("#co-address", "Rruga Test 1");
    await page.click("#co-submit"); await page.waitForTimeout(600);
    const calls = await page.evaluate(() => window.__calls);
    const c = calls.find((x) => x.op === "rpc" && x.fn === "place_order");
    placed = !!c && c.args.p_items[0].id === "p1" && c.args.p_items[0].qty === 2 && c.args.p_name === "Test Person";
  }
  (placed ? ok : bad)("checkout calls place_order with the cart contents (" + label + ")" + (errors.length ? " — js error: " + errors[0] : ""));
  await ctx.close();
}
await browser.close(); B.s.close(); D.s.close();
console.log(out.join("\n"));
console.log("\n" + (checks - failures) + "/" + checks + " checks passed" + (failures ? ", " + failures + " REGRESSION(S)" : ""));
process.exit(failures ? 1 : 0);
