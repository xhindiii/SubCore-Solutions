import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../../promo-render.js');

test('price parsing: separators, thousands vs decimals, invalid input', () => {
  const t = (s) => P.parsePrice(s);
  assert.equal(t('12500'), 1250000);
  assert.equal(t('12 500'), 1250000);
  assert.equal(t('12.500,50'), 1250050);
  assert.equal(t('12,500.50'), 1250050);
  assert.equal(t('1.500'), 150000);   // thousands
  assert.equal(t('1,5'), 150);        // decimal
  assert.equal(t('12.75'), 1275);
  assert.equal(t(''), null);
  assert.equal(t(null), null);
  for (const bad of ['abc', '1,2,3', '-5', '12e3', '1..2', '$5']) assert.ok(Number.isNaN(t(bad)), bad);
});

test('price formatting per language and currency', () => {
  assert.equal(P.formatPrice(1250000, 'ALL', 'sq'), '12.500 Lekë');
  assert.equal(P.formatPrice(1250000, 'ALL', 'en'), '12,500 ALL');
  assert.equal(P.formatPrice(2550, 'EUR', 'en'), '25.50 €');
  assert.equal(P.formatPrice(2550, 'EUR', 'sq'), '25,50 €');
  assert.equal(P.formatPrice(100, 'CHF', 'en'), '1 CHF');
});

test('discount percent only when the old price is really higher', () => {
  assert.equal(P.discountPercent(10000, 8000), 20);
  assert.equal(P.discountPercent(8000, 10000), null);
  assert.equal(P.discountPercent(10000, 10000), null);
  assert.equal(P.discountPercent(null, 100), null);
});

test('content check: required title, invalid prices, old price not higher is a warning', () => {
  assert.deepEqual(P.checkContent({ title: '', price: '5' }).errors, ['title_required']);
  assert.deepEqual(P.checkContent({ title: 'x', price: 'abc' }).errors, ['price_invalid']);
  assert.deepEqual(P.checkContent({ title: 'x', price: '5', oldPrice: '1,2,3' }).errors, ['old_price_invalid']);
  assert.deepEqual(P.checkContent({ title: 'x', price: '50', oldPrice: '40' }).warnings, ['old_price_not_higher']);
  assert.deepEqual(P.checkContent({ title: 'x', price: '' }).warnings, ['no_price']);
});

test('content from product is a copy: bilingual text, truncated description, compare price becomes the old price', () => {
  const prod = { id: 'p1', name: { en: 'Router', sq: 'Ruter' }, description: { en: 'a '.repeat(200), sq: 'përshkrim' }, price: 100, compare_price: 120, currency: 'all', image: 'img/x.jpg' };
  const c = P.contentFromProduct(prod, 'sq');
  assert.equal(c.title, 'Ruter'); assert.equal(c.description, 'përshkrim');
  assert.equal(c.price, '100'); assert.equal(c.oldPrice, '120'); assert.equal(c.currency, 'ALL'); assert.equal(c.imageUrl, 'img/x.jpg');
  assert.ok(P.contentFromProduct(prod, 'en').description.length <= 160);
  c.price = '1'; assert.equal(prod.price, 100); // editing the advert never touches the product object
  assert.equal(P.contentFromProduct({ ...prod, compare_price: 90 }, 'en').oldPrice, '');
});

test('spec sanitizer: clamps, validates colours/enums, drops unknown keys, is idempotent', () => {
  const dirty = { layout: 'evil', align: 'justify', bg: { type: 'gradient', c1: 'red', c2: '#ABC', angle: 9999 }, colors: { text: 'url(javascript:1)', accent: '#00ff00' },
    fonts: { heading: 'Comic', body: 'mono' }, sizes: { title: 50, body: -3, price: 'x' }, image: { scale: 99, offsetX: -999, shape: 'star' },
    cta: { text: 'x'.repeat(500) + '\u0000\n' }, brand: { logo: 'yes' }, overlayShade: 7, __proto__x: 1, extra: { a: 1 } };
  const s = P.sanitizeSpec(dirty);
  assert.equal(s.layout, 'stack'); assert.equal(s.align, 'left');
  assert.equal(s.bg.c1, P.defaultSpec().bg.c1); assert.equal(s.bg.c2, '#abc'); assert.equal(s.bg.angle, 360);
  assert.equal(s.colors.text, P.defaultSpec().colors.text); assert.equal(s.colors.accent, '#00ff00');
  assert.equal(s.fonts.heading, 'sans'); assert.equal(s.fonts.body, 'mono');
  assert.equal(s.sizes.title, 1.8); assert.equal(s.sizes.body, 0.6); assert.equal(s.sizes.price, 1);
  assert.equal(s.image.scale, 1.3); assert.equal(s.image.offsetX, -40); assert.equal(s.image.shape, 'round');
  assert.equal(s.cta.text.length, 40); assert.ok(!/[\u0000\n]/.test(s.cta.text));
  assert.equal(s.brand.logo, true); assert.equal(s.overlayShade, 0.9);
  assert.ok(!('extra' in s));
  assert.deepEqual(P.sanitizeSpec(s), s);
  assert.deepEqual(P.sanitizeSpec(null), P.defaultSpec());
  assert.ok(JSON.stringify(s).length < 8000);
});

test('built-in templates are valid, distinct and contain no product data', () => {
  assert.equal(P.BUILTIN_TEMPLATES.length, 4);
  const layouts = new Set(P.BUILTIN_TEMPLATES.map(t => t.spec.layout));
  assert.ok(layouts.has('stack') && layouts.has('side') && layouts.has('overlay'));
  for (const t of P.BUILTIN_TEMPLATES) {
    assert.deepEqual(P.sanitizeSpec(t.spec), t.spec);
    assert.deepEqual(Object.keys(t.spec.price).sort(), ['showOld', 'style']); // look only: no amount, no product reference
    assert.ok(!/sku|product|amount|title/i.test(JSON.stringify(Object.keys(t.spec))));
  }
});

test('formats: sizes, print formats use exact paper size in points', () => {
  assert.deepEqual([P.FORMATS.instagram_square.w, P.FORMATS.instagram_square.h], [1080, 1080]);
  assert.deepEqual([P.FORMATS.story.w, P.FORMATS.story.h], [1080, 1920]);
  assert.deepEqual([P.FORMATS.facebook_post.w, P.FORMATS.facebook_post.h], [1200, 630]);
  assert.equal(Math.round(P.FORMATS.print_a4.pt[0]), 595); assert.equal(Math.round(P.FORMATS.print_a4.pt[1]), 842);
  assert.equal(Math.round(P.FORMATS.print_a5.pt[0]), 420);
  assert.ok(Math.abs(P.FORMATS.print_a4.w / P.FORMATS.print_a4.h - 210 / 297) < 0.001);
});

test('PDF writer: valid structure, xref offsets point at the objects, image bytes embedded untouched', () => {
  const jpeg = new Uint8Array(300); jpeg[0] = 0xff; jpeg[1] = 0xd8; for (let i = 2; i < 300; i++) jpeg[i] = i & 0xff; jpeg[298] = 0xff; jpeg[299] = 0xd9;
  const pdf = P.buildPdf({ jpeg, width: 40, height: 20, pageW: 595.28, pageH: 297.64, title: 'Tëst (promo)\\' });
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4')); assert.ok(text.trimEnd().endsWith('%%EOF'));
  const sx = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(sx, sx + 4), 'xref');
  const rows = text.slice(sx).split('\n').slice(3, 9);
  rows.forEach((r, i) => { const off = Number(r.slice(0, 10)); assert.ok(text.slice(off).startsWith((i + 1) + ' 0 obj'), 'object ' + (i + 1)); });
  assert.ok(text.includes('/Filter /DCTDecode') && text.includes('/Width 40 /Height 20'));
  assert.ok(text.includes('/MediaBox [0 0 595.28 297.64]'));
  assert.ok(text.includes('/Title (Tst promo)'));
  const at = text.indexOf('stream\n') + 7; assert.deepEqual(Array.from(pdf.slice(at, at + 300)), Array.from(jpeg));
  assert.throws(() => P.buildPdf({ jpeg: new Uint8Array(10), width: 1, height: 1, pageW: 1, pageH: 1 }), /jpeg_required/);
  assert.throws(() => P.buildPdf({ jpeg, width: 0, height: 1, pageW: 1, pageH: 1 }), /bad_size/);
});

test('file names are safe and descriptive', () => {
  assert.equal(P.fileName('Ruter TP-Link AX55 / Ofertë!', 'story', 'png'), 'subcore-ruter-tp-link-ax55-oferte-story.png');
  assert.equal(P.fileName('', 'print_a4', 'pdf'), 'subcore-promo-print_a4.pdf');
  assert.ok(!P.fileName('../../etc/passwd', 'story', 'png').includes('/'));
});

test('the engine has no network or catalog access', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../promo-render.js', import.meta.url), 'utf8');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'SupabaseClient', 'supabase', 'localStorage', 'sendBeacon', 'WebSocket']) assert.ok(!src.includes(bad), bad);
});

/* ---- drawing, against a recording fake canvas (no browser needed) ---- */
function fakeCanvas() {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return (txt) => { const m = /(\d+)px/.exec(ctx.font || ''); return { width: String(txt).length * (m ? Number(m[1]) : 10) * 0.5 }; };
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return rec(String(k));
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return { canvas: { width: 0, height: 0, getContext: () => ctx }, calls };
}
const img = (w, h) => ({ naturalWidth: w, naturalHeight: h });
const AD = { title: 'Ruter Wi-Fi AX55', description: 'Ruter i shpejtë dual-band', price: '8500', oldPrice: '10000', offer: '', currency: 'ALL' };

test('render smoke: every built-in template x every format draws without error at the right size, text overflow reported only when real', () => {
  for (const t of P.BUILTIN_TEMPLATES) for (const f of Object.values(P.FORMATS)) {
    const { canvas, calls } = fakeCanvas();
    const r = P.render(canvas, { format: f, spec: t.spec, ad: AD, images: { product: img(800, 600), logo: img(640, 226) }, lang: 'sq', scale: 0.25 });
    assert.equal(canvas.width, Math.round(f.w * 0.25)); assert.equal(canvas.height, Math.round(f.h * 0.25));
    const texts = calls.filter(c => c[0] === 'fillText').map(c => c[1]);
    assert.ok(texts.some(x => /Ruter/.test(x)), t.id + '/' + f.id + ' title');
    assert.ok(texts.includes('8.500 Lekë'), 'price');
    assert.ok(texts.includes('10.000 Lekë'), 'old price');
    assert.ok(texts.includes('-15%'), 'auto discount badge');
    assert.ok(texts.includes(P.BRAND.phone) && texts.includes(P.BRAND.email) && texts.includes(P.BRAND.web), 'contact lines');
    assert.ok(!r.warnings.includes('text_overflow'), t.id + '/' + f.id);
  }
});

test('render: no old price shown when it is not higher; no badge claimed; offer text wins over the automatic badge', () => {
  const run = (ad, spec) => { const { canvas, calls } = fakeCanvas(); P.render(canvas, { format: 'instagram_square', spec: spec || {}, ad, images: {}, lang: 'en' }); return calls.filter(c => c[0] === 'fillText').map(c => c[1]); };
  const t1 = run({ ...AD, oldPrice: '5000' });
  assert.ok(!t1.some(x => /^5,000/.test(x))); assert.ok(!t1.some(x => /^-\d+%$/.test(x)));
  const t2 = run({ ...AD, offer: 'Buy 2 get 1' }); assert.ok(t2.includes('Buy 2 get 1')); assert.ok(!t2.includes('-15%'));
  const t3 = run(AD, { badge: { show: false } }); assert.ok(!t3.includes('-15%'));
  const t4 = run(AD, { brand: { phone: false, email: false, web: false, instagram: true } }); assert.ok(t4.includes(P.BRAND.instagram) && !t4.includes(P.BRAND.phone));
  const t5 = run({ ...AD, price: '' }); assert.ok(!t5.some(x => /Lek|ALL/.test(x) && /8/.test(x)));
});

test('render: placeholder hint appears in previews only, never in an export', () => {
  const run = (placeholder) => { const { canvas, calls } = fakeCanvas(); P.render(canvas, { format: 'instagram_square', spec: {}, ad: AD, images: {}, lang: 'en', placeholder }); return calls.filter(c => c[0] === 'fillText').map(c => c[1]); };
  assert.ok(run(true).includes('+ image')); assert.ok(!run(false).includes('+ image')); assert.ok(!run(undefined).includes('+ image'));
});

test('render: a huge title is shrunk and ellipsised rather than overflowing; hostile text is only ever passed to fillText', () => {
  const { canvas, calls } = fakeCanvas();
  const r = P.render(canvas, { format: 'story', spec: {}, ad: { ...AD, title: '<b>' + 'WORD '.repeat(400), description: '<script>' + 'x'.repeat(300) }, images: {}, lang: 'en' });
  const t = calls.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(t.some(x => x.endsWith('…')));
  assert.ok(!calls.some(c => /innerHTML|insertAdjacentHTML|write/.test(c[0])));
  assert.ok(r.width === 1080);
});
