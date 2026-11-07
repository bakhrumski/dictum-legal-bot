'use strict';

/**
 * The person's provider choice (E6b, docs/design/shifrlash-1-bosqich.md §5,
 * §9 answer 4): "Hujjatlarim va savollarim DeepSeek'ka yuborilmasin" on the
 * Moslashish page (`user_profile.manual.noDeepseek`). Off by default. While it
 * is on, no text call made for that account goes to DeepSeek: the lane's next
 * provider answers (GPT-6, then Gemini), and the ledger row says which one
 * and at what price.
 *
 * The account is the usage-ledger request's (web session, a linked Telegram
 * account, an agent run); it is read once per request and kept in the
 * request's memory. No account, or no profile: DeepSeek as before.
 */

let loader = async () => false;
/** server.js: how to read the flag for an account (user_profile.manual). */
function setLoader(fn) { if (typeof fn === 'function') loader = fn; }

/** Whether this request may use DeepSeek. current(): the usage-ledger request scope. */
async function deepseekAllowed(store) {
  if (!store) return true;
  const shared = store.shared || (store.shared = {});
  if (shared.noDeepseek === undefined) {
    shared.noDeepseek = false;
    // a Telegram request names its linked account in shared.accountId (src/bot/bot.js)
    const uid = shared.accountId || (typeof store.userIdOf === 'function' ? store.userIdOf() : null);
    if (uid) {
      try { shared.noDeepseek = !!(await loader(uid)); } catch (_) { shared.noDeepseek = false; }
    }
  }
  return !shared.noDeepseek;
}

/** The loader server.js sets: the account's own choice from user_profile. */
const dbLoader = pool => async (adminId) => {
  const r = await pool.query(`SELECT (manual->>'noDeepseek')::boolean AS no FROM user_profile WHERE admin_id = $1`, [adminId]);
  return !!(r.rows[0] && r.rows[0].no);
};

module.exports = { setLoader, deepseekAllowed, dbLoader };
