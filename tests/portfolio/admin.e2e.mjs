/* Real-browser check of the admin Portfolio + Services screens against an in-memory fake of
   Supabase (tables, RLS-free), so nothing real is touched. Run:
   NODE_PATH=/opt/npm-tools/node_modules PW_PATH=/opt/npm-tools/node_modules/playwright node tests/portfolio/admin.e2e.mjs */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/json", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]); const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = "http://127.0.0.1:" + server.address().port + "/";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const png = (pad = 0) => Buffer.concat([Buffer.from(PNG_B64, "base64"), Buffer.alloc(pad)]);

const FAKE = (role) => `(() => {
  const T = { projects: [], project_services: [], services: [], products: [], categories: [], orders: [], inquiries: [], website_settings: [], audit_log: [], notification_log: [],
    admin_users: [{ id: "a1", email: "o@x.test", full_name: "Owner", role: ${JSON.stringify(role)}, auth_user_id: "u1" }] };
  window.__T = T; window.__uploads = []; window.__removed = []; window.__rpc = []; window.__delCalls = 0;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function qb(t) {
    const f = { filters: [], op: "select", payload: null, count: false };
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c, v) => { f.filters.push((r) => r[c] === v); return q; }, in: (c, vs) => { f.filters.push((r) => vs.includes(r[c])); return q; },
      insert: (p) => { f.op = "insert"; f.payload = p; return q; }, upsert: (p) => { f.op = "upsert"; f.payload = p; return q; },
      update: (p) => { f.op = "update"; f.payload = p; return q; }, delete: (o) => { f.op = "delete"; f.count = !!(o && o.count); return q; },
      then(res, rej) {
        const rows = T[t]; let out = { data: null, error: null };
        const m = (r) => f.filters.every((fn) => fn(r));
        if (f.op === "select") out.data = clone(rows.filter(m));
        else if (f.op === "insert") { [].concat(f.payload).forEach((p) => rows.push(clone(p))); out.data = []; }
        else if (f.op === "upsert") { const p = clone(f.payload); const i = rows.findIndex((r) => r.id === p.id); if (i >= 0) rows[i] = Object.assign(rows[i], p); else rows.push(p); out.data = [p]; }
        else if (f.op === "update") { rows.filter(m).forEach((r) => Object.assign(r, clone(f.payload))); out.data = []; }
        else if (f.op === "delete") { const keep = rows.filter((r) => !m(r)); const n = rows.length - keep.length; T[t] = keep; if (t === "projects") { T.project_services = T.project_services.filter((l) => keep.some((p) => p.id === l.project_id)); window.__delCalls++; } out.count = f.count ? n : null; }
        return Promise.resolve(out).then(res, rej);
      }
    };
    return q;
  }
  window.supabase = { createClient: () => ({
    from: qb,
    rpc: async (name, args) => { window.__rpc.push([name, args]);
      const tbl = name === "reorder_projects" ? "projects" : name === "reorder_services" ? "services" : null;
      if (tbl) args.p_ids.forEach((id, i) => { const r = T[tbl].find((x) => x.id === id); if (r) r.display_order = i + 1; });
      return { data: null, error: null }; },
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
    storage: { from: (b) => ({
      upload: async (p, file, o) => { window.__uploads.push({ bucket: b, path: p, type: o && o.contentType, size: file.size }); return { error: null }; },
      getPublicUrl: (p) => ({ data: { publicUrl: "https://x.supabase.co/storage/v1/object/public/" + b + "/" + p } }),
      remove: async (names) => { window.__removed.push(...names); return { error: null }; } }) }
  }) };
})();`;

const browser = await chromium.launch();
let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log("PASS ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", e.message.split("\n").slice(0, 3).join(" | ")); } };

async function open(role = "admin", hash = "#portfolio", seed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/cdn\.jsdelivr\.net|fonts\.g/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.route(/x\.supabase\.co\/storage/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: png() }));
  await page.addInitScript(FAKE(role));
  if (seed) await page.addInitScript(`(() => { const s = ${JSON.stringify(seed)}; Object.keys(s).forEach((k) => window.__T[k].push(...s[k])); })();`);
  await page.goto(base + "admin.html" + hash);
  await page.waitForSelector("#app:not([hidden])", { timeout: 5000 });
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}
const T = (page, k) => page.evaluate((k) => JSON.parse(JSON.stringify(window.__T[k])), k);
const toastText = (page) => page.locator("#toasts").innerText().catch(() => "");
const fillProject = async (page, o = {}) => {
  await page.fill("#pj-t-en", o.en ?? "Alpha site"); await page.fill("#pj-t-sq", o.sq ?? "Faqja Alfa");
  await page.fill("#pj-s-en", o.sum ?? "Short summary");
  if (o.tech !== undefined) await page.fill("#pj-tech", o.tech);
  if (o.url !== undefined) await page.fill("#pj-url", o.url);
};
const seedProject = (o) => Object.assign({ id: "p1", title: { sq: "Një", en: "One" }, category: { sq: "Web", en: "Website" }, summary: { sq: "s", en: "s" }, description: { sq: "", en: "" }, cover_image: "https://x.supabase.co/storage/v1/object/public/portfolio-images/c1.png", images: ["https://x.supabase.co/storage/v1/object/public/portfolio-images/g1.png"], technologies: [], completed_on: null, project_status: "completed", url: null, featured: false, display_order: 1, status: "draft" }, o);

await test("Portfolio section is listed, starts empty, and invents nothing", async () => {
  const { page, errors } = await open();
  assert.equal(await page.locator("#page-title").innerText(), "Portfolio");
  assert.match(await page.locator("#view").innerText(), /No projects yet/);
  assert.deepEqual(await T(page, "projects"), []);
  assert.deepEqual(errors, []);
});

await test("add a project with cover + gallery images; stored as DRAFT; images go to the portfolio bucket", async () => {
  const { page } = await open();
  await page.click('[data-action="new-project"]');
  await fillProject(page, { tech: "HTML, JavaScript, html, Supabase", url: "https://example.test/" });
  await page.setInputFiles("#pj-cover input[type=file]", { name: "cover.png", mimeType: "image/png", buffer: png() });
  await page.waitForSelector("#pj-cover .img-tile");
  await page.setInputFiles("#pj-imgs input[type=file]", [{ name: "a.png", mimeType: "image/png", buffer: png() }, { name: "b.png", mimeType: "image/png", buffer: png() }]);
  await page.waitForFunction(() => document.querySelectorAll("#pj-imgs .img-tile img").length === 2);
  await page.click("#pj-save");
  await page.waitForSelector("#pj-list table");
  const [p] = await T(page, "projects");
  assert.equal(p.status, "draft"); assert.equal(p.id, "alpha-site");
  assert.deepEqual(p.technologies, ["HTML", "JavaScript", "Supabase"]);
  assert.match(p.cover_image, /portfolio-images\/.*\.png$/); assert.equal(p.images.length, 2);
  const ups = await page.evaluate(() => window.__uploads);
  assert.equal(ups.length, 3); assert.ok(ups.every((u) => u.bucket === "portfolio-images" && u.type === "image/png" && /^\d+-[a-z0-9]+\.png$/.test(u.path)));
  assert.match(await page.locator("#pj-list").innerText(), /Draft/);
});

await test("uploads are validated: fake image, SVG, oversized and empty files are refused (nothing uploaded)", async () => {
  const { page } = await open();
  await page.click('[data-action="new-project"]');
  const bad = [
    { name: "evil.png", mimeType: "image/png", buffer: Buffer.from("MZ\x90\x00this is an executable pretending to be a picture....") },
    { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') },
    { name: "huge.png", mimeType: "image/png", buffer: png(5 * 1024 * 1024 + 10) },
    { name: "tiny.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50]) },
    { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 hello hello hello hello") }
  ];
  for (const f of bad) {
    await page.setInputFiles("#pj-imgs input[type=file]", f);
    await page.waitForTimeout(150);
  }
  assert.equal((await page.evaluate(() => window.__uploads)).length, 0);
  assert.match(await toastText(page), /must be a JPEG, PNG or WebP|larger than 5 MB/);
  assert.equal(await page.locator("#pj-imgs .img-tile").count(), 0);
});

await test("form rules: title required; bad link rejected; cannot publish without short description", async () => {
  const { page } = await open();
  await page.click('[data-action="new-project"]');
  await page.click("#pj-save");
  assert.match(await toastText(page), /Enter a project title/);
  await fillProject(page, { url: "javascript:alert(1)" });
  await page.click("#pj-save");
  assert.match(await toastText(page), /link must start with https/);
  await page.fill("#pj-url", ""); await page.fill("#pj-s-en", ""); await page.selectOption("#pj-status", "published");
  await page.click("#pj-save");
  assert.match(await toastText(page), /short description before publishing/);
  assert.deepEqual(await T(page, "projects"), []);
});

await test("publish / unpublish from the list; preview shows card and page, SQ and EN, mobile width", async () => {
  const { page } = await open("admin", "#portfolio", { projects: [seedProject({ summary: { sq: "Përmbledhje", en: "Summary text" }, title: { sq: "Titulli", en: "The title" } })] });
  await page.click('[data-action="preview-project"]');
  const frame = page.frameLocator(".pv-frame");
  await frame.locator(".project-card").waitFor();
  assert.match(await page.locator(".pv-bar").innerText(), /Draft[\s\S]*Not visible to visitors/);
  assert.match(await frame.locator("h3").innerText(), /Titulli/);
  await page.click('.pv-seg[data-g="lang"] [data-v="en"]');
  await frame.locator("h3", { hasText: "The title" }).waitFor();
  await page.click('.pv-seg[data-g="mode"] [data-v="page"]');
  await frame.locator("h1").waitFor();
  assert.match(await frame.locator("h1").innerText(), /The title/);
  await page.click('.pv-seg[data-g="width"] [data-v="mobile"]');
  assert.equal(await page.locator(".pv-frame").evaluate((e) => e.style.width), "390px");
  await page.click("[data-pv-close]");
  assert.equal(await page.locator(".pv-bg").count(), 0);
  await page.click('[data-action="publish-project"]');
  await page.waitForSelector('[data-action="unpublish-project"]');
  assert.equal((await T(page, "projects"))[0].status, "published");
  await page.click('[data-action="unpublish-project"]');
  await page.waitForSelector('[data-action="publish-project"]');
  assert.equal((await T(page, "projects"))[0].status, "draft");
});

await test("reordering: move down swaps the order via the server function", async () => {
  const { page } = await open("admin", "#portfolio", { projects: [seedProject({ id: "a", title: { sq: "A", en: "A" }, display_order: 1 }), seedProject({ id: "b", title: { sq: "B", en: "B" }, display_order: 2 })] });
  await page.locator('[data-action="move-project"][data-id="a"][data-dir="1"]').click();
  await page.waitForFunction(() => window.__rpc.length === 1);
  const r = await page.evaluate(() => window.__rpc[0]);
  assert.equal(r[0], "reorder_projects"); assert.deepEqual(r[1].p_ids, ["b", "a"]);
  assert.deepEqual((await page.locator("#pj-list tbody tr strong").allTextContents()), ["B", "A"]);
  assert.equal(await page.locator('[data-action="move-project"][data-id="b"][data-dir="-1"]').isDisabled(), true);
});

await test("archive (confirmed) hides it; permanent delete needs archive first AND a confirmation; images removed", async () => {
  const { page } = await open("admin", "#portfolio", { projects: [seedProject({ status: "published" })] });
  assert.equal(await page.locator('[data-action="del-project"]').count(), 0);        // no delete on a live project
  await page.click('[data-action="archive-project"]');
  await page.click(".confirm-box [data-no]");                                         // cancel -> unchanged
  assert.equal((await T(page, "projects"))[0].status, "published");
  await page.click('[data-action="archive-project"]');
  await page.click(".confirm-box [data-yes]");
  await page.waitForSelector('[data-action="del-project"]');
  assert.equal((await T(page, "projects"))[0].status, "archived");
  await page.click('[data-action="del-project"]');
  await page.click(".confirm-box [data-no]");
  assert.equal((await T(page, "projects")).length, 1);                                // cancelled -> still there
  await page.click('[data-action="del-project"]');
  assert.match(await page.locator(".confirm-box").innerText(), /cannot be undone/);
  await page.click(".confirm-box [data-yes]");
  await page.waitForFunction(() => window.__delCalls === 1);
  assert.equal((await T(page, "projects")).length, 0);
  await page.waitForFunction(() => window.__removed.length === 2);
  assert.deepEqual((await page.evaluate(() => window.__removed)).sort(), ["c1.png", "g1.png"]);
});

await test("replacing / removing an image deletes the old file after saving; cancelling deletes new uploads", async () => {
  const { page } = await open("admin", "#portfolio", { projects: [seedProject()] });
  await page.click('[data-action="edit-project"]');
  await page.setInputFiles("#pj-cover input[type=file]", { name: "new.png", mimeType: "image/png", buffer: png() });
  await page.waitForFunction(() => window.__uploads.length === 1);
  await page.locator('#pj-imgs [data-rm="0"]').click({ force: true });
  await page.click("#pj-save");
  await page.waitForSelector("#pj-list table");
  const removed = await page.evaluate(() => window.__removed);
  assert.deepEqual(removed.sort(), ["c1.png", "g1.png"]);                              // old cover + removed gallery image
  await page.click('[data-action="edit-project"]');
  await page.setInputFiles("#pj-imgs input[type=file]", { name: "tmp.png", mimeType: "image/png", buffer: png() });
  await page.waitForFunction(() => window.__uploads.length === 2);
  const tmp = (await page.evaluate(() => window.__uploads))[1].path;
  await page.click("[data-close2]");
  await page.waitForFunction((n) => window.__removed.includes(n), tmp);
});

await test("an editor can manage the portfolio but cannot permanently delete; staff has no Portfolio", async () => {
  let r = await open("editor", "#portfolio", { projects: [seedProject({ status: "archived" })] });
  assert.equal(await r.page.locator("#page-title").innerText(), "Portfolio");
  assert.equal(await r.page.locator('[data-action="del-project"]').count(), 0);
  assert.equal(await r.page.locator('[data-action="edit-project"]').count(), 1);
  r = await open("staff", "#portfolio");
  assert.equal(await r.page.locator("#page-title").innerText(), "Dashboard");
  assert.equal(await r.page.locator('[data-nav="portfolio"]').count(), 0);
});

await test("services: price label, cover, related projects, publish switch, reorder", async () => {
  const svc = (id, o) => Object.assign({ id, name: { sq: id, en: id }, description: { sq: "d", en: "d" }, price: 0, currency: "ALL", icon: "server", featured: false, display_order: 1, available: true, cover_image: null, price_label: null }, o);
  const { page } = await open("admin", "#services", { services: [svc("web", {}), svc("net", { display_order: 2 })], projects: [seedProject({ status: "published" })] });
  await page.click('[data-action="edit-service"][data-id="web"]');
  await page.fill("#s-pl-en", "On request");
  await page.check('[data-rel="p1"]');
  await page.setInputFiles("#s-cover input[type=file]", { name: "s.png", mimeType: "image/png", buffer: png() });
  await page.waitForSelector("#s-cover .img-tile");
  await page.click("#s-save");
  await page.waitForSelector("#view table");
  const [w] = (await T(page, "services")).filter((x) => x.id === "web");
  assert.deepEqual(w.price_label, { sq: "On request", en: "On request" });
  assert.match(w.cover_image, /portfolio-images\//);
  assert.deepEqual(await T(page, "project_services"), [{ project_id: "p1", service_id: "web" }]);
  assert.match(await page.locator("#view table").innerText(), /On request/);
  await page.locator('[data-action="move-service"][data-id="web"][data-dir="1"]').click();
  await page.waitForFunction(() => window.__rpc.some((r) => r[0] === "reorder_services"));
  assert.deepEqual((await page.evaluate(() => window.__rpc.find((r) => r[0] === "reorder_services")))[1].p_ids, ["net", "web"]);
  await page.locator('[data-svc-toggle="net"]').uncheck({ force: true });
  await page.waitForTimeout(200);
  assert.equal((await T(page, "services")).find((x) => x.id === "net").available, false);
});

await test("services still work when the portfolio migration is NOT installed (no new fields sent)", async () => {
  const { page } = await open("admin", "#services", { services: [{ id: "old", name: { sq: "o", en: "o" }, description: { sq: "d", en: "d" }, price: 5, currency: "ALL", icon: "server", featured: false, display_order: 1, available: true }] });
  await page.click('[data-action="edit-service"][data-id="old"]');
  assert.equal(await page.locator("#s-pl-en").count(), 0);          // extras hidden: this row has no v6 columns
  assert.equal(await page.locator("#s-cover").count(), 0);
  await page.fill("#s-sq", "renamed");
  await page.click("#s-save");
  await page.waitForSelector("#view table");
  const [row] = await T(page, "services");
  assert.equal(row.name.sq, "renamed");
  assert.ok(!("cover_image" in row) && !("price_label" in row), "must not send columns the database does not have");
});

if (process.env.SHOTS) {
  const { page } = await open("admin", "#portfolio", { projects: [seedProject({ status: "published", title: { sq: "Faqja e kompanisë", en: "Company website" }, summary: { sq: "Një faqe e re", en: "A new company website" }, technologies: ["HTML", "Supabase"], featured: true })] });
  await page.screenshot({ path: process.env.SHOTS + "/admin-portfolio-list.png" });
  await page.click('[data-action="edit-project"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: process.env.SHOTS + "/admin-portfolio-form.png" });
  await page.click("[data-close2]");
  await page.click('[data-action="preview-project"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: process.env.SHOTS + "/admin-portfolio-preview.png" });
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL ADMIN PORTFOLIO CHECKS PASSED");
process.exit(failures ? 1 : 0);
