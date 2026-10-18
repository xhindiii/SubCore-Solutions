// Phase 9 — checks the logic of the invoice app's tools/export-shop-products.js (copied in export-logic.copy.js, notice + download removed)
// against 90 fake shop products. Run: PW_PATH=... node tests/regression/catalogue-sync/run.mjs tests/regression/catalogue-sync/export-logic.copy.js
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire(import.meta.url); const { chromium } = require(process.env.PW_PATH || 'playwright');
const src = fs.readFileSync(process.argv[2], 'utf8');
const cats = ['laptop','ram','storage-devices','printer-scanner','accessories','battery','camera','smart-watches','other-thing'];
const rows = Array.from({ length: 90 }, (_, i) => ({ id: 'p' + i, name: { sq: 'Produkt ' + i, en: i % 7 ? 'Product ' + i : '' }, price: i % 11 === 0 ? null : (i * 137.5) / 3, currency: i % 2 ? 'ALL' : 'EUR', category: cats[i % cats.length], sku: i % 3 ? 'SKU' + i : null, stock: 5, images: ['x'], available: true }));
const b = await chromium.launch(); const p = await b.newPage(); await p.setContent('<body></body>');
await p.evaluate((d) => { window.sb = { from: () => ({ select: () => ({ limit: async () => ({ data: JSON.parse(d), error: null }) }) }) }; }, JSON.stringify(rows));
await p.evaluate(src); await p.waitForFunction(() => window.__out);
const out = await p.evaluate(() => window.__out); await b.close();
const fails = [];
const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fails.push(n); };
ck('all 90 shop products exported, none dropped', out.catalogue.length === 90);
ck('ids unique and traceable to the shop (shop:<id>)', new Set(out.catalogue.map(e => e.sourceId)).size === 90 && out.catalogue.every((e, i) => e.sourceId === 'shop:p' + i));
ck('prices equal the shop price exactly (no rounding / no markup); missing price stays empty', out.catalogue.every((e, i) => e.price === (rows[i].price == null ? '' : String(rows[i].price))));
ck('currency preserved per product', out.catalogue.every((e, i) => e.currency === rows[i].currency));
ck('no stock / availability / images leak into the invoice catalogue', !/stock|available|images/.test(JSON.stringify(out)));
ck('names fall back to the other language instead of being blank', out.catalogue.every(e => e.name.sq && e.name.en));
ck('unknown shop category maps to "other"', out.catalogue.filter((e, i) => cats[i % cats.length] === 'other-thing').every(e => e.category === 'other'));
process.exit(fails.length ? 1 : 0);
