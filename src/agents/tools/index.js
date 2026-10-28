'use strict';

/**
 * The tool registry of the planner agent (2026-10-28, roadmap PR-D,
 * docs/design/matter-va-agent-runs.md section 4). A tool has one job and
 * wraps code the platform already has - no new legal logic here:
 *
 *   matter_context  the matter's own notes and linked items (no AI)
 *   doc_excerpt     the clauses of a scanned document in the matter that
 *                   match the questions (src/rag/document-job selectExcerpt, no AI)
 *   lex_search      the legal corpus + live lex.uz search (retrieveLegalContext)
 *   answer          the answer in Tahlil / Xulosa from what the steps found
 *                   (one AI call, 1 chat unit)
 *   verify          the answer's quotes checked word for word and its citations
 *                   linked (citation-utils), then the claim guard
 *                   (legal-claim-guard): figures, terms, bases not in the
 *                   sources are withheld and named
 *
 * Each tool: { id, label, describe (one line the planner reads), cost
 * { service, units }, validate(args, ctx) -> error | null, run(args, ctx) }.
 * `ctx` is the run's: { adminId, matterId, deps, inputs (outputs of the
 * steps this one comes after), all (every finished step's output) }.
 * A tool reads only the run owner's data (ctx.adminId).
 */

const MAX_QUERY = 200;
const MAX_CHUNKS_PER_SEARCH = 8;
const MAX_CHUNK_TEXT = 4000;
const MAX_CONTEXT_CHARS = 24000;

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A retrieved chunk kept small enough for a checkpoint, with the fields the citation code reads. */
function slimChunk(c = {}) {
  const out = {};
  for (const k of ['id', 'law_name', 'law_name_ru', 'document_number', 'document_type', 'document_identifier', 'official_identifier', 'lex_doc_id', 'source_url',
    'article_number', 'article_number_display', 'article_numbers', 'article_title', 'part_number', 'heading', 'topic', 'language', 'lang', 'source', 'score']) {
    if (c[k] !== undefined) out[k] = c[k];
  }
  for (const k of ['chunk_text', 'parentText', 'content', 'text']) {
    if (typeof c[k] === 'string' && c[k]) { out[k] = c[k].slice(0, MAX_CHUNK_TEXT); }
  }
  return out;
}

/** Every chunk the run's searches found, once each, in the order found. */
function chunksOf(all = {}) {
  const seen = new Set(), list = [];
  for (const out of Object.values(all)) {
    for (const c of (out && out.chunks) || []) {
      const key = c.id || `${c.law_name}|${c.article_number_display || c.article_number || ''}|${String(c.chunk_text || '').slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(c);
    }
  }
  return list;
}

function createToolRegistry() {
  const tools = new Map();
  const add = (t) => tools.set(t.id, t);

  add({
    id: 'matter_context', label: "Ish ma'lumotlarini o'qish",
    describe: "ishning (matter) o'z yozuvlari va unga bog'langan chat, hujjat, natijalar ro'yxati; args {} (ish bo'lsa)",
    cost: null,
    validate: (args, ctx) => (ctx.matterId ? null : "matter_context faqat ish ichida ishlaydi"),
    async run(args, ctx) {
      const m = ctx.deps.matters ? await ctx.deps.matters.get(ctx.matterId, ctx.adminId) : null;
      if (!m) return { text: '', items: 0 };
      const notes = m.items.filter(i => i.kind === 'note').map(i => `- ${clean(i.note, 1500)}`);
      const others = m.items.filter(i => i.kind !== 'note').map(i => `- ${i.kind}: ${clean(i.title, 200)}`);
      const text = [`Ish: ${clean(m.title, 160)}`, m.summary ? `Tavsif: ${clean(m.summary, 2000)}` : '', notes.length ? `Yozuvlar:\n${notes.join('\n')}` : '', others.length ? `Bog'langan:\n${others.join('\n')}` : '']
        .filter(Boolean).join('\n');
      return { text: text.slice(0, 8000), items: m.items.length, note: `${m.items.length} ta element` };
    },
  });

  add({
    id: 'doc_excerpt', label: "Hujjatdan kerakli bandlarni olish",
    describe: "ishga bog'langan skanerlangan hujjatdan savolga mos bandlar; args { scanId, question }",
    cost: null,
    validate: (args, ctx) => {
      if (!args || !UUID.test(String(args.scanId || ''))) return 'doc_excerpt: scanId kerak';
      if (!ctx.matterScans || !ctx.matterScans.includes(args.scanId)) return "doc_excerpt: hujjat shu ishga bog'lanmagan";
      if (clean(args.question, 400).length < 5) return 'doc_excerpt: question kerak';
      return null;
    },
    async run(args, ctx) {
      const { getScan } = require('../../ocr/scan-store');
      const { selectExcerpt } = require('../../rag/document-job');
      const row = await getScan(ctx.deps.pool, { adminId: ctx.adminId, scanId: args.scanId });
      if (!row) throw new Error("hujjat topilmadi yoki muddati o'tgan");
      const sel = selectExcerpt(row.text, clean(args.question, 400));
      return { text: String(sel.text || '').slice(0, 20000), excerpt: !!sel.excerpt, insufficient: !!sel.insufficient, pages: row.pages, note: sel.excerpt ? "hujjat qismlari tanlandi" : "hujjat to'liq" };
    },
  });

  add({
    id: 'lex_search', label: 'Qonunchilikni qidirish (lex.uz)',
    describe: "qonunchilik bazasi va lex.uz'da qidirish; args { query (savolning huquqiy atamalari, 3-12 so'z), topic? }; ko'pi bilan 4 marta",
    cost: null,
    validate: (args) => (clean(args && args.query, MAX_QUERY).length >= 3 ? null : 'lex_search: query kerak'),
    async run(args, ctx) {
      const res = await ctx.deps.retrieve(clean(args.query, MAX_QUERY), args.topic ? clean(args.topic, 40) : null);
      const chunks = ((res && res.chunks) || []).slice(0, MAX_CHUNKS_PER_SEARCH).map(slimChunk);
      return { chunks, note: `${chunks.length} ta manba` };
    },
  });

  add({
    id: 'answer', label: 'Javob yozish (Tahlil va Xulosa)',
    describe: "topilgan manbalar va ish ma'lumotlari asosida javob; args { question }; undan keyin albatta verify",
    cost: { service: 'chat', units: 1 },
    validate: (args) => (clean(args && args.question, 2000).length >= 5 ? null : 'answer: question kerak'),
    async run(args, ctx) {
      const { exceptionRule, promptRules } = require('../../rag/answer-structure');
      const chunks = chunksOf(ctx.all);
      const lang = /[Ѐ-ӿ]/u.test(args.question) ? 'ru' : 'uz';
      let room = MAX_CONTEXT_CHARS;
      const sources = [];
      for (const [i, c] of chunks.entries()) {
        const head = `[${i + 1}] ${clean(c.law_name, 200)}${c.article_number_display || c.article_number ? `, ${c.article_number_display || c.article_number}-modda` : ''}${c.source_url ? ` (${c.source_url})` : ''}`;
        const body = String(c.chunk_text || c.parentText || c.content || c.text || '').slice(0, Math.max(0, Math.min(3000, room)));
        if (!body) continue;
        sources.push(`${head}\n${body}`);
        room -= body.length + head.length;
        if (room <= 200) break;
      }
      const facts = Object.values(ctx.all).filter(o => o && typeof o.text === 'string' && o.text && !o.chunks && !o.answer).map(o => o.text).join('\n\n').slice(0, 12000);
      const system = [
        "Siz O'zbekiston qonunchiligi bo'yicha yuridik maslahatchisiz. Javobni FAQAT KONTEKSTdagi manbalar va ish ma'lumotlari asosida yozing; manbada yo'q norma, raqam yoki muddatni to'qimang.",
        "Javob ikki bo'limdan iborat: **Tahlil** (hal qiluvchi normadan boshlang: hujjat nomi, raqami, modda; uni vaziyatga qo'llang; har normani bir marta) va **Xulosa** (1-2 gap: to'g'ridan-to'g'ri javob va keyingi qadam, Tahlilni takrorlamang).",
        "Har bir normani markdown havola bilan keltiring: [Hujjat nomi, N-modda](lex.uz havolasi) - havolani faqat KONTEKSTdagi manbadan oling.",
        promptRules(lang),
        exceptionRule(lang),
        "Manbalar savolga javob berish uchun yetarli bo'lmasa, buni ochiq ayting va xulosa chiqarmang.",
        lang === 'ru' ? 'Отвечайте на русском языке.' : "Javobni o'zbek tilida (lotin) yozing.",
      ].join('\n');
      const user = `${facts ? `ISH MA'LUMOTLARI:\n${facts}\n\n` : ''}KONTEKST:\n${sources.join('\n\n') || "(manba topilmadi)"}\n\nSAVOL: ${clean(args.question, 2000)}`;
      const usageLedger = require('../../ai/usage-ledger');
      const r = await usageLedger.withStage('answer', () => ctx.deps.callAI([{ role: 'system', text: system }, { role: 'user', text: user }], { maxTokens: 2200, temperature: 0.2, endpoint: '/api/agent/plan#answer' }));
      const text = String((r && (r.text || r.content)) || '').trim();
      if (!text) throw new Error("javob bo'sh qaytdi");
      return { answer: text, question: clean(args.question, 2000), lang, sources: chunks.length, truncated: !!(r && r.finishReason === 'length'), note: `${chunks.length} ta manba asosida` };
    },
  });

  add({
    id: 'verify', label: "Javobni manbalar bilan tekshirish",
    describe: "javobdagi iqtibos, raqam, muddat va asoslarni manbalar bilan tekshirish; args {}; har doim oxirgi qadam",
    cost: null,
    validate: () => null,
    async run(args, ctx) {
      const ans = Object.values(ctx.all).find(o => o && typeof o.answer === 'string');
      if (!ans) throw new Error('tekshiriladigan javob yo\'q');
      const chunks = chunksOf(ctx.all);
      const { normalizeLegalAnswerCitationsDetailed } = require('../../rag/citation-utils');
      const { guardLegalAnswer } = require('../../rag/legal-claim-guard');
      const linked = normalizeLegalAnswerCitationsDetailed(ans.answer, chunks, ans.lang);
      const g = await guardLegalAnswer({ question: ans.question, answer: linked.text, chunks, callAI: ctx.deps.callCheapAI || ctx.deps.callAI, lang: ans.lang, truncated: ans.truncated });
      return {
        text: g.text, status: g.status, substantive: g.substantive !== false,
        withheld: (g.withheld || []).length, unconfirmed: (g.unconfirmed || []).length,
        quotes: linked.quotes ? { kept: linked.quotes.kept, removed: linked.quotes.removed } : null,
        note: `${g.status}; ${(g.withheld || []).length} ta da'vo olib tashlandi`,
      };
    },
  });

  return {
    tools,
    get: id => tools.get(id) || null,
    /** The lines the planner reads: "id: what it does". */
    describe: () => [...tools.values()].map(t => `- ${t.id}: ${t.describe}`).join('\n'),
  };
}

module.exports = { createToolRegistry, slimChunk, chunksOf, MAX_QUERY };
