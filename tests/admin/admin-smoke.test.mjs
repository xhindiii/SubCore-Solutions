/* Runs the real admin.js against a tiny fake DOM (no browser available in CI/sandbox).
   It checks routing, the e-mail deep link, the Notifications screen and role gating — not pixel layout. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../../admin.js", import.meta.url), "utf8");

function makeEl(tag = "div") {
  return {
    tag, innerHTML: "", textContent: "", hidden: false, value: "", style: {}, dataset: {}, children: [], listeners: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, removeEventListener() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); return c; }, insertAdjacentHTML(_p, h) { this.innerHTML += h; },
    setAttribute() {}, remove() {}, focus() {}, click() {}, scrollIntoView() {}, closest() { return null; },
    get firstChild() { return this.children[0] || { remove() {} }; },
  };
}

async function boot({ hash = "", role = "admin", orders, notifications, projects = [] }) {
  const byId = {};
  const q = (sel) => (byId[sel] ||= makeEl());
  const handlers = {};
  const location = { hash };
  const document = {
    querySelector: q, querySelectorAll: () => [], createElement: (t) => makeEl(t), body: makeEl("body"), activeElement: null,
    addEventListener: (t, f) => { (handlers[t] ||= []).push(f); }, removeEventListener() {},
  };
  const window = { supabase: {}, scrollTo() {}, addEventListener: (t, f) => { (handlers["w:" + t] ||= []).push(f); } };
  const ord = orders ?? [{ id: 12, order_number: "SC-000012", customer_name: "A", customer_phone: "+355 68", customer_email: "", delivery_address: "x", notes: "", items: [{ id: "p", name: { en: "Cable" }, qty: 1, price: 100, currency: "ALL" }], total: 100, shipping: 0, status: "pending", created_at: "2026-10-18T17:05:00Z" }];
  const nf = notifications === undefined ? [
    { id: 1, event_type: "order_submitted", order_id: 12, order_number: "SC-000012", status: "sent", attempts: 1, next_attempt_at: null, last_error: null, created_at: "2026-10-18T17:05:00Z", sent_at: "2026-10-18T17:05:30Z" },
    { id: 2, event_type: "order_submitted", order_id: 13, order_number: "<img src=x onerror=alert(1)>", status: "dead", attempts: 6, next_attempt_at: null, last_error: "resend_500", created_at: "2026-10-18T17:06:00Z", sent_at: null },
  ] : notifications;
  const calls = { retry: [], fetchOrders: 0 };
  const SupabaseClient = {
    raw: {}, extended: true,
    async getCurrentAdmin() { return { id: "u1", email: "o@x.test", full_name: "Owner", role }; },
    async fetchCatalog() { return { products: [], categories: [] }; }, async fetchServices() { return []; },
    async fetchOrders() { calls.fetchOrders++; return ord; }, async fetchInquiries() { return []; }, async fetchSettings() { return {}; },
    async detectExtended() { return true; }, async fetchAudit() { return []; }, async fetchTeam() { return []; },
    async fetchProjects() { return projects; }, async fetchNotifications() { return nf; }, async retryNotification(id) { calls.retry.push(id); return true; },
  };
  const history = { replaceState(_a, _b, h) { location.hash = h; } };
  const ctx = vm.createContext({ document, window, location, history, SupabaseClient, console: { error() {}, warn() {}, log() {} }, setTimeout, URL, Blob, Intl, Date, String, Number, Object, Array, JSON, Math, parseFloat, parseInt, decodeURIComponent, encodeURIComponent, Promise });
  vm.runInContext(src, ctx);
  for (const f of handlers["DOMContentLoaded"] || []) await f();
  await new Promise((r) => setTimeout(r, 30));
  return { q, document, location, calls, handlers, byId };
}

test("e-mail deep link #orders/12 opens that order's details after load", async () => {
  const a = await boot({ hash: "#orders/12" });
  assert.equal(a.q("#page-title").textContent, "Orders");
  const drawers = a.q("#drawer-root").children;
  assert.equal(drawers.length, 1);
  assert.match(drawers[0].innerHTML, /Order SC-000012/);
  assert.match(drawers[0].innerHTML, /Cash on delivery/);
  assert.equal(a.location.hash, "#orders");
});

test("deep link to an order that is not loaded yet triggers one reload, then opens it", async () => {
  const orders = [];
  const a = await boot({ hash: "#orders/99", orders });
  assert.ok(a.calls.fetchOrders >= 2, "orders were re-fetched");
  assert.equal(a.q("#drawer-root").children.length, 0);
  assert.match(a.q("#toasts").children.map((c) => c.innerHTML + c.children.map((x) => x.textContent).join("")).join(" ") + a.q("#toasts").children.length, /./);
});

test("malformed or unknown deep links never crash", async () => {
  for (const hash of ["#orders/%E0%A4%A", "#orders/", "#nonsense/5", "#orders/12/extra"]) {
    const a = await boot({ hash });
    assert.ok(["Orders", "Dashboard"].includes(a.q("#page-title").textContent), hash);
  }
});

test("Notifications screen lists status, shows Retry only for failed/dead, escapes order text", async () => {
  const a = await boot({ hash: "#notifications" });
  const html = a.q("#view").innerHTML;
  assert.equal(a.q("#page-title").textContent, "Notifications");
  assert.match(html, />Sent</); assert.match(html, />Failed</);
  assert.equal((html.match(/data-action="retry-notification"/g) || []).length, 1);
  assert.match(html, /data-id="2"/);
  assert.ok(!html.includes("<img src=x"), "order text must be escaped");
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /Cash-on-delivery orders are never reported as paid/);
  assert.match(a.q("#notice").innerHTML, /1 order notification could not be e-mailed/);
  assert.match(a.q("#nav").innerHTML, /nav-badge">1</);
});

test("Retry button calls the server function with the notification id", async () => {
  const a = await boot({ hash: "#notifications" });
  const click = a.handlers["click"].find(Boolean);
  const btn = { dataset: { action: "retry-notification", id: "2" }, disabled: false, classList: { toggle() {} } };
  click({ target: { closest: (sel) => (sel === "[data-action]" ? btn : null) } });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(a.calls.retry, [2]);
});

test("staff and editor roles cannot open Notifications (fall back to the dashboard)", async () => {
  for (const role of ["staff", "editor"]) {
    const a = await boot({ hash: "#notifications", role });
    assert.equal(a.q("#page-title").textContent, "Dashboard");
    assert.ok(!/Notifications/.test(a.q("#nav").innerHTML));
  }
});

test("before the v5 migration is installed the admin explains what to run (no crash)", async () => {
  const a = await boot({ hash: "#notifications", notifications: null });
  assert.match(a.q("#view").innerHTML, /supabase-migration-v5-notifications\.sql/);
  assert.match(a.q("#notice").innerHTML, /not set up yet/);
});
