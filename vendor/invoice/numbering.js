/* Invoice numbering: prefix + optional year + zero-padded sequence.
   The counter only ever moves forward when an invoice is saved; saved invoices are never renumbered. */
(function (root) {
  'use strict';
  var SC = (root.SC = root.SC || {});
  var U = SC.util;
  var N = (SC.numbering = {});

  N.defaults = function () {
    return { prefix: 'INV', separator: '-', includeYear: true, resetYearly: true, padding: 4, next: 1, lastYear: null };
  };

  N.format = function (cfg, seq, year) {
    var parts = [];
    if (cfg.prefix) parts.push(cfg.prefix);
    if (cfg.includeYear) parts.push(String(year));
    parts.push(String(seq).padStart(Math.max(1, Number(cfg.padding) || 1), '0'));
    return parts.join(cfg.separator || '');
  };

  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Suggests the next free number for a given issue date. existing = Set of normalised numbers already used.
  N.next = function (cfg, issueDate, existing) {
    var year = U.yearOf(issueDate) || new Date().getFullYear();
    var seq = Math.max(1, parseInt(cfg.next, 10) || 1);
    if (cfg.includeYear && cfg.resetYearly && cfg.lastYear && cfg.lastYear !== year) seq = 1;
    var guard = 0;
    while (existing && existing.has(String(N.format(cfg, seq, year)).trim().toUpperCase()) && guard++ < 100000) seq++;
    return { number: N.format(cfg, seq, year), seq: seq, year: year };
  };

  // After saving an invoice with this number, advance the counter so it is never offered again.
  N.commit = function (cfg, number, issueDate) {
    var year = U.yearOf(issueDate) || new Date().getFullYear();
    var re = new RegExp('^' + esc(cfg.prefix || '') + (cfg.prefix ? esc(cfg.separator || '') : '') +
      (cfg.includeYear ? esc(year) + esc(cfg.separator || '') : '') + '(\\d+)$', 'i');
    var m = re.exec(String(number || '').trim());
    var out = U.clone(cfg);
    if (!m) return out;
    var seq = parseInt(m[1], 10);
    if (cfg.includeYear && cfg.resetYearly && cfg.lastYear !== year) { out.next = seq + 1; out.lastYear = year; }
    else if (seq >= (parseInt(cfg.next, 10) || 1)) { out.next = seq + 1; out.lastYear = year; }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = N;
})(typeof window !== 'undefined' ? window : globalThis);
