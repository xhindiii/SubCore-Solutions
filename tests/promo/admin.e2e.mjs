/* Real-Chromium test of Admin -> Promo graphics. Exports real files and validates them with PIL and poppler.
   NODE_PATH=/opt/npm-tools/node_modules PW_PATH=/opt/npm-tools/node_modules/playwright node tests/promo/admin.e2e.mjs */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, startServer, openAdmin, T, W, png } from "../helpers/admin-harness.mjs";

const { server, base } = await startServer();
const browser = await chromium.launch();
let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log("PASS ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", String(e.stack || e.message).split("\n").slice(0, 4).join(" | ")); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "promo-"));
const py = (code, ...args) => execFileSync("python3", ["-I", "-c", code, ...args], { encoding: "utf8" }).trim();

const PRODUCTS = [
  { id: "r1", name: { en: "Wi-Fi Router AX55", sq: "Ruter Wi-Fi AX55" }, description: { en: "Fast dual-band router for homes and offices.", sq: "Ruter i shpejtë dual-band për shtëpi dhe zyra." },
    price: 8500, compare_price: 10000, currency: "ALL", category: null, image: "logo.png", images: [], stock: 5, available: true, featured: false, brand: "X", sku: "R-1", specs: [] },
  { id: "c1", name: { en: "Cat6 cable 5m", sq: "Kabllo Cat6 5m" }, description: { en: "", sq: "" }, price: 450, compare_price: null, currency: "ALL", category: null, image: "", images: [], stock: 50, available: true, featured: false, brand: "", sku: "C-6", specs: [] }
];
const open = (o = {}) => openAdmin(browser, base, { hash: "#promo", seed: { products: PRODUCTS.map((p) => JSON.parse(JSON.stringify(p))) }, ...o });
const download = async (page, sel) => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(sel)]); const f = path.join(tmp, (++dl) + "-" + d.suggestedFilename()); await d.saveAs(f); return { file: f, name: d.suggestedFilename() }; };
let dl = 0;
const settle = (page) => page.waitForTimeout(250);
const openGroups = (page) => page.evaluate(() => document.querySelectorAll("details.promo-group").forEach((d) => { d.open = true; }));

await test("Promo section is listed for admin and editor; hidden from staff", async () => {
  for (const [role, expect] of [["admin", true], ["editor", true], ["staff", false]]) {
    const { page, errors } = await open({ role, hash: "#dashboard" });
    assert.equal(await page.locator('#nav [data-nav="promo"]').count() > 0, expect, role);
    assert.deepEqual(errors, [], role);
  }
});

await test("selecting a product loads its details into the advert; catalogue price becomes the starting advert price, old price from compare price", async () => {
  const { page, errors } = await open();
  await page.selectOption("#pr-product", "r1"); await settle(page);
  assert.equal(await page.inputValue("#ad-title"), "Ruter Wi-Fi AX55");
  assert.equal(await page.inputValue("#ad-price"), "8500");
  assert.equal(await page.inputValue("#ad-old"), "10000");
  assert.match(await page.inputValue("#ad-description"), /dual-band/);
  assert.match(await page.locator("#pr-imgnote").innerText(), /product photo/i);
  assert.deepEqual(errors, []);
});

await test("changing the advertised price / old price / offer NEVER writes to products, services or orders", async () => {
  const { page } = await open();
  await page.selectOption("#pr-product", "r1");
  await page.fill("#ad-price", "7990"); await page.fill("#ad-old", "9990"); await page.fill("#ad-offer", "Pako 2 për 1"); await settle(page);
  await page.selectOption("#pr-format", "story"); await page.selectOption("#pr-template", "builtin-dark"); await settle(page);
  await download(page, "#ex-png");
  assert.deepEqual((await W(page)).filter((w) => ["products", "services", "orders", "categories", "website_settings"].includes(w.table)), []);
  const prods = await T(page, "products");
  assert.equal(prods.find((p) => p.id === "r1").price, 8500);
  assert.equal(prods.find((p) => p.id === "r1").compare_price, 10000);
  assert.deepEqual(await W(page), []); // exporting writes nothing at all
});

await test("advert price that differs from the catalogue price is flagged as advert-only", async () => {
  const { page } = await open();
  await page.selectOption("#pr-product", "r1"); await page.fill("#ad-price", "7990"); await settle(page);
  assert.match(await page.locator("#ad-messages").innerText(), /differs from the catalogue price/);
  assert.match(await page.locator("#ad-messages").innerText(), /keeps its own price/);
});

await test("validation: title required, invalid price blocks export; old price not higher is a warning and shows no discount", async () => {
  const { page } = await open();
  await page.click("#ex-png"); await settle(page);
  assert.match(await page.locator("#toasts").innerText(), /Fix the highlighted problems/);
  assert.match(await page.locator("#ad-messages").innerText(), /Add a title/);
  await page.fill("#ad-title", "X"); await page.fill("#ad-price", "abc"); await settle(page);
  assert.match(await page.locator("#ad-messages").innerText(), /not a valid number/);
  await page.fill("#ad-price", "50"); await page.fill("#ad-old", "40"); await settle(page);
  assert.match(await page.locator("#ad-messages").innerText(), /not higher than the advertised price/);
});

await test("PNG export: a real 1080x1080 file whose pixels are the design, not the dashboard", async () => {
  const { page } = await open();
  await page.selectOption("#pr-product", "r1"); await page.selectOption("#pr-template", "builtin-dark"); await settle(page);
  const { file, name } = await download(page, "#ex-png");
  assert.equal(name, "subcore-ruter-wi-fi-ax55-instagram_square.png");
  const buf = fs.readFileSync(file);
  assert.deepEqual([...buf.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(py("from PIL import Image;import sys;im=Image.open(sys.argv[1]);print(im.size[0],im.size[1],im.mode)", file).split(" ").slice(0, 2).join("x"), "1080x1080");
  // dark template: gradient from #18252d (top-left) to #176f86; sample the very first pixel region
  const px = py("from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert('RGB');print(*im.getpixel((6,6)))", file).split(" ").map(Number);
  assert.ok(px[0] < 40 && px[1] < 70 && px[2] < 80, "top-left should be the dark gradient start, got " + px);
  // many distinct colours = actual artwork (text, price pill, logo), not a blank canvas
  assert.ok(Number(py("from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert('RGB').resize((270,270));print(len(set(im.getdata())))", file)) > 300);
});

await test("JPG export: real JPEG, requested size", async () => {
  const { page } = await open();
  await page.fill("#ad-title", "Oferta"); await page.fill("#ad-price", "1.250"); await page.selectOption("#pr-format", "facebook_post"); await settle(page);
  const { file, name } = await download(page, "#ex-jpg");
  assert.match(name, /facebook_post\.jpg$/);
  const buf = fs.readFileSync(file); assert.deepEqual([...buf.slice(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal(py("from PIL import Image;import sys;im=Image.open(sys.argv[1]);print(im.format,im.size[0],im.size[1])", file), "JPEG 1200 630");
});

await test("PDF export (A4 print): valid PDF, A4 page size, one page, embedded 2480x3508 image; poppler can render it", async () => {
  const { page } = await open();
  await page.selectOption("#pr-product", "r1"); await page.selectOption("#pr-format", "print_a4"); await page.selectOption("#pr-template", "builtin-print"); await settle(page);
  const { file, name } = await download(page, "#ex-pdf");
  assert.match(name, /print_a4\.pdf$/);
  const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
  assert.match(info, /Pages:\s+1/); assert.match(info, /Page size:\s+595\.\d+ x 841\.\d+ pts \(A4\)/);
  assert.match(execFileSync("pdfimages", ["-list", file], { encoding: "utf8" }), /2480\s+3508/);
  execFileSync("pdftoppm", ["-png", "-r", "40", file, path.join(tmp, "a4")]);
  const rendered = fs.readdirSync(tmp).find((f) => f.startsWith("a4") && f.endsWith(".png"));
  assert.ok(rendered);
  assert.ok(Number(py("from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert('RGB').resize((200,280));print(len(set(im.getdata())))", path.join(tmp, rendered))) > 100);
});

await test("every format exports at its exact size", async () => {
  const { page } = await open();
  await page.fill("#ad-title", "Test"); await page.fill("#ad-price", "100");
  const want = { instagram_square: [1080, 1080], instagram_portrait: [1080, 1350], story: [1080, 1920], facebook_post: [1200, 630], whatsapp_share: [1200, 900], print_a5: [1748, 2480] };
  for (const [fmt, [w, h]] of Object.entries(want)) {
    await page.selectOption("#pr-format", fmt); await settle(page);
    const { file } = await download(page, "#ex-png");
    assert.equal(py("from PIL import Image;import sys;im=Image.open(sys.argv[1]);print(im.size[0],im.size[1])", file), w + " " + h, fmt);
  }
});

await test("uploaded image replaces the product photo, stays in the browser (no upload, no db write); bad files are refused", async () => {
  const { page } = await open();
  await page.selectOption("#pr-product", "c1"); await settle(page);
  assert.match(await page.locator("#pr-imgnote").innerText(), /no photo/i);
  await page.setInputFiles("#pr-file", { name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") });
  await settle(page);
  assert.match(await page.locator("#pr-imgnote").innerText(), /not accepted/i);
  await page.setInputFiles("#pr-file", { name: "cable.png", mimeType: "image/png", buffer: png() });
  await page.waitForFunction(() => /uploaded image/i.test(document.querySelector("#pr-imgnote").textContent));
  assert.match(await page.locator("#pr-upload-label").innerText(), /Replace/);
  assert.deepEqual(await W(page), []);
});

await test("templates: built-ins are read-only; save a custom one, reuse it, update it, delete it; saved spec holds no product data or image", async () => {
  const { page, errors } = await open();
  await page.selectOption("#pr-product", "r1"); await page.fill("#ad-price", "1234");
  await page.selectOption("#pr-template", "builtin-classic");
  assert.equal(await page.locator("#tpl-update").count(), 0); assert.equal(await page.locator("#tpl-del").count(), 0);
  await openGroups(page);
  await page.evaluate(() => { const el = document.querySelector("#pc-colors-accent"); el.value = "#ff0000"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.selectOption("#pc-layout", "overlay"); await page.fill("#pc-cta-text", "Porosit tani");
  await page.click("#tpl-new"); await page.fill("#tpl-name", "Red overlay"); await page.click("#tpl-save");
  await page.waitForFunction(() => document.querySelector("#pr-template").selectedOptions[0].textContent === "Red overlay");
  const [t] = await T(page, "promo_templates");
  assert.equal(t.name, "Red overlay"); assert.equal(t.spec.layout, "overlay"); assert.equal(t.spec.colors.accent, "#ff0000"); assert.equal(t.spec.cta.text, "Porosit tani");
  assert.ok(!JSON.stringify(t).includes("1234") && !JSON.stringify(t).includes("data:") && !JSON.stringify(t).includes("Ruter"));
  // switching away and back restores the saved design
  await page.selectOption("#pr-template", "builtin-classic"); assert.equal(await page.inputValue("#pc-layout"), "stack");
  await page.selectOption("#pr-template", t.id); assert.equal(await page.inputValue("#pc-layout"), "overlay");
  await page.selectOption("#pc-align", "center"); await page.click("#tpl-update"); await settle(page);
  assert.equal((await T(page, "promo_templates"))[0].spec.align, "center");
  await page.click("#tpl-del"); await page.click(".confirm-box [data-yes]"); await settle(page);
  assert.deepEqual(await T(page, "promo_templates"), []);
  assert.deepEqual((await W(page)).map((w) => w.table).filter((x, i, a) => a.indexOf(x) === i), ["promo_templates"]);
  assert.deepEqual(errors, []);
});

await test("when the v7 table is missing, built-in templates still work and saving is explained", async () => {
  const { page, errors } = await open({ missing: ["promo_templates"] });
  assert.equal(await page.locator("#tpl-new").count(), 0);
  assert.match(await page.locator("#pr-tpl-note").innerText(), /supabase-migration-v7/);
  await page.fill("#ad-title", "A"); await page.fill("#ad-price", "5");
  const { file } = await download(page, "#ex-png"); assert.ok(fs.statSync(file).size > 1000);
  assert.deepEqual(errors, []);
});

await test("hostile text is just drawn as text (no HTML injection); very long title still fits and exports", async () => {
  const { page, errors } = await open();
  await page.fill("#ad-title", '<img src=x onerror=alert(1)> ' + "Superlonggiganticproductname ".repeat(12));
  await page.fill("#ad-description", "<script>alert(1)</script> " + "x".repeat(150)); await page.fill("#ad-price", "99999999.99"); await settle(page);
  const { file } = await download(page, "#ex-png"); assert.ok(fs.statSync(file).size > 1000);
  assert.deepEqual(errors, []);
});

await test("a design tweak (image placement, colours, typography) changes the exported pixels without any manual image editing", async () => {
  const { page } = await open();
  await page.selectOption("#pr-product", "r1"); await settle(page);
  const a = (await download(page, "#ex-png")).file;
  await openGroups(page);
  await page.selectOption("#pc-layout", "side"); await page.selectOption("#pc-fonts-heading", "serif");
  await page.evaluate(() => { const el = document.querySelector("#pc-bg-c1"); el.value = "#003300"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.evaluate(() => { const el = document.querySelector("#pc-image-offsetX"); el.value = "20"; el.dispatchEvent(new Event("input", { bubbles: true })); }); await settle(page);
  const b = (await download(page, "#ex-png")).file;
  assert.ok(!fs.readFileSync(a).equals(fs.readFileSync(b)), "design change must change the file");
  const p = py("from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert('RGB');print(*im.getpixel((4,4)))", b).split(" ").map(Number);
  assert.ok(p[1] > p[0] && p[1] > p[2] && p[0] < 100, "background colour 1 should now be dark green, got " + p);
});

await test("mobile width: controls stack, preview first, no horizontal scroll", async () => {
  const { page } = await open({ viewport: { width: 390, height: 800 } });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  assert.ok(await page.locator("#pr-canvas").isVisible());
});

await browser.close(); server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nALL PROMO E2E TESTS PASSED");
process.exit(failures ? 1 : 0);
