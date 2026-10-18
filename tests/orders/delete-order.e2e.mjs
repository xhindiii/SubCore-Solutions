/* Admin -> Orders: deleting an order. Fake Supabase, real Chromium.
   NODE_PATH=/opt/npm-tools/node_modules PW_PATH=/opt/npm-tools/node_modules/playwright node tests/orders/delete-order.e2e.mjs */
import assert from "node:assert/strict";
import { chromium, startServer, openAdmin, T, W } from "../helpers/admin-harness.mjs";
const { server, base } = await startServer();
const browser = await chromium.launch();
let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log("PASS ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", String(e.stack || e.message).split("\n").slice(0, 4).join("\n      ")); } };
const order = (o) => ({ id: 1, order_number: "SC-000001", customer_name: "Test Customer", customer_phone: "+355 68 111 2222", customer_email: "", delivery_address: "Tirana", notes: "",
  items: [{ id: "p", name: { en: "Cable" }, sku: "C", qty: 1, price: 100, currency: "ALL" }], total: 100, shipping: 0, status: "pending", created_at: "2026-10-18T10:00:00Z", ...o });
const seed = () => ({ orders: [order({ id: 1 }), order({ id: 2, order_number: "SC-000002", status: "cancelled" })] });
const orderDeletes = async (page) => (await W(page)).filter((w) => w.table === "orders" && w.op === "delete");

await test("admin sees Delete; a non-cancelled order cannot be deleted and says why", async () => {
  const { page, ctx } = await openAdmin(browser, base, { hash: "#orders/1", seed: seed() });
  await page.waitForSelector("#o-del");
  await page.click("#o-del"); await page.waitForTimeout(200);
  assert.equal(await page.locator(".confirm-bg").count(), 0, "no confirmation for a live order");
  assert.match(await page.locator("body").innerText(), /Cancel this order first/);
  assert.equal((await orderDeletes(page)).length, 0); assert.equal((await T(page, "orders")).length, 2);
  await ctx.close();
});
await test("cancelled order: Cancel on the confirmation keeps it; Delete removes only that order", async () => {
  const { page, ctx } = await openAdmin(browser, base, { hash: "#orders/2", seed: seed() });
  await page.waitForSelector("#o-del"); await page.click("#o-del");
  await page.waitForSelector(".confirm-bg [data-no]"); await page.click(".confirm-bg [data-no]"); await page.waitForTimeout(150);
  assert.equal((await orderDeletes(page)).length, 0); assert.equal((await T(page, "orders")).length, 2);
  await page.click("#o-del"); await page.waitForSelector(".confirm-bg [data-yes]");
  assert.match(await page.locator(".confirm-box").innerText(), /SC-000002/);
  await page.click(".confirm-bg [data-yes]"); await page.waitForTimeout(400);
  const left = await T(page, "orders");
  assert.deepEqual(left.map((o) => o.id), [1]); assert.equal((await orderDeletes(page)).length, 1);
  assert.doesNotMatch(await page.locator("#view, main").first().innerText(), /SC-000002/);
  await ctx.close();
});
for (const role of ["staff", "editor"]) await test(role + " has no Delete button for orders", async () => {
  const { page, ctx } = await openAdmin(browser, base, { role, hash: "#orders/2", seed: seed() });
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#o-del").count(), 0);
  await ctx.close();
});
await browser.close(); server.close();
console.log(failures ? failures + " FAILED" : "ALL PASSED"); process.exit(failures ? 1 : 0);
