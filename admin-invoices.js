/* Admin → Invoices / Faturat. Admin role only (the database enforces it too: every table is admin-read-only and every write is a server function).
   Tabs: Dashboard · All invoices · Create invoice · Customers · Payments · Reports · Invoice settings.
   Prices of catalogue lines are re-read from the database when a draft is saved and when it is issued; the figures shown while editing
   come from invoices-core.js, which is tested to equal the server's maths to the cent. Nothing here changes an order, its status,
   its payment state or product stock. Nothing here claims fiscalization: these are informal invoices (see docs/INVOICING.md). */
(function () {
  "use strict";
  const C = window.InvoicesCore, U = window.SC && window.SC.util;
  window.AdminViews = window.AdminViews || {};

  const iv = {
    tab: "dashboard", ed: null, openId: null,
    lf: { q: "", status: "", from: "", to: "" }, pf: { q: "", method: "", from: "", to: "", reversed: false },
    cq: "", showArchived: false, rf: { from: "", to: "" }, pg: 1
  };
  const TABS = [["dashboard", "Dashboard", "Pasqyra"], ["list", "All invoices", "Të gjitha faturat"], ["create", "Create invoice", "Krijo faturë"], ["customers", "Customers", "Klientët"], ["payments", "Payments", "Pagesat"], ["reports", "Reports", "Raporte"], ["settings", "Invoice settings", "Cilësimet"]];
  const newToken = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));

  window.AdminViews.invoices = function (view, actions, X) {
    const { S, $, $$, esc, icon, nm, toast, ok, fail, confirmBox, drawer, busy, downloadCsv, fmtDate } = X;
    if (!X.isAdmin()) { view.innerHTML = '<div class="card"><div class="empty">Invoices are available to admins only.</div></div>'; return; }
    if (!S.inv) { view.innerHTML = '<div class="card"><div class="empty">The invoicing tables are not installed yet.<br>Run <strong>supabase-migration-v8-invoicing.sql</strong> in Supabase (on a staging project first), then reload this page. See <strong>docs/INVOICING.md</strong>.</div></div>'; return; }
    const money = (v, c) => U.formatMoney(Number(C.cents(v)), c || S.inv.settings.currency || "ALL", "en-GB");   // formatMoney takes minor units (cents)
    const dmy = (d) => (d ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : "");
    const pill = (st) => { const d = C.STATUS[st] || { en: st, tone: "" }; return '<span class="pill ' + (d.tone === "gray" ? "" : d.tone) + '">' + esc(d.en) + "</span>"; };
    const invById = (id) => S.inv.invoices.find((i) => i.id === id);
    const cfgReady = () => !!(S.inv.settings && S.inv.settings.company_name);
    const defVat = () => (S.inv.settings && S.inv.settings.default_vat_rate !== undefined ? String(S.inv.settings.default_vat_rate) : "");
    const errMsg = (e) => C.errText(e) || "Something went wrong.";
    const ctl = (label, inner) => '<label class="promo-ctl"><span>' + label + "</span>" + inner + "</label>";
    const tgt = (e) => e.__t || (e.__t = e.currentTarget);   // first call must happen before any await
    const refresh = async () => { await X.reload("invoices"); };

    /* route argument from the address bar: new | order:<id> | edit:<id> | view:<id> */
    const arg = S.invArg || ""; S.invArg = "";
    if (arg === "new") { iv.ed = blankEditor(); iv.tab = "create"; }
    else if (arg.startsWith("order:")) { iv.tab = "create"; startFromOrder(arg.slice(6)); }
    else if (arg.startsWith("edit:")) { iv.tab = "create"; startEditDraft(arg.slice(5)); }
    else if (arg.startsWith("view:")) { iv.tab = "list"; setTimeout(() => openInvoice(arg.slice(5)), 0); }

    view.innerHTML = '<div class="rp"><div class="rp-tabs no-print" role="tablist">' + TABS.map(([id, l, sq]) => '<button type="button" role="tab" class="rp-tab" data-itab="' + id + '" aria-selected="' + (iv.tab === id) + '" title="' + esc(sq) + '">' + esc(l) + "</button>").join("") + '</div><div id="iv-body" style="margin-top:1rem"></div></div>';
    actions.innerHTML = '<button type="button" class="button" id="iv-new">' + icon("file-text") + " Create invoice</button>";
    $("#iv-new").addEventListener("click", () => { iv.ed = blankEditor(); iv.tab = "create"; draw(); });
    $(".rp", view).addEventListener("click", (e) => { const b = e.target.closest("[data-itab]"); if (b) { if (iv.tab === "create" && iv.ed && iv.ed.dirty && b.dataset.itab !== "create") { confirmBox("Leave this invoice?", "You have unsaved changes in the invoice you are editing.", "Leave without saving", true).then((y) => { if (y) { iv.tab = b.dataset.itab; draw(); } }); return; } iv.tab = b.dataset.itab; draw(); } });
    if (!cfgReady()) view.insertAdjacentHTML("afterbegin", '<div class="notice" style="margin-bottom:.75rem">Company details are not set up yet. Open <strong>Invoice settings</strong> and fill them in — an invoice cannot be issued until they are (drafts are fine).</div>');
    draw();

    function draw() {
      $$("[data-itab]", view).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.itab === iv.tab)));
      const old = $("#iv-body"), box = old.cloneNode(false); old.replaceWith(box); // fresh node: no stale listeners
      bindOpen(box);
      ({ dashboard: tabDashboard, list: tabList, create: tabCreate, customers: tabCustomers, payments: tabPayments, reports: tabReports, settings: tabSettings })[iv.tab](box);
    }

    /* ═════════════ Dashboard ═════════════ */
    function tabDashboard(box) {
      const t = C.today(), month = t.slice(0, 7) + "-01";
      const all = C.summarize(S.inv.invoices, S.inv.payments, {}), mon = C.summarize(S.inv.invoices, S.inv.payments, { from: month, to: t });
      const cur = Object.keys(all).sort();
      const drafts = S.inv.invoices.filter((i) => i.status === "draft");
      const overdue = S.inv.invoices.filter((i) => i.display_status === "overdue").sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
      const rec = C.orderReconciliation(S.orders || [], S.inv.invoices);
      const card = (c) => '<div class="card"><div class="card-head"><h2>' + esc(c) + ' — all time</h2></div><div class="stats" style="padding:1rem 1rem 0">' +
        stat("Invoiced", money(all[c].invoiced, c), all[c].count + " issued invoices") + stat("Received", money(all[c].received, c), "payments recorded (reversals excluded)") +
        stat("Outstanding", money(all[c].outstanding, c), "still to be paid", all[c].outstanding > 0) + stat("Overdue", money(all[c].overdue, c), all[c].overdueCount + " invoices", all[c].overdue > 0) +
        stat("This month invoiced", money((mon[c] || {}).invoiced || 0, c), "since " + dmy(month)) + stat("This month received", money((mon[c] || {}).received || 0, c), "payments dated this month") + "</div></div>";
      box.innerHTML = (cur.length ? cur.map(card).join("") : '<div class="card"><div class="empty">No invoices yet. Use <strong>Create invoice</strong>, or press “Create invoice” on an order.</div></div>') +
        '<div class="cols"><section class="card"><div class="card-head"><h2>Overdue</h2></div>' + (overdue.length ? listTable(overdue.slice(0, 8)) : '<div class="empty">Nothing overdue.</div>') + "</section>" +
        '<section class="card"><div class="card-head"><h2>Drafts</h2></div>' + (drafts.length ? listTable(drafts.slice(0, 8)) : '<div class="empty">No drafts.</div>') + "</section></div>" +
        '<section class="card"><div class="card-head"><h2>Orders and invoices</h2></div><div class="card-body"><p class="muted small" style="margin-top:0">Shop orders and invoices are separate records. Issuing an invoice never changes an order, and recording a payment never changes an order status.</p><dl class="kv">' +
        "<dt>Active orders</dt><dd>" + rec.orders + "</dd><dt>With an invoice</dt><dd>" + rec.invoicedOrders + "</dd><dt>Without an invoice</dt><dd>" + rec.notInvoiced + (rec.notInvoiced ? " (" + money(rec.notInvoicedValue) + ")" : "") + "</dd></dl>" +
        (rec.differs.length ? '<p class="small"><strong>Invoice total differs from the order total</strong> (for example VAT or extra lines were added): ' + rec.differs.map((d) => esc(d.order) + " → " + esc(d.invoice) + " (" + money(d.orderTotal) + " vs " + money(d.invoiceTotal) + ")").join("; ") + "</p>" : "") + "</div></section>";
    }
    function stat(l, v, h, w) { return '<div class="stat' + (w ? " warn" : "") + '"><div class="label">' + esc(l) + '</div><div class="value" style="font-size:1.25rem">' + esc(v) + '</div><div class="hint">' + esc(h || "") + "</div></div>"; }
    function listTable(rows) {
      return '<div class="table-wrap"><table class="data"><thead><tr><th>No.</th><th>Customer</th><th>Issued</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead><tbody>' + rows.map((i) =>
        '<tr style="cursor:pointer" tabindex="0" data-open-inv="' + esc(i.id) + '"><td><strong>' + esc(i.number || "Draft") + "</strong>" + (i.order_ref ? '<br><small class="muted">' + esc(i.order_ref) + "</small>" : "") + "</td><td>" + esc((i.customer || {}).name) + "</td><td>" + dmy(i.issue_date) + "</td><td>" + dmy(i.due_date) + '</td><td class="num">' + money(i.total, i.currency) + '</td><td class="num">' + (i.status === "issued" ? money(i.balance, i.currency) : "–") + "</td><td>" + pill(i.display_status) + "</td></tr>").join("") + "</tbody></table></div>";
    }
    function bindOpen(box) { box.addEventListener("click", (e) => { const r = e.target.closest("[data-open-inv]"); if (r) openInvoice(r.dataset.openInv); }); box.addEventListener("keydown", (e) => { if (e.key === "Enter") { const r = e.target.closest("[data-open-inv]"); if (r) openInvoice(r.dataset.openInv); } }); }

    /* ═════════════ All invoices ═════════════ */
    function tabList(box) {
      const f = iv.lf, q = (f.q || "").toLowerCase();
      const rows = S.inv.invoices.filter((i) => (!f.status || i.display_status === f.status) && (!f.from || i.issue_date >= f.from) && (!f.to || i.issue_date <= f.to) &&
        (!q || [i.number, (i.customer || {}).name, (i.customer || {}).tax_id, i.order_ref, i.total].join(" ").toLowerCase().includes(q)));
      box.innerHTML = '<div class="rp-fgrid">' + ctl("Search", '<input id="lf-q" placeholder="number, customer, order" value="' + esc(f.q) + '">') +
        ctl("Status", '<select id="lf-s"><option value="">All</option>' + Object.keys(C.STATUS).map((k) => '<option value="' + k + '"' + (f.status === k ? " selected" : "") + ">" + C.STATUS[k].en + "</option>").join("") + "</select>") +
        ctl("From", '<input type="date" id="lf-f" value="' + esc(f.from) + '">') + ctl("To", '<input type="date" id="lf-t" value="' + esc(f.to) + '">') + '</div>' +
        '<p><button type="button" class="button button-outline button-sm" id="lf-csv">' + icon("download") + " Export CSV (" + rows.filter((r) => r.status !== "draft").length + ")</button></p>" +
        (rows.length ? '<div class="card">' + listTable(rows.slice(0, 200)) + "</div>" + (rows.length > 200 ? '<p class="muted small">Showing the newest 200 of ' + rows.length + ". Narrow the filters or export the CSV.</p>" : "") : '<div class="card"><div class="empty">' + (S.inv.invoices.length ? "No invoices match." : "No invoices yet.") + "</div></div>");
      $("#lf-q").addEventListener("input", (e) => { f.q = e.target.value; const p = e.target.selectionStart; draw(); const n = $("#lf-q"); n.focus(); n.setSelectionRange(p, p); });
      $("#lf-s").addEventListener("change", (e) => { f.status = e.target.value; draw(); });
      $("#lf-f").addEventListener("change", (e) => { f.from = e.target.value; draw(); }); $("#lf-t").addEventListener("change", (e) => { f.to = e.target.value; draw(); });
      $("#lf-csv").addEventListener("click", () => downloadCsv("invoices", C.INV_CSV_HEAD, C.invoiceCsvRows(rows)));
    }

    /* ═════════════ Invoice detail ═════════════ */
    async function openInvoice(id) {
      let inv = invById(id); if (!inv) { await refresh(); inv = invById(id); }
      if (!inv) { toast("info", "That invoice was not found."); return; }
      iv.openId = id;
      const dr = drawer(inv.number ? "Invoice " + inv.number : "Draft invoice", '<div class="empty">Loading…</div>', "");
      try {
        const [items, events] = await Promise.all([SupabaseClient.fetchInvoiceItems(id), SupabaseClient.fetchInvoiceEvents(id)]);
        paintDetail(dr, inv, items, events);
      } catch (e) { $(".drawer-body", dr.el).innerHTML = '<div class="empty">' + esc(errMsg(e)) + "</div>"; }
    }
    function paintDetail(dr, inv, items, events) {
      const pays = S.inv.payments.filter((p) => p.invoice_id === inv.id), c = inv.customer || {}, cur = inv.currency;
      const live = pays.filter((p) => !p.reversed), seller = inv.seller || S.inv.settings;
      const body =
        '<p>' + pill(inv.display_status) + (inv.order_ref ? ' &nbsp;Order <button type="button" class="link-btn" id="dv-order">' + esc(inv.order_ref) + "</button>" : "") + "</p>" +
        '<dl class="kv"><dt>Customer</dt><dd>' + esc(c.name) + (c.tax_id ? "<br><small>" + esc(c.tax_id) + "</small>" : "") + (c.address ? "<br><small>" + esc([c.address, c.city, c.country].filter(Boolean).join(", ")) + "</small>" : "") + "</dd>" +
        (c.phone ? "<dt>Phone</dt><dd>" + esc(c.phone) + "</dd>" : "") + "<dt>Issued</dt><dd>" + dmy(inv.issue_date) + "</dd><dt>Due</dt><dd>" + (dmy(inv.due_date) || "–") + "</dd>" +
        (inv.status === "cancelled" ? "<dt>Cancelled</dt><dd>" + esc(inv.cancel_reason) + "</dd>" : "") + "</dl>" +
        '<table class="items-table"><thead><tr><th>Item</th><th class="num">Qty × price</th><th class="num">Total</th></tr></thead><tbody>' + items.map((i) => "<tr><td>" + esc(i.name) + (i.sku ? "<br><small class='muted'>" + esc(i.sku) + "</small>" : "") + (Number(i.line_discount) ? "<br><small class='muted'>discount −" + money(i.line_discount, cur) + "</small>" : "") + (Number(i.vat_rate) ? "<br><small class='muted'>VAT " + esc(i.vat_rate) + "%</small>" : "") + '</td><td class="num">' + esc(String(parseFloat(Number(i.qty).toFixed(3)))) + " × " + money(i.unit_price, cur) + '</td><td class="num">' + money(i.line_total, cur) + "</td></tr>").join("") +
        "</tbody><tfoot>" + [["Subtotal", inv.gross_total], ["Line discounts", -inv.line_discount_total, inv.line_discount_total], ["Overall discount", -inv.overall_discount_total, inv.overall_discount_total], ["Taxable amount", inv.taxable_total], ["Delivery", inv.shipping, inv.shipping], ["VAT", inv.tax_total]].filter((r) => r[2] === undefined || Number(r[2])).map((r) => '<tr><td colspan="2">' + r[0] + '</td><td class="num">' + money(r[1], cur) + "</td></tr>").join("") +
        '<tr><td colspan="2"><strong>Total</strong></td><td class="num"><strong>' + money(inv.total, cur) + "</strong></td></tr>" +
        (inv.status === "issued" ? '<tr><td colspan="2">Paid</td><td class="num">' + money(inv.paid_amount, cur) + '</td></tr><tr><td colspan="2"><strong>Balance</strong></td><td class="num"><strong>' + money(inv.balance, cur) + "</strong></td></tr>" : "") + "</tfoot></table>" +
        (inv.order_id && Number(inv.source_order_total) !== Number(inv.total) ? '<p class="muted small">Order total was ' + money(inv.source_order_total, cur) + ". This invoice differs (VAT, discount or extra lines were added).</p>" : "") +
        (inv.status !== "draft" ? "<h3 style='margin:1.25rem 0 .4rem'>Payments</h3>" + (pays.length ? '<table class="items-table"><tbody>' + pays.map((p) => "<tr" + (p.reversed ? ' style="opacity:.55"' : "") + "><td>" + dmy(p.paid_on) + "<br><small class='muted'>" + esc((C.METHODS[p.method] || {}).en || p.method) + (p.reference ? " · " + esc(p.reference) : "") + (p.reversed ? " · reversed: " + esc(p.reverse_reason) : "") + '</small></td><td class="num">' + (p.reversed ? "<s>" : "") + money(p.amount, cur) + (p.reversed ? "</s>" : "") + '</td><td class="num">' + (!p.reversed && inv.status === "issued" ? '<button type="button" class="button button-outline button-sm" data-rev="' + esc(p.id) + '">Reverse</button>' : "") + "</td></tr>").join("") + "</tbody></table>" : '<p class="muted small">No payments recorded.</p>') : "") +
        "<h3 style='margin:1.25rem 0 .4rem'>History</h3><ul class='muted small' style='padding-left:1.1rem;margin:0'>" + events.map((e) => "<li>" + esc(fmtDate(e.at)) + " — " + esc(e.action.replace(/_/g, " ")) + (e.actor_email ? " <span>(" + esc(e.actor_email) + ")</span>" : "") + "</li>").join("") + "</ul>" +
        (inv.status === "issued" || inv.status === "cancelled" ? '<p class="muted small" style="margin-top:1rem">This is an informal invoice. It is not fiscalized and carries no NIVF / NSLF data.</p>' : "");
      const foot = inv.status === "draft"
        ? '<button type="button" class="button button-outline button-danger" id="dv-del" style="margin-right:auto;background:#fff;color:#b42318">Delete draft</button><button type="button" class="button button-outline" id="dv-pdf">Preview PDF</button><button type="button" class="button button-outline" id="dv-edit">Edit</button><button type="button" class="button" id="dv-issue">Issue invoice</button>'
        : '<button type="button" class="button button-outline" id="dv-pdf">Open PDF</button><button type="button" class="button button-outline" id="dv-dl">Download</button><button type="button" class="button button-outline" id="dv-wa">WhatsApp</button>' +
          (inv.status === "issued" ? '<button type="button" class="button button-outline button-danger" id="dv-cancel" style="background:#fff;color:#b42318">Cancel invoice</button>' + (Number(inv.balance) > 0 ? '<button type="button" class="button" id="dv-pay">Record payment</button>' : "") : "");
      $(".drawer-body", dr.el).innerHTML = body;
      let f = $(".drawer-foot", dr.el); if (!f) { f = document.createElement("div"); f.className = "drawer-foot"; $(".drawer-panel", dr.el).appendChild(f); } f.innerHTML = foot;
      const on = (sel, fn) => { const n = $(sel, dr.el); if (n) n.addEventListener("click", (e) => { e.__t = e.currentTarget; return fn(e); }); };
      const reopen = async () => { dr.close(); await refresh(); draw(); openInvoice(inv.id); };
      on("#dv-order", () => { dr.close(); S.section = "orders"; location.hash = "#orders/" + inv.order_id; });
      on("#dv-pdf", () => pdfOpen(inv, items, pays, false)); on("#dv-dl", () => pdfOpen(inv, items, pays, true));
      on("#dv-wa", () => {
        const ph = C.waPhone(c.phone); if (!ph) { toast("error", "This customer has no phone number. Add it to the customer first."); return; }
        window.open("https://wa.me/" + ph + "?text=" + encodeURIComponent(C.whatsappText(inv, seller, (S.inv.settings.language || "sq"))), "_blank", "noopener");
        toast("info", "WhatsApp opened with the message. Attach the downloaded PDF yourself — nothing was sent or recorded.");
      });
      on("#dv-edit", () => { dr.close(); iv.tab = "create"; startEditDraft(inv.id); });
      on("#dv-del", async (e) => { if (!(await confirmBox("Delete this draft?", "Drafts have no number, so deleting one leaves no gap in your numbering.", "Delete draft", true))) return; busy(tgt(e), true); try { await SupabaseClient.deleteInvoiceDraft(inv.id); ok("Draft deleted"); dr.close(); await refresh(); draw(); } catch (er) { fail(er, "Could not delete the draft"); busy(tgt(e), false); } });
      on("#dv-issue", (e) => issueFlow(inv, dr, e.currentTarget));
      on("#dv-cancel", async (e) => {
        if (Number(inv.paid_amount) > 0) { toast("error", "Reverse the recorded payments first, then cancel the invoice."); return; }
        const reason = await askText("Cancel invoice " + inv.number + "?", "The number stays used and the invoice stays on record as cancelled. If an order was behind it, you can create a corrected invoice for that order afterwards. Reason (required):", "Cancel invoice");
        if (reason === null) return; busy(tgt(e), true);
        try { await SupabaseClient.cancelInvoice(inv.id, reason); ok("Invoice cancelled"); await reopen(); } catch (er) { fail(er, "Could not cancel"); busy(tgt(e), false); }
      });
      on("#dv-pay", () => paymentForm(inv, reopen));
      $$("[data-rev]", dr.el).forEach((b) => b.addEventListener("click", async () => {
        const reason = await askText("Reverse this payment?", "The payment stays in the history, marked reversed, and the balance goes back up. Reason (required):", "Reverse payment");
        if (reason === null) return; busy(b, true);
        try { await SupabaseClient.reverseInvoicePayment(b.dataset.rev, reason); ok("Payment reversed"); await reopen(); } catch (er) { fail(er, "Could not reverse the payment"); busy(b, false); }
      }));
    }

    function askText(title, text, label) {
      return new Promise((resolve) => {
        const dr = drawer(title, '<p class="muted">' + esc(text) + '</p><div class="form-group"><textarea id="at-v" rows="3" maxlength="300" style="width:100%"></textarea></div>', '<button type="button" class="button button-outline" data-close>Back</button><button type="button" class="button button-danger" id="at-ok">' + esc(label) + "</button>");
        let done = false;
        $("#at-ok", dr.el).addEventListener("click", () => { const v = $("#at-v", dr.el).value.trim(); if (v.length < 3) { toast("error", "Please give a reason (at least 3 characters)."); return; } done = true; dr.close(); resolve(v); });
        dr.el.addEventListener("click", (e) => { if (!done && (e.target.closest("[data-close]") || e.target === dr.el)) setTimeout(() => resolve(null), 0); });
      });
    }

    async function issueFlow(inv, dr, btn) {
      if (!cfgReady()) { toast("error", "Fill in the company details in Invoice settings before issuing."); return; }
      if (!(await confirmBox("Issue invoice?", "It gets the next invoice number and becomes final: the lines, prices and totals can no longer be edited. Mistakes are corrected by cancelling it and issuing a new one. It will NOT be fiscalized.", "Issue invoice"))) return;
      busy(btn, true);
      try { const r = await SupabaseClient.issueInvoice(inv.id); ok("Issued " + (r && r.number ? r.number : "")); dr.close(); await refresh(); draw(); openInvoice(inv.id); }
      catch (e) {
        busy(btn, false);
        if (C.errCode(e) === "price_changed") {
          if (await confirmBox("A catalogue price changed", errMsg(e) + " Update this draft with the current catalogue prices? You can then review and issue it.", "Update prices")) {
            try { const items = await SupabaseClient.fetchInvoiceItems(inv.id); await SupabaseClient.saveInvoiceDraft(draftPayload(inv), items.map(rowToLine).map(lineToPayload)); ok("Prices updated — review the draft"); dr.close(); await refresh(); draw(); openInvoice(inv.id); } catch (e2) { fail(e2, "Could not update the draft"); }
          }
        } else fail(e, "Could not issue the invoice");
      }
    }
    const draftPayload = (inv) => ({ id: inv.id, customer_id: inv.customer_id, customer: inv.customer, currency: inv.currency, issue_date: inv.issue_date, due_date: inv.due_date, payment_method: inv.payment_method, payment_terms: inv.payment_terms, notes: inv.notes, footer: inv.footer,
      overall_discount_type: inv.overall_discount_type, overall_discount_value: inv.overall_discount_value, shipping: inv.shipping, shipping_vat_rate: inv.shipping_vat_rate });

    function paymentForm(inv, done) {
      const token = newToken();
      const dr = drawer("Record payment — " + inv.number, '<p class="muted">Balance: <strong>' + money(inv.balance, inv.currency) + '</strong>. This only records money you received; it does not change any order.</p>' +
        ctl("Amount (" + esc(inv.currency) + ")", '<input id="pm-a" inputmode="decimal" value="' + esc(Number(inv.balance).toFixed(2)) + '">') + ctl("Date received", '<input type="date" id="pm-d" value="' + C.today() + '" max="' + C.today() + '">') +
        ctl("Method", '<select id="pm-m">' + Object.keys(C.METHODS).map((k) => '<option value="' + k + '">' + C.METHODS[k].en + "</option>").join("") + "</select>") + ctl("Reference (optional)", '<input id="pm-r" maxlength="120" placeholder="receipt / transfer no.">') + ctl("Note (optional)", '<input id="pm-n" maxlength="300">'),
        '<button type="button" class="button button-outline" data-close>Cancel</button><button type="button" class="button" id="pm-save">Record payment</button>');
      $("#pm-save", dr.el).addEventListener("click", async (e) => {
        const a = $("#pm-a", dr.el).value.trim().replace(",", ".");
        if (!/^\d+(\.\d{1,2})?$/.test(a) || Number(a) <= 0) { toast("error", "Enter a valid amount with at most 2 decimals."); return; }
        busy(tgt(e), true);
        try { await SupabaseClient.recordInvoicePayment({ invoice_id: inv.id, paid_on: $("#pm-d", dr.el).value, amount: a, method: $("#pm-m", dr.el).value, reference: $("#pm-r", dr.el).value, note: $("#pm-n", dr.el).value, token }); ok("Payment recorded"); dr.close(); done(); }
        catch (er) { fail(er, "Could not record the payment"); busy(tgt(e), false); }
      });
    }

    /* ═════════════ PDF ═════════════ */
    let logoBytes;
    async function loadLogo() { if (logoBytes !== undefined) return logoBytes; try { const r = await fetch("logo.png"); logoBytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { logoBytes = null; } return logoBytes; }
    async function makePdf(inv, items, pays) {
      if (!window.PDFLib || !window.InvoicePdf) throw new Error("The PDF library did not load. Reload the page.");
      return window.InvoicePdf.build({ invoice: inv, items, payments: pays, seller: S.inv.settings, lang: S.inv.settings.language || "sq", logo: await loadLogo() });
    }
    async function pdfOpen(inv, items, pays, download) {
      try {
        const bytes = await makePdf(inv, items, pays), url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        if (download) { const a = document.createElement("a"); a.href = url; a.download = (inv.number || "draft-invoice") + ".pdf"; document.body.appendChild(a); a.click(); a.remove(); }
        else if (!window.open(url, "_blank")) toast("error", "The browser blocked the PDF window. Allow pop-ups for this page, or use Download.");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) { fail(e, "Could not build the PDF"); }
    }

    /* ═════════════ Create / edit ═════════════ */
    function blankEditor() {
      const s = S.inv.settings || {};
      return { id: null, token: newToken(), order: null, customer_id: "", cust: { kind: "person", name: "", tax_id: "", address: "", city: "", country: "", email: "", phone: "" }, saveCust: true, currency: s.currency || "ALL",
        issue_date: C.today(), due_date: C.addDays(C.today(), Number(s.payment_terms_days === undefined ? 14 : s.payment_terms_days)), lines: [], ovType: "amount", ovValue: "0", shipping: "0", shipVat: defVat() || "0",
        method: "", terms: s.payment_terms_text || "", notes: s.notes_default || "", footer: s.footer || "", dirty: false };
    }
    function rowToLine(r) { return { kind: r.kind, source_id: r.source_id, order_line: r.order_line, name: r.name, sku: r.sku, description: r.description, unit: r.unit, qty: String(parseFloat(Number(r.qty).toFixed(3))), unit_price: String(r.unit_price), discount_type: r.discount_type, discount_value: String(r.discount_value), vat_rate: String(r.vat_rate) }; }
    function lineToPayload(l) { const o = { kind: l.kind, qty: l.qty, discount_type: l.discount_type, discount_value: l.discount_value || "0", vat_rate: l.vat_rate === "" ? undefined : l.vat_rate, description: l.description, unit: l.unit }; if (l.kind === "product" || l.kind === "service") o.source_id = l.source_id; if (l.kind === "order") o.order_line = l.order_line; if (l.kind === "custom") { o.name = l.name; o.sku = l.sku; } if (l.kind === "custom" || (l.kind === "service" && l.priceFree)) o.unit_price = l.unit_price; return o; }
    async function startEditDraft(id) {
      let inv = invById(id); if (!inv) { await refresh(); inv = invById(id); } if (!inv || inv.status !== "draft") { toast("error", "Only a draft can be edited."); iv.tab = "list"; draw(); return; }
      try {
        const items = await SupabaseClient.fetchInvoiceItems(id), ed = blankEditor();
        Object.assign(ed, { id, token: inv.client_token || ed.token, order: inv.order_id ? { id: inv.order_id, ref: inv.order_ref, total: inv.source_order_total } : null, customer_id: inv.customer_id || "", cust: Object.assign(ed.cust, inv.customer || {}), saveCust: false, currency: inv.currency, issue_date: inv.issue_date, due_date: inv.due_date || "",
          ovType: inv.overall_discount_type, ovValue: String(inv.overall_discount_value), shipping: String(inv.shipping), shipVat: String(inv.shipping_vat_rate), method: inv.payment_method, terms: inv.payment_terms, notes: inv.notes, footer: inv.footer, lines: items.map(rowToLine) });
        for (const l of ed.lines) if (l.kind === "service") { const s = (S.services || []).find((x) => x.id === l.source_id); l.priceFree = !!s && !(Number(s.price) > 0); }
        iv.ed = ed; draw();
      } catch (e) { fail(e, "Could not open the draft"); }
    }
    async function startFromOrder(orderId) {
      if (!(S.orders || []).some((o) => String(o.id) === String(orderId))) await X.reload("orders");
      const o = (S.orders || []).find((x) => String(x.id) === String(orderId));
      if (!o) { toast("error", "That order was not found."); iv.tab = "list"; draw(); return; }
      const existing = S.inv.invoices.find((i) => String(i.order_id) === String(o.id) && i.status !== "cancelled");
      if (existing) { toast("info", "This order already has " + (existing.number ? "invoice " + existing.number : "a draft invoice") + "."); iv.tab = "list"; draw(); if (existing.status === "draft") { iv.tab = "create"; startEditDraft(existing.id); } else openInvoice(existing.id); return; }
      const ed = blankEditor();
      const matched = S.inv.customers.find((c) => !c.archived && ((o.customer_phone && c.phone === o.customer_phone) || (o.customer_email && c.email && c.email.toLowerCase() === o.customer_email.toLowerCase())));
      Object.assign(ed, { order: { id: o.id, ref: o.order_number || "#" + o.id, total: o.total }, customer_id: matched ? matched.id : "", cust: Object.assign(ed.cust, matched ? { kind: matched.kind, name: matched.name, tax_id: matched.tax_id, address: matched.address || o.delivery_address, city: matched.city, country: matched.country, email: matched.email, phone: matched.phone } : { name: o.customer_name, address: o.delivery_address, email: o.customer_email || "", phone: o.customer_phone || "" }), saveCust: !matched,
        currency: ((o.items[0] || {}).currency) || ed.currency, shipping: String(o.shipping || 0), method: "cash", notes: ed.notes });
      ed.lines = o.items.map((it, i) => ({ kind: "order", order_line: i, source_id: it.id, name: nm(it.name) || it.id, sku: it.sku || "", description: "", unit: "pcs", qty: String(it.qty), unit_price: String(it.price), discount_type: "amount", discount_value: "0", vat_rate: defVat() || "0" }));
      ed.dirty = true; iv.ed = ed; draw();
    }

    function tabCreate(box) {
      if (!iv.ed) iv.ed = blankEditor();
      const ed = iv.ed, isOrder = !!ed.order;
      const custOpts = '<option value="">— new / one-off customer —</option>' + S.inv.customers.filter((c) => !c.archived || c.id === ed.customer_id).map((c) => '<option value="' + esc(c.id) + '"' + (ed.customer_id === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>").join("");
      box.innerHTML = '<div class="card"><div class="card-head"><h2>' + (ed.id ? "Edit draft" : "New invoice") + (isOrder ? " — from order " + esc(ed.order.ref) : "") + '</h2></div><div class="card-body">' +
        (isOrder ? '<div class="notice" style="margin-bottom:.8rem">Lines, quantities, prices and delivery are the <strong>original recorded order</strong> and cannot be changed here. You can add VAT or discounts, extra lines, and edit the customer details. Original order total: <strong>' + money(ed.order.total, ed.currency) + "</strong>.</div>" : "") +
        '<h3>Customer</h3><div class="rp-fgrid">' + ctl("Saved customer", '<select id="ed-cust">' + custOpts + "</select>") + ctl("Type", '<select data-c="kind"><option value="person"' + (ed.cust.kind === "person" ? " selected" : "") + '>Person</option><option value="business"' + (ed.cust.kind === "business" ? " selected" : "") + ">Business</option></select>") +
        ctl("Name *", '<input data-c="name" maxlength="120" value="' + esc(ed.cust.name) + '">') + ctl("Tax ID (NIPT)", '<input data-c="tax_id" maxlength="40" value="' + esc(ed.cust.tax_id) + '">') + ctl("Address", '<input data-c="address" maxlength="200" value="' + esc(ed.cust.address) + '">') +
        ctl("City", '<input data-c="city" maxlength="80" value="' + esc(ed.cust.city) + '">') + ctl("Country", '<input data-c="country" maxlength="80" value="' + esc(ed.cust.country) + '">') + ctl("Phone", '<input data-c="phone" maxlength="40" value="' + esc(ed.cust.phone) + '">') + ctl("E-mail", '<input data-c="email" maxlength="160" value="' + esc(ed.cust.email) + '">') + "</div>" +
        '<label class="check-line"><input type="checkbox" id="ed-savecust"' + (ed.saveCust && !ed.customer_id ? " checked" : "") + (ed.customer_id ? " disabled" : "") + "> Save as a customer for next time</label>" +
        '<h3>Invoice</h3><div class="rp-fgrid">' + ctl("Issue date", '<input type="date" data-h="issue_date" value="' + esc(ed.issue_date) + '">') + ctl("Due date", '<input type="date" data-h="due_date" value="' + esc(ed.due_date) + '">') +
        ctl("Currency", '<input data-h="currency" maxlength="3" style="text-transform:uppercase" value="' + esc(ed.currency) + '"' + (isOrder || ed.lines.some((l) => l.kind !== "custom") ? " disabled" : "") + ">") +
        ctl("Payment method", '<select data-h="method"><option value="">—</option>' + Object.keys(C.METHODS).map((k) => '<option value="' + k + '"' + (ed.method === k ? " selected" : "") + ">" + C.METHODS[k].en + "</option>").join("") + "</select>") + "</div>" +
        '<h3>Lines</h3><div id="ed-lines"></div><p class="no-print" id="ed-adders"></p>' +
        '<div class="rp-fgrid">' + ctl("Overall discount", '<span style="display:flex;gap:.4rem"><select data-h="ovType" style="max-width:6rem"><option value="amount"' + (ed.ovType === "amount" ? " selected" : "") + '>amount</option><option value="percent"' + (ed.ovType === "percent" ? " selected" : "") + '>%</option></select><input data-h="ovValue" inputmode="decimal" value="' + esc(ed.ovValue) + '"></span>') +
        ctl("Delivery charge", '<input data-h="shipping" inputmode="decimal" value="' + esc(ed.shipping) + '"' + (isOrder ? " disabled" : "") + ">") + ctl("Delivery VAT %", '<input data-h="shipVat" inputmode="decimal" value="' + esc(ed.shipVat) + '">') + "</div>" +
        '<div id="ed-totals" class="card" style="margin:1rem 0"></div>' +
        ctl("Payment terms", '<input data-h="terms" maxlength="300" value="' + esc(ed.terms) + '">') + ctl("Notes (printed on the invoice)", '<textarea data-h="notes" rows="2" maxlength="1000" style="width:100%">' + esc(ed.notes) + "</textarea>") + ctl("Footer", '<input data-h="footer" maxlength="400" value="' + esc(ed.footer) + '">') +
        '<p class="muted small" id="ed-vatnote"></p><div class="rp-quick no-print"><button type="button" class="button" id="ed-save">Save draft</button> <button type="button" class="button button-outline" id="ed-prev">Preview PDF</button> <button type="button" class="button button-outline" id="ed-issue">Save &amp; issue…</button> <button type="button" class="button button-outline" id="ed-discard">Discard</button></div></div></div>';
      drawLines(); totals();
      const num = ["ovValue", "shipping", "shipVat"];
      box.addEventListener("input", (e) => {
        const t = e.target; ed.dirty = true;
        if (t.dataset.c) ed.cust[t.dataset.c] = t.value; else if (t.dataset.h) ed[t.dataset.h] = t.dataset.h === "currency" ? t.value.toUpperCase() : t.value;
        else if (t.dataset.l !== undefined) { const l = ed.lines[Number(t.dataset.i)]; if (l) l[t.dataset.l] = t.value; }
        else return;
        totals();
      });
      box.addEventListener("change", (e) => {
        const t = e.target;
        if (t.id === "ed-cust") { ed.customer_id = t.value; const c = S.inv.customers.find((x) => x.id === t.value); if (c) Object.assign(ed.cust, { kind: c.kind, name: c.name, tax_id: c.tax_id, address: c.address, city: c.city, country: c.country, phone: c.phone, email: c.email }); ed.dirty = true; draw(); }
        else if (t.id === "ed-savecust") ed.saveCust = t.checked;
        else if (t.dataset.l === "discount_type") { ed.lines[Number(t.dataset.i)].discount_type = t.value; totals(); }
      });
      box.addEventListener("click", (e) => { const r = e.target.closest("[data-rm]"); if (r) { ed.lines.splice(Number(r.dataset.rm), 1); ed.dirty = true; drawLines(); totals(); } });
      $("#ed-save").addEventListener("click", (e) => saveDraft(e.currentTarget, false));
      $("#ed-issue").addEventListener("click", (e) => saveDraft(e.currentTarget, true));
      $("#ed-prev").addEventListener("click", (e) => previewDraft(e.currentTarget));
      $("#ed-discard").addEventListener("click", async () => { if (ed.dirty && !(await confirmBox("Discard this invoice?", "Unsaved changes will be lost. A saved draft stays in All invoices.", "Discard", true))) return; iv.ed = null; iv.tab = "list"; draw(); });
    }

    function drawLines() {
      const ed = iv.ed, box = $("#ed-lines"), isOrder = !!ed.order;
      box.innerHTML = ed.lines.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th style="width:5.5rem">Qty</th><th style="width:7rem">Unit price</th><th style="width:9rem">Discount</th><th style="width:5rem">VAT %</th><th class="num" style="width:7rem">Line total</th><th></th></tr></thead><tbody>' +
        ed.lines.map((l, i) => {
          const locked = l.kind === "order", priceEd = l.kind === "custom" || (l.kind === "service" && l.priceFree);
          return "<tr><td>" + (l.kind === "custom" ? '<input data-l="name" data-i="' + i + '" maxlength="200" placeholder="Description" value="' + esc(l.name) + '" style="width:100%">' : "<strong>" + esc(l.name) + "</strong>" + (l.sku ? '<br><small class="muted">' + esc(l.sku) + "</small>" : "") + (l.kind === "service" ? ' <span class="pill">service</span>' : "") + (locked ? ' <span class="pill blue">order</span>' : "")) + "</td>" +
            '<td><input data-l="qty" data-i="' + i + '" inputmode="decimal" value="' + esc(l.qty) + '"' + (locked ? " disabled" : "") + ' style="width:100%"></td>' +
            '<td><input data-l="unit_price" data-i="' + i + '" inputmode="decimal" value="' + esc(l.unit_price) + '"' + (priceEd ? "" : " disabled") + ' style="width:100%"' + (l.kind === "service" && l.priceFree ? ' placeholder="agreed price"' : "") + "></td>" +
            '<td><span style="display:flex;gap:.25rem"><select data-l="discount_type" data-i="' + i + '" style="max-width:4.2rem"><option value="amount"' + (l.discount_type === "amount" ? " selected" : "") + '>amt</option><option value="percent"' + (l.discount_type === "percent" ? " selected" : "") + '>%</option></select><input data-l="discount_value" data-i="' + i + '" inputmode="decimal" value="' + esc(l.discount_value) + '" style="width:100%"></span></td>' +
            '<td><input data-l="vat_rate" data-i="' + i + '" inputmode="decimal" value="' + esc(l.vat_rate) + '" style="width:100%"></td><td class="num" data-lt="' + i + '"></td><td>' + (locked ? "" : '<button type="button" class="icon-btn" data-rm="' + i + '" aria-label="Remove line">' + icon("x") + "</button>") + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<p class="muted">No lines yet. Add a product or service from your catalogue, or a custom line.</p>';
      const pr = (S.products || []).filter((p) => p.available !== false || true), sv = S.services || [];
      $("#ed-adders").innerHTML = '<select id="add-prod" aria-label="Add product"><option value="">+ Add product…</option>' + pr.map((p) => '<option value="' + esc(p.id) + '">' + esc(nm(p.name)) + (p.sku ? " (" + esc(p.sku) + ")" : "") + " — " + esc(money(p.price, p.currency)) + (p.available ? "" : " [hidden]") + "</option>").join("") + "</select> " +
        '<select id="add-svc" aria-label="Add service"><option value="">+ Add service…</option>' + sv.map((s) => '<option value="' + esc(s.id) + '">' + esc(nm(s.name)) + " — " + (Number(s.price) > 0 ? esc(money(s.price, s.currency)) : "price on request") + "</option>").join("") + '</select> <button type="button" class="button button-outline button-sm" id="add-custom">+ Custom line</button>';
      const addLine = (l) => { const ed2 = iv.ed; ed2.lines.push(Object.assign({ description: "", unit: "pcs", qty: "1", discount_type: "amount", discount_value: "0", vat_rate: defVat() || "0" }, l)); ed2.dirty = true; draw(); };
      $("#add-prod").addEventListener("change", (e) => { const p = pr.find((x) => x.id === e.target.value); if (!p) return; if (p.currency && ed.lines.length === 0 && !isOrder) ed.currency = p.currency; addLine({ kind: "product", source_id: p.id, name: nm(p.name), sku: p.sku || "", unit_price: String(p.price) }); });
      $("#add-svc").addEventListener("change", (e) => { const s = sv.find((x) => x.id === e.target.value); if (!s) return; if (s.currency && ed.lines.length === 0 && !isOrder) ed.currency = s.currency; addLine({ kind: "service", source_id: s.id, name: nm(s.name), sku: "", unit_price: Number(s.price) > 0 ? String(s.price) : "", priceFree: !(Number(s.price) > 0) }); });
      $("#add-custom").addEventListener("click", () => addLine({ kind: "custom", name: "", sku: "", unit_price: "" }));
    }

    function problems() {
      const ed = iv.ed, p = [];
      if (!ed.cust.name || ed.cust.name.trim().length < 2) p.push("Enter the customer name.");
      if (!/^[A-Za-z]{3}$/.test(ed.currency)) p.push("Currency must be a 3-letter code.");
      if (!ed.lines.length) p.push("Add at least one line.");
      ed.lines.forEach((l, i) => {
        const n = i + 1;
        if (l.kind === "custom" && !l.name.trim()) p.push("Line " + n + ": enter a description.");
        if (!(Number(l.qty) > 0) || !C.isMoney(l.qty)) p.push("Line " + n + ": quantity must be greater than 0.");
        if ((l.kind === "custom" || l.priceFree) && (l.unit_price === "" || !C.isMoney(l.unit_price))) p.push("Line " + n + ": enter a valid price.");
        if (l.discount_value !== "" && !C.isMoney(l.discount_value)) p.push("Line " + n + ": discount is not a valid number.");
        if (l.discount_type === "percent" && Number(l.discount_value) > 100) p.push("Line " + n + ": a percentage discount cannot exceed 100.");
        if (l.vat_rate === "" || !C.isMoney(l.vat_rate) || Number(l.vat_rate) > 100) p.push("Line " + n + ": VAT must be between 0 and 100 (type 0 if none applies).");
      });
      if (ed.ovValue !== "" && (!C.isMoney(ed.ovValue) || (ed.ovType === "percent" && Number(ed.ovValue) > 100))) p.push("Overall discount is not valid.");
      if (!C.isMoney(ed.shipping || "0")) p.push("Delivery charge is not a valid number.");
      if (ed.shipVat !== "" && (!C.isMoney(ed.shipVat) || Number(ed.shipVat) > 100)) p.push("Delivery VAT must be between 0 and 100.");
      if (ed.due_date && ed.due_date < ed.issue_date) p.push("The due date is before the issue date.");
      return p;
    }
    function totals() {
      const ed = iv.ed; if (!ed) return;
      const r = C.compute(ed.lines.map((l) => ({ qty: C.isMoney(l.qty) ? l.qty : 0, unit_price: C.isMoney(l.unit_price) ? l.unit_price : 0, discount_type: l.discount_type, discount_value: C.isMoney(l.discount_value) ? l.discount_value : 0, vat_rate: C.isMoney(l.vat_rate) ? l.vat_rate : 0 })),
        { discountType: ed.ovType, discountValue: C.isMoney(ed.ovValue) ? ed.ovValue : 0, shipping: C.isMoney(ed.shipping) ? ed.shipping : 0, shippingVat: C.isMoney(ed.shipVat) ? ed.shipVat : 0 });
      r.lines.forEach((x, i) => { const c = $('[data-lt="' + i + '"]'); if (c) c.textContent = money(x.line_total, ed.currency); });
      const row = (l, v, b) => '<tr><td' + (b ? " style='font-weight:700'" : "") + ">" + l + '</td><td class="num"' + (b ? " style='font-weight:700'" : "") + ">" + money(v, ed.currency) + "</td></tr>";
      $("#ed-totals").innerHTML = '<table class="items-table" style="margin:.5rem 1rem;width:calc(100% - 2rem)"><tbody>' + row("Subtotal", r.gross_total) + (r.line_discount_total ? row("Line discounts", -r.line_discount_total) : "") + (r.overall_discount_total ? row("Overall discount", -r.overall_discount_total) : "") + row("Taxable amount", r.taxable_total) + (r.shipping ? row("Delivery", r.shipping) : "") + row("VAT", r.tax_total) + row("Total", r.total, true) + "</tbody></table>";
      const note = $("#ed-vatnote");
      if (note) note.textContent = (ed.lines.length && ed.lines.every((l) => Number(l.vat_rate) === 0) ? "No VAT is applied to any line. VAT is only added if you type a rate — no rate is assumed. " : "") + (ed.order && Math.round(r.total * 100) !== Math.round(Number(ed.order.total) * 100) ? "Total differs from the original order total (" + money(ed.order.total, ed.currency) + "). " : "") + "Catalogue prices are re-read from the database when you save; the server recalculates every figure.";
    }

    async function persist() {
      const ed = iv.ed, p = problems();
      if (p.length) { toast("error", p[0] + (p.length > 1 ? " (+" + (p.length - 1) + " more)" : "")); return null; }
      let customerId = ed.customer_id || null;
      if (!customerId && ed.saveCust) { customerId = await SupabaseClient.saveCustomer(ed.cust); ed.customer_id = customerId; }
      const inv = { id: ed.id || undefined, client_token: ed.token, order_id: ed.order ? ed.order.id : undefined, customer_id: customerId, customer: ed.cust, currency: ed.currency.toUpperCase(), issue_date: ed.issue_date, due_date: ed.due_date || null,
        payment_method: ed.method, payment_terms: ed.terms, notes: ed.notes, footer: ed.footer, overall_discount_type: ed.ovType, overall_discount_value: ed.ovValue || "0", shipping: ed.shipping || "0", shipping_vat_rate: ed.shipVat === "" ? undefined : ed.shipVat };
      const id = await SupabaseClient.saveInvoiceDraft(inv, ed.lines.map(lineToPayload));
      ed.id = id; ed.dirty = false;
      return id;
    }
    async function saveDraft(btn, thenIssue) {
      busy(btn, true);
      try {
        const id = await persist(); if (!id) { busy(btn, false); return; }
        await refresh(); busy(btn, false);
        if (thenIssue) { iv.ed = null; iv.tab = "list"; draw(); issueFlow(invById(id), { close() {} }, btn); return; }
        ok("Draft saved"); await new Promise((r) => setTimeout(r, 0)); iv.ed = null; iv.tab = "list"; draw(); openInvoice(id);
      } catch (e) { busy(btn, false); fail(e, "Could not save the invoice"); }
    }
    async function previewDraft(btn) {
      busy(btn, true);
      try { const id = await persist(); if (!id) return; await refresh(); const inv = invById(id), items = await SupabaseClient.fetchInvoiceItems(id); ok("Draft saved"); await pdfOpen(inv, items, [], false); }
      catch (e) { fail(e, "Could not build the preview"); } finally { busy(btn, false); }
    }

    /* ═════════════ Customers ═════════════ */
    function tabCustomers(box) {
      const q = iv.cq.toLowerCase();
      const bal = (c) => { let b = 0, n = 0; for (const i of S.inv.invoices) if (i.customer_id === c.id && i.status === "issued") { b += Number(i.balance); n++; } return { b, n }; };
      const rows = S.inv.customers.filter((c) => (iv.showArchived || !c.archived) && (!q || [c.name, c.tax_id, c.phone, c.email].join(" ").toLowerCase().includes(q)));
      box.innerHTML = '<div class="rp-fgrid">' + ctl("Search", '<input id="cu-q" value="' + esc(iv.cq) + '" placeholder="name, tax ID, phone">') + "</div><p><button type=\"button\" class=\"button\" id=\"cu-new\">+ New customer</button> <label class=\"check-line\" style=\"display:inline-flex\"><input type=\"checkbox\" id=\"cu-arch\"" + (iv.showArchived ? " checked" : "") + "> show archived</label></p>" +
        (rows.length ? '<div class="card table-wrap"><table class="data"><thead><tr><th>Name</th><th>Tax ID</th><th>Contact</th><th class="num">Open invoices</th><th class="num">Owes</th><th></th></tr></thead><tbody>' + rows.map((c) => { const x = bal(c); return "<tr><td><strong>" + esc(c.name) + "</strong>" + (c.archived ? ' <span class="pill">archived</span>' : "") + "</td><td>" + esc(c.tax_id) + "</td><td>" + esc(c.phone) + (c.email ? "<br><small>" + esc(c.email) + "</small>" : "") + '</td><td class="num">' + x.n + '</td><td class="num">' + (x.b ? money(x.b) : "–") + '</td><td><button type="button" class="button button-outline button-sm" data-cu-edit="' + esc(c.id) + '">Edit</button> <button type="button" class="button button-outline button-sm" data-cu-inv="' + esc(c.id) + '">New invoice</button></td></tr>'; }).join("") + "</tbody></table></div>" : '<div class="card"><div class="empty">No customers' + (S.inv.customers.length ? " match" : " yet") + ".</div></div>");
      $("#cu-q").addEventListener("input", (e) => { iv.cq = e.target.value; const p = e.target.selectionStart; draw(); const n = $("#cu-q"); n.focus(); n.setSelectionRange(p, p); });
      $("#cu-arch").addEventListener("change", (e) => { iv.showArchived = e.target.checked; draw(); });
      $("#cu-new").addEventListener("click", () => customerForm(null));
      box.addEventListener("click", (e) => { const a = e.target.closest("[data-cu-edit]"), b = e.target.closest("[data-cu-inv]"); if (a) customerForm(S.inv.customers.find((c) => c.id === a.dataset.cuEdit)); if (b) { const c = S.inv.customers.find((x) => x.id === b.dataset.cuInv); iv.ed = blankEditor(); iv.ed.customer_id = c.id; Object.assign(iv.ed.cust, { kind: c.kind, name: c.name, tax_id: c.tax_id, address: c.address, city: c.city, country: c.country, phone: c.phone, email: c.email }); iv.tab = "create"; draw(); } });
    }
    function customerForm(c) {
      c = c || { kind: "person", name: "", tax_id: "", address: "", city: "", country: "", phone: "", email: "", notes: "", archived: false };
      const f = (k, l, extra) => ctl(l, '<input data-cf="' + k + '" value="' + esc(c[k]) + '" ' + (extra || "") + ">");
      const dr = drawer(c.id ? "Edit customer" : "New customer", ctl("Type", '<select data-cf="kind"><option value="person"' + (c.kind === "person" ? " selected" : "") + '>Person</option><option value="business"' + (c.kind === "business" ? " selected" : "") + ">Business</option></select>") + f("name", "Name *", 'maxlength="120"') + f("tax_id", "Tax ID (NIPT)", 'maxlength="40"') + f("address", "Address", 'maxlength="200"') + f("city", "City", 'maxlength="80"') + f("country", "Country", 'maxlength="80"') + f("phone", "Phone", 'maxlength="40"') + f("email", "E-mail", 'maxlength="160"') + ctl("Notes", '<textarea data-cf="notes" rows="2" maxlength="500" style="width:100%">' + esc(c.notes || "") + "</textarea>") + (c.id ? '<p class="muted small">Changing a customer does not change invoices already issued — they keep the details they were issued with.</p>' : ""),
        (c.id ? '<button type="button" class="button button-outline" id="cf-arch" style="margin-right:auto">' + (c.archived ? "Restore" : "Archive") + '</button>' : "") + '<button type="button" class="button button-outline" data-close>Cancel</button><button type="button" class="button" id="cf-save">Save</button>');
      $("#cf-save", dr.el).addEventListener("click", async (e) => {
        const d = { id: c.id }; $$("[data-cf]", dr.el).forEach((n) => { d[n.dataset.cf] = n.value; });
        busy(tgt(e), true);
        try { await SupabaseClient.saveCustomer(d); ok("Customer saved"); dr.close(); await refresh(); draw(); } catch (er) { fail(er, "Could not save the customer"); busy(tgt(e), false); }
      });
      const ar = $("#cf-arch", dr.el); if (ar) ar.addEventListener("click", async () => { try { await SupabaseClient.setCustomerArchived(c.id, !c.archived); ok(c.archived ? "Customer restored" : "Customer archived"); dr.close(); await refresh(); draw(); } catch (er) { fail(er, "Could not change the customer"); } });
    }

    /* ═════════════ Payments ═════════════ */
    function tabPayments(box) {
      const f = iv.pf, q = (f.q || "").toLowerCase();
      const rows = S.inv.payments.filter((p) => { const i = invById(p.invoice_id) || {}; return (!f.method || p.method === f.method) && (!f.from || p.paid_on >= f.from) && (!f.to || p.paid_on <= f.to) && (f.reversed || !p.reversed) && (!q || [i.number, (i.customer || {}).name, p.reference, p.amount].join(" ").toLowerCase().includes(q)); });
      const sums = {}; for (const p of rows) if (!p.reversed) { const c = (invById(p.invoice_id) || {}).currency || "?"; sums[c] = (sums[c] || 0n) + C.cents(p.amount); }
      box.innerHTML = '<div class="rp-fgrid">' + ctl("Search", '<input id="pf-q" value="' + esc(f.q) + '" placeholder="invoice, customer, reference">') + ctl("Method", '<select id="pf-m"><option value="">All</option>' + Object.keys(C.METHODS).map((k) => '<option value="' + k + '"' + (f.method === k ? " selected" : "") + ">" + C.METHODS[k].en + "</option>").join("") + "</select>") + ctl("From", '<input type="date" id="pf-f" value="' + esc(f.from) + '">') + ctl("To", '<input type="date" id="pf-t" value="' + esc(f.to) + '">') + "</div>" +
        '<label class="check-line"><input type="checkbox" id="pf-r"' + (f.reversed ? " checked" : "") + "> include reversed payments</label>" +
        '<p>Received in this selection: <strong>' + (Object.keys(sums).map((c) => money(C.toNum(sums[c]), c)).join(" · ") || "0") + '</strong> &nbsp; <button type="button" class="button button-outline button-sm" id="pf-csv">' + icon("download") + " Export CSV</button></p>" +
        (rows.length ? '<div class="card table-wrap"><table class="data"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>' + rows.slice(0, 300).map((p) => { const i = invById(p.invoice_id) || {}; return "<tr" + (p.reversed ? ' style="opacity:.55"' : "") + ' data-open-inv="' + esc(p.invoice_id) + '" style="cursor:pointer" tabindex="0"><td>' + dmy(p.paid_on) + "</td><td>" + esc(i.number) + "</td><td>" + esc((i.customer || {}).name) + "</td><td>" + esc((C.METHODS[p.method] || {}).en) + "</td><td>" + esc(p.reference) + (p.reversed ? " <em>(reversed)</em>" : "") + '</td><td class="num">' + money(p.amount, i.currency) + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<div class="card"><div class="empty">No payments recorded' + (S.inv.payments.length ? " for this selection" : " yet. Open an issued invoice and press Record payment") + ".</div></div>");
      $("#pf-q").addEventListener("input", (e) => { f.q = e.target.value; const p = e.target.selectionStart; draw(); const n = $("#pf-q"); n.focus(); n.setSelectionRange(p, p); });
      $("#pf-m").addEventListener("change", (e) => { f.method = e.target.value; draw(); }); $("#pf-f").addEventListener("change", (e) => { f.from = e.target.value; draw(); }); $("#pf-t").addEventListener("change", (e) => { f.to = e.target.value; draw(); }); $("#pf-r").addEventListener("change", (e) => { f.reversed = e.target.checked; draw(); });
      $("#pf-csv").addEventListener("click", () => downloadCsv("invoice-payments", C.PAY_CSV_HEAD, C.paymentCsvRows(rows, S.inv.invoices)));
    }

    /* ═════════════ Reports ═════════════ */
    function tabReports(box) {
      const f = iv.rf; if (!f.from && !f.to) { const t = C.today(); f.from = t.slice(0, 4) + "-01-01"; f.to = t; }
      const sum = C.summarize(S.inv.invoices, S.inv.payments, f), months = C.byMonth(S.inv.invoices, S.inv.payments, f), custs = C.byCustomer(S.inv.invoices, f), rec = C.orderReconciliation((S.orders || []).filter((o) => (!f.from || (o.created_at || "").slice(0, 10) >= f.from) && (!f.to || (o.created_at || "").slice(0, 10) <= f.to)), S.inv.invoices);
      const cur = Object.keys(sum).sort();
      box.innerHTML = '<div class="rp-fgrid">' + ctl("From", '<input type="date" id="rf-f" value="' + esc(f.from) + '">') + ctl("To", '<input type="date" id="rf-t" value="' + esc(f.to) + '">') + "</div>" +
        '<div class="rp-quick"><button type="button" class="button button-outline button-sm" data-rq="month">This month</button> <button type="button" class="button button-outline button-sm" data-rq="last">Last month</button> <button type="button" class="button button-outline button-sm" data-rq="year">This year</button> <button type="button" class="button button-outline button-sm" data-rq="all">All dates</button></div>' +
        '<p class="muted small">Invoiced = invoices issued in the period (cancelled and drafts excluded). Received = payments dated in the period (reversed excluded). Outstanding and overdue are today\'s position. Different currencies are never added together.</p>' +
        (cur.length ? cur.map((c) => { const s = sum[c]; return '<div class="card"><div class="card-head"><h2>' + esc(c) + '</h2></div><div class="stats" style="padding:1rem 1rem 0">' + stat("Invoiced", money(s.invoiced, c), s.count + " invoices") + stat("VAT in invoiced", money(s.tax, c), "") + stat("Received", money(s.received, c), "in the period") + stat("Outstanding", money(s.outstanding, c), "today, all invoices", s.outstanding > 0) + stat("Overdue", money(s.overdue, c), s.overdueCount + " invoices", s.overdue > 0) + stat("Cancelled", s.cancelled, "in the period, not counted") + "</div>" +
          (s.invoicedCheck ? "" : '<p class="notice">Reconciliation warning: invoiced ≠ paid + still owed for this period. Please report this.</p>') + "</div>"; }).join("") : '<div class="card"><div class="empty">No invoices in this period.</div></div>') +
        '<div class="card"><div class="card-head"><h2>By month</h2><button type="button" class="button button-outline button-sm" id="rp-csv-m">' + icon("download") + " CSV</button></div>" + (months.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Month</th><th>Currency</th><th class="num">Invoices</th><th class="num">Invoiced</th><th class="num">VAT</th><th class="num">Received</th></tr></thead><tbody>' + months.map((m) => "<tr><td>" + esc(m.month) + "</td><td>" + esc(m.currency) + '</td><td class="num">' + m.count + '</td><td class="num">' + money(m.invoiced, m.currency) + '</td><td class="num">' + money(m.tax, m.currency) + '</td><td class="num">' + money(m.received, m.currency) + "</td></tr>").join("") + "</tbody></table></div>" : '<div class="empty">–</div>') + "</div>" +
        '<div class="card"><div class="card-head"><h2>By customer</h2></div>' + (custs.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Customer</th><th class="num">Invoices</th><th class="num">Invoiced</th><th class="num">Still owed</th></tr></thead><tbody>' + custs.slice(0, 50).map((c) => "<tr><td>" + esc(c.name) + '</td><td class="num">' + c.count + '</td><td class="num">' + money(c.invoiced, c.currency) + '</td><td class="num">' + money(c.balance, c.currency) + "</td></tr>").join("") + "</tbody></table></div>" : '<div class="empty">–</div>') + "</div>" +
        '<div class="card"><div class="card-head"><h2>Shop orders vs invoices (orders placed in the period)</h2></div><div class="card-body"><dl class="kv"><dt>Active orders</dt><dd>' + rec.orders + "</dd><dt>With an invoice</dt><dd>" + rec.invoicedOrders + "</dd><dt>Without an invoice</dt><dd>" + rec.notInvoiced + " (" + money(rec.notInvoicedValue) + ")</dd></dl>" + (rec.differs.length ? '<p class="small">Invoice total differs from order total: ' + rec.differs.map((d) => esc(d.order) + " (" + money(d.orderTotal) + " → " + money(d.invoiceTotal) + ")").join("; ") + "</p>" : "") + '<p class="muted small">Orders are cash-on-delivery requests; an order is not an invoice and not a payment.</p></div></div>' +
        '<p><button type="button" class="button button-outline" id="rp-csv-i">' + icon("download") + ' Invoices CSV</button> <button type="button" class="button button-outline" id="rp-csv-p">' + icon("download") + " Payments CSV</button></p>";
      const set = (a, b) => { f.from = a; f.to = b; draw(); };
      $("#rf-f").addEventListener("change", (e) => set(e.target.value, f.to)); $("#rf-t").addEventListener("change", (e) => set(f.from, e.target.value));
      box.addEventListener("click", (e) => { const b = e.target.closest("[data-rq]"); if (!b) return; const t = C.today(), y = t.slice(0, 4), m = t.slice(5, 7); const k = b.dataset.rq;
        if (k === "month") set(y + "-" + m + "-01", t); else if (k === "year") set(y + "-01-01", t); else if (k === "all") set("", ""); else { const d = new Date(Date.UTC(Number(y), Number(m) - 2, 1)), ly = d.getUTCFullYear(), lm = String(d.getUTCMonth() + 1).padStart(2, "0"); set(ly + "-" + lm + "-01", ly + "-" + lm + "-" + String(new Date(Date.UTC(ly, d.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")); } });
      const inR = (d) => d && (!f.from || d >= f.from) && (!f.to || d <= f.to);
      $("#rp-csv-m").addEventListener("click", () => downloadCsv("invoices-by-month", ["Month", "Currency", "Invoices", "Invoiced", "VAT", "Received"], months.map((m) => [m.month, m.currency, m.count, m.invoiced.toFixed(2), m.tax.toFixed(2), m.received.toFixed(2)])));
      $("#rp-csv-i").addEventListener("click", () => downloadCsv("invoices", C.INV_CSV_HEAD, C.invoiceCsvRows(S.inv.invoices.filter((i) => inR(i.issue_date)))));
      $("#rp-csv-p").addEventListener("click", () => downloadCsv("invoice-payments", C.PAY_CSV_HEAD, C.paymentCsvRows(S.inv.payments.filter((p) => inR(p.paid_on)), S.inv.invoices)));
    }

    /* ═════════════ Settings ═════════════ */
    function tabSettings(box) {
      const s = S.inv.settings || {}, f = (k, l, extra) => ctl(l, '<input data-sf="' + k + '" value="' + esc(s[k] === undefined ? "" : s[k]) + '" ' + (extra || "") + ">");
      box.innerHTML = '<div class="card"><div class="card-head"><h2>Invoice settings</h2></div><div class="card-body"><p class="muted small" style="margin-top:0">Admins only. These details are copied onto each invoice when it is issued, so changing them later does not alter invoices already issued. Nothing here is filled in for you.</p>' +
        '<h3>Your company</h3><div class="rp-fgrid">' + f("company_name", "Company name *", 'maxlength="120"') + f("tax_id", "Tax ID (NIPT)", 'maxlength="40"') + f("registration_no", "Registration no.", 'maxlength="60"') + f("address", "Address", 'maxlength="200"') + f("city", "City", 'maxlength="80"') + f("country", "Country", 'maxlength="80"') + f("phone", "Phone", 'maxlength="40"') + f("email", "E-mail", 'maxlength="160"') + "</div>" +
        '<h3>Bank</h3><div class="rp-fgrid">' + f("bank_name", "Bank", 'maxlength="120"') + f("iban", "IBAN", 'maxlength="40"') + f("swift", "SWIFT", 'maxlength="20"') + "</div>" +
        '<h3>Numbering and defaults</h3><div class="rp-fgrid">' + f("prefix", "Number prefix", 'maxlength="32" style="text-transform:uppercase"') + f("number_digits", "Digits in the number", 'inputmode="numeric"') + f("currency", "Default currency", 'maxlength="3" style="text-transform:uppercase"') + f("payment_terms_days", "Default payment term (days)", 'inputmode="numeric"') + f("default_vat_rate", "Default VAT % (leave empty if none)", 'inputmode="decimal"') +
        ctl("PDF / WhatsApp language", '<select data-sf="language"><option value="sq"' + (s.language !== "en" ? " selected" : "") + '>Shqip</option><option value="en"' + (s.language === "en" ? " selected" : "") + ">English</option></select>") + "</div>" +
        '<p class="muted small">Next numbers look like <strong id="st-ex"></strong>. A number is taken only when an invoice is issued, so cancelled or deleted drafts never leave gaps; the counter restarts each calendar year.</p>' +
        f("payment_terms_text", "Default payment terms text", 'maxlength="300"') + f("notes_default", "Default invoice notes", 'maxlength="400"') + f("footer", "Default footer", 'maxlength="400"') +
        '<p class="muted small">Invoices produced here are informal. They are <strong>not fiscalized</strong> and carry no NIVF / NSLF / fiscal QR data; each PDF says so.</p><p><button type="button" class="button" id="st-save">Save settings</button></p></div></div>';
      const ex = () => { const g = (k) => ($('[data-sf="' + k + '"]', box) || {}).value || ""; const d = Math.max(4, Math.min(9, Number(g("number_digits")) || 6)); $("#st-ex").textContent = (g("prefix") || "SUB-INV").toUpperCase() + "-" + C.today().slice(0, 4) + "-" + "1".padStart(d, "0"); };
      box.addEventListener("input", ex); ex();
      $("#st-save").addEventListener("click", async (e) => {
        const d = {}; $$("[data-sf]", box).forEach((n) => { d[n.dataset.sf] = n.dataset.sf === "prefix" || n.dataset.sf === "currency" ? n.value.trim().toUpperCase() : n.value.trim(); });
        busy(tgt(e), true);
        try { await SupabaseClient.saveInvoiceSettings(d); ok("Settings saved"); await refresh(); S.section === "invoices" && X.render(); } catch (er) { fail(er, "Could not save the settings"); busy(tgt(e), false); }
      });
    }
  };
})();
