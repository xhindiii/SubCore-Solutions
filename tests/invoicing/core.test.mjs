import test from "node:test"; import assert from "node:assert/strict"; import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../../invoices-core.js");
test("half-up rounding like PostgreSQL (2.5 x 199.99)", () => { assert.equal(C.compute([{ qty: 2.5, unit_price: 199.99 }], {}).lines[0].line_gross, 499.98); });
test("0.005 style ties round up", () => { assert.equal(C.compute([{ qty: 1, unit_price: 0.01, discount_type: "percent", discount_value: 50 }], {}).lines[0].line_discount, 0.01); });
test("overall discount shares add up exactly", () => {
  const r = C.compute([{ qty: 1, unit_price: 33.33 }, { qty: 1, unit_price: 33.33 }, { qty: 1, unit_price: 33.34 }], { discountType: "amount", discountValue: 10 });
  assert.equal(Math.round(r.lines.reduce((a, l) => a + l.overall_discount_share, 0) * 100), 1000);
});
test("discount cannot exceed the amount", () => { const r = C.compute([{ qty: 1, unit_price: 10, discount_type: "amount", discount_value: 99 }], {}); assert.equal(r.total, 0); });
test("no VAT unless typed", () => { assert.equal(C.compute([{ qty: 3, unit_price: 100 }], { shipping: 50 }).tax_total, 0); });
test("totals = sum of rounded lines + delivery", () => {
  const r = C.compute([{ qty: 3, unit_price: 9.99, vat_rate: 20 }, { qty: 1, unit_price: 0.5, vat_rate: 20 }], { shipping: 5, shippingVat: 20 });
  const lines = Math.round(r.lines.reduce((a, l) => a + l.line_total, 0) * 100);
  assert.equal(Math.round(r.total * 100), lines + 500 + 100);
});
test("status rules", () => {
  const now = new Date("2026-06-15T10:00:00Z");
  assert.equal(C.displayStatus({ status: "issued", total: 100, due_date: "2026-06-20" }, 0, now), "issued");
  assert.equal(C.displayStatus({ status: "issued", total: 100, due_date: "2026-06-20" }, 40, now), "partial");
  assert.equal(C.displayStatus({ status: "issued", total: 100, due_date: "2026-06-10" }, 40, now), "overdue");
  assert.equal(C.displayStatus({ status: "issued", total: 100, due_date: "2026-06-10" }, 100, now), "paid");
  assert.equal(C.displayStatus({ status: "cancelled", total: 100 }, 0, now), "cancelled");
});
const inv = (o) => Object.assign({ id: "i" + Math.random(), status: "issued", currency: "ALL", issue_date: "2026-06-05", due_date: "2026-06-30", total: 100, tax_total: 0, taxable_total: 100, shipping: 0, paid_amount: 0, customer: { name: "A" } }, o);
test("summary: invoiced, received and outstanding stay separate and per currency", () => {
  const a = inv({ id: "a", total: 100, paid_amount: 30 }), b = inv({ id: "b", total: 50, currency: "EUR" }), c = inv({ id: "c", status: "cancelled", total: 999 }), d = inv({ id: "d", status: "draft", total: 777 });
  const pays = [{ invoice_id: "a", amount: 30, paid_on: "2026-06-10" }, { invoice_id: "a", amount: 20, paid_on: "2026-06-11", reversed: true }];
  const s = C.summarize([a, b, c, d], pays, { from: "2026-06-01", to: "2026-06-30" }, new Date("2026-06-15T10:00:00Z"));
  assert.deepEqual([s.ALL.invoiced, s.ALL.received, s.ALL.outstanding, s.ALL.drafts, s.ALL.cancelled], [100, 30, 70, 1, 1]);
  assert.deepEqual([s.EUR.invoiced, s.EUR.received, s.EUR.outstanding], [50, 0, 50]);
  assert.equal(s.ALL.invoicedCheck, true);
});
test("order reconciliation", () => {
  const orders = [{ id: 1, total: 100, status: "pending" }, { id: 2, total: 200, status: "pending" }, { id: 3, total: 300, status: "cancelled" }, { id: 4, total: 50, status: "pending" }];
  const r = C.orderReconciliation(orders, [inv({ order_id: 1, total: 100 }), inv({ order_id: 2, total: 240 })]);
  assert.equal(r.notInvoiced, 1); assert.equal(r.notInvoicedValue, 50); assert.equal(r.differs.length, 1);
});
test("CSV rows exclude drafts and show balances", () => {
  const rows = C.invoiceCsvRows([inv({ number: "N1", paid_amount: 10 }), inv({ status: "draft" })], new Date("2026-06-15T10:00:00Z"));
  assert.equal(rows.length, 1); assert.equal(rows[0][12], "90.00");
});
test("WhatsApp phone normalisation + text never claims delivery/payment", () => {
  assert.equal(C.waPhone("0691234567"), "355691234567"); assert.equal(C.waPhone("+355 69 123 4567"), "355691234567"); assert.equal(C.waPhone("00355691234567"), "355691234567");
  const t = C.whatsappText({ number: "SUB-INV-2026-000001", currency: "ALL", total: 100, due_date: "2026-06-30", customer: { name: "Besnik" } }, { company_name: "X" }, "sq");
  assert.match(t, /SUB-INV-2026-000001/); assert.doesNotMatch(t, /paguar|paid|dërguar|delivered/i);
});
test("error helpers", () => { assert.equal(C.errCode(new Error("price_changed: x")), "price_changed"); assert.equal(C.errText(new Error("price_changed: Çmimi")), "Çmimi"); });
