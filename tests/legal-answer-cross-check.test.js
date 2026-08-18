'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildOfficialEvidence,
  parseVerifierJson,
  crossCheckLegalAnswer,
} = require('../src/rag/legal-answer-cross-check');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const officialChunk = {
  source_type: 'lex_live',
  law_name: 'Vazirlar Mahkamasining 824-son qarori bilan tasdiqlangan Nizom',
  source_url: 'https://lex.uz/uz/docs/-5193564',
  article_numbers: ['41'],
  provision_type: 'band',
  chunk_text: '41. Auditoriya soatining 25 foizini sababsiz qoldirgan talaba yakuniy nazoratga kiritilmaydi.',
};

(async () => {
  console.log('\nindependent Lex.uz answer cross-check\n');

  await test('only freshly retrieved HTTPS Lex.uz chunks become verifier evidence', async () => {
    const evidence = buildOfficialEvidence([
      officialChunk,
      { ...officialChunk, source_type: 'law_text', source_url: 'https://lex.uz/docs/1' },
      { ...officialChunk, source_url: 'https://example.com/fake' },
    ]);
    assert.match(evidence, /41-band/);
    assert.match(evidence, /lex\.uz\/uz\/docs\/-5193564/);
    assert.strictEqual((evidence.match(/\[LEX-/g) || []).length, 1);
  });

  await test('fenced verifier JSON is parsed and validated', async () => {
    const parsed = parseVerifierJson('```json\n{"status":"pass","reason":"mos","unsupported_claims":[],"corrected_answer":""}\n```');
    assert.deepStrictEqual(parsed, {
      status: 'pass', reason: 'mos', unsupportedClaims: [], correctedAnswer: '',
    });
    assert.strictEqual(parseVerifierJson('{"status":"maybe"}'), null);
  });

  await test('a passing independent check preserves the generated answer', async () => {
    let options;
    const result = await crossCheckLegalAnswer({
      question: 'Yakuniy nazoratdan chetlashtirish mumkinmi?',
      answer: 'Dastlabki, manbali huquqiy javob.',
      chunks: [officialChunk],
      callAI: async (_messages, opts) => {
        options = opts;
        return { text: '{"status":"pass","reason":"41-bandga mos","unsupported_claims":[],"corrected_answer":""}', provider: 'luna' };
      },
    });
    assert.strictEqual(result.status, 'pass');
    assert.strictEqual(result.answer, 'Dastlabki, manbali huquqiy javob.');
    assert.strictEqual(options.model, 'gpt-5.6-luna');
    assert.strictEqual(options.useSearch, false);
  });

  await test('a complete correction replaces unsupported legal claims', async () => {
    const corrected = '**Huquqiy asos**\n824-son qaror 41-bandi qo‘llanadi.\n\n**Tahlil**\n25 foiz mezoni tekshiriladi.\n\n**Xulosa**\nDavomat hisobini so‘rang.';
    const result = await crossCheckLegalAnswer({
      question: 'Meni imtihondan chetlatishdi.',
      answer: 'Faqat Ta’lim to‘g‘risidagi qonun qo‘llanadi.',
      chunks: [officialChunk],
      callAI: async () => ({
        text: JSON.stringify({
          status: 'revise', reason: 'maxsus norma yetishmagan',
          unsupported_claims: ['faqat umumiy qonun'], corrected_answer: corrected,
        }),
      }),
    });
    assert.strictEqual(result.status, 'revised');
    assert.strictEqual(result.answer, corrected);
    assert.deepStrictEqual(result.unsupportedClaims, ['faqat umumiy qonun']);
  });

  await test('missing official evidence is explicit and spends no model token', async () => {
    let called = false;
    const result = await crossCheckLegalAnswer({
      question: 'Savol', answer: 'Javob', chunks: [],
      callAI: async () => { called = true; },
    });
    assert.strictEqual(result.status, 'insufficient');
    assert.strictEqual(result.checked, false);
    assert.strictEqual(called, false);
  });

  await test('Web and Telegram production paths invoke the independent verifier', async () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    const telegram = fs.readFileSync(path.join(__dirname, '..', 'src', 'agents', 'telegram-agent.js'), 'utf8');
    assert.match(server, /LEX_CROSSCHECK_EVERY_ANSWER[^\n]*!== 'false'/);
    assert.match(server, /endpoint: '\/api\/legal-chat\/lex-cross-check'/);
    assert.match(server, /crossCheckLegalAnswer,\s*\n\s*hydrateLexAnchors/);
    assert.match(telegram, /endpoint: '\/tg-agent\/lex-cross-check'/);
    assert.match(server, /lex-always-cross-check-v4/);
  });

  console.log(`\n${passed} passed\n`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
