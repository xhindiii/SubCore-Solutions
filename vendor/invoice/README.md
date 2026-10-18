# Invoice calculation engine (vendored, unmodified)

`util.js`, `calc.js` and `numbering.js` are byte-for-byte copies of `js/util.js`, `js/calc.js` and `js/numbering.js`
from the SubCore invoice app (`subcore-invoice`). The monthly reports use them so an invoice's net, VAT, discount, total and
paid/outstanding amounts are computed by exactly the same code that produced the invoice — nothing is re-implemented.

**Do not edit these files.** If the invoice app's engine changes, copy the new files over and re-run
`node tests/vendor-invoice/calc.test.js` (the invoice app's own test suite, only the `require` paths changed) and
`node --test tests/reports/`. `tests/reports/vendor-integrity.test.mjs` fails if a file differs from the hashes below.

```
2db4efc0c2501a0c4a7fcfc0d47fee9e4a7eb328267c0a126e4e0b58d344e05c  util.js
9e6c87693d6ca15829814d292404a95fe66b9589aa396e4a6a2139dba3419ec7  calc.js
e65f05f7ed2b62630c8d4160080bb796f95fc9eb483024fd25b827cda4f3ae95  numbering.js
```
(`numbering.js` is not loaded by the website; it is kept only because the original test file requires it.)
