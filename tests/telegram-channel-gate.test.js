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

// 2026-11-04 (owner): a subscribed user was told "Hali obuna bo'lmadingiz" -
// a refused check (the bot not an admin of the channel) read as "not a member".
(async () => {
  const grab = (re) => re.exec(source)[0];
  const body = [
    grab(/const CHANNEL_ALERT_MS[^\n]*\n/), grab(/const channelGate = [^\n]*\n/), grab(/const scrubTelegramError = [^\n]*\n/),
    grab(/async function alertMastersChannelGate\(message\) \{[\s\S]*?\n\}/),
    grab(/async function checkChannelMembership\(userId\) \{[\s\S]*?\n\}/),
    grab(/async function isChannelMember\(userId\) \{[\s\S]*?\n\}/),
  ].join('\n');
  const make = (mode, getChatMember) => {
    const sent = [];
    const bot = { getChatMember, sendMessage: async (id, t) => { sent.push([id, t]); } };
    const pool = { query: async () => ({ rows: [{ telegram_chat_id: 77 }] }) };
    const f = new Function('bot', 'pool', 'REQUIRED_CHANNEL', 'CHANNEL_GATE_ON_ERROR', `${body}; return { checkChannelMembership, isChannelMember, channelGate };`);
    return Object.assign(f(bot, pool, '@bakhrom_abdimuminov', mode), { sent });
  };
  const refused = async () => { throw new Error('ETELEGRAM: 400 Bad Request: member list is inaccessible (bot123456:SECRET_x)'); };
  const origError = console.error; console.error = () => {};
  try {
    const member = make('open', async () => ({ status: 'member' }));
    assert.deepStrictEqual(await member.checkChannelMembership(1), { member: true, status: 'member' });
    const left = make('open', async () => ({ status: 'left' }));
    assert.strictEqual(await left.isChannelMember(1), false, 'a user who left is not a member');
    const open = make('open', refused);
    const r = await open.checkChannelMembership(1);
    assert.strictEqual(r.member, null, 'an error is not "not a member"');
    assert.ok(!/SECRET/.test(r.error) && /bot<token>/.test(r.error), 'a token never reaches the message');
    assert.strictEqual(await open.isChannelMember(1), true, 'open on error by default: a broken setting blocks nobody');
    await new Promise(res => setTimeout(res, 10));
    assert.strictEqual(open.sent.length, 1, 'masters told once an hour, not per user');
    assert.ok(/administrator/.test(open.sent[0][1]) && /\/kanal/.test(open.sent[0][1]));
    const closed = make('closed', refused);
    assert.strictEqual(await closed.isChannelMember(1), false, 'TELEGRAM_CHANNEL_GATE_ON_ERROR=closed keeps it shut');
  } finally { console.error = origError; }
  // the button never says "not subscribed" when Telegram did not answer
  assert.match(source, /if \(sub\.member === null && CHANNEL_GATE_ON_ERROR === 'closed'\)/);
  assert.match(source, /bot\.onText\(\/\^\\\/kanal/, 'the master can see why: /kanal');
  console.log('telegram channel gate: optional by default; channel @bakhrom_abdimuminov, links normalised; an error is not "not a member"');
})().catch((e) => { console.error(e); process.exit(1); });
