'use strict';

const assert = require('assert');
const {
  buildLexDeepLink,
  findCitationPartNumber,
  linkCitationsInMarkdown,
} = require('../src/rag/citation-utils');
const { parseLexStructured, chunkByArticle } = require('../src/rag/structural-chunker');

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

console.log(`\n${passed} citation deep-link tests passed.\n`);
