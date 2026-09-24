'use strict';

// No master login may come from a password written in this repository.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { bootstrapFirstMaster, isPublishedMasterPassword } = require('../src/auth/master-bootstrap');

const fakeBcrypt = { hash: async (p, rounds) => `hashed(${p},${rounds})` };
function fakePool(masterCount) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: masterCount }] };
      return { rows: [] };
    },
  };
}
const inserted = (pool) => pool.calls.filter((c) => /INSERT INTO admins/.test(c.sql));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

(async () => {
  console.log('\nauth — no master from a published password\n');

  await test('published seed passwords are recognised', () => {
    for (const p of ['juristAI', 'admin123', 'student123']) assert.strictEqual(isPublishedMasterPassword(p), true, p);
    for (const p of ['', undefined, 'juristai', 'JuristAI!2026', 'correct horse battery']) assert.strictEqual(isPublishedMasterPassword(p), false, String(p));
  });

  await test('an existing master means nothing is created', async () => {
    const pool = fakePool(1);
    const r = await bootstrapFirstMaster(pool, fakeBcrypt, { MASTER_BOOTSTRAP_PASSWORD: 'a-long-enough-secret' });
    assert.deepStrictEqual(r, { created: false, reason: 'master_exists' });
    assert.strictEqual(inserted(pool).length, 0);
  });

  await test('no bootstrap password means nothing is created', async () => {
    const pool = fakePool(0);
    const r = await bootstrapFirstMaster(pool, fakeBcrypt, {});
    assert.strictEqual(r.reason, 'no_bootstrap_password');
    assert.strictEqual(inserted(pool).length, 0);
  });

  await test('a short or published bootstrap password is refused', async () => {
    for (const pw of ['short', 'juristAI', 'admin123']) {
      const pool = fakePool(0);
      const r = await bootstrapFirstMaster(pool, fakeBcrypt, { MASTER_BOOTSTRAP_PASSWORD: pw });
      assert.strictEqual(r.reason, 'bootstrap_password_too_weak', pw);
      assert.strictEqual(inserted(pool).length, 0, pw);
    }
  });

  await test('with no master and a strong password, one master is created from it', async () => {
    const pool = fakePool(0);
    const r = await bootstrapFirstMaster(pool, fakeBcrypt, { MASTER_BOOTSTRAP_PASSWORD: 'a-long-enough-secret', MASTER_BOOTSTRAP_USERNAME: 'owner' });
    assert.deepStrictEqual(r, { created: true, username: 'owner' });
    const ins = inserted(pool);
    assert.strictEqual(ins.length, 1);
    assert.deepStrictEqual(ins[0].params, ['owner', 'hashed(a-long-enough-secret,12)']);
    assert.match(ins[0].sql, /'master'/);
  });

  await test('server.js no longer seeds a fixed password or promotes by username', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    assert.ok(!/bcrypt\.hash\(\s*['"]/.test(src), 'a literal password is hashed in server.js');
    assert.ok(!/UPDATE admins SET role = 'master' WHERE username/.test(src), 'a username is still promoted to master');
    assert.ok(/isPublishedMasterPassword\(password\)/.test(src), 'login does not refuse published passwords');
  });

  await test('setup.js prints a random password instead of a fixed one', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'database', 'setup.js'), 'utf8');
    assert.ok(!/bcrypt\.hash\(\s*['"]/.test(src));
    assert.ok(/randomBytes\(12\)/.test(src));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
})();
