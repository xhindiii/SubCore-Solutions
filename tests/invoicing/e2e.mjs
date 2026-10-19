/* True end-to-end test of Admin → Invoices in real Chromium.
   The admin page is the real code; its calls for the invoice tables and invoice functions are forwarded to the REAL SQL of
   supabase-migration-v8-invoicing.sql running in a throwaway local PostgreSQL (as the "authenticated" admin role, RLS on),
   so the UI → database contract, the maths, numbering and permissions are all exercised together. Products/orders/services the
   page lists come from the same database rows. Nothing touches Supabase or any network.
   Run (after tests/invoicing/run-db-tests.sh has built PostgreSQL once):
   NODE_PATH=/opt/npm-tools/node_modules PW_PATH=/opt/npm-tools/node_modules/playwright PGHOST=/tmp PGPORT=54329 PGUSER=pgtest node tests/invoicing/e2e.mjs */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { chromium, startServer, openAdmin, FAKE } from "../helpers/admin-harness.mjs";

const DB = "subcore_inv_e2e", ADMIN = "00000000-0000-0000-0000-0000000000a1", ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
const env = Object.assign({}, process.env, { PGHOST: process.env.PGHOST || "/tmp", PGPORT: process.env.PGPORT || "54329", PGUSER: process.env.PGUSER || "pgtest" });
const sh = (args, input) => spawnSync("psql", args, { input, env, encoding: "utf8", maxBuffer: 1 << 27 });
const admin = (sql) => { const r = sh(["-q", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", DB], `SET request.jwt.claim.sub='${ADMIN}'; SET ROLE authenticated;\n` + sql); return r; };
const su = (sql) => { const r = sh(["-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB], sql); if (r.status) throw new Error(r.stderr); return r.stdout.trim(); };

/* ---- build the throwaway database ---- */
sh(["-q", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${DB}`, "-c", `CREATE DATABASE ${DB}`]);
for (const f of ["tests/notifications/sql/harness.sql", "supabase-schema-fresh-install.sql", "supabase-migration-v3-store.sql", "supabase-migration-v4-security.sql", "supabase-migration-v5-notifications.sql", "supabase-migration-v6-portfolio.sql", "supabase-migration-v7-promo-reports.sql", "supabase-migration-v8-invoicing.sql"]) {
  const r = sh(["-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", path.join(ROOT, f)]); if (r.status) { console.error("setup failed", f, r.stderr); process.exit(1); }
}
su(`INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'admin@example.test');
UPDATE admin_users SET auth_user_id = '${ADMIN}' WHERE role = 'admin';
UPDATE products SET available = false;
INSERT INTO products (id, name, description, price, currency, sku, stock, available) VALUES
 ('p1', '{"en":"Router AX","sq":"Router AX"}', '{"en":"Wi-Fi 6 router","sq":"Router Wi-Fi 6"}', 10000, 'ALL', 'RT-AX', 10, true),
 ('p2', '{"en":"Cable","sq":"Kabllo"}', '{"en":"Cat6 cable","sq":"Kabllo Cat6"}', 2500.50, 'ALL', 'CB-6', 50, true);
INSERT INTO services (id, name, description, price, currency, available) VALUES
 ('s1', '{"en":"Setup","sq":"Instalim"}', '{"en":"On-site setup","sq":"Instalim në vend"}', 15000, 'ALL', true),
 ('s0', '{"en":"Consulting","sq":"Konsulencë"}', '{"en":"Per quote","sq":"Sipas ofertës"}', 0, 'ALL', true);
UPDATE website_settings SET value = '{"shipping_fee": 300, "free_shipping_over": 0}'::jsonb WHERE key = 'shop_settings';
SET ROLE anon;
SELECT order_number FROM place_order('Besnik Test', 'b@example.test', '0691234567', 'Rruga Test 9, Tiranë', 'zile', '[{"id":"p1","qty":2},{"id":"p2","qty":1}]'::jsonb);
SELECT order_number FROM place_order('Dritan Hoxha', '', '0687654321', 'Durrës', '', '[{"id":"p2","qty":3}]'::jsonb);`);
const rows = (t) => JSON.parse(su(`SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM ${t} x`));
const SEED = { products: rows("products"), services: rows("services"), orders: rows("orders") };
const stockBefore = su("SELECT stock FROM products WHERE id='p1'");

/* ---- bridge: page → real SQL ---- */
const lit = (v) => (v === null || v === undefined ? "NULL" : "'" + (typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/'/g, "''") + "'");
const ident = (s) => { if (!/^[a-z_]+$/.test(s)) throw new Error("bad identifier " + s); return s; };
const wrapErr = (r) => { const m = /ERROR:\s+(\w{5}):\s+([\s\S]*?)(?:\n|$)/.exec(r.stderr || ""); return { data: null, error: { code: m ? m[1] : "XX000", message: m ? m[2] : r.stderr } }; };
const TABLES = ["invoice_overview", "invoice_payments", "customers", "invoice_settings", "invoice_items", "invoice_events"];
let failRead = false;
const pgSelect = ({ table, filters, orders, maybe }) => {
  if (!TABLES.includes(table)) throw new Error("table not bridged " + table);
  if (failRead) return { data: null, error: { code: "42P01", message: 'relation "' + table + '" does not exist' } };
  const where = filters.length ? " WHERE " + filters.map(([c, v]) => ident(c) + " = " + lit(v)).join(" AND ") : "";
  const ord = orders.length ? " ORDER BY " + orders.map(([c, a]) => ident(c) + (a ? " ASC" : " DESC")).join(", ") : "";
  const r = admin(`SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM (SELECT * FROM ${ident(table)}${where}${ord}) t;`);
  if (r.status) return wrapErr(r);
  const data = JSON.parse(r.stdout.trim()); return { data: maybe ? data[0] || null : data, error: null };
};
const RPC = ["invoice_settings_save", "customer_save", "customer_set_archived", "invoice_save_draft", "invoice_delete_draft", "invoice_issue", "invoice_cancel", "invoice_record_payment", "invoice_reverse_payment"];
const rpcLog = [];
const pgRpc = (name, args) => {
  if (!RPC.includes(name)) throw new Error("rpc not bridged " + name);
  rpcLog.push(name);
  const r = admin(`SELECT ${name}(${Object.entries(args).map(([k, v]) => ident(k) + " => " + lit(v)).join(", ")});`);
  if (r.status) return wrapErr(r);
  const out = r.stdout.trim(); let data = null; if (out) { try { data = JSON.parse(out); } catch { data = out; } } return { data, error: null };
};

const BRIDGE = `(() => {
  const TB = ${JSON.stringify(TABLES)}, RP = ${JSON.stringify(RPC)};
  const orig = window.supabase.createClient;
  window.supabase.createClient = (...a) => {
    const c = orig(...a), of = c.from, orpc = c.rpc;
    c.from = (t) => {
      if (!TB.includes(t)) return of(t);
      const f = { table: t, filters: [], orders: [], maybe: false }, q = {
        select: () => q, eq: (c1, v) => { f.filters.push([c1, v]); return q; }, order: (c1, o) => { f.orders.push([c1, !(o && o.ascending === false)]); return q; }, maybeSingle: () => { f.maybe = true; return q; },
        then: (res, rej) => window.__pgSelect(f).then(res, rej) };
      return q;
    };
    c.rpc = (n, args) => RP.includes(n) ? window.__pgRpc(n, args) : orpc(n, args);
    return c;
  };
})();`;

const { server, base } = await startServer();
const browser = await chromium.launch();
let failures = 0, passes = 0;
const test = async (name, fn) => { try { await fn(); passes++; console.log("PASS ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", String(e.stack || e.message).split("\n").slice(0, 5).join(" | ").slice(0, 900)); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "invoicing-e2e-"));
const yr = su("SELECT extract(year FROM inv_today())");

async function open({ role = "admin", hash = "#invoices", viewport } = {}) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await page.route(/cdn\.jsdelivr\.net|fonts\.g/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.exposeFunction("__pgSelect", async (f) => pgSelect(f));
  await page.exposeFunction("__pgRpc", async (n, a) => pgRpc(n, a));
  await page.addInitScript(FAKE(role));
  await page.addInitScript(`(() => { const s = ${JSON.stringify(SEED)}; Object.keys(s).forEach((k) => window.__T[k].push(...s[k])); })();`);
  await page.addInitScript(BRIDGE);
  await page.addInitScript(`window.__opened = []; window.open = (u) => { window.__opened.push(u); return { closed: false }; };`);
  await page.goto(base + "admin.html" + hash);
  await page.waitForSelector("#app:not([hidden])", { timeout: 8000 });
  await page.waitForTimeout(500);
  return { page, ctx, errors };
}
const closeDrawers = (page) => page.evaluate(() => document.querySelectorAll(".drawer-bg, .confirm-bg").forEach((n) => n.remove()));
const itab = async (page, id) => { await closeDrawers(page); await page.click('[data-itab="' + id + '"]'); await page.waitForTimeout(250); };
const body = (page) => page.locator("#iv-body").innerText();
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const num = (s) => Number(String(s).replace(/[^\d.\-]/g, ""));
const money = (n) => Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dl = async (page, sel, name) => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(sel)]); const f = path.join(tmp, name || d.suggestedFilename()); await d.saveAs(f); return { f, name: d.suggestedFilename() }; };
const pdfText = (f) => execFileSync("pdftotext", ["-layout", f, "-"]).toString();
const q1 = (sql) => su(sql);

await test("only admins see Invoices / Faturat; editor and staff do not", async () => {
  for (const [role, expect] of [["admin", true], ["editor", false], ["staff", false]]) {
    const { page, ctx, errors } = await open({ role, hash: "#dashboard" });
    const has = await page.locator('#nav [data-nav="invoices"]').count();
    assert.equal(has > 0, expect, role);
    if (!expect) { await page.evaluate(() => (location.hash = "#invoices")); await page.waitForTimeout(300); assert.notEqual(await page.locator("#page-title").innerText(), "Invoices / Faturat"); }
    assert.deepEqual(errors, [], role); await ctx.close();
  }
});

await test("shows the install message when the v8 migration is missing", async () => {
  failRead = true; const { page, ctx } = await open(); failRead = false;
  assert.match(await page.locator("#view").innerText(), /supabase-migration-v8-invoicing\.sql/); await ctx.close();
});

let main;
await test("seven tabs exist; issuing is blocked until company details are saved; settings validate", async () => {
  main = await open(); const { page } = main;
  assert.equal(await page.locator("#page-title").innerText(), "Invoices / Faturat");
  const tabs = await page.locator("[data-itab]").allInnerTexts(); assert.deepEqual(tabs, ["Dashboard", "All invoices", "Create invoice", "Customers", "Payments", "Reports", "Invoice settings"]);
  assert.match(await page.locator("#view").innerText(), /Company details are not set up yet/);
  await itab(page, "settings");
  await page.fill('[data-sf="prefix"]', "bad prefix"); await page.fill('[data-sf="currency"]', "ALL"); await page.click("#st-save"); await settle(page);
  assert.equal(q1("SELECT count(*) FROM invoice_settings WHERE data ? 'company_name'"), "0", "invalid prefix must not save");
  await page.fill('[data-sf="company_name"]', "SubCore Test Sh.p.k."); await page.fill('[data-sf="address"]', "Rruga Test 1"); await page.fill('[data-sf="city"]', "Tiranë"); await page.fill('[data-sf="country"]', "Shqipëri");
  await page.fill('[data-sf="email"]', "info.subcoresolutions@gmail.com"); await page.fill('[data-sf="iban"]', "AL00 0000 0000 0000"); await page.fill('[data-sf="bank_name"]', "Banka Test");
  await page.fill('[data-sf="prefix"]', "sub-inv"); await page.fill('[data-sf="payment_terms_days"]', "10"); await page.fill('[data-sf="footer"]', "Faleminderit për besimin!");
  await page.click("#st-save"); await settle(page, 1000);
  const d = JSON.parse(q1("SELECT data FROM invoice_settings")); assert.equal(d.company_name, "SubCore Test Sh.p.k."); assert.equal(d.prefix, "SUB-INV");
  assert.ok(!("default_vat_rate" in d), "no VAT rate is assumed");
});

await test("customer created in the Customers tab", async () => {
  const { page } = main; await itab(page, "customers"); await page.click("#cu-new"); await page.waitForTimeout(200);
  await page.fill('[data-cf="name"]', "Alfa Sh.p.k."); await page.selectOption('[data-cf="kind"]', "business"); await page.fill('[data-cf="tax_id"]', "L12345678A"); await page.fill('[data-cf="phone"]', "0691112222"); await page.fill('[data-cf="address"]', "Rr. Durrësit 5"); await page.fill('[data-cf="city"]', "Tiranë");
  await page.click("#cf-save"); await settle(page, 1000);
  assert.equal(q1("SELECT count(*) FROM customers WHERE name='Alfa Sh.p.k.' AND tax_id='L12345678A'"), "1"); assert.match(await body(page), /Alfa Sh\.p\.k\./);
});

let draftTotal;
await test("create invoice from real products and a service; on-screen total equals the server total", async () => {
  const { page } = main; await itab(page, "create");
  await page.selectOption("#ed-cust", { label: "Alfa Sh.p.k." });
  await page.selectOption("#add-prod", "p1"); await page.selectOption("#add-prod", "p2"); await page.selectOption("#add-svc", "s1"); await page.click("#add-custom");
  await page.fill('[data-l="qty"][data-i="0"]', "2"); await page.selectOption('[data-l="discount_type"][data-i="0"]', "percent"); await page.fill('[data-l="discount_value"][data-i="0"]', "10");
  await page.fill('[data-l="qty"][data-i="1"]', "3");
  await page.fill('[data-l="discount_value"][data-i="2"]', "500");
  await page.fill('[data-l="name"][data-i="3"]', "Kabllim shtesë në vend"); await page.fill('[data-l="qty"][data-i="3"]', "2.5"); await page.fill('[data-l="unit_price"][data-i="3"]', "199.99");
  for (let i = 0; i < 4; i++) await page.fill('[data-l="vat_rate"][data-i="' + i + '"]', "20");
  await page.selectOption('[data-h="ovType"]', "percent"); await page.fill('[data-h="ovValue"]', "5"); await page.fill('[data-h="shipping"]', "300"); await page.fill('[data-h="shipVat"]', "0");
  const shown = num((await page.locator("#ed-totals tr").last().innerText()).split("\t").pop());
  await page.click("#ed-save"); await settle(page, 1200);
  assert.equal(q1("SELECT count(*) FROM invoices WHERE status='draft'"), "1");
  const db = Number(q1("SELECT total FROM invoices")); draftTotal = db;
  assert.equal(shown, db, "screen total " + shown + " vs server " + db);
  assert.equal(q1("SELECT unit_price FROM invoice_items WHERE source_id='p1'"), "10000.00");
  assert.equal(q1("SELECT number IS NULL FROM invoices"), "t");
  assert.match(await page.locator("#drawer-root").innerText(), /Draft invoice/);
});

await test("a changed catalogue price blocks issuing; updating prices then issuing gives SUB-INV-YYYY-000001", async () => {
  const { page } = main; su("UPDATE products SET price = 11000 WHERE id='p1'");
  await page.click("#dv-issue"); await page.waitForTimeout(200); await page.click(".confirm-bg [data-yes]"); await settle(page, 1200);
  assert.match(await page.locator(".confirm-bg").innerText(), /catalogue price changed/i);
  assert.equal(q1("SELECT count(*) FROM invoices WHERE number IS NOT NULL"), "0");
  await page.click(".confirm-bg [data-yes]"); await settle(page, 1500);
  assert.equal(q1("SELECT unit_price FROM invoice_items WHERE source_id='p1'"), "11000.00");
  await page.click("#dv-issue"); await page.waitForTimeout(200); await page.click(".confirm-bg [data-yes]"); await settle(page, 1500);
  assert.equal(q1("SELECT number FROM invoices"), "SUB-INV-" + yr + "-000001");
  assert.match(await page.locator("#drawer-root").innerText(), /SUB-INV-\d{4}-000001/);
  assert.equal(q1("SELECT status FROM invoices"), "issued");
});

await test("PDF: downloads, Albanian letters, correct totals, never claims fiscalization", async () => {
  const { page } = main; const total = Number(q1("SELECT total FROM invoices"));
  const f = await dl(page, "#dv-dl"); assert.equal(f.name, "SUB-INV-" + yr + "-000001.pdf");
  const t = pdfText(f.f);
  for (const must of ["SUB-INV-" + yr + "-000001", "Alfa Sh.p.k.", "SubCore Test Sh.p.k.", "Kabllim shtesë në vend", "Tiranë", "FATURË", "Faleminderit për besimin!", money(total), "nuk është faturë e fiskalizuar"]) assert.ok(t.includes(must), "PDF lacks: " + must + "\n" + t.slice(0, 600));
  assert.ok(!/NIVF\s*:|NSLF\s*:|fiscal code|QR/i.test(t), "PDF must not carry fiscal identifiers");
  assert.ok(!/DRAFT/.test(t));
  const png = path.join(tmp, "inv"); execFileSync("pdftoppm", ["-png", "-r", "60", "-f", "1", "-l", "1", f.f, png]); assert.ok(fs.readdirSync(tmp).some((x) => x.startsWith("inv") && x.endsWith(".png")));
});

await test("issued invoice is immutable: direct SQL edits, deletes and draft-editing are all refused", async () => {
  const r1 = admin("UPDATE invoices SET total = 1;"); assert.ok(r1.status !== 0);
  const r2 = admin("DELETE FROM invoice_items;"); assert.ok(r2.status !== 0);
  const r3 = admin("SELECT invoice_save_draft(jsonb_build_object('id', (SELECT id FROM invoices), 'customer', '{\"name\":\"X Y\"}'::jsonb), '[]'::jsonb);"); assert.match(r3.stderr, /not_draft/);
  assert.ok(Number(q1("SELECT total FROM invoices")) > 0);
});

let invTotal;
await test("partial payment, double-click safety, full payment, then reversal", async () => {
  const { page } = main; invTotal = Number(q1("SELECT total FROM invoices"));
  await page.click("#dv-pay"); await page.waitForTimeout(200);
  await page.fill("#pm-a", "1000"); await page.selectOption("#pm-m", "cash"); await page.fill("#pm-r", "REC-1");
  await Promise.all([page.click("#pm-save"), page.click("#pm-save").catch(() => {})]); await settle(page, 1500);
  assert.equal(q1("SELECT count(*) FROM invoice_payments"), "1", "double click must record once");
  assert.equal(q1("SELECT display_status FROM invoice_overview"), "partial"); assert.match(await page.locator("#drawer-root").innerText(), /Partly paid/);
  assert.equal(Number(q1("SELECT balance FROM invoice_overview")), invTotal - 1000);
  await page.click("#dv-pay"); await page.waitForTimeout(200); await page.fill("#pm-a", String(invTotal)); await page.click("#pm-save"); await settle(page, 1000);
  assert.equal(q1("SELECT count(*) FROM invoice_payments"), "1", "overpayment refused");
  await page.fill("#pm-a", (invTotal - 1000).toFixed(2)); await page.click("#pm-save"); await settle(page, 1500);
  assert.equal(q1("SELECT display_status FROM invoice_overview"), "paid"); assert.match(await page.locator("#drawer-root").innerText(), /Paid/);
  await page.click('[data-rev]:first-of-type'); await page.waitForTimeout(250); await page.fill("#at-v", "wrong invoice"); await page.click("#at-ok"); await settle(page, 1500);
  assert.equal(q1("SELECT display_status FROM invoice_overview"), "partial"); assert.equal(q1("SELECT count(*) FROM invoice_payments WHERE reversed"), "1");
  assert.equal(Number(q1("SELECT paid_amount FROM invoice_overview")), 1000, "the newest payment was reversed; the first (1000) remains");
  assert.equal(q1("SELECT count(*) FROM invoice_payments"), "2", "reversed payment stays in the history");
});

await test("order → invoice uses the ORIGINAL order prices, blocks duplicates, changes nothing on the order", async () => {
  const { page, ctx } = await open({ hash: "#orders" });
  su("UPDATE products SET price = 99999 WHERE id='p1'");   // shop price moves after the order was placed
  const orderRow = JSON.parse(q1("SELECT to_jsonb(o) FROM orders o WHERE order_number = (SELECT order_number FROM orders ORDER BY id LIMIT 1)"));
  await page.evaluate((id) => (location.hash = "#orders/" + id), orderRow.id); await page.waitForTimeout(500);
  await page.click("#o-inv-new"); await settle(page, 800);
  assert.match(await page.locator("#page-title").innerText(), /Invoices/);
  assert.match(await page.locator("#iv-body").innerText(), /from order/);
  const priceCell = await page.locator('[data-l="unit_price"][data-i="0"]').inputValue(); assert.equal(Number(priceCell), 10000, "original recorded price, not 99999");
  assert.equal(await page.locator('[data-l="qty"][data-i="0"]').isDisabled(), true); assert.equal(await page.locator('[data-h="shipping"]').isDisabled(), true);
  await page.click("#ed-save"); await settle(page, 1500);
  const inv = JSON.parse(q1(`SELECT to_jsonb(i) FROM invoices i WHERE order_id = ${orderRow.id}`));
  assert.equal(Number(inv.total), Number(orderRow.total), "invoice equals the order total when no VAT is typed");
  assert.equal(inv.order_ref, orderRow.order_number);
  assert.equal(q1("SELECT status FROM orders WHERE id=" + orderRow.id), "pending"); assert.equal(q1("SELECT stock FROM products WHERE id='p1'"), stockBefore);
  const dup = admin(`SELECT invoice_save_draft('{"order_id": ${orderRow.id}, "customer": {"name":"Zed Zed"}}', '[]');`); assert.match(dup.stderr, /order_already_invoiced/);
  await page.click("#dv-order"); await page.waitForTimeout(700);   // invoice → order link
  assert.ok((await page.locator("#o-inv-open").count()) > 0, "order now offers Open invoice (order → invoice link)");
  assert.equal(await page.locator("#o-inv-new").count(), 0);
  su("UPDATE products SET price = 10000 WHERE id='p1'");
  await ctx.close();
});

await test("a product added to the shop later is selectable straight away (no second catalogue to maintain)", async () => {
  su("INSERT INTO products (id, name, description, price, currency, sku, stock, available) VALUES ('p3', '{\"en\":\"New gadget\",\"sq\":\"Gadget i ri\"}', '{\"en\":\"\",\"sq\":\"\"}', 777, 'ALL', 'NG-1', 5, true)");
  SEED.products = rows("products");   // what the shop catalogue now holds; the invoice editor reads the same list
  const { page, ctx } = await open();
  await itab(page, "create"); const opts = await page.locator("#add-prod option").allInnerTexts();
  assert.ok(opts.some((o) => /New gadget/.test(o) && /NG-1/.test(o)), opts.join(" | ")); assert.ok(opts.some((o) => /Router AX/.test(o)));
  await page.selectOption("#add-prod", "p3"); assert.equal(await page.locator('[data-l="unit_price"][data-i="0"]').inputValue(), "777");
  await ctx.close(); su("DELETE FROM products WHERE id='p3'"); SEED.products = rows("products");
});

await test("dashboard and reports reconcile exactly with the database", async () => {
  const { page } = main; await itab(page, "dashboard");
  const inv = Number(q1("SELECT coalesce(sum(total),0) FROM invoices WHERE status='issued'")), rec = Number(q1("SELECT coalesce(sum(amount),0) FROM invoice_payments WHERE NOT reversed")), out = Number(q1("SELECT coalesce(sum(balance),0) FROM invoice_overview WHERE status='issued'"));
  assert.equal(Math.round((inv - rec) * 100), Math.round(out * 100), "invoiced - received = outstanding");
  const t = await body(page);
  for (const v of [inv, rec, out]) assert.ok(t.includes(money(v)), "dashboard lacks " + money(v) + "\n" + t.slice(0, 500));
  await itab(page, "reports"); await page.click('[data-rq="all"]'); await page.waitForTimeout(300);
  const r = await body(page); for (const v of [inv, rec, out]) assert.ok(r.includes(money(v)), "report lacks " + money(v));
  assert.ok(!/Reconciliation warning/.test(r));
  const f = await dl(page, "#rp-csv-i"); const csv = fs.readFileSync(f.f, "utf8"); const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines.length - 1, Number(q1("SELECT count(*) FROM invoices WHERE status<>'draft'"))); assert.ok(csv.includes(inv.toFixed(2)));
  const p = await dl(page, "#rp-csv-p"); assert.ok(fs.readFileSync(p.f, "utf8").includes("REC-1"));
});

await test("WhatsApp opens the admin's own WhatsApp with the invoice text; claims no delivery or payment", async () => {
  const { page } = main; await itab(page, "list"); await page.click("[data-open-inv] >> nth=0"); await settle(page, 600);
  await page.click("#dv-wa"); await page.waitForTimeout(200);
  const opened = await page.evaluate(() => window.__opened); assert.ok(opened.length === 1 && opened[0].startsWith("https://wa.me/355691112222?text="), String(opened[0]));
  const text = decodeURIComponent(opened[0].split("text=")[1]); assert.match(text, /SUB-INV-\d{4}-000001/); assert.doesNotMatch(text, /paguar|paid|delivered|dërguar/i);
  assert.match(await page.locator("#toasts").innerText(), /nothing was sent/i);
});

await test("cancel needs a reason, is blocked while payments are active, keeps the number and frees nothing", async () => {
  const { page } = main;
  await page.click("#dv-cancel"); await page.waitForTimeout(300);
  assert.equal(q1("SELECT status FROM invoices WHERE number='SUB-INV-" + yr + "-000001'"), "issued", "blocked while payment exists");
  await page.click('[data-rev]:first-of-type'); await page.waitForTimeout(250); await page.fill("#at-v", "customer returned goods"); await page.click("#at-ok"); await settle(page, 1500);
  await page.click("#dv-cancel"); await page.waitForTimeout(300); await page.fill("#at-v", "issued by mistake"); await page.click("#at-ok"); await settle(page, 1500);
  assert.equal(q1("SELECT status || '|' || number FROM invoices WHERE cancel_reason='issued by mistake'"), "cancelled|SUB-INV-" + yr + "-000001");
  assert.match(await page.locator("#drawer-root").innerText(), /Cancelled/);
});

await test("a second invoice gets the next number (the cancelled number is never reused)", async () => {
  const { page } = main; await closeDrawers(page);
  await page.click("#iv-new"); await page.waitForTimeout(200);
  await page.fill('[data-c="name"]', "Klient Ë Ç"); await page.click("#add-custom"); await page.fill('[data-l="name"][data-i="0"]', "Shërbim"); await page.fill('[data-l="unit_price"][data-i="0"]', "5000"); await page.fill('[data-l="vat_rate"][data-i="0"]', "0");
  await page.click("#ed-issue"); await page.waitForTimeout(300); await page.click(".confirm-bg [data-yes]"); await settle(page, 1800);
  assert.equal(q1("SELECT string_agg(number || ':' || status, ',' ORDER BY number) FROM invoices WHERE number IS NOT NULL"), "SUB-INV-" + yr + "-000001:cancelled,SUB-INV-" + yr + "-000002:issued");
});

await test("mobile (390px): create and list screens do not overflow horizontally", async () => {
  const { page, ctx } = await open({ viewport: { width: 390, height: 800 } });
  for (const t of ["dashboard", "list", "create", "customers", "payments", "reports", "settings"]) {
    await itab(page, t); const o = await page.evaluate(() => { const w = window.innerWidth, bad = []; document.querySelectorAll("#view *").forEach((n) => { const b = n.getBoundingClientRect(); if (b.right > w + 2 && b.width > 0) bad.push(n.tagName + "." + (n.className || "") + " right=" + Math.round(b.right)); }); return { over: document.documentElement.scrollWidth - w, bad: bad.slice(0, 5) }; }); assert.ok(o.over <= 2, t + " overflows by " + o.over + " " + JSON.stringify(o.bad));
  }
  await ctx.close();
});

await test("no unexpected JavaScript errors in the main session (the one deliberate invalid-prefix rejection is expected)", async () => { assert.deepEqual(main.errors.filter((e) => !/number prefix must be capital letters|overpayment: only/.test(e)), []); });
await test("all invoice writes went through server functions (no direct table writes from the page)", async () => {
  const w = await main.page.evaluate(() => window.__writes.filter((x) => /invoice|customers/.test(x.table))); assert.deepEqual(w, []);
  assert.ok(["invoice_save_draft", "invoice_issue", "invoice_record_payment", "invoice_reverse_payment", "invoice_cancel", "customer_save", "invoice_settings_save"].every((n) => rpcLog.includes(n)), rpcLog.join(","));
});

await browser.close(); server.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
