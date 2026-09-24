'use strict';

// The Telegram webhook must accept updates only from Telegram. It used to be
// mounted at /webhook/<bot token>; Express 5 read the part after the token's
// ':' as a route parameter, so the secret half of the path matched anything.

const assert = require('assert');
const { match } = require('path-to-regexp');
const { webhookPath, webhookSecret, isTelegramRequest, describeWebhook } = require('../src/bot/webhook-auth');

const TOKEN = '7123456789:AAHk-XyZ_abc123def456';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

console.log('\ntelegram — webhook accepts only Telegram\n');

test('the old token path really was a wildcard (regression guard for the reason)', () => {
  const old = match(`/webhook/${TOKEN}`);
  assert.ok(old('/webhook/7123456789:guessed-XyZ_abc123def456'), 'a guessed secret matched the old route');
});

test('the new path has no route parameters and does not contain the token', () => {
  const path = webhookPath(TOKEN);
  assert.match(path, /^\/webhook\/tg\/[0-9a-f]{32}$/);
  assert.ok(!path.includes('7123456789') && !path.includes('AAHk'), 'token leaked into the path');
  const route = match(path);
  assert.ok(route(path));
  assert.ok(!route('/webhook/tg/' + '0'.repeat(32)));
  assert.ok(!route(`/webhook/${TOKEN}`));
});

test('path and secret are stable for a token and differ between tokens', () => {
  assert.strictEqual(webhookPath(TOKEN), webhookPath(TOKEN));
  assert.notStrictEqual(webhookPath(TOKEN), webhookPath('999:other'));
  assert.notStrictEqual(webhookSecret(TOKEN, ''), webhookSecret('999:other', ''));
});

test('the secret satisfies Telegram\'s secret_token rules', () => {
  const secret = webhookSecret(TOKEN, '');
  assert.match(secret, /^[A-Za-z0-9_-]{1,256}$/);
  assert.notStrictEqual(secret.slice(0, 32), webhookPath(TOKEN).slice(-32), 'path and secret must not be the same value');
});

test('TELEGRAM_WEBHOOK_SECRET overrides the derived secret when valid', () => {
  assert.strictEqual(webhookSecret(TOKEN, 'rotated_Secret-01'), 'rotated_Secret-01');
  assert.strictEqual(webhookSecret(TOKEN, 'has spaces!'), webhookSecret(TOKEN, ''), 'an invalid override is ignored');
});

test('only the exact secret header is accepted', () => {
  const secret = webhookSecret(TOKEN, '');
  assert.strictEqual(isTelegramRequest(secret, secret), true);
  assert.strictEqual(isTelegramRequest(undefined, secret), false);
  assert.strictEqual(isTelegramRequest('', secret), false);
  assert.strictEqual(isTelegramRequest(secret.slice(0, -1), secret), false);
  assert.strictEqual(isTelegramRequest(secret + 'x', secret), false);
  assert.strictEqual(isTelegramRequest(secret.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), secret), false);
  assert.strictEqual(isTelegramRequest(secret, ''), false);
});

test('the logged webhook URL never contains the token', () => {
  const line = describeWebhook('juristai.uz', TOKEN);
  assert.ok(!line.includes('AAHk') && !line.includes(TOKEN));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
