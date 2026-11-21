'use strict';

/**
 * DeepSeek Search / Fetch against our own lex.uz search (2026-10-27, owner:
 * a Boshqaruv button). Evaluation only - nothing in the answer pipeline uses
 * it. Two questions it answers, on a fixed set of questions whose governing
 * act is known:
 *
 *   Search - does DeepSeek Search, limited to lex.uz (`site:lex.uz`), put the
 *   governing act higher than lex.uz's own search does? Lex.uz lists the
 *   newest acts first (docs/lessons/2026-10-lexuz-va-javob-zanjiri.md).
 *   Ours here is the search PAGE only (no act is downloaded: the instance has
 *   512 MB), for the plan as the pipeline builds it (the AI planner's terms
 *   and the deterministic ones: their first four concept searches and every
 *   code / law search by form, a phrase that found nothing searched again
 *   shorter as in searchLexUz); a pinned act counts as found.
 *
 *   Fetch - does DeepSeek Fetch return a large act whole (the Civil Code,
 *   the Tax Code) with the line that decides a question (VMQ-589 band 17)?
 *   Our own reading of those pages is what took the instance down twice.
 *
 * Every call is one usage-ledger row (stage admin_test), priced per
 * successful request (model-pricing REQUEST_PRICES). One run: 5 questions x 2
 * searches + 3 fetches = 13 requests, at most $0.00975. Uses
 * DEEPSEEK_API_KEY; the key is never returned or logged.
 *
 * API (api-docs.deepseek.com/api/search, /api/fetch, read 2026-10-27):
 *   POST https://api.deepseek.com/v1/tools/search  { query (1-128 chars), count, ori_question }
 *     -> { results: [{ title, url, summary, rerank_score, date, ... }] }
 *   POST https://api.deepseek.com/v1/tools/fetch   { url } -> { title, content (Markdown) }
 */

const BASE = 'https://api.deepseek.com/v1/tools';
const QUERY_MAX = 128;

const CASES = Object.freeze([
  { id: 'itpark', question: 'Men IT park rezidentiman. Chet eldan ishchi olib kelish uchun tasdiqnoma kerakmi?', topic: 'mehnat', expect: { label: 'VMQ-589 (IT Park nizomi)', docId: '4422250' } },
  { id: 'pudrat', question: 'Pudratchi ishni bajarmadi, avansni qaytarmayapti', topic: 'fuqarolik', expect: { label: 'Fuqarolik kodeksi (ikkinchi qism)', docId: '180552' } },
  { id: 'ishhaqi', question: "Ish beruvchi ish haqini 3 oydan beri to'lamayapti, nima qilay?", topic: 'mehnat', expect: { label: 'Mehnat kodeksi', docId: '6257288' } },
  { id: 'ishdan', question: "Meni ishdan sababsiz bo'shatishdi, qayta tiklanish mumkinmi?", topic: 'mehnat', expect: { label: 'Mehnat kodeksi', docId: '6257288' } },
  { id: 'soliq', question: "Mol-mulk solig'i bo'yicha imtiyoz kimlarga beriladi?", topic: 'soliq', expect: { label: 'Soliq kodeksi', docId: '4674902' } },
]);

// what a whole reading must hold; our own body lengths as measured 2026-10-24..27
const FETCHES = Object.freeze([
  { label: 'VMQ-589 (IT Park nizomi)', url: 'https://lex.uz/docs/-4422250', mustHave: /tasdiqnomalarini\s+olmasdan\s+turib\s+chet\s+ellik\s+mutaxassislarni/iu, mustHaveLabel: '17-band: tasdiqnomasiz jalb etish', ourChars: 59214 },
  { label: 'Fuqarolik kodeksi (ikkinchi qism)', url: 'https://lex.uz/docs/-180552', mustHave: /642[\s-]*modda/iu, mustHaveLabel: '642-modda', ourChars: 685060 },
  { label: 'Soliq kodeksi', url: 'https://lex.uz/docs/-4674902', mustHave: /483[\s-]*modda/iu, mustHaveLabel: '483-modda (oxirgi modda)', ourChars: 1343354 },
]);

/** The lex.uz document id of a URL ("https://lex.uz/uz/docs/-180552#-188841" -> "180552"). */
function lexDocId(url = '') {
  const m = String(url || '').match(/lex\.uz\/(?:[a-z]{2}\/)?(?:docs|acts)\/-?(\d+)/iu);
  return m ? m[1] : '';
}

/** 1-based place of the expected act in a list of URLs, or null. */
function rankOf(urls = [], docId = '') {
  const i = (urls || []).findIndex(u => lexDocId(u) === String(docId));
  return i >= 0 ? i + 1 : null;
}

/** "<question> site:lex.uz", the question shortened at a word so the whole fits 128 characters. */
function siteQuery(text = '') {
  const suffix = ' site:lex.uz';
  const room = QUERY_MAX - suffix.length;
  let q = String(text || '').replace(/\s+/gu, ' ').trim();
  if (q.length > room) {
    const cut = q.slice(0, room + 1);
    q = (cut.lastIndexOf(' ') > 0 ? cut.slice(0, cut.lastIndexOf(' ')) : cut.slice(0, room)).trim();
  }
  return `${q}${suffix}`;
}

function createDeepseekToolsEval({ apiKey, fetchImpl = fetch, track, lexSearchPage, plan, timeoutMs = 30000, cases = CASES, fetches = FETCHES } = {}) {
  if (typeof track !== 'function') throw new Error('track is required');

  async function post(kind, body) {
    return track({
      provider: 'deepseek', model: `deepseek/tools-${kind}`, endpoint: `/admin/tools-eval/${kind}`,
      bound: { usd: 0.00075 }, retryTransient: 0,
    }, async (call) => {
      if (!apiKey) throw Object.assign(new Error('DEEPSEEK_API_KEY sozlanmagan'), { status: 401, code: 'NO_KEY' });
      const started = Date.now();
      const res = await fetchImpl(`${BASE}/${kind}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { json = null; }
      if (!res.ok) {
        const msg = (json && json.error && json.error.message) || `HTTP ${res.status}`;
        throw Object.assign(new Error(`DeepSeek ${kind} ${res.status}: ${String(msg).slice(0, 200)}`), { status: res.status });
      }
      const billed = kind === 'search' ? (Array.isArray(json && json.results) && json.results.length > 0) : !!(json && json.content);
      call.usage({ billedRequests: billed ? 1 : 0, modelReturned: `deepseek/tools-${kind}` });
      return { json: json || {}, ms: Date.now() - started };
    });
  }

  async function ours(c, steps) {
    if (steps.some(s => Array.isArray(s.pinnedDocs) && s.pinnedDocs.some(p => lexDocId(p.url) === c.expect.docId))) {
      return { rank: 1, how: 'pinned', queries: [] };
    }
    const urls = [];
    const queries = [];
    // the plan's own legal-concept searches and its code / law searches by form
    // (the ones that find a code: lex.uz lists the newest acts first)
    const picked = [...steps.filter(s => !s.pinnedDocs && ['official-concept', 'legal-concept'].includes(s.kind)).slice(0, 4), ...steps.filter(s => s.actForm)];
    for (const s of picked) {
      queries.push(`${s.query}${s.actForm ? ` (${s.actForm})` : ''}`);
      try { for (const u of await lexSearchPage(s.query, { actForm: s.actForm })) if (!urls.includes(u)) urls.push(u); } catch (_) { /* a page that failed counts as nothing found */ }
    }
    return { rank: rankOf(urls, c.expect.docId), how: 'search', queries, seen: urls.length };
  }

  async function deepseekSearch(query, question) {
    try {
      const { json, ms } = await post('search', { query, count: 10, ori_question: String(question || '').slice(0, QUERY_MAX) || null });
      const results = (json.results || []).map(r => ({ title: String(r.title || '').slice(0, 160), url: r.url, score: r.rerank_score, date: r.date || null }));
      return { query, ms, results };
    } catch (e) {
      return { query, error: e.message };
    }
  }

  async function run() {
    const startedAt = new Date().toISOString();
    const rows = [];
    for (const c of cases) {
      let steps = [];
      try { steps = (await plan(c.question, c.topic)) || []; } catch (_) { steps = []; }
      const concise = (steps.find(s => s.kind === 'legal-concept') || {}).query || c.question;
      const [our, q1, q2] = await Promise.all([
        ours(c, steps),
        deepseekSearch(siteQuery(c.question), c.question),
        deepseekSearch(siteQuery(concise), c.question),
      ]);
      rows.push({
        id: c.id, question: c.question, expect: c.expect,
        ours: our,
        deepseek: [q1, q2].map(s => ({ ...s, rank: s.results ? rankOf(s.results.map(r => r.url), c.expect.docId) : null, top: (s.results || []).slice(0, 3) })),
      });
    }
    const fetched = [];
    for (const f of fetches) {
      try {
        const { json, ms } = await post('fetch', { url: f.url });
        const content = String(json.content || '');
        fetched.push({ label: f.label, url: f.url, ms, title: String(json.title || '').slice(0, 160), chars: content.length, ourChars: f.ourChars, mustHave: f.mustHaveLabel, found: f.mustHave.test(content) });
      } catch (e) {
        fetched.push({ label: f.label, url: f.url, error: e.message, ourChars: f.ourChars, mustHave: f.mustHaveLabel });
      }
    }
    const requests = rows.length * 2 + fetched.length;
    return {
      startedAt, finishedAt: new Date().toISOString(),
      search: rows, fetch: fetched,
      summary: {
        cases: rows.length,
        oursFound: rows.filter(r => r.ours.rank).length,
        deepseekFound: rows.filter(r => r.deepseek.some(s => s.rank)).length,
        deepseekTop3: rows.filter(r => r.deepseek.some(s => s.rank && s.rank <= 3)).length,
        fetchWhole: fetched.filter(f => f.found).length,
        requests, maxUsd: Number((requests * 0.00075).toFixed(5)),
      },
    };
  }

  return { run };
}

module.exports = { createDeepseekToolsEval, CASES, FETCHES, lexDocId, rankOf, siteQuery };
