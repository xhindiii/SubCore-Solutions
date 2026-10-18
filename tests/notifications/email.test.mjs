import test from "node:test";
import assert from "node:assert/strict";
import { renderOrderEmail, clean, money, orderLink, parseItems, formatDateTime, statusLabel } from "../../supabase/functions/send-notifications/email.ts";

const ADMIN = "https://subcoresolutions.online/admin.html";
const base = () => ({
  id: 12, order_number: "SC-000012", customer_name: "Ardit Hoxha", customer_phone: "+355 68 111 2222", customer_email: "ardit@example.test",
  items: [{ id: "p1", name: { en: "Cat6 cable", sq: "Kabllo Cat6" }, sku: "C6-10", qty: 2, price: 1200, currency: "ALL" }, { id: "p2", name: { en: "Mouse" }, qty: 1, price: 2500.5, currency: "ALL" }],
  total: 5400.5, shipping: 500, status: "pending", created_at: "2026-10-18T17:05:00Z",
});
const render = (o = base(), ev = "order_submitted", extra = {}) => renderOrderEmail(ev, o, { adminUrl: ADMIN, ...extra });

test("submitted order: subject, reference, items, total, currency", () => {
  const m = render();
  assert.match(m.subject, /^\[SubCore\] New order submitted SC-000012/);
  assert.match(m.subject, /3 items/);
  assert.match(m.subject, /5,400\.5 ALL/);
  assert.match(m.subject, /unpaid, cash on delivery/);
  for (const part of [m.text, m.html]) {
    assert.ok(part.includes("SC-000012"));
    assert.ok(part.includes("Kabllo Cat6"));
    assert.ok(part.includes("C6-10"));
    assert.ok(part.includes("Ardit Hoxha"));
    assert.ok(part.includes("+355 68 111 2222"));
    assert.ok(part.includes("ardit@example.test"));
    assert.ok(part.includes("5,400.5 ALL"));
  }
});

test("a submitted order is NEVER described as paid", () => {
  const m = render();
  for (const s of [m.subject, m.text, m.html]) {
    assert.ok(!/(?<!un)(?<!not )paid(?! —)/i.test(s.replace(/NOT PAID/gi, "").replace(/unpaid/gi, "").replace(/No payment has been confirmed/gi, "")) , "found 'paid' wording: " + s.slice(0, 80));
    assert.ok(!/confirmed by the payment system/i.test(s));
  }
  assert.match(m.text, /NOT PAID — cash on delivery/);
  assert.match(m.html, /NOT PAID — cash on delivery/);
});

test("payment_confirmed needs a payment reference; without one it throws", () => {
  assert.throws(() => render(base(), "payment_confirmed"), /reference/);
  assert.throws(() => render(base(), "payment_confirmed", { paymentReference: "   " }), /reference/);
  const m = render(base(), "payment_confirmed", { paymentReference: "pay_abc123" });
  assert.match(m.subject, /Payment confirmed/);
  assert.match(m.text, /Paid — confirmed by the payment system \(reference pay_abc123\)/);
  assert.throws(() => render(base(), "something_else"), /unknown event/);
});

test("fulfilment status is shown and mapped", () => {
  assert.match(render({ ...base(), status: "processing" }).text, /Fulfilment: Processing/);
  assert.match(render({ ...base(), status: "completed" }).text, /Fulfilment: Completed/);
  assert.match(render({ ...base(), status: "cancelled" }).text, /Fulfilment: Cancelled/);
  assert.match(render().text, /Fulfilment: New — not processed yet/);
  assert.equal(statusLabel("weird<>"), "weird<>");
});

test("date/time is shown in Tirana time, summer and winter", () => {
  assert.match(formatDateTime("2026-10-18T17:05:00Z"), /18 Oct 2026, 19:05 \(Tirana time\)/);
  assert.match(formatDateTime("2026-12-01T10:00:00Z"), /01 Dec 2026, 11:00 \(Tirana time\)/);
  assert.equal(formatDateTime("not a date"), "unknown time");
});

test("customer and product text is HTML-escaped (no injection into the e-mail)", () => {
  const o = base();
  o.customer_name = `<script>alert(1)</script> "Bob" & <b>Co</b>`;
  o.items = [{ id: "x", name: `<img src=x onerror=alert(1)>`, sku: `"><svg onload=1>`, qty: 1, price: 10, currency: "ALL" }];
  const { html, subject } = render(o);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<svg onload"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!/[<>]/.test(subject.replace("[SubCore]", "")), "subject has raw angle brackets");
});

test("line breaks cannot be smuggled into the subject (header injection)", () => {
  const o = base();
  o.order_number = "SC-1\r\nBcc: evil@example.test\nX: y";
  const { subject } = render(o);
  assert.ok(!/[\r\n]/.test(subject));
  assert.equal(clean("a\r\nb c\u0000d"), "a b c d");
});

test("only necessary contact details: no address, no notes, no email row when absent", () => {
  const o = { ...base(), customer_email: "", delivery_address: "SECRET-ADDRESS 12", notes: "SECRET-NOTES" };
  const { text, html } = render(o);
  for (const s of [text, html]) { assert.ok(!s.includes("SECRET-ADDRESS")); assert.ok(!s.includes("SECRET-NOTES")); }
  assert.ok(!/Email:/.test(text));
  assert.ok(!/>Email</.test(html));
  assert.ok(text.includes("Delivery address and notes are in the dashboard"));
});

test("secure dashboard link: https, order id, no token", () => {
  const link = orderLink("https://subcoresolutions.online/admin.html#orders", 12);
  assert.equal(link, "https://subcoresolutions.online/admin.html#orders/12");
  assert.equal(orderLink(ADMIN, "a/b"), ADMIN + "#orders/a%2Fb");
  const { text, html } = render();
  assert.ok(text.includes(ADMIN + "#orders/12"));
  assert.ok(html.includes(`href="${ADMIN}#orders/12"`));
  assert.ok(!/token|password|key=/i.test(link));
});

test("amounts and currencies", () => {
  assert.equal(money(12500, "ALL"), "12,500 ALL");
  assert.equal(money(1234.5, "EUR"), "1,234.5 EUR");
  assert.equal(money(0.1 + 0.2, "ALL"), "0.3 ALL");
  const o = base(); o.items[1].currency = "EUR";
  const m = render(o);
  assert.match(m.text, /mixed currencies: ALL, EUR/);
  assert.match(m.subject, /mixed currencies/);
});

test("items stored as a JSON string, broken items and oversized lists are handled", () => {
  assert.equal(parseItems(JSON.stringify(base().items)).length, 2);
  assert.deepEqual(parseItems("not json"), []);
  assert.deepEqual(parseItems(null), []);
  assert.equal(parseItems(Array.from({ length: 80 }, () => ({ id: "a", qty: 1, price: 1 }))).length, 50);
  const m = render({ ...base(), items: [] });
  assert.match(m.text, /\(no items recorded\)/);
  assert.match(m.html, /No items recorded/);
  assert.ok(render({ ...base(), customer_name: null, order_number: null }).subject.includes("#12"));
});

test("delivery fee is itemised only when present", () => {
  assert.match(render().text, /Subtotal: 4,900\.5 ALL\nDelivery: 500 ALL\nTOTAL: 5,400\.5 ALL/);
  assert.ok(!/Delivery: /.test(render({ ...base(), shipping: 0, total: 4900.5 }).text));
});
