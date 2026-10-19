/* Invoicing core (Admin → Invoices / Faturat). Pure functions, no DOM, no network — unit-tested in tests/invoicing/.
   compute() is an exact twin of the database function invoice_compute() (same rounding, same order of operations);
   tests/invoicing/parity.mjs runs both on thousands of random invoices and requires identical results.
   The database is the authority: it recomputes every total when a draft is saved and when it is issued. This copy only
   drives the live preview and the reports, so what you see on screen equals what the server stores.

   All money is held as integer cents (BigInt inside compute) so there is no floating-point drift. Rounding is half-up per
   line, exactly like PostgreSQL round(numeric, 2). No tax rate is assumed anywhere: VAT is whatever the admin types. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(); else root.InvoicesCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- exact decimal helpers ---------- */
  const reNum = /^-?\d+(\.\d+)?$/;
  // decimal string/number -> BigInt scaled by 10^scale (rounded half-up away from zero for extra digits)
  function scaled(v, scale) {
    if (v === null || v === undefined || v === "") return 0n;
    const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "0") : String(v).trim().replace(",", ".");
    let t = s;
    if (/e/i.test(t)) t = Number(t).toFixed(Math.max(scale, 6));
    if (!reNum.test(t)) return 0n;
    const neg = t.startsWith("-"); if (neg) t = t.slice(1);
    let [i, f = ""] = t.split(".");
    const round = f.length > scale && f.charCodeAt(scale) >= 53;
    f = (f + "0".repeat(scale)).slice(0, scale);
    let n = BigInt(i + f) + (round ? 1n : 0n);
    return neg ? -n : n;
  }
  const cents = (v) => scaled(v, 2);
  // a / b rounded half-up (non-negative operands)
  const divRound = (a, b) => (b === 0n ? 0n : (a * 2n + b) / (2n * b));
  const toNum = (c) => Number(c) / 100;
  const isMoney = (v) => reNum.test(String(v).trim().replace(",", ".")) && scaled(v, 6) >= 0n;

  /* ---------- the invoice maths ---------- */
  function compute(lines, opts) {
    opts = opts || {};
    const n = lines.length;
    const gross = [], ldisc = [], net = [], share = [], vat = [];
    let sumGross = 0n, sumLdisc = 0n, sumNet = 0n, big = 0;
    for (let i = 0; i < n; i++) {
      const L = lines[i];
      const q = scaled(L.qty, 3), pr = cents(L.unit_price), dv = scaled(L.discount_value, 2);
      const g = divRound(q * pr, 1000n);
      const d = (L.discount_type === "percent") ? divRound(g * dv, 10000n) : (dv < g ? dv : g);
      gross.push(g); ldisc.push(d); net.push(g - d); vat.push(scaled(L.vat_rate, 2));
      sumGross += g; sumLdisc += d; sumNet += g - d;
      if (net[i] > net[big]) big = i;
    }
    const ov = scaled(opts.discountValue, 2);
    const odisc = (opts.discountType === "percent") ? divRound(sumNet * ov, 10000n) : (ov < sumNet ? ov : sumNet);
    let alloc = 0n;
    for (let i = 0; i < n; i++) { const s = sumNet > 0n ? divRound(odisc * net[i], sumNet) : 0n; share.push(s); alloc += s; }
    if (n > 0) share[big] += odisc - alloc;
    let sumTaxable = 0n, sumTax = 0n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const taxable = net[i] - share[i];
      const tax = divRound(taxable * vat[i], 10000n);
      sumTaxable += taxable; sumTax += tax;
      out.push({ line_gross: toNum(gross[i]), line_discount: toNum(ldisc[i]), line_net: toNum(net[i]), overall_discount_share: toNum(share[i]), line_tax: toNum(tax), line_total: toNum(taxable + tax) });
    }
    const ship = cents(opts.shipping), shipTax = divRound(ship * scaled(opts.shippingVat, 2), 10000n);
    return { lines: out, gross_total: toNum(sumGross), line_discount_total: toNum(sumLdisc), overall_discount_total: toNum(odisc),
      taxable_total: toNum(sumTaxable), shipping: toNum(ship), shipping_tax: toNum(shipTax), tax_total: toNum(sumTax + shipTax), total: toNum(sumTaxable + ship + sumTax + shipTax) };
  }

  /* ---------- dates, statuses ---------- */
  function today(now) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(now || new Date());
    return p; // YYYY-MM-DD
  }
  const addDays = (iso, d) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

  // same rule as the invoice_overview view
  function displayStatus(inv, paid, now) {
    if (inv.status === "draft") return "draft";
    if (inv.status === "cancelled") return "cancelled";
    const balance = cents(inv.total) - cents(paid);
    if (balance <= 0n) return "paid";
    if (inv.due_date && inv.due_date < today(now)) return "overdue";
    if (cents(paid) > 0n) return "partial";
    return "issued";
  }
  const STATUS = {
    draft: { en: "Draft", sq: "Draft", tone: "gray" }, issued: { en: "Issued", sq: "Lëshuar", tone: "blue" }, partial: { en: "Partly paid", sq: "Paguar pjesërisht", tone: "amber" },
    paid: { en: "Paid", sq: "Paguar", tone: "green" }, overdue: { en: "Overdue", sq: "Vonuar", tone: "red" }, cancelled: { en: "Cancelled", sq: "Anuluar", tone: "gray" }
  };
  const METHODS = { cash: { en: "Cash", sq: "Para në dorë" }, bank_transfer: { en: "Bank transfer", sq: "Transfertë bankare" }, card: { en: "Card", sq: "Kartë" }, other: { en: "Other", sq: "Tjetër" } };

  /* ---------- reports / dashboard (never mix currencies) ---------- */
  const add = (o, k, v) => { o[k] = (o[k] || 0n) + v; };
  // inv: invoice_overview rows; pays: invoice_payments rows; range: { from, to } inclusive ISO dates (invoices by issue date, payments by paid_on)
  function summarize(invs, pays, range, now) {
    range = range || {};
    const inR = (d) => d && (!range.from || d >= range.from) && (!range.to || d <= range.to);
    const live = invs.filter((i) => i.status === "issued");
    const byId = new Map(invs.map((i) => [i.id, i]));
    const cur = {};
    const slot = (c) => (cur[c] = cur[c] || { invoiced: 0n, tax: 0n, received: 0n, outstanding: 0n, overdue: 0n, count: 0, overdueCount: 0, cancelled: 0, drafts: 0, paidOnInvoicesInRange: 0n });
    for (const i of invs) {
      const s = slot(i.currency);
      if (i.status === "draft") { s.drafts++; continue; }
      if (i.status === "cancelled") { if (inR(i.issue_date)) s.cancelled++; continue; }
      const paid = cents(i.paid_amount), bal = cents(i.total) - paid;
      // receivables are a position "as of now", not limited to the period
      s.outstanding += bal;
      if (displayStatus(i, i.paid_amount, now) === "overdue") { s.overdue += bal; s.overdueCount++; }
      if (inR(i.issue_date)) { s.invoiced += cents(i.total); s.tax += cents(i.tax_total); s.count++; s.paidOnInvoicesInRange += paid; }
    }
    for (const p of pays) {
      if (p.reversed) continue; const inv = byId.get(p.invoice_id); if (!inv || inv.status === "draft") continue;
      if (inR(p.paid_on)) slot(inv.currency).received += cents(p.amount);
    }
    const res = {};
    for (const c of Object.keys(cur)) {
      const s = cur[c];
      res[c] = { invoiced: toNum(s.invoiced), tax: toNum(s.tax), received: toNum(s.received), outstanding: toNum(s.outstanding), overdue: toNum(s.overdue), count: s.count, overdueCount: s.overdueCount, cancelled: s.cancelled, drafts: s.drafts,
        /* identity that must always hold for the invoices of the period: invoiced = paid-so-far + still-owed */
        invoicedCheck: s.invoiced === s.paidOnInvoicesInRange + livePeriodBalance(live, c, inR) };
    }
    return res;
  }
  function livePeriodBalance(live, c, inR) { let b = 0n; for (const i of live) if (i.currency === c && inR(i.issue_date)) b += cents(i.total) - cents(i.paid_amount); return b; }

  // monthly rows: invoiced (by issue month) and received (by payment month), per currency
  function byMonth(invs, pays, range) {
    const inR = (d) => d && (!range.from || d >= range.from) && (!range.to || d <= range.to);
    const m = {}; const get = (k, c) => (m[k + "|" + c] = m[k + "|" + c] || { month: k, currency: c, invoiced: 0n, tax: 0n, received: 0n, count: 0 });
    const byId = new Map(invs.map((i) => [i.id, i]));
    for (const i of invs) if (i.status === "issued" && inR(i.issue_date)) { const r = get(i.issue_date.slice(0, 7), i.currency); r.invoiced += cents(i.total); r.tax += cents(i.tax_total); r.count++; }
    for (const p of pays) { if (p.reversed) continue; const i = byId.get(p.invoice_id); if (i && i.status !== "draft" && inR(p.paid_on)) get(p.paid_on.slice(0, 7), i.currency).received += cents(p.amount); }
    return Object.values(m).sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.currency < b.currency ? -1 : 1))
      .map((r) => ({ month: r.month, currency: r.currency, invoiced: toNum(r.invoiced), tax: toNum(r.tax), received: toNum(r.received), count: r.count }));
  }
  function byCustomer(invs, range) {
    const inR = (d) => d && (!range.from || d >= range.from) && (!range.to || d <= range.to);
    const m = {};
    for (const i of invs) if (i.status === "issued" && inR(i.issue_date)) {
      const name = (i.customer && i.customer.name) || "—", k = (i.customer_id || name.toLowerCase()) + "|" + i.currency;
      const r = (m[k] = m[k] || { name, currency: i.currency, invoiced: 0n, balance: 0n, count: 0 });
      r.invoiced += cents(i.total); r.balance += cents(i.total) - cents(i.paid_amount); r.count++;
    }
    return Object.values(m).sort((a, b) => (b.invoiced > a.invoiced ? 1 : -1)).map((r) => ({ name: r.name, currency: r.currency, invoiced: toNum(r.invoiced), balance: toNum(r.balance), count: r.count }));
  }
  /* Shop orders vs invoices. Orders are what customers placed; invoices are what you issued. Neither is changed by the other. */
  function orderReconciliation(orders, invs) {
    const liveByOrder = new Map(); for (const i of invs) if (i.order_id != null && i.status !== "cancelled") liveByOrder.set(String(i.order_id), i);
    const active = orders.filter((o) => o.status !== "cancelled");
    let notInvoiced = 0, notInvoicedValue = 0n, differs = [];
    for (const o of active) {
      const inv = liveByOrder.get(String(o.id));
      if (!inv) { notInvoiced++; notInvoicedValue += cents(o.total); }
      else if (cents(inv.total) !== cents(o.total)) differs.push({ order: o.order_number || "#" + o.id, orderTotal: Number(o.total), invoiceTotal: Number(inv.total), invoice: inv.number || "(draft)" });
    }
    return { orders: active.length, invoicedOrders: active.length - notInvoiced, notInvoiced, notInvoicedValue: toNum(notInvoicedValue), differs };
  }

  /* ---------- CSV ---------- */
  const INV_CSV_HEAD = ["Invoice no.", "Status", "Issue date", "Due date", "Customer", "Customer tax ID", "Currency", "Net (taxable)", "VAT", "Delivery", "Total", "Paid", "Balance", "Order", "Cancel reason"];
  function invoiceCsvRows(invs, now) {
    return invs.filter((i) => i.status !== "draft").map((i) => [i.number, (STATUS[displayStatus(i, i.paid_amount, now)] || {}).en, i.issue_date, i.due_date || "", (i.customer && i.customer.name) || "", (i.customer && i.customer.tax_id) || "", i.currency,
      Number(i.taxable_total).toFixed(2), Number(i.tax_total).toFixed(2), Number(i.shipping).toFixed(2), Number(i.total).toFixed(2), Number(i.paid_amount).toFixed(2), (i.status === "cancelled" ? 0 : Number(i.total) - Number(i.paid_amount)).toFixed(2), i.order_ref || "", i.cancel_reason || ""]);
  }
  const PAY_CSV_HEAD = ["Paid on", "Invoice no.", "Customer", "Currency", "Amount", "Method", "Reference", "Note", "Reversed", "Reversal reason"];
  function paymentCsvRows(pays, invs) {
    const byId = new Map(invs.map((i) => [i.id, i]));
    return pays.map((p) => { const i = byId.get(p.invoice_id) || {}; return [p.paid_on, i.number || "", (i.customer && i.customer.name) || "", i.currency || "", Number(p.amount).toFixed(2), (METHODS[p.method] || {}).en || p.method, p.reference || "", p.note || "", p.reversed ? "yes" : "", p.reverse_reason || ""]; });
  }

  /* ---------- WhatsApp (opens the admin's own WhatsApp with text; nothing is sent or tracked) ---------- */
  function waPhone(raw, defaultCc) {
    let d = String(raw || "").replace(/[^\d+]/g, "");
    if (d.startsWith("+")) return d.slice(1).replace(/\D/g, "");
    d = d.replace(/\D/g, "");
    if (d.startsWith("00")) return d.slice(2);
    if (d.startsWith("0")) return (defaultCc || "355") + d.slice(1);
    return d;
  }
  function whatsappText(inv, seller, lang) {
    const sq = lang !== "en", m = (v) => Number(v).toFixed(2) + " " + inv.currency;
    const lines = sq
      ? ["Përshëndetje " + ((inv.customer && inv.customer.name) || ""), "Fatura " + inv.number + " nga " + ((seller && seller.company_name) || "SubCore Solutions") + ".", "Shuma: " + m(inv.total) + (inv.due_date ? "; afati: " + inv.due_date.split("-").reverse().join(".") : ""), "Faleminderit!"]
      : ["Hello " + ((inv.customer && inv.customer.name) || ""), "Invoice " + inv.number + " from " + ((seller && seller.company_name) || "SubCore Solutions") + ".", "Amount: " + m(inv.total) + (inv.due_date ? "; due: " + inv.due_date.split("-").reverse().join(".") : ""), "Thank you!"];
    return lines.join("\n");
  }
  const errText = (e) => String((e && e.message) || e || "").replace(/^[a-z_]+:\s*/, "");
  const errCode = (e) => { const m = /^([a-z_]+):/.exec(String((e && e.message) || "")); return m ? m[1] : ""; };

  return { compute, scaled, cents, toNum, isMoney, today, addDays, displayStatus, STATUS, METHODS, summarize, byMonth, byCustomer, orderReconciliation, INV_CSV_HEAD, invoiceCsvRows, PAY_CSV_HEAD, paymentCsvRows, waPhone, whatsappText, errText, errCode };
});
