'use strict';

/**
 * "Shartnomani to'liq tekshirish" (2026-11-11, audit X8 / G2): one run does
 * what a lawyer did on three pages - the document analysis, the firm's own
 * rules, and the law behind the compliance remarks - and hands the proposals
 * to the editor. Nothing here is a new kind of AI work: each part is the
 * service that already exists, run together and reported once.
 *
 *   validate  no AI: the text and (optionally) the rules
 *   analysis  the website's analysis with the editor's fields (a risk's
 *             replacement, a missing clause's text)            deps.analyze
 *   rules     the playbook review (src/agents/workflows/playbook-review.js),
 *             only when rules were chosen; quotes checked in the contract
 *   law       for up to LAW_ISSUES compliance remarks: lex.uz retrieval, then
 *             one call that picks a source and quotes it; a quote that is not
 *             in the source word for word is dropped                deps.retrieve
 *   report    no AI: one result
 *
 * analysis and rules run side by side; either may fail and the other is
 * still delivered (each has its own units). A law quote says the words are
 * in that act - it is not a check that the remark is right, and a remark
 * with no quote is the analysis's own opinion; the report says which is
 * which. Firm rules are a side's preferences, never the law.
 */

const { runWorkflow, parseJson } = require('../harness');
const playbook = require('./playbook-review');
const { shape, fold } = require('../../editor/analysis');
const alpha = require('../../../public/js/uz-alphabet');

const LIMITS = Object.freeze({ docChars: playbook.LIMITS.docChars, minChars: 200, lawIssues: 3, lawSources: 9, sourceChars: 1800 });
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const norm = s => alpha.fold(fold(String(s || '').replace(/[«»"]/gu, '')));

function readInput(input = {}) {
  const text = String(input.text || '').slice(0, LIMITS.docChars);
  const rules = playbook.normRules(input.rules);
  const missing = [];
  if (text.replace(/\s+/gu, '').length < LIMITS.minChars) missing.push({ field: 'text', question: 'Shartnoma matnini yuklang (PDF yoki DOCX).' });
  return { text, name: clean(input.name, 160) || 'Shartnoma', rules, missing };
}

function createContractReviewWorkflow() {
  const rulesWorkflow = playbook.createPlaybookReviewWorkflow();
  return {
    id: 'contract_review', parallel: 2,
    steps: [
      {
        id: 'validate', label: 'Shartnomani tekshirish',
        run: (state) => { const r = readInput(state.input); return r.missing.length ? { ...r, halt: 'needs_input' } : r; },
        note: o => (o.rules.length ? `${o.rules.length} ta firma qoidasi bilan` : 'Firma qoidalarisiz'),
      },
      {
        id: 'analysis', label: 'Xatarlar va yetishmayotgan bandlar (AI tahlil)', after: ['validate'], optional: true,
        run: async (state, deps) => {
          const { text } = state.steps.validate;
          const out = await deps.analyze(text, { adminId: state.input.adminId || null });
          if (!out || !out.analysis) throw new Error("tahlil javobini o'qib bo'lmadi");
          return { result: shape(out.analysis, text) };
        },
        note: o => `${o.result.counts.risks} ta xatar, ${o.result.missing.length} ta yetishmayotgan band`,
      },
      {
        id: 'rules', label: 'Firma qoidalari bilan solishtirish', after: ['validate'], optional: true,
        when: state => state.steps.validate.rules.length > 0,
        run: async (state, deps) => {
          const { text, name, rules } = state.steps.validate;
          const out = await runWorkflow(rulesWorkflow, { text, name, rules }, { deps: { callAI: deps.callAI }, budget: { maxSteps: 6, maxMs: 150000 } });
          const s = (out.state && out.state.steps) || {};
          if (out.status !== 'done' || !s.verify) throw new Error("qoidalar bilan solishtirib bo'lmadi");
          return { results: s.verify.results, counts: s.verify.counts, downgraded: s.verify.downgraded, excerpt: !!(s.excerpt && s.excerpt.excerpt) };
        },
        note: o => `mos ${o.counts.mos}, farq ${o.counts.farq}, yo'q ${o.counts.yoq}, noaniq ${o.counts.noaniq}`,
      },
      {
        id: 'law', label: 'Qonunchilikdan asos qidirish (lex.uz)', after: ['analysis'], optional: true,
        when: state => !!(state.steps.analysis && state.steps.analysis.result.compliance.length),
        run: async (state, deps) => {
          const issues = state.steps.analysis.result.compliance.slice(0, LIMITS.lawIssues);
          const sources = [];
          const seen = new Set();
          for (const [i, c] of issues.entries()) {
            let res;
            try { res = await deps.retrieve(clean(`${c.article} ${c.issue}`, 220), null); } catch (_) { continue; }
            let taken = 0;
            for (const ch of (res && res.chunks) || []) {
              const article = clean(ch.article_number_display || (Array.isArray(ch.article_numbers) ? ch.article_numbers[0] : ''), 20);
              const key = `${norm(ch.law_name)}|${article}`;
              const text = clean(ch.chunk_text, LIMITS.sourceChars);
              if (!ch.law_name || !text || seen.has(key)) continue;
              seen.add(key);
              sources.push({ id: `S${sources.length + 1}`, issue: i, act: clean(ch.law_name, 200), article, url: ch.source_url || null, text });
              if (++taken >= 3 || sources.length >= LIMITS.lawSources) break;
            }
            if (sources.length >= LIMITS.lawSources) break;
          }
          if (!sources.length) return { laws: [], dropped: 0, searched: issues.length, found: 0 };
          const r = await deps.callAI([
            { role: 'system', text: "Siz O'zbekiston huquqi bo'yicha yuristsiz. Sizga shartnoma tahlilidagi MASALALAR va lex.uz MANBALARi beriladi. Har bir masala uchun unga bevosita taalluqli manbani tanlang va manba matnidan SO'ZMA-SO'Z iqtibos keltiring (o'zgartirmasdan, 300 belgigacha). Mos manba bo'lmasa, masalani tashlab keting - hech narsa o'ylab topmang. Faqat JSON: {\"basis\":[{\"issue\":1,\"sourceId\":\"S1\",\"quote\":\"...\"}]}" },
            { role: 'user', text: `MASALALAR:\n${issues.map((c, i) => `${i + 1}. ${c.article ? `${c.article}: ` : ''}${c.issue}`).join('\n')}\n\nMANBALAR:\n${sources.map(s => `[${s.id}] ${s.act}${s.article ? `, ${s.article}-modda` : ''}\n${s.text}`).join('\n\n')}` },
          ], { temperature: 0, maxTokens: 1200, endpoint: '/api/agent/contract-review' });
          const parsed = parseJson(r && r.text);
          const byId = new Map(sources.map(s => [s.id, s]));
          const laws = [];
          let dropped = 0;
          for (const it of (parsed && Array.isArray(parsed.basis) ? parsed.basis : []).slice(0, 9)) {
            const src = byId.get(String(it.sourceId || '').trim());
            const quote = clean(it.quote, 400);
            const issue = Number(it.issue) - 1;
            // the quote must be the source's own words, and one remark gets one source
            if (!src || !(issue >= 0 && issue < issues.length) || quote.length < 15 || !norm(src.text).includes(norm(quote)) || laws.some(l => l.issue === issue)) { dropped++; continue; }
            laws.push({ issue, act: src.act, article: src.article, url: src.url, quote });
          }
          return { laws, dropped, searched: issues.length, found: sources.length };
        },
        note: o => `${o.laws.length} ta izohga manba topildi${o.dropped ? `, ${o.dropped} ta iqtibos manbada topilmadi` : ''}`,
      },
      {
        id: 'report', label: 'Natijani yig\'ish', after: ['analysis', 'rules', 'law'],
        run: (state) => {
          const s = state.steps;
          const report = buildReport({ name: s.validate.name, hasRules: s.validate.rules.length > 0, analysis: s.analysis && s.analysis.result, rules: s.rules || null, law: s.law || null });
          if (report.parts.analysis !== 'ok' && report.parts.rules !== 'ok') throw new Error('hech bir qism bajarilmadi');
          return { report };
        },
        note: o => Object.entries(o.report.parts).map(([k, v]) => `${k}: ${v}`).join(', '),
      },
    ],
  };
}

/** What the run delivers. A part is 'ok', 'failed', or 'none' (not asked for / nothing to look up). */
function buildReport({ name, hasRules, analysis, rules, law }) {
  const laws = new Map(((law && law.laws) || []).map(l => [l.issue, l]));
  const a = analysis ? { ...analysis, compliance: analysis.compliance.map((c, i) => ({ ...c, law: laws.has(i) ? { act: laws.get(i).act, article: laws.get(i).article, url: laws.get(i).url, quote: laws.get(i).quote } : null, searched: !!law && i < (law.searched || 0) })) } : null;
  return {
    name,
    parts: { analysis: a ? 'ok' : 'failed', rules: !hasRules ? 'none' : (rules ? 'ok' : 'failed'), law: !a || !a.compliance.length ? 'none' : (law ? 'ok' : 'failed') },
    analysis: a,
    rules: rules ? { results: rules.results, counts: rules.counts, downgraded: rules.downgraded, excerpt: rules.excerpt } : null,
    lawDropped: (law && law.dropped) || 0,
  };
}

/**
 * The report as the editor's "AI tahlil" panel reads it (src/editor/analysis.js
 * shape): the analysis's own risks and missing clauses, then the firm rules
 * that differ (the contract's words -> the rule's wording) and the ones the
 * contract lacks (the wording to add). A rule proposal says it is a firm
 * rule, never the law.
 */
function editorResult(report, text) {
  const a = report.analysis || { docType: '', summary: '', score: null, risks: [], missing: [], compliance: [], strengths: [] };
  const sev = { high: 'high', medium: 'medium', low: 'low' };
  const risks = a.risks.slice(), missing = a.missing.slice();
  for (const [i, x] of ((report.rules && report.rules.results) || []).entries()) {
    const rl = x.rule || {};
    const why = clean(`Firma qoidasi (qonun emas): ${rl.requirement || ''}${x.note ? ` — ${x.note}` : ''}`, 1200);
    if (x.status === 'farq' && x.quote) {
      const found = !!x.verified && require('../../editor/analysis').locate(text, x.quote);
      risks.push({ id: `p${i + 1}`, level: sev[rl.severity] || 'medium', clause: clean(rl.title, 160), excerpt: clean(x.quote, 400), found, issue: why, suggestion: '',
        replacement: x.suggestion && fold(x.suggestion) !== fold(x.quote) ? clean(x.suggestion, 2000) : '', source: 'rule' });
    } else if (x.status === 'yoq') {
      missing.push({ id: `q${i + 1}`, clause: clean(rl.title, 160), importance: rl.severity === 'high' ? 'high' : 'medium', description: why, text: clean(x.suggestion || rl.preferred, 3000), source: 'rule' });
    }
  }
  return {
    docType: a.docType, summary: a.summary, score: a.score, risks, missing,
    compliance: a.compliance.map(c => ({ article: c.article, issue: c.issue, suggestion: c.suggestion })),
    strengths: a.strengths || [],
    counts: { risks: risks.length, found: risks.filter(r => r.found).length, proposals: risks.filter(r => r.found && r.replacement).length + missing.filter(m => m.text).length },
  };
}

module.exports = { createContractReviewWorkflow, readInput, buildReport, editorResult, LIMITS };
