'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildOfficialEvidence,
  parseVerifierJson,
  crossCheckLegalAnswer,
} = require('../src/rag/legal-answer-cross-check');
const {
  extractOfficialActMentions,
  hydrateMentionedOfficialActChunks,
} = require('../src/rag/official-citation-hydrator');
const { normalizeLegalAnswerCitations } = require('../src/rag/citation-utils');

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
  document_number: '824',
  metadata: { act_form: "O'zbekiston Respublikasi Vazirlar Mahkamasining qarori" },
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
    assert.match(evidence, /\(VMQ-824\)/);
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

  await test('a generated VMQ mention missing from initial retrieval is resolved and linked', async () => {
    const title = 'Oʻzbekiston Respublikasiga xorijdan ishchi kuchini jalb qilish va undan foydalanish tartibi toʻgʻrisidagi nizomni tasdiqlash haqida';
    const answer = `Umumiy maʼmuriy tartib O‘zbekiston Respublikasi Vazirlar Mahkamasining 2019-yil 25-martdagi “${title}”gi qarori (VMQ-244) bilan belgilanadi.`;
    assert.deepStrictEqual(extractOfficialActMentions(answer).map((item) => item.identifier), ['VMQ-244']);
    let query = '';
    const hydrated = await hydrateMentionedOfficialActChunks(answer, [], {
      search: async (value) => {
        query = value;
        return [
          {
            title: 'Ayrim turdagi tovarlarni olib o‘tish tartibi to‘g‘risida',
            lawName: 'Ayrim turdagi tovarlarni olib o‘tish tartibi to‘g‘risida',
            url: 'https://lex.uz/docs/-7484114',
            ownDocumentNumber: { prefix: 'VMQ', number: '244' },
            metadata: { adoption_date: '2025-04-19', is_active: true, document_number: '244' },
          },
          {
            title,
            lawName: title,
            url: 'https://lex.uz/docs/-4251564',
            content: 'Xorijiy ishchi kuchini jalb qilish tartibi.',
            ownDocumentNumber: { prefix: 'VMQ', number: '244' },
            exactIdentityMatch: true,
            metadata: { adoption_date: '2019-03-26', is_active: true, document_number: '244' },
          },
        ];
      },
    });
    assert.match(query, /^VMQ-244\s/u);
    assert.strictEqual(hydrated.added.length, 1);
    assert.strictEqual(hydrated.added[0].source_url, 'https://lex.uz/docs/-4251564');
    const linked = normalizeLegalAnswerCitations(answer, hydrated.chunks);
    assert.match(linked, /\]\(https:\/\/lex\.uz\/docs\/-4251564\)/u);
    assert.strictEqual((linked.match(/lex\.uz\/docs\/-4251564/gu) || []).length, 1);
    assert.doesNotMatch(linked, /qarori\s*\(VMQ-244\)/u);
  });

  await test('an already retrieved official identifier does not trigger another live lookup', async () => {
    let searched = false;
    const hydrated = await hydrateMentionedOfficialActChunks(
      'VMQ-244 ushbu masalaga tatbiq etiladi.',
      [{ document_number: 'VMQ-244', source_url: 'https://lex.uz/docs/-4251564' }],
      { search: async () => { searched = true; return []; } }
    );
    assert.strictEqual(searched, false);
    assert.strictEqual(hydrated.chunks.length, 1);
  });

  await test('Web and Telegram production paths invoke the independent verifier', async () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    const telegram = fs.readFileSync(path.join(__dirname, '..', 'src', 'agents', 'telegram-agent.js'), 'utf8');
    assert.match(server, /LEX_CROSSCHECK_EVERY_ANSWER[^\n]*!== 'false'/);
    assert.match(server, /endpoint: '\/api\/legal-chat\/lex-cross-check'/);
    assert.match(server, /crossCheckLegalAnswer,\s*\n\s*hydrateMentionedOfficialActChunks,\s*\n\s*hydrateLexAnchors/);
    assert.match(telegram, /D\.hydrateMentionedOfficialActChunks\(text, chunks, \{ topic \}\)/);
    assert.match(telegram, /endpoint: '\/tg-agent\/lex-cross-check'/);
    assert.match(server, /lex-official-id-citations-v5/);
  });

  console.log(`\n${passed} passed\n`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
