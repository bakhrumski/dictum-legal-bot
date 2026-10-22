'use strict';

/**
 * The claim-draft agent in the Telegram bot (2026-10-22): the person's free
 * text read into the claim's fields without inventing any, missing facts
 * asked for before any charge, the workflow's result, and the bot's wiring
 * (release on a question, resume on the answer, commit on delivery). Stubs
 * only - no network.
 *
 *   node tests/telegram-claim.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tc = require('../src/agents/telegram-claim');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const STORY = "Savol: Pudratchi ishni bajarmadi, avansni qaytarmayapti.\n\nDa'vogar: Aliyev Vali, Toshkent. Javobgar: \"Qurilish Servis\" MChJ. 2026-yil 10-martda pudrat shartnomasi tuzildi, avans 12 000 000 so'm to'landi, ish muddatida bajarilmadi. 12 000 000 so'm avansni undirishni so'rayman.";
const SOURCE = "Agar pudratchi ishni shartnomada belgilangan muddatda boshlamasa yoki bajarmasa, buyurtmachi shartnomani bajarishdan voz kechishga va zararni to'lashni talab qilishga haqli.";

function deps({ facts = null } = {}) {
  const calls = { cheap: 0, main: 0, draft: 0 };
  return {
    calls,
    callCheapAI: async (m) => {
      calls.cheap++;
      if (/maydonlarini ajrating/u.test(m[0].text)) return { text: JSON.stringify(facts || { plaintiff: { name: 'Aliyev Vali', details: 'Toshkent' }, defendant: { name: '"Qurilish Servis" MChJ' }, circumstances: "2026-yil 10-martda pudrat shartnomasi tuzildi, avans 12 000 000 so'm to'landi, ish muddatida bajarilmadi va pul qaytarilmadi.", demands: "12 000 000 so'm avansni undirish", amount: "12 000 000 so'm" }) };
      return { text: '{"caseType":"iqtisodiy","queries":["pudrat avans qaytarish"]}' };
    },
    callAI: async () => { calls.main++; return { text: JSON.stringify({ basis: [{ demand: 'avans', sourceId: 'S1', quote: SOURCE.slice(0, 110) }] }) }; },
    retrieve: async () => ({ chunks: [{ law_name: 'Fuqarolik kodeksi', article_number_display: '637', chunk_text: SOURCE, source_url: 'https://lex.uz/docs/111181' }] }),
    generateDraftHtml: async () => { calls.draft++; return { html: "<p>Toshkent shahar iqtisodiy sudiga</p><p>Da'vogar: Aliyev Vali</p><p>Javobgar: Qurilish Servis</p><p>FK 637-moddasiga asosan 12 000 000 so'm undirishni so'rayman.</p><p>Ilovalar: shartnoma.</p>" }; },
  };
}

(async () => {
  await test('facts: read from the text only; the whole text stands in for a story the model kept too short', async () => {
    const d = deps({ facts: { plaintiff: { name: 'Aliyev Vali' }, defendant: { name: 'Qurilish Servis' }, circumstances: 'qisqa', demands: 'avansni undirish' } });
    const { facts } = await tc.extractFacts(STORY, { callCheapAI: d.callCheapAI });
    assert.strictEqual(facts.plaintiff.name, 'Aliyev Vali');
    assert.match(facts.circumstances, /pudrat shartnomasi tuzildi/u, 'the person\'s own words, not the model\'s');
    const broken = await tc.extractFacts(STORY, { callCheapAI: async () => ({ text: 'kechirasiz' }) });
    assert.strictEqual(broken.facts.plaintiff.name, '', 'nothing invented when the reading fails');
  });

  await test('run: missing parties stop before the workflow (no search, no drafting), with the questions', async () => {
    const d = deps({ facts: { circumstances: STORY, demands: 'avansni undirish' } });
    const agent = tc.createTelegramClaimAgent(d);
    const r = await agent.run(STORY);
    assert.strictEqual(r.status, 'needs_input');
    assert.deepStrictEqual(r.missing.map(m => m.field), ['plaintiff.name', 'defendant.name']);
    assert.deepStrictEqual([d.calls.main, d.calls.draft], [0, 0]);
  });

  await test('run: a complete story gives the draft, the checked basis and the warnings; steps are reported', async () => {
    const d = deps();
    const steps = [];
    const r = await tc.createTelegramClaimAgent(d).run(STORY, { onStep: (e) => steps.push(`${e.id}:${e.status}`) });
    assert.strictEqual(r.status, 'done');
    assert.match(r.html, /637-moddasiga/u);
    assert.strictEqual(r.basis[0].article, '637');
    assert.ok(steps.includes('research:running') && steps.includes('verify:ok'));
    const text = tc.resultText(r);
    assert.match(text, /Fuqarolik kodeksi, 637-modda: «Agar pudratchi/u);
    assert.match(text, /https:\/\/lex\.uz\/docs\/111181/u);
    assert.match(text, /Tekshiring:/u);
    assert.ok(text.length <= 3900);
  });

  await test('bot wiring: claims go to the agent; a question releases the unit and the next message resumes; delivery commits', () => {
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.match(bot, /if \(o\.slug === 'claim' && claimAgent\) return runClaimAgent\(chatId, from, o, job\);/u);
    assert.match(bot, /ledger\.release\(job\.jobKey, 'claim_needs_input'\)/u);
    assert.match(bot, /Birlik hali yechilmadi/u);
    assert.match(bot, /await resumeClaimAgent\(msg\)\) return;/u);
    assert.match(bot, /ledger\.release\(job\.jobKey, 'claim_failed'\)/u);
    assert.match(bot, /setClaimAgent: \(a\) =>/u);
    // the agent note is shown whether the draft is paid by a unit or by Stars
    assert.strictEqual((bot.match(/\$\{agentNote\}|\+ agentNote/gu) || []).length, 2);
    // the order's "Bekor qilish" ends the wait for details and any claim question
    assert.match(bot, /if \(data === 'docin_cancel'\) \{\n\s+await require\('\.\.\/agents\/telegram-agent'\)\.setConversationState\(chatId, 'idle', \{\}\);\n\s+claimAwait\.delete\(String\(chatId\)\);/u);
    assert.match(bot, /callback_data: 'docin_cancel'/u);
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /process\.env\.TG_CLAIM_AGENT \|\| 'on'/u);
    assert.match(server, /setClaimAgent\(require\('\.\.\/agents\/telegram-claim'\)\.createTelegramClaimAgent/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
