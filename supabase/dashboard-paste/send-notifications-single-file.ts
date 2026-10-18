/* SINGLE-FILE version of the send-notifications Edge Function (email.ts + mailer.ts + handler.ts + index.ts joined, nothing else changed).
   Use this ONLY when pasting into the Supabase dashboard editor, which handles one file most easily. Deploy with "Verify JWT" turned OFF.
   The multi-file version in the repo (supabase/functions/send-notifications/) is the one that is unit-tested; keep both in sync. */
import { createClient } from "npm:@supabase/supabase-js@2";

// ===== email.ts =====
/* Builds the notification e-mail (subject, plain text, HTML) for one order.
   Pure functions only — no network, no secrets — so they are easy to test.
   Everything that comes from a customer or from product data is escaped / cleaned. */

export type EventType = "order_submitted" | "payment_confirmed";

export interface OrderRow {
  id: number | string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  items: unknown;
  total: number | string | null;
  shipping: number | string | null;
  status: string | null;
  created_at: string;
}

export interface RenderOptions {
  /** Admin page URL, e.g. https://subcoresolutions.online/admin.html */
  adminUrl: string;
  timeZone?: string;
  /** Required for payment_confirmed: the payment provider's confirmation reference. */
  paymentReference?: string;
}

export interface Rendered { subject: string; text: string; html: string }

interface Line { name: string; sku: string; qty: number; price: number; currency: string }

const BRAND = "#18252d";
const ACCENT = "#176f86";

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Single-line, control-character-free text (protects subjects/headers and keeps layout intact). */
export function clean(v: unknown, max = 120): string {
  const s = String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function num(v: unknown): number { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; }

export function money(amount: number, currency: string): string {
  const s = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
  return currency ? `${s} ${currency}` : s;
}

function localName(v: unknown): string {
  if (v && typeof v === "object") { const o = v as Record<string, unknown>; return clean(o.sq || o.en || "", 160); }
  return clean(v, 160);
}

export function parseItems(raw: unknown): Line[] {
  let arr: unknown = raw;
  if (typeof raw === "string") { try { arr = JSON.parse(raw); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 50).map((it) => {
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    return { name: localName(o.name) || clean(o.id, 60) || "(item)", sku: clean(o.sku, 60), qty: Math.max(0, Math.round(num(o.qty))), price: num(o.price), currency: clean(o.currency, 8).toUpperCase() };
  });
}

export function statusLabel(status: string | null): string {
  switch (status) {
    case "pending": return "New — not processed yet";
    case "processing": return "Processing";
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    default: return clean(status || "unknown", 30);
  }
}

export function formatDateTime(iso: string, timeZone = "Europe/Tirane"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown time";
  const s = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
  return `${s} (${timeZone === "Europe/Tirane" ? "Tirana time" : timeZone})`;
}

export function orderLink(adminUrl: string, id: number | string): string {
  return `${adminUrl.split("#")[0]}#orders/${encodeURIComponent(String(id))}`;
}

export function renderOrderEmail(event: EventType, order: OrderRow, opts: RenderOptions): Rendered {
  if (event === "payment_confirmed" && !clean(opts.paymentReference || "", 80)) {
    // An order may only be reported as paid when a payment system supplied a confirmation reference.
    throw new Error("payment_confirmed requires a payment confirmation reference");
  }
  if (event !== "order_submitted" && event !== "payment_confirmed") throw new Error("unknown event type");

  const lines = parseItems(order.items);
  const currencies = [...new Set(lines.map((l) => l.currency).filter(Boolean))];
  const mixed = currencies.length > 1;
  const cur = currencies[0] || "";
  const total = num(order.total);
  const shipping = num(order.shipping);
  const subtotal = Math.max(0, total - shipping);
  const ref = clean(order.order_number, 40) || `#${order.id}`;
  const itemCount = lines.reduce((n, l) => n + l.qty, 0);
  const totalStr = mixed ? `${money(total, "")} (mixed currencies: ${currencies.join(", ")})` : money(total, cur);

  const label = event === "order_submitted" ? "New order submitted" : "Payment confirmed";
  const payment = event === "order_submitted"
    ? "NOT PAID — cash on delivery (payment is collected on delivery; no payment has been confirmed)"
    : `Paid — confirmed by the payment system (reference ${clean(opts.paymentReference, 80)})`;
  const paid = event === "payment_confirmed";
  const fulfilment = statusLabel(order.status);
  const when = formatDateTime(order.created_at, opts.timeZone);
  const link = orderLink(opts.adminUrl, order.id);

  const name = clean(order.customer_name, 120) || "(no name)";
  const phone = clean(order.customer_phone, 40);
  const email = clean(order.customer_email, 160);

  const subject = clean(`[SubCore] ${label} ${ref} — ${itemCount} item${itemCount === 1 ? "" : "s"}, ${mixed ? money(total, "") + " (mixed currencies)" : totalStr} — ${paid ? "paid" : "unpaid, cash on delivery"}`, 200);

  // ---------- plain text ----------
  const t: string[] = [];
  t.push(`${label.toUpperCase()}`, "");
  t.push(`Reference:  ${ref}`);
  t.push(`Received:   ${when}`);
  t.push(`Payment:    ${payment}`);
  t.push(`Fulfilment: ${fulfilment} (status at the time this e-mail was sent)`, "");
  t.push("CUSTOMER", `Name:  ${name}`);
  if (phone) t.push(`Phone: ${phone}`);
  if (email) t.push(`Email: ${email}`);
  t.push("(Delivery address and notes are in the dashboard.)", "");
  t.push("PRODUCTS");
  if (!lines.length) t.push("(no items recorded)");
  for (const l of lines) t.push(`- ${l.name}${l.sku ? ` [${l.sku}]` : ""}  ×${l.qty}  @ ${money(l.price, l.currency)}  =  ${money(l.price * l.qty, l.currency)}`);
  t.push("");
  if (shipping > 0 && !mixed) { t.push(`Subtotal: ${money(subtotal, cur)}`, `Delivery: ${money(shipping, cur)}`); }
  t.push(`TOTAL: ${totalStr}`, "");
  t.push("View this order in the dashboard (sign-in required):", link, "");
  t.push("— Automatic notification from the SubCore Solutions website. Please do not reply to this message.");
  const text = t.join("\n");

  // ---------- HTML ----------
  const row = (k: string, v: string) => `<tr><td style="padding:6px 12px 6px 0;color:#5b6b73;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#18252d;vertical-align:top">${v}</td></tr>`;
  const chip = (txt: string, bg: string, fg: string) => `<span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${bg};color:${fg};font-size:12px;font-weight:600">${esc(txt)}</span>`;
  const payChip = paid ? chip("PAID", "#dcfce7", "#166534") : chip("NOT PAID — cash on delivery", "#fef3c7", "#92400e");
  const itemRows = lines.length
    ? lines.map((l) => `<tr><td style="padding:8px 8px 8px 0;border-top:1px solid #e5ecef;font-size:14px;color:#18252d">${esc(l.name)}${l.sku ? `<br><span style="font-size:12px;color:#5b6b73">${esc(l.sku)}</span>` : ""}</td><td style="padding:8px;border-top:1px solid #e5ecef;font-size:14px;text-align:center;color:#18252d">${l.qty}</td><td style="padding:8px;border-top:1px solid #e5ecef;font-size:14px;text-align:right;white-space:nowrap;color:#18252d">${esc(money(l.price, l.currency))}</td><td style="padding:8px 0 8px 8px;border-top:1px solid #e5ecef;font-size:14px;text-align:right;white-space:nowrap;color:#18252d">${esc(money(l.price * l.qty, l.currency))}</td></tr>`).join("")
    : `<tr><td colspan="4" style="padding:8px 0;font-size:14px;color:#5b6b73">No items recorded.</td></tr>`;
  const sub = shipping > 0 && !mixed
    ? `<tr><td colspan="3" style="padding:4px 8px;text-align:right;font-size:13px;color:#5b6b73">Subtotal</td><td style="padding:4px 0 4px 8px;text-align:right;font-size:13px;color:#5b6b73;white-space:nowrap">${esc(money(subtotal, cur))}</td></tr><tr><td colspan="3" style="padding:4px 8px;text-align:right;font-size:13px;color:#5b6b73">Delivery</td><td style="padding:4px 0 4px 8px;text-align:right;font-size:13px;color:#5b6b73;white-space:nowrap">${esc(money(shipping, cur))}</td></tr>` : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef3f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${BRAND};padding:18px 24px;color:#ffffff;font-size:18px;font-weight:600">SubCore Solutions</td></tr>
<tr><td style="padding:24px 24px 8px 24px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${ACCENT};font-weight:700">${esc(label)}</div>
<div style="font-size:24px;font-weight:700;color:#18252d;margin-top:4px">${esc(ref)}</div></td></tr>
<tr><td style="padding:8px 24px 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">
${row("Received", esc(when))}${row("Payment", payChip + (paid ? "" : `<div style="font-size:12px;color:#5b6b73;margin-top:4px">No payment has been confirmed. The customer pays on delivery.</div>`))}${row("Fulfilment", esc(fulfilment))}
</table></td></tr>
<tr><td style="padding:16px 24px 0 24px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6b73;font-weight:700;margin-bottom:4px">Customer</div>
<table role="presentation" cellpadding="0" cellspacing="0">${row("Name", esc(name))}${phone ? row("Phone", esc(phone)) : ""}${email ? row("Email", esc(email)) : ""}</table>
<div style="font-size:12px;color:#5b6b73;margin-top:2px">Delivery address and notes are in the dashboard.</div></td></tr>
<tr><td style="padding:16px 24px 0 24px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5b6b73;font-weight:700;margin-bottom:4px">Products</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><th style="padding:4px 8px 6px 0;font-size:12px;color:#5b6b73;text-align:left;font-weight:600">Item</th><th style="padding:4px 8px 6px;font-size:12px;color:#5b6b73;text-align:center;font-weight:600">Qty</th><th style="padding:4px 8px 6px;font-size:12px;color:#5b6b73;text-align:right;font-weight:600">Price</th><th style="padding:4px 0 6px 8px;font-size:12px;color:#5b6b73;text-align:right;font-weight:600">Total</th></tr>
${itemRows}${sub}
<tr><td colspan="3" style="padding:10px 8px 4px;border-top:2px solid #18252d;text-align:right;font-size:15px;font-weight:700;color:#18252d">Total</td><td style="padding:10px 0 4px 8px;border-top:2px solid #18252d;text-align:right;font-size:15px;font-weight:700;color:#18252d;white-space:nowrap">${esc(totalStr)}</td></tr></table></td></tr>
<tr><td align="center" style="padding:24px"><a href="${esc(link)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:6px">Open order in dashboard</a>
<div style="font-size:12px;color:#5b6b73;margin-top:8px">Sign-in required. This link contains no password or access token.</div></td></tr>
<tr><td style="background:#f6f9fa;padding:14px 24px;font-size:12px;color:#5b6b73">Automatic notification from the SubCore Solutions website. Please do not reply to this message.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

// ===== mailer.ts =====
/* E-mail delivery adapter. The only network call that carries the e-mail service API key.
   The key is passed in from the server environment (Supabase secrets) and never logged. */

export interface Outgoing { from: string; to: string; subject: string; html: string; text: string; idempotencyKey: string }
export type SendResult = { ok: true; id: string } | { ok: false; error: string; permanent: boolean };
export interface Mailer { send(m: Outgoing): Promise<SendResult> }

/* Resend (https://resend.com). The Idempotency-Key header makes a retry of the same notification
   within 24 hours safe: the service returns the first result instead of sending a second e-mail. */
export function createResendMailer(apiKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15000): Mailer {
  return {
    async send(m) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey },
          body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
          signal: ctl.signal,
        });
        let body: { id?: string } | null = null;
        try { body = await res.json(); } catch { body = null; }
        if (res.status >= 200 && res.status < 300 && body && typeof body.id === "string" && body.id) return { ok: true, id: body.id };
        // Only malformed-request errors are permanent; auth problems, rate limits and server errors are retried.
        const permanent = res.status === 400 || res.status === 422;
        return { ok: false, error: `resend_${res.status}`, permanent };
      } catch (e) {
        // Timeout or network failure: the message MAY have been accepted. A retry reuses the same
        // Idempotency-Key, so the service will not send it twice.
        return { ok: false, error: (e as Error)?.name === "AbortError" ? "resend_timeout" : "resend_network", permanent: false };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ===== handler.ts =====
/* Request handler for the send-notifications Edge Function.
   All outside access (database, e-mail service) is injected, so the logic is unit-tested without Deno or Supabase. */


export interface Config {
  secret: string;      // shared secret expected in the x-notify-secret header
  to: string;          // notification recipient (the approved Gmail address)
  from: string;        // verified sender at the e-mail service
  adminUrl: string;    // https://.../admin.html
  dryRun: boolean;     // true = render only, never send, never claim
  batch: number;
}
export interface Claimed { id: number; event_type: EventType; order_id: number; attempts: number }
export interface Db {
  claim(limit: number): Promise<Claimed[]>;
  listPending(limit: number): Promise<Claimed[]>;
  getOrder(id: number | string): Promise<OrderRow | null>;
  finish(id: number, r: { ok: boolean; providerId?: string | null; error?: string | null; permanent?: boolean }): Promise<boolean>;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Constant-time comparison of two strings (compares SHA-256 digests). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function handle(req: Request, cfg: Config | null, db: Db, mailer: Mailer | null): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!cfg) return json(500, { error: "not_configured" });
  const given = req.headers.get("x-notify-secret") || "";
  if (!given || !(await safeEqual(given, cfg.secret))) return json(401, { error: "unauthorized" });

  const opts = { adminUrl: cfg.adminUrl };

  // Dry run: show what WOULD be sent. Nothing is claimed, sent or changed.
  if (cfg.dryRun) {
    const rows = await db.listPending(cfg.batch);
    const previews: unknown[] = [];
    for (const r of rows) {
      const order = await db.getOrder(r.order_id);
      if (!order) { previews.push({ notificationId: r.id, error: "order_not_found" }); continue; }
      try {
        const m = renderOrderEmail(r.event_type, order, opts);
        previews.push({ notificationId: r.id, wouldSendTo: cfg.to, subject: m.subject, text: m.text });
      } catch { previews.push({ notificationId: r.id, error: "render_error" }); }
    }
    return json(200, { ok: true, dryRun: true, sent: 0, pending: rows.length, previews });
  }

  if (!mailer) return json(500, { error: "not_configured" });
  const rows = await db.claim(cfg.batch);
  let sent = 0, failed = 0, dead = 0;

  for (const r of rows) {
    try {
      const order = await db.getOrder(r.order_id);
      if (!order) { await db.finish(r.id, { ok: false, error: "order_not_found", permanent: true }); dead++; continue; }
      let msg;
      try { msg = renderOrderEmail(r.event_type, order, opts); }
      catch { await db.finish(r.id, { ok: false, error: "render_error", permanent: true }); dead++; continue; }

      const res = await mailer.send({ from: cfg.from, to: cfg.to, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey: `subcore-notify-${r.id}` });
      if (res.ok) {
        // Marked as sent ONLY now that the e-mail service has accepted the message and returned its id.
        await db.finish(r.id, { ok: true, providerId: res.id });
        sent++;
      } else {
        await db.finish(r.id, { ok: false, error: res.error, permanent: res.permanent });
        if (res.permanent || r.attempts >= 6) dead++; else failed++;
      }
    } catch {
      // Unexpected problem for this one row: record it and carry on with the others.
      try { await db.finish(r.id, { ok: false, error: "unexpected_error" }); } catch { /* row stays 'sending' and is reclaimed after 10 minutes */ }
      failed++;
    }
  }
  return json(200, { ok: true, dryRun: false, processed: rows.length, sent, failed, dead });
}

// ===== index.ts =====
/* Supabase Edge Function: send-notifications
   Sends the "new order" e-mail to the shop owner. Deploy WITHOUT the JWT check (the caller is the
   database scheduler, authenticated by a shared secret):
     supabase functions deploy send-notifications --no-verify-jwt
   Secrets (set with `supabase secrets set`, NEVER in the repository or in browser files) — see NOTIFICATIONS.md:
     NOTIFY_WEBHOOK_SECRET  RESEND_API_KEY  NOTIFY_TO  NOTIFY_FROM  [ADMIN_BASE_URL]  [NOTIFY_DRY_RUN]
   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to Edge Functions automatically. */



const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

function loadConfig(): { cfg: Config | null; problems: string[]; apiKey: string } {
  const env = (k: string) => (Deno.env.get(k) || "").trim();
  const problems: string[] = [];
  const dryRun = env("NOTIFY_DRY_RUN").toLowerCase() !== "false"; // safe default: dry run unless explicitly "false"
  const secret = env("NOTIFY_WEBHOOK_SECRET");
  if (secret.length < 24) problems.push("NOTIFY_WEBHOOK_SECRET (min 24 characters)");
  const to = env("NOTIFY_TO");
  if (!EMAIL_RE.test(to)) problems.push("NOTIFY_TO");
  const from = env("NOTIFY_FROM");
  const apiKey = env("RESEND_API_KEY");
  if (!dryRun) {
    if (!from) problems.push("NOTIFY_FROM");
    if (!apiKey) problems.push("RESEND_API_KEY");
  }
  const adminUrl = env("ADMIN_BASE_URL") || "https://subcoresolutions.online/admin.html";
  if (!/^https:\/\//.test(adminUrl)) problems.push("ADMIN_BASE_URL (must start with https://)");
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY")) problems.push("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  if (problems.length) return { cfg: null, problems, apiKey };
  return { cfg: { secret, to, from, adminUrl, dryRun, batch: 10 }, problems, apiKey };
}

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORDER_COLUMNS = "id, order_number, customer_name, customer_phone, customer_email, items, total, shipping, status, created_at";

const db: Db = {
  async claim(limit) {
    const { data, error } = await supabase.rpc("claim_notifications", { p_limit: limit });
    if (error) throw new Error("claim_failed");
    return data ?? [];
  },
  async listPending(limit) {
    const { data, error } = await supabase.from("notification_log").select("id, event_type, order_id, attempts")
      .in("status", ["pending", "failed"]).order("id").limit(limit);
    if (error) throw new Error("list_failed");
    return data ?? [];
  },
  async getOrder(id) {
    const { data, error } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error("order_read_failed");
    return data;
  },
  async finish(id, r) {
    const { data, error } = await supabase.rpc("finish_notification", {
      p_id: id, p_ok: r.ok, p_provider_id: r.providerId ?? null, p_error: r.error ?? null, p_permanent: r.permanent ?? false,
    });
    if (error) throw new Error("finish_failed");
    return data === true;
  },
};

Deno.serve(async (req) => {
  const { cfg, problems, apiKey } = loadConfig();
  if (!cfg) console.error("send-notifications is not configured; missing/invalid:", problems.join(", ")); // names only, never values
  try {
    return await handle(req, cfg, db, cfg && !cfg.dryRun ? createResendMailer(apiKey) : null);
  } catch {
    console.error("send-notifications: unexpected failure"); // no details: they could contain customer data
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
