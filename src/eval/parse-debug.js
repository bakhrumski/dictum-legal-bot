'use strict';

/**
 * Parser debug — fetches ONE lex.uz document and shows exactly what text the
 * structural chunker sees for each article header, plus whether the article
 * number regexes match it.
 *
 * Context: ingest succeeds (CLAUSE_DEFAULT divs are found, parents/children
 * created) but articleNumber is '' for every article, so chunk_id ends in
 * "_art_" and article_number_display is NULL corpus-wide. This prints the
 * raw header strings with codepoints so we can see which character breaks
 * ARTICLE_HEADER_RX / ARTICLE_HEADER_RU.
 *
 *   node src/eval/parse-debug.js [lex-url]     (default: Fuqarolik kodeksi 1-qism)
 */

require('dotenv').config();
const cheerio = require('cheerio');
const { fetchLexDocument } = require('../rag/fetch-lex');

// Mirror the patterns from structural-chunker.js — keep in sync manually;
// duplicating here so this script tests the same logic without exporting internals.
const ARTICLE_HEADER_RX = /^(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)?[\s-]*(?:-?\s*)?(?:modda|модда)[\s.:]/im;
const ARTICLE_HEADER_RU = /^Статья\s+(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)?/im;

function cleanText(text) {
  return (text || '')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function codepoints(s) {
  return [...s].map(ch => {
    const cp = ch.codePointAt(0);
    return cp >= 0x20 && cp < 0x7f ? ch : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  }).join(' ');
}

async function main() {
  const url = process.argv[2] || 'https://lex.uz/uz/docs/111189';
  console.log(`Fetching: ${url}`);
  const doc = await fetchLexDocument(url);
  const html = doc.rawHtml || '';
  console.log(`HTML length: ${html.length}`);

  const $ = cheerio.load(html);
  const contentDivs = $('#divCont > div.lx_elem');
  console.log(`#divCont > div.lx_elem count: ${contentDivs.length}`);

  let clauseCount = 0;
  let matched = 0;
  let shown = 0;

  contentDivs.each((_, el) => {
    const $el = $(el);
    const classes = $el.attr('class') || '';
    if (!classes.includes('CLAUSE_DEFAULT')) return;
    clauseCount++;

    const anchor = $el.find('> a[id]').length ? $el.find('> a[id]') : $el.find('> div[id]');
    const anchorNote = anchor.length === 0 ? ' [NO ANCHOR — would be skipped]' : '';
    const text = cleanText((anchor.length ? anchor : $el).text());

    const m = text.match(ARTICLE_HEADER_RX) || text.match(ARTICLE_HEADER_RU);
    if (m) matched++;

    if (shown < 8 || (!m && shown < 16)) {
      shown++;
      const head = text.slice(0, 60);
      console.log(`\n[clause #${clauseCount}]${anchorNote} match=${m ? `"${m[1]}${m[2] || ''}"` : 'NO'}`);
      console.log(`  text:  "${head}${text.length > 60 ? '…' : ''}"`);
      console.log(`  chars: ${codepoints(head.slice(0, 30))}`);
    }
  });

  console.log('\n' + '─'.repeat(60));
  console.log(`CLAUSE_DEFAULT divs: ${clauseCount}`);
  console.log(`Header regex matched: ${matched}`);
  if (clauseCount > 0 && matched === 0) {
    console.log('=> Parser bug confirmed: header text never matches the article regexes.');
    console.log('   The codepoint dumps above show the offending characters.');
  }
  console.log('─'.repeat(60));
}

main().catch(err => {
  console.error('[PARSE-DEBUG] Fatal:', err.message);
  process.exit(1);
});
