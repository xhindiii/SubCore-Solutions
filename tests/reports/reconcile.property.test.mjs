// Phase 9 — reconciliation: report totals must equal the underlying records, for many randomly generated
// data sets (fixed seeds, so failures are reproducible). Run: node --test tests/reports/reconcile.property.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../vendor/invoice/util.js');
require('../../vendor/invoice/calc.js');
const R = require('../../reports-core.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const minor = (x) => Math.round(x * 100);
const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const CURS = ['ALL', 'EUR'];
const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i);

// Independent oracle for the Tirana calendar month (Berlin has identical DST rules to Tirana).
const oracleMonth = (iso) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); return p.slice(0, 7); };
// Timestamps that sit next to month boundaries and DST switches on purpose.
const EDGE_TS = ['2026-03-31T22:30:00Z', '2026-03-31T21:59:59Z', '2026-10-31T22:59:59Z', '2026-10-31T23:00:00Z', '2026-10-31T23:30:00Z', '2026-03-29T00:30:00Z', '2026-10-25T00:30:00Z', '2026-11-30T23:30:00Z', '2026-12-31T23:30:00Z', '2026-06-30T22:00:00Z', '2026-06-30T21:59:00Z'];
const ts = (r) => r() < 0.3 ? pick(r, EDGE_TS) : new Date(Date.UTC(2026, int(r, 0, 11), int(r, 1, 28), int(r, 0, 23), int(r, 0, 59))).toISOString();

function genOrders(r, n) {
  return Array.from({ length: n }, (_, i) => {
    const cur = pick(r, CURS), lines = int(r, 1, 3);
    const items = Array.from({ length: lines }, (_, k) => ({ id: 'p' + int(r, 1, 40), name: 'item' + k, sku: 'S' + k, qty: int(r, 1, 4), price: minor(int(r, 100, 90000) / 100) / 100, currency: cur }));
    const goods = items.reduce((s, it) => s + Math.round(it.price * 100) * it.qty, 0);
    const shipping = r() < 0.3 ? int(r, 100, 800) : 0;
    return { id: i + 1, order_number: 'SC-' + (i + 1), created_at: ts(r), status: pick(r, ['pending', 'processing', 'completed', 'cancelled']),
      customer_name: 'C' + i, customer_phone: '06' + String(10000000 + i * 7919).slice(0, 8), customer_email: '', items, total: (goods + shipping) / 100, shipping: shipping / 100 };
  });
}

test('orders: counted + excluded = input; totals = sum of counted rows; months = totals; cancelled never counted (60 seeds)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), orders = genOrders(r, int(r, 1, 80));
    const rep = R.reportOrders(orders, {});
    const ex = rep.excluded;
    assert.equal(rep.counted.length + ex.cancelled.length + ex.duplicates.length + (ex.undated || []).length, orders.length, 'seed ' + seed + ': every record is counted or listed as excluded');
    assert.equal(rep.counted.length, orders.filter((o) => o.status !== 'cancelled').length, 'seed ' + seed + ': unique phones => only cancelled are excluded');
    assert.ok(rep.counted.every((o) => o.status !== 'cancelled'), 'seed ' + seed);
    for (const c of Object.keys(rep.totals)) {
      const rows = rep.counted.filter((o) => o.currency === c);
      assert.equal(rep.totals[c].total, sumBy(rows, (o) => o.total), 'seed ' + seed + ' ' + c + ': total = sum of rows');
      assert.equal(rep.totals[c].count, rows.length);
      assert.equal(rep.totals[c].total, rep.totals[c].goods + rep.totals[c].shipping, 'seed ' + seed + ': total = goods + shipping');
      const ms = rep.months.filter((m) => m.currency === c);
      assert.equal(sumBy(ms, (m) => m.total), rep.totals[c].total, 'seed ' + seed + ' ' + c + ': months add up to total');
      assert.equal(sumBy(ms, (m) => m.count), rep.totals[c].count);
    }
    // each row sits in the month an independent calendar says it belongs to
    for (const m of rep.months) {
      const expect = sumBy(rep.counted.filter((o) => o.currency === m.currency && oracleMonth(o.createdAt) === m.month), (o) => o.total);
      assert.equal(m.total, expect, 'seed ' + seed + ' ' + m.month + ': month assignment matches an independent calendar');
    }
    // currencies are never mixed
    assert.deepEqual(Object.keys(rep.totals).sort(), [...new Set(rep.counted.map((o) => o.currency))].sort());
  }
});

test('orders: a date-range filter only removes rows, never changes the others (60 seeds)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), orders = genOrders(r, 40);
    const all = R.reportOrders(orders, {}), part = R.reportOrders(orders, { from: '2026-04-01', to: '2026-09-30' });
    const inRange = all.counted.filter((o) => o.date >= '2026-04-01' && o.date <= '2026-09-30');
    assert.deepEqual(part.counted.map((o) => o.id).sort((a, b) => a - b), inRange.map((o) => o.id).sort((a, b) => a - b), 'seed ' + seed);
    for (const c of Object.keys(part.totals)) assert.equal(part.totals[c].total, sumBy(inRange.filter((o) => o.currency === c), (o) => o.total));
  }
});

test('orders: re-submitting the same order inside 10 minutes counts once; the copies are listed, totals unchanged (60 seeds)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), base = genOrders(r, 25).filter((o) => o.status !== 'cancelled' && !EDGE_TS.includes(o.created_at));
    const dup = base.slice(0, 5).map((o, i) => ({ ...o, id: 1000 + i, order_number: 'DUP-' + i, created_at: new Date(Date.parse(o.created_at) + 120000).toISOString() }));
    const a = R.reportOrders(base, {}), b = R.reportOrders(base.concat(dup), {});
    for (const c of Object.keys(a.totals)) assert.equal(b.totals[c].total, a.totals[c].total, 'seed ' + seed + ': duplicates do not inflate ' + c);
    assert.equal(b.excluded.duplicates.length, dup.length, 'seed ' + seed);
  }
});

function genPurchases(r, n) {
  return Array.from({ length: n }, (_, i) => {
    const net = int(r, 1000, 900000), vat = r() < 0.7 ? Math.round(net * 0.2) : 0, total = net + vat;
    const paid = pick(r, [0, 0, total, Math.floor(total / 2)]);
    return { id: 'u' + i, supplier: 'Sup' + int(r, 1, 6), doc_number: 'D' + i, doc_date: new Date(Date.UTC(2026, int(r, 0, 11), int(r, 1, 28))).toISOString().slice(0, 10), currency: pick(r, CURS),
      net_amount: net / 100, vat_amount: vat / 100, total_amount: total / 100, paid_amount: paid / 100, paid_date: paid ? '2026-12-01' : null, voided: r() < 0.15, void_reason: 'x' };
  });
}
test('purchases: voided excluded; totals/paid/outstanding/vat reconcile with rows; outstanding = total - paid (60 seeds)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), rows = genPurchases(r, int(r, 1, 60));
    const rep = R.reportPurchases(rows, {});
    assert.equal(rep.counted.length + rep.excluded.voided.length + rep.excluded.duplicates.length + (rep.excluded.undated || []).length, rows.length, 'seed ' + seed);
    assert.equal(rep.counted.length, rows.filter((p) => !p.voided).length);
    for (const c of Object.keys(rep.totals)) {
      const mine = rep.counted.filter((p) => p.currency === c), t = rep.totals[c];
      assert.equal(t.total, sumBy(mine, (p) => p.total)); assert.equal(t.paid, sumBy(mine, (p) => p.paid)); assert.equal(t.vat, sumBy(mine, (p) => p.vat));
      assert.equal(t.outstanding, t.total - t.paid, 'seed ' + seed + ' ' + c + ': outstanding = total - paid');
      assert.equal(sumBy(rep.months.filter((m) => m.currency === c), (m) => m.total), t.total, 'seed ' + seed + ': months add up');
      assert.equal(sumBy(rep.months.filter((m) => m.currency === c), (m) => m.outstanding), t.outstanding);
    }
  }
});

const item = (r) => ({ name: 'Item ' + int(r, 1, 9), sku: 'K' + int(r, 1, 9), qty: int(r, 1, 5), unitPrice: int(r, 100, 50000) / 100, vatRate: pick(r, [0, 6, 20]), discount: { type: 'percent', value: pick(r, [0, 0, 10]) } });
function genInvoices(r, n) {
  return Array.from({ length: n }, (_, i) => {
    const items = Array.from({ length: int(r, 1, 3) }, () => item(r));
    const status = pick(r, ['issued', 'issued', 'issued', 'paid', 'draft', 'cancelled']);
    return { number: 'INV-' + (i + 1), status, currency: pick(r, CURS), issueDate: new Date(Date.UTC(2026, int(r, 0, 9), int(r, 1, 28))).toISOString().slice(0, 10), dueDate: '2026-12-31',
      customer: { name: 'Cust' + int(r, 1, 5) }, items, globalDiscount: { enabled: false }, payments: [] };
  });
}
test('invoices: counted + excluded = input; invoiced = net + VAT; received + outstanding = invoiced; months add up (60 seeds)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), invs = genInvoices(r, int(r, 1, 50));
    const rep = R.reportInvoices(invs, { today: '2026-12-31' });
    const ex = rep.excluded;
    assert.equal(rep.counted.length + ex.demo.length + ex.cancelled.length + ex.drafts.length + ex.duplicates.length + ex.corrections.length, invs.length, 'seed ' + seed + ': every invoice is counted or listed');
    assert.equal(ex.drafts.length, invs.filter((i) => i.status === 'draft').length); assert.equal(ex.cancelled.length, invs.filter((i) => i.status === 'cancelled').length);
    for (const c of Object.keys(rep.totals)) {
      const t = rep.totals[c], mine = rep.counted.filter((n) => n.currency === c);
      assert.equal(t.count, mine.length);
      assert.equal(t.invoiced, t.net + t.vat, 'seed ' + seed + ' ' + c + ': invoiced = net + VAT');
      assert.equal(t.invoiced, sumBy(mine, (n) => n.calc.total), 'seed ' + seed + ': invoiced = sum of the invoices\' own totals');
      assert.equal(t.received + t.outstanding, t.invoiced, 'seed ' + seed + ': received + outstanding = invoiced (no overpayments in this data)');
      for (const f of ['count', 'net', 'vat', 'invoiced', 'received', 'outstanding', 'discount']) assert.equal(sumBy(rep.months.filter((m) => m.currency === c), (m) => m[f] || 0), t[f] || 0, 'seed ' + seed + ' ' + c + ' ' + f + ': months add up');
    }
  }
});

test('invoices: recorded payments move money from outstanding to received without changing the invoiced total (60 seeds)', () => {
  for (const seed of SEEDS) {
    const r = rng(seed), invs = genInvoices(r, 20).filter((i) => i.status === 'issued');
    const before = R.reportInvoices(invs, { today: '2026-12-31' });
    const paidSome = invs.map((i, k) => k % 2 ? { ...i, payments: [{ date: '2026-11-01', amount: 1, method: 'bank' }] } : i);
    const after = R.reportInvoices(paidSome, { today: '2026-12-31' });
    for (const c of Object.keys(before.totals)) {
      assert.equal(after.totals[c].invoiced, before.totals[c].invoiced, 'seed ' + seed);
      assert.equal(after.totals[c].received + after.totals[c].outstanding, after.totals[c].invoiced);
      assert.ok(after.totals[c].received >= before.totals[c].received);
    }
  }
});
