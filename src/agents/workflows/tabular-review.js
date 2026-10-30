'use strict';

/**
 * Tabular review (2026-10-22, the second workflow on the harness; Legora's
 * "many documents x many questions"): each document is a row, each question
 * a column, each cell an answer with the document's own words as its quote.
 *
 *   1. validate   no AI   up to 20 documents and 10 questions; missing input
 *                          halts with what is missing (nothing is charged)
 *   2. excerpt    no AI   per document, the clauses that match the questions,
 *                          their definitions and referred clauses
 *                          (document-job selectExcerpt, <= 20 000 chars) - a
 *                          longer document is never cut silently: the row
 *                          says which part was read
 *   3. extract    AI      one call per document for all its questions
 *                          (4 at a time); a document that fails is a failed
 *                          row, the others go on
 *   4. verify     no AI   a cell's quote must be in the document word for
 *                          word (spaces, case and apostrophe forms aside),
 *                          else the cell is shown "iqtibos manbada topilmadi"
 *                          - the answer stays, unverified; the page of a
 *                          found quote comes from the "[Sahifa n]" marks
 *
 * A verified quote shows that the words are in the document - not that the
 * answer drawn from them is right. Every cell says so in the page.
 *
 * Large tables (2026-10-28, roadmap stage 2): up to TABULAR_MAX_DOCS (100)
 * documents. The route prepares the input with no AI (`prepareInput`: the
 * columns and each document's excerpt with its "[Sahifa n]" marks), so an
 * agent run keeps the excerpts only, not whole documents; quotes are then
 * checked in the excerpt the model read (the same words, the same pages).
 * Past 10 documents the extraction is one step per 10 documents
 * (extract_1 … extract_k), each a checkpoint: a run resumed after a deploy
 * does not read again the documents it already read. A "choice" column
 * names its options; the answer must be one of them.
 *
 * deps: callAI(messages, opts) -> { text }.
 */

const { parseJson } = require('../harness');
const { selectExcerpt } = require('../../rag/document-job');

const LIMITS = Object.freeze({
  docs: Math.max(1, Math.min(200, Number(process.env.TABULAR_MAX_DOCS) || 100)),
  columns: 10, docChars: 150000, excerptChars: 20000, concurrency: 4, chunk: 10,
});
const TYPES = Object.freeze(['text', 'yesno', 'date', 'amount', 'choice']);

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const norm = (s) => String(s || '').toLocaleLowerCase('uz').replace(/[ʻʼ‘’`´']/gu, "'").replace(/[«»"“”„]/gu, '').replace(/\s+/gu, ' ').trim();

function readInput(input = {}) {
  const columns = (Array.isArray(input.columns) ? input.columns : []).slice(0, LIMITS.columns).map((c, i) => {
    let type = TYPES.includes(c && c.type) ? c.type : 'text';
    // a choice names 2-8 options; with fewer it is a text column
    const options = type === 'choice' ? [...new Set((Array.isArray(c.options) ? c.options : []).map(o => clean(o, 60)).filter(Boolean))].slice(0, 8) : [];
    if (type === 'choice' && options.length < 2) type = 'text';
    return { id: `c${i + 1}`, label: clean(c && c.label, 200), type, ...(type === 'choice' ? { options } : {}) };
  }).filter(c => c.label.length >= 3);
  const docs = (Array.isArray(input.documents) ? input.documents : []).slice(0, LIMITS.docs).map((d, i) => ({
    id: `d${i + 1}`, name: clean(d && d.name, 160) || `Hujjat ${i + 1}`, text: String((d && d.text) || '').slice(0, LIMITS.docChars),
  })).filter(d => d.text.replace(/\s+/gu, '').length >= 50);
  const missing = [];
  if (!docs.length) missing.push({ field: 'documents', question: "Kamida bitta matnli hujjat yuklang (PDF yoki DOCX)." });
  if (!columns.length) missing.push({ field: 'columns', question: "Kamida bitta savol (ustun) yozing." });
  return { docs, columns, missing, droppedDocs: Math.max(0, (Array.isArray(input.documents) ? input.documents.length : 0) - docs.length) };
}

/** The page a position falls on, from the last "[Sahifa n]" mark before it. */
function pageAt(text, index) {
  let page = null;
  // "[Sahifa n]" from a text PDF, "=== PAGE n ===" from an OCR reading of a scan
  for (const m of String(text).slice(0, index).matchAll(/\[Sahifa (\d+)\]|=== PAGE (\d+) ===/gu)) page = Number(m[1] || m[2]);
  return page;
}

/** The text normalised like norm(), with each output character's index in the original. */
function normWithMap(text) {
  const src = String(text || '');
  let out = '';
  const map = [];
  let space = false;
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (/[«»"“”„]/u.test(ch)) continue;
    if (/\s/u.test(ch)) { space = out.length > 0; continue; }
    if (space) { out += ' '; map.push(i); space = false; }
    if (/[\u02bb\u02bc\u2018\u2019`´']/u.test(ch)) ch = "'";
    const low = ch.toLocaleLowerCase('uz');
    for (const c of low) { out += c; map.push(i); }
  }
  return { out, map };
}

/** Where the quote starts in the document (an index in the original text), or -1. */
function findQuote(text, quote) {
  const q = norm(quote);
  if (q.length < 8) return -1;
  const { out, map } = normWithMap(text);
  const at = out.indexOf(q);
  return at < 0 ? -1 : map[at];
}

const TYPE_HINT = { text: 'qisqa javob', yesno: "faqat 'Ha', 'Yo'q' yoki 'Noma'lum'", date: 'sana (KK.OO.YYYY) yoki muddat', amount: 'summa va valyuta' };
const hintOf = c => (c.type === 'choice' ? `faqat quyidagilardan biri: ${c.options.join(' / ')} (yoki 'Topilmadi')` : TYPE_HINT[c.type]);

/**
 * The input as a run keeps it (no AI): { prepared: { docs, columns, droppedDocs } }
 * with each document's text replaced by its excerpt for the questions.
 */
function prepareInput(input = {}) {
  const r = readInput(input);
  if (r.missing.length) return { missing: r.missing };
  const query = r.columns.map(c => c.label).join('. ');
  const docs = r.docs.map((d) => {
    const x = selectExcerpt(d.text, query, LIMITS.excerptChars);
    return { id: d.id, name: d.name, text: x.text, excerpt: !!x.excerpt, insufficient: !!x.insufficient, totalChars: x.totalChars };
  });
  return { prepared: { docs, columns: r.columns, droppedDocs: r.droppedDocs }, docCount: docs.length, missing: [] };
}

/** One extraction call for one document. */
async function extractOne(d, part, columns, deps) {
  const qlist = columns.map(c => `${c.id}: ${c.label} (${hintOf(c)})`).join('\n');
  try {
    const r = await deps.callAI([
      { role: 'system', text: "Siz hujjatdan ma'lumot ajratuvchi yuristsiz. Faqat berilgan HUJJAT matniga tayaning, tashqi bilim qo'shmang. Har bir savol uchun: answer - qisqa javob; quote - javobga asos bo'lgan hujjat jumlasi, SO'ZMA-SO'Z (o'zgartirmasdan, 300 belgigacha). Hujjatda javob bo'lmasa: answer 'Topilmadi', quote ''. Faqat JSON: {\"answers\":[{\"id\":\"c1\",\"answer\":\"...\",\"quote\":\"...\"}]}" },
      { role: 'user', text: `SAVOLLAR:\n${qlist}\n\nHUJJAT (${d.name})${part.excerpt ? ' — savollarga mos qismlar' : ''}:\n${part.text}` },
    ], { temperature: 0, maxTokens: 1800, endpoint: '/api/agent/tabular-review' });
    const parsed = parseJson(r && r.text);
    const list = parsed && Array.isArray(parsed.answers) ? parsed.answers : null;
    if (!list) return { docId: d.id, status: 'failed', error: "javob JSON emas" };
    const byId = new Map(list.map(a => [String(a && a.id), a]));
    const cells = {};
    for (const c of columns) {
      const a = byId.get(c.id) || {};
      let answer = clean(a.answer, 600) || 'Topilmadi';
      // a choice answer outside its options is not an answer
      if (c.type === 'choice' && !/^topilmadi$/iu.test(answer) && !c.options.some(o => norm(o) === norm(answer))) answer = 'Topilmadi';
      cells[c.id] = { answer, quote: clean(a.quote, 400) };
    }
    return { docId: d.id, status: 'ok', cells };
  } catch (e) {
    return { docId: d.id, status: 'failed', error: clean(e && e.message, 120) };
  }
}

/** A part's text: its own (direct input) or the prepared input's excerpt (kept once, not in each checkpoint). */
function textOf(state, docId, part) {
  if (part && typeof part.text === 'string') return part.text;
  const p = state.input && state.input.prepared;
  const d = p && p.docs.find(x => x.id === docId);
  return d ? String(d.text || '') : '';
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The rows the extract steps have read so far, each quote checked in the
 * text the model read (no AI). The verify step, and a run stopped by its
 * limits or a cancel (settle shows and charges the rows already read).
 */
function verifyRows(state, extractIds = null) {
  const steps = (state && state.steps) || {};
  if (!steps.validate || !steps.excerpt) return { rows: [], verified: 0, unverified: 0 };
  const { docs, columns } = steps.validate;
  const byDoc = new Map(docs.map(d => [d.id, d]));
  const parts = new Map(steps.excerpt.parts.map(p => [p.docId, p]));
  const ids = extractIds || Object.keys(steps).filter(k => /^extract(_\d+)?$/u.test(k)).sort((a, b) => (Number(a.split('_')[1]) || 0) - (Number(b.split('_')[1]) || 0));
  const extracted = ids.flatMap(id => (steps[id] && steps[id].rows) || []);
  let verified = 0, unverified = 0;
  const rows = extracted.map(r => {
    const d = byDoc.get(r.docId), part = parts.get(r.docId);
    const base = { docId: r.docId, name: d.name, status: r.status, excerpt: part.excerpt, insufficient: part.insufficient };
    if (r.status !== 'ok') return { ...base, error: r.error };
    // the whole document when it came in whole, else the excerpt the model read (same words, same pages)
    const source = typeof d.text === 'string' ? d.text : textOf(state, r.docId, part);
    const cells = {};
    for (const c of columns) {
      const cell = r.cells[c.id];
      const notFound = /^topilmadi$/iu.test(cell.answer) && !cell.quote;
      const at = cell.quote ? findQuote(source, cell.quote) : -1;
      const ok = at >= 0;
      if (!notFound) { if (ok) verified++; else unverified++; }
      cells[c.id] = { answer: cell.answer, quote: cell.quote, verified: ok, notFound, page: ok ? pageAt(source, at) : null };
    }
    return { ...base, cells };
  });
  return { rows, verified, unverified };
}

/**
 * The workflow. `docCount` (known when the route prepared the input) splits
 * the extraction into one step per LIMITS.chunk documents past one chunk.
 */
function createTabularReviewWorkflow({ docCount = 0 } = {}) {
  const chunks = docCount > LIMITS.chunk ? Math.ceil(docCount / LIMITS.chunk) : 1;
  const extractSteps = Array.from({ length: chunks }, (_, k) => ({
    id: chunks === 1 ? 'extract' : `extract_${k + 1}`,
    label: chunks === 1 ? 'Javoblarni ajratish (AI)' : `Javoblarni ajratish (AI) ${k + 1}/${chunks}`,
    run: async (state, deps) => {
      const { docs, columns } = state.steps.validate;
      const slice = chunks === 1 ? docs : docs.slice(k * LIMITS.chunk, (k + 1) * LIMITS.chunk);
      const parts = new Map(state.steps.excerpt.parts.map(p => [p.docId, p]));
      const rows = await pool(slice, LIMITS.concurrency, (d) => { const p = parts.get(d.id); return extractOne(d, { ...p, text: textOf(state, d.id, p) }, columns, deps); });
      if (chunks === 1 && !rows.some(r => r.status === 'ok')) throw new Error("birorta hujjatni o'qib bo'lmadi");
      return { rows };
    },
    note: (o) => { const bad = o.rows.filter(r => r.status !== 'ok').length; return `${o.rows.length - bad} ta hujjat o'qildi${bad ? `, ${bad} tasi xato` : ''}`; },
  }));
  return {
    id: 'tabular_review',
    steps: [
      {
        id: 'validate', label: 'Hujjat va savollarni tekshirish',
        run: (state) => {
          // a prepared input (the route did it, no AI) carries the excerpts already
          // (the texts stay in the input only, not in this step's checkpoint)
          const p = state.input && state.input.prepared;
          if (p) return { docs: p.docs.map(({ text, ...meta }) => meta), columns: p.columns, droppedDocs: p.droppedDocs || 0, missing: [] };
          const r = readInput(state.input); return r.missing.length ? { ...r, halt: 'needs_input' } : r;
        },
        note: (o) => `${o.docs.length} hujjat × ${o.columns.length} savol`,
      },
      {
        id: 'excerpt', label: 'Har hujjatdan mos bandlarni tanlash',
        run: (state) => {
          const { docs, columns } = state.steps.validate;
          if (state.input && state.input.prepared) {
            return { parts: docs.map(d => ({ docId: d.id, excerpt: !!d.excerpt, insufficient: !!d.insufficient, totalChars: d.totalChars })) };
          }
          const query = columns.map(c => c.label).join('. ');
          return { parts: docs.map(d => { const x = selectExcerpt(d.text, query, LIMITS.excerptChars); return { docId: d.id, text: x.text, excerpt: !!x.excerpt, insufficient: !!x.insufficient, totalChars: x.totalChars }; }) };
        },
        note: (o) => { const cut = o.parts.filter(p => p.excerpt).length; return cut ? `${cut} ta uzun hujjatdan mos qismlar tanlandi` : "Hujjatlar to'liq o'qiladi"; },
      },
      ...extractSteps,
      {
        id: 'verify', label: 'Iqtiboslarni hujjat matnida tekshirish',
        run: (state) => {
          const out = verifyRows(state, extractSteps.map(st => st.id));
          if (!out.rows.some(r => r.status === 'ok')) throw new Error("birorta hujjatni o'qib bo'lmadi");
          return out;
        },
        note: (o) => `${o.verified} ta iqtibos topildi${o.unverified ? `, ${o.unverified} tasi topilmadi` : ''}`,
      },
    ],
  };
}

module.exports = { createTabularReviewWorkflow, readInput, prepareInput, verifyRows, findQuote, pageAt, LIMITS, TYPES };
