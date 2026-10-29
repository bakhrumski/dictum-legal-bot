'use strict';

/**
 * Data protection E3 (src/privacy/redact.js): identifiers are hidden before
 * an AI call and put back after it; amounts, dates and article numbers stay;
 * a 16-digit number that fails the Luhn check is not a card; one request
 * keeps one placeholder per value; the legal-answer pipeline (web chat,
 * its RAG routes, Telegram) only with REDACT_LEGAL_CHAT=on or a master's
 * per-request switch (E4), and REDACT_AI=off stops it; the provider sees no
 * identifier, the caller gets the original back - streamed pieces too, a
 * placeholder split across pieces included - the ledger detail gets counts only.
 */

const assert = require('assert');
const r = require('../src/privacy/redact');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('privacy redact');

  await test('each kind is hidden', () => {
    const m = r.createMap();
    const t = r.redact('Pasport AA1234567, JShShIR: 31234567890123, STIR 123456789, tel +998 90 123 45 67, karta 8600 1234 5678 9012, ' +
      'hisob 20208000900123456789, email aziz@mail.uz, avto 01 A 123 BC. F.I.Sh.: Karimov Aziz Botirovich', m);
    for (const v of ['AA1234567', '31234567890123', '123456789', '90 123 45 67', '8600 1234 5678 9012', '20208000900123456789', 'aziz@mail.uz', '01 A 123 BC', 'Karimov Aziz Botirovich']) {
      assert.ok(!t.includes(v), `${v} left in: ${t}`);
    }
    for (const tag of ['PASPORT', 'JSHSHIR', 'STIR', 'TELEFON', 'KARTA', 'HISOB', 'EMAIL', 'AVTO', 'SHAXS']) assert.ok(t.includes(`[${tag}_1]`), tag);
  });

  await test('amounts, dates, articles, clauses and act codes stay', () => {
    const src = '15 000 000 so‘m, 2026-yil 1-noyabr, 12.03.2025, Fuqarolik kodeksining 333-moddasi 2-qismi, 4.1-band, VMQ-589, PQ-1234, O‘RQ-1184, 1 234 567 890';
    assert.strictEqual(r.redact(src, r.createMap()), src);
  });

  await test('a 16-digit number that fails Luhn is not a card; "STIR" is needed for 9 digits', () => {
    assert.strictEqual(r.redact('1234 5678 9012 3456', r.createMap()), '1234 5678 9012 3456');
    assert.strictEqual(r.redact('shartnoma 123456789 raqamli', r.createMap()), 'shartnoma 123456789 raqamli');
  });

  await test('the same value gets the same placeholder across calls of one map; restore puts it back', () => {
    const m = r.createMap();
    const a = r.redact('AA1234567 va AA1234567', m);
    const b = r.redact('yana AA1234567, boshqa BB7654321', m);
    assert.strictEqual(a, '[PASPORT_1] va [PASPORT_1]');
    assert.strictEqual(b, 'yana [PASPORT_1], boshqa [PASPORT_2]');
    assert.strictEqual(r.restore('Javob: [PASPORT_2] egasi [PASPORT_1]ga yozadi; [PASPORT_9] noma’lum', m), 'Javob: BB7654321 egasi AA1234567ga yozadi; [PASPORT_9] noma’lum');
    assert.deepStrictEqual(r.countsOf(m), { PASPORT: 2 });
  });

  await test('names: the account holder\'s full name; a single word is not hidden', () => {
    const m = r.createMap();
    assert.strictEqual(r.redact('Aziz Karimov ijarachi', m, { names: ['Aziz Karimov'] }), '[SHAXS_1] ijarachi');
    assert.strictEqual(r.redact('Aziz ijarachi', r.createMap(), { names: ['Aziz'] }), 'Aziz ijarachi');
  });

  await test('messages: only the text parts; other parts as they are', () => {
    const img = { role: 'user', image: 'data:...' };
    const out = r.redactMessages([{ role: 'system', text: 'AA1234567' }, img], r.createMap());
    assert.strictEqual(out[0].text, '[PASPORT_1]');
    assert.strictEqual(out[1], img);
  });

  await test('which requests: the web chat, its RAG routes and Telegram only with REDACT_LEGAL_CHAT=on (E4); REDACT_AI=off stops it', () => {
    const st = (service, kind) => ({ service, kind, shared: {} });
    assert.strictEqual(r.forRequest(st('web', 'POST /api/legal-chat'), {}), null);
    assert.strictEqual(r.forRequest(st('web', 'POST /api/rag/justify-ask'), {}), null);
    assert.strictEqual(r.forRequest(st('telegram', null), {}), null);
    assert.ok(r.forRequest(st('web', 'POST /api/analyze'), {}));
    assert.ok(r.forRequest(st('agent', 'agent tabular_review'), {}));
    assert.strictEqual(r.forRequest(st('web', 'POST /api/analyze'), { REDACT_AI: 'off' }), null);
    const s = st('web', 'POST /api/analyze');
    assert.strictEqual(r.forRequest(s, {}), r.forRequest(s, {}), 'one map per request');
    // E4: the flag, and a master's switch for one request either way
    assert.ok(r.forRequest(st('web', 'POST /api/legal-chat'), { REDACT_LEGAL_CHAT: 'on' }));
    assert.ok(r.forRequest(st('telegram', 'text'), { REDACT_LEGAL_CHAT: 'on' }));
    assert.ok(r.forRequest(st('web', 'POST /api/rag/justify-ask'), { REDACT_LEGAL_CHAT: 'on' }));
    const on = st('web', 'POST /api/legal-chat'); on.shared.redactLegal = true;
    assert.ok(r.forRequest(on, {}));
    const off = st('web', 'POST /api/legal-chat'); off.shared.redactLegal = false;
    assert.strictEqual(r.forRequest(off, { REDACT_LEGAL_CHAT: 'on' }), null);
    assert.strictEqual(r.forRequest(on, { REDACT_AI: 'off' }), null, 'REDACT_AI=off wins over the switch');
    const other = st('web', 'POST /api/analyze'); other.shared.redactLegal = false;
    assert.ok(r.forRequest(other, {}), 'the switch is for the legal pipeline only');
  });

  await test('messages with `content` (the hybrid pipeline) are redacted too', () => {
    const out = r.redactMessages([{ role: 'user', content: 'tel +998 90 123 45 67' }], r.createMap());
    assert.strictEqual(out[0].content, 'tel [TELEFON_1]');
  });

  await test('streamed pieces: a placeholder split across pieces is put back whole; other text is not held', () => {
    const m = r.createMap();
    r.redact('AA1234567 va aziz@mail.uz', m);
    const sr = r.createStreamRestorer(m);
    const shown = ['Pasport [PAS', 'PORT', '_1] egasi', ' [', 'EMAIL_1', ']', ' va [1] havola [x'].map(p => sr.push(p));
    assert.deepStrictEqual(shown, ['Pasport ', '', 'AA1234567 egasi', ' ', '', 'aziz@mail.uz', ' va [1] havola [x']);
    assert.strictEqual(sr.push(' [EMAIL'), ' ');
    assert.strictEqual(sr.flush(), '[EMAIL', 'an unfinished tail is shown as it is at the end');
  });

  await test('the stream wrapper: provider sees placeholders, the reader gets each piece restored, the final text too', async () => {
    const store = { service: 'web', kind: 'POST /api/legal-chat/stream', shared: { redactLegal: true }, userIdOf: () => null };
    const wrap = r.createWrapper({ current: () => store, env: {} });
    let seen = null; const got = [];
    const out = await wrap.stream([{ role: 'user', text: 'Pasportim AA1234567 yo‘qoldi' }], {}, (t) => got.push(t), async (msgs, o, onToken) => {
      seen = msgs[0].text;
      for (const p of ['[PASPO', 'RT_1] raqamli ', 'pasport']) onToken(p);
      return { text: '[PASPORT_1] raqamli pasport' };
    });
    assert.strictEqual(seen, 'Pasportim [PASPORT_1] yo‘qoldi');
    assert.strictEqual(got.join(''), 'AA1234567 raqamli pasport');
    assert.strictEqual(out.text, 'AA1234567 raqamli pasport');
    // off: the call and its pieces as they are
    store.shared = { redactLegal: false }; got.length = 0;
    await wrap.stream([{ role: 'user', text: 'AA1234567' }], {}, (t) => got.push(t), async (msgs, o, onToken) => { seen = msgs[0].text; onToken('x'); return { text: 'x' }; });
    assert.strictEqual(seen, 'AA1234567');
    assert.deepStrictEqual(got, ['x']);
  });

  await test('the wrapper: the provider sees none of it, the caller gets it back, the ledger detail has counts only', async () => {
    const store = { service: 'web', kind: 'POST /api/draft/explain-document', shared: {}, userIdOf: () => 7 };
    const wrap = r.createWrapper({ current: () => store, loadName: async (id) => (id === 7 ? 'Aziz Karimov' : null), env: {} });
    let seen = null, opts = null;
    const out = await wrap([{ role: 'user', text: 'Aziz Karimov, pasport AA1234567, telefon +998 90 123 45 67. 333-modda.' }], { endpoint: 'x' }, async (msgs, o) => {
      seen = msgs[0].text; opts = o;
      return { text: '[SHAXS_1] ([PASPORT_1]) 333-moddaga ko‘ra…', provider: 'stub' };
    });
    assert.ok(!/Karimov|AA1234567|123 45 67/u.test(seen), seen);
    assert.ok(seen.includes('333-modda'));
    assert.strictEqual(out.text, 'Aziz Karimov (AA1234567) 333-moddaga ko‘ra…');
    assert.deepStrictEqual(opts.detail.redacted, { SHAXS: 1, PASPORT: 1, TELEFON: 1 });
    assert.ok(!JSON.stringify(opts.detail).includes('AA1234567'));
    // the legal chat is left alone unless REDACT_LEGAL_CHAT=on (E4)
    const chat = { service: 'web', kind: 'POST /api/legal-chat', shared: {}, userIdOf: () => 7 };
    const wrap2 = r.createWrapper({ current: () => chat, loadName: async () => 'Aziz Karimov', env: {} });
    await wrap2([{ role: 'user', text: 'AA1234567' }], {}, async (msgs) => { seen = msgs[0].text; return { text: 'ok' }; });
    assert.strictEqual(seen, 'AA1234567');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
