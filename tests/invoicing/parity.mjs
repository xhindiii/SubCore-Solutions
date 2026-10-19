// JS invoice maths vs the database function invoice_compute(): thousands of random invoices must match to the cent.
// Needs a throwaway PostgreSQL with the v8 migration (see run-db-tests.sh). Env: PGHOST/PGPORT/PGUSER, PARITY_DB.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const C = createRequire(import.meta.url)("../../invoices-core.js");
let seed = 20261018; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const dec = (max, d) => (Math.floor(rnd() * max * 10 ** d) / 10 ** d).toFixed(d);
const N = Number(process.env.PARITY_N || 3000);
const cases = [];
for (let k = 0; k < N; k++) {
  const n = 1 + Math.floor(rnd() * 6);
  const lines = Array.from({ length: n }, () => ({ qty: pick([dec(20, 3), String(1 + Math.floor(rnd() * 9)), "0.001", "2.5", "0.333"]), unit_price: pick([dec(100000, 2), dec(10, 2), "0.01", "199.99", "0"]),
    discount_type: pick(["percent", "amount"]), discount_value: pick(["0", dec(100, 2), dec(5000, 2), "100", "33.33"]), vat_rate: pick(["0", "20", "6", "7.5", "18.25", dec(100, 2)]) }));
  cases.push({ lines, discountType: pick(["percent", "amount"]), discountValue: pick(["0", dec(100, 2), dec(20000, 2), "100", "7.77"]), shipping: pick(["0", dec(2000, 2), "300"]), shippingVat: pick(["0", "20", dec(100, 2)]) });
}
// percent discounts above 100 are rejected by the database, keep inputs legal
for (const c of cases) { for (const l of c.lines) if (l.discount_type === "percent" && Number(l.discount_value) > 100) l.discount_value = "100"; if (c.discountType === "percent" && Number(c.discountValue) > 100) c.discountValue = "100"; }
const q = (s) => "'" + s.replace(/'/g, "''") + "'";
const sql = cases.map((c) => `SELECT invoice_compute(${q(JSON.stringify(c.lines))}::jsonb, ${q(c.discountType)}, ${c.discountValue}, ${c.shipping}, ${c.shippingVat})::text;`).join("\n");
const out = execFileSync("psql", ["-q", "-At", "-d", process.env.PARITY_DB || "subcore_inv_test"], { input: sql, maxBuffer: 1 << 28 }).toString().trim().split("\n");
if (out.length !== cases.length) { console.error("row count mismatch", out.length, cases.length); process.exit(1); }
let bad = 0;
const num = (v) => Math.round(Number(v) * 100);
cases.forEach((c, i) => {
  const db = JSON.parse(out[i]), js = C.compute(c.lines, c);
  const keys = ["gross_total", "line_discount_total", "overall_discount_total", "taxable_total", "shipping", "shipping_tax", "tax_total", "total"];
  let ok = keys.every((k) => num(db[k]) === num(js[k]));
  ok = ok && db.lines.length === js.lines.length && db.lines.every((l, j) => ["line_gross", "line_discount", "line_net", "overall_discount_share", "line_tax", "line_total"].every((k) => num(l[k]) === num(js.lines[j][k])));
  if (!ok && bad++ < 5) console.error("MISMATCH", JSON.stringify(c), "\nDB", out[i], "\nJS", JSON.stringify(js));
});
if (bad) { console.error(bad + " of " + N + " cases differ"); process.exit(1); }
console.log("parity OK: " + N + " random invoices identical in SQL and JS");
