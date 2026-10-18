/* Shared helpers: parsing, formatting, dates, validation helpers, downloads.
   No dependencies. Works in the browser and in Node (for tests). */
(function (root) {
  'use strict';
  var SC = (root.SC = root.SC || {});
  var U = (SC.util = {});

  U.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  U.debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  };

  /* ---------- dates (ISO yyyy-mm-dd strings, local time) ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  U.isoDate = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  U.today = function () { return U.isoDate(new Date()); };
  U.isValidDate = function (s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  };
  U.addDays = function (iso, n) {
    var p = iso.split('-').map(Number);
    return U.isoDate(new Date(p[0], p[1] - 1, p[2] + n));
  };
  U.yearOf = function (iso) { return U.isValidDate(iso) ? Number(iso.slice(0, 4)) : null; };
  U.fmtDate = function (iso) {
    return U.isValidDate(iso) ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '';
  };

  /* ---------- numbers ----------
     Money is handled as integer minor units (cents), quantities as thousandths,
     percentages as basis points. This avoids binary floating point errors. */

  // Parses user text into a scaled integer. Returns null for empty input, NaN for invalid.
  // Accepts "1234.5", "1234,5", "1.234,50", "1,234.50". Negative numbers are rejected.
  U.parseScaled = function (input, scale) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') {
      if (!isFinite(input) || input < 0) return NaN;
      input = String(input);
    }
    var s = String(input).replace(/[\s ]/g, '');
    if (s === '') return null;
    if (s.charAt(0) === '+') s = s.slice(1);
    if (s.indexOf('-') !== -1) return NaN;
    var lastDot = s.lastIndexOf('.');
    var lastCom = s.lastIndexOf(',');
    // thousands groups must be exactly 3 digits ("1,2,3" or "12,34,567" are typos, not numbers)
    var grouped = function (str, sep) { return new RegExp('^\\d{1,3}(?:' + (sep === '.' ? '\\.' : ',') + '\\d{3})+$').test(str); };
    if (lastDot > -1 && lastCom > -1) {
      var dec = lastDot > lastCom ? '.' : ',';
      var th = dec === '.' ? ',' : '.';
      var intPart = s.slice(0, s.lastIndexOf(dec));
      if (!grouped(intPart, th)) return NaN;
      s = s.split(th).join('').replace(dec, '.');
    } else if (lastDot > -1 || lastCom > -1) {
      var sep = lastDot > -1 ? '.' : ',';
      if (s.split(sep).length - 1 > 1) { if (!grouped(s, sep)) return NaN; s = s.split(sep).join(''); }
      else s = s.replace(sep, '.');
    }
    if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return NaN;
    var parts = s.split('.');
    var ip = parts[0] || '0';
    var fp = parts[1] || '';
    var frac = (fp + new Array(scale + 1).join('0')).slice(0, scale);
    var up = fp.length > scale && fp.charAt(scale) >= '5' ? 1 : 0;
    var n = Number(ip + frac) + up;
    if (!isFinite(n) || n > 1e12) return NaN;
    return n;
  };

  // round(a * b / c) for non-negative integers, half up, exact (BigInt).
  U.mulDivRound = function (a, b, c) {
    var A = BigInt(a), B = BigInt(b), C = BigInt(c);
    return Number((A * B * 2n + C) / (2n * C));
  };

  // Deterministic number formatting (no Intl/ICU): the same invoice prints identically on every computer and browser.
  // 'sq-AL' (Albanian-only sheets): 1.234,56   everything else: 1,234.56
  function styleOf(locale) { return /^sq/i.test(locale || '') ? { th: '.', dec: ',' } : { th: ',', dec: '.' }; }
  function group(intStr, th) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, th); }
  // value given as an integer count of 1/10^scale units; shows at least minFrac and at most `scale` decimals
  function fmtScaled(n, scale, minFrac, locale) {
    var st = styleOf(locale), neg = n < 0; n = Math.abs(Math.round(n || 0));
    var str = String(n); while (str.length <= scale) str = '0' + str;
    var ip = str.slice(0, str.length - scale), fp = scale ? str.slice(str.length - scale) : '';
    while (fp.length > minFrac && fp.charAt(fp.length - 1) === '0') fp = fp.slice(0, -1);
    return (neg ? '-' : '') + group(ip, st.th) + (fp ? st.dec + fp : '');
  }
  U.formatMoney = function (cents, currency, locale) {
    var s = fmtScaled(cents || 0, 2, 2, locale);
    return currency ? s + ' ' + currency : s;
  };
  U.formatQty = function (milli, locale) { return fmtScaled(milli || 0, 3, 0, locale); };
  U.formatPercent = function (bp, locale) { return fmtScaled(bp || 0, 2, 0, locale) + '%'; };

  /* ---------- identifiers ---------- */
  U.ibanClean = function (s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); };
  U.ibanFormat = function (s) { return U.ibanClean(s).replace(/(.{4})/g, '$1 ').trim(); };
  U.ibanValid = function (s) {
    s = U.ibanClean(s);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    if (s.slice(0, 2) === 'AL' && s.length !== 28) return false;
    var r = s.slice(4) + s.slice(0, 4), rem = 0;
    for (var i = 0; i < r.length; i++) {
      var c = r.charCodeAt(i);
      var v = c >= 65 ? String(c - 55) : r.charAt(i);
      for (var j = 0; j < v.length; j++) rem = (rem * 10 + (v.charCodeAt(j) - 48)) % 97;
    }
    return rem === 1;
  };
  // Albanian NUIS/NIPT normally looks like K12345678L (letter, 8 digits, letter). Used for a soft warning only.
  U.nuisLooksValid = function (s) { return /^[A-Za-z]\d{8}[A-Za-z]$/.test(String(s || '').trim()); };
  U.emailValid = function (s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim()); };

  /* ---------- CSV ---------- */
  // Prevents spreadsheet formula injection for text cells.
  U.csvCell = function (v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  U.toCsv = function (rows) {
    return '﻿' + rows.map(function (r) { return r.map(U.csvCell).join(','); }).join('\r\n') + '\r\n';
  };
  // Minimal RFC 4180 parser; detects , or ; delimiter from the header line.
  U.parseCsv = function (text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  };

  /* ---------- downloads ---------- */
  U.download = function (filename, mime, content) {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };
  U.safeFilename = function (s) {
    return String(s || 'invoice').replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '') || 'invoice';
  };
})(typeof window !== 'undefined' ? window : globalThis);
