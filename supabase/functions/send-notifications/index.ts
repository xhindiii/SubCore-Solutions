/* Supabase Edge Function: send-notifications
   Sends the "new order" e-mail to the shop owner. Deploy WITHOUT the JWT check (the caller is the
   database scheduler, authenticated by a shared secret):
     supabase functions deploy send-notifications --no-verify-jwt
   Secrets (set with `supabase secrets set`, NEVER in the repository or in browser files) — see NOTIFICATIONS.md:
     NOTIFY_WEBHOOK_SECRET  RESEND_API_KEY  NOTIFY_TO  NOTIFY_FROM  [ADMIN_BASE_URL]  [NOTIFY_DRY_RUN]
   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to Edge Functions automatically. */
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle, type Config, type Db } from "./handler.ts";
import { createResendMailer } from "./mailer.ts";

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
