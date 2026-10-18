/* Real-Chromium test of Admin -> Reports against an in-memory fake of Supabase.
   NODE_PATH=/opt/npm-tools/node_modules PW_PATH=/opt/npm-tools/node_modules/playwright node tests/reports/admin.e2e.mjs */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, startServer, openAdmin, T, W } from "../helpers/admin-harness.mjs";

const { server, base } = await startServer();
const browser = await chromium.launch();
let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log("PASS ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", String(e.stack || e.message).split("\n").slice(0, 4).join(" | ").slice(0, 600)); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reports-"));
let dl = 0;

const yr = new Date().getUTCFullYear();
const item = (id, name, qty, price, cur = "ALL") => ({ id, name, sku: id.toUpperCase(), qty, price, currency: cur });
const order = (o) => ({ id: 1, order_number: "SC-000001", customer_name: "Ana Kola", customer_phone: "+355 68 111 2222", customer_email: "", delivery_address: "Tirana", notes: "",
  items: [item("r1", "Router", 2, 100)], total: 200, shipping: 0, status: "completed", created_at: yr + "-03-05T10:00:00Z", ...o });
const ORDERS = [
  order({ id: 1, order_number: "SC-000001" }),                                                                               // counted
  order({ id: 2, order_number: "SC-000002", created_at: yr + "-03-05T10:04:00Z" }),                                         // duplicate of 1
  order({ id: 3, order_number: "SC-000003", status: "cancelled", customer_phone: "0670000001", created_at: yr + "-03-06T09:00:00Z" }), // cancelled
  order({ id: 4, order_number: "SC-000004", customer_name: "Bledi", customer_phone: "0670000002", items: [item("c1", "Cable", 3, 50), item("r1", "Router", 1, 100)], total: 270, shipping: 20, created_at: yr + "-04-10T12:00:00Z" }),
  order({ id: 5, order_number: "SC-000005", customer_phone: "0670000003", items: [item("e1", "Euro item", 1, 10, "EUR")], total: 10, created_at: yr + "-04-11T12:00:00Z" })
];
const inv = (o) => ({ number: "INV-" + yr + "-0001", status: "issued", currency: "ALL", issueDate: yr + "-03-02", dueDate: yr + "-04-02", customer: { name: "Acme Sh.p.k.", taxId: "K12345678L" },
  items: [{ id: "i", name: "Support", sku: "SUP", qty: "1", unitPrice: "100", discountType: "percent", discount: "10", vatRate: "20" }], globalDiscount: { enabled: false }, payments: [], ...o });
const BACKUP = { app: "subcore-invoicing", type: "backup", version: 1, exportedAt: yr + "-10-18T10:00:00Z", settings: {}, catalogue: [], invoices: [
  inv({ number: "INV-1", payments: [{ date: yr + "-03-10", method: "bank", amount: "50" }] }),                  // net 90, vat 18, total 108, paid 50, out 58
  inv({ number: "INV-2", issueDate: yr + "-04-05", dueDate: yr + "-05-05", customer: { name: "Beta" }, items: [{ id: "i", name: "Hosting", sku: "H", qty: "1", unitPrice: "200", vatRate: "0" }], payments: [{ date: yr + "-04-06", amount: "200" }] }), // total 200 paid
  inv({ number: "INV-3", status: "cancelled" }), inv({ number: "INV-4", status: "draft" }), inv({ number: " inv-1 ", issueDate: yr + "-03-03" })   // cancelled, draft, duplicate number
] };
const bfile = path.join(tmp, "backup.json"); fs.writeFileSync(bfile, JSON.stringify(BACKUP));

const open = (o = {}) => openAdmin(browser, base, { hash: "#reports", seed: { orders: JSON.parse(JSON.stringify(ORDERS)) }, ...o });
const txt = (page, sel = "#rp-out") => page.locator(sel).innerText();
const tab = async (page, id) => { await page.click('[data-rtab="' + id + '"]'); await page.waitForTimeout(150); };
const setDates = async (page, from, to) => { await page.fill("#f-from", from); await page.fill("#f-to", to); await page.waitForTimeout(150); };
const download = async (page, sel) => { const [d] = await Promise.all([page.waitForEvent("download"), page.click(sel)]); const f = path.join(tmp, (++dl) + "-" + d.suggestedFilename()); await d.saveAs(f); return { f, name: d.suggestedFilename() }; };

await test("Reports is admin-only", async () => {
  for (const [role, expect] of [["admin", true], ["editor", false], ["staff", false]]) {
    const { page, errors } = await open({ role, hash: "#dashboard" });
    assert.equal(await page.locator('#nav [data-nav="reports"]').count() > 0, expect, role);
    assert.deepEqual(errors, [], role);
  }
});

await test("orders: cancelled and duplicate are excluded and listed; totals per currency; delivery separate; unrecorded data is stated, not zero", async () => {
  const { page, errors } = await open();
  await setDates(page, yr + "-01-01", yr + "-12-31");
  const t = await txt(page);
  // counted: SC-1 (200), SC-4 (goods 250 + 20 delivery = 270), EUR order 10
  assert.match(t, /ALL[\s\S]*Orders counted\s*\n?\s*2/);
  assert.match(t, /Goods\s*\n?\s*450\.00/); assert.match(t, /Delivery\s*\n?\s*20\.00/); assert.match(t, /Total ordered\s*\n?\s*470\.00/);
  assert.match(t, /EUR[\s\S]*Total ordered\s*\n?\s*10\.00/);
  assert.match(t, /Cancelled: 1/); assert.match(t, /Suspected duplicates \(counted once\): 1/);
  assert.match(t, /not recorded/);
  assert.match(t, /not what was paid or invoiced/);
  assert.deepEqual(errors, []);
  await page.check("#f-dups"); await page.waitForTimeout(150);
  assert.match(await txt(page), /Total ordered\s*\n?\s*670\.00/);
});

await test("orders: month table, date-range, customer and product filters", async () => {
  const { page } = await open();
  await setDates(page, yr + "-01-01", yr + "-12-31");
  let t = await txt(page); assert.match(t, new RegExp("Mar " + yr)); assert.match(t, new RegExp("Apr " + yr));
  await setDates(page, yr + "-04-01", yr + "-04-30"); t = await txt(page); assert.ok(!t.includes("Mar " + yr + "\t")); assert.match(t, /Orders counted\s*\n?\s*1/);
  await setDates(page, yr + "-01-01", yr + "-12-31");
  await page.fill("#f-customer", "bledi"); await page.waitForTimeout(400); assert.match(await txt(page), /Total ordered\s*\n?\s*270\.00/);
  await page.fill("#f-customer", ""); await page.fill("#f-product", "cable"); await page.waitForTimeout(400);
  t = await txt(page); assert.match(t, /Total ordered\s*\n?\s*150\.00/); assert.match(t, /Delivery\s*\n?\s*0\.00/); // only the matching line, delivery not attributed to a product
});

await test("invoices: backup is validated; garbage files refused; numbers come from the invoice engine; invoiced vs received vs outstanding", async () => {
  const { page, errors } = await open();
  await tab(page, "invoices"); await setDates(page, yr + "-01-01", yr + "-12-31");
  assert.match(await txt(page), /Load a backup file/);
  const bad = path.join(tmp, "bad.json"); fs.writeFileSync(bad, '{"hello":1}');
  await page.setInputFiles("#inv-file", bad); await page.waitForTimeout(200);
  assert.match(await txt(page, "#toasts"), /not a SubCore invoice backup/);
  fs.writeFileSync(bad, "not json at all"); await page.setInputFiles("#inv-file", bad); await page.waitForTimeout(200);
  assert.match(await txt(page, "#toasts"), /not valid JSON/);
  await page.setInputFiles("#inv-file", bfile); await page.waitForSelector(".rp-cur");
  const t = await txt(page);
  assert.match(t, /Invoices counted\s*\n?\s*2/);
  assert.match(t, /Net \(before VAT\)\s*\n?\s*290\.00/);   // 90 + 200
  assert.match(t, /VAT\s*\n?\s*18\.00/);
  assert.match(t, /Discounts given\s*\n?\s*10\.00/);
  assert.match(t, /Invoiced \(total\)\s*\n?\s*308\.00/);    // 108 + 200
  assert.match(t, /Received\s*\n?\s*250\.00/);              // 50 + 200
  assert.match(t, /Outstanding\s*\n?\s*58\.00/);
  assert.match(t, /Cancelled: 1/); assert.match(t, /Drafts \(not issued\): 1/); assert.match(t, /Suspected duplicates \(counted once\): 1/);
  assert.match(t, /Invoiced is not the same as received/);
  assert.deepEqual(await W(page), []); assert.deepEqual(errors, []); // nothing is stored
});

await test("invoices: status filter and overdue are derived correctly; duplicate numbers can be re-included explicitly", async () => {
  const { page } = await open();
  await tab(page, "invoices"); await page.setInputFiles("#inv-file", bfile); await page.waitForSelector(".rp-cur");
  await setDates(page, yr + "-01-01", yr + "-12-31");
  await page.selectOption("#f-status", "paid"); await page.waitForTimeout(150); assert.match(await txt(page), /Invoices counted\s*\n?\s*1/);
  await page.selectOption("#f-status", "all"); await page.check("#f-dups"); await page.waitForTimeout(150);
  assert.match(await txt(page), /Invoices counted\s*\n?\s*3/);
});

await test("purchases: add, duplicate refused, payment, void with reason (never deleted), reports follow", async () => {
  const { page, errors } = await open();
  await tab(page, "purchases"); await setDates(page, yr + "-01-01", yr + "-12-31");
  assert.match(await txt(page), /No documents/);
  const add = async (o) => {
    await page.click("#pu-add");
    await page.fill("#pu-supplier", o.supplier); await page.fill("#pu-number", o.number); await page.fill("#pu-date", o.date);
    await page.fill("#pu-net", o.net ?? ""); await page.fill("#pu-vat", o.vat ?? ""); if (o.total) await page.fill("#pu-total", o.total);
    if (o.paid) { await page.fill("#pu-paid", o.paid); await page.fill("#pu-paiddate", o.paidDate); }
    await page.click("#pu-save");
  };
  await add({ supplier: "ACME Ltd", number: "F-100", date: yr + "-03-03", net: "1000", vat: "200", paid: "500", paidDate: yr + "-03-04" });
  await page.waitForSelector(".rp-cur");
  let t = await txt(page);
  assert.match(t, /Recorded \(total\)\s*\n?\s*1,200\.00/); assert.match(t, /Paid\s*\n?\s*500\.00/); assert.match(t, /Outstanding\s*\n?\s*700\.00/);
  const [row] = await T(page, "purchase_records");
  assert.equal(row.total_amount, 1200); assert.equal(row.vat_amount, 200); assert.equal(row.paid_amount, 500);
  // duplicate refused with a clear message
  await add({ supplier: "acme ltd", number: "f-100", date: yr + "-03-05", total: "10" });
  await page.waitForSelector("#pu-err:not([hidden])"); assert.match(await txt(page, "#pu-err"), /already recorded/);
  await page.click("[data-x]");
  // invalid totals are caught in the form
  await add({ supplier: "X", number: "N1", date: yr + "-03-05", net: "10", vat: "1", total: "12" });
  assert.match(await txt(page, "#pu-err"), /Net \+ VAT must equal/); await page.click("[data-x]");
  await add({ supplier: "X", number: "N2", date: yr + "-03-05", total: "10", paid: "11", paidDate: yr + "-03-05" });
  assert.match(await txt(page, "#pu-err"), /more than the total/); await page.click("[data-x]");
  // record a second document then a payment on it
  await add({ supplier: "Beta", number: "B-1", date: yr + "-04-02", total: "300" });
  await page.waitForFunction(() => document.querySelectorAll("[data-pay]").length === 2);
  await page.locator('tr:has-text("B-1") [data-pay]').click(); await page.fill("#py-paid", "300"); await page.click("#py-save");
  await page.waitForFunction(() => /Paid\s*\n?\s*800\.00/.test(document.querySelector("#rp-out").innerText));
  // void needs a reason, then it is excluded and listed, row is kept
  await page.locator('tr:has-text("B-1") [data-void]').click(); await page.click("#vd-save");
  assert.match(await txt(page, "#vd-err"), /Enter a reason/);
  await page.fill("#vd-reason", "entered twice"); await page.click("#vd-save");
  await page.waitForFunction(() => /Voided: 1/.test(document.querySelector("#rp-out").innerText));
  t = await txt(page); assert.match(t, /Recorded \(total\)\s*\n?\s*1,200\.00/);
  const rows = await T(page, "purchase_records");
  assert.equal(rows.length, 2); assert.equal(rows.find((r) => r.doc_number === "B-1").voided, true);
  assert.ok(!(await W(page)).some((w) => w.op === "delete"), "no delete is ever issued");
  assert.ok((await W(page)).every((w) => w.table === "purchase_records"));
  assert.deepEqual(errors, []);
});

await test("compare: never called profit, labelled difference of recorded documents, per currency, invoiced vs received kept apart", async () => {
  const { page } = await open({ seed: { orders: JSON.parse(JSON.stringify(ORDERS)), purchase_records: [
    { id: 1, supplier: "ACME", doc_number: "F1", doc_date: yr + "-03-03", currency: "ALL", net_amount: null, vat_amount: null, total_amount: 100, paid_amount: 40, paid_date: yr + "-03-04", note: "", voided: false, void_reason: null }] } });
  await tab(page, "compare"); await setDates(page, yr + "-01-01", yr + "-12-31");
  await page.selectOption("#f-basis", "orders"); await page.waitForTimeout(200);
  let t = await txt(page);
  assert.match(t, /This is not profit/i); assert.match(t, /Difference of recorded documents/);
  assert.ok(!/\bprofit\s*[:\n]/i.test(t.replace(/not profit/gi, "").replace(/for profit/gi, "")), "must not present a profit figure");
  assert.match(t, /Ordered sales \(recorded\)\s*\n?\s*470\.00/); assert.match(t, /Purchases \(recorded\)\s*\n?\s*100\.00/); assert.match(t, /Difference of recorded documents\s*\n?\s*370\.00/);
  assert.match(t, /EUR/);
  await page.selectOption("#f-basis", "invoices"); await page.waitForTimeout(150); assert.match(await txt(page), /Load an invoice backup file/);
  await page.setInputFiles("#inv-file", bfile); await page.waitForSelector(".rp-cur");
  t = await txt(page);
  assert.match(t, /Invoiced sales \(recorded\)\s*\n?\s*308\.00/); assert.match(t, /Received from customers\s*\n?\s*250\.00/); assert.match(t, /Paid to suppliers\s*\n?\s*40\.00/); assert.match(t, /Difference of payments recorded\s*\n?\s*210\.00/);
});

await test("CSV exports: documents and monthly, spreadsheet-safe, plain decimals", async () => {
  const evil = order({ id: 9, order_number: "=HYPERLINK(1)", customer_name: "+cmd|x", customer_phone: "0670000009", created_at: yr + "-05-05T10:00:00Z", items: [item("z", "Z", 1, 1234.5)], total: 1234.5 });
  const { page } = await open({ seed: { orders: [evil] } });
  await setDates(page, yr + "-01-01", yr + "-12-31");
  const { f, name } = await download(page, "#csv-detail");
  assert.match(name, /^subcore-orders-documents-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = fs.readFileSync(f, "utf8");
  assert.ok(csv.startsWith("﻿order,date,status,customer,currency,goods,shipping,total,flag"));
  assert.ok(csv.includes("'=HYPERLINK(1)") && csv.includes("'+cmd|x")); assert.ok(csv.includes("1234.50") && !csv.includes("1,234"));
  const m = fs.readFileSync((await download(page, "#csv-month")).f, "utf8"); assert.match(m, /month,currency,count,goods,shipping,total\r\n/); assert.ok(m.includes(yr + "-05,ALL,1,1234.50,0.00,1234.50"));
});

await test("print: chrome is hidden, report header + caveats are shown; the PDF text proves it", async () => {
  const { page } = await open();
  await setDates(page, yr + "-01-01", yr + "-12-31");
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".side").isVisible(), false); assert.equal(await page.locator(".rp-printhead").isVisible(), true);
  assert.equal(await page.locator(".rp-tabs").isVisible(), false);
  const pdf = path.join(tmp, "report.pdf"); await page.pdf({ path: pdf, format: "A4" });
  const text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
  assert.match(text, /Sales report — shop orders/); assert.match(text, /Period:/); assert.match(text, /not recorded/); assert.ok(!/Sales — invoices/.test(text), "tab bar must not print");
});

await test("v7 missing: purchases and promo degrade to a clear message; orders report still works", async () => {
  const { page, errors } = await open({ missing: ["purchase_records", "promo_templates"] });
  await tab(page, "purchases"); assert.match(await txt(page), /not installed yet[\s\S]*supabase-migration-v7/);
  await tab(page, "orders"); assert.match(await txt(page), /Orders counted/);
  assert.deepEqual(errors, []);
});

await test("mobile: no horizontal page scroll", async () => {
  const { page } = await open({ viewport: { width: 390, height: 800 } });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
});

await browser.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nALL REPORTS E2E TESTS PASSED");
process.exit(failures ? 1 : 0);
