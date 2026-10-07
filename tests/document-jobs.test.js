'use strict';

/**
 * Chat with a document (tariffs v2 review, 2026-10-06), no database:
 *   - the work asked for decides the service: a question is a chat answer,
 *     an analysis is the analysis service, a legal opinion the opinion
 *     service, both are two jobs;
 *   - a question gets the clauses that answer it - with the definitions
 *     they use, the clauses they refer to and the exceptions that refer back
 *     - not the opening pages; when that is not enough the answer must say
 *     so and not conclude;
 *   - Workspace uses the same excerpt and names the service asked for.
 *
 *   node tests/document-jobs.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const docJob = require('../src/rag/document-job');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// A 43 000-character supply contract. The penalty clause the question is
// about is near the END (14.3); it relies on the delivery term in 7.2,
// which is counted in «Ish kuni» defined in 1.4; 14.5 excludes force
// majeure, defined in section 16. Fillers share none of the question's words.
function contract({ dropClause = null } = {}) {
  const filler = n => `${n}. Tomonlar ushbu bo'limda hisobot shakllarini, arxiv saqlash tartibini va xodimlarni o'qitish rejasini kelishadi. `.repeat(14);
  const parts = ['YETKAZIB BERISH SHARTNOMASI № 17\nToshkent sh., 2026-yil 1-sentabr\n"Alfa" MChJ (Yetkazib beruvchi) va "Beta" AJ (Xaridor)\n',
    '1. ATAMALAR',
    "1.1. «Tovar» — ushbu shartnoma ilovasida ko'rsatilgan mahsulot.",
    "1.4. «Ish kuni» — O'zbekiston Respublikasida dam olish va bayram kuni hisoblanmagan kun."];
  for (let i = 2; i <= 6; i++) parts.push(filler(i));
  parts.push('7. YETKAZIB BERISH', '7.1. Tovar Xaridor omboriga topshiriladi.');
  if (dropClause !== '7.2') parts.push('7.2. Yetkazib berish muddati — buyurtma olingandan keyin 10 ish kuni.');
  for (let i = 8; i <= 13; i++) parts.push(filler(i));
  parts.push('14. JAVOBGARLIK', '14.1. Tomonlar qonunchilikka muvofiq javob beradi.',
    "14.3. 7.2-bandda belgilangan muddat buzilganda Yetkazib beruvchi har bir kechiktirilgan kun uchun tovar qiymatining 0,5 foizi miqdorida penya to'laydi.",
    "14.5. 14.3-band 16-bo'limda nazarda tutilgan fors-major holatlarida qo'llanilmaydi.");
  parts.push(filler(15));
  parts.push('16. FORS-MAJOR', '16.1. Fors-major — tomonlar nazorat qila olmaydigan favqulodda holatlar (zilzila, urush).');
  for (let i = 17; i <= 30; i++) parts.push(filler(i));
  return parts.join('\n');
}

(async () => {
  console.log('which service a chat with a document is');

  await test('a question is chat; analysis -> analysis; a legal opinion -> opinion; both -> both (uz Latin, uz Cyrillic, ru)', () => {
    const cases = [
      ['Shartnomaning 5-bandi qonuniymi?', []],
      ['Пункт 3 законен?', []],
      ['Jarima summasi nechchi?', []],
      ['Ushbu hujjatni tahlil qiling', ['analysis']],
      ["Shartnomani to'liq tekshirib bering", ['analysis']],
      ['Проанализируйте договор', ['analysis']],
      ['Ҳужжатни текшириб беринг', ['analysis']],
      ["Shu hujjat bo'yicha yuridik xulosa yozing", ['opinion']],
      ["Shartnoma bo'yicha xulosa tayyorlang", ['opinion']],
      ['Нужно юридическое заключение по договору', ['opinion']],
      ['Шартнома бўйича юридик хулоса ёзинг', ['opinion']],
      ['Hujjatni tahlil qilib, yuridik xulosa tayyorlang', ['analysis', 'opinion']],
      // "xulosa bering" at the end of an analysis request is its conclusion, not a second service
      ['Shartnomani tahlil qilib xulosa bering', ['analysis']],
    ];
    for (const [q, want] of cases) assert.deepStrictEqual(docJob.requestedServices(q), want, q);
  });

  await test('the web chat meters each ordered service from its own quota, confirmed first, never as chat too', () => {
    const tiers = read('src/rag/subscription-tiers.js');
    const fn = tiers.slice(tiers.indexOf('function enforceChatQuota'), tiers.indexOf('function enforceQuota('));
    assert.match(fn, /docJob\.requestedServices\(body\.message\)/u);
    assert.match(fn, /const m = await meterDocuments\(req, res, \{ services, text: doc,/u, 'all ordered services reserved together');
    const md = tiers.slice(tiers.indexOf('async function meterDocuments'), tiers.indexOf('async function quoteDocument'));
    assert.match(md, /ledger\.reserveMany\(\{[\s\S]*?jobs: rest\.map\(sv => \(\{ service: sv, units: size\.units/u, 'one job per service, each its own service, one transaction');
    assert.match(md, /adoptHeldScanJob\(req, res, \{ service: sv, units: size\.units/u, 'a service a scan\'s OCR already reserved is adopted, not reserved twice');
    assert.match(md, /section: true/u, 'each settled on its own section');
    assert.match(fn, /code: 'DOC_COST_CONFIRM', service: services\[0\], services, quote: quotes\[0\], quotes/u);
    assert.ok(!/service: 'analysis'/u.test(fn), 'an opinion is never metered as analysis');
    assert.match(fn, /if \(!services\.length\) \{[\s\S]*?return chat\(req, res, next\);/u, 'only a question takes the chat unit');
  });

  await test('the dashboard shows one line per service and confirms each one', () => {
    const html = read('public/dashboard.html');
    assert.match(html, /renderDocCostCard\(confServices, conf\.quotes \|\| \[conf\.quote\], conf\.message\)/u);
    assert.match(html, /confirmedJob\[confServices\[i\]\] = qq\.units/u);
    assert.match(html, /\(' \+ quota \+ ' limitidan\)/u);
  });

  console.log('what of the document a question gets');

  await test('a clause at the end of the document, the clause it refers to, its definitions and its exception are all in', () => {
    const doc = contract();
    assert.ok(doc.length > 2 * docJob.CHAT_DOCUMENT_CONTEXT_CHARS);
    const ex = docJob.selectExcerpt(doc, "Yetkazib berish kechiksa qancha penya to'lanadi?");
    assert.ok(ex.excerpt && ex.usedChars <= docJob.CHAT_DOCUMENT_CONTEXT_CHARS);
    assert.match(ex.text, /14\.3\. 7\.2-bandda belgilangan muddat buzilganda/u, 'the clause near the end');
    assert.match(ex.text, /7\.2\. Yetkazib berish muddati — buyurtma olingandan keyin 10 ish kuni/u, 'the clause it refers to');
    assert.match(ex.text, /1\.4\. «Ish kuni» —/u, 'the definition of a term the referred clause uses');
    assert.match(ex.text, /14\.5\. 14\.3-band 16-bo'limda/u, 'the exception that refers back to it');
    assert.match(ex.text, /16\.1\. Fors-major —/u, 'and the section the exception invokes');
    assert.ok(!/arxiv saqlash tartibini/u.test(ex.text), 'no unrelated clause fills the budget');
    assert.ok(ex.text.indexOf('YETKAZIB BERISH SHARTNOMASI') === 0 && ex.usedChars < 3000, 'the opening is a small fixed part, not the budget');
    assert.deepStrictEqual([ex.insufficient, ex.missingReferences], [false, []]);
    assert.ok(ex.referenced.includes('7.2') && ex.referenced.includes('16'));
  });

  await test('a clause the answer relies on that is not there: named, insufficient, no firm conclusion, full service offered', () => {
    const ex = docJob.selectExcerpt(contract({ dropClause: '7.2' }), "Yetkazib berish kechiksa qancha penya to'lanadi?");
    assert.match(ex.text, /14\.3\./u);
    assert.deepStrictEqual([ex.insufficient, ex.missingReferences], [true, ['7.2']]);
    assert.match(docJob.excerptInstruction(ex), /qat'iy xulosa uchun yetarli emas \(7\.2-band\(lar\) berilmagan\): buni aniq ayting, qat'iy xulosa bermang va butun hujjat tahlilini taklif qiling/u);
    assert.match(docJob.excerptNote(ex, 2), /⚠️[\s\S]*7\.2-band\(lar\) parchaga kirmadi, shuning uchun qat'iy xulosa berilmadi[\s\S]*alohida xizmat \(2 birlik\)/u);
    assert.match(docJob.excerptInstruction(ex, 'ru'), /не делайте категоричного вывода и предложите полный анализ/u);
  });

  await test('nothing in the document matches: no guess from the opening pages - the outline, and the answer must say so', () => {
    const ex = docJob.selectExcerpt(contract(), 'Ijara haqi qachon oshiriladi?');
    assert.ok(ex.insufficient);
    assert.ok(ex.usedChars < 5000, `not the first 20 000 characters (${ex.usedChars})`);
    assert.match(ex.text, /Savol so'zlari hujjatda topilmadi/u);
    assert.match(ex.text, /14\.3\. 7\.2-bandda/u, 'the outline lists the clauses');
    assert.match(docJob.excerptInstruction(ex), /savolga oid band topilmadi/u);
  });

  await test('a clause named in the question is taken first; a short document is passed whole', () => {
    const ex = docJob.selectExcerpt(contract(), '14.5-band qachon qo\'llaniladi?');
    assert.match(ex.text, /14\.5\. 14\.3-band/u);
    assert.ok(ex.matched.includes('14.5'));
    const short = docJob.selectExcerpt('Qisqa shartnoma.', 'savol');
    assert.deepStrictEqual([short.excerpt, short.insufficient], [false, false]);
  });

  await test('a document job reports which quota each service used', () => {
    assert.match(docJob.excerptNote({ mode: 'document', services: ['analysis', 'opinion'], units: 2 }),
      /Hujjat tahlili: 2 birlik tahlil limitidan; AI yuridik xulosa: 2 birlik xulosa limitidan\. Chat limiti yechilmadi\./u);
    assert.match(docJob.serviceInstruction(['opinion']), /AI yuridik xulosa/u);
  });

  console.log('Workspace');

  await test('Workspace documents use the same clause-aware excerpt, and say when a clause is missing', () => {
    const { documentContextBlocks } = require('../src/workspace/ai-service');
    const blocks = documentContextBlocks([{ title: 'Shartnoma', version_number: 1, content_text: contract({ dropClause: '7.2' }) }],
      "Yetkazib berish kechiksa qancha penya to'lanadi?");
    assert.match(blocks[0], /14\.3\. 7\.2-bandda/u);
    assert.match(blocks[0], /Parchaga kirmagan, javob tayanadigan band\(lar\): 7\.2\. Qat'iy xulosa bermang\./u);
  });

  await test('Workspace: a full analysis or opinion of a document is routed (no AI, no quota, not shown as done); other questions are answered', async () => {
    const cases = [
      ["Shartnoma bo'yicha yuridik xulosa yozing", ['opinion']],
      ['Shartnomani tahlil qiling', ['analysis']],
      ['Hujjatni tahlil qilib, yuridik xulosa tayyorlang', ['analysis', 'opinion']],
      ['14.3-band qachon qo\'llaniladi?', []],
      ['Vaziyatni tahlil qilib bering: ish haqi kechikdi', []],
    ];
    for (const [q, want] of cases) assert.deepStrictEqual(docJob.workspaceDocumentServices(q), want, q);
    const reply = docJob.workspaceRoutingReply(['analysis', 'opinion']);
    assert.match(reply, /«Hujjat tahlili» va «AI yuridik xulosa» Workspace ichida hozircha bajarilmaydi — bu javob tahlil ham, xulosa ham emas/u);
    assert.match(reply, /AI bo'limida bor[\s\S]*ish boshlanishidan oldin ko'rsatiladi/u);
    assert.match(reply, /limitingizdan hech narsa yechmadi/u);
    const routes = read('src/workspace/routes.js');
    assert.match(routes, /'\/workspaces\/:workspaceId\/assistant\/ask', aiLimiter \|\| \(\(req, res, next\) => next\(\)\), workspaceServiceRouting, workspaceAiQuota,/u, 'routing runs before the quota');
    const fn = routes.slice(routes.indexOf('function createWorkspaceServiceRouting'), routes.indexOf('function translateDatabaseError'));
    assert.ok(fn.indexOf('await requireAccess(') < fn.indexOf('res.json('), 'access is checked before answering');
    const ws = read('public/js/workspace.js');
    assert.match(ws, /if\(action\.kind==='service'\) \{[\s\S]*?global\.switchTab\('ai'\)[\s\S]*?action\.service==='opinion'\?global\.modeOpinion:global\.modeAnalyzer/u, 'the button opens the right service');
    assert.match(ws, /result\.routed\?'<span>'\+esc\(t\('routedNoQuota'\)\)/u, 'shown as a redirect, not as a generated answer');
    // what reaches the assistant still answers on excerpts and says when they are not enough
    const { createWorkspaceLegalAnswerGenerator } = require('../src/workspace/legal-answer-generator');
    const prompts = [];
    const gen = createWorkspaceLegalAnswerGenerator({
      callAI: async (messages) => { prompts.push(messages[0].text); return { text: 'Parchalar asosida javob.', provider: 'stub', model: 'stub' }; },
      retrieveLegalContext: async () => ({ context: '', chunks: [], meta: null }),
      buildTopicPrompt: () => 'SYSTEM', classifyLegalTopic: async () => 'civil', hasAiProvider: () => true, pool: null,
    });
    const q = await gen({ question: 'Penya necha foiz?', workspaceContext: 'HUJJAT: Shartnoma (v1)\n14.3. Penya 0,5%.' });
    assert.ok(!/alohida xizmat/u.test(q.reply), 'no service note on an ordinary answer');
    assert.match(prompts[0], /buni aniq ayting va qat'iy xulosa bermang/u);
  });

  await test('two services in one answer are settled per section: a missing section is given back, a format slip is not free', () => {
    const A = '## Hujjat tahlili\n' + 'Tahlil. '.repeat(40);
    const O = '## Yuridik xulosa\n' + 'Xulosa. '.repeat(40);
    assert.deepStrictEqual(docJob.settleSections(`${A}\n${O}`, ['analysis', 'opinion']), { analysis: 'delivered', opinion: 'delivered' });
    assert.deepStrictEqual(docJob.settleSections(`${A}\n## Yuridik xulosa\nXato`, ['analysis', 'opinion']), { analysis: 'delivered', opinion: 'not_delivered' });
    assert.deepStrictEqual(docJob.settleSections('Sarlavhasiz to\'liq javob. '.repeat(40), ['analysis', 'opinion']), { analysis: 'delivered', opinion: 'delivered' });
    assert.deepStrictEqual(docJob.settleSections('', ['analysis', 'opinion']), { analysis: 'not_delivered', opinion: 'not_delivered' });
    assert.match(docJob.serviceInstruction(['analysis', 'opinion']), /bo'lim sarlavhalari aynan: "## Hujjat tahlili" va "## Yuridik xulosa"/u);
    assert.match(read('src/api/server.js'), /obj\.type === 'token' && typeof obj\.t === 'string'\) res\.locals\.deliveredText/u, 'the stream records what was delivered');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
