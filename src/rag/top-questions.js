'use strict';

/**
 * Most-asked questions by legal field (2026-10-13, owner + lawyer: build the
 * lawyer-verified Q&A bank from what people actually ask). READ ONLY: it
 * reads the questions the platform already logs and changes nothing; no AI
 * call.
 *
 *   web chat   coverage_log (query, topic, weak = the corpus returned too
 *              little law for it)
 *   Telegram   requests (request_text, category, source_channel='telegram')
 *   missing    suggested_sources (acts Lex.uz returned that the corpus lacks,
 *              by times_suggested)
 *   covered    qa_korpus (a group whose question is close to a bank question
 *              is marked, so the lawyer sees what is already done)
 *
 * Questions are grouped without AI: the same text after normalisation, then
 * near-duplicates by word overlap (stems, >= 0.6 Jaccard). A group is a
 * planning aid, never a claim that the questions mean the same thing.
 * Personal numbers are masked in every example (phones, e-mails, passport,
 * JShShIR, card and long numbers); names cannot be masked reliably, so the
 * report is for the master and the lawyer only.
 */

const MAX_ROWS = 20000;
const JACCARD = 0.6;

const STOP = new Set(['qanday', 'qanaqa', 'nima', 'nimaga', 'kerak', 'kerakmi', 'mumkin', 'mumkinmi', 'bilan', 'uchun', 'haqida', 'agar', 'bo\'lsa', 'bo\'ladi', 'bo\'ladimi', 'qilish', 'qilsa', 'menga', 'mening', 'meni', 'bizning', 'biz', 'sizning', 'yoki', 'hamda', 'lekin', 'ammo', 'bu', 'shu', 'ushbu', 'bor', 'yo\'q', 'emas', 'qancha', 'qachon', 'qayerda', 'iltimos', 'salom', 'assalomu', 'alaykum', 'rahmat', 'как', 'что', 'это', 'для', 'или', 'если', 'можно', 'нужно', 'мне']);

/** Personal numbers masked (the text is otherwise kept). */
function maskPersonal(text = '') {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gu, '[email]')
    .replace(/\b[A-ZА-Я]{2}\s?\d{7}\b/gu, '[pasport]')
    .replace(/\+?998[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/gu, '[telefon]')
    .replace(/\b\d{14}\b/gu, '[JShShIR]')
    .replace(/\b(?:\d[ -]?){16}\b/gu, '[karta]')
    .replace(/\b\d{9,}\b/gu, '[raqam]');
}

/** One text for grouping: lower case, one apostrophe, no punctuation. */
function normalizeQuestion(text = '') {
  return maskPersonal(text)
    .toLocaleLowerCase('uz')
    .replace(/[ʻʼ‘’`´]/gu, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

// the masks and the common verbs (qilish / qiladi / qila..., bo'lish, olish,
// etish) carry no subject: they are not grouping words
const MASKS = /\[(?:email|pasport|telefon|JShShIR|karta|raqam)\]/gu;
const VERB = /^(?:qil|bo'l|bol|ola|oli|eta|eti|qila)/u;

/** Content stems (first 6 letters of words over 3 letters; stop words, masks and common verbs out). */
function stems(text = '') {
  return new Set(normalizeQuestion(String(text || '').replace(MASKS, ' ')).replace(MASKS, ' ').split(' ')
    .filter(w => w.length > 3 && !STOP.has(w) && !VERB.test(w) && !/^(?:email|pasport|telefon|jshshir|karta|raqam)$/u.test(w))
    .map(w => w.replace(/'/gu, '').slice(0, 6)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * rows: [{ text, topic, channel, weak, at }] -> groups per topic, most asked
 * first: { topic, count, channels, weak, example, variants, lastSeen }.
 */
function groupQuestions(rows = [], { minChars = 15 } = {}) {
  const exact = new Map();
  for (const r of rows) {
    const text = String(r && r.text || '').trim();
    if (text.length < minChars) continue;
    const norm = normalizeQuestion(text);
    if (!norm) continue;
    const topic = String(r.topic || '(belgilanmagan)');
    const key = `${topic}\u0000${norm}`;
    const e = exact.get(key) || { topic, norm, count: 0, channels: {}, weak: 0, example: maskPersonal(text).slice(0, 400), lastSeen: null };
    e.count++;
    e.channels[r.channel || 'web'] = (e.channels[r.channel || 'web'] || 0) + 1;
    if (r.weak) e.weak++;
    const at = r.at ? new Date(r.at) : null;
    if (at && !Number.isNaN(at.getTime()) && (!e.lastSeen || at > e.lastSeen)) e.lastSeen = at;
    exact.set(key, e);
  }
  const byTopic = new Map();
  for (const e of [...exact.values()].sort((a, b) => b.count - a.count)) {
    const groups = byTopic.get(e.topic) || [];
    const s = stems(e.norm);
    let target = null;
    if (s.size >= 2) {
      let best = 0;
      for (const g of groups) {
        const j = jaccard(s, g.stems);
        if (j >= JACCARD && j > best) { best = j; target = g; }
      }
    }
    if (!target) {
      target = { topic: e.topic, stems: s, count: 0, channels: {}, weak: 0, example: e.example, variants: [], lastSeen: null };
      groups.push(target);
    } else if (target.variants.length < 3 && e.example !== target.example) {
      target.variants.push(e.example);
    }
    target.count += e.count;
    target.weak += e.weak;
    for (const [c, n] of Object.entries(e.channels)) target.channels[c] = (target.channels[c] || 0) + n;
    if (e.lastSeen && (!target.lastSeen || e.lastSeen > target.lastSeen)) target.lastSeen = e.lastSeen;
    byTopic.set(e.topic, groups);
  }
  return byTopic;
}

/** The bank entry closest to a group (word overlap), or null. */
function bankMatch(group, bank = []) {
  let best = null;
  for (const q of bank) {
    const j = jaccard(group.stems, q.stems);
    if (j >= JACCARD && (!best || j > best.overlap)) best = { id: q.id, overlap: Math.round(j * 100) / 100 };
  }
  return best;
}

/**
 * The report. db is a pg pool (or { query }). Each source is read on its own:
 * a missing table or column leaves that source out and names it, never fails
 * the report.
 */
async function buildReport(db, { days = 90, perTopic = 50 } = {}) {
  const d = Math.min(365, Math.max(1, Number(days) || 90));
  const n = Math.min(200, Math.max(5, Number(perTopic) || 50));
  const sources = {};
  const rows = [];
  const read = async (name, sql, map) => {
    try {
      const r = await db.query(sql, [d]);
      for (const row of r.rows) rows.push(map(row));
      sources[name] = { rows: r.rows.length, capped: r.rows.length >= MAX_ROWS };
    } catch (e) {
      sources[name] = { rows: 0, error: String(e && e.message || e).slice(0, 160) };
    }
  };
  await read('web_chat', `SELECT query, topic, weak, created_at FROM coverage_log
      WHERE created_at > NOW() - ($1::int * INTERVAL '1 day') ORDER BY created_at DESC LIMIT ${MAX_ROWS}`,
  r => ({ text: r.query, topic: r.topic, weak: r.weak === true, channel: 'web', at: r.created_at }));
  // the question is sealed at rest (E6): opened by its id
  await read('telegram', `SELECT id, request_text, category, created_at FROM requests
      WHERE source_channel = 'telegram' AND COALESCE(request_type, 'text') = 'text'
        AND created_at > NOW() - ($1::int * INTERVAL '1 day') ORDER BY created_at DESC LIMIT ${MAX_ROWS}`,
  r => ({ text: require('../privacy/request-text').openRequest(r, r.id, { response: null }).request_text, topic: r.category, weak: false, channel: 'telegram', at: r.created_at }));

  let bank = [];
  try {
    const b = await db.query('SELECT id, question FROM qa_korpus');
    bank = b.rows.map(r => ({ id: r.id, stems: stems(r.question) }));
    sources.qa_korpus = { rows: b.rows.length };
  } catch (e) { sources.qa_korpus = { rows: 0, error: String(e && e.message || e).slice(0, 160) }; }

  let missingActs = [];
  try {
    const m = await db.query(`SELECT topic, title, lex_url, times_suggested, sample_query FROM suggested_sources
        WHERE status = 'pending' ORDER BY times_suggested DESC, id DESC LIMIT 100`);
    missingActs = m.rows.map(r => ({ topic: r.topic, title: r.title, url: r.lex_url, timesSuggested: r.times_suggested, sampleQuestion: maskPersonal(r.sample_query || '').slice(0, 300) }));
    sources.suggested_sources = { rows: m.rows.length };
  } catch (e) { sources.suggested_sources = { rows: 0, error: String(e && e.message || e).slice(0, 160) }; }

  const byTopic = groupQuestions(rows);
  const topics = [...byTopic.entries()].map(([topic, groups]) => ({
    topic,
    questions: groups.reduce((s, g) => s + g.count, 0),
    groups: groups.length,
    top: groups.slice(0, n).map(g => ({
      count: g.count, channels: g.channels, weakShare: g.channels.web ? Math.round((g.weak / g.channels.web) * 100) / 100 : null,
      example: g.example, variants: g.variants, lastSeen: g.lastSeen ? g.lastSeen.toISOString() : null,
      inBank: bankMatch(g, bank),
    })),
  })).sort((a, b) => b.questions - a.questions);

  return {
    generatedAt: new Date().toISOString(), days: d, perTopic: n, sources,
    note: "Faqat o'qish; AI chaqirilmaydi. Guruhlash so'zlar o'xshashligi bo'yicha (AI emas) - bir guruhdagi savollar bir xil ma'noda ekani kafolatlanmaydi. Shaxsiy raqamlar yashirilgan, ismlar yashirilmaydi: hisobot faqat master va yurist uchun. weakShare - web chatda korpus juda kam qonun topgan savollar ulushi. inBank - qa-korpusdagi eng yaqin savol (so'zlar bo'yicha).",
    topics, missingActs,
  };
}

/** CSV for Excel (UTF-8 with BOM): one row per question group. */
function toCsv(report) {
  const esc = v => `"${String(v == null ? '' : v).replace(/"/gu, '""')}"`;
  const head = ['soha', 'necha_marta', 'web', 'telegram', 'korpus_kuchsiz_ulushi', 'savol_namunasi', 'boshqa_yozilishlari', 'oxirgi_marta', 'qa_korpusda_bor_id'];
  const lines = [head.map(esc).join(',')];
  for (const t of report.topics) {
    for (const g of t.top) {
      lines.push([t.topic, g.count, g.channels.web || 0, g.channels.telegram || 0, g.weakShare == null ? '' : g.weakShare, g.example, g.variants.join(' | '), g.lastSeen || '', g.inBank ? g.inBank.id : ''].map(esc).join(','));
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { buildReport, toCsv, groupQuestions, normalizeQuestion, maskPersonal, stems, jaccard, bankMatch, MAX_ROWS };
