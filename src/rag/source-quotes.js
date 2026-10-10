'use strict';

/**
 * Key conditions tied to the document's own wording (2026-10-09; two live
 * runs dropped "declared", "including X", "all costs" and "separately" from
 * clauses the digest had kept). No AI.
 *
 * The key lines given to the final model (scope lines picked from the
 * DOCUMENT, never from the digest) carry an id bound to this document:
 * [S12·a3f9] - S12 is the line, a3f9 the first four hex digits of the
 * document's sha256. The model puts the id after its sentence on that clause;
 * the server puts the document's exact sentence under it. The server checks
 * every id: one this document did not issue (unknown number, another
 * document's key, no key) is refused and named, never quoted.
 *
 * A quote is the document's text, found in it character for character
 * (spaces aside) by the server - that is all it is. It does not check the
 * model's explanation around it: the explanation may still change a subject,
 * a condition or a consequence, and the mechanical checks run on the
 * explanation without the quotes, so a correct quote never hides it. Nothing
 * here is called verified or corrected.
 */

const crypto = require('crypto');

const flat = t => String(t || '').replace(/\s+/gu, ' ').trim();
const docKey = text => crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 4);

/**
 * Source lines for one document: each a sentence of the document found in it
 * verbatim (spaces aside). Returns { key, items: [{ id, tag, text }], notInSource }.
 */
function buildSources(documentText, sentences, { max = 40 } = {}) {
  const key = docKey(documentText);
  const all = flat(documentText);
  const items = [];
  let notInSource = 0;
  for (const s of sentences || []) {
    if (items.length >= max) break;
    const text = flat(s);
    if (!text || !all.includes(text)) { notInSource++; items.push(null); continue; }
    const id = `S${items.filter(Boolean).length + 1}`;
    items.push({ id, tag: `[${id}·${key}]`, text });
  }
  return { key, items, notInSource };
}

// what the model may write: [S12·a3f9]; also caught so they can be refused:
// [S12] (no key), [S12·zzzz] (another key)
const TAG = /\[\s*S(\d{1,3})\s*(?:[·.:-]\s*([0-9A-Za-z]{2,8}))?\s*\]/gu;
const letters = n => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(97 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/**
 * The answer with each id replaced by a placeholder the mechanical checks
 * ignore (letters only, no figure), and what each placeholder stands for:
 * { text, quotes: [{ mark, id, status, text? }] } where status is
 *   'quoted'          - an id this document issued: its sentence is quoted;
 *   'unknown_id'      - this document has no such line;
 *   'other_document'  - the key is not this document's;
 *   'no_key'          - written without the document key.
 */
function placeQuotes(answer, sources) {
  const byId = new Map(sources.items.filter(Boolean).map(x => [x.id, x]));
  const quotes = [];
  const text = String(answer || '').replace(TAG, (m, num, key) => {
    const id = `S${Number(num)}`;
    const mark = `⟪iqtibos ${letters(quotes.length)}⟫`;
    let status;
    if (!key) status = 'no_key';
    else if (key.toLowerCase() !== sources.key) status = 'other_document';
    else if (!byId.has(id)) status = 'unknown_id';
    else status = 'quoted';
    quotes.push({ mark, id, written: m, status, ...(status === 'quoted' ? { text: byId.get(id).text } : {}) });
    return mark;
  });
  return { text, quotes };
}

const STATUS_NOTE = {
  unknown_id: "bu hujjatda bunday manba qatori yo'q",
  other_document: 'identifikator bu hujjatga tegishli emas',
  no_key: "identifikator hujjat kalitisiz yozilgan",
};

/**
 * The reply with the placeholders turned into quotes: the id stays where the
 * model put it, the document's sentence goes on its own line under that
 * line; a refused id is named as refused. Each sentence is quoted once per answer.
 */
function renderQuotes(reply, quotes) {
  if (!quotes.length) return reply;
  const shown = new Set();
  return String(reply).split('\n').map((line) => {
    const here = quotes.filter(q => line.includes(q.mark));
    if (!here.length) return line;
    let out = line;
    const blocks = [];
    for (const q of here) {
      if (q.status === 'quoted') {
        out = out.replace(q.mark, `[${q.id}]`);
        if (!shown.has(q.id)) { shown.add(q.id); blocks.push(`> «${q.text}» — hujjat matnidan aynan parcha (${q.id})`); }
      } else {
        out = out.replace(q.mark, `[${q.id}: manba ko'rsatilmadi — ${STATUS_NOTE[q.status]}]`);
      }
    }
    return blocks.length ? `${out}\n${blocks.join('\n')}` : out;
  }).join('\n');
}

/** The note under the answer: what the quotes are, and are not. */
function quotesNote(quotes, sources) {
  const quoted = new Set(quotes.filter(q => q.status === 'quoted').map(q => q.id));
  const refused = quotes.filter(q => q.status !== 'quoted');
  const parts = [];
  if (quoted.size) parts.push(`${quoted.size} ta joyda hujjatning aynan matni keltirildi: server parchani hujjatda belgilar bo'yicha topdi, xolos — bu yonidagi izohning to'g'riligini tasdiqlamaydi (izoh subyekt, shart yoki oqibatni boshqacha aytgan bo'lishi mumkin; uni iqtibos bilan solishtiring)`);
  if (refused.length) parts.push(`${refused.length} ta identifikator rad etildi (${refused.map(q => `${q.id}: ${STATUS_NOTE[q.status]}`).join('; ')}) — ular uchun manba ko'rsatilmadi`);
  if (sources && sources.notInSource) parts.push(`${sources.notInSource} ta kalit qator hujjatda aynan topilmadi va manba sifatida berilmadi`);
  return parts.length ? `Iqtiboslar (AI emas): ${parts.join('; ')}.` : '';
}

module.exports = { docKey, buildSources, placeQuotes, renderQuotes, quotesNote, TAG };
