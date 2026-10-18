/* SubCore Solutions — monthly sales & purchase reports (pure logic, no DOM, no network).
   Works in the browser (window.ReportsCore) and in Node (module.exports) for tests.

   Needs SC.util and SC.calc (vendor/invoice/util.js + calc.js, copied unmodified from the invoice app)
   for invoice arithmetic. Money is integer minor units (1/100). Currencies are NEVER mixed or converted:
   every total is kept per currency.

   Three independent record sources. They are never added together, because the same sale can exist
   both as a shop order and as an invoice:
     orders     shop orders from Supabase           -> "ordered" amounts. No payment data exists (cash on delivery).
     invoices   imported invoice-app backup file    -> invoiced / received / outstanding, VAT, discounts.
     purchases  manual purchase ledger              -> recorded / paid / outstanding.

   Exclusions (always reported separately, never silently dropped):
     cancelled   cancelled orders / invoices / voided purchases
     demo        the invoice app's DEMO sample invoices (fictitious, flagged demo:true)
     drafts      invoices not yet issued
     duplicates  a record that repeats an earlier one (same invoice number, same supplier + document number,
                 or an order with the same phone + items + total placed within DUP_WINDOW_MIN minutes) */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(root.SC);
  else root.ReportsCore = factory(root.SC);
})(typeof window !== 'undefined' ? window : globalThis, function (SC) {
  'use strict';
  var U = SC && SC.util, C = SC && SC.calc;
  var R = {};
  var DUP_WINDOW_MIN = 10;
  R.DUP_WINDOW_MIN = DUP_WINDOW_MIN;

  /* ---------- small helpers ---------- */
  function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && U.isValidDate(s); }
  // Calendar date of an ISO timestamp in the business time zone (Europe/Tirana: UTC+1, UTC+2 in EU summer time,
  // i.e. from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC). Computed by rule instead of
  // Intl so the month a sale belongs to never depends on the browser's time-zone database.
  function lastSundayUtc(year, month0) { // 01:00 UTC on the last Sunday of the month
    var d = new Date(Date.UTC(year, month0 + 1, 0, 1, 0, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  }
  function tiranaDate(ts) {
    if (!ts) return null;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    var y = d.getUTCFullYear(), t = d.getTime();
    var summer = t >= lastSundayUtc(y, 2) && t < lastSundayUtc(y, 9);
    return new Date(t + (summer ? 2 : 1) * 3600000).toISOString().slice(0, 10);
  }
  // Decimal (number or string, e.g. NUMERIC) -> integer minor units, or null when not a clean non-negative number.
  function toMinor(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = U.parseScaled(typeof v === 'number' ? String(v) : v, 2);
    return (n === null || isNaN(n)) ? null : n;
  }
  function cur(c) { c = String(c || '').trim().toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : 'ALL'; }
  function addTo(map, key, field, n) { if (!map[key]) map[key] = {}; map[key][field] = (map[key][field] || 0) + n; }
  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  R.monthOf = function (iso) { return isIso(iso) ? iso.slice(0, 7) : null; };
  R.tiranaDate = tiranaDate;

  /* ---------- filtering helper shared by all sources ---------- */
  function inRange(date, f) {
    if (!date) return false;
    if (f.from && date < f.from) return false;
    if (f.to && date > f.to) return false;
    return true;
  }

  /* =====================================================================
     1) SHOP ORDERS
     input: [{id, order_number, created_at, status, customer_name, customer_phone, customer_email,
              items:[{id,name,sku,qty,price,currency}], total, shipping}]
     ===================================================================== */
  function normOrder(o) {
    var items = Array.isArray(o.items) ? o.items : [];
    var lines = items.map(function (it) {
      var price = toMinor(it.price), qty = parseInt(it.qty, 10);
      return { id: String(it.id || ''), name: String(it.name || ''), sku: String(it.sku || ''), qty: qty > 0 ? qty : 0,
        priceMinor: price === null ? 0 : price, currency: cur(it.currency), bad: price === null || !(qty > 0) };
    });
    var total = toMinor(o.total), ship = toMinor(o.shipping) || 0;
    var currency = lines.length ? lines[0].currency : 'ALL';
    var mixed = lines.some(function (l) { return l.currency !== currency; });
    var goods = lines.reduce(function (a, l) { return a + l.priceMinor * l.qty; }, 0);
    return {
      id: o.id, number: o.order_number || ('#' + o.id), date: tiranaDate(o.created_at), createdAt: o.created_at,
      status: String(o.status || ''), customer: String(o.customer_name || ''), phone: digits(o.customer_phone), email: norm(o.customer_email),
      lines: lines, currency: currency, goods: goods, shipping: ship,
      total: total === null ? goods + ship : total,
      // The stored total must equal goods + shipping; if not we report it rather than guess which is right.
      totalMismatch: total !== null && total !== goods + ship,
      mixedCurrency: mixed
    };
  }
  function orderSignature(o) { return [o.phone, o.currency, o.total, o.lines.map(function (l) { return l.id + 'x' + l.qty; }).sort().join('|')].join('#'); }

  /* Marks later copies of the same order as duplicates: same phone + same items + same total placed within
     DUP_WINDOW_MIN minutes of an earlier KEPT order. The earliest order is the one that counts. */
  R.markOrderDuplicates = function (orders) {
    var sorted = orders.slice().sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)) || (a.id > b.id ? 1 : -1); });
    var lastBySig = {};
    sorted.forEach(function (o) {
      o.duplicateOf = null;
      if (o.phone.length < 8 || !o.lines.length) return;
      var sig = orderSignature(o), prev = lastBySig[sig];
      if (prev && Math.abs(new Date(o.createdAt) - new Date(prev.createdAt)) <= DUP_WINDOW_MIN * 60000) o.duplicateOf = prev.number;
      else lastBySig[sig] = o;
    });
    return orders;
  };

  /* filters: {from,to (YYYY-MM-DD), customer (text), product (text: name/sku/id), includeDuplicates, statuses?} */
  R.reportOrders = function (rawOrders, filters) {
    var f = filters || {};
    var all = R.markOrderDuplicates((rawOrders || []).map(normOrder));
    var cust = norm(f.customer), prod = norm(f.product);
    var counted = [], excluded = { cancelled: [], duplicates: [], undated: [] }, months = {}, totals = {}, products = {};
    var warnings = [];
    all.forEach(function (o) {
      if (!o.date) { excluded.undated.push(o); return; }
      if (!inRange(o.date, f)) return;
      if (cust && !(norm(o.customer).indexOf(cust) >= 0 || (digits(cust) && o.phone.indexOf(digits(cust)) >= 0) || o.email.indexOf(cust) >= 0)) return;
      var matchLines = o.lines;
      if (prod) {
        matchLines = o.lines.filter(function (l) { return norm(l.name).indexOf(prod) >= 0 || norm(l.sku).indexOf(prod) >= 0 || norm(l.id) === prod; });
        if (!matchLines.length) return;
      }
      if (o.status === 'cancelled') { excluded.cancelled.push(o); return; }
      if (o.duplicateOf && !f.includeDuplicates) { excluded.duplicates.push(o); return; }
      if (o.totalMismatch) warnings.push({ code: 'order_total_mismatch', ref: o.number });
      if (o.mixedCurrency) warnings.push({ code: 'order_mixed_currency', ref: o.number });
      if (o.lines.some(function (l) { return l.bad; })) warnings.push({ code: 'order_bad_line', ref: o.number });
      counted.push(o);
      var m = R.monthOf(o.date), c = o.currency;
      var key = m + '|' + c;
      // When a product filter is active only the matching lines are summed (shipping is order-level, so it is left out).
      var goods = prod ? matchLines.reduce(function (a, l) { return a + l.priceMinor * l.qty; }, 0) : o.goods;
      var ship = prod ? 0 : o.shipping;
      var tot = prod ? goods : o.total;
      addTo(months, key, 'count', 1); addTo(months, key, 'goods', goods); addTo(months, key, 'shipping', ship); addTo(months, key, 'total', tot);
      addTo(totals, c, 'count', 1); addTo(totals, c, 'goods', goods); addTo(totals, c, 'shipping', ship); addTo(totals, c, 'total', tot);
      matchLines.forEach(function (l) {
        var pk = (l.sku || l.id || l.name) + '|' + c;
        if (!products[pk]) products[pk] = { key: l.sku || l.id || l.name, name: l.name, currency: c, qty: 0, amount: 0 };
        products[pk].qty += l.qty; products[pk].amount += l.priceMinor * l.qty;
      });
    });
    return {
      source: 'orders', counted: counted, months: flattenMonths(months), totals: totals,
      products: Object.keys(products).map(function (k) { return products[k]; }).sort(function (a, b) { return b.amount - a.amount; }),
      excluded: excluded, warnings: warnings,
      notRecorded: ['payment', 'vat', 'discount'] // the shop stores none of these: shown as "not recorded", never as 0
    };
  };

  function flattenMonths(map) {
    return Object.keys(map).sort().map(function (k) {
      var p = k.split('|'); var row = map[k]; row.month = p[0]; row.currency = p[1]; return row;
    });
  }

  /* =====================================================================
     2) INVOICES — imported from the invoice app's backup file
     ===================================================================== */
  // Strict validation of a backup file. Returns {ok, error?, invoices?, meta?}. Nothing is trusted: every
  // field used later is re-checked, and nothing from the file is ever rendered as HTML by the caller.
  R.parseInvoiceBackup = function (text) {
    var data;
    if (typeof text === 'string') {
      if (text.length > 20 * 1024 * 1024) return { ok: false, error: 'too_large' };
      try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'not_json' }; }
    } else data = text;
    if (!data || typeof data !== 'object' || data.app !== 'subcore-invoicing') return { ok: false, error: 'not_invoice_backup' };
    if (!Array.isArray(data.invoices)) return { ok: false, error: 'no_invoices' };
    var out = [], skipped = 0;
    data.invoices.forEach(function (inv) {
      if (!inv || typeof inv !== 'object' || !String(inv.number || '').trim() || !isIso(inv.issueDate) ||
          ['draft', 'issued', 'cancelled'].indexOf(inv.status) < 0 || !Array.isArray(inv.items)) { skipped++; return; }
      out.push(inv);
    });
    return { ok: true, invoices: out, skipped: skipped, meta: { exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt.slice(0, 40) : '', version: data.version } };
  };

  function normInvoice(inv, today) {
    var calc = C.compute(inv);
    var cust = inv.customer || {};
    var status = C.derivedStatus(inv, calc, today);
    // Payments dated after the report date range are still real payments; we keep each one with its date.
    var pays = (inv.payments || []).map(function (p) {
      var a = U.parseScaled(p.amount, 2);
      return { date: isIso(p.date) ? p.date : null, amount: (a === null || isNaN(a)) ? 0 : a, method: String(p.method || '') };
    });
    return {
      number: C.normNumber(inv.number), rawNumber: String(inv.number), date: inv.issueDate, dueDate: isIso(inv.dueDate) ? inv.dueDate : null,
      storedStatus: inv.status, status: status, currency: cur(inv.currency),
      customer: String(cust.name || ''), customerTaxId: String(cust.taxId || ''),
      calc: calc, payments: pays, fiscalRef: inv.fiscalRef ? String(inv.fiscalRef) : '',
      items: (inv.items || []).map(function (it) { return { name: String(it.name || ''), sku: String(it.sku || '') }; }),
      demo: inv.demo === true,
      correctionOf: inv.correctionOf || inv.creditNoteFor || null,
      kind: String(inv.type || inv.kind || '').toLowerCase()
    };
  }

  /* filters: {from,to,customer,product, status: 'all'|'paid'|'partial'|'overdue'|'issued', includeDuplicates, today} */
  R.reportInvoices = function (rawInvoices, filters) {
    var f = filters || {};
    var today = isIso(f.today) ? f.today : U.today();
    var all = (rawInvoices || []).map(function (i) { return normInvoice(i, today); });
    var seen = {}, cust = norm(f.customer), prod = norm(f.product);
    var counted = [], excluded = { demo: [], cancelled: [], drafts: [], duplicates: [], corrections: [] }, months = {}, totals = {}, warnings = [];
    // Oldest first so the first use of a number is the one that counts.
    all.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    all.forEach(function (n) {
      if (!inRange(n.date, f)) return;
      if (cust && norm(n.customer).indexOf(cust) < 0 && norm(n.customerTaxId).indexOf(cust) < 0) return;
      if (prod && !n.items.some(function (it) { return norm(it.name).indexOf(prod) >= 0 || norm(it.sku).indexOf(prod) >= 0; })) return;
      if (n.demo) { excluded.demo.push(n); return; } // the invoice app's sample invoices (DEMO-xxxx, fictitious) are never real sales
      if (n.storedStatus === 'cancelled') { excluded.cancelled.push(n); return; }
      if (n.storedStatus === 'draft') { excluded.drafts.push(n); return; }
      var dupKey = n.number;
      if (seen[dupKey]) { n.duplicateOf = seen[dupKey].rawNumber; if (!f.includeDuplicates) { excluded.duplicates.push(n); return; } }
      else seen[dupKey] = n;
      // A credit note / correction document is reported on its own line and not added to sales (it would be a negative or
      // double entry); the file format of the invoice app has no such type today, so this only triggers if a later version adds one.
      if (n.correctionOf || /credit|correct|storno/.test(n.kind)) { excluded.corrections.push(n); return; }
      if (f.status && f.status !== 'all' && n.status !== f.status) return;
      if (n.calc.unsetVatCount) warnings.push({ code: 'invoice_vat_unset', ref: n.rawNumber });
      if (n.calc.issues.some(function (i) { return i.code === 'invalid' || i.code === 'range'; })) warnings.push({ code: 'invoice_calc_issue', ref: n.rawNumber });
      if (n.calc.overpaid) warnings.push({ code: 'invoice_overpaid', ref: n.rawNumber });
      counted.push(n);
      var key = R.monthOf(n.date) + '|' + n.currency, c = n.currency, k = n.calc;
      // "Received" = payments recorded on the invoice (any date). Outstanding = invoiced - received, never below 0 in the totals
      // (an overpayment is a separate warning, not negative debt).
      var outstanding = Math.max(0, k.balance);
      [[months, key], [totals, c]].forEach(function (pair) {
        var m = pair[0], kk = pair[1];
        addTo(m, kk, 'count', 1); addTo(m, kk, 'net', k.taxable); addTo(m, kk, 'vat', k.vatTotal); addTo(m, kk, 'invoiced', k.total);
        addTo(m, kk, 'discount', k.lineDiscountTotal + k.globalDiscount); addTo(m, kk, 'received', k.paid); addTo(m, kk, 'outstanding', outstanding);
        if (n.status === 'overdue') addTo(m, kk, 'overdue', outstanding);
      });
    });
    return { source: 'invoices', counted: counted, months: flattenMonths(months), totals: totals, excluded: excluded, warnings: warnings, today: today };
  };

  /* =====================================================================
     3) PURCHASES — manual ledger (table purchase_records)
     row: {id, supplier, doc_number, doc_date, currency, net_amount, vat_amount, total_amount, paid_amount, paid_date, voided, note}
     ===================================================================== */
  function normPurchase(p) {
    var total = toMinor(p.total_amount), vat = toMinor(p.vat_amount), paid = toMinor(p.paid_amount) || 0;
    var net = toMinor(p.net_amount);
    return {
      id: p.id, supplier: String(p.supplier || ''), number: norm(p.doc_number), rawNumber: String(p.doc_number || ''), date: isIso(p.doc_date) ? p.doc_date : null,
      currency: cur(p.currency), total: total === null ? 0 : total, vat: vat, net: net, paid: paid, paidDate: isIso(p.paid_date) ? p.paid_date : null,
      voided: !!p.voided, note: String(p.note || ''), bad: total === null
    };
  }
  /* filters: {from,to,supplier,product(note text), includeDuplicates} */
  R.reportPurchases = function (rawRows, filters) {
    var f = filters || {};
    var all = (rawRows || []).map(normPurchase), sup = norm(f.supplier), txt = norm(f.product);
    var counted = [], excluded = { voided: [], duplicates: [], undated: [] }, months = {}, totals = {}, warnings = [], seen = {};
    all.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    all.forEach(function (p) {
      if (!p.date) { excluded.undated.push(p); return; }
      if (!inRange(p.date, f)) return;
      if (sup && norm(p.supplier).indexOf(sup) < 0) return;
      if (txt && norm(p.note).indexOf(txt) < 0) return;
      if (p.voided) { excluded.voided.push(p); return; }
      var dk = norm(p.supplier) + '|' + p.number;
      if (p.number && seen[dk]) { p.duplicateOf = seen[dk].rawNumber; if (!f.includeDuplicates) { excluded.duplicates.push(p); return; } }
      else if (p.number) seen[dk] = p;
      if (p.bad) warnings.push({ code: 'purchase_bad_amount', ref: p.rawNumber || String(p.id) });
      if (p.paid > p.total) warnings.push({ code: 'purchase_overpaid', ref: p.rawNumber || String(p.id) });
      if (p.net !== null && p.vat !== null && p.net + p.vat !== p.total) warnings.push({ code: 'purchase_total_mismatch', ref: p.rawNumber || String(p.id) });
      counted.push(p);
      var key = R.monthOf(p.date) + '|' + p.currency, c = p.currency, out = Math.max(0, p.total - p.paid);
      [[months, key], [totals, c]].forEach(function (pair) {
        var m = pair[0], kk = pair[1];
        addTo(m, kk, 'count', 1); addTo(m, kk, 'total', p.total); addTo(m, kk, 'paid', p.paid); addTo(m, kk, 'outstanding', out);
        if (p.vat !== null) addTo(m, kk, 'vat', p.vat); else addTo(m, kk, 'vatUnknownCount', 1);
      });
    });
    return { source: 'purchases', counted: counted, months: flattenMonths(months), totals: totals, excluded: excluded, warnings: warnings };
  };

  /* =====================================================================
     4) Comparison — deliberately NOT called profit
     Takes a sales total map and a purchase total map (both per currency) and returns the plain arithmetic
     difference of the recorded documents, labelled as such. Also tells the caller why it cannot be profit.
     ===================================================================== */
  R.compareRecorded = function (salesTotals, purchaseTotals, salesField, purchaseField) {
    var cs = {}; var all = {};
    Object.keys(salesTotals || {}).forEach(function (c) { all[c] = 1; });
    Object.keys(purchaseTotals || {}).forEach(function (c) { all[c] = 1; });
    Object.keys(all).forEach(function (c) {
      var s = ((salesTotals || {})[c] || {})[salesField] || 0, p = ((purchaseTotals || {})[c] || {})[purchaseField] || 0;
      cs[c] = { sales: s, purchases: p, difference: s - p };
    });
    return {
      label: 'difference_of_recorded_documents',
      isProfit: false,
      caveats: ['no_stock_valuation', 'no_cost_of_goods_matching', 'no_expenses_payroll_depreciation', 'vat_not_separated_unless_shown', 'not_accounting_profit'],
      perCurrency: cs
    };
  };

  /* =====================================================================
     5) Export (CSV rows). All text cells pass through the formula-injection guard of the invoice util.
     ===================================================================== */
  function money(minor) { return U.formatMoney(minor || 0, '', 'en-GB').replace(/,/g, ''); } // plain 1234.56 for spreadsheets
  R.plainMoney = money;
  R.toCsvRows = function (report) {
    var rows = [], s = report.source;
    if (s === 'orders') {
      rows.push(['order', 'date', 'status', 'customer', 'currency', 'goods', 'shipping', 'total', 'flag']);
      report.counted.forEach(function (o) { rows.push([o.number, o.date, o.status, o.customer, o.currency, money(o.goods), money(o.shipping), money(o.total), o.duplicateOf ? 'duplicate_of:' + o.duplicateOf : '']); });
    } else if (s === 'invoices') {
      rows.push(['invoice', 'issue_date', 'status', 'customer', 'currency', 'net', 'vat', 'discount', 'invoiced', 'received', 'outstanding', 'fiscal_ref']);
      report.counted.forEach(function (n) { rows.push([n.rawNumber, n.date, n.status, n.customer, n.currency, money(n.calc.taxable), money(n.calc.vatTotal), money(n.calc.lineDiscountTotal + n.calc.globalDiscount), money(n.calc.total), money(n.calc.paid), money(Math.max(0, n.calc.balance)), n.fiscalRef]); });
    } else if (s === 'purchases') {
      rows.push(['document', 'date', 'supplier', 'currency', 'total', 'vat', 'paid', 'paid_date', 'outstanding']);
      report.counted.forEach(function (p) { rows.push([p.rawNumber, p.date, p.supplier, p.currency, money(p.total), p.vat === null ? '' : money(p.vat), money(p.paid), p.paidDate || '', money(Math.max(0, p.total - p.paid))]); });
    }
    return rows;
  };
  R.toCsv = function (report) { return U.toCsv(R.toCsvRows(report)); };

  return R;
});
