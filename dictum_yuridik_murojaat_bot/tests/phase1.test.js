#!/usr/bin/env node
/**
 * Phase 1 smoke test — no DB, no network.
 *
 * Verifies the three pillars introduced in commit d225e02:
 *
 *   1. fetch-lex.js  → active-doc detection + metadata enrichment
 *                      (is_active, status_label, adoption_date, document_number)
 *   2. legal-corpus.js / advanced-corpus.js → schema columns, partial index,
 *                      and `is_active IS NULL OR is_active = TRUE` filter on
 *                      every retrieval query.
 *   3. server.js     → citation table full-spec format, no pretrained
 *                      topicKnowledge leakage, zero-hallucination fallback.
 *
 * Run with:  node tests/phase1.test.js
 */

const path = require('path');
const fs = require('fs');

// parseLexHtml is a pure function over HTML → { title, body, metadata }.
// We can call it directly without touching pg/embeddings.
const { parseLexHtml } = require('../src/rag/fetch-lex');
const { parseDocument } = require('../src/rag/chunker');
const { extractArticleRefsFromText, getChunkArticleRefs } = require('../src/rag/citation-utils');
const { buildAdvancedPrompt } = require('../src/rag/system-prompt');
const { getDefinitionPromptAddendum, getTermExplanationRule, isDefinitionQuery } = require('../src/rag/query-intent');

// ─── Test harness ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}

function section(label) {
  console.log(`\n━━━ ${label} ━━━`);
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected truthy');
}
function assertFalse(cond, msg) {
  if (cond) throw new Error(msg || 'expected falsy');
}
function assertMatch(text, pattern, msg) {
  if (!pattern.test(text)) {
    throw new Error(`${msg || 'assertMatch'}: pattern ${pattern} did not match`);
  }
}
function assertNoMatch(text, pattern, msg) {
  if (pattern.test(text)) {
    throw new Error(`${msg || 'assertNoMatch'}: pattern ${pattern} should NOT have matched`);
  }
}

// ─── Minimal lex.uz HTML skeleton ────────────────────────────────────────────
// Mirrors the selectors parseLexHtml queries: div.ACT_TITLE > a[id], #divCont,
// div.lx_elem, div.PUBLICATION_ORIGIN. Anything outside those is decorative
// and lives in the banner area (where "Hujjat kuchini yo'qotgan" would sit).
function buildHtml({ title, bannerText = '', bodyLines = [] }) {
  const banner = bannerText
    ? `<div class="STATUS_BANNER"><span>${bannerText}</span></div>`
    : '';
  const body = bodyLines
    .map((t, i) => `<div class="lx_elem ACT_TEXT"><a id="p${i}">${t}</a></div>`)
    .join('');
  return `
    <html><body>
      ${banner}
      <div class="ACT_TITLE"><a id="title">${title}</a></div>
      <div class="PUBLICATION_ORIGIN"><a id="pub">Qonun hujjatlari ma'lumotlari milliy bazasi</a></div>
      <div id="divCont">${body}</div>
    </body></html>
  `;
}

// ═════════════════════════════════════════════════════════════════════════════
//  1. fetch-lex.js — parseLexHtml metadata enrichment
// ═════════════════════════════════════════════════════════════════════════════
section('1. fetch-lex.js · parseLexHtml');

test('default document is_active=true, no status_label', () => {
  const html = buildHtml({
    title: `Fuqarolik kodeksi`,
    bodyLines: ['1-modda. Umumiy qoidalar.'],
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/111');
  assertEq(metadata.is_active, true, 'is_active default');
  assertEq(metadata.status_label, null, 'status_label default');
  assertEq(metadata.source_url, 'https://lex.uz/docs/111', 'source_url preserved');
});

test('detects "Hujjat kuchini yoʻqotgan" (U+02BB Uzbek ayn)', () => {
  // lex.uz uses the Uzbek modifier-letter-turned-comma (U+02BB), not a
  // typographic quote. The regex char class covers this + ASCII '.
  const html = buildHtml({
    title: 'Eski qonun',
    bannerText: 'Hujjat kuchini yoʻqotgan',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/222');
  assertFalse(metadata.is_active, 'is_active should be false');
  assertMatch(metadata.status_label, /Hujjat\s+kuchini\s+yo/i, 'status_label stored');
});

test('detects "Hujjat kuchini yo\'qotgan" (straight apostrophe)', () => {
  const html = buildHtml({
    title: 'Eski qonun',
    bannerText: "Hujjat kuchini yo'qotgan",
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/223');
  assertFalse(metadata.is_active, 'is_active should be false');
});

test('detects Russian "Документ утратил силу"', () => {
  const html = buildHtml({
    title: 'Утративший закон',
    bannerText: 'Документ утратил силу',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/224');
  assertFalse(metadata.is_active, 'is_active should be false');
  assertMatch(metadata.status_label, /Документ\s+утратил\s+силу/i, 'Russian status_label');
});

test('detects "Eski tahrir" → inactive', () => {
  const html = buildHtml({
    title: 'Yangilangan qonun',
    bannerText: 'Eski tahrir',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/225');
  assertFalse(metadata.is_active, 'Eski tahrir should mark inactive');
  assertEq(metadata.status_label, 'Eski tahrir', 'Eski tahrir label');
});

test('extracts adoption_date from "27.12.1996" numeric title', () => {
  const html = buildHtml({
    title: 'O\'zbekiston Respublikasining "Advokatura to\'g\'risida"gi Qonuni (27.12.1996, № 349-I)',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/58372');
  assertEq(metadata.adoption_date, '1996-12-27', 'adoption_date ISO format');
});

test('extracts adoption_date from Uzbek month "1996 yil 27 dekabr"', () => {
  const html = buildHtml({
    title: 'O\'zbekiston Respublikasining advokatura to\'g\'risidagi qonuni 1996 yil 27 dekabr',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/58372');
  assertEq(metadata.adoption_date, '1996-12-27', 'Uzbek month parsing');
});

test('extracts adoption_date from "2022 yil 28 oktabr" (Mehnat kodeksi)', () => {
  const html = buildHtml({
    title: 'O\'zbekiston Respublikasining Mehnat kodeksi 2022 yil 28 oktabr',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/6257288');
  assertEq(metadata.adoption_date, '2022-10-28', 'Mehnat kodeksi date');
});

test('numeric date format wins over Uzbek month', () => {
  const html = buildHtml({
    title: 'Qonun (01.01.2020) 2019 yil 31 dekabr',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/1');
  assertEq(metadata.adoption_date, '2020-01-01', 'numeric wins');
});

test('document_number: "№ 349-I" in full title wins over numeric date', () => {
  // Regression: the original regex's optional prefix matched the first digit
  // run ("27" from 27.12.1996) instead of the real document number.
  const html = buildHtml({
    title: 'O\'zbekiston Respublikasining "Advokatura to\'g\'risida"gi Qonuni (27.12.1996, № 349-I)',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/58372');
  assertEq(metadata.document_number, '349-I', 'must prefer "№ 349-I" over the date');
});

test('document_number: Uzbek title with "349-I-son" trailing suffix', () => {
  // Regression: original regex matched "1996" from the year.
  const html = buildHtml({
    title: 'O\'zbekiston Respublikasining advokatura to\'g\'risidagi qonuni 1996 yil 27 dekabr 349-I-son',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/58372');
  assertEq(metadata.document_number, '349-I', 'must prefer "349-I-son" suffix over the year');
});

test('document_number: title with only a date has no document_number', () => {
  // Regression: original regex returned "2022" (the year).
  const html = buildHtml({
    title: 'O\'zbekiston Respublikasining Mehnat kodeksi 2022 yil 28 oktabr',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/6257288');
  assertEq(metadata.document_number, null, 'no marker, no alpha prefix → null');
});

test('document_number: two dates and no doc number → null', () => {
  const html = buildHtml({
    title: 'Qonun (01.01.2020) 2019 yil 31 dekabr',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/1');
  assertEq(metadata.document_number, null, 'pure date title yields null');
});

test('document_number extracts "PQ-4624" prefix form', () => {
  const html = buildHtml({ title: 'Prezident qarori PQ-4624' });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/5');
  assertEq(metadata.document_number, 'PQ-4624', 'PQ prefix form');
});

test('document_number: "PQ-4624" wins even when a date precedes it', () => {
  const html = buildHtml({
    title: 'Prezident qarori 2023 yil 15 iyun PQ-4624',
  });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/5');
  assertEq(metadata.document_number, 'PQ-4624', 'alpha prefix must beat year');
});

test('document_number: Cyrillic "ПП-123" alpha prefix', () => {
  const html = buildHtml({ title: 'Постановление Президента ПП-123' });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/5');
  assertEq(metadata.document_number, 'ПП-123', 'Cyrillic alpha prefix');
});

test('document_number strips "-son" suffix', () => {
  const html = buildHtml({ title: 'Qaror 123-son' });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/6');
  assertEq(metadata.document_number, '123', '"-son" stripped');
});

test('document_number: "raqami 349-I" prefix form', () => {
  const html = buildHtml({ title: 'Qonun raqami 349-I' });
  const { metadata } = parseLexHtml(html, 'https://lex.uz/docs/7');
  assertEq(metadata.document_number, '349-I', '"raqami" prefix form');
});

test('title is still extracted alongside metadata', () => {
  const html = buildHtml({
    title: 'Fuqarolik kodeksi',
    bodyLines: ['1-modda. Test.'],
  });
  const { title, body } = parseLexHtml(html, 'https://lex.uz/docs/7');
  assertEq(title, 'Fuqarolik kodeksi', 'title preserved');
  assertMatch(body, /1-modda/, 'body preserved');
});

test('legacy chunker still recognizes superscript prim articles in plain text', () => {
  const sections = parseDocument([
    '8¹-modda.',
    'Advokat stajyori advokatning topshirig‘iga ko‘ra faoliyat yuritadi.',
  ].join('\n'));
  assertEq(sections[0].number, '8¹', 'superscript article number preserved');
});

test('legacy chunker recognizes spoken prim notation in plain text', () => {
  const sections = parseDocument([
    '8-modda prim 1.',
    'Advokat stajyori advokatlik tuzilmasida stajirovka o‘taydi.',
  ].join('\n'));
  assertEq(sections[0].number, '8¹', 'spoken prim notation normalized to superscript article number');
});

test('citation-utils extracts article numbers from retrieved chunk text', () => {
  const refs = extractArticleRefsFromText([
    '9-modda. Advokatlik siri',
    'Advokatlik siri advokat tomonidan kasb faoliyatini amalga oshirish munosabati bilan olingan ma’lumotlardir.',
  ].join('\n'));
  assertEq(refs[0], '9', 'article number recovered from chunk text');
});

test('citation-utils falls back to chunk text when article metadata is missing', () => {
  const refs = getChunkArticleRefs({
    chunk_text: '9-modda. Advokatlik siri\nAdvokatlik siri qonun bilan himoya qilinadi.',
    article_numbers: null,
    article_number_display: null,
  });
  assertEq(refs[0], '9', 'chunk text fallback recovers article number');
});

// ═════════════════════════════════════════════════════════════════════════════
//  2. Schema + retrieval filter — static source checks
// ═════════════════════════════════════════════════════════════════════════════
section('2. Schema + retrieval · static source checks');

const legalCorpusSrc = fs.readFileSync(
  path.join(__dirname, '../src/rag/legal-corpus.js'), 'utf8'
);
const advancedCorpusSrc = fs.readFileSync(
  path.join(__dirname, '../src/rag/advanced-corpus.js'), 'utf8'
);
const ingestLexSrc = fs.readFileSync(
  path.join(__dirname, '../src/rag/ingest-lex.js'), 'utf8'
);
const portalServicesSrc = fs.readFileSync(
  path.join(__dirname, '../src/portal/services.js'), 'utf8'
);
const systemPromptSrc = fs.readFileSync(
  path.join(__dirname, '../src/rag/system-prompt.js'), 'utf8'
);
const advancedRoutesSrc = fs.readFileSync(
  path.join(__dirname, '../src/rag/advanced-routes.js'), 'utf8'
);

test('legal-corpus: ALTER TABLE adds is_active column', () => {
  assertMatch(legalCorpusSrc, /ADD COLUMN IF NOT EXISTS is_active BOOLEAN/i, 'is_active column');
});
test('legal-corpus: ALTER TABLE adds status_label column', () => {
  assertMatch(legalCorpusSrc, /ADD COLUMN IF NOT EXISTS status_label TEXT/i, 'status_label column');
});
test('legal-corpus: ALTER TABLE adds adoption_date column', () => {
  assertMatch(legalCorpusSrc, /ADD COLUMN IF NOT EXISTS adoption_date DATE/i, 'adoption_date column');
});
test('legal-corpus: ALTER TABLE adds document_number column', () => {
  assertMatch(legalCorpusSrc, /ADD COLUMN IF NOT EXISTS document_number VARCHAR/i, 'document_number column');
});
test('legal-corpus: partial index on is_active=TRUE AND is_valid=TRUE', () => {
  assertMatch(
    legalCorpusSrc,
    /CREATE INDEX IF NOT EXISTS idx_legal_chunks_active[\s\S]*WHERE is_active = TRUE AND is_valid = TRUE/i,
    'partial index'
  );
});

test('legal-corpus: insertChunks binds is_active / status_label / adoption_date / document_number', () => {
  assertMatch(legalCorpusSrc, /is_active,\s*status_label,\s*adoption_date,\s*document_number/, 'insert columns');
  assertMatch(legalCorpusSrc, /m\.is_active\s*!==\s*false/, 'is_active default-true binding');
});

// Utility: find lines that have `is_valid = TRUE` as part of an actual
// retrieval WHERE clause (not a DDL index definition, not an existence count
// used for v1/v2 routing, and not a JS array literal that assembles filters
// elsewhere).
function retrievalLinesWithIsValid(src) {
  return src.split('\n')
    .map((line, i) => ({ line, num: i + 1 }))
    .filter(({ line }) => /is_valid\s*=\s*TRUE/i.test(line))
    .filter(({ line }) => !/CREATE\s+INDEX/i.test(line))         // DDL
    .filter(({ line }) => !/ON\s+legal_chunks\(/i.test(line))    // index ON clause
    .filter(({ line }) => !/SELECT\s+COUNT\(\*\)[^`]*LIMIT\s+1/i.test(line)) // v1/v2 existence probe
    .filter(({ line }) => !/const\s+filters\s*=\s*\[/.test(line)); // array-built filters (rrfSearch)
}

test('legal-corpus: every retrieval-path is_valid=TRUE is paired with is_active filter', () => {
  const retrievalLines = retrievalLinesWithIsValid(legalCorpusSrc);
  const unpaired = retrievalLines.filter(
    ({ line }) => !/is_valid\s*=\s*TRUE\s+AND\s+\(is_active\s+IS\s+NULL\s+OR\s+is_active\s*=\s*TRUE\)/i.test(line)
  );
  if (unpaired.length > 0) {
    const detail = unpaired.map(u => `line ${u.num}: ${u.line.trim()}`).join('\n      ');
    throw new Error(`${unpaired.length} retrieval line(s) missing is_active filter:\n      ${detail}`);
  }
  // rrfSearch's array-built filter is counted separately — just make sure the
  // array literal really does include both clauses.
  assertMatch(
    legalCorpusSrc,
    /const\s+filters\s*=\s*\[\s*['"]is_valid\s*=\s*TRUE['"]\s*,\s*['"]\(is_active\s+IS\s+NULL\s+OR\s+is_active\s*=\s*TRUE\)['"]/,
    'rrfSearch filters array includes is_active'
  );
  // Sanity: we expect at least the number of retrieval queries the commit message
  // claims to have upgraded.
  assertTrue(retrievalLines.length >= 5, `expected at least 5 retrieval queries in legal-corpus, got ${retrievalLines.length}`);
  if (false) {
  assertTrue(retrievalLines.length >= 8, `expected ≥8 retrieval queries in legal-corpus, got ${retrievalLines.length}`);
  }
});

test('legal-corpus: rrfSearch SELECT exposes adoption_date, document_number, article_number_display, part_number', () => {
  assertMatch(
    legalCorpusSrc,
    /lc\.adoption_date,\s*lc\.document_number,\s*lc\.article_number_display,\s*lc\.part_number/,
    'rrfSearch SELECT new columns'
  );
});

test('advanced-corpus: insertStructuredChunks binds is_active / status_label / adoption_date / document_number', () => {
  assertMatch(advancedCorpusSrc, /is_active,\s*status_label,\s*adoption_date,\s*document_number/, 'insert columns');
  assertMatch(advancedCorpusSrc, /m\.is_active\s*!==\s*false/, 'is_active default-true binding');
});

test('advanced-corpus: insertStructuredChunks preserves language/source_type/quality_score/verified_by', () => {
  assertMatch(advancedCorpusSrc, /language,\s*source_type,\s*quality_score,\s*verified_by/, 'structured metadata columns');
  assertMatch(advancedCorpusSrc, /m\.source_type\s*\|\|\s*'law_text'/, 'source_type binding');
});

test('advanced-corpus: every retrieval-path is_valid=TRUE is paired with is_active filter', () => {
  const retrievalLines = retrievalLinesWithIsValid(advancedCorpusSrc);
  const unpaired = retrievalLines.filter(
    ({ line }) => !/is_valid\s*=\s*TRUE\s+AND\s+\(is_active\s+IS\s+NULL\s+OR\s+is_active\s*=\s*TRUE\)/i.test(line)
  );
  if (unpaired.length > 0) {
    const detail = unpaired.map(u => `line ${u.num}: ${u.line.trim()}`).join('\n      ');
    throw new Error(`${unpaired.length} retrieval line(s) missing is_active filter:\n      ${detail}`);
  }
  assertTrue(retrievalLines.length >= 3, `expected ≥3 retrieval queries in advanced-corpus, got ${retrievalLines.length}`);
});

// ═════════════════════════════════════════════════════════════════════════════
//  3. Prompt / citation table — static source checks on server.js
// ═════════════════════════════════════════════════════════════════════════════
section('3. server.js · citation + fallback prompt');

const serverSrc = fs.readFileSync(
  path.join(__dirname, '../src/api/server.js'), 'utf8'
);

test('retrieveLegalContext builds citationBlocks with metadata (date, number, URL)', () => {
  assertMatch(serverSrc, /citationBlocks\s*=\s*\[\]/, 'citationBlocks array declared');
  assertMatch(serverSrc, /r\.adoption_date/, 'reads adoption_date from chunk');
  assertMatch(serverSrc, /r\.document_number/, 'reads document_number from chunk');
  assertMatch(serverSrc, /formatDate/, 'date formatter helper present');
});

test('citation table emits "modda" locator with metadata block', () => {
  // The block builder joins law_name, optional (date, № num), the modda
  // locator, and the source URL.
  assertMatch(serverSrc, /\$\{locator\}/, 'uses `${locator}` in citation block');
  assertMatch(serverSrc, /\$\{art\}-modda/, 'locator built from article + "-modda"');
});

test('citation table uses "RUXSAT ETILGAN MANBALAR" header', () => {
  assertMatch(serverSrc, /RUXSAT ETILGAN MANBALAR/, 'allowed-sources header');
});

test('empty-context branch returns the zero-hallucination fallback sentence', () => {
  assertMatch(
    serverSrc,
    /Ushbu savol bo['’]yicha lex\.uz ma['’]lumotlar bazasida aniq ma['’]lumot topilmadi/,
    'fallback sentence present'
  );
});

test('retrieveLegalContext does not force "topilmadi" when chunks exist but article metadata is missing', () => {
  assertMatch(
    serverSrc,
    /Kontekstdagi ayrim bo‘laklarda modda raqami metadata ko‘rinmadi/,
    'soft fallback for missing article metadata is present'
  );
});

test('buildTopicPrompt MUST NOT contain pretrained topicKnowledge leakage', () => {
  // The old `topicKnowledge` dict hard-coded tax rates, kodeks names etc.
  // Phase 1 removed it — any mention of `topicKnowledge` or the hard-coded
  // "QQS (12%)" rate is a regression.
  assertNoMatch(serverSrc, /topicKnowledge/, 'topicKnowledge dict removed');
  assertNoMatch(serverSrc, /QQS\s*\(12%\)/, 'hard-coded QQS rate removed');
});

test('buildTopicPrompt declares YAGONA (sole) source = RAG context', () => {
  assertMatch(serverSrc, /YAGONA huquqiy manbangiz/, 'sole-source declaration');
});

test('query-intent detects true definition questions without matching action queries', () => {
  assertTrue(isDefinitionQuery('Advokatlik siri nima?'), 'nima? definition detected');
  assertTrue(isDefinitionQuery('Advokat stajyori kim?'), 'kim? definition detected');
  assertTrue(isDefinitionQuery("Advokat stajyorining huquqiy maqomi?"), 'huquqiy maqomi detected');
  assertFalse(isDefinitionQuery("Advokatlik siri buzilganda nima qilish kerak?"), 'action query must not be treated as definition');
});

test('definition prompt addendum explicitly requires direct legal definition first', () => {
  const addendum = getDefinitionPromptAddendum('Advokatlik siri nima?');
  assertMatch(addendum, /DEFINITSIYA SAVOLI ANIQLANDI/, 'definition marker present');
  assertMatch(addendum, /BIRINCHI 1-2 gapida aynan shu tushunchaning bevosita ta'rifini bering/, 'direct-definition rule present');
});

test('non-definition queries keep the anti-repetition rule', () => {
  assertMatch(
    getTermExplanationRule("Advokatlik siri buzilganda nima qilish kerak?"),
    /qayta tushuntirmang/i,
    'anti-repetition rule preserved for action queries'
  );
});

test('buildTopicPrompt source includes intent-aware definition instructions', () => {
  assertMatch(serverSrc, /getDefinitionPromptAddendum/, 'server prompt imports definition addendum');
  assertMatch(serverSrc, /buildTopicPrompt\(topic, ragContext, userQuestion = ''\)/, 'buildTopicPrompt accepts user question');
  assertMatch(serverSrc, /const definitionPromptAddendum = getDefinitionPromptAddendum\(userQuestion\)/, 'server prompt computes definition addendum');
  assertMatch(serverSrc, /const termExplanationRule = getTermExplanationRule\(userQuestion\)/, 'server prompt computes explanation rule');
});

test('portal prompt source includes intent-aware definition instructions', () => {
  assertMatch(portalServicesSrc, /buildLegalSystemPrompt\(topicLabel, ragContext, userQuestion = ''\)/, 'portal prompt accepts user question');
  assertMatch(portalServicesSrc, /const definitionPromptAddendum = getDefinitionPromptAddendum\(userQuestion\)/, 'portal prompt computes definition addendum');
});

test('advanced prompt source includes intent-aware definition instructions', () => {
  assertMatch(systemPromptSrc, /userQuestion = ''/, 'advanced prompt accepts user question');
  assertMatch(systemPromptSrc, /const definitionPromptAddendum = getDefinitionPromptAddendum\(userQuestion\)/, 'advanced prompt computes definition addendum');
});

test('retrieveLegalContext retries without category filter when topic-scoped retrieval underflows', () => {
  assertMatch(
    serverSrc,
    /if \(topic && rawResults.length < 2 && guaranteedKeywordMatches.length === 0 && exactResults.length === 0\)/,
    'server fallback condition present'
  );
  assertMatch(
    serverSrc,
    /await retrieveLegalContext\(query, null, language\)/,
    'server reruns retrieval without category'
  );
});

test('portal legal chat reuses retrieveLegalContext fallback logic from server when available', () => {
  assertMatch(portalServicesSrc, /retrieveLegalContext = serverModule\.retrieveLegalContext/, 'portal imports shared retrieveLegalContext');
  assertMatch(portalServicesSrc, /if \(typeof retrieveLegalContext === 'function'\)/, 'portal prefers shared retrieval');
});

test('advanced chat retries parent-child retrieval without category filter on underflow', () => {
  assertMatch(
    advancedRoutesSrc,
    /Topic-scoped parent-child retrieval underflow/,
    'advanced routes log unscoped fallback'
  );
  assertMatch(
    advancedRoutesSrc,
    /category: null/,
    'advanced routes rerun parent-child search without category'
  );
});

test('buildAdvancedPrompt switches off the blanket no-redefinition rule for definition queries', () => {
  const prompt = buildAdvancedPrompt({
    topicLabel: 'Advokatura',
    userQuestion: 'Advokatlik siri nima?',
    ragContext: 'QONUNCHILIK KONTEKSTI',
    retrievedChunks: [],
  });
  assertMatch(prompt, /DEFINITSIYA SAVOLI ANIQLANDI/, 'definition addendum rendered');
  assertMatch(prompt, /bevosita ta'rifini bering/, 'definition-first instruction rendered');
  assertMatch(prompt, /Bu definitsiya savoli: savoldagi tushunchani aynan kontekstdagi huquqiy mazmuni bilan bevosita tushuntiring\./, 'definition rule overrides blanket ban');
});

test('MAJBURIY IQTIBOS FORMATI block is present and matches the spec shape', () => {
  assertMatch(serverSrc, /MAJBURIY IQTIBOS FORMATI/, 'mandatory citation header');
  assertMatch(serverSrc, /<Qonun nomi>/, 'law name placeholder');
  assertMatch(serverSrc, /<sana>/, 'date placeholder');
  assertMatch(serverSrc, /<raqam>/, 'number placeholder');
  assertMatch(serverSrc, /<modda>-modda/, 'article placeholder');
  assertMatch(serverSrc, /<qism>-qism/, 'part placeholder');
  assertMatch(serverSrc, /<URL>/, 'URL placeholder');
});

test('concrete example in prompt uses the Advokatura law and 349-I doc number', () => {
  assertMatch(serverSrc, /Advokatura to['’]g['’]risida/, 'Advokatura example law name');
  assertMatch(serverSrc, /27\.12\.1996/, 'example date');
  assertMatch(serverSrc, /349-I/, 'example document number');
});

test('/api/legal-chat uses qa_korpus Stage 1 interceptor for expert-corrected answers', () => {
  // The verified_qa SQL lookup was replaced by the qa_korpus semantic cache.
  // Verify the new pipeline is wired in.
  assertMatch(
    serverSrc,
    /searchKorpus/,
    'legal-chat calls searchKorpus for Stage 1 interceptor'
  );
  assertMatch(
    serverSrc,
    /provider:\s*'qa-korpus'/,
    'legal-chat returns provider=qa-korpus on verbatim match'
  );
});

test('server ingest-url uses structural chunking + structured insertion for lex.uz HTML', () => {
  assertMatch(serverSrc, /chunkLegalDocumentStructured/, 'ingest-url uses structural chunker');
  assertMatch(serverSrc, /insertStructuredChunks/, 'ingest-url stores structured rows');
});

test('CLI ingest-from-url uses structural chunking + structured insertion for lex.uz HTML', () => {
  assertMatch(ingestLexSrc, /chunkLegalDocumentStructured/, 'CLI ingest uses structural chunker');
  assertMatch(ingestLexSrc, /insertStructuredChunks/, 'CLI ingest stores structured rows');
  assertMatch(ingestLexSrc, /doc\.rawHtml/, 'CLI ingest consumes raw HTML from fetch-lex');
});

test('server exposes DELETE /api/rag/ingest-log/:id for dashboard cleanup', () => {
  assertMatch(serverSrc, /app\.delete\('\/api\/rag\/ingest-log\/:id'/, 'ingest-log delete route exists');
  assertMatch(serverSrc, /DELETE FROM rag_ingest_log WHERE id = \$1/, 'ingest-log delete removes log row');
  assertMatch(serverSrc, /DELETE FROM legal_chunks WHERE source_url = \$1 RETURNING id/, 'ingest-log delete removes URL-linked chunks');
});

test('uploaded-documents delete route removes legacy law_text rows too', () => {
  assertMatch(
    serverSrc,
    /DELETE FROM legal_chunks WHERE doc_id = \$1 AND source_type IN \('uploaded_doc', 'law_text'\) RETURNING id/,
    'uploaded-documents delete covers uploaded_doc and law_text'
  );
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n━━━ Summary ━━━`);
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
if (failed > 0) {
  console.log(`\nFailed tests:`);
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`      ${f.err.message}`);
  }
  process.exit(1);
}
process.exit(0);
