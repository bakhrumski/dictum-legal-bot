'use strict';

/**
 * One-time codes come from the CSPRNG, and codes / tokens are not written to
 * the log (audit H4, L4).
 *
 *   node tests/otp-and-log-secrets.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { digitCode, randomPassword } = require('../src/auth/otp');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('otp and secrets in logs');

test('codes have exactly the requested number of digits and cover the range', () => {
  const seen4 = new Set();
  for (let i = 0; i < 5000; i++) {
    const c = digitCode(4);
    assert.ok(/^[1-9]\d{3}$/.test(c), c);
    seen4.add(c[0]);
  }
  assert.strictEqual(seen4.size, 9, 'every leading digit appears');
  for (let i = 0; i < 1000; i++) assert.ok(/^[1-9]\d{5}$/.test(digitCode(6)));
});

test('temporary passwords avoid look-alike characters', () => {
  const p = randomPassword(12);
  assert.strictEqual(p.length, 12);
  assert.ok(!/[0O1lI]/.test(p));
});

test('no one-time code or password comes from Math.random', () => {
  for (const f of ['src/api/server.js', 'src/auth/email-code.js', 'src/bot/bot.js']) {
    const src = read(f);
    assert.ok(!/Math\.random\(\)\s*\*\s*9000/.test(src), `${f}: 4-digit code from Math.random`);
    assert.ok(!/Math\.random\(\)\s*\*\s*900000/.test(src), `${f}: 6-digit code from Math.random`);
    assert.ok(!/bcrypt\.hash\(Math\.random/.test(src), `${f}: password from Math.random`);
  }
});

test('verification / recovery tokens and email codes are not logged', () => {
  const server = read('src/api/server.js');
  assert.ok(!/console\.log\(`\[VERIFY\][^`]*\$\{token\}/.test(server));
  assert.ok(!/console\.log\(`\[RECOVERY\][^`]*\$\{token\}/.test(server));
  const email = read('src/auth/email-code.js');
  assert.ok(!/\(token: \$\{token\}\)/.test(email), 'email stub no longer logs the token');
  assert.ok(/EMAIL_DEV_LOG_CODES === 'true'/.test(email), 'the code is logged only when a developer opts in');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
