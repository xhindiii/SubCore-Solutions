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
