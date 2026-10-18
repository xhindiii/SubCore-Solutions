/* Run with:  node tests/calc.test.js   (no dependencies) */
'use strict';
const assert = require('node:assert/strict');
require('../../vendor/invoice/util.js');
require('../../vendor/invoice/calc.js');
require('../../vendor/invoice/numbering.js');
const SC = globalThis.SC, U = SC.util, C = SC.calc, N = SC.numbering;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const item = (o) => Object.assign({ id: 'x', name: 'Item', qty: '1', unitPrice: '0', discountType: 'percent', discount: '', vatRate: '0' }, o);
const inv = (items, extra) => Object.assign({ items, currency: 'ALL', payments: [], globalDiscount: { enabled: false, type: 'percent', value: '' } }, extra);

console.log('parseScaled');
test('plain, comma and thousands formats', () => {
  assert.equal(U.parseScaled('12.5', 2), 1250);
  assert.equal(U.parseScaled('12,5', 2), 1250);
  assert.equal(U.parseScaled('1.234,56', 2), 123456);
  assert.equal(U.parseScaled('1,234.56', 2), 123456);
  assert.equal(U.parseScaled('1.234.567', 2), 123456700);
  assert.equal(U.parseScaled('  7 ', 2), 700);
  assert.equal(U.parseScaled('1.5', 3), 1500);
});
test('malformed thousands separators are rejected, not guessed', () => {
  for (const bad of ['1,2,3', '12,34,567', '1.23.456', '1,23.4', '1.5,3', '1,234,56', '1.2.3']) assert.ok(Number.isNaN(U.parseScaled(bad, 2)), bad);
  assert.equal(U.parseScaled('1,234,567.89', 2), 123456789);
  assert.equal(U.parseScaled('12.345.678,9', 2), 1234567890);
});
test('deterministic number formatting (en and Albanian styles)', () => {
  assert.equal(U.formatMoney(148867, 'ALL', 'en-GB'), '1,488.67 ALL');
  assert.equal(U.formatMoney(0, '', 'en-GB'), '0.00');
  assert.equal(U.formatMoney(5, 'EUR'), '0.05 EUR');
  assert.equal(U.formatMoney(-1, 'ALL'), '-0.01 ALL');
  assert.equal(U.formatMoney(123456789012, 'USD'), '1,234,567,890.12 USD');
  assert.equal(U.formatMoney(148867, 'ALL', 'sq-AL'), '1.488,67 ALL');
  assert.equal(U.formatMoney(100000000, 'CHF', 'sq-AL'), '1.000.000,00 CHF');
  assert.equal(U.formatQty(1500, 'en-GB'), '1.5'); assert.equal(U.formatQty(1500, 'sq-AL'), '1,5'); assert.equal(U.formatQty(3000), '3'); assert.equal(U.formatQty(1234567), '1,234.567');
  assert.equal(U.formatPercent(2000), '20%'); assert.equal(U.formatPercent(750, 'sq-AL'), '7,5%'); assert.equal(U.formatPercent(750), '7.5%');
});
test('half-up rounding beyond the scale', () => {
  assert.equal(U.parseScaled('0.335', 2), 34);
  assert.equal(U.parseScaled('0.334', 2), 33);
  assert.equal(U.parseScaled('1.005', 2), 101);
});
test('empty -> null, invalid/negative -> NaN', () => {
  assert.equal(U.parseScaled('', 2), null);
  assert.equal(U.parseScaled('   ', 2), null);
  assert.ok(Number.isNaN(U.parseScaled('abc', 2)));
  assert.ok(Number.isNaN(U.parseScaled('-5', 2)));
  assert.ok(Number.isNaN(U.parseScaled('1.2.3,4.5', 2)));
  assert.ok(Number.isNaN(U.parseScaled('.', 2)));
});

console.log('calculations');
test('single line with VAT', () => {
  const c = C.compute(inv([item({ qty: '2', unitPrice: '10.00', vatRate: '20' })]));
  assert.equal(c.subtotal, 2000);
  assert.equal(c.taxable, 2000);
  assert.equal(c.vatTotal, 400);
  assert.equal(c.total, 2400);
  assert.equal(c.balance, 2400);
});
test('fractional hours and line rounding', () => {
  const c = C.compute(inv([item({ qty: '1.5', unitPrice: '33.33', vatRate: '0' })]));
  assert.equal(c.lines[0].gross, 5000); // 49.995 -> 50.00
});
test('percent line discount rounds half up', () => {
  const c = C.compute(inv([item({ qty: '1', unitPrice: '19.99', discount: '10', vatRate: '0' })]));
  assert.equal(c.lines[0].discount, 200); // 1.999 -> 2.00
  assert.equal(c.total, 1799);
});
test('fixed-amount line discount is capped at gross and flagged', () => {
  const c = C.compute(inv([item({ unitPrice: '10', discountType: 'amount', discount: '25', vatRate: '0' })]));
  assert.equal(c.lines[0].net, 0);
  assert.ok(c.issues.some(i => i.code === 'range'));
});
test('VAT is computed per rate group, not per line', () => {
  const c = C.compute(inv([item({ unitPrice: '3.33', vatRate: '20' }), item({ unitPrice: '3.33', vatRate: '20' })]));
  assert.equal(c.vatGroups.length, 1);
  assert.equal(c.vatGroups[0].base, 666);
  assert.equal(c.vatTotal, 133); // 133.2 -> 133 (per-line rounding would give 134)
});
test('mixed rates produce separate groups sorted by rate', () => {
  const c = C.compute(inv([item({ unitPrice: '100', vatRate: '20' }), item({ unitPrice: '100', vatRate: '0' }), item({ unitPrice: '100', vatRate: '6' })]));
  assert.deepEqual(c.vatGroups.map(g => g.bp), [0, 600, 2000]);
  assert.equal(c.vatTotal, 2600);
  assert.equal(c.total, 32600);
});
test('invoice-wide percent discount is allocated exactly', () => {
  const c = C.compute(inv(
    [item({ unitPrice: '33.33', vatRate: '20' }), item({ unitPrice: '33.33', vatRate: '20' }), item({ unitPrice: '33.34', vatRate: '0' })],
    { globalDiscount: { enabled: true, type: 'percent', value: '10' } }));
  assert.equal(c.netAfterLineDiscount, 10000);
  assert.equal(c.globalDiscount, 1000);
  assert.equal(c.lines.reduce((a, l) => a + l.globalShare, 0), 1000);
  assert.equal(c.lines.reduce((a, l) => a + l.base, 0), c.taxable);
  assert.equal(c.taxable, 9000);
});
test('invoice-wide fixed discount, shares always sum to the discount', () => {
  for (const g of ['0.01', '1', '33.33', '99.99', '100']) {
    const c = C.compute(inv([item({ unitPrice: '10', vatRate: '20' }), item({ unitPrice: '30', vatRate: '6' }), item({ unitPrice: '60', vatRate: '0' })],
      { globalDiscount: { enabled: true, type: 'amount', value: g } }));
    assert.equal(c.lines.reduce((a, l) => a + l.globalShare, 0), c.globalDiscount, 'discount ' + g);
    assert.equal(c.taxable, 10000 - c.globalDiscount);
  }
});
test('disabled invoice discount is ignored', () => {
  const c = C.compute(inv([item({ unitPrice: '10' })], { globalDiscount: { enabled: false, type: 'percent', value: '50' } }));
  assert.equal(c.globalDiscount, 0);
});
test('VAT is never assumed: empty rate is flagged as unset and counts as 0', () => {
  const c = C.compute(inv([item({ unitPrice: '100', vatRate: '' })]));
  assert.equal(c.unsetVatCount, 1);
  assert.equal(c.vatTotal, 0);
  assert.ok(c.issues.some(i => i.code === 'unset'));
  assert.equal(c.vatGroups[0].bp, null);
});
test('0% VAT is a valid explicit choice (not flagged)', () => {
  const c = C.compute(inv([item({ unitPrice: '100', vatRate: '0' })]));
  assert.equal(c.unsetVatCount, 0);
});
test('invalid numbers are reported, not silently used', () => {
  const c = C.compute(inv([item({ qty: 'abc', unitPrice: '1x' })]));
  assert.ok(c.issues.some(i => i.path === 'items.0.qty' && i.code === 'invalid'));
  assert.ok(c.issues.some(i => i.path === 'items.0.unitPrice' && i.code === 'invalid'));
});
test('large values stay exact (BigInt path)', () => {
  const c = C.compute(inv([item({ qty: '999999', unitPrice: '9999999.99', vatRate: '20' })]));
  assert.equal(c.subtotal, U.mulDivRound(999999000, 999999999, 1000));
  assert.equal(c.total, c.taxable + c.vatTotal);
});

console.log('payments and status');
test('partial and full payments, balance and status', () => {
  const base = inv([item({ unitPrice: '100', vatRate: '20' })], { status: 'issued', dueDate: '2026-12-31' });
  let c = C.compute(base);
  assert.equal(C.derivedStatus(base, c, '2026-10-18'), 'issued');
  base.payments = [{ amount: '40', date: '2026-10-18', method: 'cash' }];
  c = C.compute(base);
  assert.equal(c.paid, 4000); assert.equal(c.balance, 8000);
  assert.equal(C.derivedStatus(base, c, '2026-10-18'), 'partial');
  base.payments.push({ amount: '80', date: '2026-10-19', method: 'bank' });
  c = C.compute(base);
  assert.equal(c.balance, 0);
  assert.equal(C.derivedStatus(base, c, '2026-10-20'), 'paid');
});
test('overdue only when unpaid balance and past due; draft/cancelled never overdue', () => {
  const base = inv([item({ unitPrice: '100' })], { status: 'issued', dueDate: '2026-10-01' });
  let c = C.compute(base);
  assert.equal(C.derivedStatus(base, c, '2026-10-18'), 'overdue');
  base.status = 'draft'; assert.equal(C.derivedStatus(base, c, '2026-10-18'), 'draft');
  base.status = 'cancelled'; assert.equal(C.derivedStatus(base, c, '2026-10-18'), 'cancelled');
});
test('overpayment is detected', () => {
  const base = inv([item({ unitPrice: '10' })], { payments: [{ amount: '50', date: '2026-10-18' }] });
  const c = C.compute(base);
  assert.ok(c.overpaid); assert.equal(c.balance, -4000);
});

console.log('validation');
test('issue mode demands customer, item names, qty, vat, due date', () => {
  const base = inv([item({ name: '', qty: '0', vatRate: '' })], { number: 'INV-1', issueDate: '2026-10-18', dueDate: '', customer: { name: '' }, seller: {} });
  const v = C.validate(base, C.compute(base), { mode: 'issue', existingNumbers: new Set() });
  const paths = v.errors.map(e => e.path + ':' + e.code);
  for (const p of ['customer.name:required', 'items.0.name:required', 'items.0.qty:zero', 'items.0.vatRate:unset', 'dueDate:required'])
    assert.ok(paths.includes(p), 'missing ' + p + ' in ' + paths.join(','));
});
test('save mode only blocks hard problems', () => {
  const base = inv([item({ name: '', vatRate: '' })], { number: 'INV-1', issueDate: '2026-10-18', customer: { name: '' }, seller: {} });
  const v = C.validate(base, C.compute(base), { mode: 'save', existingNumbers: new Set() });
  assert.equal(v.errors.length, 0);
});
test('duplicate number is blocked (case-insensitive)', () => {
  const base = inv([item({})], { number: ' inv-2026-0001 ', issueDate: '2026-10-18', customer: { name: 'A' }, seller: {} });
  const v = C.validate(base, C.compute(base), { mode: 'save', existingNumbers: new Set(['INV-2026-0001']) });
  assert.ok(v.errors.some(e => e.path === 'number' && e.code === 'duplicate'));
});
test('due date before issue date is an error', () => {
  const base = inv([item({})], { number: 'A', issueDate: '2026-10-18', dueDate: '2026-10-01', customer: { name: 'A' }, seller: {} });
  assert.ok(C.validate(base, C.compute(base), { mode: 'save', existingNumbers: new Set() }).errors.some(e => e.code === 'beforeIssue'));
});
test('IBAN / NUIS / email helpers', () => {
  assert.ok(U.ibanValid('AL47 2121 1009 0000 0002 3569 8741'));
  assert.ok(!U.ibanValid('AL47 2121 1009 0000 0002 3569 8742'));
  assert.ok(!U.ibanValid('AL47 2121'));
  assert.ok(U.nuisLooksValid('K12345678L'));
  assert.ok(!U.nuisLooksValid('12345'));
  assert.ok(U.emailValid('a@b.co')); assert.ok(!U.emailValid('a@b'));
});

console.log('numbering');
test('format with prefix, year and padding', () => {
  const cfg = N.defaults();
  assert.equal(N.format(cfg, 7, 2026), 'INV-2026-0007');
  assert.equal(N.format({ ...cfg, includeYear: false, padding: 3 }, 7, 2026), 'INV-007');
  assert.equal(N.format({ ...cfg, prefix: '', separator: '/' }, 12, 2026), '2026/0012');
});
test('next skips numbers already used and commit moves the counter forward only', () => {
  let cfg = N.defaults();
  const used = new Set(['INV-2026-0001', 'INV-2026-0002']);
  const n = N.next(cfg, '2026-10-18', used);
  assert.equal(n.number, 'INV-2026-0003');
  cfg = N.commit(cfg, 'INV-2026-0003', '2026-10-18');
  assert.equal(cfg.next, 4);
  const back = N.commit(cfg, 'INV-2026-0002', '2026-10-18');
  assert.equal(back.next, 4); // never goes backwards
  assert.equal(N.commit(cfg, 'CUSTOM-ABC', '2026-10-18').next, 4); // non-matching manual numbers leave the counter alone
});
test('yearly reset starts a new year at 1', () => {
  let cfg = N.commit(N.defaults(), 'INV-2026-0009', '2026-12-30');
  assert.equal(cfg.next, 10);
  const n = N.next(cfg, '2027-01-02', new Set());
  assert.equal(n.number, 'INV-2027-0001');
  cfg = N.commit(cfg, n.number, '2027-01-02');
  assert.equal(cfg.next, 2); assert.equal(cfg.lastYear, 2027);
});

console.log('csv');
test('csv escaping and formula-injection guard', () => {
  assert.equal(U.csvCell('a,b'), '"a,b"');
  assert.equal(U.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(U.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(U.csvCell(-5), '-5');
  const rows = U.parseCsv('name;price\n"A;B";10,5\nC;3\n');
  assert.deepEqual(rows, [['name', 'price'], ['A;B', '10,5'], ['C', '3']]);
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' — WITH FAILURES' : ''));
