'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  buildLexDeepLink,
  findCitationPartNumber,
  linkCitationsInMarkdown,
  normalizeOfficialDocumentIdentifier,
  getChunkDocumentIdentifier,
  normalizeLegalAnswerCitations,
} = require('../src/rag/citation-utils');
const { parseLexStructured, chunkByArticle } = require('../src/rag/structural-chunker');
const {
  buildAnchorIndexFromHtml,
  buildLexAnchorFallbackUrl,
  normalizeSourceUrl,
  resolveKnownLexAnchorUrl,
} = require('../src/rag/lex-anchor-resolver');
const { buildLegalNextActions } = require('../src/services/legal-next-actions');
const { deterministicLegalTopic } = require('../src/services/legal-topic-routing');
const { parseSearchResults } = require('../src/rag/lex-live-search');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('\ncitation deep links\n');

test('stable Lex.uz element IDs are preferred for an exact qism', () => {
  const url = buildLexDeepLink({
    source_url: 'https://lex.uz/uz/docs/6257288#old',
    part_number: '1',
    lex_element_id: '6263814',
    childText: 'Birinchi qism matni.',
  }, { articleRef: '253', partNumber: '1' });
  assert.strictEqual(url, 'https://lex.uz/docs/-6257288#-6263814');
});

test('negative Lex.uz element IDs are valid deep-link anchors', () => {
  const url = buildLexDeepLink({
    source_url: 'https://lex.uz/docs/-5953883',
    lex_element_id: '-5954624',
    childText: '7. Mexanik transport vositasining haydovchisi.',
  }, { articleRef: '7' });
  assert.strictEqual(url, 'https://lex.uz/docs/-5953883#-5954624');
});

test('existing rows deep-link by the exact requested qism text', () => {
  const url = buildLexDeepLink({
    source_url: 'https://lex.uz/uz/docs/6257288',
    // This is the article anchor, not the requested second-qism anchor.
    lex_element_id: '6263813',
    childText: '253-modda — 1-qism:\nBirinchi qism matni.',
    parentText: [
      '253-modda. Ish haqini to‘lash muddatlari',
      'Birinchi qism matni.',
      'Ikkinchi qism aynan kerakli huquqiy qoida.',
    ].join('\n'),
  }, { articleRef: '253', partNumber: '2' });
  assert.ok(url.startsWith('https://lex.uz/docs/-6257288#:~:text='));
  assert.strictEqual(decodeURIComponent(url.split('text=')[1]), 'Ikkinchi qism aynan kerakli huquqiy qoida.');
});

test('qism suffixes are detected and linked inside the answer', () => {
  const answer = [
    'Huquqiy asos',
    'Mehnat kodeksi, 253-moddasi, 2-qismiga ko‘ra ish haqi to‘lanadi.',
    '',
    'Tahlil',
    'Mehnat kodeksi, 253-moddasi, 2-qismiga ko‘ra bu talab buzilgan.',
    '',
    'Xulosa',
    'Yozma talab yuboring.',
  ].join('\n');
  const chunk = {
    law_name: 'Mehnat kodeksi',
    article_numbers: ['253'],
    source_url: 'https://lex.uz/uz/docs/6257288',
    parentText: '253-modda. Sarlavha\nBirinchi qism.\nIkkinchi qism aynan kerakli qoida.',
  };
  assert.strictEqual(findCitationPartNumber(answer, '253'), '2');
  const linked = linkCitationsInMarkdown(answer, [chunk], 'uz');
  assert.match(linked, /\[\*\*Mehnat kodeksi, 253-modda, 2-qism\*\*\]\(https:\/\/lex\.uz\/docs\/-6257288#:~:text=/u);
  assert.match(linked, /\)ga ko‘ra/u);
  assert.strictEqual((linked.match(/\]\(https:\/\/lex\.uz/gu) || []).length, 2);
});

test('every grounded provision is clickable across all answer sections', () => {
  const answer = [
    'Huquqiy asos',
    "Ta'lim to'g'risida Qonuni 47-moddasi talabaning huquqlarini belgilaydi.",
    '',
    'Tahlil',
    "Ta'lim to'g'risida Qonuni 48-moddasi majburiyatlarni belgilaydi.",
    '',
    'Xulosa',
    'Yozma asosni talab qiling.',
  ].join('\n');
  const chunks = ['47', '48'].map(article => ({
    law_name: "Ta'lim to'g'risida Qonuni",
    article_numbers: [article],
    source_url: 'https://lex.uz/uz/docs/-5013007',
    chunk_text: `${article}-modda. Rasmiy norma matni.`,
  }));
  const linked = linkCitationsInMarkdown(answer, chunks, 'uz');
  assert.strictEqual((linked.match(/\]\(https:\/\/lex\.uz\/uz\/docs\/-5013007#:~:text=/gu) || []).length, 2);
});

test('live Lex titles link natural Uzbek law-name variants', () => {
  const answer = [
    'Huquqiy asos',
    "Ta'lim to'g'risidagi Qonun, 47-moddasiga ko'ra talaba sifatli ta'lim olish huquqiga ega.",
  ].join('\n');
  const chunk = {
    law_name: "Ta'lim to'g'risida",
    article_numbers: ['47'],
    source_url: 'https://lex.uz/uz/docs/-5013007',
    chunk_text: "47-modda. Ta'lim oluvchilarning huquqlari.",
  };
  const linked = linkCitationsInMarkdown(answer, [chunk], 'uz');
  assert.match(linked, /\[\*\*Ta'lim to'g'risida, 47-modda, tegishli qism\*\*\]\(https:\/\/lex\.uz\/uz\/docs\/-5013007#:~:text=/u);
});

test('grouped law provisions are rendered as separate grounded links', () => {
  const answer = [
    'Tahlil',
    "Ma'muriy javobgarlik to'g'risidagi kodeksi, 281 va 294-moddalar qo'llanadi.",
  ].join('\n');
  const chunks = ['281', '294'].map(article => ({
    law_name: "Ma'muriy javobgarlik to'g'risidagi kodeksi",
    article_numbers: [article],
    source_url: 'https://lex.uz/docs/-97664',
    chunk_text: `${article}-modda. Rasmiy norma matni.`,
  }));
  const linked = linkCitationsInMarkdown(answer, chunks, 'uz');
  assert.strictEqual((linked.match(/\[\*\*Ma'muriy javobgarlik/gu) || []).length, 2);
  assert.match(linked, /281-modda, tegishli qism/u);
  assert.match(linked, /294-modda, tegishli qism/u);
  assert.strictEqual((linked.match(/\]\(https:\/\/lex\.uz\/docs\/-97664#:~:text=/gu) || []).length, 2);
});

test('existing Markdown citations are normalized to the canonical named style', () => {
  const answer = 'Tahlil\nMehnat kodeksi [253-moddasi](https://lex.uz/docs/111111) qo‘llanadi.';
  const chunk = {
    law_name: 'Mehnat kodeksi',
    article_numbers: ['253'],
    source_url: 'https://lex.uz/uz/docs/6257288',
  };
  const linked = linkCitationsInMarkdown(answer, [chunk]);
  assert.match(linked, /\[\*\*Mehnat kodeksi, 253-modda, tegishli qism\*\*\]/u);
  assert.doesNotMatch(linked, /https:\/\/lex\.uz\/docs\/111111/u);
});

test('raw Lex attributions and the separate Manbalar footer are removed', () => {
  const answer = [
    'Tahlil',
    'Mehnat kodeksi, 253-moddasiga ko\'ra ish haqi to\'lanadi. (lex.uz: https://lex.uz/uz/docs/6257288)',
    '',
    'Xulosa',
    'Yozma talab yuboring.',
    '',
    '---',
    '**Manbalar:**',
    '- [Mehnat kodeksi](https://lex.uz/uz/docs/6257288)',
  ].join('\n');
  const chunk = {
    law_name: 'Mehnat kodeksi',
    article_numbers: ['253'],
    source_url: 'https://lex.uz/uz/docs/6257288',
  };
  const normalized = normalizeLegalAnswerCitations(answer, [chunk]);
  assert.match(normalized, /\[\*\*Mehnat kodeksi, 253-modda, tegishli qism\*\*\]/u);
  assert.doesNotMatch(normalized, /Manbalar|lex\.uz:/u);
});

test('canonical exact links survive cached answers without RAG chunks', () => {
  const cached = 'Tahlil\n[**Mehnat kodeksi, 161-modda, tegishli qism**](https://lex.uz/uz/docs/6257288#6261450)ga ko‘ra bo‘shatish asoslangan bo‘lishi kerak.';
  const normalized = normalizeLegalAnswerCitations(cached, []);
  assert.strictEqual(normalized, cached);
});

test('structural ingest preserves article and qism element IDs', () => {
  const html = `
    <div class="ACT_TITLE"><a id="6000000">O‘zbekiston Respublikasining Mehnat kodeksi</a></div>
    <div id="divCont">
      <div class="lx_elem CLAUSE_DEFAULT"><a id="6263813">253-modda. Ish haqini to‘lash muddatlari</a></div>
      <div class="lx_elem ACT_TEXT"><a id="6263814">Ish haqi belgilangan muddatlarda to‘lanadi.</a></div>
      <div class="lx_elem ACT_TEXT"><a id="6263815">Ish haqi kamida har yarim oyda bir marta to‘lanadi.</a></div>
    </div>`;
  const parsed = parseLexStructured(html, 'https://lex.uz/uz/docs/6257288');
  assert.strictEqual(parsed.articles[0].lexElementId, '6263813');
  assert.deepStrictEqual(parsed.articles[0].parts.map(part => part.lexElementId), ['6263814', '6263815']);

  const chunks = chunkByArticle(parsed.articles, {
    law_name: 'Mehnat kodeksi',
    doc_id: 'mk',
    source_url: 'https://lex.uz/uz/docs/6257288',
  });
  const children = chunks.filter(chunk => chunk.chunkType === 'child');
  assert.deepStrictEqual(children.map(chunk => chunk.metadata.lexElementId), ['6263814', '6263815']);
});

test('legacy rows use the resolved stable article/qism anchor map', () => {
  const html = `
    <div class="ACT_TITLE"><a id="6000000">Mehnat kodeksi</a></div>
    <div id="divCont">
      <div class="lx_elem CLAUSE_DEFAULT"><a id="6263813">253-modda. Ish haqi</a></div>
      <div class="lx_elem ACT_TEXT"><a id="6263814">Birinchi qism.</a></div>
      <div class="lx_elem ACT_TEXT"><a id="6263815">Ikkinchi qism.</a></div>
    </div>`;
  const index = buildAnchorIndexFromHtml(html, 'https://lex.uz/uz/docs/6257288');
  assert.strictEqual(index['253'], '6263813');
  assert.strictEqual(index['253:2'], '6263815');
  assert.strictEqual(buildLexDeepLink({
    source_url: 'https://lex.uz/uz/docs/6257288',
    lex_anchor_ids: index,
  }, { articleRef: '253', partNumber: '2' }), 'https://lex.uz/docs/-6257288#-6263815');
});

test('the resolver indexes numbered regulatory bands with negative Lex.uz IDs', () => {
  const html = `
    <div class="ACT_TITLE"><div id="-5953883">Yo'l harakati qoidalari</div></div>
    <div id="divCont">
      <div class="ACT_TEXT lx_elem"><div id="-5954624">7. Mexanik transport vositasining haydovchisi hujjatlarni taqdim etadi.</div></div>
      <div class="ACT_TEXT lx_elem"><div id="-5954656">7. Raqamli hujjatlar ham qabul qilinadi.</div></div>
    </div>`;
  const index = buildAnchorIndexFromHtml(html, 'https://lex.uz/docs/-5953883');
  assert.strictEqual(index['band:7'], '-5954624');
});

test('the resolver accepts only HTTPS Lex.uz documents', () => {
  assert.strictEqual(normalizeSourceUrl('https://lex.uz/uz/docs/6257288#old'), 'https://lex.uz/uz/docs/6257288');
  assert.strictEqual(normalizeSourceUrl('http://lex.uz/docs/6257288'), '');
  assert.strictEqual(normalizeSourceUrl('https://lex.uz.evil.example/docs/6257288'), '');
});

test('older dashboard citations use the exact-anchor compatibility resolver', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(server, /app\.get\('\/api\/lex-anchor'/u);
  assert.match(dashboard, /return '\/api\/lex-anchor\?url=' \+ encodeURIComponent\(sourceUrl\)/u);
  assert.match(dashboard, /partNumber \? '&part='/u);
  assert.match(dashboard, /&type=/u);
  assert.match(dashboard, /return autoLinkCitations\(html\)/u);
  assert.doesNotMatch(dashboard, /url \+= '#:~:text='/u);
});

test('known high-traffic provisions resolve without a live Lex.uz fetch', () => {
  assert.strictEqual(
    resolveKnownLexAnchorUrl('https://lex.uz/uz/docs/97664', '135', 'modda'),
    'https://lex.uz/docs/-97664#-1781411',
  );
  assert.strictEqual(
    resolveKnownLexAnchorUrl('https://lex.uz/docs/-5953883', '7', 'band'),
    'https://lex.uz/docs/-5953883#-5954624',
  );
});

test('an unavailable live resolver falls back to the named provision', () => {
  assert.strictEqual(
    buildLexAnchorFallbackUrl('https://lex.uz/docs/-6257288', '253', 'modda'),
    'https://lex.uz/docs/-6257288#:~:text=253-modda',
  );
});

test('dashboard renders citations with one canonical named style', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  const start = dashboard.indexOf('const LAW_CITATION_MAP');
  const end = dashboard.indexOf('function simpleMarkdown', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${dashboard.slice(start, end)}\nrendered = enhanceLegalLinks(\`
    <p><strong>O'zbekiston Respublikasi Yo'l harakati qoidalari, 7-bandiga</strong> ko'ra.</p>
    <p>Manba: https://lex.uz/docs/-5953883</p>
    <p><strong>Ma'muriy javobgarlik to'g'risidagi kodeksning 135-moddasi</strong>.</p>
    <p>Manba: https://lex.uz/uz/docs/97664</p>
  \`);`, context);
  assert.strictEqual((context.rendered.match(/class="law-citation-link"/gu) || []).length, 2);
  assert.strictEqual((context.rendered.match(/class="legal-source-url"/gu) || []).length, 0);
  assert.match(context.rendered, /Yo'l harakati qoidalari, 7-band, tegishli band/u);
  assert.match(context.rendered, /Ma'muriy javobgarlik to'g'risidagi kodeks, 135-modda, tegishli qism/u);
  assert.match(context.rendered, /https:\/\/lex\.uz\/docs\/-5953883#-5954624/u);
  assert.match(context.rendered, /https:\/\/lex\.uz\/docs\/-97664#-1781411/u);
});

test('the answer flag guide aligns with the same 820px conversation column', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(dashboard, /\.flag-guide\s*\{[\s\S]*?width:min\(100%, 820px\); box-sizing:border-box; align-self:center;/u);
  assert.match(dashboard, /border-radius:12px; padding:13px 15px; margin:0 auto 14px;/u);
});

test('dashboard legal chat uses deterministic routing and grounded fallback context', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  assert.match(server, /const deterministicTopic = deterministicLegalTopic\(message\)/u);
  assert.match(server, /buildGeminiFallbackPrompt\(topicLabel, message, ragContext\)/u);
  assert.match(server, /useSearch: !ragContext/u);
  assert.match(server, /lex-official-id-citations-v5/u);
  assert.doesNotMatch(server, /opts\.strictTopic && goodChunks\.length < 2\) needsWebSearch = false/u);
  assert.match(server, /const citationChunks = \[\.\.\.goodChunks, \.\.\.lexLiveChunks\]/u);
});

test('education questions route to education and receive education-specific actions', () => {
  const question = "Men studentman. Meni yakuniy nazoratdan chetlatishdi. Shu qonuniymi?";
  assert.strictEqual(deterministicLegalTopic(question), 'talim');
  const actions = buildLegalNextActions({ question, answer: '', topic: 'talim' });
  assert.deepStrictEqual(actions.slice(0, 3).map(action => action.kind), ['document', 'document', 'attorney']);
  assert.match(actions[0].label, /chetlashtirish asosi|dalolatnoma/u);
  assert.match(actions[1].label, /yakuniy nazorat|apellyatsiya/u);
  assert.strictEqual(actions[2].label, "Soha bo'yicha advokat topish");
  assert.strictEqual(actions[2].attorneyFieldCode, undefined);
  assert.strictEqual(actions[2].attorneyField, undefined);
  assert.strictEqual(actions[2].userSelectsField, true);
  assert.strictEqual(actions[2].userSelectsRegion, true);
  assert.strictEqual(actions[2].nationwideAvailable, true);
});

test('current education facts override a stale labor topic in next actions', () => {
  const question = "Men studentman. Meni yakuniy nazoratdan chetlatishdi. Qayerda yozilgan?";
  const answer = "824-son qaror bilan tasdiqlangan nizomning 41-bandi qo'llanadi.";
  const actions = buildLegalNextActions({ question, answer, topic: 'mehnat' });
  const labels = actions.map(action => action.label).join(' | ');
  assert.match(labels, /Chetlashtirish asosi/u);
  assert.match(labels, /Yakuniy nazorat/u);
  assert.match(labels, /Soha bo'yicha advokat topish/u);
  assert.doesNotMatch(labels, /Ish haqi|Ish beruvchi|Mehnat nizolari/u);
});

test('server replaces stale selected topics with an unambiguous current-question route', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  assert.match(server, /if \(deterministicTopic && topic !== deterministicTopic\)/u);
  assert.match(server, /topic = deterministicTopic;/u);
});

test('Lex.uz result parsing prefers canonical Uzbek-Latin document links', () => {
  const html = [
    '<a href="/docs/5013007?query=talim#sr-1">Cyrillic</a>',
    '<a href="/docs/-5013007?query=talim#sr-1">Latin</a>',
  ].join('');
  assert.deepStrictEqual(parseSearchResults(html), ['https://lex.uz/docs/-5013007']);
});

test('post-send progress uses monochrome SVGs instead of colorful emoji', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(server, /kind: 'search'/u);
  assert.match(server, /kind: 'sources'/u);
  assert.match(server, /kind: 'compose'/u);
  assert.doesNotMatch(server, /type: 'status', text: '[🔍📚✍]/u);
  assert.match(dashboard, /function streamStatusMarkup\(kind, text\)/u);
  assert.match(dashboard, /class="ai-stream-status-icon"/u);
  assert.match(dashboard, /stroke="currentColor"/u);
});

test('unpaid salary answers offer two documents and user-controlled attorney search', () => {
  const actions = buildLegalNextActions({
    topic: 'mehnat',
    question: "Ish beruvchi uch oylik ish haqimni bermadi.",
  });
  assert.deepStrictEqual(actions.map(item => item.kind), ['document', 'document', 'attorney']);
  assert.strictEqual(actions[0].documentType, "Da'vo arizasi");
  assert.strictEqual(actions[1].documentType, 'Talabnoma');
  assert.strictEqual(actions[2].attorneyFieldCode, undefined);
  assert.strictEqual(actions[2].attorneyField, undefined);
  assert.ok(actions.every(item => item.kind !== 'custom'));
});

test('education record requests carry their own application intake instead of court-claim fields', () => {
  const actions = buildLegalNextActions({
    topic: 'talim',
    question: 'Meni yakuniy nazoratdan chetlashtirishdi. Asosi va dalolatnoma nusxasi kerak.',
  });
  const application = actions[0];
  const labels = application.inputFields.map(field => field.label).join(' ');
  assert.strictEqual(application.documentType, 'Ariza');
  assert.strictEqual(application.inputSchema, 'decision-copy-request');
  assert.match(labels, /Qabul qiluvchi ta'lim tashkiloti/u);
  assert.match(labels, /Chetlashtirish holati/u);
  assert.match(labels, /So'ralayotgan asos va hujjatlar/u);
  assert.doesNotMatch(labels, /Sud nomi|Da'vogar|Javobgar|Da'vo summasi/u);
});

test('dashboard reuses drafting and opens nationwide attorney filters for next actions', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(dashboard, /function renderLegalNextActions\(actions, question, answer\)/u);
  assert.match(dashboard, /answer: String\(answer \|\| ''\)/u);
  assert.match(dashboard, /docFlowPickType\(action\.documentType[\s\S]*?question: group\.question,[\s\S]*?answer: group\.answer,[\s\S]*?selectedAction:[\s\S]*?inputFields: action\.inputFields/u);
  assert.match(dashboard, /actions: actions\.slice\(0, 3\)/u);
  assert.match(dashboard, /window\.location\.assign\('\/attorneys\.html\?source=legal-next-step'\)/u);
  assert.doesNotMatch(dashboard, /action\.kind === 'custom'/u);
});

test('official act identifiers are normalized to Uzbek-Latin public labels', () => {
  assert.strictEqual(normalizeOfficialDocumentIdentifier('ПҚ-4008'), 'PQ-4008');
  assert.strictEqual(normalizeOfficialDocumentIdentifier('УП-60'), 'PF-60');
  assert.strictEqual(normalizeOfficialDocumentIdentifier('ПКМ-824'), 'VMQ-824');
  assert.strictEqual(normalizeOfficialDocumentIdentifier('ЎРҚ-637'), "O'RQ-637");
  assert.strictEqual(normalizeOfficialDocumentIdentifier('349-I'), '349-I');
  assert.strictEqual(getChunkDocumentIdentifier({
    document_number: '824',
    metadata: { act_form: "O'zbekiston Respublikasi Vazirlar Mahkamasining qarori" },
  }), 'VMQ-824');
});

test('a Cabinet decision citation includes VMQ number and exact clickable band', () => {
  const title = "Oliy ta'lim muassasalarida ta'lim jarayonini tashkil etish bilan bog'liq tizimni takomillashtirish chora-tadbirlari to'g'risida";
  const normalized = normalizeLegalAnswerCitations(
    `${title}, 41-bandiga ko'ra talaba yakuniy nazoratga kiritilmaydi.`,
    [{
      law_name: title,
      document_number: '824',
      metadata: { act_form: "O'zbekiston Respublikasi Vazirlar Mahkamasining qarori" },
      article_numbers: ['41'],
      provision_type: 'band',
      source_url: 'https://lex.uz/uz/docs/-5193564',
      chunk_text: '41. Bir fanga ajratilgan auditoriya soatining 25 foizi va undan ortiq soatni sababsiz qoldirgan talaba.',
    }]
  );
  assert.match(normalized, /\[\*\*Oliy ta'lim[\s\S]+\(VMQ-824\), 41-band, tegishli band\*\*\]\(https:\/\/lex\.uz\/uz\/docs\/-5193564#:~:text=/u);
  assert.match(normalized, /\)ga ko'ra/u);
});

test("a law citation includes its O'RQ number and exact clickable article", () => {
  const normalized = normalizeLegalAnswerCitations(
    "Ta'lim to'g'risida, 48-moddasiga ko'ra talaba ichki qoidalarga rioya qiladi.",
    [{
      law_name: "Ta'lim to'g'risida",
      document_number: '637',
      metadata: { act_form: "O'zbekiston Respublikasining Qonuni" },
      article_numbers: ['48'],
      source_url: 'https://lex.uz/uz/docs/-5013007',
      chunk_text: "48-modda. Ta'lim oluvchilarning majburiyatlari.",
    }]
  );
  assert.match(normalized, /\[\*\*Ta'lim to'g'risida \(O'RQ-637\), 48-modda, tegishli qism\*\*\]\(https:\/\/lex\.uz\/uz\/docs\/-5013007#:~:text=/u);
});

test('a PQ shorthand is expanded to the full official title and linked provision', () => {
  const title = "O'zbekiston Respublikasi hududida xorijiy davlatlarning malakali mutaxassislari tomonidan mehnat faoliyatini amalga oshirishi uchun qulay shart-sharoitlar yaratish chora-tadbirlari to'g'risida";
  const normalized = normalizeLegalAnswerCitations(
    "PQ-4008, 2-bandiga ko'ra malakali mutaxassislar alohida toifa hisoblanadi.",
    [{
      law_name: title,
      ownDocumentNumber: { prefix: 'PQ', number: '4008' },
      article_numbers: ['2'],
      provision_type: 'band',
      source_url: 'https://lex.uz/docs/-4045557',
      chunk_text: "2. Belgilansinki, malakali mutaxassislar uchun alohida tartib qo'llanadi.",
    }]
  );
  assert.match(normalized, /\[\*\*O'zbekiston Respublikasi hududida[\s\S]+\(PQ-4008\), 2-band, tegishli band\*\*\]\(https:\/\/lex\.uz\/docs\/-4045557#:~:text=/u);
});

test('a Presidential decree citation includes its PF number and Lex link', () => {
  const title = "O'zbekiston — 2030 strategiyasi to'g'risida";
  const normalized = normalizeLegalAnswerCitations(
    `${title}, 1-bandiga ko'ra strategiya tasdiqlangan.`,
    [{
      law_name: title,
      document_number: 'ПФ-158',
      article_numbers: ['1'],
      provision_type: 'band',
      source_url: 'https://lex.uz/docs/-6600413',
      chunk_text: "1. O'zbekiston — 2030 strategiyasi tasdiqlansin.",
    }]
  );
  assert.match(normalized, /\[\*\*O'zbekiston — 2030 strategiyasi to'g'risida \(PF-158\), 1-band, tegishli band\*\*\]\(https:\/\/lex\.uz\/docs\/-6600413#:~:text=/u);
});

test('a grounded act mention without a locator links to its official Lex document', () => {
  const title = "O'zbekiston Respublikasi hududida xorijiy davlatlarning malakali mutaxassislari tomonidan mehnat faoliyatini amalga oshirishi uchun qulay shart-sharoitlar yaratish chora-tadbirlari to'g'risida";
  const normalized = normalizeLegalAnswerCitations(
    `Masala ${title} asosida ham tartibga solinadi.`,
    [{
      law_name: title,
      ownDocumentNumber: { prefix: 'PQ', number: '4008' },
      source_url: 'https://lex.uz/docs/-4045557',
    }]
  );
  assert.match(normalized, /\[\*\*O'zbekiston Respublikasi hududida[\s\S]+\(PQ-4008\)\*\*\]\(https:\/\/lex\.uz\/docs\/-4045557\)/u);
});

test('existing Lex links receive the official identifier across URL language variants', () => {
  const answer = "[**Ta'lim to'g'risida, 48-modda, tegishli qism**](https://lex.uz/uz/docs/-5013007#-5013954) qo'llanadi.";
  const normalized = normalizeLegalAnswerCitations(answer, [{
    law_name: "Ta'lim to'g'risida",
    document_number: "O'RQ-637",
    source_url: 'https://lex.uz/docs/-5013007',
  }]);
  assert.match(normalized, /\[\*\*Ta'lim to'g'risida \(O'RQ-637\), 48-modda, tegishli qism\*\*\]/u);
});

test('an adjacent document-root link and exact provision link collapse into one citation', () => {
  const title = "Tashqi reklama va ijtimoiy axborotning aylanish sohasidagi munosabatlarni tartibga solishni yanada takomillashtirish chora-tadbirlari to'g'risida";
  const normalized = normalizeLegalAnswerCitations(
    `Ushbu tartib [${title} (VMQ-428)](https://lex.uz/docs/-6591657)”gi ` +
    `[${title} (VMQ-428), 3-band, tegishli band](https://lex.uz/docs/-6591657#:~:text=3.%20Vazirlar) ` +
    `bilan joriy etilgan.`,
    [{
      law_name: title,
      document_number: 'VMQ-428',
      article_numbers: ['3'],
      provision_type: 'band',
      source_url: 'https://lex.uz/docs/-6591657',
      chunk_text: '3. Vazirlar Mahkamasining qarorida tashqi reklama tartibi belgilangan.',
    }]
  );
  assert.strictEqual((normalized.match(/lex\.uz\/docs\/-6591657/gu) || []).length, 1);
  assert.match(normalized, /\[(?:\*\*)?Tashqi reklama[\s\S]+\(VMQ-428\), 3-band, tegishli band(?:\*\*)?\]\(https:\/\/lex\.uz\/docs\/-6591657#:~:text=/u);
  assert.doesNotMatch(normalized, /\)”gi\s+\[/u);
});

test('an unverified act mention is never turned into a source link', () => {
  const answer = "Noma'lum qaror (PQ-999999) ham qo'llanadi.";
  assert.strictEqual(normalizeLegalAnswerCitations(answer, []), answer);
});

test('document intake prefers the selected action schema and requires its mandatory fields', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(dashboard, /actionFields && actionFields\.length \? actionFields : await findTemplateFieldsForType\(t\)/u);
  assert.match(dashboard, /words\.length > 1 && words\.every/u);
  assert.match(dashboard, /else if \(f\.required\) missing\.push/u);
  assert.match(dashboard, /Majburiy maydonlarni to\\'ldiring/u);
});

test('contextual document actions explain the details field without pre-filling the old question', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(dashboard, /function docFlowDetailsPlaceholder\(t\)/u);
  assert.match(dashboard, /Qaysi majburiyat bajarilmaganini/u);
  assert.match(dashboard, /detailsTarget\.placeholder = docFlowDetailsPlaceholder\(t\)/u);
  assert.doesNotMatch(dashboard, /seedTarget\.value|docFlowSeedDetails/u);
});

test('selected document actions continue the exact question and answer without pre-filling fields', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  const drafting = fs.readFileSync(path.join(__dirname, '../src/drafting/routes.js'), 'utf8');
  assert.match(dashboard, /var docFlowContinuationContext = null/u);
  assert.match(dashboard, /Oldingi savol va huquqiy javob hisobga olinadi/u);
  assert.match(dashboard, /continuation: continuation \|\| null/u);
  assert.match(drafting, /CONTINUATION OF THE LEGAL CHAT/u);
  assert.match(drafting, /Original legal question/u);
  assert.match(drafting, /Verified legal answer\/conclusion/u);
  assert.match(drafting, /User-selected next step/u);
});

test('2026-10-01 production answer: one clean Latin link per citation, article linked despite an aside', () => {
  const law = "O'zbekiston Respublikasining Mehnat kodeksi";
  const chunks = [
    { law_name: law, source_url: 'https://lex.uz/uz/docs/6257288', document_number: '798', article_numbers: ['561'], chunk_text: '561-modda. Ishga tiklash.', source_type: 'law_text' },
    // the same code again, from the live lex.uz search, under its Latin URL
    { law_name: law, source_url: 'https://lex.uz/docs/-6257288', document_number: '798', chunk_text: 'Mehnat kodeksi', source_type: 'lex_live' },
  ];
  const reply = "**Huquqiy asos**\n\n- Mehnat kodeksi (Mehnat kodeksini tasdiqlash to'g'risida (O'RQ-798)), 561-modda\n\n**Xulosa**\n\nMehnat kodeksi bo'yicha sud qaror qiladi.";
  const out = normalizeLegalAnswerCitations(reply, chunks, 'uz');
  assert.ok(!/\[\[/.test(out), `no link inside a link: ${out}`);
  assert.ok(!out.includes('(798) (798)'), 'the number is not repeated');
  assert.ok(!out.includes('lex.uz/uz/docs/6257288'), 'the original edition is not linked');
  // A code has no number of its own (owner): no "(798)" next to it.
  assert.match(out, /\[\*\*Mehnat kodeksi, 561-modda, tegishli qism\*\*\]\(https:\/\/lex\.uz\/docs\/-6257288#:~:text=561-modda\)/u);
  assert.ok(!out.includes('tasdiqlash'), "the approving law's title is dropped with the aside");
});

test('Uzbek links go to the Latin text (/docs/-N); /uz/docs/-N and Russian links are kept', () => {
  assert.strictEqual(buildLexDeepLink({ source_url: 'https://lex.uz/uz/docs/97664' }, {}), 'https://lex.uz/docs/-97664');
  // /docs/N is an Uzbek Cyrillic text (same id as its Latin /docs/-N) OR a
  // Russian text (an id of its own): the text decides (owner, 2026-10-13)
  const cyr = 'Ўзбекистон Республикасининг Фуқаролик кодекси. 135-модда. Ҳуқуқ ва мажбуриятлар';
  const ru = 'Гражданский кодекс Республики Узбекистан. Статья 135. Права и обязанности участников';
  // a Cyrillic line is highlighted only on the Cyrillic page (2026-10-13); an anchor id goes to the Latin one
  assert.strictEqual(buildLexDeepLink({ source_url: 'https://lex.uz/docs/97664', chunk_text: cyr }, {}).split('#')[0], 'https://lex.uz/docs/97664');
  assert.strictEqual(buildLexDeepLink({ source_url: 'https://lex.uz/docs/97664', chunk_text: cyr, lex_element_id: '5000001' }, {}), 'https://lex.uz/docs/-97664#-5000001');
  assert.strictEqual(buildLexDeepLink({ source_url: 'https://lex.uz/docs/97664', chunk_text: 'Fuqarolik kodeksi 135-modda. Huquq va majburiyatlar ishtirokchilari' }, {}).split('#')[0], 'https://lex.uz/docs/-97664');
  assert.strictEqual(buildLexDeepLink({ source_url: 'https://lex.uz/docs/97664', chunk_text: ru }, {}).split('#')[0], 'https://lex.uz/docs/97664', 'Russian: kept');
  assert.strictEqual(buildLexDeepLink({ source_url: 'https://lex.uz/uz/docs/-5013007', lex_element_id: '-5013954' }, { articleRef: '48' }), 'https://lex.uz/uz/docs/-5013007#-5013954');
  assert.strictEqual(buildLexDeepLink({ source_url: 'https://lex.uz/ru/docs/97664' }, { lang: 'ru' }), 'https://lex.uz/ru/docs/97664');
});

test('a Russian text never gets a minus: /docs/-<Russian id> is a 404 (2026-10-13, the LLC law /docs/8152146)', () => {
  const { lexDocScript, normalizeLexSourceUrl } = require('../src/rag/citation-utils');
  const ru = 'Закон Республики Узбекистан «Об обществах с ограниченной ответственностью». Статья 21. Отчуждение доли';
  const cyr = 'Масъулияти чекланган жамиятлар тўғрисида. 21-модда. Улушни бошқа шахсга ўтказиш';
  assert.deepStrictEqual([lexDocScript('https://lex.uz/docs/8152146', ru), lexDocScript('https://lex.uz/docs/8152146', cyr), lexDocScript('https://lex.uz/docs/8152146', ''), lexDocScript('https://lex.uz/docs/-8152146', ''), lexDocScript('https://lex.uz/ru/docs/1', ''), lexDocScript('https://lex.uz/uz/docs/1', ''), lexDocScript('https://lex.uz/ru/docs/-2304138', '')], ['ru', 'uz-cyrl', '', 'uz-latn', 'ru', 'uz-cyrl', 'uz-latn']);
  for (const lang of ['ru', 'uz']) {
    const link = buildLexDeepLink({ source_url: 'https://lex.uz/docs/8152146', chunk_text: ru, law_name: 'Об обществах с ограниченной ответственностью' }, { lang, articleRef: '21' });
    assert.ok(link.startsWith('https://lex.uz/docs/8152146') && !link.includes('/docs/-'), `${lang}: ${link}`);
  }
  // unknown language: the page as given, never a guessed minus
  assert.strictEqual(normalizeLexSourceUrl('https://lex.uz/docs/8152146', 'ru'), 'https://lex.uz/docs/8152146');
  assert.strictEqual(normalizeLexSourceUrl('https://lex.uz/docs/8152146', 'uz'), 'https://lex.uz/docs/8152146');
  // a Russian URL is never moved to an Uzbek id
  assert.strictEqual(normalizeLexSourceUrl('https://lex.uz/ru/docs/6257291', 'uz'), 'https://lex.uz/ru/docs/6257291');
  // the Uzbek Cyrillic text of a listed code: its Russian page in a Russian answer
  assert.strictEqual(normalizeLexSourceUrl('https://lex.uz/docs/6257288', 'ru', 'uz-cyrl'), 'https://lex.uz/ru/docs/6257291');
  // the corpus audit never turns a Russian URL into /docs/-<id>
  const audit = require('fs').readFileSync(require('path').join(__dirname, '../src/rag/corpus-audit.js'), 'utf8');
  assert.ok(audit.includes("if (/lex\\.uz\\/ru\\/docs\\/\\d/iu.test(String(url || ''))) return '';"));
});

test('an article with no act gets the one cited act and its link, else is marked; a named act is left alone (2026-10-13)', () => {
  const { linkBareArticleRefs } = require('../src/rag/citation-utils');
  const chunks = [{ source_url: 'https://lex.uz/docs/8152146', law_name: 'Об обществах с ограниченной ответственностью', document_number: 'ЗРУ-1137', article_numbers: ['9', '21'], chunk_text: 'Статья 9. Права участников общества. Статья 21. Отчуждение доли' }];
  const t = 'Это право закреплено также в статье 9 (пункт о праве передать долю). Механизм в [**Об обществах (ЗРУ-1137), статья 21**](https://lex.uz/docs/8152146#x). Ст. 5 Закона тоже. В статье 77 сказано иное.';
  const out = linkBareArticleRefs(t, chunks, 'ru');
  assert.ok(out.includes('[**Об обществах (ЗРУ-1137), статья 9**](https://lex.uz/docs/8152146#:~:text='), out);
  assert.ok(!out.includes('docs/-8152146'), 'a Russian page keeps its id');
  assert.ok(out.includes('Ст. 5 Закона тоже'), 'an act named in the sentence: untouched');
  assert.ok(out.includes('статье 77 (источник не указан)'), 'not in the cited act: marked, never linked to a guess');
  // two acts cited: no guess which one
  const two = linkBareArticleRefs('Bu 12-moddada aytilgan. [**Mehnat kodeksi, 100-modda**](https://lex.uz/docs/-6257288) va [**Soliq kodeksi, 5-modda**](https://lex.uz/docs/-4674902).', [], 'uz');
  assert.ok(two.startsWith("Bu 12-moddada (manbasi ko'rsatilmagan) aytilgan."), two);
  // nothing bare: unchanged
  const linked = '[**Mehnat kodeksi, 100-modda**](https://lex.uz/docs/-6257288) bo\'yicha.';
  assert.strictEqual(linkBareArticleRefs(linked, [], 'uz'), linked);
});

test('Telegram Markdown: no asterisks inside a link label, bold with one asterisk (2026-10-13)', () => {
  const { toTelegramMarkdown, splitForTelegram } = require('../src/agents/telegram-agent');
  assert.strictEqual(toTelegramMarkdown('[**Об обществах (ЗРУ-1137), статья 21**](https://lex.uz/docs/8152146#x) **Вывод**'), '[Об обществах (ЗРУ-1137), статья 21](https://lex.uz/docs/8152146#x) *Вывод*');
  assert.deepStrictEqual(splitForTelegram('**A** [**B**](https://lex.uz/docs/-1)'), ['*A* [B](https://lex.uz/docs/-1)']);
  assert.strictEqual(toTelegramMarkdown('_Javob SI tomonidan tayyorlandi_'), '_Javob SI tomonidan tayyorlandi_', 'italics kept');
});

test('a link opens its article: the qism anchor, else the article anchor, else the article\'s own lines - never a chapter heading (2026-10-13)', () => {
  const ch = { source_url: 'https://lex.uz/docs/-8151376', law_name: "Mas'uliyati cheklangan jamiyatlar to'g'risida",
    chunk_text: "3-bob. Jamiyatning ustav fondi (ustav kapitali)\n20-modda. Ustav fondi\nUstav fondi ishtirokchilar hissalaridan iborat.\n21-modda. Ulushni o'tkazish\nIshtirokchi o'z ulushini boshqa ishtirokchiga o'tkazishga haqli." };
  const excerpt = buildLexDeepLink(ch, { articleRef: '21', partNumber: '1' });
  assert.ok(!/bob/u.test(decodeURIComponent(excerpt)) && /Ishtirokchi%20o%27z%20ulushini/u.test(excerpt), excerpt);
  assert.strictEqual(buildLexDeepLink({ ...ch, lex_anchor_ids: { 21: '-8152381' } }, { articleRef: '21', partNumber: '1' }), 'https://lex.uz/docs/-8151376#-8152381', 'the article anchor when the qism has none');
  assert.strictEqual(buildLexDeepLink({ ...ch, lex_anchor_ids: { 21: '-8152381', '21:3': '-8152390' } }, { articleRef: '21', partNumber: '3' }), 'https://lex.uz/docs/-8151376#-8152390', 'the qism anchor first');
});

test('a bare law number gets its prefix from the page head or the registry: never "(1137)" (2026-10-13)', () => {
  const { getChunkDocumentIdentifier, canonicalCitationActLabel } = require('../src/rag/citation-utils');
  const name = "Mas'uliyati cheklangan jamiyatlar to'g'risida";
  assert.strictEqual(getChunkDocumentIdentifier({ law_name: name, document_number: '1137', source_url: 'https://lex.uz/docs/-8151376' }), "O'RQ-1137", 'registry');
  assert.strictEqual(getChunkDocumentIdentifier({ law_name: 'X', document_number: '55', head: "O'ZBEKISTON RESPUBLIKASINING QONUNI\nX to'g'risida" }), "O'RQ-55", 'page head');
  assert.strictEqual(getChunkDocumentIdentifier({ law_name: 'X', document_number: '55' }), '55', 'no evidence: not guessed');
  assert.strictEqual(canonicalCitationActLabel(name, { document_number: '1137', source_url: 'https://lex.uz/docs/-8151376' }), `${name} (O'RQ-1137)`);
});

test('an article already linked for one act gets that link; quotes, "gi" and a repeated number around a link go (2026-10-13)', () => {
  const { linkBareArticleRefs, tidyAroundLinks } = require('../src/rag/citation-utils');
  const t = "Tartib [**MChJ to'g'risida (O'RQ-1137), 21-modda**](https://lex.uz/docs/-8151376#-8152381) bilan. Korporativ shartnoma [**Fuqarolik kodeksi (1-qism), 358¹-modda**](https://lex.uz/docs/-111181#-5) bilan. Bitim yozma tuziladi (21-modda 3-qismi). 99-moddada boshqa.";
  const out = linkBareArticleRefs(t, [], 'uz');
  assert.ok(out.includes("tuziladi ([**MChJ to'g'risida (O'RQ-1137), 21-modda**](https://lex.uz/docs/-8151376#-8152381) 3-qismi)"), out);
  assert.ok(out.includes("99-moddada (manbasi ko'rsatilmagan)"), 'still marked when no act is certain');
  assert.strictEqual(tidyAroundLinks("Respublikasining [**MChJ (O'RQ-1137), 21-modda**](https://lex.uz/docs/-8151376#-1)»gi Qonuni (O'RQ-1137) bilan."), "Respublikasining [**MChJ (O'RQ-1137), 21-modda**](https://lex.uz/docs/-8151376#-1) Qonuni bilan.");
  assert.strictEqual(tidyAroundLinks("«[**MChJ (O'RQ-1137)**](https://lex.uz/docs/-8151376)»gi Qonunning"), "[**MChJ (O'RQ-1137)**](https://lex.uz/docs/-8151376) Qonunning");
  assert.strictEqual(tidyAroundLinks('Закон «[**Об обществах (ЗРУ-1137)**](https://lex.uz/docs/8152146)» устанавливает.'), 'Закон [**Об обществах (ЗРУ-1137)**](https://lex.uz/docs/8152146) устанавливает.');
  const plain = "Oddiy «qo'shtirnoq» va [havola](https://lex.uz/docs/-1) qoladi.";
  assert.strictEqual(tidyAroundLinks(plain), plain, 'quotes not at a link stay');
});

test('a Text Fragment never carries a raw bracket; "Qonun, 21-modda, birinchi qism" is a citation; the qism line comes from a chunk that starts the article (2026-10-13)', () => {
  const { normalizeLegalAnswerCitations, encodeFragmentBrackets, uzPartNumber } = require('../src/rag/citation-utils');
  const article = "21-modda. Ulushni boshqa shaxsga o'tkazish\nJamiyat ishtirokchisi jamiyatning ustav fondidagi (ustav kapitalidagi) oʻz ulushini jamiyatning bir yoxud bir necha ishtirokchisiga sotishga haqli.\nIshtirokchi oʻz ulushini uchinchi shaxslarga ustavda nazarda tutilgan hollarda sotishi mumkin.\nUlushni begonalashtirish toʻgʻrisidagi bitim oddiy yozma shaklda tuziladi.";
  const chunks = [{ source_url: 'https://lex.uz/docs/-8151376', law_name: "Mas'uliyati cheklangan jamiyatlar to'g'risida", document_number: "O'RQ-1137", article_number: '21', chunk_text: article }];
  const out = normalizeLegalAnswerCitations("Tartib Mas'uliyati cheklangan jamiyatlar to'g'risida (O'RQ-1137) Qonun, 21-modda, birinchi qism bilan belgilanadi. Shakli (Mas'uliyati cheklangan jamiyatlar to'g'risida (O'RQ-1137), 21-modda, 3-qism).", chunks, 'uz');
  const links = [...out.matchAll(/\[\*\*([^\]]+)\*\*\]\(([^\s]+?)\)(?=[\s).,]|$)/gu)];
  assert.deepStrictEqual(links.map(l => l[1]), ["Mas'uliyati cheklangan jamiyatlar to'g'risida (O'RQ-1137), 21-modda, 1-qism", "Mas'uliyati cheklangan jamiyatlar to'g'risida (O'RQ-1137), 21-modda, 3-qism"], out);
  for (const [, , url] of links) assert.ok(!/[()]/u.test(url), url);
  assert.ok(decodeURIComponent(links[0][2]).includes('#:~:text=Jamiyat ishtirokchisi jamiyatning ustav fondidagi (ustav kapitalidagi)'));
  assert.ok(decodeURIComponent(links[1][2]).includes('#:~:text=Ulushni begonalashtirish'), 'qism 3, not qism 1');
  assert.ok(out.includes(' bilan belgilanadi.') && !/\) Qonun, 21/u.test(out));
  // a lone child clause is never counted into qism lines
  const child = [{ ...chunks[0], articleNumber: '21', chunk_text: 'Ishtirokchi oʻz ulushini uchinchi shaxslarga sotishi mumkin.' }];
  assert.ok(decodeURIComponent(normalizeLegalAnswerCitations("(Mas'uliyati cheklangan jamiyatlar to'g'risida (O'RQ-1137), 21-modda, 3-qism)", child, 'uz')).includes('#:~:text=Ishtirokchi'));
  // an old (cached) link with raw brackets: encoded, the link stays whole
  assert.strictEqual(encodeFragmentBrackets('[a](https://lex.uz/docs/-1#:~:text=fondidagi%20(ustav%20kapitalidagi)%20o) va (b)'), '[a](https://lex.uz/docs/-1#:~:text=fondidagi%20%28ustav%20kapitalidagi%29%20o) va (b)');
  assert.deepStrictEqual(['birinchi', 'Uchinchi', "to'rtinchi", 'oʻninchi', '2', 'qism'].map(uzPartNumber), ['1', '3', '4', '10', '2', '']);
});

test('Telegram: the model\'s own disclaimer line goes, the bot\'s one stays; a legal sentence with "javob" and "yurist" is kept (2026-10-13)', () => {
  const { stripModelDisclaimer } = require('../src/agents/telegram-agent');
  assert.strictEqual(stripModelDisclaimer("Xulosa\n\nMumkin.\n\nOgohlantirish: javob AI tahlili asosida; muhim qarorlar uchun litsenziyalangan yuristga murojaat qiling.\n\n⚠️ Manba matniga mos kelmadi: x."), "Xulosa\n\nMumkin.\n\n⚠️ Manba matniga mos kelmadi: x.");
  assert.strictEqual(stripModelDisclaimer('> ⚠️ Bu javob AI tahlili asosida. Muhim qarorlar uchun litsenziyalangan yuristga murojaat qiling.\nA'), 'A');
  assert.strictEqual(stripModelDisclaimer('Ответ подготовлен на основе анализа ИИ; обратитесь к юристу.\nB'), 'B');
  for (const keep of ['Javob berish muddati 10 kun; yurist bilan kelishing.', 'Javob SIfatli; yurist']) assert.strictEqual(stripModelDisclaimer(keep), keep);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
  assert.ok(/const reply = stripModelDisclaimer\(answer\.text\) \+ nextQuestionsText \+ banner/u.test(src));
});

test('a provision is highlighted whole: a long line as start,end; a Cyrillic line on the Cyrillic page; commas and edge hyphens inside a term encoded (2026-10-13)', () => {
  const { textFragmentFor } = require('../src/rag/citation-utils');
  const item = 'Ўзбекистон Республикаси ҳудудида меҳнат фаолиятини амалга ошириш ҳуқуқи тасдиқномаларини олмасдан туриб чет эллик мутахассисларни жалб этиш;';
  const chunk = { source_url: 'https://lex.uz/docs/-4422250', law_name: 'Технопарк', chunk_text: item };
  const url = buildLexDeepLink(chunk, {});
  const [page, frag] = url.split('#:~:text=');
  assert.strictEqual(page, 'https://lex.uz/docs/4422250', 'the Cyrillic page');
  const [start, end] = frag.split(',');
  assert.deepStrictEqual([decodeURIComponent(start), decodeURIComponent(end)], ['Ўзбекистон Республикаси ҳудудида меҳнат фаолиятини амалга ошириш ҳуқуқи', 'туриб чет эллик мутахассисларни жалб этиш;']);
  assert.strictEqual(frag.split(',').length, 2, 'one range comma');
  assert.strictEqual(textFragmentFor('Qisqa band, vergul bilan.'), 'Qisqa%20band%2C%20vergul%20bilan.', 'short: whole, its comma encoded');
  assert.ok(!/,/u.test(textFragmentFor('Bir, ikki, uch, to\'rt, besh, olti, yetti, sakkiz, to\'qqiz, o\'n, o\'n bir, o\'n ikki, o\'n uch, o\'n to\'rt, o\'n besh, o\'n olti so\'z').replace(/^[^,]*,/u, '')), 'only the range comma is raw');
  assert.strictEqual(textFragmentFor('-boshida'), '%2Dboshida');
  // "17-band" opens at the item: its own lines, never the lines before it
  const band = { source_url: 'https://lex.uz/docs/-4422250', law_name: 'Texnopark', chunk_text: "16. Shartnomaning shakli tasdiqlanadi.\n17. Texnopark rezidenti:\nchet ellik mutaxassislarni jalb etish;" };
  assert.strictEqual(decodeURIComponent(buildLexDeepLink(band, { articleRef: '17' }).split('#:~:text=')[1]), '17. Texnopark rezidenti: chet ellik mutaxassislarni jalb etish;');
});

test('an item link marks the whole item up to the next one; a bare article in the text of exactly one retrieved act is linked to it (2026-10-13)', () => {
  const { linkBareArticleRefs } = require('../src/rag/citation-utils');
  const band = { source_url: 'https://lex.uz/docs/-4422250', law_name: 'Texnopark', chunk_text: "16. Shakli tasdiqlanadi.\n17. Texnopark rezidenti:\ntovarlar eksportidan tushumlar doirasida to'lovlarni amalga oshirish;\nchet ellik mutaxassislarni tasdiqnomalarsiz jalb etish;\nvirtual ofisdan foydalangan holda faoliyatni amalga oshirish huquqiga ega.\n(17-band Vazirlar Mahkamasining 2022 yil 15 apreldagi 191-sonli qarori tahririda)\n18. Texnopark rezidenti:" };
  const frag = decodeURIComponent(buildLexDeepLink(band, { articleRef: '17' }).split('#:~:text=')[1]);
  assert.deepStrictEqual(frag.split(','), ["17. Texnopark rezidenti: tovarlar eksportidan tushumlar doirasida to'lovlarni", 'holda faoliyatni amalga oshirish huquqiga ega.']);
  const chunks = [
    { source_url: 'https://lex.uz/docs/-6257288', law_name: 'Mehnat kodeksi', articleNumber: '526', chunk_text: '526-modda. Yuqori malakali mutaxassislar\nMatn.' },
    { source_url: 'https://lex.uz/docs/-4422250', law_name: 'Texnopark nizomi', chunk_text: '17. Texnopark rezidenti: x' },
  ];
  const out = linkBareArticleRefs("[**A, 523-modda**](https://lex.uz/docs/-6257288#-1) va [**B**](https://lex.uz/docs/-4422250). ⚠️ muddat: norma manbada bor (526-modda), lekin.", chunks, 'uz');
  assert.ok(/norma manbada bor \(\[\*\*Mehnat kodeksi, 526-modda\*\*\]\(https:\/\/lex\.uz\/docs\/-6257288#/u.test(out), out);
  assert.ok(!/manbasi ko'rsatilmagan/u.test(out));
  const two = [...chunks, { source_url: 'https://lex.uz/docs/-111181', law_name: 'Fuqarolik kodeksi', articleNumber: '526', chunk_text: '526-modda. Boshqa' }];
  assert.ok(/526-modda \(manbasi ko'rsatilmagan\)/u.test(linkBareArticleRefs('[**A**](https://lex.uz/docs/-6257288) va [**B**](https://lex.uz/docs/-4422250). Bu 526-modda bilan.', two, 'uz')), 'two acts hold it: still marked');
});

console.log(`\n${passed} citation deep-link tests passed.\n`);
