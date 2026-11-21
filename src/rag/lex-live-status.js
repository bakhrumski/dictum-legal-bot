'use strict';

/**
 * X4 of the 2026-11-10 audit (Q8): what became of the live lex.uz search of one answer.
 * Until now a search that failed (lex.uz down, slow, the time limit) and a search that found
 * nothing looked the same: zero results, said to nobody. The search functions count into a
 * shared `stats` object ({ searches, failed, deadline }); statusOf turns it into
 *   ok           every search page was read
 *   partial      some search pages were not read
 *   unreachable  none was read (lex.uz did not answer)
 *   deadline     none was read because the request's time ran out first
 *   none         no live search ran
 * `partial` is telemetry only; `unreachable` and `deadline` are told to the person in one line,
 * because the answer then rests on our stored copy of the law alone. No AI.
 */

function newStats() { return { searches: 0, failed: 0, deadline: 0 }; }

function statusOf(stats) {
  const s = stats || {};
  if (!s.searches) return 'none';
  if (!s.failed) return 'ok';
  if (s.failed < s.searches) return 'partial';
  return s.deadline >= s.failed ? 'deadline' : 'unreachable';
}

const NOTE = {
  uz: 'ℹ️ lex.uz hozir javob bermadi: javob bazamizda saqlangan qonun matnlariga tayangan. Muhim qaror oldidan normaning amaldagi tahririni lex.uz’da tekshiring.',
  ru: 'ℹ️ lex.uz сейчас не ответил: ответ опирается на сохранённые у нас тексты законов. Перед важным решением проверьте действующую редакцию нормы на lex.uz.',
  en: 'ℹ️ lex.uz did not respond just now: the answer rests on our stored copy of the law. Check the current wording on lex.uz before an important decision.',
};

/** The line for the person, or '' when there is nothing to tell. */
function noticeFor(lexLive, lang = 'uz') {
  const st = lexLive && lexLive.status;
  if (st !== 'unreachable' && st !== 'deadline') return '';
  return NOTE[lang] || NOTE.uz;
}

function appendNotice(text, lexLive, lang) {
  const n = noticeFor(lexLive, lang);
  return n && text ? `${String(text).replace(/\s+$/u, '')}\n\n${n}` : text;
}

module.exports = { newStats, statusOf, noticeFor, appendNotice };
