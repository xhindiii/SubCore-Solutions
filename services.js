/* Services: renders from the database when rows exist (editable in the admin panel),
   otherwise the static cards already in the HTML stay. Also handles "Request this service". */
(function () {
  const ICONS = ["server", "network", "support", "cloud", "shield", "laptop", "activity", "refresh", "clipboard", "globe",
    "package", "cpu", "wifi", "drive", "printer", "tag", "award", "user", "search", "lock"];
  const homeGrid = document.getElementById("home-services");
  const pageGrid = document.getElementById("services-grid");
  let services = null; // null until the database answers

  const iconFor = (s) => (ICONS.includes(s.icon) ? s.icon : "server");

  function cardHtml(s, withRequest) {
    const id = escapeHtml(s.id);
    const price = s.price > 0
      ? '<span class="service-price"><small>' + escapeHtml(tr("services.from")) + "</small>" + escapeHtml(money(s.price, s.currency)) + "</span>"
      : "";
    const action = withRequest
      ? '<button type="button" class="button button-outline button-sm" data-request="' + id + '">' + escapeHtml(tr("services.request")) + "</button>"
      : '<a class="text-link" href="contact.html?service=' + encodeURIComponent(s.id) + '">' + escapeHtml(tr("services.learnmore")) +
        '<svg class="icon" aria-hidden="true"><use href="icons.svg#arrow-right"/></svg></a>';
    return '<article class="service-card" id="' + id + '">' +
      '<span class="icon-box"><svg class="icon" aria-hidden="true"><use href="icons.svg#' + iconFor(s) + '"/></svg></span>' +
      "<h3>" + escapeHtml(loc(s.name)) + "</h3>" +
      "<p>" + escapeHtml(loc(s.description)) + "</p>" +
      '<div class="service-foot">' + action + price + "</div></article>";
  }

  function render() {
    if (!services || !services.length) return;
    if (pageGrid) pageGrid.innerHTML = services.map((s) => cardHtml(s, true)).join("");
    if (homeGrid) {
      const top = services.slice().sort((a, b) => Number(b.featured) - Number(a.featured) || a.display_order - b.display_order).slice(0, 6);
      homeGrid.innerHTML = top.map((s) => cardHtml(s, false)).join("");
    }
    if (pageGrid && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }

  async function load() {
    if (!homeGrid && !pageGrid) return;
    try {
      const rows = await SupabaseClient.fetchServices();
      services = rows.filter((s) => s.available);
      render();
    } catch (err) {
      console.warn("Services from database unavailable, using built-in list.", err.message);
    }
  }

  function serviceName(id) {
    const fromDb = services && services.find((s) => s.id === id);
    if (fromDb) return loc(fromDb.name);
    return tr("services." + id + ".title") === "services." + id + ".title" ? id : tr("services." + id + ".title");
  }

  /* ── Request modal ─────────────────────────────────────────────── */
  let lastFocus = null;
  function closeModal() {
    document.querySelector(".modal-backdrop")?.remove();
    document.body.classList.remove("drawer-open");
    lastFocus?.focus();
  }

  function openRequest(id) {
    lastFocus = document.activeElement;
    const name = serviceName(id);
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="req-title">' +
      '<button type="button" class="modal-close" aria-label="' + escapeHtml(tr("common.close")) + '"><svg class="icon" aria-hidden="true"><use href="icons.svg#x"/></svg></button>' +
      '<h2 id="req-title">' + escapeHtml(name) + "</h2>" +
      '<p class="modal-sub">' + escapeHtml(tr("services.page.lead")) + "</p>" +
      '<form id="request-form" novalidate>' +
        '<div class="form-group"><label for="rq-name">' + escapeHtml(tr("form.name")) + '</label><input type="text" id="rq-name" name="name" autocomplete="name" required></div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label for="rq-phone">' + escapeHtml(tr("form.phone")) + '</label><input type="tel" id="rq-phone" name="phone" autocomplete="tel" required></div>' +
          '<div class="form-group"><label for="rq-email">' + escapeHtml(tr("form.email")) + ' <span class="optional">(' + escapeHtml(tr("common.optional")) + ')</span></label><input type="email" id="rq-email" name="email" autocomplete="email"></div>' +
        "</div>" +
        '<div class="form-group"><label for="rq-msg">' + escapeHtml(tr("form.message")) + ' <span class="optional">(' + escapeHtml(tr("common.optional")) + ')</span></label><textarea id="rq-msg" name="message" rows="3" placeholder="' + escapeHtml(tr("contact.form.messagePh")) + '"></textarea></div>' +
        '<div class="hp-field" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>' +
        '<button type="submit" class="button button-block">' + escapeHtml(tr("form.submit")) + "</button>" +
        '<div class="form-status" id="rq-status" role="status" hidden></div>' +
      "</form></div>";
    document.body.appendChild(wrap);
    document.body.classList.add("drawer-open");
    const modal = wrap.querySelector(".modal");
    const form = wrap.querySelector("#request-form");
    const status = wrap.querySelector("#rq-status");
    modal.querySelector("#rq-name").focus();

    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) closeModal(); });
    modal.querySelector(".modal-close").addEventListener("click", closeModal);
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeModal(); return; }
      if (e.key === "Tab") { // keep focus inside the dialog
        const f = [...modal.querySelectorAll("button, input, textarea, select")].filter((x) => !x.closest(".hp-field") && !x.disabled);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.elements.website.value) return;
      const nameV = form.elements.name.value.trim();
      const phoneV = form.elements.phone.value.trim();
      const emailV = form.elements.email.value.trim();
      let ok = true;
      if (!nameV) { FormUtil.setError(form.elements.name, tr("form.required")); ok = false; } else FormUtil.setError(form.elements.name, "");
      if (!FormUtil.phone(phoneV)) { FormUtil.setError(form.elements.phone, phoneV ? tr("form.invalidPhone") : tr("form.required")); ok = false; } else FormUtil.setError(form.elements.phone, "");
      if (emailV && !FormUtil.email(emailV)) { FormUtil.setError(form.elements.email, tr("form.invalidEmail")); ok = false; } else FormUtil.setError(form.elements.email, "");
      if (!ok) return;

      const btn = form.querySelector('button[type="submit"]');
      setBusy(btn, true);
      const res = await SupabaseClient.submitInquiry({
        type: "service", service: id, name: nameV, phone: phoneV, email: emailV,
        message: form.elements.message.value.trim(), lang: getLang()
      });
      setBusy(btn, false);
      if (res.ok) {
        modal.innerHTML =
          '<button type="button" class="modal-close" aria-label="' + escapeHtml(tr("common.close")) + '"><svg class="icon" aria-hidden="true"><use href="icons.svg#x"/></svg></button>' +
          '<div style="text-align:center;padding:1rem 0"><div class="confirm-icon"><svg class="icon" aria-hidden="true"><use href="icons.svg#check"/></svg></div>' +
          "<h2 style=\"padding:0\">" + escapeHtml(tr("form.sent.title")) + '</h2><p class="muted" style="margin-top:.5rem">' + escapeHtml(tr("form.sent.msg")) + "</p></div>";
        modal.querySelector(".modal-close").addEventListener("click", closeModal);
        modal.querySelector(".modal-close").focus();
      } else {
        FormUtil.status(status, "error", tr("form.error"));
        const a = document.createElement("a");
        a.href = whatsappLink("Hello, I would like to request: " + name + "\nName: " + nameV + "\nPhone: " + phoneV);
        a.target = "_blank"; a.rel = "noopener"; a.textContent = " WhatsApp";
        status.appendChild(a);
      }
    });
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-request]");
    if (btn) openRequest(btn.dataset.request);
  });

  document.addEventListener("langchange", render);
  document.addEventListener("DOMContentLoaded", load);
})();
