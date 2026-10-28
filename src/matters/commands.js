'use strict';

/**
 * Matters by voice or by a typed command (2026-10-28, owner: "akkauntga
 * bog'langan telegram orqali ovozli komanda berish yoki akkaunt ichida
 * ovozli komanda berish orqali ishlarni boshqarish"). The same commands in
 * the Telegram bot (typed, or a voice note after STT) and in the app (the
 * 🎙 button on the Ishlar pages, or typed):
 *
 *   list    "ishlarim", "ishlarimni ko'rsat", "мои дела"
 *   create  "yangi ish och: <nom>", "ish och <nom>", "новое дело: <название>"
 *   note    "<ish> ishiga yozuv: <matn>", "yozuv qo'sh: <matn>" (the matter
 *           last worked in), "заметка в дело <дело>: <текст>"
 *   show    "<ish> ishini ko'rsat", "<ish> ishi holati", "покажи дело <дело>"
 *   close   "<ish> ishini yop", "закрой дело <дело>"            (confirmed)
 *   reopen  "<ish> ishini qayta och", "открой снова дело <дело>" (confirmed)
 *
 * The phrases are matched with no AI, anchored and short (<= 300 chars), so
 * a legal question ("pudratchi ishini bajarmadi") is not taken for one; a
 * matter is named by its words (any word start of 4 letters counts), and a
 * name that matches no matter, or two equally, is asked about - never
 * guessed. Closing or reopening asks for a confirmation first (a mis-heard
 * name must not close the wrong matter); a confirmation is a token valid for
 * 10 minutes, for that account only, used once (one Node process: kept in
 * memory). Everything runs through the matter store as that account, so its
 * rules (ownership, Workspace roles, limits) hold. No AI, no tariff unit.
 *
 * Spoken commands that write (2026-10-28, owner: "Pudratchi" was heard as
 * "Qudratxo'ja" and the matter was opened under that name): with `voice`,
 * "create" and "note" are shown as heard and wait for a confirmation too,
 * with the glossary's suggestion (src/voice/glossary.js) as a second choice
 * (`confirmCommand(token, { alt: true })`); a typed correction replaces the
 * heard name or note (`correctPending`). The app's 🎙 never runs a command by
 * itself: the text lands in the box to be checked.
 */

const MAX_LEN = 300;
const CONFIRM_TTL_MS = 10 * 60 * 1000;
const pending = new Map(); // token -> { adminId, action, matterId, title, text?, alt?, at }

const norm = s => String(s || '').toLocaleLowerCase('uz')
  .replace(/[ʻʼ‘’`´]/gu, "'")
  .replace(/[«»"“”„]/gu, '')
  .replace(/\s+/gu, ' ').trim();
const tidy = s => String(s || '').replace(/\s+/gu, ' ').replace(/^[\s:—–-]+|[\s.!?]+$/gu, '').trim();

// "X ishini" / "X ishiga" / "X ishi": the matter's name is X
const NAME = "([^:]{2,120}?)";
const PATTERNS = [
  { action: 'list', re: /^(?:mening\s+)?(?:barcha\s+|ochiq\s+)?ishlar(?:im)?(?:ni)?(?:\s+(?:ro'yxati|ro'yxatini|ko'rsat|ko'rsating|qani|qanday))?$|^ishlar\s+ro'yxati$|^(?:мои|все|открытые)\s+дела$|^список\s+дел$|^покажи\s+(?:мои\s+)?дела$/u },
  { action: 'create', re: /^(?:yangi\s+ish(?:ni)?\s+(?:och|oching|ochish|yarat|yarating|boshla)|ish\s+(?:och|oching|yarat|yarating))\s*[:,—–-]?\s*(.{2,160})$/u, map: m => ({ title: m[1] }) },
  // the name not said yet (2026-10-28, owner: "Yangi ish och." by voice): it is asked for
  { action: 'create', re: /^(?:yangi\s+ish(?:ni)?\s+(?:och|oching|ochish|yarat|yarating|boshla)|yangi\s+ish|новое\s+дело|создай\s+дело|заведи\s+дело)$/u, map: () => ({ title: null }) },
  { action: 'create', re: /^(?:новое\s+дело|создай\s+дело|открой\s+новое\s+дело|заведи\s+дело)\s*[:,—–-]?\s*(.{2,160})$/u, map: m => ({ title: m[1] }) },
  { action: 'note', re: new RegExp(`^${NAME}\\s+ishiga\\s+(?:yozuv|eslatma|izoh)(?:\\s+(?:qo'sh|qo'shing|yoz|yozing))?\\s*[:,—–-]\\s*(.{2,})$`, 'u'), map: m => ({ matter: m[1], text: m[2] }) },
  { action: 'note', re: /^(?:yozuv|eslatma)\s+(?:qo'sh|qo'shing|yoz|yozing)\s*[:,—–-]\s*(.{2,})$/u, map: m => ({ matter: null, text: m[1] }) },
  { action: 'note', re: new RegExp(`^(?:заметка|запиши)\\s+в\\s+дело\\s+${NAME}\\s*[:,—–-]\\s*(.{2,})$`, 'u'), map: m => ({ matter: m[1], text: m[2] }) },
  { action: 'note', re: /^(?:добавь\s+заметку|заметка)\s*[:,—–-]\s*(.{2,})$/u, map: m => ({ matter: null, text: m[1] }) },
  { action: 'reopen', re: new RegExp(`^${NAME}\\s+ishini\\s+qayta\\s+(?:och|oching|ochish)$`, 'u'), map: m => ({ matter: m[1] }) },
  { action: 'reopen', re: new RegExp(`^(?:открой\\s+снова|верни)\\s+дело\\s+${NAME}$`, 'u'), map: m => ({ matter: m[1] }) },
  { action: 'close', re: /^(?:bu\s+|shu\s+|oxirgi\s+)?ishni\s+(?:yop|yoping|tugat|tugating)$/u, map: () => ({ matter: null }) },
  { action: 'close', re: new RegExp(`^${NAME}\\s+ishini\\s+(?:yop|yoping|yopish|tugat|tugating)$`, 'u'), map: m => ({ matter: m[1] }) },
  { action: 'close', re: new RegExp(`^(?:закрой|заверши)\\s+дело\\s+${NAME}$`, 'u'), map: m => ({ matter: m[1] }) },
  { action: 'show', re: new RegExp(`^${NAME}\\s+ishi(?:ni)?\\s+(?:ko'rsat|ko'rsating|holati|nima\\s+bo'ldi|qanday)$`, 'u'), map: m => ({ matter: m[1] }) },
  { action: 'show', re: new RegExp(`^(?:покажи|открой)\\s+дело\\s+${NAME}$`, 'u'), map: m => ({ matter: m[1] }) },
];

/** { action, title?, matter?, text? } for a command, or null (then it is not one). */
function parseCommand(text = '') {
  const raw = String(text || '').trim();
  if (!raw || raw.length > MAX_LEN) return null;
  // the command's own words (a dictated text may end with a full stop)
  const t = norm(raw).replace(/[.!?]+$/u, '');
  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    const args = p.map ? p.map(m) : {};
    // the user's own letters for a title or a note (not lower-cased)
    if (args.title) args.title = tidy(sliceLike(raw, args.title));
    if (args.text) args.text = tidy(sliceLike(raw, args.text));
    if (args.matter) args.matter = tidy(args.matter);
    return { action: p.action, ...args };
  }
  return null;
}

/** The part of the original text that the normalised `part` came from (same length from its position). */
function sliceLike(raw, part) {
  const at = norm(raw).lastIndexOf(part);
  return at >= 0 ? raw.replace(/\s+/gu, ' ').trim().slice(at, at + part.length) : part;
}

const LAST_REF = /^(?:oxirgi|shu|bu|hozirgi)(?:\s+ish)?$|^(?:последнее|это|текущее)(?:\s+дело)?$/u;

/** The matter a name means among the account's: { matter } | { none } | { many: [..] }. */
function resolveMatter(name, matters = [], { lastId = null } = {}) {
  const list = matters.filter(m => m.access === 'write');
  if (!name || LAST_REF.test(norm(name))) {
    const last = (lastId && list.find(m => m.id === lastId)) || list.filter(m => m.status === 'open')[0];
    return last ? { matter: last } : { none: true };
  }
  const words = norm(name).split(' ').filter(w => w.length >= 2);
  const scored = list.map((m) => {
    const title = norm(m.title).split(' ');
    const hit = words.filter(w => title.some(tw => tw === w || (w.length >= 4 && tw.startsWith(w.slice(0, 4))) || (tw.length >= 4 && w.startsWith(tw.slice(0, 4))))).length;
    return { m, score: words.length ? hit / words.length : 0, open: m.status === 'open' };
  }).filter(x => x.score >= 0.5).sort((a, b) => (b.score - a.score) || (b.open - a.open));
  if (!scored.length) return { none: true };
  const top = scored.filter(x => x.score === scored[0].score && x.open === scored[0].open);
  return top.length === 1 ? { matter: top[0].m } : { many: top.slice(0, 5).map(x => x.m) };
}

function T(lang) {
  const ru = lang === 'ru';
  return {
    none: ru ? 'У вас пока нет дел. Создайте: «новое дело: название».' : "Hali ish yo'q. Ochish uchun: «yangi ish och: nomi».",
    list: ru ? 'Ваши открытые дела:' : 'Ochiq ishlaringiz:',
    created: ru ? '✅ Дело открыто: «{t}».' : '✅ Yangi ish ochildi: «{t}».',
    noted: ru ? '✅ Заметка добавлена в дело «{t}».' : '✅ «{t}» ishiga yozuv qo\'shildi.',
    notFound: ru ? 'Дело «{n}» не найдено. Ваши дела: {l}' : "«{n}» degan ish topilmadi. Ishlaringiz: {l}",
    many: ru ? 'Под «{n}» подходят несколько дел — скажите точнее: {l}' : "«{n}» bo'yicha bir nechta ish chiqdi — aniqroq ayting: {l}",
    noMatter: ru ? 'Нет открытого дела для заметки. Скажите, в какое дело: «заметка в дело <название>: текст».' : "Yozuv uchun ochiq ish yo'q. Qaysi ishga ekanini ayting: «<nomi> ishiga yozuv: matn».",
    confirmClose: ru ? 'Закрыть дело «{t}»? Подтвердите кнопкой.' : '«{t}» ishini yopaymi? Tugma bilan tasdiqlang.',
    confirmReopen: ru ? 'Открыть снова дело «{t}»? Подтвердите кнопкой.' : '«{t}» ishini qayta ochaymi? Tugma bilan tasdiqlang.',
    closed: ru ? '✅ Дело «{t}» закрыто.' : '✅ «{t}» ishi yopildi.',
    reopened: ru ? '✅ Дело «{t}» снова открыто.' : '✅ «{t}» ishi qayta ochildi.',
    expired: ru ? 'Подтверждение устарело. Повторите команду.' : 'Tasdiq muddati o\'tdi. Buyruqni qayta ayting.',
    heardCreate: ru ? '🎙 Я услышал: новое дело «{t}». Верно? Если нет — напишите правильное название.' : "🎙 Shunday eshitdim: yangi ish «{t}». To'g'rimi? Noto'g'ri bo'lsa, to'g'ri nomini yozib yuboring.",
    heardNote: ru ? '🎙 Я услышал заметку для дела «{t}»: «{n}». Верно? Если нет — напишите правильный текст.' : "🎙 «{t}» ishiga yozuv shunday eshitildi: «{n}». To'g'rimi? Noto'g'ri bo'lsa, to'g'ri matnni yozib yuboring.",
    maybe: ru ? 'Возможно, вы сказали: {l}.' : 'Balki shunday demoqchi edingiz: {l}.',
    items: ru ? 'элементов' : 'ta element',
    status: { open: ru ? 'открыто' : 'ochiq', closed: ru ? 'закрыто' : 'yopilgan' },
    notes: ru ? 'Последние заметки:' : 'Oxirgi yozuvlar:',
    askTitle: ru ? 'Как назвать дело? Скажите или напишите название (например: «Спор с подрядчиком»).' : "Ish nomi nima bo'lsin? Nomini ayting yoki yozing (masalan: «Pudratchi bilan nizo»).",
    noLink: ru ? 'Чтобы управлять делами отсюда, привяжите аккаунт JuristAI: напишите «привязать аккаунт».' : "Ishlarni shu yerdan boshqarish uchun JuristAI akkauntini ulang: «akkauntni ulash» deb yozing.",
  };
}
const fill = (s, v) => String(s).replace(/\{(\w)\}/gu, (m, k) => (v[k] != null ? v[k] : m));
const names = list => list.slice(0, 5).map(m => `«${m.title}»`).join(', ') || '—';

/**
 * Run a parsed command as `adminId` through the matter store.
 * Returns { reply, action, matterId?, matters?, confirm?: { token, action, title, alt? } }.
 * `voice`: a spoken create / note waits for a confirmation; `suggest(text)`
 * gives the glossary's [{ from, to }] for it (src/voice/glossary.js).
 */
async function runCommand(cmd, { adminId, store, lang = 'uz', lastId = null, now = Date.now(), voice = false, suggest = null } = {}) {
  const t = T(lang);
  const all = await store.list(adminId);
  switch (cmd.action) {
    case 'list': {
      const open = all.filter(m => m.status === 'open');
      if (!open.length) return { action: 'matters_list', reply: t.none, matters: [] };
      return { action: 'matters_list', matters: open.slice(0, 10).map(m => ({ id: m.id, title: m.title, items: m.items })),
        reply: [t.list, ...open.slice(0, 10).map((m, i) => `${i + 1}. ${m.title} — ${m.items || 0} ${t.items}`)].join('\n') };
    }
    case 'create': {
      if (!cmd.title) return { action: 'matter_needs_title', needsTitle: true, reply: t.askTitle };
      if (voice) return heard({ adminId, action: 'create', title: cmd.title, now, t, suggest });
      const m = await store.create(adminId, { title: cmd.title });
      return { action: 'matter_created', matterId: m.id, reply: fill(t.created, { t: m.title }) };
    }
    case 'note': {
      const r = resolveMatter(cmd.matter, all, { lastId });
      if (r.none) return { action: 'matter_not_found', reply: cmd.matter ? fill(t.notFound, { n: cmd.matter, l: names(all.filter(m => m.status === 'open')) }) : t.noMatter };
      if (r.many) return { action: 'matter_ambiguous', reply: fill(t.many, { n: cmd.matter, l: names(r.many) }), matters: r.many.map(m => ({ id: m.id, title: m.title })) };
      if (voice) return heard({ adminId, action: 'note', matterId: r.matter.id, title: r.matter.title, text: cmd.text, now, t, suggest });
      const item = await store.addItem(r.matter.id, adminId, { kind: 'note', note: cmd.text });
      if (!item) return { action: 'matter_not_found', reply: fill(t.notFound, { n: r.matter.title, l: names(all) }) };
      return { action: 'matter_noted', matterId: r.matter.id, reply: fill(t.noted, { t: r.matter.title }) };
    }
    case 'show': {
      const r = resolveMatter(cmd.matter, all, { lastId });
      if (r.none) return { action: 'matter_not_found', reply: fill(t.notFound, { n: cmd.matter, l: names(all) }) };
      if (r.many) return { action: 'matter_ambiguous', reply: fill(t.many, { n: cmd.matter, l: names(r.many) }), matters: r.many.map(m => ({ id: m.id, title: m.title })) };
      const m = await store.get(r.matter.id, adminId);
      const notes = m.items.filter(i => i.kind === 'note').slice(0, 3).map(i => `• ${String(i.note).slice(0, 200)}`);
      return { action: 'matter_shown', matterId: m.id, reply: [`📁 ${m.title} — ${t.status[m.status] || m.status}, ${m.items.length} ${t.items}`, m.summary ? m.summary.slice(0, 300) : '', notes.length ? `${t.notes}\n${notes.join('\n')}` : ''].filter(Boolean).join('\n') };
    }
    case 'close':
    case 'reopen': {
      const r = resolveMatter(cmd.matter, all.filter(m => m.status === (cmd.action === 'close' ? 'open' : 'closed')), { lastId });
      if (r.none) return { action: 'matter_not_found', reply: fill(t.notFound, { n: cmd.matter, l: names(all) }) };
      if (r.many) return { action: 'matter_ambiguous', reply: fill(t.many, { n: cmd.matter, l: names(r.many) }), matters: r.many.map(m => ({ id: m.id, title: m.title })) };
      sweep(now);
      const token = require('crypto').randomBytes(9).toString('base64url');
      pending.set(token, { adminId: Number(adminId), action: cmd.action, matterId: r.matter.id, title: r.matter.title, at: now });
      return { action: 'matter_confirm', matterId: r.matter.id, confirm: { token, action: cmd.action, title: r.matter.title },
        reply: fill(cmd.action === 'close' ? t.confirmClose : t.confirmReopen, { t: r.matter.title }) };
    }
    default:
      return null;
  }
}

/** A spoken create / note, held for the person to confirm (as heard, or with the glossary's suggestion). */
function heard({ adminId, action, matterId = null, title, text = null, now, t, suggest }) {
  sweep(now);
  const said = action === 'create' ? title : text;
  const sugg = typeof suggest === 'function' ? (suggest(said) || []) : [];
  let alt = null;
  for (const x of sugg) alt = (alt || said).split(x.from).join(x.to);
  const token = require('crypto').randomBytes(9).toString('base64url');
  pending.set(token, { adminId: Number(adminId), action, matterId, title, text, alt: alt && alt !== said ? alt : null, at: now });
  const reply = (action === 'create' ? fill(t.heardCreate, { t: title }) : fill(t.heardNote, { t: title, n: text }))
    + (alt && alt !== said ? `\n${fill(t.maybe, { l: sugg.map(x => `«${x.to}» (${x.from})`).join(', ') })}` : '');
  return { action: 'matter_confirm', matterId, confirm: { token, action, title, alt: alt && alt !== said ? alt : null }, reply };
}

/** Carry out a held create / note with this name or text. */
async function doWrite(p, value, { adminId, store, t }) {
  if (p.action === 'create') {
    const m = await store.create(adminId, { title: value });
    return { action: 'matter_created', matterId: m.id, reply: fill(t.created, { t: m.title }) };
  }
  const item = await store.addItem(p.matterId, adminId, { kind: 'note', note: value });
  if (!item) return { action: 'matter_not_found', reply: t.expired };
  return { action: 'matter_noted', matterId: p.matterId, reply: fill(t.noted, { t: p.title }) };
}

/** A typed correction of a held spoken create / note: the typed words are used as written. */
async function correctPending(token, value, { adminId, store, lang = 'uz', now = Date.now() } = {}) {
  const t = T(lang);
  sweep(now);
  const p = pending.get(String(token || ''));
  if (!p || p.adminId !== Number(adminId) || !['create', 'note'].includes(p.action)) return null;
  const v = tidy(value);
  if (v.length < 2 || v.length > (p.action === 'create' ? 160 : MAX_LEN)) return null;
  pending.delete(String(token));
  return doWrite(p, v, { adminId, store, t });
}

function sweep(now = Date.now()) {
  for (const [k, v] of pending) if (now - v.at > CONFIRM_TTL_MS) pending.delete(k);
}

/** A confirmation: the pending close / reopen (or spoken create / note) of this account, once; `alt` takes the glossary's suggestion. */
async function confirmCommand(token, { adminId, store, lang = 'uz', now = Date.now(), alt = false } = {}) {
  const t = T(lang);
  sweep(now);
  const p = pending.get(String(token || ''));
  if (!p || p.adminId !== Number(adminId)) return { action: 'matter_confirm_expired', reply: t.expired };
  pending.delete(String(token));
  if (p.action === 'create' || p.action === 'note') {
    const heardValue = p.action === 'create' ? p.title : p.text;
    return doWrite(p, alt && p.alt ? p.alt : heardValue, { adminId, store, t });
  }
  const m = await store.update(p.matterId, adminId, { status: p.action === 'close' ? 'closed' : 'open' });
  if (!m) return { action: 'matter_not_found', reply: t.expired };
  return { action: p.action === 'close' ? 'matter_closed' : 'matter_reopened', matterId: m.id, reply: fill(p.action === 'close' ? t.closed : t.reopened, { t: m.title }) };
}

/** Drop a confirmation (the person said no). */
function cancelConfirm(token, adminId) {
  const p = pending.get(String(token || ''));
  if (p && p.adminId === Number(adminId)) pending.delete(String(token));
}

/** Is this token a held spoken create / note of this account (a typed message may correct it)? */
function pendingWrite(token, adminId, now = Date.now()) {
  sweep(now);
  const p = pending.get(String(token || ''));
  return !!(p && p.adminId === Number(adminId) && (p.action === 'create' || p.action === 'note'));
}

module.exports = { parseCommand, resolveMatter, runCommand, confirmCommand, correctPending, pendingWrite, cancelConfirm, texts: T, MAX_LEN, CONFIRM_TTL_MS };
