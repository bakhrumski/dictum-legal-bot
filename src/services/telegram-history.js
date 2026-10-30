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
  // E6: the messages are sealed (src/privacy/chat-sessions.js), so a turn is
  // added by reading, opening, extending and sealing them again, in one transaction
  const chats = require('../privacy/chat-sessions');
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const own = client !== db;
  try {
    if (own) await client.query('BEGIN');
    const found = await client.query(
      `SELECT id FROM ai_chat_sessions WHERE admin_id = $1 AND topic = 'telegram' AND title = $2 ORDER BY id DESC LIMIT 1`, [adminId, title]);
    let id;
    if (found.rows.length && await chats.appendMessages(client, { id: found.rows[0].id, adminId, add: turn })) {
      id = found.rows[0].id;
    } else {
      id = (await client.query(
        `INSERT INTO ai_chat_sessions (admin_id, title, databases, topic, messages, message_count) VALUES ($1, $2, $3, 'telegram', $4::jsonb, $5) RETURNING id`,
        [adminId, title, ['lex.uz'], chats.sealMessages(turn, adminId), turn.length])).rows[0].id;
    }
    if (own) await client.query('COMMIT');
    return id;
  } catch (e) {
    if (own) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (own) client.release();
  }
}

module.exports = { appendTelegramTurn, tashkentDay };
