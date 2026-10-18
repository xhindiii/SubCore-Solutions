import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const EXPECT = {
  'util.js': '2db4efc0c2501a0c4a7fcfc0d47fee9e4a7eb328267c0a126e4e0b58d344e05c',
  'calc.js': '9e6c87693d6ca15829814d292404a95fe66b9589aa396e4a6a2139dba3419ec7',
  'numbering.js': 'e65f05f7ed2b62630c8d4160080bb796f95fc9eb483024fd25b827cda4f3ae95'
};
test('vendored invoice engine files are unmodified copies', () => {
  for (const [f, h] of Object.entries(EXPECT)) {
    const got = crypto.createHash('sha256').update(fs.readFileSync(new URL('../../vendor/invoice/' + f, import.meta.url))).digest('hex');
    assert.equal(got, h, f + ' differs from the invoice app original');
  }
});
