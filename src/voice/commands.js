'use strict';

/**
 * Voice commands, level 2 - V1 (2026-10-29, owner; design
 * docs/design/ovozli-buyruqlar-2.md, accepted): one catalogue, read with no
 * AI, for the app's chat and the Ishlar command bar (and, from V5, the bot).
 *
 *   open     go to a page of the app (3.1) - nothing is written
 *   matter   the matter commands of src/matters/commands.js (3.2), unchanged:
 *            their own confirmations and "as heard" checks stay
 *   context  the open answer in the chat (3.3, V4): copy it, its Word file,
 *            attach the chat to a matter, open the attached document's analysis
 *            (the analysis' own cost confirmation stays) - chat only
 *   blocked  payments, deletion, sending to others (3.4): never run by voice;
 *            the card only offers to open the page where it is done by hand
 *
 * Rules (design §2): nothing runs by speaking alone - `parse` returns a
 * command with a token, and only `run(token)` acts (one use, 10 minutes, that
 * account; in memory, one Node process). Anchored, short phrases only
 * (<= 300 chars), in both Latin alphabets (read in the old one) and Russian;
 * a legal question is not a command. In the chat only a spoken text is read
 * as a command (`voice: true`); a typed one stays a question (§9 answer 3).
 */

const matterCommands = require('../matters/commands');

const MAX_LEN = 300;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const pending = new Map(); // token -> { adminId, cmd, at }

const norm = s => require('../../public/js/uz-alphabet').toOld(String(s || ''))
  .toLocaleLowerCase('uz')
  .replace(/[ʻʼ‘’`´]/gu, "'")
  .replace(/[«»"“”„]/gu, '')
  .replace(/\s+/gu, ' ').trim()
  .replace(/[.!?]+$/u, '');

// "och", "oching", "ko'rsat" ... after a page's name (optional)
const OPEN = "(?:\\s+(?:sahifa(?:si|sini)?\\s+)?(?:och|oching|ochib\\s+ber|ko'rsat|ko'rsating|ga\\s+o't|o't))?";

/** 3.1: pages. route: the app's hash route; href: a page of the site. */
const PAGES = [
  { action: 'documents', route: '/hujjatlarim', label: { uz: 'Hujjatlarim', ru: 'Мои документы' },
    re: [new RegExp(`^(?:mening\\s+)?hujjatlarim(?:ni|ga)?${OPEN}$`, 'u'), /^(?:мои\s+документы|открой\s+мои\s+документы)$/u] },
  { action: 'matters', route: '/ishlar', label: { uz: 'Ishlarim', ru: 'Мои дела' },
    re: [new RegExp(`^(?:mening\\s+)?(?:barcha\\s+|ochiq\\s+)?ishlarim(?:ni|ga)?${OPEN}$`, 'u'), /^ishlar\s+ro'yxati$/u, /^(?:мои|все|открытые)\s+дела$/u, /^(?:покажи|открой)\s+(?:мои\s+)?дела$/u] },
  { action: 'analysis', route: '/tahlil', label: { uz: 'Hujjat tahlili', ru: 'Анализ документа' },
    re: [/^hujjat(?:ni)?\s+tahlil(?:i|ini)?(?:\s+(?:qil|qiling|qilish))?$/u, new RegExp(`^hujjat\\s+tahlili(?:ni|ga)?${OPEN}$`, 'u'), /^(?:анализ\s+документа|проанализировать\s+документ)$/u] },
  { action: 'draft_claim', route: '/tayyorlash?type=claim', label: { uz: 'Da’vo arizasi tayyorlash', ru: 'Подготовка иска' },
    re: [/^da'vo\s+ariza(?:si|sini)?\s+(?:tayyorla|tayyorlang|yoz|yozing|yozib\s+ber)$/u, /^(?:подготовь|составь)\s+иск(?:овое\s+заявление)?$/u] },
  { action: 'draft', route: '/tayyorlash', label: { uz: 'Hujjat tayyorlash', ru: 'Подготовка документа' },
    re: [/^(?:hujjat|ariza|shartnoma|ishonchnoma|tilxat|bayonnoma|buyruq\s+loyihasi)(?:ni)?\s+(?:tayyorla|tayyorlang|yoz|yozing|tuz|tuzing)$/u,
      new RegExp(`^hujjat\\s+tayyorlash(?:ni|ga)?${OPEN}$`, 'u'), /^(?:подготовь|составь)\s+(?:документ|договор|заявление|доверенность)$/u] },
  { action: 'tabular', route: '/jadval', label: { uz: 'Jadvalli tahlil', ru: 'Табличный анализ' },
    re: [new RegExp(`^jadvalli\\s+tahlil(?:ni|ga)?${OPEN}$`, 'u'), /^табличный\s+анализ$/u] },
  { action: 'playbook', route: '/playbook', label: { uz: 'Playbook', ru: 'Playbook' },
    re: [new RegExp(`^playbook(?:ni|ga)?${OPEN}$`, 'u'), /^shartnoma(?:ni)?\s+qoidalar(?:im)?\s+bo'yicha\s+tekshir(?:ing)?$/u, /^проверь\s+договор\s+по\s+правилам$/u] },
  { action: 'new_chat', route: '/', label: { uz: 'Yangi suhbat', ru: 'Новый чат' },
    re: [/^yangi\s+(?:suhbat|chat)(?:\s+(?:och|oching|boshla|boshlang))?$/u, /^(?:новый\s+(?:чат|разговор)|начни\s+новый\s+чат)$/u] },
  { action: 'last_chat', route: null, label: { uz: 'Oxirgi suhbat', ru: 'Последний чат' },
    re: [new RegExp(`^oxirgi\\s+(?:suhbat|chat)(?:ni|ga)?${OPEN}$`, 'u'), /^(?:последний\s+чат|открой\s+последний\s+чат)$/u] },
  { action: 'chats', route: '/suhbatlar', label: { uz: 'Suhbatlarim', ru: 'Мои чаты' },
    re: [new RegExp(`^(?:suhbatlarim|suhbatlar\\s+tarixi)(?:ni|ga)?${OPEN}$`, 'u'), /^(?:мои\s+чаты|история\s+чатов)$/u] },
  { action: 'recordings', route: '/yozuvlar', label: { uz: 'Ovozli yozuvlar', ru: 'Записи' },
    re: [new RegExp(`^(?:ovozli\\s+)?yozuvlarim(?:ni|ga)?${OPEN}$`, 'u'), /^мои\s+записи$/u] },
  { action: 'new_recording', route: '/yozuvlar/yangi', label: { uz: 'Yangi ovozli yozuv', ru: 'Новая запись' },
    re: [/^yangi\s+(?:ovozli\s+)?yozuv(?:\s+(?:och|boshla|boshlang))?$/u, /^новая\s+запись$/u] },
  { action: 'team', route: '/jamoa', label: { uz: 'Jamoa (Workspace)', ru: 'Команда (Workspace)' },
    re: [new RegExp(`^(?:jamoa|workspace)(?:ni|ga)?${OPEN}$`, 'u'), /^(?:команда|workspace|открой\s+workspace)$/u] },
  { action: 'attorneys', route: '/advokatlar', label: { uz: 'Advokatlar', ru: 'Адвокаты' },
    re: [new RegExp(`^advokatlar(?:\\s+ro'yxati)?(?:ni|ga)?${OPEN}$`, 'u'), /^(?:адвокаты|список\s+адвокатов)$/u] },
  { action: 'limit', route: '/hisob', label: { uz: 'Limit va hisob', ru: 'Лимит и аккаунт' },
    re: [/^(?:limitim|limit)(?:\s+(?:qancha|qoldi|qancha\s+qoldi))?$/u, /^qancha\s+(?:limit|savol)\s+qoldi$/u, new RegExp(`^(?:hisobim|akkauntim)(?:ni|ga)?${OPEN}$`, 'u'),
      /^(?:мой\s+лимит|сколько\s+осталось|мой\s+аккаунт)$/u] },
  { action: 'plans', href: '/tariflar.html', label: { uz: 'Tariflar', ru: 'Тарифы' },
    re: [new RegExp(`^tariflar(?:ni|ga)?${OPEN}$`, 'u'), /^тарифы$/u] },
  { action: 'adaptive', route: '/moslashish', label: { uz: 'Moslashish', ru: 'Адаптация' },
    re: [new RegExp(`^(?:moslashish|sozlamalar(?:im)?)(?:ni|ga)?${OPEN}$`, 'u'), /^(?:адаптация|настройки)$/u] },
];

/** 3.3 (V4): actions on the open chat - only in the chat, only spoken. */
const CONTEXT = [
  { action: 'copy_answer', label: { uz: 'Javobni nusxalash', ru: 'Скопировать ответ' },
    re: [/^(?:shu\s+)?javob(?:ni)?\s+(?:nusxala|nusxalang|nusxa\s+ol|nusxa\s+oling|kopiya\s+qil)$/u, /^(?:скопируй|копируй)\s+(?:этот\s+)?ответ$/u] },
  { action: 'word_answer', label: { uz: 'Javobni Word’ga yuklash', ru: 'Скачать ответ в Word' },
    re: [/^(?:shu\s+)?(?:javob(?:ni)?\s+)?word(?:ga|'ga)?\s+(?:yukla|yuklang|yuklab\s+ol|yuklab\s+ber|saqla|saqlang)$/u, /^(?:shu\s+)?javob(?:ni)?\s+(?:yukla|yuklang|yuklab\s+ol|yuklab\s+ber)$/u,
      /^(?:скачай|сохрани)\s+(?:этот\s+)?(?:ответ\s+)?(?:в\s+)?word$/u, /^скачай\s+(?:этот\s+)?ответ$/u] },
  { action: 'attach_matter', label: { uz: 'Suhbatni ishga biriktirish', ru: 'Прикрепить чат к делу' }, matter: true,
    re: [/^(?:shu\s+)?suhbat(?:ni)?\s+([^:]{2,120}?)\s+ishiga\s+(?:biriktir|biriktiring|qo'sh|qo'shing|saqla|saqlang)$/u,
      /^(?:shu\s+)?suhbat(?:ni)?\s+ish(?:ga|lar(?:im)?ga)\s+(?:biriktir|biriktiring|qo'sh|qo'shing|saqla|saqlang)$/u,
      /^(?:прикрепи|добавь|сохрани)\s+(?:этот\s+)?чат\s+(?:к\s+делу|в\s+дело)(?:\s+(.{2,120}))?$/u] },
  { action: 'analyze_doc', label: { uz: 'Shu hujjatni tahlil qilish', ru: 'Анализ этого документа' },
    re: [/^shu\s+hujjat(?:ni)?\s+(?:tahlil\s+qil|tahlil\s+qiling|tahlil\s+qilib\s+ber|tekshir|tekshiring)$/u, /^(?:проанализируй|проверь)\s+этот\s+документ$/u] },
];

/** 3.4: never by voice - the card offers the page where it is done by hand. */
const BLOCKED = [
  { action: 'delete_account', route: '/hisob', re: [/^(?:akkaunt(?:im)?|hisob(?:im)?)(?:ni)?\s+(?:o'chir|o'chiring|o'chirib\s+tashla)$/u, /^удали(?:ть)?\s+(?:мой\s+)?аккаунт$/u] },
  { action: 'delete_documents', route: '/hujjatlarim', re: [/^(?:barcha\s+)?(?:hujjat|hujjatlar|hujjatlarim)(?:ni)?\s+(?:o'chir|o'chiring|o'chirib\s+tashla)$/u, /^удали(?:ть)?\s+(?:все\s+)?(?:мои\s+)?документы$/u] },
  { action: 'delete_chats', route: '/suhbatlar', re: [/^(?:barcha\s+)?(?:suhbat|suhbatlar|suhbatlarim)(?:ni)?\s+(?:o'chir|o'chiring|o'chirib\s+tashla)$/u, /^удали(?:ть)?\s+(?:все\s+)?(?:чаты|чат)$/u] },
  { action: 'pay', href: '/tariflar.html', re: [/^(?:tarif|obuna|gold|silver|platinum)(?:ni)?\s+(?:sotib\s+ol|oling|ol|to'la|to'lang|ula|ulang)$/u, /^(?:to'lov\s+qil|pul\s+to'la)$/u, /^(?:купи(?:ть)?|оплати(?:ть)?)\s+(?:тариф|подписку)$/u] },
  { action: 'send', route: '/', re: [/^(?:telegram(?:im)?|advokat|yurist)(?:ga)?\s+yubor(?:ing)?$/u, /^(?:отправь|перешли)\s+(?:в\s+telegram|адвокату|юристу)$/u] },
];

const lang = text => (/[Ѐ-ӿ]/u.test(String(text || '')) ? 'ru' : 'uz');
const TEXTS = {
  uz: { open: l => `Ochish: ${l}`, blocked: "Bu amal ovoz bilan bajarilmaydi — sahifani ochaymi?", gone: "Buyruq eskirgan — qaytadan ayting." },
  ru: { open: l => `Открыть: ${l}`, blocked: 'Это действие голосом не выполняется — открыть страницу?', gone: 'Команда устарела — скажите ещё раз.' },
};

/**
 * The command a text is, or null. place: 'chat' | 'matters' | 'telegram';
 * in the chat only a spoken text counts (voice: true).
 */
function parse(text, { place = 'chat', voice = false } = {}) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > MAX_LEN) return null;
  if (place === 'chat' && !voice) return null;
  const t = norm(raw), L = lang(raw);
  for (const p of PAGES) {
    if (p.re.some(re => re.test(t))) return { kind: 'open', action: p.action, route: p.route || null, href: p.href || null, label: TEXTS[L].open(p.label[L] || p.label.uz), lang: L };
  }
  if (place === 'chat') {
    for (const c of CONTEXT) {
      for (const re of c.re) {
        const m = re.exec(t);
        if (!m) continue;
        const matter = c.matter && m[1] ? require('../../public/js/uz-alphabet').toOld(m[1]).trim() : null;
        const label = c.label[L] || c.label.uz;
        return { kind: 'context', action: c.action, matter, label: matter ? `${label}: «${matter}»` : label, lang: L };
      }
    }
  }
  for (const b of BLOCKED) {
    if (b.re.some(re => re.test(t))) return { kind: 'blocked', action: b.action, route: b.route || null, href: b.href || null, label: TEXTS[L].blocked, lang: L };
  }
  const m = matterCommands.parseCommand(raw);
  if (m) return { kind: 'matter', action: m.action, args: m, label: matterLabel(m, L), lang: L };
  return null;
}

function matterLabel(m, L) {
  const ru = L === 'ru';
  switch (m.action) {
    case 'list': return ru ? 'Открыть: Мои дела' : 'Ochish: Ishlarim';
    case 'create': return m.title ? (ru ? `Новое дело: «${m.title}»` : `Yangi ish: «${m.title}»`) : (ru ? 'Новое дело' : 'Yangi ish');
    case 'note': return ru ? `Заметка${m.matter ? ` в дело «${m.matter}»` : ''}: «${m.text}»` : `Yozuv${m.matter ? ` «${m.matter}» ishiga` : ''}: «${m.text}»`;
    case 'show': return ru ? `Открыть дело «${m.matter}»` : `«${m.matter}» ishini ochish`;
    case 'close': return ru ? `Закрыть дело «${m.matter}»` : `«${m.matter}» ishini yopish`;
    case 'reopen': return ru ? `Снова открыть дело «${m.matter}»` : `«${m.matter}» ishini qayta ochish`;
    default: return m.action;
  }
}

function sweep(now = Date.now()) {
  for (const [k, v] of pending) if (now - v.at > TOKEN_TTL_MS) pending.delete(k);
}

/** A parsed command kept for this account until it is run (or 10 minutes pass). */
function issue(cmd, adminId, now = Date.now()) {
  sweep(now);
  const token = require('crypto').randomBytes(16).toString('base64url');
  pending.set(token, { adminId: Number(adminId), cmd, at: now });
  return token;
}

/**
 * Run a parsed command by its token. open: where to go; blocked: the page
 * only; matter: src/matters/commands.js as a spoken command (its writes are
 * shown as heard and wait for their own confirmation).
 */
async function run(token, { adminId, store = null, db = null, lastMatterId = null, context = null, now = Date.now() } = {}) {
  sweep(now);
  const p = pending.get(String(token || ''));
  if (!p || p.adminId !== Number(adminId)) return { ok: false, status: 410, error: 'gone', message: TEXTS.uz.gone };
  pending.delete(String(token));
  const { cmd } = p;
  if (cmd.kind === 'open' || cmd.kind === 'blocked') {
    let route = cmd.route;
    if (cmd.action === 'last_chat' && db) {
      const r = (await db.query('SELECT id FROM ai_chat_sessions WHERE admin_id = $1 ORDER BY updated_at DESC LIMIT 1', [adminId])).rows[0];
      route = r ? `/c/${r.id}` : '/suhbatlar';
    }
    return { ok: true, kind: cmd.kind, action: cmd.action, route: route || null, href: cmd.href || null };
  }
  if (cmd.kind === 'context') {
    // copy, Word and the analysis are done by the page (it holds the answer and the document)
    if (cmd.action !== 'attach_matter') return { ok: true, kind: 'context', action: cmd.action };
    const chatId = Number(context && context.chatId);
    if (!store || !Number.isInteger(chatId) || chatId <= 0) return { ok: true, kind: 'context', action: 'attach_matter', needsPick: true };
    if (!cmd.matter) return { ok: true, kind: 'context', action: 'attach_matter', needsPick: true };
    const all = (await store.list(adminId)).filter(m => m.status === 'open');
    const r = matterCommands.resolveMatter(cmd.matter, all);
    if (r.none || r.many) return { ok: true, kind: 'context', action: 'attach_matter', needsPick: true, many: (r.many || []).map(m => ({ id: m.id, title: m.title })) };
    const item = await store.addItem(r.matter.id, adminId, { kind: 'chat', ref: chatId, title: String((context && context.title) || '').slice(0, 240) || undefined });
    if (!item) return { ok: true, kind: 'context', action: 'attach_matter', needsPick: true };
    return { ok: true, kind: 'context', action: 'attach_matter', matterId: r.matter.id, matterTitle: r.matter.title };
  }
  if (cmd.kind === 'matter') {
    if (!store) return { ok: false, status: 503, error: 'matters_unavailable' };
    const out = await matterCommands.runCommand(cmd.args, { adminId, store, lang: cmd.lang, lastId: lastMatterId, voice: true });
    return { ok: true, kind: 'matter', action: cmd.action, ...out };
  }
  return { ok: false, status: 400, error: 'unknown' };
}

module.exports = { PAGES, CONTEXT, BLOCKED, MAX_LEN, TOKEN_TTL_MS, parse, issue, run, norm, _pending: pending };
