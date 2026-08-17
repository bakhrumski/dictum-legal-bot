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

console.log('telegram channel gate: optional by default');
