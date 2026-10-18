/* Admin → Reports (Phase 7). Admin role only.
   Three record sources, never mixed: shop orders (database), invoices (backup file exported from the invoice app, read in this
   browser tab only), purchases (manual ledger table). All maths lives in reports-core.js (unit-tested); this file is screens only.

   Rules enforced here and in the core:
   - cancelled / draft / voided / duplicate / correction documents are NOT counted, and are listed separately so nothing vanishes silently;
   - "invoiced" and "received" (or "ordered" and "paid") are separate figures; shop orders carry no payment, VAT or discount data and say so;
   - amounts of different currencies are never added together;
   - "sales minus purchases" is shown only as a difference of recorded documents and is never called profit. */
(function () {
  "use strict";
  const R = window.ReportsCore, U = window.SC && window.SC.util;
  window.AdminViews = window.AdminViews || {};

  const rs = {
    tab: "orders", dups: false, basis: "invoices",
    f: { from: "", to: "", customer: "", product: "", supplier: "", status: "all" },
    inv: null // { invoices, meta, fileName, skipped } — held in memory only
  };
  const today = () => R.tiranaDate(new Date().toISOString());
  function setRange(kind) {
    const t = today(), y = t.slice(0, 4), m = t.slice(5, 7);
    if (kind === "month") { rs.f.from = y + "-" + m + "-01"; rs.f.to = t; }
    else if (kind === "last") { const d = new Date(Date.UTC(Number(y), Number(m) - 2, 1)); const ly = d.getUTCFullYear(), lm = String(d.getUTCMonth() + 1).padStart(2, "0"); rs.f.from = ly + "-" + lm + "-01"; rs.f.to = ly + "-" + lm + "-" + String(new Date(Date.UTC(ly, d.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0"); }
    else if (kind === "year") { rs.f.from = y + "-01-01"; rs.f.to = t; }
    else { rs.f.from = ""; rs.f.to = ""; }
  }
  if (!rs.f.from && !rs.f.to) setRange("year");

  const WARN = {
    order_total_mismatch: "Stored order total differs from items + delivery (shown as stored).", order_mixed_currency: "Order mixes currencies.", order_bad_line: "Order has an item line with an invalid price or quantity.",
    invoice_vat_unset: "Invoice has lines without a VAT rate (counted as 0%).", invoice_calc_issue: "Invoice has invalid or out-of-range numbers.", invoice_overpaid: "Invoice has more payments recorded than its total.",
    purchase_bad_amount: "Purchase record has an invalid total.", purchase_overpaid: "Purchase record shows more paid than its total.", purchase_total_mismatch: "Purchase net + VAT does not equal its total."
  };
  const EXCL = { demo: "Demo / sample invoices (fictitious)", cancelled: "Cancelled", duplicates: "Suspected duplicates (counted once)", undated: "No valid date", drafts: "Drafts (not issued)", corrections: "Corrections / credit documents", voided: "Voided" };

  window.AdminViews.reports = function (view, actions, X) {
    const { S, $, $$, esc, icon, toast, ok, fail, confirmBox, drawer, busy, downloadCsv } = X;
    if (!X.isAdmin()) { view.innerHTML = '<div class="card"><div class="empty">Reports are available to admins only.</div></div>'; return; }
    const money = (v, c) => U.formatMoney(v || 0, c || "", "en-GB");
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthLabel = (m) => MONTHS[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4);
    const dmy = (d) => (d ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : "");

    const TABS = [["orders", "Sales — shop orders"], ["invoices", "Sales — invoices"], ["purchases", "Purchases"], ["compare", "Sales vs purchases"]];
    view.innerHTML = '<div class="rp">' +
      '<div class="rp-tabs no-print" role="tablist">' + TABS.map(([id, l]) => '<button type="button" role="tab" class="rp-tab" data-rtab="' + id + '" aria-selected="' + (rs.tab === id) + '">' + l + "</button>").join("") + "</div>" +
      '<div class="card no-print"><div class="card-body"><div id="rp-filters"></div></div></div>' +
      '<div id="rp-out"></div></div>';
    actions.innerHTML = '<button type="button" class="button button-outline" id="rp-print">' + icon("file-text") + " Print / save as PDF</button>";

    /* ---------- filters ---------- */
    function filters() {
      const t = rs.tab, f = rs.f;
      const dateF = '<label class="promo-ctl"><span>From</span><input type="date" id="f-from" value="' + esc(f.from) + '"></label><label class="promo-ctl"><span>To</span><input type="date" id="f-to" value="' + esc(f.to) + '"></label>';
      const quick = '<div class="rp-quick"><button type="button" class="button button-outline button-sm" data-range="month">This month</button><button type="button" class="button button-outline button-sm" data-range="last">Last month</button><button type="button" class="button button-outline button-sm" data-range="year">This year</button><button type="button" class="button button-outline button-sm" data-range="all">All dates</button></div>';
      let h = '<div class="rp-fgrid">' + dateF;
      if (t === "orders" || t === "invoices") h += '<label class="promo-ctl"><span>Customer</span><input id="f-customer" placeholder="name, phone or e-mail" value="' + esc(f.customer) + '"></label><label class="promo-ctl"><span>Product</span><input id="f-product" placeholder="name or SKU" value="' + esc(f.product) + '"></label>';
      if (t === "invoices") h += '<label class="promo-ctl"><span>Status</span><select id="f-status">' + [["all", "All issued"], ["paid", "Paid"], ["partial", "Partly paid"], ["issued", "Unpaid"], ["overdue", "Overdue"]].map(([v, l]) => '<option value="' + v + '"' + (f.status === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>";
      if (t === "purchases") h += '<label class="promo-ctl"><span>Supplier</span><input id="f-supplier" list="rp-suppliers" value="' + esc(f.supplier) + '"></label><label class="promo-ctl"><span>Note contains</span><input id="f-product" value="' + esc(f.product) + '"></label>';
      if (t === "compare") h += '<label class="promo-ctl"><span>Sales taken from</span><select id="f-basis"><option value="invoices"' + (rs.basis === "invoices" ? " selected" : "") + '>Invoices (backup file)</option><option value="orders"' + (rs.basis === "orders" ? " selected" : "") + ">Shop orders</option></select></label>";
      h += "</div>" + quick;
      if (t !== "compare") h += '<label class="check-line"><input type="checkbox" id="f-dups"' + (rs.dups ? " checked" : "") + "> Also count suspected duplicates</label>";
      if (t === "invoices" || (t === "compare" && rs.basis === "invoices")) {
        h += '<div class="rp-import"><button type="button" class="button button-outline" id="inv-pick">' + icon("upload") + " " + (rs.inv ? "Load another backup file" : "Load invoice backup file") + '</button><input type="file" id="inv-file" accept=".json,application/json" hidden>' +
          (rs.inv ? ' <button type="button" class="button button-outline" id="inv-clear">Clear</button>' : "") +
          '<p class="muted small" id="inv-note">' + (rs.inv ? esc(rs.inv.fileName) + ": " + rs.inv.invoices.length + " invoices" + (rs.inv.skipped ? ", " + rs.inv.skipped + " unreadable records skipped" : "") + (rs.inv.meta.exportedAt ? ", exported " + esc(rs.inv.meta.exportedAt.slice(0, 10)) : "") + ". Read in this browser tab only — not uploaded or stored." : "In the invoice app use Backup → export, then choose that file here. It is read in this browser tab only — not uploaded or stored.") + "</p></div>";
      }
      if (t === "purchases") h += '<datalist id="rp-suppliers">' + [...new Set((S.purchases || []).map((p) => p.supplier))].map((s) => '<option value="' + esc(s) + '">').join("") + "</datalist>";
      $("#rp-filters").innerHTML = h;
    }

    /* ---------- building blocks ---------- */
    const note = (t) => '<p class="rp-note">' + t + "</p>";
    function cards(totals, defs) {
      const cur = Object.keys(totals).sort();
      if (!cur.length) return '<div class="card"><div class="empty">No documents in this selection.</div></div>';
      return '<div class="rp-cards">' + cur.map((c) => '<div class="card rp-cur"><div class="card-head"><h2>' + esc(c) + '</h2></div><dl class="card-body">' +
        defs.map(([k, l, kind, hint]) => '<div><dt>' + esc(l) + '</dt><dd>' + (kind === "n" ? (totals[c][k] || 0) : esc(money(totals[c][k] || 0, ""))) + (hint ? ' <small>' + esc(hint) + "</small>" : "") + "</dd></div>").join("") + "</dl></div>").join("") + "</div>";
    }
    function monthTable(months, cols) {
      if (!months.length) return "";
      return '<div class="card"><div class="card-head"><h2>By month</h2></div><div class="table-wrap"><table class="rp-table"><thead><tr><th>Month</th><th>Currency</th>' + cols.map((c) => '<th class="num">' + esc(c[1]) + "</th>").join("") + "</tr></thead><tbody>" +
        months.map((r) => "<tr><td>" + esc(monthLabel(r.month)) + "</td><td>" + esc(r.currency) + "</td>" + cols.map(([k, , kind]) => '<td class="num">' + (kind === "n" ? (r[k] || 0) : esc(money(r[k] || 0, ""))) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div></div>";
    }
    function excluded(ex, rowText) {
      const keys = Object.keys(ex).filter((k) => ex[k].length);
      if (!keys.length) return "";
      return '<div class="card"><div class="card-head"><h2>Not counted</h2></div><div class="card-body">' + keys.map((k) => "<details class=\"rp-ex\"><summary>" + esc(EXCL[k]) + ": <strong>" + ex[k].length + "</strong></summary><ul>" + ex[k].slice(0, 100).map((d) => "<li>" + rowText(d, k) + "</li>").join("") + (ex[k].length > 100 ? "<li>… and " + (ex[k].length - 100) + " more</li>" : "") + "</ul></details>").join("") + "</div></div>";
    }
    function warnings(w) {
      if (!w.length) return "";
      const seen = {}; w.forEach((x) => { (seen[x.code] = seen[x.code] || []).push(x.ref); });
      return '<div class="card"><div class="card-head"><h2>Data checks</h2></div><div class="card-body"><ul class="rp-warn">' + Object.keys(seen).map((c) => "<li>" + esc(WARN[c] || c) + " <span class=\"muted\">(" + seen[c].slice(0, 8).map(esc).join(", ") + (seen[c].length > 8 ? ", …" : "") + ")</span></li>").join("") + "</ul></div></div>";
    }
    const detail = (head, rows, total) => '<div class="card"><div class="card-head"><h2>Documents counted (' + total + ")</h2></div><div class=\"table-wrap\"><table class=\"rp-table\"><thead><tr>" + head.map((h, i) => "<th" + (h[1] ? ' class="num"' : "") + ">" + esc(h[0]) + "</th>").join("") + "</tr></thead><tbody>" + rows + "</tbody></table>" + (total > 200 ? '<p class="muted small rp-more">Showing the first 200. The CSV export contains all of them.</p>' : "") + "</div></div>";

    let current = null; // the report currently on screen (for CSV)
    function printHead(title, sub) {
      return '<div class="rp-printhead"><h2>' + esc(title) + "</h2><p>SubCore Solutions — " + esc(sub) + "</p><p>Period: " + esc(rs.f.from ? dmy(rs.f.from) : "start") + " – " + esc(rs.f.to ? dmy(rs.f.to) : "today") + " · Generated " + esc(dmy(today())) + "</p></div>";
    }
    const fOrders = () => ({ from: rs.f.from, to: rs.f.to, customer: rs.f.customer, product: rs.f.product, includeDuplicates: rs.dups });

    /* ---------- tabs ---------- */
    function showOrders() {
      const r = current = R.reportOrders(S.orders || [], fOrders());
      const t = R.compareRecorded; void t;
      $("#rp-out").innerHTML = printHead("Sales report — shop orders", "orders placed on the website") +
        note("<strong>Shop orders are what customers ordered, not what was paid or invoiced.</strong> The shop is cash on delivery and stores no payment, VAT or discount information, so those figures are <em>not recorded</em> here (not zero). Cancelled orders and suspected duplicates (same phone, items and total within " + R.DUP_WINDOW_MIN + " minutes) are not counted. Delivery is shown separately.") +
        cards(r.totals, [["count", "Orders counted", "n"], ["goods", "Goods"], ["shipping", "Delivery"], ["total", "Total ordered"]]) +
        '<div class="rp-notrec">Paid / received: <em>not recorded</em> · VAT: <em>not recorded</em> · Discounts: <em>not recorded</em></div>' +
        monthTable(r.months, [["count", "Orders", "n"], ["goods", "Goods"], ["shipping", "Delivery"], ["total", "Total ordered"]]) +
        (r.products.length ? '<div class="card"><div class="card-head"><h2>By product</h2></div><div class="table-wrap"><table class="rp-table"><thead><tr><th>Product</th><th>Currency</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>' + r.products.slice(0, 30).map((p) => "<tr><td>" + esc(p.name) + '</td><td>' + esc(p.currency) + '</td><td class="num">' + p.qty + '</td><td class="num">' + esc(money(p.amount, "")) + "</td></tr>").join("") + "</tbody></table></div></div>" : "") +
        detail([["Order"], ["Date"], ["Status"], ["Customer"], ["Total", 1]], r.counted.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200).map((o) => "<tr><td>" + esc(o.number) + "</td><td>" + esc(dmy(o.date)) + "</td><td>" + esc(o.status) + "</td><td>" + esc(o.customer) + '</td><td class="num">' + esc(money(o.total, o.currency)) + "</td></tr>").join(""), r.counted.length) +
        excluded(r.excluded, (o, k) => esc(o.number) + " · " + esc(dmy(o.date) || "no date") + " · " + esc(o.customer) + " · " + esc(money(o.total, o.currency)) + (k === "duplicates" ? " (repeat of " + esc(o.duplicateOf) + ")" : "")) +
        warnings(r.warnings);
    }
    function showInvoices() {
      if (!rs.inv) { current = null; $("#rp-out").innerHTML = '<div class="card"><div class="empty">Load a backup file from the invoice app to report on invoices.<br><span class="muted small">The invoice app keeps its data in the browser it runs in; its backup file is the only way to bring invoices here.</span></div></div>'; return; }
      const r = current = R.reportInvoices(rs.inv.invoices, { from: rs.f.from, to: rs.f.to, customer: rs.f.customer, product: rs.f.product, status: rs.f.status, includeDuplicates: rs.dups, today: today() });
      $("#rp-out").innerHTML = printHead("Sales report — invoices", "from invoice backup " + rs.inv.fileName) +
        note("<strong>Invoiced is not the same as received.</strong> “Invoiced” is the issued invoice total; “Received” is the payments recorded on those invoices (grouped by invoice month, not by payment date); “Outstanding” is invoiced minus received. Cancelled invoices, drafts, repeated invoice numbers and correction documents are not counted. Amounts are as calculated by the invoice app's engine; fiscalization status is not verified here.") +
        cards(r.totals, [["count", "Invoices counted", "n"], ["net", "Net (before VAT)"], ["vat", "VAT"], ["discount", "Discounts given"], ["invoiced", "Invoiced (total)"], ["received", "Received"], ["outstanding", "Outstanding"], ["overdue", "of which overdue"]]) +
        monthTable(r.months, [["count", "Invoices", "n"], ["net", "Net"], ["vat", "VAT"], ["discount", "Discounts"], ["invoiced", "Invoiced"], ["received", "Received"], ["outstanding", "Outstanding"]]) +
        detail([["Invoice"], ["Issued"], ["Status"], ["Customer"], ["Invoiced", 1], ["Received", 1], ["Outstanding", 1]], r.counted.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200).map((n) => "<tr><td>" + esc(n.rawNumber) + "</td><td>" + esc(dmy(n.date)) + "</td><td>" + esc(n.status) + "</td><td>" + esc(n.customer) + '</td><td class="num">' + esc(money(n.calc.total, n.currency)) + '</td><td class="num">' + esc(money(n.calc.paid, n.currency)) + '</td><td class="num">' + esc(money(Math.max(0, n.calc.balance), n.currency)) + "</td></tr>").join(""), r.counted.length) +
        excluded(r.excluded, (n, k) => esc(n.rawNumber) + " · " + esc(dmy(n.date)) + " · " + esc(n.customer) + " · " + esc(money(n.calc.total, n.currency)) + (k === "duplicates" ? " (number already used)" : "")) +
        warnings(r.warnings);
    }
    function showPurchases() {
      if (S.purchases === null || S.purchases === undefined) { current = null; $("#rp-out").innerHTML = '<div class="card"><div class="empty">The purchase ledger is not installed yet.<br>Run <strong>supabase-migration-v7-promo-reports.sql</strong> in Supabase (see REPORTS.md).</div></div>'; return; }
      const r = current = R.reportPurchases(S.purchases, { from: rs.f.from, to: rs.f.to, supplier: rs.f.supplier, product: rs.f.product, includeDuplicates: rs.dups });
      actions.innerHTML = '<button type="button" class="button" id="pu-add">' + icon("plus") + " Add purchase</button>" + '<button type="button" class="button button-outline" id="rp-print">' + icon("file-text") + " Print / save as PDF</button>";
      $("#pu-add").addEventListener("click", () => purchaseForm());
      $("#rp-out").innerHTML = printHead("Purchase report", "manually recorded purchase documents") +
        note("<strong>Purchases are entered by hand</strong> and are not verified against supplier documents. “Recorded” is the document total; “Paid” is what you recorded as paid; “Outstanding” is the difference. Voided records and repeated supplier document numbers are not counted. VAT is summed only where it was entered.") +
        cards(r.totals, [["count", "Documents counted", "n"], ["total", "Recorded (total)"], ["vat", "VAT (where entered)"], ["paid", "Paid"], ["outstanding", "Outstanding"]]) +
        monthTable(r.months, [["count", "Documents", "n"], ["total", "Recorded"], ["vat", "VAT"], ["paid", "Paid"], ["outstanding", "Outstanding"]]) +
        detail([["Document"], ["Date"], ["Supplier"], ["Total", 1], ["Paid", 1], ["Outstanding", 1], [""]], r.counted.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200).map((p) => "<tr><td>" + esc(p.rawNumber) + "</td><td>" + esc(dmy(p.date)) + "</td><td>" + esc(p.supplier) + '</td><td class="num">' + esc(money(p.total, p.currency)) + '</td><td class="num">' + esc(money(p.paid, p.currency)) + '</td><td class="num">' + esc(money(Math.max(0, p.total - p.paid), p.currency)) + '</td><td class="no-print rp-act"><button type="button" class="button button-outline button-sm" data-pay="' + p.id + '">Record payment</button> <button type="button" class="button button-outline button-sm button-danger-outline" data-void="' + p.id + '">Void</button></td></tr>').join(""), r.counted.length) +
        excluded(r.excluded, (p, k) => esc(p.rawNumber) + " · " + esc(dmy(p.date) || "no date") + " · " + esc(p.supplier) + " · " + esc(money(p.total, p.currency)) + (k === "voided" ? "" : k === "duplicates" ? " (repeat of " + esc(p.duplicateOf) + ")" : "")) +
        warnings(r.warnings);
    }
    function showCompare() {
      const range = { from: rs.f.from, to: rs.f.to };
      let sales, sField, rField, label;
      if (rs.basis === "invoices") {
        if (!rs.inv) { current = null; $("#rp-out").innerHTML = '<div class="card"><div class="empty">Load an invoice backup file above to compare invoices with purchases.</div></div>'; return; }
        sales = R.reportInvoices(rs.inv.invoices, Object.assign({ today: today() }, range)); sField = "invoiced"; rField = "received"; label = "Invoiced";
      } else { sales = R.reportOrders(S.orders || [], range); sField = "total"; label = "Ordered"; }
      if (S.purchases === null || S.purchases === undefined) { current = null; $("#rp-out").innerHTML = '<div class="card"><div class="empty">The purchase ledger is not installed yet (supabase-migration-v7-promo-reports.sql).</div></div>'; return; }
      const pur = R.reportPurchases(S.purchases, range);
      const cmp = R.compareRecorded(sales.totals, pur.totals, sField, "total");
      const cash = rField ? R.compareRecorded(sales.totals, pur.totals, rField, "paid") : null;
      current = { source: "compare", cmp, cash };
      const cur = Object.keys(cmp.perCurrency).sort();
      $("#rp-out").innerHTML = printHead("Recorded sales vs recorded purchases", "difference of recorded documents — not profit") +
        '<div class="rp-warnbox"><strong>This is not profit.</strong> It is only the arithmetic difference between the sales documents and the purchase documents recorded in this period. It does not account for stock on hand or cost of the goods actually sold, expenses, salaries, depreciation, taxes, returns or timing of purchases versus sales. VAT is included in totals where present. Use it as a rough indicator, and ask your accountant for profit.</div>' +
        (cur.length ? '<div class="rp-cards">' + cur.map((c) => { const a = cmp.perCurrency[c], b = cash && cash.perCurrency[c];
          return '<div class="card rp-cur"><div class="card-head"><h2>' + esc(c) + '</h2></div><dl class="card-body"><div><dt>' + esc(label) + " sales (recorded)</dt><dd>" + esc(money(a.sales, "")) + "</dd></div><div><dt>Purchases (recorded)</dt><dd>" + esc(money(a.purchases, "")) + "</dd></div><div><dt>Difference of recorded documents</dt><dd>" + esc(money(a.difference, "")) + "</dd></div>" +
            (b ? "<div><dt>Received from customers</dt><dd>" + esc(money(b.sales, "")) + "</dd></div><div><dt>Paid to suppliers</dt><dd>" + esc(money(b.purchases, "")) + "</dd></div><div><dt>Difference of payments recorded</dt><dd>" + esc(money(b.difference, "")) + "</dd></div>" : "") + "</dl></div>"; }).join("") + "</div>" : '<div class="card"><div class="empty">No documents in this period.</div></div>') +
        (rs.basis === "orders" ? note("Shop orders are orders, not payments or invoices — no “received” figure exists for them.") : note("“Received” and “Paid” are the payments recorded on invoices and purchase records; they are not bank statements.")) +
        warnings(sales.warnings.concat(pur.warnings));
    }

    function draw() {
      ({ orders: showOrders, invoices: showInvoices, purchases: showPurchases, compare: showCompare })[rs.tab]();
    }
    function tabChanged() {
      $$(".rp-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.rtab === rs.tab)));
      actions.innerHTML = '<button type="button" class="button button-outline" id="rp-print">' + icon("file-text") + " Print / save as PDF</button>";
      filters(); draw();
      const p = $("#rp-print"); if (p) p.addEventListener("click", () => window.print());
    }

    /* ---------- events ---------- */
    view.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-rtab]"); if (tab) { rs.tab = tab.dataset.rtab; tabChanged(); return; }
      const rg = e.target.closest("[data-range]"); if (rg) { setRange(rg.dataset.range); filters(); draw(); return; }
      if (e.target.closest("#inv-pick")) { $("#inv-file").click(); return; }
      if (e.target.closest("#inv-clear")) { rs.inv = null; filters(); draw(); return; }
      const pay = e.target.closest("[data-pay]"); if (pay) { paymentForm(pay.dataset.pay); return; }
      const vd = e.target.closest("[data-void]"); if (vd) { voidForm(vd.dataset.void); return; }
    });
    view.addEventListener("change", async (e) => {
      const el = e.target;
      if (el.id === "inv-file") {
        const file = el.files && el.files[0]; el.value = ""; if (!file) return;
        if (file.size > 20 * 1024 * 1024) { toast("error", "That file is too large to be an invoice backup."); return; }
        const res = R.parseInvoiceBackup(await file.text());
        if (!res.ok) { toast("error", { not_json: "That file is not valid JSON.", not_invoice_backup: "That is not a SubCore invoice backup file.", no_invoices: "The backup file contains no invoices.", too_large: "File too large." }[res.error] || "Could not read that file."); return; }
        rs.inv = { invoices: res.invoices, meta: res.meta, fileName: file.name.slice(0, 80), skipped: res.skipped };
        ok("Loaded " + res.invoices.length + " invoices"); filters(); draw(); return;
      }
      const map = { "f-from": ["from"], "f-to": ["to"], "f-status": ["status"] };
      if (map[el.id]) { rs.f[map[el.id][0]] = el.value; draw(); }
      if (el.id === "f-dups") { rs.dups = el.checked; draw(); }
      if (el.id === "f-basis") { rs.basis = el.value; filters(); draw(); }
    });
    let to = 0;
    view.addEventListener("input", (e) => {
      const m = { "f-customer": "customer", "f-product": "product", "f-supplier": "supplier" }[e.target.id]; if (!m) return;
      rs.f[m] = e.target.value; clearTimeout(to); to = setTimeout(draw, 200);
    });

    /* ---------- exports ---------- */
    function csvDownload(name, rows) {
      const url = URL.createObjectURL(new Blob([U.toCsv(rows)], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = name + "-" + today() + ".csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
    function addExportButtons() {
      if (!current || current.source === "compare") return;
      const bar = document.createElement("div"); bar.className = "rp-export no-print";
      bar.innerHTML = '<button type="button" class="button button-outline" id="csv-detail">' + icon("download") + ' CSV — documents</button><button type="button" class="button button-outline" id="csv-month">' + icon("download") + " CSV — by month</button>";
      $("#rp-out").appendChild(bar);
      $("#csv-detail").addEventListener("click", () => csvDownload("subcore-" + current.source + "-documents", R.toCsvRows(current)));
      $("#csv-month").addEventListener("click", () => {
        const cols = { orders: ["count", "goods", "shipping", "total"], invoices: ["count", "net", "vat", "discount", "invoiced", "received", "outstanding"], purchases: ["count", "total", "vat", "paid", "outstanding"] }[current.source];
        csvDownload("subcore-" + current.source + "-monthly", [["month", "currency"].concat(cols)].concat(current.months.map((m) => [m.month, m.currency].concat(cols.map((c) => (c === "count" ? (m[c] || 0) : R.plainMoney(m[c] || 0)))))));
      });
    }
    const _draw = draw; draw = function () { _draw(); addExportButtons(); };

    /* ---------- purchase ledger forms ---------- */
    const dec = (v) => { const s = String(v == null ? "" : v).trim(); if (s === "") return null; const n = U.parseScaled(s, 2); return (n === null || isNaN(n)) ? NaN : n; };
    const toDb = (minor) => (minor === null ? null : minor / 100);
    function purchaseForm() {
      const d = drawer("Add purchase",
        '<p class="muted small">Enter the supplier document exactly as it is. A document is recorded once per supplier and number. To correct a recorded document, void it and enter the corrected one.</p>' +
        '<label class="promo-ctl"><span>Supplier</span><input id="pu-supplier" maxlength="120" list="rp-suppliers"></label>' +
        '<div class="promo-two"><label class="promo-ctl"><span>Document number</span><input id="pu-number" maxlength="60"></label><label class="promo-ctl"><span>Document date</span><input type="date" id="pu-date" value="' + today() + '"></label></div>' +
        '<div class="promo-two"><label class="promo-ctl"><span>Net amount (optional)</span><input id="pu-net" inputmode="decimal"></label><label class="promo-ctl"><span>VAT amount (optional)</span><input id="pu-vat" inputmode="decimal"></label></div>' +
        '<div class="promo-two"><label class="promo-ctl"><span>Total</span><input id="pu-total" inputmode="decimal"></label><label class="promo-ctl"><span>Currency</span><select id="pu-cur"><option>ALL</option><option>EUR</option><option>USD</option><option>GBP</option></select></label></div>' +
        '<div class="promo-two"><label class="promo-ctl"><span>Already paid</span><input id="pu-paid" inputmode="decimal" placeholder="0"></label><label class="promo-ctl"><span>Paid on</span><input type="date" id="pu-paiddate"></label></div>' +
        '<label class="promo-ctl"><span>Note (optional)</span><input id="pu-note" maxlength="500"></label><div id="pu-err" class="promo-msg promo-err" hidden></div>',
        '<button type="button" class="button button-outline" data-x>Cancel</button><button type="button" class="button" id="pu-save">Save purchase</button>');
      $("[data-x]", d.el).addEventListener("click", d.close);
      const e = (id) => $("#" + id, d.el);
      e("pu-net").addEventListener("input", sum); e("pu-vat").addEventListener("input", sum);
      function sum() { const n = dec(e("pu-net").value), v = dec(e("pu-vat").value); if (n !== null && v !== null && !isNaN(n) && !isNaN(v)) e("pu-total").value = (n + v) / 100; }
      e("pu-save").addEventListener("click", async (ev) => {
        const err = (m) => { const x = e("pu-err"); x.hidden = false; x.textContent = m; };
        const supplier = e("pu-supplier").value.trim(), num = e("pu-number").value.trim(), date = e("pu-date").value;
        const net = dec(e("pu-net").value), vat = dec(e("pu-vat").value), total = dec(e("pu-total").value), paid = dec(e("pu-paid").value) || 0, pdate = e("pu-paiddate").value;
        if (!supplier) return err("Enter the supplier."); if (!num) return err("Enter the document number."); if (!date) return err("Enter the document date.");
        if ([net, vat, total].some((x) => Number.isNaN(x)) || Number.isNaN(paid)) return err("One of the amounts is not a valid number.");
        if (total === null) return err("Enter the total.");
        if (net !== null && vat !== null && net + vat !== total) return err("Net + VAT must equal the total.");
        if (paid > total) return err("Paid cannot be more than the total.");
        if (paid > 0 && !pdate) return err("Enter the date of payment.");
        busy(ev.currentTarget, true);
        try {
          await SupabaseClient.addPurchase({ supplier, doc_number: num, doc_date: date, currency: e("pu-cur").value, net_amount: toDb(net), vat_amount: toDb(vat), total_amount: toDb(total), paid_amount: paid / 100, paid_date: paid > 0 ? pdate : null, note: e("pu-note").value.trim() });
          await X.reload("purchases"); d.close(); ok("Purchase recorded"); tabChanged();
        } catch (er) { busy(ev.currentTarget, false); err(/duplicate|23505|unique/i.test(String(er && (er.message || er.code))) ? "This supplier document number is already recorded." : "Could not save: " + (er.message || "error")); }
      });
    }
    function paymentForm(id) {
      const p = (S.purchases || []).find((x) => String(x.id) === String(id)); if (!p) return;
      const total = U.parseScaled(String(p.total_amount), 2);
      const d = drawer("Record payment — " + p.supplier + " " + p.doc_number,
        '<p class="muted small">Document total ' + esc(money(total, p.currency)) + ". Enter the TOTAL amount paid so far.</p>" +
        '<div class="promo-two"><label class="promo-ctl"><span>Total paid so far</span><input id="py-paid" inputmode="decimal" value="' + esc(p.paid_amount || "") + '"></label><label class="promo-ctl"><span>Date of last payment</span><input type="date" id="py-date" value="' + esc(p.paid_date || today()) + '"></label></div><div id="py-err" class="promo-msg promo-err" hidden></div>',
        '<button type="button" class="button button-outline" data-x>Cancel</button><button type="button" class="button" id="py-save">Save</button>');
      $("[data-x]", d.el).addEventListener("click", d.close);
      $("#py-save", d.el).addEventListener("click", async (ev) => {
        const err = (m) => { const x = $("#py-err", d.el); x.hidden = false; x.textContent = m; };
        const paid = dec($("#py-paid", d.el).value) || 0, date = $("#py-date", d.el).value;
        if (Number.isNaN(paid)) return err("Not a valid amount."); if (paid > total) return err("Paid cannot be more than the document total."); if (paid > 0 && !date) return err("Enter the payment date.");
        busy(ev.currentTarget, true);
        try { await SupabaseClient.updatePurchasePayment(p.id, paid / 100, paid > 0 ? date : null, p.note || ""); await X.reload("purchases"); d.close(); ok("Payment saved"); tabChanged(); }
        catch (er) { busy(ev.currentTarget, false); err("Could not save: " + (er.message || "error")); }
      });
    }
    function voidForm(id) {
      const p = (S.purchases || []).find((x) => String(x.id) === String(id)); if (!p) return;
      const d = drawer("Void purchase record",
        '<p>' + esc(p.supplier) + " — " + esc(p.doc_number) + '</p><p class="muted small">A voided record is kept for the audit trail but is no longer counted in reports, and cannot be changed again. To correct a mistake, void it and enter the right document.</p><label class="promo-ctl"><span>Reason</span><input id="vd-reason" maxlength="300"></label><div id="vd-err" class="promo-msg promo-err" hidden></div>',
        '<button type="button" class="button button-outline" data-x>Cancel</button><button type="button" class="button button-danger" id="vd-save">Void record</button>');
      $("[data-x]", d.el).addEventListener("click", d.close);
      $("#vd-save", d.el).addEventListener("click", async (ev) => {
        const reason = $("#vd-reason", d.el).value.trim();
        if (!reason) { const x = $("#vd-err", d.el); x.hidden = false; x.textContent = "Enter a reason."; return; }
        busy(ev.currentTarget, true);
        try { await SupabaseClient.voidPurchase(p.id, reason); await X.reload("purchases"); d.close(); ok("Record voided"); tabChanged(); }
        catch (er) { busy(ev.currentTarget, false); fail(er, "Could not void the record"); }
      });
    }

    tabChanged();
  };
})();
