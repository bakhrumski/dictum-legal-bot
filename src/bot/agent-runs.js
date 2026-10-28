'use strict';

/**
 * Agent tasks in the Telegram bot (2026-10-28, roadmap PR-F). "agent:
 * <topshiriq>" (typed, or said: a voice note goes through STT to the same
 * agent) makes a plan for the linked account (the planner service, its gate
 * and checks); the bot shows the steps and the price with "Tasdiqlash /
 * Bekor qilish". Approving sends one status message that the worker edits
 * as steps finish (src/agents/runs/notify.js); the end sends the verified
 * answer, or the run's question - the person's next message is the answer
 * (conversation state `agent_answer`) - or why it stopped. Nothing is
 * reserved before approval; the units follow the planner's rules.
 */

const TASK_RE = /^(?:agent(?:ga)?|агент(?:у)?)(?:\s+(?:topshiriq|vazifa|задача|задание))?\s*[:—–-]\s*([\s\S]{10,2000})$/iu;

/** The task of an "agent: …" message, or null. */
function parseAgentTask(text = '') {
  const m = TASK_RE.exec(String(text || '').trim());
  return m ? m[1].replace(/\s+/gu, ' ').trim() : null;
}

const RU = lang => lang === 'ru';
const ICON = { ok: '✅', failed: '❌', skipped: '⏭', skipped_error: '⚠️', running: '⏳' };

function priceLine(price, lang) {
  const chat = price && price.chat ? price.chat : 0;
  if (!chat) return RU(lang) ? 'Цена: бесплатно.' : 'Narx: bepul.';
  return RU(lang) ? `Цена: ${chat} вопрос(а) из лимита.` : `Narx: limitdan ${chat} ta savol.`;
}

/** The plan as the bot shows it before approval. */
function planText(out, lang = 'uz') {
  const steps = out.plan.nodes.map((n, i) => `${i + 1}. ${n.label}${n.args && (n.args.query || n.args.question) ? ` — ${String(n.args.query || n.args.question).slice(0, 80)}` : ''}`);
  return [
    RU(lang) ? '🤖 План агента:' : '🤖 Agent rejasi:',
    out.matterTitle ? (RU(lang) ? `Дело: ${out.matterTitle}` : `Ish: ${out.matterTitle}`) : '',
    ...steps,
    '',
    priceLine(out.price, lang),
    RU(lang) ? 'Пока ничего не списано. Если ответ не пройдёт проверку по источникам, единица вернётся.' : "Hali hech narsa yechilmadi. Javob manbalar bilan tekshiruvdan o'tmasa, birlik qaytariladi.",
  ].filter(Boolean).join('\n');
}

/** The status message: the plan's steps with how far each got. */
function progressText(run, steps = [], lang = 'uz', headline = null) {
  const byId = new Map(steps.map(s => [s.step_id || s.id, s.status]));
  const nodes = (run.plan && run.plan.nodes) || [];
  const labelOf = n => n.label || n.tool;
  return [
    headline || (RU(lang) ? '⏳ Агент работает…' : '⏳ Agent ishlamoqda…'),
    ...nodes.map(n => `${ICON[byId.get(n.id)] || '▫️'} ${labelOf(n)}`),
  ].join('\n');
}

/**
 * The worker's Telegram side. deps: { bot, pool, setConversationState,
 * splitForTelegram, registry } - the registry names the steps.
 */
function createTelegramRunNotifier({ bot, pool, setConversationState, splitForTelegram, registry }) {
  const label = run => ({ ...run, plan: { ...(run.plan || {}), nodes: ((run.plan && run.plan.nodes) || []).map(n => ({ ...n, label: (registry && registry.get(n.tool) || {}).label || n.tool })) } });
  const langOf = run => (/[Ѐ-ӿ]/u.test(String(run.input && run.input.task || '')) ? 'ru' : 'uz');
  async function steps(runId) {
    const r = await pool.query('SELECT step_id, status FROM agent_run_steps WHERE run_id = $1', [runId]);
    return r.rows;
  }
  async function edit(tg, text) {
    if (!tg.messageId) return;
    await bot.editMessageText(text, { chat_id: tg.chatId, message_id: tg.messageId }).catch(() => {});
  }
  return {
    async progress(run) {
      const tg = run.input.telegram;
      await edit(tg, progressText(label(run), await steps(run.id), langOf(run)));
    },
    async done(run, status, result) {
      const tg = run.input.telegram;
      const lang = langOf(run);
      const body = (result && result.body) || {};
      const head = {
        done: RU(lang) ? '✅ Агент закончил.' : '✅ Agent tugatdi.',
        needs_input: RU(lang) ? '❓ Агенту нужен ваш ответ.' : '❓ Agentga javobingiz kerak.',
        cancelled: RU(lang) ? '⏹ Отменено. Единицы возвращены.' : "⏹ Bekor qilindi. Birliklar qaytarildi.",
      }[status] || (RU(lang) ? '⚠️ Задачу выполнить не удалось. Единица возвращена.' : "⚠️ Topshiriqni bajarib bo'lmadi. Birlik qaytarildi.");
      await edit(tg, progressText(label(run), await steps(run.id), lang, head));
      if (status === 'done' && body.answer) {
        for (const part of splitForTelegram(body.answer)) {
          await bot.sendMessage(tg.chatId, part, { parse_mode: 'Markdown', disable_web_page_preview: true })
            .catch(() => bot.sendMessage(tg.chatId, part.replace(/[*_`[\]]/gu, '')).catch(() => {}));
        }
      } else if (status === 'needs_input' && body.question) {
        await setConversationState(tg.chatId, 'agent_answer', { runId: run.id });
        await bot.sendMessage(tg.chatId, `${body.question}\n\n${RU(lang) ? 'Ответьте следующим сообщением (текстом или голосом). «отмена» — остановить.' : "Keyingi xabarda javob bering (matn yoki ovoz). «bekor» — to'xtatish."}`).catch(() => {});
      }
    },
  };
}

module.exports = { parseAgentTask, planText, progressText, createTelegramRunNotifier };
