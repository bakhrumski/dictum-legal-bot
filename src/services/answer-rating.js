'use strict';

/**
 * X5 of the 2026-11-10 audit (Q9): "this answer is wrong / incomplete" from the person who got it.
 * The old dashboard had a flag-a-phrase tool (answer_feedback, kinds grammar / context); when the
 * dashboard became the master's only, ordinary users lost every way to say an answer was bad.
 * One button under each AI answer in the app, and one under each answer in the bot, writes the
 * same table - so it lands in Boshqaruv -> "Sifat", where a lawyer reads it (and from where a
 * reviewed case can go into the evaluation set). Texts are sealed as that table's rows are.
 * No AI, no unit; ANSWER_RATING_MAX a person a day (20).
 */

const privacy = require('../privacy/crypto');

const KINDS = Object.freeze(['wrong', 'incomplete']);
const DAILY_MAX = () => Math.max(1, Number(process.env.ANSWER_RATING_MAX) || 20);
const aad = (col, who) => `answer_feedback.${col}:${who}`;
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/**
 * who: { adminId (or null for a Telegram user with no account), name }; source 'web' | 'telegram'.
 * Returns { ok, id } or { ok: false, code } (invalid | too_many).
 */
async function record(db, { adminId = null, name = '', kind, question, answer, comment, source = 'web' } = {}) {
  if (!KINDS.includes(kind)) return { ok: false, code: 'invalid' };
  const answerText = cut(answer, 12000);
  if (answerText.length < 20) return { ok: false, code: 'invalid' };
  const who = adminId == null ? null : Number(adminId);
  if (who != null) {
    const n = (await db.query(`SELECT count(*)::int AS n FROM answer_feedback WHERE submitted_by = $1 AND created_at > now() - interval '1 day'`, [who])).rows[0].n;
    if (n >= DAILY_MAX()) return { ok: false, code: 'too_many' };
  }
  const note = cut(comment, 500) || null;
  // the table's "selected text" is what the reader sees first: the person's own words, else the answer's opening
  const selected = note || answerText.slice(0, 300);
  const r = await db.query(
    `INSERT INTO answer_feedback (source, selected_text, error_type, suggestion, question, answer_text, submitted_by, submitter_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [source === 'telegram' ? 'telegram' : 'ai', privacy.seal(selected, aad('selected_text', who)), kind, privacy.seal(note, aad('suggestion', who)),
      privacy.seal(cut(question, 1000) || null, aad('question', who)), privacy.seal(answerText, aad('answer_text', who)), who, cut(name, 120) || null]);
  return { ok: true, id: r.rows[0].id };
}

module.exports = { record, KINDS, DAILY_MAX };
