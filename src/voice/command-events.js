'use strict';

/**
 * Voice commands level 2, V5 (docs/design/ovozli-buyruqlar-2.md §6): what
 * happened to a recognised command, as codes only - place, kind, action,
 * outcome, spoken or typed, language, time. Never the text and never the
 * account. A failed write is dropped: counting never stops a command.
 * VOICE_COMMAND_EVENTS=off writes nothing.
 *
 * outcome: shown (the card or the bot's answer), run ([Bajarish] done),
 * ask (run, and it asked a follow-up: a name, a matter, a confirmation),
 * as_question ("Savol sifatida yuborish" - a question taken for a command),
 * cancel ([Bekor]).
 */

const PLACES = ['chat', 'matters', 'telegram'];
const KINDS = ['open', 'matter', 'context', 'blocked'];
const OUTCOMES = ['shown', 'run', 'ask', 'as_question', 'cancel'];

function clean(e) {
  if (!e || !PLACES.includes(e.place) || !KINDS.includes(e.kind) || !OUTCOMES.includes(e.outcome)) return null;
  const action = String(e.action || '');
  if (!/^[a-z_]{1,40}$/u.test(action)) return null;
  return { place: e.place, kind: e.kind, action, outcome: e.outcome, via: e.via === 'voice' ? 'voice' : 'text', lang: e.lang === 'ru' ? 'ru' : 'uz' };
}

/** One row, or nothing. Resolves to true when written; never throws. */
async function record(db, event, env = process.env) {
  if (String(env.VOICE_COMMAND_EVENTS || '').toLowerCase() === 'off' || !db) return false;
  const e = clean(event);
  if (!e) return false;
  try {
    await db.query('INSERT INTO voice_command_events (place, kind, action, outcome, via, lang) VALUES ($1, $2, $3, $4, $5, $6)',
      [e.place, e.kind, e.action, e.outcome, e.via, e.lang]);
    return true;
  } catch (err) {
    if (!/does not exist/u.test(String(err && err.message))) console.warn('[VOICE-CMD] event not written:', err.message);
    return false;
  }
}
/** Fire and forget. */
const note = (db, event, env) => { record(db, event, env).catch(() => {}); };

/**
 * The master's view: per place and action, how many were shown, run, asked
 * a follow-up, sent as a question and cancelled over the last `days` (1-90).
 * `questionShare` = as_question / shown: how often a question was taken for
 * a command (the false-recognition signal).
 */
async function summary(db, { days = 7 } = {}) {
  const d = Math.min(90, Math.max(1, Math.floor(Number(days)) || 7));
  const rows = (await db.query(`SELECT place, kind, action, via, outcome, COUNT(*)::int AS n
      FROM voice_command_events WHERE created_at >= now() - ($1::int * interval '1 day')
      GROUP BY place, kind, action, via, outcome`, [d])).rows;
  const by = new Map();
  for (const r of rows) {
    const k = `${r.place}|${r.action}`;
    if (!by.has(k)) by.set(k, { place: r.place, kind: r.kind, action: r.action, voice: 0, text: 0, shown: 0, run: 0, ask: 0, as_question: 0, cancel: 0 });
    const x = by.get(k);
    x[r.outcome] += r.n;
    if (r.outcome === 'shown') x[r.via] += r.n;
  }
  const items = [...by.values()].map(x => ({ ...x, questionShare: x.shown ? Math.round((x.as_question / x.shown) * 1000) / 1000 : null }))
    .sort((a, b) => (b.shown - a.shown) || a.action.localeCompare(b.action));
  const total = items.reduce((t, x) => ({ shown: t.shown + x.shown, run: t.run + x.run, ask: t.ask + x.ask, as_question: t.as_question + x.as_question, cancel: t.cancel + x.cancel }),
    { shown: 0, run: 0, ask: 0, as_question: 0, cancel: 0 });
  return { days: d, items, total };
}

module.exports = { PLACES, KINDS, OUTCOMES, clean, record, note, summary };
