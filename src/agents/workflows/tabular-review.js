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
 * deps: callAI(messages, opts) -> { text }.
 */

const { parseJson } = require('../harness');
const { selectExcerpt } = require('../../rag/document-job');

const LIMITS = Object.freeze({ docs: 20, columns: 10, docChars: 150000, excerptChars: 20000, concurrency: 4 });
const TYPES = Object.freeze(['text', 'yesno', 'date', 'amount']);

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const norm = (s) => String(s || '').toLocaleLowerCase('uz').replace(/[ʻʼ‘’`´']/gu, "'").replace(/[«»"“”„]/gu, '').replace(/\s+/gu, ' ').trim();

function readInput(input = {}) {
  const columns = (Array.isArray(input.columns) ? input.columns : []).slice(0, LIMITS.columns).map((c, i) => ({
    id: `c${i + 1}`, label: clean(c && c.label, 200), type: TYPES.includes(c && c.type) ? c.type : 'text',
  })).filter(c => c.label.length >= 3);
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

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function createTabularReviewWorkflow() {
  return {
    id: 'tabular_review',
    steps: [
      {
        id: 'validate', label: 'Hujjat va savollarni tekshirish',
        run: (state) => { const r = readInput(state.input); return r.missing.length ? { ...r, halt: 'needs_input' } : r; },
        note: (o) => `${o.docs.length} hujjat × ${o.columns.length} savol`,
      },
      {
        id: 'excerpt', label: 'Har hujjatdan mos bandlarni tanlash',
        run: (state) => {
          const { docs, columns } = state.steps.validate;
          const query = columns.map(c => c.label).join('. ');
          return { parts: docs.map(d => { const x = selectExcerpt(d.text, query, LIMITS.excerptChars); return { docId: d.id, text: x.text, excerpt: !!x.excerpt, insufficient: !!x.insufficient, totalChars: x.totalChars }; }) };
        },
        note: (o) => { const cut = o.parts.filter(p => p.excerpt).length; return cut ? `${cut} ta uzun hujjatdan mos qismlar tanlandi` : "Hujjatlar to'liq o'qiladi"; },
      },
      {
        id: 'extract', label: 'Javoblarni ajratish (AI)',
        run: async (state, deps) => {
          const { docs, columns } = state.steps.validate;
          const parts = new Map(state.steps.excerpt.parts.map(p => [p.docId, p]));
          const qlist = columns.map(c => `${c.id}: ${c.label} (${TYPE_HINT[c.type]})`).join('\n');
          const rows = await pool(docs, LIMITS.concurrency, async (d) => {
            const part = parts.get(d.id);
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
                cells[c.id] = { answer: clean(a.answer, 600) || 'Topilmadi', quote: clean(a.quote, 400) };
              }
              return { docId: d.id, status: 'ok', cells };
            } catch (e) {
              return { docId: d.id, status: 'failed', error: clean(e && e.message, 120) };
            }
          });
          if (!rows.some(r => r.status === 'ok')) throw new Error("birorta hujjatni o'qib bo'lmadi");
          return { rows };
        },
        note: (o) => { const bad = o.rows.filter(r => r.status !== 'ok').length; return `${o.rows.length - bad} ta hujjat o'qildi${bad ? `, ${bad} tasi xato` : ''}`; },
      },
      {
        id: 'verify', label: 'Iqtiboslarni hujjat matnida tekshirish',
        run: (state) => {
          const { docs, columns } = state.steps.validate;
          const byDoc = new Map(docs.map(d => [d.id, d]));
          const parts = new Map(state.steps.excerpt.parts.map(p => [p.docId, p]));
          let verified = 0, unverified = 0;
          const rows = state.steps.extract.rows.map(r => {
            const d = byDoc.get(r.docId), part = parts.get(r.docId);
            const base = { docId: r.docId, name: d.name, status: r.status, excerpt: part.excerpt, insufficient: part.insufficient };
            if (r.status !== 'ok') return { ...base, error: r.error };
            const cells = {};
            for (const c of columns) {
              const cell = r.cells[c.id];
              const notFound = /^topilmadi$/iu.test(cell.answer) && !cell.quote;
              const at = cell.quote ? findQuote(d.text, cell.quote) : -1;
              const ok = at >= 0;
              if (!notFound) { if (ok) verified++; else unverified++; }
              cells[c.id] = { answer: cell.answer, quote: cell.quote, verified: ok, notFound, page: ok ? pageAt(d.text, at) : null };
            }
            return { ...base, cells };
          });
          return { rows, verified, unverified };
        },
        note: (o) => `${o.verified} ta iqtibos topildi${o.unverified ? `, ${o.unverified} tasi topilmadi` : ''}`,
      },
    ],
  };
}

module.exports = { createTabularReviewWorkflow, readInput, findQuote, pageAt, LIMITS, TYPES };
