'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');

assert.match(
  source,
  /const TELEGRAM_CHANNEL_GATE_ENABLED = \/\^\(\?:1\|true\|yes\|on\)\$\/i\.test/,
  'Telegram channel gate must be disabled unless explicitly enabled'
);
assert.match(
  source,
  /if \(TELEGRAM_CHANNEL_GATE_ENABLED && !\(await isChannelMember\(msg\.from\.id\)\)\)/,
  'ordinary legal requests must bypass channel membership checks by default'
);

// 2026-11-04 (owner): the channel is t.me/bakhrom_abdimuminov; a link in the
// setting must reach Telegram's API as "@name", or the check fails closed.
assert.match(source, /: '@bakhrom_abdimuminov'\)/, 'the default channel is @bakhrom_abdimuminov');
assert.ok(!/eng_sara_huquqiy_yangiliklar/.test(source), 'the old channel is gone');
const fnSrc = /function normalizeChannel\(value\) \{[\s\S]*?\n\}/.exec(source)[0];
const normalizeChannel = new Function(`${fnSrc}; return normalizeChannel;`)();
for (const v of ['@bakhrom_abdimuminov', 'bakhrom_abdimuminov', 't.me/bakhrom_abdimuminov', 'https://t.me/bakhrom_abdimuminov', 'https://t.me/bakhrom_abdimuminov/', 'https://t.me/s/bakhrom_abdimuminov', 'http://telegram.me/bakhrom_abdimuminov?start=1', '  @bakhrom_abdimuminov  ']) {
  assert.strictEqual(normalizeChannel(v), '@bakhrom_abdimuminov', v);
}
assert.strictEqual(normalizeChannel(''), '', 'empty = the gate is off');
assert.strictEqual(normalizeChannel('-1001234567890'), '-1001234567890', 'a numeric id stays');

console.log('telegram channel gate: optional by default; channel @bakhrom_abdimuminov, links normalised');
