/* Quote / support request form → inquiries table (with fallbacks so a request is never lost). */
(function () {
  const form = document.getElementById("quote-form");
  if (!form) return;
  const status = document.getElementById("quote-status");
  const field = (n) => form.elements[n];
  const TYPES = ["support", "quote", "consult", "visit", "product"];
  const typeLabel = { support: "Support", quote: "Quote", consult: "Consultation", visit: "Site visit", product: "Product question" };

  function currentType() { return (form.querySelector('input[name="type"]:checked') || {}).value || "support"; }

  function sync() {
    const type = currentType();
    form.querySelectorAll("[data-for]").forEach((el) => { el.hidden = !el.dataset.for.split(" ").includes(type); });
    const ph = type === "support" ? tr("q.ph.support") : tr("q.ph.default");
    field("message").placeholder = ph;
  }

  const params = new URLSearchParams(location.search);
  const wanted = params.get("type");
  if (TYPES.includes(wanted)) form.querySelector('input[name="type"][value="' + wanted + '"]').checked = true;
  const svc = params.get("service");
  if (svc && field("service").querySelector('option[value="' + CSS.escape(svc) + '"]')) field("service").value = svc;
  const prod = params.get("product");
  if (prod) field("product").value = prod;

  form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener("change", sync));
  document.addEventListener("langchange", sync);
  ["name", "phone", "email", "message"].forEach((n) => field(n).addEventListener("input", () => FormUtil.setError(field(n), "")));
  sync();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (field("website").value) return; // honeypot
    FormUtil.status(status, "", "");
    const v = (n) => (field(n) ? field(n).value.trim() : "");
    let ok = true;
    if (!v("name")) { FormUtil.setError(field("name"), tr("form.required")); ok = false; } else FormUtil.setError(field("name"), "");
    if (!FormUtil.phone(v("phone"))) { FormUtil.setError(field("phone"), v("phone") ? tr("form.invalidPhone") : tr("form.required")); ok = false; } else FormUtil.setError(field("phone"), "");
    if (v("email") && !FormUtil.email(v("email"))) { FormUtil.setError(field("email"), tr("form.invalidEmail")); ok = false; } else FormUtil.setError(field("email"), "");
    if (v("message").length < 10) { FormUtil.setError(field("message"), tr("form.msgShort")); ok = false; } else FormUtil.setError(field("message"), "");
    if (!ok) { FormUtil.status(status, "error", tr("form.fixErrors")); form.querySelector(".has-error input, .has-error textarea")?.focus(); return; }

    const type = currentType();
    const lines = [];
    if (v("company")) lines.push("Company: " + v("company"));
    if (["consult", "visit"].includes(type) && v("date")) lines.push("Preferred date: " + v("date"));
    if (type === "visit" && v("address")) lines.push("Address: " + v("address"));
    if (type === "product" && v("product")) lines.push("Product: " + v("product"));
    const message = (lines.length ? lines.join("\n") + "\n\n" : "") + v("message");
    const base = { name: v("name"), email: v("email"), phone: v("phone"), service: type === "product" ? "" : v("service"), lang: getLang() };

    const btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true);
    let res = await SupabaseClient.submitInquiry(Object.assign({ type, message }, base));
    // Older database: only 'contact' / 'service' are allowed. Keep the request, tag the type in the text.
    if (!res.ok) res = await SupabaseClient.submitInquiry(Object.assign({ type: "contact", message: "[" + typeLabel[type] + "]\n" + message }, base));
    setBusy(btn, false);

    if (res.ok) {
      form.reset();
      FormUtil.clear(form);
      sync();
      FormUtil.status(status, "success", tr("form.sent.msg"));
      status.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      FormUtil.status(status, "error", tr("form.error"));
      const text = "[" + typeLabel[type] + "] " + v("name") + " " + v("phone") + "\n" + message;
      const a = document.createElement("a");
      a.href = whatsappLink(text); a.target = "_blank"; a.rel = "noopener"; a.textContent = " WhatsApp";
      status.appendChild(a);
    }
  });
})();
