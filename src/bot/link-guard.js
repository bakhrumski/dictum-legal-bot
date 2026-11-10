'use strict';

/**
 * X1 of the 2026-11-10 audit (S1): `/link <login> <password>` in the bot.
 *
 *   - wrong passwords were limited per Telegram sender only, so the bot was a
 *     way to try one login's password from many Telegram accounts, around the
 *     site's lockout: failures now also count per target login;
 *   - a right password moved the account to the sender's Telegram even when
 *     the account was already linked to another one - for a master that is
 *     where the sign-in's second factor is sent, so the password alone took
 *     the second factor too: an account linked to another Telegram is no
 *     longer moved from here. The owner unlinks in the old chat (/unlink) or
 *     signs in on the site and uses "Telegram'ni ulash" (a signed-in session).
 */

const MAX = 5;
const WINDOW_MS = 15 * 60 * 1000;

function createLinkGuard({ max = MAX, windowMs = WINDOW_MS, clock = Date.now } = {}) {
  const bySender = new Map(), byLogin = new Map();
  const key = login => String(login == null ? '' : login).trim().toLowerCase();
  const live = (map, k) => {
    const t = map.get(k);
    if (!t) return null;
    if (clock() - t.at > windowMs) { map.delete(k); return null; }
    return t;
  };
  const bump = (map, k) => { const t = live(map, k) || { n: 0, at: clock() }; t.n++; map.set(k, t); };
  return {
    /** May this sender try this login now? */
    allowed(senderId, login) {
      const s = live(bySender, String(senderId)), l = live(byLogin, key(login));
      return !((s && s.n >= max) || (l && l.n >= max));
    },
    failed(senderId, login) { bump(bySender, String(senderId)); if (key(login)) bump(byLogin, key(login)); },
    /** A right password clears the sender's count; the login's count stays until its window ends. */
    succeeded(senderId) { bySender.delete(String(senderId)); },
  };
}

/** Is the account already linked to a Telegram other than this chat / user? */
function linkedElsewhere(admin, chatId, fromId) {
  if (!admin) return false;
  const chat = admin.telegram_chat_id == null ? null : String(admin.telegram_chat_id);
  const user = admin.telegram_user_id == null ? null : String(admin.telegram_user_id);
  if (chat == null && user == null) return false;
  return !((chat == null || chat === String(chatId)) && (user == null || user === String(fromId)));
}

module.exports = { createLinkGuard, linkedElsewhere, MAX, WINDOW_MS };
