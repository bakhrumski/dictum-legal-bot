'use strict';

/**
 * The explanation evaluation set (synthetic documents only - no real names,
 * no client files). Each fixture lists its pages, the key points a faithful
 * explanation must keep (with an exact anchor in the text and its page) and
 * the traps a lawyer reviews (rule A-F of the task, docs/quality/
 * explain-benchmark.md). `filler` pages make a long document whose key
 * clause is on its last page.
 */

const fs = require('fs');
const path = require('path');

function expand(fx) {
  if (!fx.filler) return { ...fx, pageCount: fx.pages.length };
  const { afterPage, count, firstClause, template } = fx.filler;
  const filler = Array.from({ length: count }, (_, i) => template.replace(/\{n\}/gu, String(firstClause + i)));
  const pages = [...fx.pages.slice(0, afterPage), ...filler, ...fx.pages.slice(afterPage)];
  const keyPoints = fx.keyPoints.map(k => ({ ...k, page: k.page === 'last' ? pages.length : k.page }));
  return { ...fx, pages, keyPoints, pageCount: pages.length };
}

function loadAll() {
  return fs.readdirSync(__dirname).filter(f => /^\d+-.*\.json$/u.test(f)).sort()
    .map(f => expand(JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'))));
}

module.exports = { loadAll, expand };
