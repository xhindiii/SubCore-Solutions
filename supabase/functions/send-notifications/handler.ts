/* Request handler for the send-notifications Edge Function.
   All outside access (database, e-mail service) is injected, so the logic is unit-tested without Deno or Supabase. */
import { renderOrderEmail, type EventType, type OrderRow } from "./email.ts";
import type { Mailer } from "./mailer.ts";

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
