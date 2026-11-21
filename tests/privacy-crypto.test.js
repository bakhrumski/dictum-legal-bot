'use strict';

/**
 * Encryption at rest, E1 (src/privacy/crypto.js): round trips for text, JSON
 * and bytes; a value bound to its place (AAD) does not open elsewhere; a
 * changed byte is refused; rotation keeps old values readable; a bad key ring
 * stops start-up and never prints a key; no keys = values stored as they are,
 * and a sealed value then is an error, not an empty value.
 */

const assert = require('assert');
const c = require('../src/privacy/crypto');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const k1 = c.newKey(), k2 = c.newKey();
const ring = (o, active) => c.reload({ DATA_KEYS: JSON.stringify(o), DATA_KEY_ACTIVE: active || '' });
const AAD = 'document_scans.text:42';

console.log('privacy crypto');

test('text: sealed, unreadable, opens back; a new IV every time; never sealed twice', () => {
  ring({ v1: k1 });
  const s = c.seal('Aziz Karimov, pasport AA1234567', AAD);
  assert.ok(s.startsWith('enc:v1:'));
  assert.ok(!s.includes('Karimov') && !s.includes('AA1234567'));
  assert.strictEqual(c.open(s, AAD), 'Aziz Karimov, pasport AA1234567');
  assert.notStrictEqual(c.seal('bir xil', AAD), c.seal('bir xil', AAD));
  assert.strictEqual(c.seal(s, AAD), s);
  assert.strictEqual(c.seal(null, AAD), null);
  assert.strictEqual(c.open(c.seal('', AAD), AAD), '');
});

test('the place is part of the seal: another row, column or table does not open it', () => {
  ring({ v1: k1 });
  const s = c.seal('maxfiy', AAD);
  for (const other of ['document_scans.text:43', 'matters.summary:42', 'x']) {
    assert.throws(() => c.open(s, other), e => e.code === 'DECRYPT_FAILED');
  }
  assert.throws(() => c.seal('x', ''), e => e.code === 'AAD_REQUIRED');
});

test('a changed byte (data or tag) is refused', () => {
  ring({ v1: k1 });
  const s = c.seal('summa 15 000 000 so‘m', AAD);
  const p = s.split(':');
  const flip = x => { const b = Buffer.from(x, 'base64url'); b[0] ^= 1; return b.toString('base64url'); };
  assert.throws(() => c.open([p[0], p[1], p[2], p[3], flip(p[4])].join(':'), AAD), e => e.code === 'DECRYPT_FAILED');
  assert.throws(() => c.open([p[0], p[1], p[2], flip(p[3]), p[4]].join(':'), AAD), e => e.code === 'DECRYPT_FAILED');
  assert.throws(() => c.open('enc:v1:abc', AAD), e => e.code === 'DECRYPT_FAILED');
});

test('JSON and bytes', () => {
  ring({ v1: k1 });
  const j = { turns: [{ role: 'user', text: 'savol' }], n: 2 };
  const sj = c.sealJson(j, 'tg_conversations.turns:7');
  assert.ok(c.isSealedJson(sj) && !JSON.stringify(sj).includes('savol'));
  assert.deepStrictEqual(c.openJson(sj, 'tg_conversations.turns:7'), j);
  assert.deepStrictEqual(c.openJson(j, 'x'), j, 'a plain JSON value passes');
  const audio = Buffer.from([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4, 5]);
  const sb = c.sealBytes(audio, 'interview_audio.data:r1');
  assert.ok(c.isSealedBytes(sb) && !sb.includes(audio));
  assert.ok(c.openBytes(sb, 'interview_audio.data:r1').equals(audio));
  assert.throws(() => c.openBytes(sb, 'interview_audio.data:r2'), e => e.code === 'DECRYPT_FAILED');
  assert.ok(c.openBytes(audio, 'x').equals(audio), 'plain bytes pass');
});

test('plain values pass through, so a column can switch over row by row', () => {
  ring({ v1: k1 });
  assert.strictEqual(c.open('eski ochiq matn', AAD), 'eski ochiq matn');
  assert.strictEqual(c.keyIdOf('eski ochiq matn'), null);
});

test('rotation: v2 active, v1 values still open, new values use v2', () => {
  ring({ v1: k1 });
  const old = c.seal('eski', AAD);
  ring({ v1: k1, v2: k2 }, 'v2');
  assert.strictEqual(c.open(old, AAD), 'eski');
  const nu = c.seal('yangi', AAD);
  assert.deepStrictEqual([c.keyIdOf(old), c.keyIdOf(nu)], ['v1', 'v2']);
  ring({ v2: k2 });
  assert.throws(() => c.open(old, AAD), e => e.code === 'DATA_KEY_MISSING');
  assert.strictEqual(c.open(nu, AAD), 'yangi');
});

test('no keys: stored as it is (one warning); a sealed value then is an error, not empty', () => {
  ring({ v1: k1 });
  const s = c.seal('maxfiy', AAD);
  c.reload({});
  const warn = console.warn; let warnings = 0; console.warn = () => { warnings++; };
  try {
    assert.strictEqual(c.enabled(), false);
    assert.strictEqual(c.seal('ochiq', AAD), 'ochiq');
    c.seal('yana', AAD);
    assert.strictEqual(warnings, 1);
  } finally { console.warn = warn; }
  assert.throws(() => c.open(s, AAD), e => e.code === 'DATA_KEY_MISSING');
});

test('a bad ring stops start-up, and no message ever holds a key', () => {
  const bad = [
    { DATA_KEYS: 'not json' },
    { DATA_KEYS: JSON.stringify({ v1: Buffer.alloc(16).toString('base64') }) },
    { DATA_KEYS: JSON.stringify({ 'V 1': k1 }) },
    { DATA_KEYS: JSON.stringify({ v1: k1 }), DATA_KEY_ACTIVE: 'v9' },
  ];
  for (const env of bad) {
    let err = null;
    try { c.loadKeyRing(env); } catch (e) { err = e; }
    assert.ok(err && err.code === 'DATA_KEYS_INVALID', JSON.stringify(Object.keys(env)));
    assert.ok(!err.message.includes(k1), 'the key is not in the message');
  }
  const logs = [];
  const r = c.assertKeysValid({ DATA_KEYS: JSON.stringify({ v1: k1 }) }, { log: m => logs.push(m), warn: m => logs.push(m) });
  assert.deepStrictEqual([r.enabled, r.active], [true, 'v1']);
  assert.ok(logs.every(m => !m.includes(k1)));
  const off = c.assertKeysValid({}, { log: m => logs.push(m), warn: m => logs.push(m) });
  assert.strictEqual(off.enabled, false);
  assert.ok(logs.some(m => /WITHOUT encryption/u.test(m)));
});

test('scripts/data-key.js makes a valid 32-byte key ring', () => {
  const out = require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'scripts', 'data-key.js'), 'v1'], { encoding: 'utf8' });
  const keys = JSON.parse(out.match(/^DATA_KEYS=(.*)$/mu)[1]);
  assert.strictEqual(Buffer.from(keys.v1, 'base64').length, 32);
  assert.match(out, /^DATA_KEY_ACTIVE=v1$/mu);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
