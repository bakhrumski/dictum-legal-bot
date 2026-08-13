'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildLexDeepLink,
  findCitationPartNumber,
  linkCitationsInMarkdown,
} = require('../src/rag/citation-utils');
const { parseLexStructured, chunkByArticle } = require('../src/rag/structural-chunker');
const { buildAnchorIndexFromHtml, normalizeSourceUrl } = require('../src/rag/lex-anchor-resolver');

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
  assert.match(linked, /\[253-moddasi, 2-qismiga\]\(https:\/\/lex\.uz\/uz\/docs\/6257288#:~:text=/u);
  assert.strictEqual((linked.match(/\]\(https:\/\/lex\.uz/gu) || []).length, 2);
});

test('existing Markdown citations are not linked a second time', () => {
  const answer = 'Tahlil\nMehnat kodeksi [253-moddasi](https://lex.uz/docs/old) qo‘llanadi.';
  const chunk = {
    law_name: 'Mehnat kodeksi',
    article_numbers: ['253'],
    source_url: 'https://lex.uz/uz/docs/6257288',
  };
  assert.strictEqual(linkCitationsInMarkdown(answer, [chunk]), answer);
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

test('the resolver accepts only HTTPS Lex.uz documents', () => {
  assert.strictEqual(normalizeSourceUrl('https://lex.uz/uz/docs/6257288#old'), 'https://lex.uz/uz/docs/6257288');
  assert.strictEqual(normalizeSourceUrl('http://lex.uz/docs/6257288'), '');
  assert.strictEqual(normalizeSourceUrl('https://lex.uz.evil.example/docs/6257288'), '');
});

test('older dashboard citations use the exact-anchor compatibility resolver', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
  assert.match(server, /app\.get\('\/api\/lex-anchor'/u);
  assert.match(dashboard, /const exactUrl = '\/api\/lex-anchor\?url='/u);
  assert.match(dashboard, /partNum \? '&part='/u);
  assert.doesNotMatch(dashboard, /url \+= '#:~:text='/u);
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

console.log(`\n${passed} citation deep-link tests passed.\n`);
