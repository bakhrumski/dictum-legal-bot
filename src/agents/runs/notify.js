'use strict';

/**
 * Where a run tells the person how it goes (2026-10-28, PR-F). A run whose
 * input carries `telegram: { chatId, messageId }` (an agent task given in the
 * bot) is reported there by the worker: each finished step edits the one
 * status message, and the end sends the answer, the question the run asks,
 * or why it stopped. The bot registers the Telegram side at start
 * (src/bot/bot.js); the chat and message live in the run's row, so a run
 * resumed by another process after a deploy still reports to the same chat.
 * A failure to report never touches the run.
 */

let telegram = null;
const lastEdit = new Map(); // runId -> ms, to edit at most every 2.5 s

function setTelegramNotifier(n) { telegram = n || null; }

const target = run => (run && run.input && run.input.telegram && run.input.telegram.chatId ? run.input.telegram : null);

async function progress(run) {
  if (!telegram || !target(run)) return;
  const now = Date.now();
  if (now - (lastEdit.get(run.id) || 0) < 2500) return;
  lastEdit.set(run.id, now);
  try { await telegram.progress(run); } catch (e) { console.warn('[AGENT-RUN] telegram progress failed:', e.message); }
}

async function done(run, status, result) {
  lastEdit.delete(run && run.id);
  if (!telegram || !target(run)) return;
  try { await telegram.done(run, status, result); } catch (e) { console.warn('[AGENT-RUN] telegram done failed:', e.message); }
}

module.exports = { setTelegramNotifier, progress, done, target };
