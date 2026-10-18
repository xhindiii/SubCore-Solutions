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
