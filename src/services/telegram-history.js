'use strict';

/**
 * A legal question asked in the bot and its answer also land in the linked
 * website account's chat history (2026-10-20, owner: the landing says
 * "Suhbatlar platformada ham saqlanadi"). One web chat per Tashkent day,
 * topic 'telegram', titled "Telegram · DD.MM.YYYY"; each Q&A pair is appended
 * in the web chat's own message shape ({ role: 'user' | 'model', text }).
 * Only for an account linked to the Telegram user; nothing else is copied.
 */

function tashkentDay(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(now).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}`;
}

async function appendTelegramTurn(db, { adminId, question, answer, now = new Date() }) {
  if (!adminId || !String(question || '').trim() || !String(answer || '').trim()) return null;
  const title = `Telegram · ${tashkentDay(now)}`;
  const turn = [
    { role: 'user', text: String(question).slice(0, 8000), channel: 'telegram' },
    { role: 'model', text: String(answer).slice(0, 30000), channel: 'telegram' },
  ];
  const found = await db.query(
    `SELECT id FROM ai_chat_sessions WHERE admin_id = $1 AND topic = 'telegram' AND title = $2 ORDER BY id DESC LIMIT 1`, [adminId, title]);
  if (found.rows.length) {
    await db.query(`UPDATE ai_chat_sessions SET messages = COALESCE(messages, '[]'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [found.rows[0].id, JSON.stringify(turn)]);
    return found.rows[0].id;
  }
  const r = await db.query(
    `INSERT INTO ai_chat_sessions (admin_id, title, databases, topic, messages) VALUES ($1, $2, $3, 'telegram', $4::jsonb) RETURNING id`,
    [adminId, title, ['lex.uz'], JSON.stringify(turn)]);
  return r.rows[0].id;
}

module.exports = { appendTelegramTurn, tashkentDay };
