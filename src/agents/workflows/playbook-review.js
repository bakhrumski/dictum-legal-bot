'use strict';

/**
 * Playbook review (2026-10-22, the third workflow on the harness; Legora's
 * "review against your playbook"): a contract is checked against a firm's
 * own rules - what it accepts and what it asks for - not against the law.
 *
 *   1. validate  no AI   a contract text and 1-20 rules; missing input halts
 *   2. excerpt   no AI   the clauses matching the rules' words, their
 *                         definitions and referred clauses (selectExcerpt,
 *                         <= 20 000 chars); a long contract says it was read
 *                         in parts
 *   3. review    AI      one call: per rule mos / farq / yoq / noaniq, the
 *                         clause's own words, a short note, and for farq / yoq
 *                         a proposed wording built from the rule's preferred
 *                         wording
 *   4. verify    no AI   a quote must be in the contract word for word (page
 *                         from "[Sahifa n]"); "mos" with no quote found is
 *                         turned into "noaniq" - meeting a rule is never
 *                         claimed without the contract's own words
 *
 * The result is a comparison with the firm's rules, not a legal opinion; the
 * page says so. The built-in playbooks are negotiating preferences of one
 * side, written as such, never statements of what the law requires.
 *
 * deps: callAI(messages, opts) -> { text }.
 */

const { parseJson } = require('../harness');
const { selectExcerpt } = require('../../rag/document-job');
const { findQuote, pageAt } = require('./tabular-review');

const LIMITS = Object.freeze({ rules: 20, docChars: 120000, excerptChars: 20000 });
const SEVERITIES = Object.freeze(['high', 'medium', 'low']);
const STATUSES = Object.freeze(['mos', 'farq', 'yoq', 'noaniq']);

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const rule = (title, requirement, severity, preferred = '') => ({ title, requirement, severity, preferred });

// one side's negotiating preferences - not what the law requires
const BUILTIN = Object.freeze({
  supply_buyer: {
    name: 'Yetkazib berish shartnomasi — xaridor tomoni',
    description: 'Xaridor sifatida imzolashdan oldin tekshiriladigan afzalliklar.',
    rules: [
      rule("Narx bir tomonlama o‘zgarmaydi", "Narx faqat ikki tomonning yozma kelishuvi bilan o‘zgartiriladi; yetkazib beruvchi uni bir tomonlama o‘zgartira olmaydi.", 'high', "Shartnoma narxi faqat tomonlarning yozma qo‘shimcha kelishuvi bilan o‘zgartiriladi."),
      rule('Yetkazib berish muddati aniq', "Yetkazib berish muddati aniq sana yoki kunlar soni bilan ko‘rsatilgan.", 'medium', "Tovar shartnoma imzolangan kundan boshlab [__] kalendar kun ichida yetkazib beriladi."),
      rule('Kechiktirish uchun penya', "Yetkazib berish kechiktirilganda yetkazib beruvchi penya to‘laydi.", 'high', "Yetkazib berish muddati buzilganda yetkazib beruvchi kechiktirilgan har bir kun uchun [__] miqdorida penya to‘laydi."),
      rule('Sifat va kafolat muddati', "Tovar sifatiga talablar va kafolat muddati ko‘rsatilgan.", 'medium', "Tovarning kafolat muddati qabul qilingan kundan boshlab [__] oy."),
      rule('Qabul qilish va nuqson bo‘yicha da‘vo tartibi', "Tovarni qabul qilish tartibi va nuqson aniqlanganda da’vo bildirish muddati yozilgan.", 'medium', "Xaridor nuqson aniqlangan kundan boshlab [__] ish kuni ichida yozma da’vo bildiradi; yetkazib beruvchi uni [__] kunda bartaraf etadi."),
      rule('Yetkazib beruvchi javobgarligi past cheklanmagan', "Yetkazib beruvchining javobgarligi shartnoma narxidan past summa bilan cheklanmagan.", 'high', "Yetkazib beruvchining javobgarligi shartnoma narxi bilan cheklanmaydi."),
      rule('Bekor qilish shartlari teng', "Shartnomani bir tomonlama bekor qilish shartlari ikki tomon uchun bir xil.", 'medium', "Har bir tomon boshqa tomonni [__] kun oldin yozma ogohlantirib, shartnomani bir tomonlama bekor qilishi mumkin."),
      rule('Nizolar xaridor hududida', "Nizolar xaridor joylashgan hududdagi sudda ko‘riladi.", 'low', "Nizolar xaridor joylashgan joydagi sudda ko‘rib chiqiladi."),
    ],
  },
  lease_tenant: {
    name: 'Ijara shartnomasi — ijarachi tomoni',
    description: 'Ijarachi sifatida imzolashdan oldin tekshiriladigan afzalliklar.',
    rules: [
      rule("Ijara haqi bir tomonlama o‘zgarmaydi", "Ijara haqi faqat tomonlarning yozma kelishuvi bilan o‘zgartiriladi.", 'high', "Ijara haqi faqat tomonlarning yozma kelishuvi bilan, kamida [__] oyda bir marta o‘zgartirilishi mumkin."),
      rule('Muddat va uzaytirish', "Ijara muddati va uni uzaytirish tartibi ko‘rsatilgan.", 'medium', "Ijarachi muddat tugashidan [__] kun oldin xabar berib, shartnomani shu shartlarda uzaytirishga haqli."),
      rule("Garov puli qaytariladi", "Garov (depozit) puli qaytarish tartibi va muddati yozilgan.", 'high', "Garov puli shartnoma tugaganidan keyin [__] kun ichida ijarachiga qaytariladi."),
      rule('Kapital ta’mir ijaraga beruvchida', "Kapital ta’mir ijaraga beruvchi zimmasida.", 'medium', "Kapital ta’mir ijaraga beruvchi hisobidan amalga oshiriladi."),
      rule('Bekor qilishdan oldin ogohlantirish', "Ijaraga beruvchi shartnomani bekor qilishdan oldin oqilona muddat oldin yozma ogohlantiradi.", 'high', "Ijaraga beruvchi shartnomani muddatidan oldin bekor qilmoqchi bo‘lsa, ijarachini kamida [__] kun oldin yozma ogohlantiradi."),
      rule('Mulkka kirish oldindan kelishiladi', "Ijaraga beruvchi mulkni ko‘zdan kechirish uchun oldindan ogohlantiradi.", 'low', "Ijaraga beruvchi mulkni ko‘zdan kechirish uchun ijarachini kamida [__] soat oldin ogohlantiradi."),
    ],
  },
  employment_employer: {
    name: 'Mehnat shartnomasi — ish beruvchi tomoni',
    description: "Ish beruvchi sifatida shartnomada bo‘lishi kerak bo‘lgan bandlar.",
    rules: [
      rule('Lavozim va vazifalar', "Lavozim va asosiy mehnat vazifalari aniq yozilgan.", 'high', "Xodim [lavozim] lavozimida ishlaydi; asosiy vazifalari lavozim yo‘riqnomasida belgilanadi."),
      rule("Ish haqi va to‘lash muddati", "Ish haqi miqdori va to‘lash muddatlari ko‘rsatilgan.", 'high', "Xodimga oyiga [__] so‘m ish haqi har oyning [__]-sanasigacha to‘lanadi."),
      rule('Ish vaqti rejimi', "Ish vaqti va dam olish rejimi yozilgan.", 'medium', "Ish vaqti haftasiga [__] soat, [kunlar] [soatlar]."),
      rule('Sinov muddati aniq', "Sinov muddati bo‘lsa, uning davomiyligi aniq ko‘rsatilgan.", 'low', "Xodimga [__] oy sinov muddati belgilanadi."),
      rule('Maxfiylik', "Xodim tijorat sirini oshkor qilmaslik majburiyatini oladi.", 'medium', "Xodim mehnat faoliyati davomida va undan keyin [__] yil davomida tijorat sirini oshkor qilmaydi."),
    ],
  },
  nda: {
    name: 'Maxfiylik kelishuvi (NDA)',
    description: "Ma’lumot oshkor qiluvchi tomon uchun asosiy afzalliklar.",
    rules: [
      rule("Maxfiy ma’lumot ta’rifi", "Maxfiy ma’lumot nima ekani aniq ta’riflangan.", 'high', "Maxfiy ma’lumot — tomon tomonidan og‘zaki, yozma yoki elektron shaklda berilgan va maxfiy deb belgilangan har qanday ma’lumot."),
      rule('Istisnolar', "Ochiq yoki oldindan ma’lum ma’lumotlar uchun istisnolar yozilgan.", 'medium', "Ommaga ochiq yoki oluvchi tomonga oldindan qonuniy ma’lum bo‘lgan ma’lumot maxfiy hisoblanmaydi."),
      rule('Amal qilish muddati', "Maxfiylik majburiyati muddati, shu jumladan kelishuv tugaganidan keyingi muddat ko‘rsatilgan.", 'high', "Maxfiylik majburiyati kelishuv tugaganidan keyin [__] yil davomida amal qiladi."),
      rule("Qaytarish yoki yo‘q qilish", "Kelishuv tugaganda ma’lumotni qaytarish yoki yo‘q qilish tartibi yozilgan.", 'medium', "Kelishuv tugaganda oluvchi tomon barcha maxfiy ma’lumotni [__] kun ichida qaytaradi yoki yo‘q qiladi."),
      rule('Buzilganda javobgarlik', "Majburiyat buzilganda javobgarlik belgilangan.", 'high', "Maxfiylik buzilganda aybdor tomon yetkazilgan zararni to‘liq qoplaydi."),
    ],
  },
});

function normRules(list) {
  // ids are given after the empty rules are dropped, so they run r1, r2, ... without gaps
  return (Array.isArray(list) ? list : []).map(r => ({
    title: clean(r && r.title, 160),
    requirement: clean(r && r.requirement, 600),
    severity: SEVERITIES.includes(r && r.severity) ? r.severity : 'medium',
    preferred: clean(r && r.preferred, 800),
  })).filter(r => r.title.length >= 3 && r.requirement.length >= 10).slice(0, LIMITS.rules).map((r, i) => ({ id: `r${i + 1}`, ...r }));
}

function readInput(input = {}) {
  const text = String(input.text || '').slice(0, LIMITS.docChars);
  const rules = normRules(input.rules);
  const missing = [];
  if (text.replace(/\s+/gu, '').length < 200) missing.push({ field: 'text', question: 'Shartnoma matnini yuklang (PDF yoki DOCX).' });
  if (!rules.length) missing.push({ field: 'rules', question: "Playbook tanlang yoki kamida bitta qoida yozing (nomi va talab)." });
  return { text, name: clean(input.name, 160) || 'Shartnoma', rules, missing };
}

function createPlaybookReviewWorkflow() {
  return {
    id: 'playbook_review',
    steps: [
      {
        id: 'validate', label: 'Shartnoma va qoidalarni tekshirish',
        run: (state) => { const r = readInput(state.input); return r.missing.length ? { ...r, halt: 'needs_input' } : r; },
        note: (o) => `${o.rules.length} ta qoida`,
      },
      {
        id: 'excerpt', label: 'Qoidalarga mos bandlarni tanlash',
        run: (state) => {
          const { text, rules } = state.steps.validate;
          const x = selectExcerpt(text, rules.map(r => `${r.title}. ${r.requirement}`).join(' '), LIMITS.excerptChars);
          return { text: x.text, excerpt: !!x.excerpt, insufficient: !!x.insufficient };
        },
        note: (o) => (o.excerpt ? "Uzun shartnoma: mos qismlar tanlandi" : "Shartnoma to'liq o'qiladi"),
      },
      {
        id: 'review', label: 'Qoidalar bilan solishtirish (AI)',
        run: async (state, deps) => {
          const { rules, name } = state.steps.validate;
          const ex = state.steps.excerpt;
          const list = rules.map(r => `${r.id} [${r.severity}] ${r.title}: ${r.requirement}${r.preferred ? `\n   Afzal matn: ${r.preferred}` : ''}`).join('\n');
          const r = await deps.callAI([
            { role: 'system', text: "Siz shartnomani firmaning o'z qoidalari (PLAYBOOK) bilan solishtiruvchi yuristsiz. Qonun haqida fikr bildirmang - faqat har bir qoida shartnomada bajarilganmi, solishtiring. Har qoida uchun: status - 'mos' (talab bajarilgan), 'farq' (tegishli band bor, lekin talabdan farq qiladi), 'yoq' (tegishli band yo'q), 'noaniq' (aniqlab bo'lmadi); quote - tegishli bandning SO'ZMA-SO'Z matni (300 belgigacha, band yo'q bo'lsa ''); note - bir jumlali izoh; suggestion - 'farq' yoki 'yoq' bo'lsa afzal matnga asoslangan taklif, aks holda ''. Faqat JSON: {\"results\":[{\"id\":\"r1\",\"status\":\"...\",\"quote\":\"...\",\"note\":\"...\",\"suggestion\":\"...\"}]}" },
            { role: 'user', text: `PLAYBOOK:\n${list}\n\nSHARTNOMA (${name})${ex.excerpt ? ' — qoidalarga mos qismlar' : ''}:\n${ex.text}` },
          ], { temperature: 0, maxTokens: 3000, endpoint: '/api/agent/playbook-review' });
          const parsed = parseJson(r && r.text);
          if (!parsed || !Array.isArray(parsed.results)) throw new Error('javob JSON emas');
          const byId = new Map(parsed.results.map(x => [String(x && x.id), x]));
          return { results: rules.map(rl => {
            const x = byId.get(rl.id) || {};
            return { id: rl.id, status: STATUSES.includes(x.status) ? x.status : 'noaniq', quote: clean(x.quote, 400), note: clean(x.note, 400), suggestion: clean(x.suggestion, 900) };
          }) };
        },
        note: (o) => `${o.results.length} ta qoida solishtirildi`,
      },
      {
        id: 'verify', label: 'Iqtiboslarni shartnoma matnida tekshirish',
        run: (state) => {
          const { text, rules } = state.steps.validate;
          const byRule = new Map(rules.map(r => [r.id, r]));
          const counts = { mos: 0, farq: 0, yoq: 0, noaniq: 0 };
          let downgraded = 0;
          const results = state.steps.review.results.map(x => {
            const at = x.quote ? findQuote(text, x.quote) : -1;
            const verified = at >= 0;
            let status = x.status, note = x.note;
            // meeting a rule is never claimed without the contract's own words
            if (status === 'mos' && !verified) { status = 'noaniq'; downgraded++; note = `${note ? `${note} ` : ''}(Iqtibos shartnomada topilmadi — qo'lda tekshiring.)`.trim(); }
            counts[status]++;
            return { ...x, status, note, verified, page: verified ? pageAt(text, at) : null, rule: byRule.get(x.id) };
          });
          return { results, counts, downgraded };
        },
        note: (o) => `mos ${o.counts.mos}, farq ${o.counts.farq}, yo'q ${o.counts.yoq}, noaniq ${o.counts.noaniq}`,
      },
    ],
  };
}

function builtinList() {
  return Object.entries(BUILTIN).map(([key, p]) => ({ key, name: p.name, description: p.description, rules: normRules(p.rules) }));
}

module.exports = { createPlaybookReviewWorkflow, readInput, normRules, builtinList, BUILTIN, LIMITS, STATUSES, SEVERITIES };
