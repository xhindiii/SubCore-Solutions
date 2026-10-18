/* Real-browser check of the public Projects pages. Supabase is replaced by an in-page fake
   (no network, no real data). Run: NODE_PATH=/opt/npm-tools/node_modules node tests/portfolio/public.e2e.mjs */
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

const FAKE = (mock) => `(() => {
  const data = ${JSON.stringify(mock)};
  function qb(t) { const q = { select: () => q, order: () => q, eq: () => q, limit: () => q, in: () => q, then(res, rej) { const v = data[t]; return Promise.resolve(v && v.__error ? { data: null, error: v.__error } : { data: v || [], error: null }).then(res, rej); } }; return q; }
  window.supabase = { createClient: () => ({ from: qb, rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: null } }) },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } }) };
})();`;

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const row = (o) => Object.assign({ id: "x", title: { sq: "T", en: "T" }, category: { sq: "Web", en: "Website" }, summary: { sq: "S", en: "S" }, description: { sq: "", en: "" }, cover_image: null, images: [], technologies: [], completed_on: null, project_status: "completed", url: null, featured: false, display_order: 0, status: "published" }, o);
const HTTPS_IMG = "https://example.test/img.png";
const projects = [
  row({ id: "alpha", title: { sq: "Alfa", en: "Alpha site" }, category: { sq: "Web", en: "Website" }, summary: { sq: "Përshkrim i shkurtër", en: "Short summary" }, description: { sq: "Paragraf një\n\nParagraf dy", en: "Para one\n\nPara two" }, cover_image: HTTPS_IMG, images: [HTTPS_IMG, "https://example.test/two.png"], technologies: ["HTML", "Supabase"], completed_on: "2026-03-15", url: "https://example.test/", featured: true, display_order: 2 }),
  row({ id: "beta", title: { sq: "Beta", en: "<img src=x onerror=window.__xss=1>Beta" }, category: { sq: "Rrjet", en: "Networking" }, summary: { sq: "B", en: "B summary" }, url: "javascript:alert(1)", display_order: 1, project_status: "ongoing" }),
  row({ id: "draft-x", title: { sq: "Draft", en: "Hidden draft" }, status: "draft" })
];
const services = [{ id: "web", name: { sq: "Web", en: "Web" }, description: { sq: "d", en: "d" }, price: 0, currency: "ALL", icon: "globe", featured: false, display_order: 1, available: true, cover_image: HTTPS_IMG, price_label: { sq: "Sipas marrëveshjes", en: "On request" } }];
const links = [{ project_id: "alpha", service_id: "web" }];

const browser = await chromium.launch();
let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log("PASS ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", e.message.split("\n")[0]); } };

async function open(url, mock, vp = { width: 1280, height: 900 }, lang) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/cdn\.jsdelivr\.net|fonts\.g/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.route(/example\.test\/.*\.png/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(PNG.split(",")[1], "base64") }));
  await page.addInitScript(FAKE(mock));
  if (lang) await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
  await page.goto(base + url);
  await page.waitForTimeout(400);
  return { page, ctx, errors };
}

await test("empty portfolio: honest 'coming soon', no cards, no fake projects", async () => {
  const { page, errors } = await open("projects.html", { projects: [], project_services: [], services: [] });
  assert.equal(await page.locator(".project-card").count(), 0);
  assert.equal(await page.locator("#project-empty").isVisible(), true);
  assert.equal(await page.locator("#project-filters").isVisible(), false);
  assert.deepEqual(errors, []);
});
await test("portfolio tables not installed yet: same friendly empty state, no crash", async () => {
  const { page, errors } = await open("projects.html", { projects: { __error: { code: "42P01", message: 'relation "projects" does not exist' } }, project_services: [], services: [] });
  assert.equal(await page.locator("#project-empty").isVisible(), true);
  assert.deepEqual(errors, []);
});
await test("only published projects shown, featured first, filter pills work", async () => {
  const { page } = await open("projects.html", { projects, project_services: links, services });
  const titles = await page.locator(".project-card h3").allTextContents();
  assert.deepEqual(titles, ["Alfa", "Beta"]);                      // featured first, draft hidden
  assert.equal(await page.locator("#project-filters").isVisible(), true);
  await page.click('.filter-pill[data-cat="Networking"]');
  assert.deepEqual(await page.locator(".project-card h3").allTextContents(), ["Beta"]);
});
await test("hostile text is escaped (no script runs, no injected element)", async () => {
  const { page } = await open("projects.html", { projects, project_services: links, services }, undefined, "en");
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator(".project-card img[src='x']").count(), 0);
  assert.match(await page.locator(".project-card").nth(1).innerText(), /<img src=x onerror/);
});
await test("language switch re-renders labels", async () => {
  const { page } = await open("projects.html", { projects, project_services: links, services });
  await page.click('.lang-btn[data-lang="en"]');
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".project-card h3").first().innerText(), "Alpha site");
  assert.match(await page.locator(".filter-pill").first().innerText(), /All/);
});
await test("detail page: gallery, tech, linked service, visit link only for http(s)", async () => {
  const { page, errors } = await open("project.html?id=alpha", { projects, project_services: links, services }, undefined, "en");
  assert.equal(await page.locator("h1").innerText(), "Alpha site");
  assert.equal(await page.locator(".project-thumb").count(), 2);
  await page.locator(".project-thumb").nth(1).click();
  assert.match(await page.locator("#project-main-img").getAttribute("src"), /two\.png/);
  assert.match(await page.locator(".project-text").innerText(), /Para one[\s\S]*Para two/);
  assert.match(await page.locator(".project-text .tag-list").first().innerText(), /HTML/);
  assert.equal(await page.locator('.project-text a[href="services.html#web"]').count(), 1);
  const visit = page.locator('.project-info a.button');
  assert.equal(await visit.getAttribute("rel"), "noopener noreferrer");
  assert.match(await page.locator(".project-meta").innerText(), /March 2026/);
  assert.deepEqual(errors, []);
});
await test("detail page: javascript: URL is never rendered as a link; draft & unknown ids are 'not available'", async () => {
  let r = await open("project.html?id=beta", { projects, project_services: links, services });
  assert.equal(await r.page.locator(".project-info a.button").count(), 0);
  for (const id of ["draft-x", "nope", ""]) {
    r = await open("project.html?id=" + id, { projects, project_services: links, services });
    assert.equal(await r.page.locator("#project-missing").isVisible(), true, id);
  }
});
await test("services page shows cover image, price label and related project", async () => {
  const { page } = await open("services.html", { projects, project_services: links, services }, undefined, "en");
  const card = page.locator("#services-grid .service-card").first();
  assert.equal(await card.locator(".service-cover img").count(), 1);
  assert.match(await card.locator(".service-price").innerText(), /On request/);
  assert.match(await card.locator(".service-projects").innerText(), /Alpha site/);
});
await test("services page unchanged when there are no database services (built-in cards stay)", async () => {
  const { page } = await open("services.html", { projects: [], project_services: [], services: [] });
  assert.ok((await page.locator("#services-grid .service-card").count()) >= 8);
});
await test("no horizontal scrolling at desktop, tablet and phone widths; nav link present", async () => {
  for (const [w, h] of [[1280, 900], [1024, 800], [820, 1100], [390, 800], [320, 700]]) {
    for (const url of ["projects.html", "project.html?id=alpha", "services.html", "index.html"]) {
      const { page, ctx } = await open(url, { projects, project_services: links, services }, { width: w, height: h });
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(o.sw <= o.iw + 1, `${url} @${w}: scrollWidth ${o.sw} > ${o.iw}`);
      assert.ok((await page.locator('a[href="projects.html"]').count()) >= 1, url);
      await ctx.close();
    }
  }
});
await test("desktop header nav stays on one line with the new link", async () => {
  for (const w of [1280, 1100]) {
    const { page } = await open("index.html", { projects, project_services: links, services }, { width: w, height: 800 });
    const mids = await page.$$eval("#site-nav .nav-inner > a", (els) => els.filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
    assert.ok(Math.max(...mids) - Math.min(...mids) <= 4, `nav wraps at ${w}: ${mids}`);
    const fits = await page.evaluate(() => { const n = document.querySelector("#site-nav .nav-inner"); return n.scrollWidth <= n.clientWidth + 1; });
    assert.ok(fits, `nav overflows at ${w}`);
  }
});
if (process.env.SHOTS) {
  for (const [w, h, n] of [[1280, 900, "desktop"], [820, 1100, "tablet"], [390, 800, "phone"]]) {
    const { page, ctx } = await open("projects.html", { projects, project_services: links, services }, { width: w, height: h });
    await page.screenshot({ path: `${process.env.SHOTS}/projects-${n}.png`, fullPage: true }); await ctx.close();
  }
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PUBLIC PORTFOLIO CHECKS PASSED");
process.exit(failures ? 1 : 0);
