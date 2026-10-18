/* Invoice calculation engine and validation. Pure functions, no DOM access.

   Rounding policy (documented in README):
   - Amounts are integers in minor units (1/100 of the currency).
   - Line gross  = round-half-up(quantity x unit price).
   - Line discount: percent -> round-half-up(gross x %), or a fixed amount (capped at gross).
   - Invoice-wide discount is allocated to lines proportionally (largest remainder),
     so VAT bases always add up exactly to the taxable amount.
   - VAT is calculated once per VAT-rate group on the group's taxable base and rounded half up.
   - Total = taxable amount + VAT. Balance = total - payments.
   A VAT rate is never assumed: a line without a VAT rate counts as 0 but is flagged ("unset"). */
(function (root) {
  'use strict';
  var SC = (root.SC = root.SC || {});
  var U = SC.util;
  var C = (SC.calc = {});

  function allocate(total, weights) {
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    if (!sum || !total) return weights.map(function () { return 0; });
    var T = BigInt(total), S = BigInt(sum);
    var parts = weights.map(function (w) { var p = T * BigInt(w); return { q: p / S, r: p % S }; });
    var assigned = parts.reduce(function (a, p) { return a + p.q; }, 0n);
    var left = Number(T - assigned);
    var order = parts.map(function (_, i) { return i; }).sort(function (a, b) {
      if (parts[b].r > parts[a].r) return 1;
      if (parts[b].r < parts[a].r) return -1;
      return a - b;
    });
    var out = parts.map(function (p) { return Number(p.q); });
    for (var k = 0; k < left; k++) out[order[k]] += 1;
    return out;
  }
  C.allocate = allocate;

  C.compute = function (inv) {
    var issues = [];
    var items = inv.items || [];
    var unsetVat = 0;

    var lines = items.map(function (it, i) {
      var L = { id: it.id, index: i };
      var q = U.parseScaled(it.qty, 3);
      var p = U.parseScaled(it.unitPrice, 2);
      if (q === null) issues.push({ path: 'items.' + i + '.qty', code: 'empty' });
      else if (isNaN(q)) issues.push({ path: 'items.' + i + '.qty', code: 'invalid' });
      if (p === null) issues.push({ path: 'items.' + i + '.unitPrice', code: 'empty' });
      else if (isNaN(p)) issues.push({ path: 'items.' + i + '.unitPrice', code: 'invalid' });
      L.qtyMilli = q || 0;
      L.priceCents = p || 0;
      L.gross = U.mulDivRound(L.qtyMilli, L.priceCents, 1000);

      var dtype = it.discountType === 'amount' ? 'amount' : 'percent';
      var d = U.parseScaled(it.discount, 2);
      L.discountType = dtype;
      L.discount = 0;
      if (d !== null && isNaN(d)) issues.push({ path: 'items.' + i + '.discount', code: 'invalid' });
      else if (d !== null) {
        if (dtype === 'percent') {
          if (d > 10000) { issues.push({ path: 'items.' + i + '.discount', code: 'range' }); d = 10000; }
          L.discount = U.mulDivRound(L.gross, d, 10000);
        } else {
          if (d > L.gross) { issues.push({ path: 'items.' + i + '.discount', code: 'range' }); d = L.gross; }
          L.discount = d;
        }
      }
      L.net = L.gross - L.discount;

      var v = it.vatRate;
      L.vatBp = null;
      if (v === null || v === undefined || String(v).trim() === '') {
        issues.push({ path: 'items.' + i + '.vatRate', code: 'unset' });
        unsetVat++;
      } else {
        var vb = U.parseScaled(v, 2);
        if (vb === null || isNaN(vb)) issues.push({ path: 'items.' + i + '.vatRate', code: 'invalid' });
        else if (vb > 10000) issues.push({ path: 'items.' + i + '.vatRate', code: 'range' });
        else L.vatBp = vb;
      }
      return L;
    });

    var subtotal = 0, lineDiscountTotal = 0, netAfterLine = 0;
    lines.forEach(function (L) { subtotal += L.gross; lineDiscountTotal += L.discount; netAfterLine += L.net; });

    // invoice-wide discount
    var gd = inv.globalDiscount || {};
    var globalDiscount = 0;
    if (gd.enabled) {
      var g = U.parseScaled(gd.value, 2);
      if (g !== null && isNaN(g)) issues.push({ path: 'globalDiscount.value', code: 'invalid' });
      else if (g !== null) {
        if (gd.type === 'amount') {
          if (g > netAfterLine) { issues.push({ path: 'globalDiscount.value', code: 'range' }); g = netAfterLine; }
          globalDiscount = g;
        } else {
          if (g > 10000) { issues.push({ path: 'globalDiscount.value', code: 'range' }); g = 10000; }
          globalDiscount = U.mulDivRound(netAfterLine, g, 10000);
        }
      }
    }
    var shares = allocate(globalDiscount, lines.map(function (L) { return L.net; }));
    lines.forEach(function (L, i) { L.globalShare = shares[i]; L.base = L.net - shares[i]; });

    var taxable = netAfterLine - globalDiscount;

    // VAT grouped by rate
    var groupsMap = {};
    lines.forEach(function (L) {
      var key = L.vatBp === null ? 'unset' : String(L.vatBp);
      if (!groupsMap[key]) groupsMap[key] = { bp: L.vatBp, base: 0, vat: 0 };
      groupsMap[key].base += L.base;
    });
    var vatGroups = Object.keys(groupsMap).map(function (k) { return groupsMap[k]; });
    vatGroups.sort(function (a, b) {
      if (a.bp === null) return 1;
      if (b.bp === null) return -1;
      return a.bp - b.bp;
    });
    var vatTotal = 0;
    vatGroups.forEach(function (g2) {
      g2.vat = g2.bp === null ? 0 : U.mulDivRound(g2.base, g2.bp, 10000);
      vatTotal += g2.vat;
    });

    var total = taxable + vatTotal;

    var paid = 0;
    (inv.payments || []).forEach(function (pm, i) {
      var a = U.parseScaled(pm.amount, 2);
      if (a === null || isNaN(a)) { issues.push({ path: 'payments.' + i + '.amount', code: a === null ? 'empty' : 'invalid' }); return; }
      paid += a;
    });

    return {
      currency: inv.currency,
      lines: lines,
      subtotal: subtotal,
      lineDiscountTotal: lineDiscountTotal,
      netAfterLineDiscount: netAfterLine,
      globalDiscount: globalDiscount,
      taxable: taxable,
      vatGroups: vatGroups,
      vatTotal: vatTotal,
      total: total,
      paid: paid,
      balance: total - paid,
      overpaid: paid > total,
      unsetVatCount: unsetVat,
      issues: issues
    };
  };

  /* Status shown to the user. Stored status is draft | issued | cancelled;
     payment state and "overdue" are derived from payments and dates. */
  C.derivedStatus = function (inv, calc, todayIso) {
    if (inv.status === 'cancelled') return 'cancelled';
    if (inv.status === 'draft') return 'draft';
    if (calc.total > 0 && calc.balance <= 0) return 'paid';
    if (calc.balance > 0 && U.isValidDate(inv.dueDate) && inv.dueDate < todayIso) return 'overdue';
    if (calc.paid > 0 && calc.balance > 0) return 'partial';
    return 'issued';
  };

  C.normNumber = function (n) { return String(n || '').trim().toUpperCase(); };

  /* Returns { errors: [{path, code}], warnings: [{path, code, params}] }.
     mode 'save'  : only blocks things that make the record unusable.
     mode 'issue' : the stricter checks required before marking an invoice as issued. */
  C.validate = function (inv, calc, opts) {
    opts = opts || {};
    var mode = opts.mode || 'save';
    var errors = [], warnings = [];
    var err = function (path, code) { errors.push({ path: path, code: code }); };
    var warn = function (path, code, params) { warnings.push({ path: path, code: code, params: params }); };

    var num = C.normNumber(inv.number);
    if (!num) err('number', 'required');
    else if (opts.existingNumbers && opts.existingNumbers.has(num)) err('number', 'duplicate');

    if (!U.isValidDate(inv.issueDate)) err('issueDate', 'invalid');
    if (inv.dueDate) {
      if (!U.isValidDate(inv.dueDate)) err('dueDate', 'invalid');
      else if (U.isValidDate(inv.issueDate) && inv.dueDate < inv.issueDate) err('dueDate', 'beforeIssue');
    } else if (mode === 'issue') err('dueDate', 'required');

    // numeric problems found by the calculator
    calc.issues.forEach(function (is) {
      var blocking = is.code === 'invalid' || is.code === 'range';
      var issueOnly = is.code === 'empty' || is.code === 'unset';
      if (blocking) err(is.path, is.code);
      else if (issueOnly && mode === 'issue' && /^items\./.test(is.path)) err(is.path, is.code === 'unset' ? 'unset' : 'required');
    });

    if (mode === 'issue') {
      if (!inv.items || !inv.items.length) err('items', 'noItems');
      (inv.items || []).forEach(function (it, i) {
        if (!String(it.name || '').trim()) err('items.' + i + '.name', 'required');
        var q = U.parseScaled(it.qty, 3);
        if (q === 0) err('items.' + i + '.qty', 'zero');
      });
      if (!String((inv.customer || {}).name || '').trim()) err('customer.name', 'required');
      if (calc.total === 0 && inv.items && inv.items.length) warn('total', 'zeroTotal');
    }

    (inv.payments || []).forEach(function (pm, i) {
      if (!U.isValidDate(pm.date)) err('payments.' + i + '.date', 'invalid');
    });
    if (calc.overpaid) warn('payments', 'overpaid');

    var c = inv.customer || {};
    if (c.email && !U.emailValid(c.email)) warn('customer.email', 'emailFormat');
    if (c.taxId && !U.nuisLooksValid(c.taxId)) warn('customer.taxId', 'nuisFormat');
    if (mode === 'issue' && c.kind === 'company' && !String(c.taxId || '').trim()) warn('customer.taxId', 'taxIdMissing');

    var s = inv.seller || {};
    if (s.iban && !U.ibanValid(s.iban)) warn('seller.iban', 'ibanFormat');
    if (mode === 'issue') {
      var missing = [];
      if (!String(s.legalName || '').trim()) missing.push('legalName');
      if (!String(s.address || '').trim()) missing.push('address');
      if (!String(s.nuis || '').trim()) missing.push('nuis');
      if (missing.length) warn('seller', 'sellerIncomplete', { fields: missing });
    }
    return { errors: errors, warnings: warnings };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);
