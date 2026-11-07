'use strict';

/**
 * Da'vo arizasi as an agent workflow (2026-10-21, the first workflow on the
 * harness, src/agents/harness.js):
 *
 *   1. intake     no AI   the facts the claim needs; missing ones stop the run
 *                          with the questions to ask (nothing is charged)
 *   2. issues     AI      the case type and up to 3 legal search queries
 *   3. research   search  the platform's own lex.uz retrieval for each query
 *   4. basis      AI      which article supports which demand - each with a
 *                          quote that must be found word for word in the
 *                          retrieved text, else it is dropped and counted
 *   5. draft      AI      the website's drafting generator, told to cite only
 *                          the checked basis and to leave [gaps] for unknowns
 *   6. verify     no AI   articles the draft cites outside the checked basis,
 *                          figures not in the facts, missing parts of a claim;
 *                          warnings only - nothing is rewritten, and the
 *                          draft is never called legally verified
 *
 * deps: callAI (the main lane), callCheapAI (helpers), retrieve(query, topic)
 * -> { chunks }, generateDraftHtml({ docType, details, callAI }).
 */

const { parseJson } = require('../harness');

const CASE_TYPES = Object.freeze(['fuqarolik', 'iqtisodiy', 'mehnat', 'oilaviy', 'mamuriy', 'boshqa']);
const TOPIC_OF = Object.freeze({ mehnat: 'mehnat', oilaviy: 'oila', mamuriy: 'mamuriy', iqtisodiy: null, fuqarolik: null, boshqa: null });
const MAX_SOURCES = 8;

const clean = (v, max = 2000) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const norm = (s) => String(s || '').toLocaleLowerCase('uz').replace(/[ʻʼ‘’`´']/gu, "'").replace(/[«»"“”]/gu, '').replace(/\s+/gu, ' ').trim();

/** The facts a claim needs; returns { facts, missing: [{ field, question }] }. */
function readIntake(input = {}) {
  const facts = {
    court: clean(input.court, 200),
    plaintiff: { name: clean(input.plaintiff && input.plaintiff.name, 200), details: clean(input.plaintiff && input.plaintiff.details, 400) },
    defendant: { name: clean(input.defendant && input.defendant.name, 200), details: clean(input.defendant && input.defendant.details, 400) },
    circumstances: clean(input.circumstances, 6000),
    demands: clean(input.demands, 2000),
    amount: clean(input.amount, 60),
    evidence: clean(input.evidence, 2000),
    lang: input.lang === 'ru' ? 'ru' : 'uz',
  };
  const missing = [];
  if (!facts.plaintiff.name) missing.push({ field: 'plaintiff.name', question: "Da'vogar kim (F.I.O. yoki tashkilot nomi)?" });
  if (!facts.defendant.name) missing.push({ field: 'defendant.name', question: 'Javobgar kim (F.I.O. yoki tashkilot nomi)?' });
  if (facts.circumstances.length < 80) missing.push({ field: 'circumstances', question: "Nima bo'lgan: voqealar, sanalar va qaysi shartnoma yoki harakatga asoslanadi (kamida 80 belgi)?" });
  if (facts.demands.length < 10) missing.push({ field: 'demands', question: 'Suddan nimani so\'raysiz (undirish, majburiyatni bajarish, bekor qilish va h.k.)?' });
  return { facts, missing };
}

function factsText(f) {
  return [
    f.court && `Sud: ${f.court}`,
    `Da'vogar: ${f.plaintiff.name}${f.plaintiff.details ? ` (${f.plaintiff.details})` : ''}`,
    `Javobgar: ${f.defendant.name}${f.defendant.details ? ` (${f.defendant.details})` : ''}`,
    `Holatlar: ${f.circumstances}`,
    `Talablar: ${f.demands}`,
    f.amount && `Da'vo summasi: ${f.amount}`,
    f.evidence && `Dalillar: ${f.evidence}`,
  ].filter(Boolean).join('\n');
}

/** Article numbers a text cites ("123-modda", "статья 45", "45-moddasi"). */
function citedArticles(text) {
  const out = new Set();
  const s = String(text || '');
  for (const m of s.matchAll(/(\d{1,4})\s*[-–]?\s*modda/giu)) out.add(m[1]);
  for (const m of s.matchAll(/(?:стать[ьяеи]|ст\.)\s*(\d{1,4})/giu)) out.add(m[1]);
  return out;
}

/** Numbers of 4+ digits (amounts, years) in a text, spaces inside a number removed. */
function bigNumbers(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/\d[\d\s.,]{2,}\d/gu)) {
    const n = m[0].replace(/[\s.,]/gu, '');
    if (n.length >= 4) out.add(n.replace(/^0+/u, ''));
  }
  return out;
}

const REQUIRED_PARTS = Object.freeze([
  { code: 'court', rx: /\bsud|суд/iu, text: 'Sud nomi' },
  { code: 'plaintiff', rx: /da['’ʻ`]?vogar|истец/iu, text: "Da'vogar" },
  { code: 'defendant', rx: /javobgar|ответчик/iu, text: 'Javobgar' },
  { code: 'request', rx: /so['’ʻ`]?rayman|talab qilaman|undirish|прошу|взыскать/iu, text: "So'rov qismi (suddan nima so'ralayotgani)" },
  { code: 'attachments', rx: /ilova|приложени/iu, text: 'Ilovalar ro\'yxati' },
]);

function createClaimDraftWorkflow() {
  return {
    id: 'claim_draft',
    steps: [
      {
        id: 'intake', label: "Ma'lumotlarni tekshirish",
        run: (state) => {
          const r = readIntake(state.input);
          return r.missing.length ? { ...r, halt: 'needs_input' } : r;
        },
        note: (o) => (o.missing.length ? `${o.missing.length} ta ma'lumot yetishmaydi` : "Ma'lumotlar yetarli"),
      },
      {
        id: 'issues', label: 'Huquqiy masalalarni aniqlash',
        run: async (state, deps) => {
          const f = state.steps.intake.facts;
          let parsed = null;
          try {
            const r = await deps.callCheapAI([
              { role: 'system', text: "Siz O'zbekiston huquqi bo'yicha yordamchisiz. Faqat JSON qaytaring: {\"caseType\": \"fuqarolik|iqtisodiy|mehnat|oilaviy|mamuriy|boshqa\", \"queries\": [\"lex.uz qidiruvi uchun 1-3 ta qisqa so'rov: qaysi qonun va qaysi masala\"]}. Modda raqamini o'ylab topmang." },
              { role: 'user', text: factsText(f) },
            ], { temperature: 0, maxTokens: 400, endpoint: '/api/agent/claim-draft', lane: 'cheap' });
            parsed = parseJson(r && r.text);
          } catch (_) { parsed = null; }
          const caseType = parsed && CASE_TYPES.includes(parsed.caseType) ? parsed.caseType : 'boshqa';
          const queries = (parsed && Array.isArray(parsed.queries) ? parsed.queries : []).map(q => clean(q, 200)).filter(q => q.length >= 6).slice(0, 3);
          if (!queries.length) queries.push(clean(`${f.demands} ${f.circumstances}`, 300));
          return { caseType, queries, fallback: !parsed };
        },
        note: (o) => `${o.caseType}; ${o.queries.length} ta qidiruv`,
      },
      {
        id: 'research', label: 'Qonunchilikni qidirish (lex.uz)',
        run: async (state, deps) => {
          const { caseType, queries } = state.steps.issues;
          const seen = new Set();
          const sources = [];
          for (const q of queries) {
            let res;
            try { res = await deps.retrieve(q, TOPIC_OF[caseType] || null); } catch (_) { continue; }
            for (const c of (res && res.chunks) || []) {
              const article = clean(c.article_number_display || (Array.isArray(c.article_numbers) ? c.article_numbers[0] : ''), 20);
              const key = `${norm(c.law_name)}|${article}`;
              const text = clean(c.chunk_text, 1800);
              if (!c.law_name || !text || seen.has(key)) continue;
              seen.add(key);
              sources.push({ id: `S${sources.length + 1}`, act: clean(c.law_name, 200), article, url: c.source_url || null, text });
              if (sources.length >= MAX_SOURCES) break;
            }
            if (sources.length >= MAX_SOURCES) break;
          }
          return { sources };
        },
        note: (o) => `${o.sources.length} ta manba topildi`,
      },
      {
        id: 'basis', label: 'Huquqiy asosni tanlash va iqtiboslarni tekshirish',
        when: (state) => state.steps.research.sources.length > 0,
        run: async (state, deps) => {
          const f = state.steps.intake.facts;
          const { sources } = state.steps.research;
          const list = sources.map(s => `[${s.id}] ${s.act}${s.article ? `, ${s.article}-modda` : ''}\n${s.text}`).join('\n\n');
          const r = await deps.callAI([
            { role: 'system', text: "Siz O'zbekiston huquqi bo'yicha yuristsiz. Faqat berilgan MANBALARdan foydalaning. Har bir talab uchun uni qo'llab-quvvatlaydigan moddani tanlang va manba matnidan SO'ZMA-SO'Z iqtibos keltiring (o'zgartirmasdan, 300 belgigacha). Mos manba bo'lmasa, talabni ro'yxatga kiritmang. Faqat JSON: {\"basis\": [{\"demand\": \"...\", \"sourceId\": \"S1\", \"quote\": \"...\"}]}" },
            { role: 'user', text: `TALABLAR: ${f.demands}\nHOLATLAR: ${f.circumstances.slice(0, 2500)}\n\nMANBALAR:\n${list}` },
          ], { temperature: 0, maxTokens: 1600, endpoint: '/api/agent/claim-draft' });
          const parsed = parseJson(r && r.text);
          const items = parsed && Array.isArray(parsed.basis) ? parsed.basis : [];
          const byId = new Map(sources.map(s => [s.id, s]));
          const kept = [];
          let dropped = 0;
          for (const it of items.slice(0, 12)) {
            const src = byId.get(String(it.sourceId || '').trim());
            const quote = clean(it.quote, 400);
            // the quote must be the source's own words, else it is not used
            if (!src || quote.length < 15 || !norm(src.text).includes(norm(quote))) { dropped++; continue; }
            kept.push({ demand: clean(it.demand, 300), sourceId: src.id, act: src.act, article: src.article, url: src.url, quote });
          }
          return { basis: kept, dropped, parsed: !!parsed };
        },
        note: (o) => `${o.basis.length} ta asos tasdiqlandi${o.dropped ? `, ${o.dropped} tasi manbada topilmadi va olib tashlandi` : ''}`,
      },
      {
        id: 'draft', label: "Da'vo arizasini yozish",
        run: async (state, deps) => {
          const f = state.steps.intake.facts;
          const basis = (state.steps.basis && state.steps.basis.basis) || [];
          const basisText = basis.length
            ? basis.map((b, i) => `${i + 1}. ${b.act}${b.article ? `, ${b.article}-modda` : ''}: «${b.quote}» (talab: ${b.demand})`).join('\n')
            : "Tekshirilgan huquqiy asos topilmadi: moddalar o'rniga [Huquqiy asos — yurist bilan aniqlang] deb qoldiring.";
          const details = `${factsText(f)}\n\nHUQUQIY ASOS (FAQAT SHU MODDALARGA HAVOLA QILING, BOSHQA MODDA QO'SHMANG):\n${basisText}\n\n`
            + "Noma'lum ma'lumotlarni [qavs ichida] bo'sh joy sifatida qoldiring. Arizada sud nomi, da'vogar va javobgar rekvizitlari, holatlar, huquqiy asos, so'rov qismi, da'vo summasi (agar bo'lsa), davlat boji haqida [to'lov ma'lumoti] va ilovalar ro'yxati bo'lsin.";
          const r = await deps.generateDraftHtml({ docType: f.lang === 'ru' ? 'Исковое заявление' : "Da'vo arizasi", details, callAI: deps.callAI });
          if (!r || !r.html) throw new Error("loyiha bo'sh qaytdi");
          return { html: r.html, provider: r.provider || null };
        },
        note: () => 'Loyiha tayyor',
      },
      {
        id: 'verify', label: 'Loyihani tekshirish (mexanik)',
        run: (state) => {
          const f = state.steps.intake.facts;
          const text = String(state.steps.draft.html).replace(/<[^>]+>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/\s+/gu, ' ');
          const basis = (state.steps.basis && state.steps.basis.basis) || [];
          const allowed = new Set(basis.map(b => String(b.article).replace(/\D/gu, '')).filter(Boolean));
          const warnings = [];
          for (const a of citedArticles(text)) {
            if (!allowed.has(a)) warnings.push({ code: 'unchecked_article', text: `${a}-modda tekshirilgan asos ro'yxatida yo'q — lex.uz'da qo'lda tekshiring.` });
          }
          const known = bigNumbers(`${f.circumstances} ${f.demands} ${f.amount} ${f.evidence} ${f.plaintiff.details} ${f.defendant.details}`);
          for (const n of bigNumbers(text)) {
            if (!known.has(n) && !/^(19|20)\d{2}$/u.test(n)) warnings.push({ code: 'unknown_figure', text: `«${n}» raqami siz bergan ma'lumotlarda yo'q — tekshiring.` });
          }
          for (const p of REQUIRED_PARTS) if (!p.rx.test(text)) warnings.push({ code: `missing_${p.code}`, text: `${p.text} topilmadi.` });
          if (!basis.length) warnings.push({ code: 'no_basis', text: "Tekshirilgan huquqiy asos topilmadi — moddalarni yurist bilan aniqlang." });
          warnings.push({ code: 'manual', text: "Davlat boji, sudlovlilik va da'vo muddati avtomatik tekshirilmagan. Bu AI loyiha, yuridik xulosa emas." });
          return { warnings: warnings.slice(0, 20) };
        },
        note: (o) => `${o.warnings.length} ta ogohlantirish`,
      },
    ],
  };
}

module.exports = { createClaimDraftWorkflow, readIntake, citedArticles, bigNumbers, factsText, CASE_TYPES };
