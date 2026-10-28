'use strict';

/**
 * The script the bot writes in (2026-10-28, owner; OʻRQ-1184 of 21.10.2026:
 * Oʻ → Ö, Gʻ → Ğ, Sh → Ş, Ch → Ç). Texts are written and checked in the old
 * script (lex.uz is); what the bot SENDS is put into the chat's script:
 *
 *   the new alphabet by default; the old one when the chat chose it
 *   (/alifbo, or the "Eski alifbo" button offered once), or when the linked
 *   account chose it on the site (user_profile.manual.alphabet). Either way
 *   the other stays one command away.
 *
 * Only the text and button labels change - never a link, `code`, callback
 * data or Cyrillic (public/js/uz-alphabet.js). Choices are cached 5 minutes.
 */

const A = require('../../public/js/uz-alphabet');

const cache = new Map(); // chatId -> { at, v }
const offered = new Set(); // chats offered the old script in this process

function createAlphabetPrefs({ db }) {
  async function get(chatId) {
    const k = String(chatId);
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < 5 * 60e3) return hit.v;
    let v = null;
    try {
      const r = await db.query('SELECT alphabet FROM tg_alphabet WHERE chat_id = $1', [Number(chatId)]);
      v = r.rows[0] ? r.rows[0].alphabet : null;
      if (!v) {
        const a = await db.query(`SELECT p.manual->>'alphabet' AS a FROM admins ad JOIN user_profile p ON p.admin_id = ad.id
          WHERE ad.telegram_chat_id::text = $1 OR ad.telegram_user_id::text = $1 LIMIT 1`, [k]).catch(() => ({ rows: [] }));
        v = a.rows[0] && ['new', 'old'].includes(a.rows[0].a) ? a.rows[0].a : null;
      }
    } catch (_) { v = null; }
    cache.set(k, { at: Date.now(), v });
    if (cache.size > 20000) cache.delete(cache.keys().next().value);
    return v; // null = never chose: the new alphabet
  }
  async function set(chatId, v) {
    const val = v === 'old' ? 'old' : 'new';
    await db.query(`INSERT INTO tg_alphabet (chat_id, alphabet, updated_at) VALUES ($1, $2, now())
      ON CONFLICT (chat_id) DO UPDATE SET alphabet = EXCLUDED.alphabet, updated_at = now()`, [Number(chatId), val]);
    cache.set(String(chatId), { at: Date.now(), v: val });
    return val;
  }
  return { get, set };
}

/** button labels in the chat's script; callback data and URLs untouched */
function markup(opts, conv) {
  if (!opts || !opts.reply_markup) return opts;
  const rm = opts.reply_markup;
  const rows = k => (Array.isArray(rm[k]) ? rm[k].map(row => (Array.isArray(row) ? row.map(b => (b && typeof b === 'object' && typeof b.text === 'string' ? { ...b, text: conv(b.text) } : (typeof b === 'string' ? conv(b) : b))) : row)) : undefined);
  const next = { ...rm };
  if (rm.inline_keyboard) next.inline_keyboard = rows('inline_keyboard');
  if (rm.keyboard) next.keyboard = rows('keyboard');
  return { ...opts, reply_markup: next };
}

/**
 * Wraps bot.sendMessage and bot.editMessageText. The first text a chat with
 * no choice gets in the new script carries one "Eski alifbo" button (only
 * when the message has no buttons of its own).
 */
function wrapBot(bot, prefs) {
  const send = bot.sendMessage.bind(bot);
  const edit = bot.editMessageText.bind(bot);
  bot.sendMessage = async (chatId, text, opts) => {
    let v = null;
    try { v = await prefs.get(chatId); } catch (_) { v = null; }
    if (v === 'old' || typeof text !== 'string') return send(chatId, text, opts);
    let o = markup(opts, A.toNew);
    const changed = A.toNew(text) !== text;
    if (!v && changed && Number(chatId) > 0 && !offered.has(String(chatId)) && !(o && o.reply_markup)) {
      offered.add(String(chatId));
      o = { ...(o || {}), reply_markup: { inline_keyboard: [[{ text: keep('🔤 Eski alifbo (oʻ, gʻ, sh, ch)'), callback_data: 'alpha_old' }]] } };
    }
    return send(chatId, A.toNew(text), o);
  };
  bot.editMessageText = async (text, opts) => {
    let v = null;
    try { v = opts && opts.chat_id != null ? await prefs.get(opts.chat_id) : null; } catch (_) { v = null; }
    if (v === 'old' || typeof text !== 'string') return edit(text, opts);
    return edit(A.toNew(text), markup(opts, A.toNew));
  };
  return bot;
}

// old-script samples are shown as they are: a zero-width non-joiner keeps the converter off them
const keep = t => t.replace(/([OoGg])([ʻ‘'`ʼ’])/gu, '$1\u200c$2').replace(/([SsCc])([Hh])/gu, '$1\u200c$2');
const TEXT = {
  ask: "Qaysi alifboda yozay?\n\nYangi alifbo (OʻRQ-1184, 2026): Ö ö, Ğ ğ, Ş ş, Ç ç.\n" + keep('Eski alifbo: Oʻ oʻ, Gʻ gʻ, Sh sh, Ch ch.') + "\n\nTanlovni istalgan payt /alifbo bilan o'zgartirasiz.",
  old: "Endi eski alifboda yozaman (oʻ, gʻ, sh, ch). Yangisiga qaytish: /alifbo",
  new: "Endi yangi alifboda yozaman (ö, ğ, ş, ç). Eskisiga qaytish: /alifbo",
};
const keyboard = { inline_keyboard: [[{ text: 'Yangi: ö ğ ş ç', callback_data: 'alpha_new' }, { text: keep('Eski: oʻ gʻ sh ch'), callback_data: 'alpha_old' }]] };

module.exports = { createAlphabetPrefs, wrapBot, markup, keep, TEXT, keyboard };
