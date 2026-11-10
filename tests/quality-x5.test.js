'use strict';

/**
 * X5 of the 2026-11-10 audit (docs/audit/2026-11-10-audit.md §5): Q1 the best-ranked chunks reach
 * the generator with their whole article, Q4 a verifier that failed technically gets one more try,
 * Q6 a web answer the claim guard emptied returns its unit and offers a retry, Q10 the bot's answer
 * cap, Q9 "this answer is wrong / incomplete" from the person who got it (app and bot).
 *
 *   node tests/quality-x5.test.js      (the rating's database part needs TEST_DATABASE_URL)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const DB_OK = !!process.env.TEST_DATABASE_URL && !/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL);
if (DB_OK) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('quality X5');
  const server = read('src', 'api', 'server.js'), bot = read('src', 'bot', 'bot.js'), page = read('public', 'app', 'chat.js');

  await test('Q1: the first chunks go to the generator whole (4 x 4 200 chars), the rest as before; 0 switches it off', () => {
    assert.ok(server.includes("const maxChars = r.source_type === 'verified_qa' ? 2000 : (i < FULL_TOP ? FULL_CHARS : MAX_CHUNK_CHARS);"));
    assert.ok(/const FULL_TOP = Math\.min\(8, Math\.max\(0, process\.env\.RAG_FULL_ARTICLE_TOP == null \|\| process\.env\.RAG_FULL_ARTICLE_TOP === '' \? 4 : Number\(process\.env\.RAG_FULL_ARTICLE_TOP\) \|\| 0\)\);/.test(server));
    assert.ok(server.includes("const FULL_CHARS = Math.min(8000, Math.max(MAX_CHUNK_CHARS, Number(process.env.RAG_FULL_ARTICLE_CHARS) || 4200));"));
    assert.ok(server.includes('const MAX_CHUNK_CHARS = 1200;'), 'the others keep their limit');
  });

  await test('Q4: a verifier that failed technically is tried once more with room for a longer reply; a second failure stays unverified', async () => {
    const g = require('../src/rag/legal-claim-guard');
    const A = { law_name: 'Mehnat kodeksi', article_numbers: ['100'], chunk_text: "100-modda. Ogohlantirish muddati ikki oy.", parentText: "100-modda. Ogohlantirish muddati ikki oy." };
    const answer = "Mehnat kodeksining 100-moddasiga ko'ra ogohlantirish muddati ikki oy.";
    const good = JSON.stringify({ claims: [{ id: 'c1', verdict: 'supported', topic: 'muddat', reason: 'ok' }] });
    // first call: a cut reply; second: a full one
    let calls = [];
    const flaky = async (msgs, o) => { calls.push(o.maxTokens); return { text: calls.length === 1 ? '{"claims":[{"id":"c1","verd' : good }; };
    const r = await g.guardLegalAnswer({ question: 'Ogohlantirish muddati qancha?', answer, chunks: [A], callAI: flaky });
    assert.strictEqual(calls.length, 2, 'one retry');
    assert.strictEqual(calls[1], calls[0] * 2, 'with a doubled reply cap');
    assert.strictEqual(r.verifierRetries, 1);
    assert.notStrictEqual(r.status, 'unverified', 'the answer is no longer emptied for a technical failure');
    assert.ok(r.text.includes('ikki oy'));
    calls = [];
    const dead = async (msgs, o) => { calls.push(o.maxTokens); throw new Error('provider down'); };
    const r2 = await g.guardLegalAnswer({ question: 'Ogohlantirish muddati qancha?', answer, chunks: [A], callAI: dead });
    assert.deepStrictEqual([calls.length, r2.status, r2.verifierRetries], [2, 'unverified', 1], 'never more than one retry, never passed');
    calls = [];
    const r3 = await g.guardLegalAnswer({ question: 'q', answer, chunks: [A], callAI: dead, options: { verifierRetry: false } });
    assert.deepStrictEqual([calls.length, r3.verifierRetries], [1, 0], 'the retry can be switched off');
  });

  await test('Q6: a web answer the claim guard emptied is said to be no answer, returns its unit, is not cached, and the page retries', () => {
    assert.ok(server.includes("const hollowAnswer = !!(ragMeta && ragMeta.claimGuard && ragMeta.claimGuard.substantive === false) && !!String(displayReply || '').trim();"));
    assert.ok(server.includes("Object.assign(responsePayload, { notSubstantive: true }, tariffModule.refundUsage(res, 'not_substantive'));"));
    assert.ok(server.includes('if (cacheKey && !isFailedAnswer(displayReply) && !lexDown && !hollowAnswer) {'));
    assert.ok(server.includes('substantive: claimGuard.substantive !== false,'));
    assert.ok(server.indexOf('const hollowAnswer =') < server.indexOf('const responsePayload = {'), 'told before the reply is built');
    assert.ok(page.includes("if (done.notSubstantive) { C.history.pop(); J.refreshTariff(); retryBtn(a, msg, shown, confirmedJob); }") && page.includes('else afterReply(done);'), 'not kept in the chat; one tap to ask again');
    const Q = require('../src/ai/quality-report');
    assert.strictEqual(Q.legalCheckOf({ claimGuard: { status: 'partial', withheld: [1], substantive: false } }).delivered, false);
    assert.strictEqual(Q.legalCheckOf({ claimGuard: { status: 'partial', withheld: [1], substantive: true } }).delivered, true);
  });

  await test('Q10: the bot\'s answer cap is 2 500 tokens (it was 1 400), still overridable', () => {
    const { telegramAnswerMaxTokens } = require('../src/agents/telegram-agent');
    assert.deepStrictEqual([telegramAnswerMaxTokens({}), telegramAnswerMaxTokens({ TG_ANSWER_MAX_TOKENS: '1400' }), telegramAnswerMaxTokens({ TG_ANSWER_MAX_TOKENS: '99999' })], [2500, 1400, 2500]);
  });

  await test('Q9 wiring: a flag under each answer in the app and in the bot; same-origin; nothing read from the button', () => {
    assert.ok(server.includes("app.post('/api/answer-rating', require('../auth/same-origin').requireSameOrigin, requireAuth, async (req, res) => {"));
    assert.ok(page.includes('data-a="rate"') && page.includes("J.api('/api/answer-rating', { method: 'POST'"));
    assert.ok(bot.includes("if (agentResult.action === 'answered') {") && bot.includes("callback_data: 'afb' }"));
    assert.ok(/if \(data === 'afb'\) \{[\s\S]{0,900}loadConversation\(chatId\)[\s\S]{0,700}answer-rating'\)\.record\(pool, \{/.test(bot));
    const svc = read('src', 'services', 'answer-rating.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/callAI|callCheapAI|callOpenAI/.test(svc), 'no AI');
  });

  if (DB_OK) {
    const { pool } = require('../src/database/db');
    const R = require('../src/services/answer-rating');
    const privacy = require('../src/privacy/crypto');
    const id = (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Fikr Beruvchi', 'user') RETURNING id`, [`ar_${Date.now()}`])).rows[0].id;
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS answer_feedback (id SERIAL PRIMARY KEY, request_id INTEGER, analysis_id INTEGER, source VARCHAR(20), selected_text TEXT NOT NULL, error_type VARCHAR(20) NOT NULL, suggestion TEXT, question TEXT, answer_text TEXT, submitted_by INTEGER, submitter_name TEXT, status VARCHAR(20) NOT NULL DEFAULT 'new', reviewed_by INTEGER, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await test('Q9: a rating is one row a lawyer can read; kinds and length are checked; a daily cap per person', async () => {
        const answer = 'Mehnat kodeksining 100-moddasiga ko‘ra ogohlantirish muddati ikki oy.';
        const out = await R.record(pool, { adminId: id, name: 'Fikr Beruvchi', kind: 'wrong', question: 'Muddat qancha?', answer, comment: 'Muddat bir oy edi', source: 'web' });
        assert.ok(out.ok && out.id);
        const row = (await pool.query('SELECT * FROM answer_feedback WHERE id = $1', [out.id])).rows[0];
        assert.deepStrictEqual([row.error_type, row.source, row.status, row.submitted_by], ['wrong', 'ai', 'new', id]);
        // read back the way the admin view does (feedbackAad(col, submitted_by))
        assert.strictEqual(privacy.open(row.selected_text, `answer_feedback.selected_text:${id}`), 'Muddat bir oy edi');
        assert.strictEqual(privacy.open(row.answer_text, `answer_feedback.answer_text:${id}`), answer);
        const tg = await R.record(pool, { adminId: null, name: 'Telegram odam', kind: 'incomplete', question: 'q', answer, source: 'telegram' });
        const trow = (await pool.query('SELECT * FROM answer_feedback WHERE id = $1', [tg.id])).rows[0];
        assert.deepStrictEqual([trow.source, trow.submitted_by, trow.error_type], ['telegram', null, 'incomplete']);
        assert.strictEqual(privacy.open(trow.selected_text, 'answer_feedback.selected_text:null'), answer.slice(0, 300), 'no comment: the answer\'s opening');
        assert.deepStrictEqual(await R.record(pool, { adminId: id, kind: 'rude', answer }), { ok: false, code: 'invalid' });
        assert.deepStrictEqual(await R.record(pool, { adminId: id, kind: 'wrong', answer: 'qisqa' }), { ok: false, code: 'invalid' });
        process.env.ANSWER_RATING_MAX = '2';
        await R.record(pool, { adminId: id, kind: 'wrong', answer });
        assert.deepStrictEqual(await R.record(pool, { adminId: id, kind: 'wrong', answer }), { ok: false, code: 'too_many' });
        delete process.env.ANSWER_RATING_MAX;
        await pool.query('DELETE FROM answer_feedback WHERE id = $1', [tg.id]);
      });
    } finally {
      await pool.query('DELETE FROM answer_feedback WHERE submitted_by = $1', [id]).catch(() => {});
      await pool.query('DELETE FROM admins WHERE id = $1', [id]).catch(() => {});
      await pool.end();
    }
  } else console.log('  (database part skipped: TEST_DATABASE_URL not set)');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
