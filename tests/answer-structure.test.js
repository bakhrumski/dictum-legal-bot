'use strict';

/**
 * A legal answer's quotes and next questions (src/rag/answer-structure.js):
 * a quote stays only when its words are in a retrieved source word for word
 * and then links the source highlighted; an invented one is removed; nothing
 * is linked or marked inside a quote; the next-question block leaves the
 * answer. No AI, no network.
 *
 *   node tests/answer-structure.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const st = require('../src/rag/answer-structure');
const { normalizeLegalAnswerCitationsDetailed } = require('../src/rag/citation-utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const LAW = "Mas'uliyati cheklangan jamiyatlar to'g'risida";
const art21 = "21-modda. Ulushni boshqa shaxsga o'tkazish\nJamiyat ishtirokchisi jamiyatning ustav fondidagi (ustav kapitalidagi) oʻz ulushini yoki uning bir qismini jamiyatning bir yoxud bir necha ishtirokchisiga sotishga yoki boshqacha tarzda begonalashtirishga haqli.\nBunday bitimni tuzish uchun jamiyatning yoki boshqa ishtirokchilarning roziligi talab qilinmaydi, agar jamiyat ustavida boshqacha qoida nazarda tutilmagan bo'lsa.";
const chunks = [{ source_url: 'https://lex.uz/docs/-8151376', law_name: LAW, document_number: "O'RQ-1137", articleNumber: '21', chunk_text: art21 }];

test('a quote found word for word stays, with a link that highlights it (apostrophe forms, case and spaces aside)', () => {
  const t = `**Huquqiy asos**\n\n${LAW} (O'RQ-1137), 21-modda:\n\n> «Jamiyat ishtirokchisi jamiyatning ustav fondidagi (ustav kapitalidagi) o'z ulushini yoki uning bir qismini jamiyatning bir yoxud bir necha ishtirokchisiga sotishga yoki boshqacha tarzda begonalashtirishga haqli»\n\n**Xulosa**\nMumkin.`;
  const r = normalizeLegalAnswerCitationsDetailed(t, chunks, 'uz');
  assert.deepStrictEqual([r.quotes.kept, r.quotes.removed], [1, 0]);
  const line = r.text.split('\n').find(l => l.startsWith('> «'));
  // since 2026-10-27 the link names the act and the article the quote is in
  const m = /\[O'RQ-1137, 21-modda · lex\.uz ↗\]\((https:\/\/lex\.uz\/docs\/-8151376#:~:text=([^)\s]+))\)$/u.exec(line);
  assert.ok(m, line);
  const [start, end] = m[2].split(',').map(decodeURIComponent);
  assert.strictEqual(start, 'Jamiyat ishtirokchisi jamiyatning ustav fondidagi (ustav kapitalidagi) oʻz', 'the source\'s own letters (oʻ), not the model\'s');
  assert.ok(line.includes("(ustav kapitalidagi) oʻz ulushini"), 'the quote shows the source\'s words');
  assert.strictEqual(end, 'sotishga yoki boshqacha tarzda begonalashtirishga haqli');
  assert.ok(!/\(manbasi ko'rsatilmagan\)|\[\*\*/u.test(line), 'nothing linked or marked inside the quote');
});

test('an invented or altered quote is removed and named; a quote with "..." needs each part in order in one source', () => {
  const t = `Asos:\n\n> «Ishtirokchi ulushni faqat notarial shaklda o'tkazishi shart»\n\n> «Jamiyat ishtirokchisi jamiyatning ustav fondidagi ... roziligi talab qilinmaydi»\n\n> «roziligi talab qilinmaydi ... Jamiyat ishtirokchisi jamiyatning»\n\nXulosa.`;
  const r = normalizeLegalAnswerCitationsDetailed(t, chunks, 'uz');
  assert.deepStrictEqual([r.quotes.kept, r.quotes.removed], [1, 2], r.text);
  assert.ok(!/notarial/u.test(r.text) && /ustav fondidagi \.\.\. roziligi/u.test(r.text));
  assert.ok(r.quotes.removedQuotes.some(q => /notarial/u.test(q)));
  assert.ok(/#:~:text=Jamiyat%20ishtirokchisi[^,]*,[^)]*talab%20qilinmaydi\)/u.test(r.text), 'range from the first part to the last');
  // too short to be a quote of a norm
  assert.strictEqual(st.findQuote('talab qilinmaydi', chunks), null);
});

test('the notice line and ordinary text with ">" are not quotes; a cached answer\'s linked quote stays without its sources', () => {
  const notice = '> ⚠️ Bu javob AI tahlili asosida. Muhim qarorlar uchun litsenziyalangan yuristga murojaat qiling.';
  assert.strictEqual(normalizeLegalAnswerCitationsDetailed(`A.\n\n${notice}`, chunks, 'uz').text, `A.\n\n${notice}`);
  const cached = '> «Jamiyat ishtirokchisi jamiyatning ustav fondidagi» [lex.uz ↗](https://lex.uz/docs/-8151376#:~:text=Jamiyat%20ishtirokchisi)';
  const r = normalizeLegalAnswerCitationsDetailed(`A.\n\n${cached}`, [], 'uz');
  assert.ok(r.text.includes(cached) && r.quotes.kept === 1);
});

test('a Cyrillic quote links the Cyrillic page', () => {
  const item = 'Ўзбекистон Республикаси ҳудудида меҳнат фаолиятини амалга ошириш ҳуқуқи тасдиқномаларини олмасдан туриб чет эллик мутахассисларни жалб этиш;';
  const ch = [{ source_url: 'https://lex.uz/docs/-4422250', law_name: 'Texnopark', chunk_text: `17. Технопарк резиденти:\n${item}` }];
  const r = normalizeLegalAnswerCitationsDetailed(`> «${item.replace(/;$/u, '')}»`, ch, 'uz');
  assert.ok(/\]\(https:\/\/lex\.uz\/docs\/4422250#:~:text=/u.test(r.text), r.text);
});

test('next questions: taken out of the answer (at most 2, each a question); no block, nothing changes', () => {
  const t = "**Xulosa**\nMumkin.\n\n**KEYINGI SAVOLLAR:**\n- Ulushni uchinchi shaxsga sotish tartibi qanday?\n- Notarial tasdiq qachon kerak?\n- Uchinchisi ortiqcha?\n\n> ⚠️ Bu javob AI tahlili asosida.";
  const r = st.extractFollowUpQuestions(t);
  assert.deepStrictEqual(r.questions, ['Ulushni uchinchi shaxsga sotish tartibi qanday?', 'Notarial tasdiq qachon kerak?']);
  assert.ok(!/KEYINGI|Uchinchisi|tartibi qanday/u.test(r.text) && /Mumkin\.\n\n> ⚠️/u.test(r.text), r.text);
  assert.deepStrictEqual(st.extractFollowUpQuestions('Keyingi savollar:\n1. Bu savol emas.\n2) Bu esa savolmi?').questions, ['Bu esa savolmi?']);
  assert.deepStrictEqual(st.extractFollowUpQuestions('Javob.'), { text: 'Javob.', questions: [] });
});

test('wired: the chat prompt asks for both; web chat returns followUpQuestions and quote counts; Telegram lists them; Workspace drops them; the page shows buttons', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  assert.ok(src.includes("require('../rag/answer-structure').promptRules(lexLangForText(userQuestion))"));
  assert.ok(/extractFollowUpQuestions\(displayReply\)/u.test(src) && /followUpQuestions,\n/u.test(src));
  assert.ok(/normalizeLegalAnswerCitationsDetailed\(displayReply, ragChunks, citationLanguage\)/u.test(src) && /quotes: normalized\.quotes/u.test(src));
  const tg = fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
  assert.ok(/followUpQuestions: followUp\.questions/u.test(tg) && /Yana so'rashingiz mumkin/u.test(tg));
  const { toTelegramMarkdown } = require('../src/agents/telegram-agent');
  assert.strictEqual(toTelegramMarkdown('> «Norma matni»'), '▎ «Norma matni»');
  // room for the quote and the next questions (2026-10-13): 1 400 by default, env in bounds
  const { telegramAnswerMaxTokens } = require('../src/agents/telegram-agent');
  assert.deepStrictEqual([telegramAnswerMaxTokens({}), telegramAnswerMaxTokens({ TG_ANSWER_MAX_TOKENS: '2000' }), telegramAnswerMaxTokens({ TG_ANSWER_MAX_TOKENS: '99999' })], [1400, 2000, 1400]);
  assert.ok(/maxTokens: telegramAnswerMaxTokens\(\), endpoint: '\/tg-agent\/answer'/u.test(tg));
  const ws = fs.readFileSync(path.join(__dirname, '../src/workspace/legal-answer-generator.js'), 'utf8');
  assert.ok(/extractFollowUpQuestions\(reply\)\.text/u.test(ws));
  const html = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.ok(/renderLegalFollowUps\(data\.followUpQuestions \|\| \[\]\)/u.test(html) && /askFollowUp\(this\.getAttribute/u.test(html));
  assert.ok(/QUOTE_RULE_UZ[\s\S]*so'zma-so'z topilmagan iqtibos javobdan olib tashlanadi/u.test(fs.readFileSync(path.join(__dirname, '../src/rag/answer-structure.js'), 'utf8')));
});

test("a quote's link names its act and unit: the act's number or short name, the heading above it, or a key line's unit", () => {
  const vmq = { law_name: 'Dasturiy mahsulotlar va axborot texnologiyalari texnologik parki faoliyatini tashkil etish chora-tadbirlari toʻgʻrisida', document_number: 'VMQ-589',
    chunk_text: "SAVOLGA ENG YAQIN QATOR (17-band) [server so'zlar bo'yicha tanlagan - o'qing va tekshiring]: Oʻzbekiston Respublikasi hududida mehnat faoliyatini amalga oshirish huquqi tasdiqnomalarini olmasdan turib chet ellik mutaxassislarni jalb etish;" };
  const code = { law_name: 'Oʻzbekiston Respublikasining Fuqarolik kodeksi (ikkinchi qism)', chunk_text: "641-modda. Boshqa\nmatn\n\n642-modda. Buyurtmachining huquqlari\nAgar pudratchi pudrat shartnomasini bajarishga oʻz vaqtida kirishmasa yoki ishni sust bajarsa" };
  const label = (q, c) => st.quoteSourceLabel(st.findQuote(q, [c]));
  assert.strictEqual(label('mehnat faoliyatini amalga oshirish huquqi tasdiqnomalarini olmasdan turib', vmq), 'VMQ-589, 17-band');
  assert.strictEqual(label('Agar pudratchi pudrat shartnomasini bajarishga oʻz vaqtida kirishmasa', code), 'Fuqarolik kodeksi (ikkinchi qism), 642-modda');
  assert.strictEqual(st.quoteSourceLabel({ chunk: {}, text: 'x', at: 1 }), '', 'nothing known: no label');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
