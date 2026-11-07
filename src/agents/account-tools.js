'use strict';

/**
 * Account actions the Telegram agent can do itself (2026-10-20, owner): a
 * user who writes - or says, through speech-to-text - "limitim qancha?",
 * "tariflarni ko'rsat", "oxirgi savollarim", "saytdagi akkauntimni ulash" or
 * "ilovani och" gets the answer from the platform's own data instead of a
 * pointer to another bot.
 *
 * Each tool is one fixed, read-only action: it reads the caller's own data
 * (by their Telegram id and the account linked to it) or returns a link;
 * nothing is paid, granted, changed or deleted here. A payment or a plan
 * stays a link to the page where the person confirms it themselves; account
 * deletion (delete_account) only explains what is removed and asks for a
 * confirmation button - the request is filed by the bot and carried out by a
 * master (src/services/account-deletion.js). No AI call is made by a tool; no
 * answer quota is used (like /balance).
 *
 * Detection: a deterministic phrase list first (cheap, also for voice), then
 * the intent model may return intent "hisob_amal" with "action" set to one
 * of TOOL_NAMES. A legal question is never routed here (LEGAL_MARKER_RE).
 */

const TOOL_NAMES = Object.freeze(['balance', 'plans', 'recent', 'link_account', 'open_app', 'commands', 'delete_account']);

const baseUrl = () => String(process.env.APP_URL || 'https://juristai.uz').replace(/\/+$/u, '');

// a legal matter in the same message: not an account action
const LEGAL_MARKER_RE = /qonun|modda|kodeks|ish\s+haq|ish\s+beruvchi|kompensatsiya|\bsud|da['’ʻ`]?vo|jarima|shartnoma|undir|mehnat|soliq|aliment|ajrim|meros|bank|elektr|gaz\b|kommunal|ijara|закон|стать|кодекс|\bсуд|работодател|зарплат|компенсац|штраф|договор|взыск|налог|банк|коммунал|аренд/iu;
// a short message only: "tarif" / "limit" inside a longer story is about the story
const SHORT_ONLY = new Set(['balance', 'plans']);

const PATTERNS = [
  // first: "akkauntimni o'chiring" is never a question about the law
  ['delete_account', /(akkaunt|hisob|profil|ma['’ʻ`]?lumot)\p{L}*\s+(?:\p{L}+\s+){0,2}(o['’ʻ`]?chir\p{L}*|yo['’ʻ`]?q\s+qil\p{L}*)|удал\p{L}*\s+(?:\p{L}+\s+){0,1}(аккаунт|профил|учётн|учетн|данн)\p{L}*|(аккаунт|профил)\p{L}*\s+(?:\p{L}+\s+){0,1}удал\p{L}*|delete\s+(my\s+)?account/iu],
  ['balance', /(limit\p{L}*|balans\p{L}*|qoldi[gq]\p{L}*|nechta\s+savol\p{L}*\s+(?:qoldi|bor)|savol(?:lar)?im\s+qoldi|kredit\p{L}*\s+(?:qoldi|qancha)|лимит\p{L}*|баланс\p{L}*|сколько\s+(?:вопросов\s+)?остал\p{L}*)/iu],
  ['plans', /(tarif\p{L}*|obuna\p{L}*|narx(?:lar)?i?\s+qancha|silver|gold|platinum|тариф\p{L}*|подписк\p{L}*|сколько\s+стоит)/iu],
  ['recent', /(oxirgi|so['’ʻ`]?nggi|avvalgi|oldingi)\s+(savol|so['’ʻ`]?rov|murojaat)\p{L}*|savol(?:lar)?im\s+tarixi|tarix(?:im|ni)\b|последн\p{L}*\s+(вопрос|обращен)\p{L}*|истори\p{L}*\s+(вопрос|обращен)\p{L}*/iu],
  ['link_account', /(sayt\p{L}*|veb|web|ilova\p{L}*|kabinet\p{L}*|akkaunt\p{L}*|hisob(?:im)?)\s*(?:\p{L}+\s+){0,2}(ula\p{L}*|bog['’ʻ`]?la\p{L}*)|telegram(?:ni|im)?\s+(?:\p{L}+\s+)?(ula\p{L}*|bog['’ʻ`]?la\p{L}*)|привяз\p{L}*|подключ\p{L}*\s+(?:telegram|телеграм|аккаунт|сайт)/iu],
  ['open_app', /(ilova\p{L}*|sayt\p{L}*|kabinet\p{L}*|dashboard\p{L}*|shaxsiy\s+kabinet)\s*(?:\p{L}+\s+){0,1}(och\p{L}*|havola\p{L}*|manzil\p{L}*|link\p{L}*)|(открой|ссылк\p{L}*\s+на)\s+(сайт|приложени\p{L}*|кабинет)/iu],
  ['commands', /^(?:\/?(?:menu|menyu|buyruq\p{L}*|nima\s+qila\s+olasan|nimalar\s+qila\s+olasan|imkoniyat\p{L}*)|что\s+ты\s+умеешь|команды)[?.!\s]*$/iu],
];

/** The account action a message asks for, or null. */
function detectAccountAction(text = '') {
  const t = String(text || '').trim();
  if (!t || t.length > 300 || LEGAL_MARKER_RE.test(t)) return null;
  for (const [name, rx] of PATTERNS) {
    if (SHORT_ONLY.has(name) && t.length > 80) continue;
    if (rx.test(t)) return name;
  }
  return null;
}

/** The model's action, kept only when it is one of the tools. */
function toolFromIntent(parsed = {}) {
  const a = String(parsed && parsed.action || '').trim().toLowerCase();
  return TOOL_NAMES.includes(a) ? a : null;
}

const ru = (lang) => lang === 'ru';
function dt(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(x).map(v => [v.type, v.value]));
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}

/**
 * Run one tool. deps: { db (pg pool), economy (telegram-economy), ledger
 * (tariff-ledger), texts (bot/tariff-texts) } - injected so tests need no
 * database. who: { telegramUserId, adminId } of the caller.
 * Returns { reply, action }.
 */
async function runAccountTool(name, { chatId, who = {}, lang = 'uz', deps = {} } = {}) {
  const R = ru(lang);
  const app = `${baseUrl()}/app/`;
  switch (name) {
    case 'balance': {
      const economy = deps.economy || require('../services/telegram-economy');
      const ledger = deps.ledger || require('../rag/tariff-ledger');
      const texts = deps.texts || require('../bot/tariff-texts');
      const status = await economy.getTelegramAnswerStatus(chatId, who);
      const balance = await ledger.balance(who);
      return { action: 'tool_balance', reply: texts.balanceText({ balance, paidCredits: status.paidCredits || 0, pending: status.pending }) };
    }
    case 'plans': {
      const texts = deps.texts || require('../bot/tariff-texts');
      const head = R ? 'Тарифы JuristAI:' : 'JuristAI tariflari:';
      const tail = R
        ? `Выбрать и оплатить тариф: ${baseUrl()}/tariff.html — оплата только после вашего подтверждения, автосписаний нет.`
        : `Tarifni tanlash va to'lash: ${baseUrl()}/tariff.html — to'lov faqat siz tasdiqlaganingizdan keyin, avtomatik yechib olinmaydi.`;
      return { action: 'tool_plans', reply: [head, ...texts.planLines(), '', tail].join('\n') };
    }
    case 'recent': {
      const db = deps.db || require('../database/db').pool;
      const tgId = who.telegramUserId != null ? who.telegramUserId : chatId;
      const { rows } = await db.query(
        `SELECT r.id, r.request_text, r.created_at, r.status, r.request_type
           FROM requests r JOIN users u ON u.id = r.user_id
          WHERE u.telegram_id = $1 AND COALESCE(r.source_channel, 'telegram') = 'telegram'
          ORDER BY r.created_at DESC LIMIT 5`, [tgId]);
      if (!rows.length) return { action: 'tool_recent', reply: R ? 'У вас пока нет вопросов в боте.' : "Botda hali savollaringiz yo'q." };
      // the questions are sealed at rest (E6, src/privacy/request-text.js)
      const reqSeal = require('../privacy/request-text');
      const lines = rows.map(r => reqSeal.openRequest(r, r.id, { response: null })).map((r, i) => `${i + 1}. ${dt(r.created_at)} — ${String(r.request_text || '').replace(/\s+/gu, ' ').slice(0, 120)}`);
      const more = R ? `Полная история и ответы — в приложении: ${app}` : `To'liq tarix va javoblar ilovada: ${app}`;
      return { action: 'tool_recent', reply: [R ? 'Ваши последние вопросы:' : "So'nggi savollaringiz:", ...lines, '', more].join('\n') };
    }
    case 'link_account': {
      const linked = !!who.adminId;
      const reply = linked
        ? (R ? `Ваш Telegram уже привязан к аккаунту JuristAI: лимиты общие для бота и сайта. Открыть приложение: ${app}`
          : `Telegram'ingiz JuristAI akkauntiga allaqachon ulangan: bot va saytdagi limit umumiy. Ilovani ochish: ${app}`)
        // sign in with the account's own login / password / Google: "sign in with Telegram"
        // would open a NEW account for this Telegram when none is linked yet
        : (R ? `Если у вас уже есть аккаунт на сайте (например, с оплаченным тарифом): войдите на ${app} своим логином и паролем (или через Google) и в меню профиля нажмите «Подключить Telegram» — откроется этот бот, нажмите «Start». Если аккаунта на сайте нет, «Войти через Telegram» создаст его, уже связанным с этим Telegram. Если Telegram привязан к другому аккаунту: /unlink, затем подключите снова.`
          : `Saytda akkauntingiz bo'lsa (masalan, tarif sotib olingan): ${app} ga o'z login va parolingiz (yoki Google) bilan kiring va profil menyusida "Telegram'ni ulash"ni bosing — shu bot ochiladi, "Start"ni bosing. Saytda akkaunt bo'lmasa, "Telegram orqali kirish" uni shu Telegram'ga ulangan holda ochadi. Telegram boshqa akkauntga ulangan bo'lsa: /unlink, so'ng qayta ulang.`);
      return { action: 'tool_link_account', reply };
    }
    case 'delete_account':
      // nothing is deleted here: the bot asks for a confirmation button
      // (src/bot/bot.js acc_del_yes), then a master carries the request out
      return {
        action: 'tool_delete_account_confirm',
        reply: R
          ? 'Удалить аккаунт JuristAI? Будут удалены: ваши данные профиля, история чатов на сайте, дела и загруженные сканы, текст ваших вопросов и ответов в боте. Записи об оплате и использовании тарифа остаются без личных данных (учёт). Неиспользованный лимит не возвращается. Подтвердите кнопкой ниже.'
          : "JuristAI akkauntini o'chirishni so'raysizmi? O'chiriladi: profil ma'lumotlaringiz, saytdagi suhbatlar tarixi, ishlar va skanerlangan hujjatlar, botdagi savol va javoblaringiz matni. To'lov va tarif sarfi yozuvlari shaxsiy ma'lumotsiz qoladi (hisob-kitob uchun). Ishlatilmagan limit qaytarilmaydi. Quyidagi tugma bilan tasdiqlang.",
      };
    case 'open_app':
      return { action: 'tool_open_app', reply: R ? `Приложение JuristAI: ${app}\nТарифы: ${baseUrl()}/tariff.html` : `JuristAI ilovasi: ${app}\nTariflar: ${baseUrl()}/tariff.html` };
    case 'commands':
    default:
      return {
        action: 'tool_commands',
        reply: R
          ? ['Я могу:', '• ответить на правовой вопрос (текстом или голосом)', '• показать остаток лимита — «сколько вопросов осталось?»', '• показать тарифы — «тарифы»', '• показать последние вопросы — «мои последние вопросы»', '• подобрать адвоката — «нужен адвокат»', '• принять заказ на документ — «подготовьте заявление»', '• привязать сайт — «привязать аккаунт»'].join('\n')
          : ['Men quyidagilarni qila olaman:', "• huquqiy savolga javob (matn yoki ovoz bilan)", "• limit qoldig'i — \"nechta savolim qoldi?\"", '• tariflar — "tariflarni ko\'rsat"', "• so'nggi savollaringiz — \"oxirgi savollarim\"", '• advokat topish — "advokat kerak"', '• hujjat buyurtmasi — "ariza tayyorlab bering"', '• saytni ulash — "akkauntni ulash"'].join('\n'),
      };
  }
}

module.exports = { TOOL_NAMES, detectAccountAction, toolFromIntent, runAccountTool, LEGAL_MARKER_RE };
