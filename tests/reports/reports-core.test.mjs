import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../../vendor/invoice/util.js');
require('../../vendor/invoice/calc.js');
const R = require('../../reports-core.js');

const order = (o) => ({ id: 1, order_number: 'SC-000001', created_at: '2026-10-05T10:00:00Z', status: 'pending', customer_name: 'Ana', customer_phone: '+355 68 111 2222',
  customer_email: '', items: [{ id: 'p1', name: 'Router', sku: 'R-1', qty: 2, price: 100, currency: 'ALL' }], total: 200, shipping: 0, ...o });

test('orders: cancelled orders are excluded and listed separately', () => {
  const r = R.reportOrders([order({ id: 1 }), order({ id: 2, order_number: 'SC-2', status: 'cancelled', customer_phone: '0681234567' })], {});
  assert.equal(r.counted.length, 1);
  assert.equal(r.excluded.cancelled.length, 1);
  assert.equal(r.totals.ALL.total, 20000);
});

test('orders: same phone+items+total within 10 minutes is a duplicate, counted once; far apart is not', () => {
  const a = order({ id: 1, order_number: 'A' });
  const b = order({ id: 2, order_number: 'B', created_at: '2026-10-05T10:03:00Z' });
  const c = order({ id: 3, order_number: 'C', created_at: '2026-10-05T12:00:00Z' });
  const r = R.reportOrders([c, b, a], {});
  assert.deepEqual(r.counted.map(o => o.number).sort(), ['A', 'C']);
  assert.equal(r.excluded.duplicates[0].number, 'B');
  assert.equal(r.excluded.duplicates[0].duplicateOf, 'A');
  const r2 = R.reportOrders([c, b, a], { includeDuplicates: true });
  assert.equal(r2.counted.length, 3);
});

test('orders: different items or different phone are never duplicates', () => {
  const a = order({ id: 1, order_number: 'A' });
  const b = order({ id: 2, order_number: 'B', created_at: '2026-10-05T10:01:00Z', items: [{ id: 'p2', name: 'Cable', sku: 'C', qty: 2, price: 100, currency: 'ALL' }] });
  const c = order({ id: 3, order_number: 'C', created_at: '2026-10-05T10:02:00Z', customer_phone: '0699999999' });
  assert.equal(R.reportOrders([a, b, c], {}).counted.length, 3);
});

test('orders: a cancelled copy is "cancelled", not also a duplicate; and does not hide the original', () => {
  const a = order({ id: 1, order_number: 'A' });
  const b = order({ id: 2, order_number: 'B', created_at: '2026-10-05T10:01:00Z', status: 'cancelled' });
  const r = R.reportOrders([a, b], {});
  assert.equal(r.counted.length, 1);
  assert.equal(r.excluded.cancelled.length, 1);
  assert.equal(r.excluded.duplicates.length, 0);
});

test('orders: month bucketing uses the Tirana calendar day, not UTC', () => {
  // 23:30 UTC on 30 Sept is 01:30 on 1 Oct in Tirana (UTC+2 in summer)
  const r = R.reportOrders([order({ created_at: '2026-09-30T23:30:00Z' })], {});
  assert.equal(r.months[0].month, '2026-10');
});

test('orders: date range, product and customer filters; product filter sums only matching lines', () => {
  const two = order({ id: 5, order_number: 'X', customer_phone: '0670000000', customer_name: 'Bledi',
    items: [{ id: 'p1', name: 'Router', sku: 'R-1', qty: 1, price: 100, currency: 'ALL' }, { id: 'p9', name: 'Switch', sku: 'S-9', qty: 1, price: 50, currency: 'ALL' }], total: 170, shipping: 20 });
  const old = order({ id: 6, order_number: 'OLD', created_at: '2026-08-01T10:00:00Z', customer_phone: '0671111111' });
  const all = [two, old, order({ id: 7, order_number: 'Z', customer_phone: '0672222222' })];
  assert.equal(R.reportOrders(all, { from: '2026-10-01', to: '2026-10-31' }).counted.length, 2);
  assert.equal(R.reportOrders(all, { customer: 'bled' }).counted.length, 1);
  assert.equal(R.reportOrders(all, { customer: '0670000000' }).counted.length, 1);
  const p = R.reportOrders(all, { product: 'switch' });
  assert.equal(p.counted.length, 1);
  assert.equal(p.totals.ALL.total, 5000);
  assert.equal(p.totals.ALL.shipping, 0);
  const full = R.reportOrders(all, { customer: 'bled' });
  assert.equal(full.totals.ALL.shipping, 2000); // shipping shown separately
  assert.equal(full.totals.ALL.goods, 15000);
});

test('orders: currencies are never mixed', () => {
  const eur = order({ id: 8, order_number: 'E', customer_phone: '0673333333', items: [{ id: 'p1', name: 'R', sku: '', qty: 1, price: 10, currency: 'EUR' }], total: 10 });
  const r = R.reportOrders([order({}), eur], {});
  assert.equal(r.totals.ALL.total, 20000);
  assert.equal(r.totals.EUR.total, 1000);
  assert.equal(r.months.length, 2);
});

test('orders: reports no payment/vat/discount data instead of zero, and flags a total that differs from goods+shipping', () => {
  const r = R.reportOrders([order({ total: 999 })], {});
  assert.deepEqual(r.notRecorded, ['payment', 'vat', 'discount']);
  assert.equal(r.warnings[0].code, 'order_total_mismatch');
  assert.equal(r.totals.ALL.total, 99900); // stored total used as is, flagged
});

test('orders: undated orders are excluded visibly', () => {
  const r = R.reportOrders([order({ created_at: null })], {});
  assert.equal(r.excluded.undated.length, 1);
  assert.equal(r.counted.length, 0);
});

/* ---------- invoices ---------- */
const item = (o) => ({ id: 'i', name: 'Svc', sku: '', qty: '1', unitPrice: '100', discountType: 'percent', discount: '', vatRate: '20', ...o });
const inv = (o) => ({ number: 'INV-2026-0001', status: 'issued', currency: 'ALL', issueDate: '2026-10-02', dueDate: '2026-10-30',
  customer: { name: 'Acme', taxId: 'K12345678L' }, items: [item({})], globalDiscount: { enabled: false }, payments: [], ...o });
const backup = (invoices) => ({ app: 'subcore-invoicing', type: 'backup', version: 1, exportedAt: '2026-10-18T00:00:00Z', settings: {}, catalogue: [], invoices });

test('invoice backup: strict validation', () => {
  assert.equal(R.parseInvoiceBackup('{nope').error, 'not_json');
  assert.equal(R.parseInvoiceBackup(JSON.stringify({ app: 'other', invoices: [] })).error, 'not_invoice_backup');
  assert.equal(R.parseInvoiceBackup(JSON.stringify({ app: 'subcore-invoicing' })).error, 'no_invoices');
  const ok = R.parseInvoiceBackup(JSON.stringify(backup([inv({}), { number: '', status: 'issued' }, inv({ status: 'weird', number: 'X' })])));
  assert.equal(ok.ok, true); assert.equal(ok.invoices.length, 1); assert.equal(ok.skipped, 2);
});

test('invoices: invoiced vs received vs outstanding, VAT and discount come from the original calc engine', () => {
  const r = R.reportInvoices([
    inv({ number: 'A1', payments: [{ date: '2026-10-05', method: 'cash', amount: '40' }], items: [item({ unitPrice: '100', discount: '10' })] }),
    inv({ number: 'A2', issueDate: '2026-10-10', items: [item({ unitPrice: '50', vatRate: '0' })], payments: [{ date: '2026-10-11', amount: '50' }] })
  ], { today: '2026-10-18' });
  const t = r.totals.ALL;
  // A1: 100 - 10% = 90 net, VAT 18, total 108, paid 40, outstanding 68 ; A2: 50, vat 0, paid 50
  assert.equal(t.net, 9000 + 5000);
  assert.equal(t.vat, 1800);
  assert.equal(t.invoiced, 10800 + 5000);
  assert.equal(t.discount, 1000);
  assert.equal(t.received, 4000 + 5000);
  assert.equal(t.outstanding, 6800);
  assert.equal(t.count, 2);
  assert.equal(r.counted.find(n => n.rawNumber === 'A2').status, 'paid');
});

test('invoices: cancelled and draft are excluded, duplicate numbers counted once, case-insensitive', () => {
  const r = R.reportInvoices([
    inv({ number: 'B1' }), inv({ number: ' b1 ', issueDate: '2026-10-03' }), inv({ number: 'B2', status: 'cancelled' }), inv({ number: 'B3', status: 'draft' })
  ], { today: '2026-10-18' });
  assert.equal(r.counted.length, 1);
  assert.equal(r.excluded.duplicates.length, 1);
  assert.equal(r.excluded.cancelled.length, 1);
  assert.equal(r.excluded.drafts.length, 1);
  assert.equal(r.totals.ALL.count, 1);
});

test('invoices: a correction/credit document is not added to sales', () => {
  const r = R.reportInvoices([inv({ number: 'C1' }), inv({ number: 'C2', correctionOf: 'C1' }), inv({ number: 'C3', type: 'Credit note' })], { today: '2026-10-18' });
  assert.equal(r.counted.length, 1);
  assert.equal(r.excluded.corrections.length, 2);
});

test('invoices: overdue is outstanding AND overdue; overpayment is a warning, never negative debt', () => {
  const r = R.reportInvoices([
    inv({ number: 'D1', dueDate: '2026-10-05' }),
    inv({ number: 'D2', issueDate: '2026-10-04', payments: [{ date: '2026-10-04', amount: '500' }] })
  ], { today: '2026-10-18' });
  assert.equal(r.counted.find(n => n.rawNumber === 'D1').status, 'overdue');
  assert.equal(r.totals.ALL.overdue, 12000);
  assert.equal(r.totals.ALL.outstanding, 12000);
  assert.ok(r.warnings.some(w => w.code === 'invoice_overpaid'));
});

test('invoices: unset VAT is flagged, filters by customer / product / status / dates / currency', () => {
  const rows = [
    inv({ number: 'E1', items: [item({ vatRate: '' })] }),
    inv({ number: 'E2', currency: 'EUR', customer: { name: 'Beta' }, items: [item({ name: 'Hosting', sku: 'H1' })], payments: [{ date: '2026-10-02', amount: '120' }] }),
    inv({ number: 'E3', issueDate: '2026-09-15' })
  ];
  const all = R.reportInvoices(rows, { today: '2026-10-18' });
  assert.ok(all.warnings.some(w => w.code === 'invoice_vat_unset' && w.ref === 'E1'));
  assert.equal(all.months.length, 3);
  assert.equal(R.reportInvoices(rows, { today: '2026-10-18', customer: 'beta' }).counted.length, 1);
  assert.equal(R.reportInvoices(rows, { today: '2026-10-18', product: 'hosting' }).counted.length, 1);
  assert.equal(R.reportInvoices(rows, { today: '2026-10-18', status: 'paid' }).counted.length, 1);
  assert.equal(R.reportInvoices(rows, { today: '2026-10-18', from: '2026-10-01' }).counted.length, 2);
  assert.equal(all.totals.EUR.invoiced, 12000);
});

/* ---------- purchases ---------- */
const pur = (o) => ({ id: 1, supplier: 'ACME Ltd', doc_number: 'F-100', doc_date: '2026-10-03', currency: 'ALL', net_amount: 1000, vat_amount: 200, total_amount: 1200, paid_amount: 500, paid_date: '2026-10-04', voided: false, note: 'routers', ...o });

test('purchases: recorded vs paid vs outstanding; voided and duplicate (same supplier+number) excluded', () => {
  const r = R.reportPurchases([pur({ id: 1 }), pur({ id: 2, doc_date: '2026-10-04' }), pur({ id: 3, doc_number: 'F-101', voided: true }), pur({ id: 4, doc_number: 'F-102', supplier: 'Other', total_amount: 100, net_amount: 100, vat_amount: 0, paid_amount: 100 })], {});
  assert.equal(r.counted.length, 2);
  assert.equal(r.excluded.voided.length, 1);
  assert.equal(r.excluded.duplicates.length, 1);
  assert.equal(r.totals.ALL.total, 120000 + 10000);
  assert.equal(r.totals.ALL.paid, 50000 + 10000);
  assert.equal(r.totals.ALL.outstanding, 70000);
});

test('purchases: same document number from DIFFERENT suppliers is not a duplicate; supplier filter works', () => {
  const rows = [pur({ id: 1 }), pur({ id: 2, supplier: 'Beta' })];
  assert.equal(R.reportPurchases(rows, {}).counted.length, 2);
  assert.equal(R.reportPurchases(rows, { supplier: 'beta' }).counted.length, 1);
});

test('purchases: unknown VAT is counted as unknown, not zero; mismatches and overpayment are warnings', () => {
  const r = R.reportPurchases([pur({ vat_amount: null, net_amount: null }), pur({ id: 2, doc_number: 'F-2', paid_amount: 5000 }), pur({ id: 3, doc_number: 'F-3', net_amount: 1000, vat_amount: 100 })], {});
  assert.equal(r.totals.ALL.vatUnknownCount, 1);
  const codes = r.warnings.map(w => w.code);
  assert.ok(codes.includes('purchase_overpaid')); assert.ok(codes.includes('purchase_total_mismatch'));
});

/* ---------- comparison ---------- */
test('comparison is never labelled profit and stays per currency', () => {
  const s = { ALL: { invoiced: 10000 }, EUR: { invoiced: 500 } }, p = { ALL: { total: 4000 } };
  const c = R.compareRecorded(s, p, 'invoiced', 'total');
  assert.equal(c.isProfit, false);
  assert.equal(c.label, 'difference_of_recorded_documents');
  assert.equal(c.perCurrency.ALL.difference, 6000);
  assert.equal(c.perCurrency.EUR.difference, 500);
  assert.ok(c.caveats.includes('not_accounting_profit'));
  assert.ok(!JSON.stringify(c).toLowerCase().includes('"profit"'));
});

/* ---------- export ---------- */
test('CSV: formula injection guarded, plain decimals, no thousands separators', () => {
  const r = R.reportInvoices([inv({ number: '=HYPERLINK("x")', customer: { name: '+cmd|x' }, items: [item({ unitPrice: '1234.5' })] })], { today: '2026-10-18' });
  const csv = R.toCsv(r);
  assert.ok(csv.includes(`'=HYPERLINK`));
  assert.ok(csv.includes(`'+cmd|x`));
  assert.ok(csv.includes('1481.40'));
  assert.ok(!csv.includes('1,481'));
});

test('Tirana date rule: winter UTC+1, summer UTC+2, switch days', () => {
  assert.equal(R.tiranaDate('2026-12-31T23:30:00Z'), '2027-01-01');
  assert.equal(R.tiranaDate('2026-12-31T22:30:00Z'), '2026-12-31');
  assert.equal(R.tiranaDate('2026-07-31T22:30:00Z'), '2026-08-01');
  assert.equal(R.tiranaDate('2026-03-29T00:30:00Z'), '2026-03-29'); // before the switch (still UTC+1)
  assert.equal(R.tiranaDate('2026-03-28T23:30:00Z'), '2026-03-29');
  assert.equal(R.tiranaDate('2026-10-25T00:30:00Z'), '2026-10-25'); // still summer time
  assert.equal(R.tiranaDate('2026-10-25T23:30:00Z'), '2026-10-26'); // winter time, UTC+1
  assert.equal(R.tiranaDate('garbage'), null);
});

test('invoices: the invoice app\'s demo/sample invoices are never counted', () => {
  const r = R.reportInvoices([inv({ number: 'DEMO-0001', demo: true }), inv({ number: 'REAL-1' })], { today: '2026-10-18' });
  assert.equal(r.counted.length, 1); assert.equal(r.counted[0].rawNumber, 'REAL-1');
  assert.equal(r.excluded.demo.length, 1); assert.equal(r.totals.ALL.count, 1);
});
