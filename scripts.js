/* Site-wide behaviour: language switching, mobile menu, toasts, contact form. */
const DEFAULT_LANG = "sq";

/* ── Toasts ─────────────────────────────────────────────────────────── */
const Toast = {
  container: null,
  show(type, title, message, duration = 5000, action) {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "toast-container";
      this.container.setAttribute("aria-live", "polite");
      document.body.appendChild(this.container);
    }
    const toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    const content = document.createElement("div");
    content.className = "toast-content";
    const titleEl = document.createElement("div");
    titleEl.className = "toast-title";
    titleEl.textContent = title;
    content.appendChild(titleEl);
    if (message || action) {
      const msg = document.createElement("div");
      msg.className = "toast-message";
      if (message) msg.textContent = message + (action ? " " : "");
      if (action) {
        const a = document.createElement("a");
        a.href = action.href;
        a.textContent = action.label;
        msg.appendChild(a);
      }
      content.appendChild(msg);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", typeof tr === "function" ? tr("common.close") : "Close");
    close.textContent = "×";
    close.addEventListener("click", () => this.dismiss(toast));

    toast.append(content, close);
    this.container.appendChild(toast);
    while (this.container.children.length > 3) this.container.firstChild.remove();
    if (duration > 0) setTimeout(() => this.dismiss(toast), duration);
    return toast;
  },
  success(title, message, duration, action) { return this.show("success", title, message, duration, action); },
  error(title, message, duration, action) { return this.show("error", title, message, duration, action); },
  info(title, message, duration, action) { return this.show("info", title, message, duration, action); },
  dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 200);
  }
};

/* ── Language ───────────────────────────────────────────────────────── */
function getLang() {
  return localStorage.getItem("lang") === "en" ? "en" : DEFAULT_LANG;
}

function applyTranslations(lang) {
  const t = translations[lang];
  if (!t) return;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = t[el.getAttribute("data-i18n")];
    if (v !== undefined) el.textContent = v;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const v = t[el.getAttribute("data-i18n-placeholder")];
    if (v !== undefined) el.placeholder = v;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const v = t[el.getAttribute("data-i18n-aria")];
    if (v !== undefined) el.setAttribute("aria-label", v);
  });
  const title = document.querySelector("title[data-sq]");
  if (title) document.title = title.getAttribute("data-" + lang) || title.textContent;
}

function updateLangButtons(lang) {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    const on = btn.dataset.lang === lang;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function setLang(lang) {
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
  applyTranslations(lang);
  updateLangButtons(lang);
  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

function initLangSwitcher() {
  document.querySelectorAll(".lang-btn").forEach((btn) => btn.addEventListener("click", () => setLang(btn.dataset.lang)));
  const lang = getLang();
  document.documentElement.lang = lang;
  if (lang !== "sq") applyTranslations(lang); // the HTML already ships in Albanian
  updateLangButtons(lang);
}

/* ── Header ─────────────────────────────────────────────────────────── */
function initMobileMenu() {
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("header nav");
  const overlay = document.querySelector(".nav-overlay");
  if (!toggle || !nav) return;

  const close = () => {
    nav.classList.remove("open");
    toggle.classList.remove("active");
    overlay?.classList.remove("visible");
    document.body.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    nav.classList.add("open");
    toggle.classList.add("active");
    overlay?.classList.add("visible");
    document.body.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
  };
  toggle.addEventListener("click", () => (nav.classList.contains("open") ? close() : open()));
  overlay?.addEventListener("click", close);
  nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.matchMedia("(min-width: 961px)").addEventListener("change", (e) => { if (e.matches) close(); });
}

function initHeaderScroll() {
  const header = document.querySelector("header");
  if (!header) return;
  const on = () => header.classList.toggle("scrolled", window.scrollY > 8);
  on();
  window.addEventListener("scroll", on, { passive: true });
}

/* ── Forms ──────────────────────────────────────────────────────────── */
const FormUtil = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  phone: (v) => /^[\d\s+\-()]+$/.test(v) && v.replace(/\D/g, "").length >= 8,
  setError(field, message) {
    const group = field.closest(".form-group");
    if (!group) return;
    group.classList.toggle("has-error", !!message);
    let el = group.querySelector(".validation-message");
    if (!el) {
      el = document.createElement("div");
      el.className = "validation-message error";
      group.appendChild(el);
    }
    el.textContent = message || "";
    el.classList.toggle("visible", !!message);
    field.setAttribute("aria-invalid", message ? "true" : "false");
  },
  clear(form) { form.querySelectorAll(".form-group").forEach((g) => { g.classList.remove("has-error"); g.querySelector(".validation-message")?.classList.remove("visible"); }); },
  status(el, type, text) {
    if (!el) return;
    el.hidden = !text;
    el.className = "form-status " + type;
    el.textContent = text || "";
  }
};

function setBusy(button, busy, busyLabel) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
  if (busyLabel) button.setAttribute("aria-label", busy ? busyLabel : "");
  if (!busy) button.removeAttribute("aria-label");
}

/* Contact form → inquiries table. Falls back to a pre-filled mail if the table is not installed. */
function initContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;
  const status = document.getElementById("contact-status");
  const field = (n) => form.elements[n];

  const params = new URLSearchParams(location.search);
  const pre = params.get("service");
  if (pre && field("service")?.querySelector('option[value="' + CSS.escape(pre) + '"]')) field("service").value = pre;

  ["name", "email", "phone", "message"].forEach((n) => {
    field(n)?.addEventListener("input", () => FormUtil.setError(field(n), ""));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (field("website")?.value) return; // honeypot
    FormUtil.status(status, "", "");
    let ok = true;
    const name = field("name").value.trim();
    const email = field("email").value.trim();
    const phone = field("phone").value.trim();
    const message = field("message").value.trim();
    if (!name) { FormUtil.setError(field("name"), tr("form.required")); ok = false; } else FormUtil.setError(field("name"), "");
    if (!FormUtil.email(email)) { FormUtil.setError(field("email"), email ? tr("form.invalidEmail") : tr("form.required")); ok = false; } else FormUtil.setError(field("email"), "");
    if (phone && !FormUtil.phone(phone)) { FormUtil.setError(field("phone"), tr("form.invalidPhone")); ok = false; } else FormUtil.setError(field("phone"), "");
    if (message.length < 10) { FormUtil.setError(field("message"), tr("form.msgShort")); ok = false; } else FormUtil.setError(field("message"), "");
    if (!ok) { FormUtil.status(status, "error", tr("form.fixErrors")); form.querySelector(".has-error input, .has-error textarea")?.focus(); return; }

    const btn = form.querySelector('button[type="submit"]');
    setBusy(btn, true);
    const service = field("service")?.value || "";
    const result = await SupabaseClient.submitInquiry({ type: "contact", name, email, phone, service, message, lang: getLang() });
    setBusy(btn, false);

    if (result.ok) {
      form.reset();
      FormUtil.clear(form);
      FormUtil.status(status, "success", tr("form.sent.msg"));
      status.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      // Fallback so the message is never lost: open a pre-filled email.
      const body = "Name: " + name + "\nEmail: " + email + (phone ? "\nPhone: " + phone : "") + (service ? "\nService: " + service : "") + "\n\n" + message;
      FormUtil.status(status, "error", tr("form.error"));
      const a = document.createElement("a");
      a.href = "mailto:info@subcoresolutions.online?subject=" + encodeURIComponent("Website contact - " + name) + "&body=" + encodeURIComponent(body);
      a.textContent = " info@subcoresolutions.online";
      status.appendChild(a);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initLangSwitcher();
  initMobileMenu();
  initHeaderScroll();
  initContactForm();
  if (typeof Cart !== "undefined") Cart.updateBadge();
});
