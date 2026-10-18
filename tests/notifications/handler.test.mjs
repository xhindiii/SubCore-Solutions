import test from "node:test";
import assert from "node:assert/strict";
import { handle, safeEqual } from "../../supabase/functions/send-notifications/handler.ts";
import { createResendMailer } from "../../supabase/functions/send-notifications/mailer.ts";

const SECRET = "s".repeat(32);
const cfg = (o = {}) => ({ secret: SECRET, to: "owner@example.test", from: "notifications@example.test", adminUrl: "https://example.test/admin.html", dryRun: false, batch: 10, ...o });
const order = (id) => ({ id, order_number: `SC-${String(id).padStart(6, "0")}`, customer_name: "Customer Name", customer_phone: "+355 68 000 0000", customer_email: "", items: [{ id: "p", name: { sq: "Item" }, qty: 1, price: 100, currency: "ALL" }], total: 100, shipping: 0, status: "pending", created_at: "2026-10-18T17:05:00Z" });
const req = (o = {}) => new Request("https://f.test/send-notifications", { method: "POST", headers: { "x-notify-secret": SECRET }, ...o });

function fakeDb(rows, { orders } = {}) {
  const calls = { claim: 0, list: 0, finish: [] };
  return {
    calls,
    async claim() { calls.claim++; return rows; },
    async listPending() { calls.list++; return rows; },
    async getOrder(id) { return orders ? orders[id] ?? null : order(id); },
    async finish(id, r) { calls.finish.push({ id, ...r }); return true; },
  };
}
const mailerOf = (fn) => ({ sent: [], async send(m) { this.sent.push(m); return fn(m, this.sent.length); } });
const ev = (id, attempts = 1, event_type = "order_submitted") => ({ id, event_type, order_id: id * 10, attempts });

test("only POST is accepted", async () => {
  const r = await handle(new Request("https://f.test", { method: "GET" }), cfg(), fakeDb([]), mailerOf(() => ({ ok: true, id: "x" })));
  assert.equal(r.status, 405);
});

test("missing configuration -> 500 and nothing happens", async () => {
  const db = fakeDb([ev(1)]);
  const r = await handle(req(), null, db, null);
  assert.equal(r.status, 500);
  assert.equal(db.calls.claim + db.calls.list, 0);
});

test("wrong or missing secret -> 401 and the database is never touched", async () => {
  for (const headers of [{}, { "x-notify-secret": "nope" }, { "x-notify-secret": SECRET + "x" }]) {
    const db = fakeDb([ev(1)]); const m = mailerOf(() => ({ ok: true, id: "x" }));
    const r = await handle(new Request("https://f.test", { method: "POST", headers }), cfg(), db, m);
    assert.equal(r.status, 401);
    assert.equal(db.calls.claim + db.calls.list, 0); assert.equal(m.sent.length, 0);
  }
  assert.equal(await safeEqual("abc", "abc"), true);
  assert.equal(await safeEqual("abc", "abd"), false);
});

test("dry run: renders previews, claims nothing, sends nothing, changes nothing", async () => {
  const db = fakeDb([ev(1), ev(2)]); const m = mailerOf(() => ({ ok: true, id: "x" }));
  const r = await handle(req(), cfg({ dryRun: true }), db, m);
  const body = await r.json();
  assert.equal(r.status, 200); assert.equal(body.dryRun, true); assert.equal(body.sent, 0);
  assert.equal(body.previews.length, 2); assert.match(body.previews[0].subject, /New order submitted SC-/);
  assert.equal(db.calls.claim, 0); assert.equal(db.calls.finish.length, 0); assert.equal(m.sent.length, 0);
});

test("accepted e-mail -> finish(ok) with the provider id; idempotency key is stable per notification", async () => {
  const db = fakeDb([ev(7)]); const m = mailerOf(() => ({ ok: true, id: "re_123" }));
  const r = await handle(req(), cfg(), db, m);
  const body = await r.json();
  assert.deepEqual([body.sent, body.failed, body.dead], [1, 0, 0]);
  assert.equal(m.sent[0].to, "owner@example.test");
  assert.equal(m.sent[0].idempotencyKey, "subcore-notify-7");
  assert.deepEqual(db.calls.finish, [{ id: 7, ok: true, providerId: "re_123" }]);
});

test("rejected e-mail is NEVER marked sent; transient -> retry, permanent -> dead", async () => {
  const db = fakeDb([ev(1), ev(2), ev(3, 6)]);
  const m = mailerOf((_, n) => n === 1 ? { ok: false, error: "resend_429", permanent: false } : n === 2 ? { ok: false, error: "resend_422", permanent: true } : { ok: false, error: "resend_500", permanent: false });
  const body = await (await handle(req(), cfg(), db, m)).json();
  assert.ok(db.calls.finish.every((f) => f.ok === false));
  assert.deepEqual(db.calls.finish.map((f) => [f.id, f.error, !!f.permanent]), [[1, "resend_429", false], [2, "resend_422", true], [3, "resend_500", false]]);
  assert.deepEqual([body.sent, body.failed, body.dead], [0, 1, 2]);
});

test("missing order and render errors are parked as dead without sending", async () => {
  const db = fakeDb([ev(1), ev(2, 1, "payment_confirmed")], { orders: { 20: order(2) } });
  const m = mailerOf(() => ({ ok: true, id: "x" }));
  const body = await (await handle(req(), cfg(), db, m)).json();
  assert.equal(m.sent.length, 0);
  assert.deepEqual(db.calls.finish.map((f) => [f.id, f.error, f.permanent]), [[1, "order_not_found", true], [2, "render_error", true]]);
  assert.equal(body.dead, 2);
});

test("an unexpected error on one row does not stop the others", async () => {
  const db = fakeDb([ev(1), ev(2)]);
  const m = mailerOf((_, n) => { if (n === 1) throw new Error("boom with secret data"); return { ok: true, id: "ok2" }; });
  const body = await (await handle(req(), cfg(), db, m)).json();
  assert.deepEqual(db.calls.finish.map((f) => [f.id, f.ok, f.error ?? null]), [[1, false, "unexpected_error"], [2, true, null]]);
  assert.deepEqual([body.sent, body.failed], [1, 1]);
});

test("if recording the result fails after the e-mail was accepted, the handler survives", async () => {
  const db = fakeDb([ev(1), ev(2)]);
  let first = true; db.finish = async (id, r) => { db.calls.finish.push({ id, ...r }); if (first) { first = false; throw new Error("db down"); } return true; };
  const m = mailerOf(() => ({ ok: true, id: "x" }));
  const r = await handle(req(), cfg(), db, m);
  assert.equal(r.status, 200);
  assert.equal(m.sent.length, 2);
  // Row 1 stays 'sending' and is reclaimed later; the same Idempotency-Key stops a second e-mail.
});

test("the response never contains customer data in live mode", async () => {
  const db = fakeDb([ev(1)]); const m = mailerOf(() => ({ ok: true, id: "x" }));
  const text = await (await handle(req(), cfg(), db, m)).text();
  assert.ok(!/Customer Name|355 68|SC-0000/.test(text));
});

test("Resend adapter: success needs HTTP 2xx AND a message id", async () => {
  const seen = [];
  const f = (status, body) => async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify(body), { status }); };
  const msg = { from: "a@x.test", to: "b@y.test", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: "k1" };

  assert.deepEqual(await createResendMailer("KEY123", f(200, { id: "re_1" })).send(msg), { ok: true, id: "re_1" });
  assert.equal(seen[0].url, "https://api.resend.com/emails");
  assert.equal(seen[0].init.headers.Authorization, "Bearer KEY123");
  assert.equal(seen[0].init.headers["Idempotency-Key"], "k1");
  const sent = JSON.parse(seen[0].init.body);
  assert.deepEqual(sent.to, ["b@y.test"]); assert.equal(sent.subject, "S");

  assert.equal((await createResendMailer("K", f(200, {})).send(msg)).ok, false);          // 200 without id is NOT success
  assert.equal((await createResendMailer("K", f(202, { id: "" })).send(msg)).ok, false);
  const r429 = await createResendMailer("K", f(429, { message: "slow down" })).send(msg);
  assert.deepEqual(r429, { ok: false, error: "resend_429", permanent: false });
  assert.deepEqual(await createResendMailer("K", f(422, {})).send(msg), { ok: false, error: "resend_422", permanent: true });
  assert.deepEqual(await createResendMailer("K", f(401, {})).send(msg), { ok: false, error: "resend_401", permanent: false });
  assert.deepEqual(await createResendMailer("K", f(500, {})).send(msg), { ok: false, error: "resend_500", permanent: false });
});

test("Resend adapter: network failure and timeout are transient and never leak the key", async () => {
  const msg = { from: "a@x.test", to: "b@y.test", subject: "S", html: "h", text: "t", idempotencyKey: "k" };
  const down = await createResendMailer("TOPSECRETKEY", async () => { throw new TypeError("fetch failed TOPSECRETKEY"); }).send(msg);
  assert.deepEqual(down, { ok: false, error: "resend_network", permanent: false });
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const slow = await createResendMailer("TOPSECRETKEY", hang, 20).send(msg);
  assert.deepEqual(slow, { ok: false, error: "resend_timeout", permanent: false });
  assert.ok(!JSON.stringify([down, slow]).includes("TOPSECRETKEY"));
});
