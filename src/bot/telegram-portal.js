'use strict';

/**
 * Client portal P1c (2026-11-06, docs/design/mijoz-portali.md, accepted): the
 * client's matters IN the bot - the person need not open the site (the V5
 * lesson). No AI call, no tariff unit.
 *
 *   - "ishlarim" (the matter command) carries a button "📁 Yuristdagi
 *     ishlarim" when the linked account is a client somewhere (`mpl`);
 *   - `mpm_<matter>`: the matter's card - title, lawyer, stage, the deadlines
 *     marked visible, the notes written for the client, documents as buttons;
 *   - `mpd_<item>`: a shared document sent as a .txt file (its text only);
 *   - `/start mpi_<token>`: an invite opened in Telegram. The token is held
 *     for this Telegram user 15 minutes (never in a button); "Qo'shilish"
 *     (`mpj_y`) makes the account from the Telegram identity when there is
 *     none and joins (src/matters/portal.js accept);
 *   - the notifier: when the lawyer changes the stage, shows a note or a
 *     document, or marks a deadline visible, each linked client gets ONE
 *     message (events within `PORTAL_NOTIFY_DELAY_MS`, 20 s, are merged):
 *     the matter's title and what changed, with "Ochish" - never the note's
 *     or document's text, never anything not marked for the client.
 * Every read goes through src/matters/portal.js, so a matter or document the
 * person is not a client of is "not found". `PORTAL_TELEGRAM=off` stops the
 * notices (the bot pages stay).
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createPortal, STAGES } = require('../matters/portal');

const HOLD_MS = 15 * 60 * 1000;
const NOTIFY_DELAY_MS = () => Math.max(0, Number(process.env.PORTAL_NOTIFY_DELAY_MS) || 20000);
const notifyOff = () => String(process.env.PORTAL_TELEGRAM || '').toLowerCase() === 'off';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/u;
const MSG_MAX = 3800;

const STAGE = {
  uz: { received: 'Qabul qilindi', in_progress: 'Ishlanmoqda', waiting_client: 'Sizdan kutilmoqda', in_court: 'Sudda / organda', done: 'Yakunlandi' },
  ru: { received: 'Принято', in_progress: 'В работе', waiting_client: 'Ждём вас', in_court: 'В суде / органе', done: 'Завершено' },
};
function T(lang) {
  const R = lang === 'ru';
  return {
    R,
    listBtn: n => (R ? `📁 Мои дела у юриста (${n})` : `📁 Yuristdagi ishlarim (${n})`),
    listHead: R ? '📁 Дела, которыми с вами поделился юрист. Нажмите на дело:' : '📁 Yuristingiz siz bilan ulashgan ishlar. Ishni bosing:',
    none: R ? 'С вами пока не поделились делом. Когда юрист пришлёт ссылку, оно появится здесь.' : "Hozircha siz bilan ish ulashilmagan. Yuristingiz havola yuborsa, shu yerda ko'rinadi.",
    noLink: R ? 'Чтобы видеть свои дела здесь, привяжите аккаунт JuristAI: напишите «привязать аккаунт».' : "Ishlaringizni shu yerda ko'rish uchun JuristAI akkauntini ulang: «akkauntni ulash» deb yozing.",
    notFound: R ? 'Не найдено - возможно, юрист убрал это из дела.' : "Topilmadi - yurist uni ishdan olib tashlagan bo'lishi mumkin.",
    lawyer: R ? 'Юрист' : 'Yurist', stage: R ? 'Этап' : 'Bosqich', deadlines: R ? 'Сроки' : 'Muddatlar', notes: R ? 'От юриста' : 'Yuristdan',
    docs: R ? 'Документы - нажмите, чтобы получить файл:' : 'Hujjatlar - faylni olish uchun bosing:',
    closed: R ? 'Дело закрыто.' : 'Ish yopilgan.', site: R ? '📱 На сайте' : '📱 Saytda', back: R ? '⬅️ Все дела' : '⬅️ Barcha ishlar',
    cut: R ? '…(полностью - на сайте)' : "…(to'liq - saytda)",
    docCaption: R ? '📄 Документ из вашего дела. Это копия, которую показал юрист.' : "📄 Ishingizdagi hujjat. Bu yurist ko'rsatgan nusxa.",
    invite: (l, t) => (R ? `${l} приглашает вас в дело «${t}» как клиента.\n\nВы будете видеть здесь, в боте, то, что юрист вам покажет: этап, сроки, заметки и документы. Никакой оплаты.`
      : `${l} sizni «${t}» ishiga mijoz sifatida taklif qildi.\n\nYurist sizga ko'rsatgan narsalarni shu yerda, botda ko'rasiz: bosqich, muddatlar, izohlar va hujjatlar. Hech qanday to'lov yo'q.`),
    join: R ? '✅ Присоединиться' : "✅ Qo'shilish", cancel: R ? 'Отмена' : 'Bekor qilish',
    gone: R ? 'Ссылка устарела, уже использована или отменена. Попросите у юриста новую.' : "Havola eskirgan, ishlatilgan yoki bekor qilingan. Yuristingizdan yangisini so'rang.",
    again: R ? 'Время вышло. Откройте ссылку юриста ещё раз.' : 'Vaqt tugadi. Yurist havolasini qayta oching.',
    own: R ? 'Это ваше дело (или дело вашей команды) - присоединяться как клиент не нужно.' : "Bu ish sizniki yoki jamoangizniki - mijoz sifatida qo'shilish shart emas.",
    joined: R ? '✅ Вы присоединились к делу.' : "✅ Siz ishga qo'shildingiz.",
    open: R ? '📂 Открыть' : '📂 Ochish',
    // P2: messages between the client and the lawyer side
    write: R ? '✉️ Написать юристу' : '✉️ Yuristga yozish', reply: R ? '✉️ Ответить' : '✉️ Javob yozish',
    msgs: R ? 'Переписка' : 'Yozishma', me: R ? 'Вы' : 'Siz',
    fromLawyer: (l, t) => (R ? `💬 ${l} пишет по делу «${t}»:` : `💬 ${l} «${t}» ishi bo'yicha yozdi:`),
    fromClient: (c, t) => (R ? `💬 Клиент ${c} пишет по делу «${t}»:` : `💬 Mijoz ${c} «${t}» ishi bo'yicha yozdi:`),
    answerOnSite: R ? '📂 Ответить на сайте' : '📂 Saytda javob berish',
    askMsg: t => (R ? `✍️ Напишите сообщение юристу по делу «${t}» (текстом или голосом). «отмена» - выйти.`
      : `✍️ «${t}» ishi bo'yicha yuristga xabaringizni yozing (matn yoki ovoz bilan). «bekor» - chiqish.`),
    sent: R ? '✅ Отправлено юристу. Ответ придёт сюда.' : '✅ Yuristga yuborildi. Javob shu yerga keladi.',
    msgCancelled: R ? 'Хорошо, сообщение не отправлено.' : "Yaxshi, xabar yuborilmadi.",
    msgFailed: R ? 'Не удалось отправить. Попробуйте ещё раз позже.' : "Yuborib bo'lmadi. Birozdan keyin qayta urinib ko'ring.",
    // P3: document requests and the client's files
    reqs: R ? 'Юрист просит документы - отправьте файл прямо в этот чат:' : "Yurist so'ragan hujjatlar - faylni shu chatga yuboring:",
    until: d => (R ? `до ${d}` : `${d} gacha`),
    askFile: R ? '📎 Для какого запроса юриста этот файл?' : '📎 Bu fayl yuristning qaysi so‘roviga?',
    notRequest: R ? 'Это не для юриста' : 'Bu yurist uchun emas',
    fileSaved: (n, q) => (R ? `✅ Файл «${n}» отправлен юристу${q ? ` (запрос: ${q})` : ''}. Он хранится в зашифрованном виде.` : `✅ «${n}» fayli yuristga yuborildi${q ? ` (so‘rov: ${q})` : ''}. U shifrlangan holda saqlanadi.`),
    fileGone: R ? 'Время вышло - отправьте файл ещё раз.' : 'Vaqt tugadi - faylni qayta yuboring.',
    fileBig: R ? 'Файл больше 20 МБ - загрузите его на сайте.' : 'Fayl 20 MB dan katta - uni saytda yuklang.',
    fileFailed: R ? 'Не удалось получить файл. Попробуйте ещё раз позже.' : "Faylni olib bo'lmadi. Birozdan keyin qayta urinib ko'ring.",
    fromClientFile: (c, t, n, q) => (R ? `📎 Клиент ${c} загрузил файл в дело «${t}»: ${n}${q ? `\nЗапрос: ${q}` : ''}` : `📎 Mijoz ${c} «${t}» ishiga fayl yukladi: ${n}${q ? `\nSo‘rov: ${q}` : ''}`),
    openMatter: R ? '📂 Открыть дело' : '📂 Ishni ochish',
    news: R ? 'Новое в деле' : 'Ishingizda yangilik',
    ev: {
      stage: s => (R ? `этап: ${STAGE.ru[s] || s}` : `bosqich: ${STAGE.uz[s] || s}`),
      note: R ? 'новая заметка от юриста' : 'yuristdan yangi izoh',
      doc: t => (R ? `новый документ: ${t}` : `yangi hujjat: ${t}`),
      deadline: (t, d) => (R ? `срок: ${d} - ${t}` : `muddat: ${d} - ${t}`),
      request: (t, d) => (R ? `юрист просит документ: ${t}${d ? ` (до ${d})` : ''} - отправьте файл в этот чат` : `yurist hujjat so'radi: ${t}${d ? ` (${d} gacha)` : ''} - faylni shu chatga yuboring`),
      requestDone: t => (R ? `документ принят: ${t}` : `hujjat qabul qilindi: ${t}`),
    },
  };
}
const short = (s, n) => { const t = String(s || '').replace(/\s+/gu, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
function fmtDate(d) {
  const x = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(d) ? new Date(`${d}T00:00:00Z`) : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(x.getUTCDate())}.${p(x.getUTCMonth() + 1)}.${x.getUTCFullYear()}`;
}
const appBase = () => String(process.env.APP_URL || 'https://juristai.uz').replace(/\/+$/u, '');

/** The linked account of this chat / Telegram user, or null. */
async function accountOf(pool, chatId, telegramUserId) {
  return require('./telegram-roles').getLinkedAccount(pool, chatId, Number(chatId) > 0 ? telegramUserId : null);
}

async function clientCount(pool, adminId) {
  if (!adminId) return 0;
  try { return (await createPortal({ db: pool }).myMatters(adminId)).length; } catch (_) { return 0; }
}

/** "📁 Yuristdagi ishlarim": { text, keyboard }. */
async function listReply(pool, adminId, lang = 'uz') {
  const t = T(lang);
  const list = await createPortal({ db: pool }).myMatters(adminId);
  if (!list.length) return { text: t.none, keyboard: null };
  const st = STAGE[t.R ? 'ru' : 'uz'];
  return {
    text: `${t.listHead}\n\n${list.slice(0, 20).map((m, i) => `${i + 1}. ${short(m.title, 70)} - ${st[m.stage] || m.stage}`).join('\n')}`,
    keyboard: { inline_keyboard: list.slice(0, 20).map((m, i) => ([{ text: `${i + 1}. ${short(m.title, 50)}`, callback_data: `mpm_${m.id}` }])) },
  };
}

/** One matter's card: only what was marked for the client. */
async function matterCard(pool, adminId, matterId, lang = 'uz') {
  const t = T(lang);
  if (!ID.test(String(matterId || ''))) return { text: t.notFound, keyboard: null };
  let v;
  try { v = await createPortal({ db: pool }).clientView(matterId, adminId); } catch (e) { if (e && e.status === 404) return { text: t.notFound, keyboard: null }; throw e; }
  const st = STAGE[t.R ? 'ru' : 'uz'];
  const i = STAGES.indexOf(v.stage);
  const lines = [`📁 ${v.title}`, `${t.lawyer}: ${v.lawyerName}`, ''];
  if (v.status === 'closed') lines.push(t.closed, '');
  lines.push(`${t.stage}: ${STAGES.map((s, k) => (k < i ? `✓ ${st[s]}` : (k === i ? `▶ ${st[s]}` : null))).filter(Boolean).join(' → ')} (${fmtDate(v.stageAt)})`);
  if (v.deadlines.length) lines.push('', `${t.deadlines}:`, ...v.deadlines.map(d => `• ${fmtDate(d.dueOn)} - ${d.title}`));
  const notes = v.items.filter(x => x.kind === 'note');
  const docs = v.items.filter(x => x.kind === 'doc');
  if (notes.length) lines.push('', `${t.notes}:`, ...notes.map(n => `— ${n.text} (${fmtDate(n.createdAt)})`));
  // P2: the last messages of the conversation (reading them marks them read)
  try {
    const conv = await createPortal({ db: pool }).messages(matterId, adminId, 'client');
    const last = conv.messages.slice(-3);
    if (last.length) lines.push('', `${t.msgs}:`, ...last.map(x => `${x.mine ? t.me : x.author} (${fmtDate(x.at)}): ${short(x.text, 300)}`));
  } catch (e) { if (!(e && e.status === 404) && e.code !== '42P01') throw e; }
  // P3: what the lawyer asked for - the file is sent to this chat, the bot asks which request it is for
  if (v.status === 'open') {
    try {
      const open = (await createPortal({ db: pool }).files.clientList(matterId, adminId)).requests.filter(q => q.status === 'open');
      if (open.length) lines.push('', t.reqs, ...open.map(q => `• ${q.title}${q.dueOn ? ` (${t.until(fmtDate(q.dueOn))})` : ''}${q.files.length ? ` - ✓ ${q.files.length}` : ''}`));
    } catch (e) { if (!(e && e.status === 404) && e.code !== '42P01') throw e; }
  }
  if (docs.length) lines.push('', t.docs);
  let text = lines.join('\n');
  if (text.length > MSG_MAX) text = `${text.slice(0, MSG_MAX)}\n${t.cut}`;
  const rows = docs.slice(0, 10).map(d => ([{ text: `📄 ${short(d.title, 50)}`, callback_data: `mpd_${d.id}` }]));
  if (v.status === 'open') rows.push([{ text: t.write, callback_data: `mpw_${v.id}` }]);
  rows.push([{ text: t.back, callback_data: 'mpl' }, { text: t.site, url: `${appBase()}/app/#/portal/${v.id}` }]);
  return { text, keyboard: { inline_keyboard: rows } };
}

/** A shared document as a file: { buffer, filename, caption } or null. */
async function documentFile(pool, adminId, itemId, lang = 'uz') {
  if (!ID.test(String(itemId || ''))) return null;
  const row = (await pool.query('SELECT matter_id FROM matter_client_items WHERE id = $1', [itemId])).rows[0];
  if (!row) return null;
  let item;
  try { item = await createPortal({ db: pool }).clientItem(row.matter_id, itemId, adminId); } catch (e) { if (e && e.status === 404) return null; throw e; }
  const base = String(item.title || 'hujjat').replace(/\.(docx?|pdf|txt)$/iu, '').replace(/[\\/:*?"<>|]+/gu, ' ').trim().slice(0, 80) || 'hujjat';
  return { buffer: Buffer.from(String(item.text || '').replace(/=== PAGE (\d+) ===/gu, '— $1 —'), 'utf8'), filename: `${base}.txt`, caption: T(lang).docCaption };
}

// ---------- the invite opened in Telegram ----------
const held = new Map(); // telegram user id -> { token, at }
function hold(telegramUserId, token) { held.set(String(telegramUserId), { token, at: Date.now() }); }
function take(telegramUserId) {
  const k = String(telegramUserId); const h = held.get(k); held.delete(k);
  return h && Date.now() - h.at < HOLD_MS ? h.token : null;
}
const PREFIX = 'mpi_';

/** /start mpi_<token>: { text, keyboard } - what joining means, before the tap. */
async function inviteStart(pool, { from, token, lang = 'uz' }) {
  const t = T(lang);
  if (!TOKEN.test(String(token || ''))) return { text: t.gone, keyboard: null };
  const r = await pool.query(
    `SELECT i.id, m.title, a.full_name AS lawyer FROM matter_client_invites i JOIN matters m ON m.id = i.matter_id LEFT JOIN admins a ON a.id = m.owner_id
      WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND m.deleted_at IS NULL AND m.status = 'open'`,
    [crypto.createHash('sha256').update(String(token)).digest('hex')]);
  if (!r.rows[0]) return { text: t.gone, keyboard: null };
  hold(from.id, token);
  return { text: t.invite(r.rows[0].lawyer || t.lawyer, r.rows[0].title),
    keyboard: { inline_keyboard: [[{ text: t.join, callback_data: 'mpj_y' }, { text: t.cancel, callback_data: 'mpj_n' }]] } };
}

/** The Telegram user's account, made from the Telegram identity when there is none (no plan, role user). */
async function ensureAccount(pool, { from, chatId }) {
  const tgId = String(from.id);
  let acc = (await pool.query('SELECT id, telegram_chat_id FROM admins WHERE telegram_user_id::text = $1 ORDER BY id LIMIT 1', [tgId])).rows[0];
  if (acc) {
    if (!acc.telegram_chat_id && chatId != null) await pool.query('UPDATE admins SET telegram_chat_id = $2 WHERE id = $1 AND telegram_chat_id IS NULL', [acc.id, Number(chatId)]).catch(() => {});
    return acc.id;
  }
  const base = String(from.username || `tg${tgId}`).replace(/[^a-z0-9._-]/giu, '').toLowerCase() || `tg${tgId}`;
  let username = base;
  for (let i = 1; i <= 200; i++) {
    if (!(await pool.query('SELECT 1 FROM admins WHERE LOWER(username) = $1', [username])).rows[0]) break;
    username = `${base}${i}`;
  }
  const fullName = `${from.first_name || ''} ${from.last_name || ''}`.trim() || base;
  const pwd = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
  try {
    return (await pool.query(
      `INSERT INTO admins (username, password, full_name, role, telegram_username, telegram_chat_id, telegram_user_id)
       VALUES ($1, $2, $3, 'user', $4, $5, $6) RETURNING id`,
      [username, pwd, fullName, from.username || null, chatId != null ? Number(chatId) : null, BigInt(tgId)])).rows[0].id;
  } catch (e) {
    if (e.code !== '23505') throw e; // a parallel tap made it
    return (await pool.query('SELECT id FROM admins WHERE telegram_user_id::text = $1 ORDER BY id LIMIT 1', [tgId])).rows[0].id;
  }
}

/** The "Qo'shilish" tap: { text, card? } */
async function inviteJoin(pool, { from, chatId, lang = 'uz' }) {
  const t = T(lang);
  const token = take(from.id);
  if (!token) return { text: t.again };
  const adminId = await ensureAccount(pool, { from, chatId });
  try {
    const out = await createPortal({ db: pool }).accept(token, adminId);
    return { text: t.joined, card: await matterCard(pool, adminId, out.matterId, lang) };
  } catch (e) {
    if (e && e.code === 'own_matter') return { text: t.own };
    if (e && (e.code === 'invite_gone' || e.status === 404)) return { text: t.gone };
    if (e && e.status && e.message) return { text: e.message };
    throw e;
  }
}

// ---------- the notifier ----------
/**
 * notify(matterId, event): event { kind: 'stage', stage } | { kind: 'note' } |
 * { kind: 'doc', title } | { kind: 'deadline', title, dueOn }. Events of one
 * matter within the delay become one message per linked client.
 */
function createNotifier({ pool, getBot, delayMs = null }) {
  const pending = new Map(); // matterId -> { events, timer }
  async function flush(matterId) {
    const p = pending.get(matterId); pending.delete(matterId);
    if (!p || !p.events.length) return;
    const bot = typeof getBot === 'function' ? getBot() : null;
    if (!bot) return;
    const rows = (await pool.query(
      `SELECT m.title, COALESCE(a.telegram_chat_id, a.telegram_user_id) AS chat
         FROM matter_clients c JOIN matters m ON m.id = c.matter_id JOIN admins a ON a.id = c.client_id
        WHERE c.matter_id = $1 AND c.removed_at IS NULL AND m.deleted_at IS NULL
          AND COALESCE(a.telegram_chat_id, a.telegram_user_id) IS NOT NULL`, [matterId])).rows;
    const t = T('uz');
    // the last stage counts; the rest in order, each once
    const lastStage = [...p.events].reverse().find(e => e.kind === 'stage');
    const seen = new Set();
    const lines = [];
    for (const e of p.events) {
      const line = e.kind === 'stage' ? (e === lastStage ? t.ev.stage(e.stage) : null)
        : e.kind === 'note' ? t.ev.note
        : e.kind === 'doc' ? t.ev.doc(short(e.title, 80))
        : e.kind === 'deadline' ? t.ev.deadline(short(e.title, 80), fmtDate(e.dueOn))
        : e.kind === 'request' ? t.ev.request(short(e.title, 80), e.dueOn ? fmtDate(e.dueOn) : '')
        : e.kind === 'request_done' ? t.ev.requestDone(short(e.title, 80)) : null;
      if (line && !seen.has(line)) { seen.add(line); lines.push(`• ${line}`); }
    }
    if (!lines.length) return;
    for (const r of rows) {
      await bot.sendMessage(String(r.chat), `📁 ${t.news}: «${short(r.title, 80)}»\n\n${lines.join('\n')}`,
        { reply_markup: { inline_keyboard: [[{ text: t.open, callback_data: `mpm_${matterId}` }]] } })
        .catch(err => console.warn('[PORTAL-TG] notice not sent:', err.message));
    }
  }
  /** P2: a message goes at once (never batched), its text with it - the conversation is the feature. */
  async function deliverMessage(matterId, e) {
    const bot = typeof getBot === 'function' ? getBot() : null;
    if (!bot) return;
    const t = T('uz');
    const author = (await pool.query('SELECT full_name, telegram_username FROM admins WHERE id = $1', [e.authorId])).rows[0] || {};
    const name = author.full_name || (author.telegram_username ? '@' + author.telegram_username : (e.side === 'client' ? 'Mijoz' : 'Yurist'));
    const body = short(e.text, MSG_MAX - 200);
    if (e.side === 'lawyer') {
      const rows = (await pool.query(
        `SELECT COALESCE(a.telegram_chat_id, a.telegram_user_id) AS chat FROM matter_clients c JOIN admins a ON a.id = c.client_id
          WHERE c.matter_id = $1 AND c.removed_at IS NULL AND COALESCE(a.telegram_chat_id, a.telegram_user_id) IS NOT NULL`, [matterId])).rows;
      for (const r of rows) {
        await bot.sendMessage(String(r.chat), `${t.fromLawyer(name, short(e.title, 80))}\n\n${body}`,
          { reply_markup: { inline_keyboard: [[{ text: t.reply, callback_data: `mpw_${matterId}` }, { text: t.open, callback_data: `mpm_${matterId}` }]] } })
          .catch(err => console.warn('[PORTAL-TG] message not sent:', err.message));
      }
      return;
    }
    // a client's message: the matter's owner and whoever answered it on the lawyer side, in their own Telegram
    const rows = (await pool.query(
      `SELECT DISTINCT COALESCE(a.telegram_chat_id, a.telegram_user_id) AS chat FROM admins a
        WHERE (a.id = $2 OR a.id IN (SELECT author_id FROM matter_messages WHERE matter_id = $1 AND side = 'lawyer' AND author_id IS NOT NULL))
          AND COALESCE(a.telegram_chat_id, a.telegram_user_id) IS NOT NULL`, [matterId, e.ownerId])).rows;
    for (const r of rows) {
      await bot.sendMessage(String(r.chat), `${t.fromClient(name, short(e.title, 80))}\n\n${body}`,
        { reply_markup: { inline_keyboard: [[{ text: t.answerOnSite, url: `${appBase()}/app/#/ishlar/${matterId}` }]] } })
        .catch(err => console.warn('[PORTAL-TG] message not sent:', err.message));
    }
  }
  /** P3: a client's upload is told to the lawyer side at once: who, which matter, the file's name - never the file. */
  async function deliverUpload(matterId, e) {
    const bot = typeof getBot === 'function' ? getBot() : null;
    if (!bot) return;
    const t = T('uz');
    const author = (await pool.query('SELECT full_name, telegram_username FROM admins WHERE id = $1', [e.authorId])).rows[0] || {};
    const name = author.full_name || (author.telegram_username ? '@' + author.telegram_username : '');
    const rows = (await pool.query(
      `SELECT DISTINCT COALESCE(a.telegram_chat_id, a.telegram_user_id) AS chat FROM admins a
        WHERE a.id = ANY($1::int[]) AND COALESCE(a.telegram_chat_id, a.telegram_user_id) IS NOT NULL`,
      [[e.ownerId, e.requestBy].filter(x => Number.isInteger(x))])).rows;
    for (const r of rows) {
      await bot.sendMessage(String(r.chat), t.fromClientFile(name, short(e.title, 80), short(e.name, 80), e.request ? short(e.request, 80) : ''),
        { reply_markup: { inline_keyboard: [[{ text: t.openMatter, url: `${appBase()}/app/#/ishlar/${matterId}` }]] } })
        .catch(err => console.warn('[PORTAL-TG] upload notice not sent:', err.message));
    }
  }
  function notify(matterId, event) {
    if (notifyOff() || !ID.test(String(matterId || '')) || !event) return;
    if (event.kind === 'upload') { deliverUpload(matterId, event).catch(e => console.warn('[PORTAL-TG] upload notice failed:', e.message)); return; }
    if (event.kind === 'message') { deliverMessage(matterId, event).catch(e => console.warn('[PORTAL-TG] message failed:', e.message)); return; }
    const p = pending.get(matterId) || { events: [], timer: null };
    p.events.push(event);
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => { flush(matterId).catch(e => console.warn('[PORTAL-TG] flush failed:', e.message)); }, delayMs != null ? delayMs : NOTIFY_DELAY_MS());
    if (typeof p.timer.unref === 'function') p.timer.unref();
    pending.set(matterId, p);
  }
  return { notify, flush, pending };
}

// ---------- P2: the client writes in the bot ----------
const MSG_STATE = 'portal_message';
const MSG_TTL_MIN = 30;
const MSG_CANCEL = /^(?:bekor|bekor qil|отмена|стоп)[.!]?$/iu;
/** Is this conversation waiting for a message to a matter (and not too old)? */
function msgWaiting(conv, now = Date.now()) {
  if (!conv || conv.state !== MSG_STATE) return false;
  const since = Number(conv.context && conv.context.since);
  return Number.isFinite(since) && now - since <= MSG_TTL_MIN * 60e3 && ID.test(String(conv.context.matterId || ''));
}
/** The "write" button: the matter must be the client's own (404 otherwise); returns { ok, title } or { ok: false }. */
async function startMessage(pool, adminId, matterId) {
  if (!ID.test(String(matterId || ''))) return { ok: false };
  try { const v = await createPortal({ db: pool }).clientView(matterId, adminId); return v.status === 'open' ? { ok: true, title: v.title } : { ok: false }; }
  catch (e) { if (e && e.status === 404) return { ok: false }; throw e; }
}
/** The next message, sent as the client's (the notifier tells the lawyer side). */
async function sendFromBot(pool, adminId, matterId, text, { notify = null } = {}) {
  return createPortal({ db: pool, notify }).sendMessage(matterId, adminId, 'client', { text, source: 'telegram' });
}

// ---------- P3: a file sent to the bot by a client with an open document request ----------

const FILE_MAX = 20 * 1024 * 1024; // also the Bot API's own download limit
const heldFiles = new Map(); // telegram user id -> { msg, file, at }
/** What a message carries as a file: a document, or the largest size of a photo. */
function fileOf(msg = {}) {
  if (msg.document) return { fileId: msg.document.file_id, name: msg.document.file_name || 'fayl', size: msg.document.file_size || 0 };
  if (Array.isArray(msg.photo) && msg.photo.length) { const p = msg.photo[msg.photo.length - 1]; return { fileId: p.file_id, name: `rasm-${msg.message_id || Date.now()}.jpg`, size: p.file_size || 0 }; }
  return null;
}
/**
 * A file from a client who has open requests: held HOLD_MS for this Telegram user and the
 * question "which request?" - one button a request (`mpu_<request>`) and "not for the lawyer"
 * (`mpu_x`, the file then goes its ordinary way). null: nothing to ask (no open request).
 */
async function fileOffer(pool, adminId, msg, lang = 'uz') {
  const file = fileOf(msg);
  if (!file || !msg.from) return null;
  let open;
  try { open = await createPortal({ db: pool }).files.openRequestsOf(adminId); } catch (e) { if (e.code === '42P01') return null; throw e; }
  if (!open.length) return null;
  const t = T(lang);
  // several files sent together (an album, pages of one document): one question for all of them
  const prev = heldFiles.get(String(msg.from.id));
  if (prev && Date.now() - prev.at < 60000 && prev.items.length < 10) { prev.items.push({ msg, file }); return { silent: true }; }
  heldFiles.set(String(msg.from.id), { items: [{ msg, file }], at: Date.now() });
  const many = new Set(open.map(q => q.matterId)).size > 1;
  const rows = open.slice(0, 8).map(q => ([{ text: short(`${q.title}${many ? ` · ${q.matterTitle}` : ''}`, 60), callback_data: `mpu_${q.id}` }]));
  rows.push([{ text: t.notRequest, callback_data: 'mpu_x' }]);
  return { text: t.askFile, keyboard: { inline_keyboard: rows } };
}
function takeFile(telegramUserId) {
  const h = heldFiles.get(String(telegramUserId)); heldFiles.delete(String(telegramUserId));
  return h && Date.now() - h.at <= HOLD_MS ? h : null;
}
/** The held files into the request's matter: downloaded from Telegram, sealed by portal-files. { text, matterId } */
async function fileToRequest(pool, bot, adminId, requestId, held, { notify = null, lang = 'uz', download = null } = {}) {
  const t = T(lang);
  if (!held || !held.items.length) return { text: t.fileGone };
  const portal = createPortal({ db: pool, notify });
  const matterId = await portal.files.requestMatter(requestId);
  if (!matterId) return { text: t.notFound };
  const lines = [];
  let title = '';
  for (const { file } of held.items) {
    if (file.size > FILE_MAX) { lines.push(`${short(file.name, 60)}: ${t.fileBig}`); continue; }
    let buffer;
    try {
      buffer = download ? await download(file.fileId) : Buffer.from(await (await fetch(await bot.getFileLink(file.fileId))).arrayBuffer());
    } catch (e) { console.warn('[PORTAL-TG] file not downloaded:', e.message); lines.push(`${short(file.name, 60)}: ${t.fileFailed}`); continue; }
    try {
      const f = await portal.files.upload(matterId, adminId, { buffer, name: file.name, requestId, source: 'telegram' });
      if (!title) { const q = (await portal.files.clientList(matterId, adminId)).requests.find(x => x.id === requestId); title = q ? short(q.title, 80) : ''; }
      lines.push(t.fileSaved(f.name, title));
    } catch (e) {
      if (!(e && e.status)) throw e;
      if (e.status === 404) return { text: t.notFound };
      lines.push(`${short(file.name, 60)}: ${e.message}`);
    }
  }
  return { text: lines.join('\n'), matterId };
}

module.exports = { fileOf, fileOffer, takeFile, fileToRequest, T, PREFIX, accountOf, clientCount, listReply, matterCard, documentFile, inviteStart, inviteJoin, ensureAccount, hold, take, createNotifier,
  MSG_STATE, MSG_TTL_MIN, MSG_CANCEL, msgWaiting, startMessage, sendFromBot };
