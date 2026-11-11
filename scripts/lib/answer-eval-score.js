'use strict';

/**
 * Scores one legal answer of the web chat against its case (2026-11-10,
 * audit X7, docs/quality/answer-eval.md). No AI, no network: the checks read
 * the reply as /api/legal-chat gave it. A check passes, fails, warns or is
 * "n/a" (the case expects nothing there). A found act, article or phrase
 * says the words are there, not that the answer is legally right - that is
 * the lawyer's review of the case, and only reviewed cases speak for quality.
 *
 *   delivered     200, an answer, not marked "no legal content left"
 *   acts          every expected act is named in the answer, its links, the
 *                 citator or the retrieval's sources
 *   articles      every article the lawyer listed is cited ("N-modda", "статья N")
 *   structure     the answer has Tahlil and Xulosa
 *   must_say      every expected phrase (a regex, "a|b" for either) is there
 *   must_not_say  no forbidden phrase is there
 *   language      the answer is in the question's language (uz / ru)
 *   guard         the claim guard: verified / no_claims pass, partial warns,
 *                 unverified fails, absent (a cached or korpus answer) n/a
 *   quotes        quotes removed as not in the source: warn
 *   lex           lex.uz unreachable or past its deadline: warn (the
 *                 infrastructure, not the answer)
 */

const { fold } = require('../../public/js/uz-alphabet');

const norm = s => fold(String(s || '')).toLocaleLowerCase('uz')
  .replace(/[ʻʼ‘’`´]/gu, "'")
  .replace(/\s+/gu, ' ');

function docIdsIn(text = '') {
  const ids = new Set();
  for (const m of String(text || '').matchAll(/lex\.uz\/(?:[a-z]{2}\/)?(?:docs|acts)\/-?(\d+)/giu)) ids.add(m[1]);
  return ids;
}

/** Where an act may be named: the answer, the citator's titles, the retrieval's source list. */
function haystack(run) {
  const b = (run && run.body) || {};
  const cit = Array.isArray(b.citator) ? b.citator : [];
  const src = (b.rag && Array.isArray(b.rag.sources)) ? b.rag.sources : [];
  const text = [b.reply, ...cit.map(c => c && c.title), ...src.flatMap(s => (s && s.laws) || [])].map(norm).join(' \n ');
  const ids = docIdsIn(b.reply);
  for (const c of cit) { if (c && c.lexId) ids.add(String(c.lexId).replace(/^-/u, '')); for (const id of docIdsIn(c && c.url)) ids.add(id); }
  return { text, ids };
}

function actFound(act, hay) {
  if ((act.docIds || []).some(id => hay.ids.has(String(id)))) return true;
  return (act.match || []).some(m => hay.text.includes(norm(m)));
}

const articleRe = n => new RegExp(`(?:^|[^0-9])${String(n).replace(/[^0-9a-z-]/giu, '')}\\s*-?\\s*(?:modda|модда|band|банд)|(?:стать[яеиюй]|ст\\.|пункт[аеу]?|п\\.)\\s*${String(n).replace(/[^0-9a-z-]/giu, '')}(?![0-9])`, 'iu');

/** 'uz' | 'ru' | null (too little text) by the letters of the answer; quoted parts and links aside. */
function langOf(text = '') {
  const t = String(text || '').replace(/https?:\/\/\S+/gu, ' ').replace(/«[^»]*»|"[^"]*"/gu, ' ');
  const lat = (t.match(/[a-z]/giu) || []).length, cyr = (t.match(/[а-яёўқғҳ]/giu) || []).length;
  if (lat + cyr < 40) return null;
  if (lat >= cyr) return 'uz';
  return (t.match(/[ўқғҳ]/giu) || []).length >= Math.max(3, cyr / 200) ? 'uz' : 'ru';
}

/**
 * case: { lang, expect: { acts, articles, mustSay, mustNotSay } }
 * run:  { http, error, body: the /api/legal-chat reply }
 * Returns { checks: [{ id, result: 'pass'|'fail'|'warn'|'n/a', note }], passed, failed, warned }.
 */
function scoreRun(c, run) {
  const e = c.expect || {};
  const body = (run && run.body) || {};
  const answer = norm(body.reply);
  const rag = body.rag || {};
  const checks = [];
  const add = (id, result, note = '') => checks.push({ id, result, note });

  const delivered = !!run && run.http === 200 && !!answer && body.notSubstantive !== true;
  add('delivered', delivered ? 'pass' : 'fail', !run ? 'no run' : (body.notSubstantive ? 'huquqiy mazmun qolmadi' : `http ${run.http}${run.error ? ` ${run.error}` : ''}`));

  const acts = e.acts || [];
  if (!acts.length) add('acts', 'n/a');
  else {
    const hay = haystack(run);
    const missing = acts.filter(a => !actFound(a, hay)).map(a => a.label);
    add('acts', missing.length ? 'fail' : 'pass', missing.length ? `topilmadi: ${missing.join(', ')}` : `${acts.length} ta akt`);
  }

  const arts = e.articles || [];
  if (!arts.length) add('articles', 'n/a');
  else {
    const missing = arts.filter(n => !articleRe(n).test(String(body.reply || '')));
    add('articles', missing.length ? 'fail' : 'pass', missing.length ? `yo'q: ${missing.join(', ')}` : `${arts.length} ta modda`);
  }

  if (!answer) add('structure', 'fail', "javob yo'q");
  else add('structure', /tahlil|таҳлил|анализ/u.test(answer) && /xulosa|хулоса|вывод|заключени/u.test(answer) ? 'pass' : 'fail');

  const say = e.mustSay || [];
  if (!say.length) add('must_say', 'n/a');
  else {
    const missing = say.filter(p => !new RegExp(norm(p), 'u').test(answer));
    add('must_say', missing.length ? 'fail' : 'pass', missing.length ? `yo'q: ${missing.join('; ')}` : '');
  }
  const not = e.mustNotSay || [];
  if (!not.length) add('must_not_say', 'n/a');
  else {
    const found = not.filter(p => new RegExp(norm(p), 'u').test(answer));
    add('must_not_say', found.length ? 'fail' : 'pass', found.length ? `bor: ${found.join('; ')}` : '');
  }

  const want = c.lang === 'ru' ? 'ru' : 'uz';
  const got = langOf(body.reply);
  add('language', got == null ? 'n/a' : (got === want ? 'pass' : 'fail'), got == null ? '' : `kutilgan ${want}, javob ${got}`);

  const g = rag.claimGuard && rag.claimGuard.status;
  if (!g) add('guard', 'n/a', body.cached ? 'keshdan' : "tekshiruv ma'lumoti yo'q");
  else add('guard', g === 'verified' || g === 'no_claims' ? 'pass' : (g === 'partial' ? 'warn' : 'fail'), g);

  const removed = rag.quotes && (Array.isArray(rag.quotes.removed) ? rag.quotes.removed.length : Number(rag.quotes.removed) || 0);
  add('quotes', removed ? 'warn' : (rag.quotes ? 'pass' : 'n/a'), removed ? `${removed} ta iqtibos olib tashlangan` : '');

  const lx = rag.lexLive && rag.lexLive.status;
  add('lex', !lx || lx === 'none' ? 'n/a' : (lx === 'ok' ? 'pass' : 'warn'), lx || '');

  const count = r => checks.filter(x => x.result === r).length;
  return { checks, passed: count('pass'), failed: count('fail'), warned: count('warn') };
}

/** Totals over scored cases; reviewed and unreviewed apart (only reviewed ones speak for quality), and per topic. */
function summarize(rows = []) {
  const group = (list) => {
    const byCheck = {}, byTopic = {};
    for (const r of list) {
      for (const ch of r.score.checks) {
        const s = byCheck[ch.id] || (byCheck[ch.id] = { pass: 0, fail: 0, warn: 0, 'n/a': 0 });
        s[ch.result] += 1;
      }
      const t = byTopic[r.topic || '-'] || (byTopic[r.topic || '-'] = { cases: 0, allPassed: 0 });
      t.cases += 1; if (r.score.failed === 0) t.allPassed += 1;
    }
    const ms = list.map(r => r.run && r.run.ms).filter(Number.isFinite).sort((a, b) => a - b);
    return { cases: list.length, allPassed: list.filter(r => r.score.failed === 0).length, cached: list.filter(r => r.run && r.run.body && r.run.body.cached).length,
      medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null, byCheck, byTopic };
  };
  return { reviewed: group(rows.filter(r => r.reviewed)), unreviewed: group(rows.filter(r => !r.reviewed)) };
}

/**
 * Two reports of the same cases: what changed per case and check. Returns
 * { worse: [{ id, reviewed, check, from, to }], better: [...], onlyBefore: [ids], onlyAfter: [ids] }.
 */
function compare(before = [], after = []) {
  const rank = { pass: 0, 'n/a': 0, warn: 1, fail: 2 };
  const b = new Map(before.map(r => [r.id, r])), a = new Map(after.map(r => [r.id, r]));
  const out = { worse: [], better: [], onlyBefore: [...b.keys()].filter(id => !a.has(id)), onlyAfter: [...a.keys()].filter(id => !b.has(id)) };
  for (const [id, ra] of a) {
    const rb = b.get(id); if (!rb) continue;
    const was = Object.fromEntries(rb.score.checks.map(c => [c.id, c.result]));
    for (const ch of ra.score.checks) {
      const from = was[ch.id]; if (!from || rank[from] === rank[ch.result]) continue;
      (rank[ch.result] > rank[from] ? out.worse : out.better).push({ id, reviewed: !!ra.reviewed, check: ch.id, from, to: ch.result });
    }
  }
  return out;
}

module.exports = { scoreRun, summarize, compare, actFound, haystack, langOf, articleRe, norm };
