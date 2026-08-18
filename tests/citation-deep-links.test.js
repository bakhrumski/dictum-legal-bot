'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  buildLexDeepLink,
  findCitationPartNumber,
  linkCitationsInMarkdown,
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
  assert.strictEqual(url, 'https://lex.uz/uz/docs/6257288#6263814');
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
  assert.ok(url.startsWith('https://lex.uz/uz/docs/6257288#:~:text='));
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
  assert.match(linked, /\[\*\*Mehnat kodeksi, 253-modda, 2-qism\*\*\]\(https:\/\/lex\.uz\/uz\/docs\/6257288#:~:text=/u);
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
  }, { articleRef: '253', partNumber: '2' }), 'https://lex.uz/uz/docs/6257288#6263815');
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
  assert.match(server, /lex-always-cross-check-v4/u);
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
  assert.match(actions[2].label, /ta'lim huquqi/iu);
});

test('current education facts override a stale labor topic in next actions', () => {
  const question = "Men studentman. Meni yakuniy nazoratdan chetlatishdi. Qayerda yozilgan?";
  const answer = "824-son qaror bilan tasdiqlangan nizomning 41-bandi qo'llanadi.";
  const actions = buildLegalNextActions({ question, answer, topic: 'mehnat' });
  const labels = actions.map(action => action.label).join(' | ');
  assert.match(labels, /Chetlashtirish asosi/u);
  assert.match(labels, /Yakuniy nazorat/u);
  assert.match(labels, /Ta'lim huquqi/u);
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

test('unpaid salary answers offer claim, demand, verified attorney and custom actions', () => {
  const actions = buildLegalNextActions({
    topic: 'mehnat',
    question: "Ish beruvchi uch oylik ish haqimni bermadi.",
  });
  assert.deepStrictEqual(actions.map(item => item.kind), ['document', 'document', 'attorney', 'custom']);
  assert.strictEqual(actions[0].documentType, "Da'vo arizasi");
  assert.strictEqual(actions[1].documentType, 'Talabnoma');
  assert.strictEqual(actions[2].attorneyFieldCode, 'labor');
});

test('dashboard reuses drafting and verified-attorney flows for next actions', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(dashboard, /function renderLegalNextActions\(actions, question\)/u);
  assert.match(dashboard, /docFlowPickType\(action\.documentType/u);
  assert.match(dashboard, /fetch\('\/api\/attorneys\?'/u);
  assert.match(dashboard, /Aloqa ma\\'lumoti faqat aniq tanlov/u);
});

test('contextual document actions explain the details field without pre-filling the old question', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(dashboard, /function docFlowDetailsPlaceholder\(t\)/u);
  assert.match(dashboard, /Qaysi majburiyat bajarilmaganini/u);
  assert.match(dashboard, /detailsTarget\.placeholder = docFlowDetailsPlaceholder\(t\)/u);
  assert.doesNotMatch(dashboard, /seedTarget\.value|docFlowSeedDetails/u);
});

console.log(`\n${passed} citation deep-link tests passed.\n`);
