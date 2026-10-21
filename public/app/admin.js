/* Boshqaruv (Master Admin) — eski dashboard.html'dagi "Boshqaruv" bo'limlarining yangi ilovadagi ko'rinishi.
   Faqat bazada master bo'lgan hisobga ko'rinadi; har bir so'rovni server o'zi tekshiradi (requireMasterAdmin).
   Ma'lumot va amallar eski dashboard bilan bir xil API'lardan; yangi server yo'li yo'q. */
(function (G) {
  'use strict';
  var J = G.JAI, esc = J.esc, $ = J.$, $$ = J.$$;

  /* ---------- matnlar (uz / ru; en - sarlavhalar) ---------- */
  var L = {
    uz: {
      'nav.admin': 'Boshqaruv', 'adm.sub': "Bugungi ishlar tepada; bo'limlar guruhlarga ajratilgan.",
      'adm.back': 'Boshqaruv', 'adm.old': 'Eski dashboardda ochish', 'adm.refresh': 'Yangilash', 'adm.empty': "Ma'lumot yo'q",
      'adm.ai': "AI so'rovlar", 'adm.ai.d': "Har so'rov: modellar, usage, xarajat",
      'adm.spend': 'Xarajat', 'adm.spend.d': 'Oylik API sarfi: provayder, model, foydalanuvchi',
      'adm.reg': 'Qabul va tarif', 'adm.reg.d': 'Advokat/student arizalari, tarif berish',
      'adm.fb': 'Sifat', 'adm.fb.d': 'Javob xatolari va tekshiruv',
      'adm.src': 'Tavsiya etilgan manbalar', 'adm.src.d': "Korpusda yo'q aktlar: yuklash yoki rad etish",
      'adm.cov': 'Korpus qamrovi', 'adm.cov.d': "Kuchsiz savollar va eng ko'p so'ralganlar",
      'adm.audit': 'Audit jurnali', 'adm.audit.d': 'Muhim amallar va kim bajargani',
      'adm.landing': 'Landing', 'adm.landing.d': 'juristai.uz fon bezagi',
      'adm.offers': 'Chegirmalar', 'adm.offers.d': 'Individual tarif takliflari',
      'adm.tg': 'Telegram agent', 'adm.tg.d': 'Suhbatlar, operator rejimi, Hermes',
      'adm.att': 'Advokatlar', 'adm.att.d': 'Litsenziya tekshiruvi va katalog',
      'adm.svc': 'Pullik xizmatlar', 'adm.svc.d': 'Hujjat buyurtmalari va narxlar',
      'adm.more': "Eski dashboardda qolganlar", 'adm.more.d': "Korpusga yuklash, inson navbati, model testi",
      'adm.today': 'Bugun', 'adm.t.reg': 'Kutilayotgan arizalar', 'adm.t.orders': 'Yurist narxini kutayotgan buyurtmalar', 'adm.t.del': "O'chirish so'rovlari", 'adm.t.fb': 'Yangi xato xabarlari', 'adm.t.ai': 'Bugungi AI xarajati', 'adm.t.unknown': "ta narxi noma'lum",
      'adm.g.daily': 'Kundalik ishlar', 'adm.g.money': 'Tarif va xarajat', 'adm.g.catalog': 'Advokatlar va manbalar', 'adm.g.tech': 'Texnik',
      'adm.day': 'Kunlik', 'adm.month': 'Oylik', 'adm.days': 'kun', 'adm.calls': 'chaqiruv', 'adm.requests': "so'rov",
      'adm.known': "Narxi ma'lum", 'adm.unknown': "Narxi noma'lum", 'adm.failed': 'Xato', 'adm.avg': "O'rtacha / so'rov",
      'adm.incomplete': "to'liq emas", 'adm.model': 'Model', 'adm.service': 'Servis', 'adm.cost': 'Xarajat', 'adm.time': 'Vaqt',
      'adm.outcome': 'Natija', 'adm.stage': 'Bosqich', 'adm.status': 'Holat', 'adm.tokens': 'Token (kirish/chiqish)',
      'adm.all': 'Hammasi', 'adm.open': 'Ochish', 'adm.user': 'Foydalanuvchi', 'adm.total': 'Jami', 'adm.provider': 'Provayder',
      'adm.endpoint': "Yo'l", 'adm.users': 'Faol foydalanuvchilar', 'adm.peruser': 'Bir foydalanuvchiga (p50 / p95 / max)',
      'adm.pending': 'Kutilmoqda', 'adm.approved': 'Tasdiqlangan', 'adm.rejected': 'Rad etilgan',
      'adm.approve': 'Tasdiqlash', 'adm.reject': 'Rad etish', 'adm.reason': 'Sabab', 'adm.fee': 'Platforma', 'adm.payout': 'Yuristga', 'adm.fee.none': 'Komissiya % belgilanmagan (LAWYER_COMMISSION_PCT)', 'adm.approve.q': 'Arizani tasdiqlaysizmi?',
      'adm.grant': 'Tarif berish', 'adm.grant.d': "To'lov tasdiqlangandan keyin: foydalanuvchi, tarif va to'lov raqami.",
      'adm.search.user': 'Foydalanuvchi qidirish (kamida 2 belgi)', 'adm.plan': 'Tarif', 'adm.payref': "To'lov raqami (paymentRef)",
      'adm.amount': "Summa, so'm (ixtiyoriy)", 'adm.grant.ok': 'Tarif berildi', 'adm.grant.dup': "Bu to'lov allaqachon qayd etilgan",
      'adm.new': 'Yangi', 'adm.reviewed': "Ko'rib chiqilgan", 'adm.dismissed': 'Bekor qilingan', 'adm.mark.rev': "Ko'rib chiqildi", 'adm.mark.dis': 'Bekor qilish',
      'adm.ingested': 'Yuklangan', 'adm.ingest': 'Korpusga yuklash', 'adm.topic': 'Soha', 'adm.times': 'marta', 'adm.batch': 'Tanlanganlarni yuklash',
      'adm.batch.run': 'Yuklanmoqda', 'adm.topq': "Eng ko'p so'ralgan savollar", 'adm.csv': 'CSV yuklab olish', 'adm.weak': 'kuchsiz',
      'adm.missing': "Korpusda yo'q aktlar", 'adm.inbank': 'qa-korpusda bor',
      'adm.filter': 'Qidirish', 'adm.action': 'Amal', 'adm.who': 'Kim', 'adm.bg': 'Fon bezagi', 'adm.save': 'Saqlash', 'adm.saved': 'Saqlandi',
      'adm.bg.1': "To'r", 'adm.bg.2': 'Nuqtalar', 'adm.bg.3': 'Rangli fon', 'adm.bg.5': '§ belgisi', 'adm.bg.0': "Yo'q",
      'adm.draft': 'Qoralama', 'adm.active': 'Faol', 'adm.redeemed': 'Ishlatilgan', 'adm.expired': "Muddati o'tgan", 'adm.revoked': 'Bekor qilingan',
      'adm.revoke': 'Bekor qilish', 'adm.activate': 'Aktivlashtirish', 'adm.offer.new': 'Yangi taklif', 'adm.discount': 'Chegirma, %',
      'adm.validdays': 'Amal qilish, kun', 'adm.quote': 'Hisoblash', 'adm.create': 'Yaratish', 'adm.final': 'Yakuniy narx', 'adm.minprice': 'Eng past ruxsat',
      'adm.auto': 'Avtomatik', 'adm.human': 'Operator', 'adm.mode': 'Rejim', 'adm.switch': 'Almashtirish', 'adm.hermes': 'Hermes (soya rejim)',
      'adm.agree': 'Mos kelish', 'adm.license': 'Litsenziya', 'adm.published': "Katalogda", 'adm.yes': 'Ha', 'adm.no': "Yo'q", 'adm.edit': 'Tahrirlash',
      'adm.orders': 'Buyurtmalar', 'adm.catalog': 'Narxlar katalogi', 'adm.price': "Narx, so'm", 'adm.name': 'Nomi',
      'adm.years': 'yil', 'adm.doc': 'hujjat', 'adm.role': 'Rol', 'adm.resource': 'Resurs',
      'adm.del': "O'chirish so'rovlari", 'adm.del.d': "Botda akkauntni o'chirishni so'raganlar", 'adm.del.go': "O'chirish", 'adm.del.q': "Akkaunt va shaxsiy ma'lumotlar o'chiriladi (to'lov yozuvlari shaxsiy ma'lumotsiz qoladi). Davom etasizmi?", 'adm.done.t': 'Bajarilgan', 'adm.cancelled': 'Bekor qilingan',
      'adm.req': "So'rov", 'adm.calls.t': 'Chaqiruvlar', 'adm.close': 'Yopish', 'adm.done': 'Bajarildi', 'adm.err': 'Xato'
    },
    ru: {
      'nav.admin': 'Управление', 'adm.sub': 'Управление платформой: запросы, расходы, корпус, пользователи.',
      'adm.back': 'Управление', 'adm.old': 'Открыть в старом дашборде', 'adm.refresh': 'Обновить', 'adm.empty': 'Нет данных',
      'adm.ai': 'AI-запросы', 'adm.ai.d': 'Каждый запрос: модели, usage, стоимость',
      'adm.spend': 'Расходы', 'adm.spend.d': 'Расход API за месяц: провайдер, модель, пользователь',
      'adm.reg': 'Заявки и тарифы', 'adm.reg.d': 'Заявки юристов/студентов, выдача тарифа',
      'adm.fb': 'Качество', 'adm.fb.d': 'Ошибки в ответах и проверка',
      'adm.src': 'Предложенные источники', 'adm.src.d': 'Акты, которых нет в корпусе: загрузить или отклонить',
      'adm.cov': 'Покрытие корпуса', 'adm.cov.d': 'Слабые вопросы и самые частые',
      'adm.audit': 'Журнал аудита', 'adm.audit.d': 'Важные действия и кто их выполнил',
      'adm.landing': 'Лендинг', 'adm.landing.d': 'Фон juristai.uz',
      'adm.offers': 'Скидки', 'adm.offers.d': 'Индивидуальные тарифные предложения',
      'adm.tg': 'Telegram-агент', 'adm.tg.d': 'Диалоги, режим оператора, Hermes',
      'adm.att': 'Адвокаты', 'adm.att.d': 'Проверка лицензий и каталог',
      'adm.svc': 'Платные услуги', 'adm.svc.d': 'Заказы документов и цены',
      'adm.more': 'Остальное в старом дашборде', 'adm.more.d': 'Загрузка в корпус, очередь, опрос, прогноз',
      'adm.today': 'Сегодня', 'adm.t.reg': 'Заявки в ожидании', 'adm.t.orders': 'Заказы ждут цену юриста', 'adm.t.del': 'Запросы на удаление', 'adm.t.fb': 'Новые сообщения об ошибках', 'adm.t.ai': 'Расход AI сегодня', 'adm.t.unknown': 'без цены',
      'adm.g.daily': 'Ежедневные дела', 'adm.g.money': 'Тарифы и расходы', 'adm.g.catalog': 'Адвокаты и источники', 'adm.g.tech': 'Техническое',
      'adm.day': 'По дням', 'adm.month': 'По месяцам', 'adm.days': 'дн.', 'adm.calls': 'вызовов', 'adm.requests': 'запросов',
      'adm.known': 'Известная стоимость', 'adm.unknown': 'Неизвестная стоимость', 'adm.failed': 'Ошибки', 'adm.avg': 'Средняя / запрос',
      'adm.incomplete': 'неполная', 'adm.model': 'Модель', 'adm.service': 'Сервис', 'adm.cost': 'Стоимость', 'adm.time': 'Время',
      'adm.outcome': 'Итог', 'adm.stage': 'Этап', 'adm.status': 'Статус', 'adm.tokens': 'Токены (вход/выход)',
      'adm.all': 'Все', 'adm.open': 'Открыть', 'adm.user': 'Пользователь', 'adm.total': 'Итого', 'adm.provider': 'Провайдер',
      'adm.endpoint': 'Путь', 'adm.users': 'Активные пользователи', 'adm.peruser': 'На пользователя (p50 / p95 / max)',
      'adm.pending': 'Ожидают', 'adm.approved': 'Одобренные', 'adm.rejected': 'Отклонённые',
      'adm.approve': 'Одобрить', 'adm.reject': 'Отклонить', 'adm.reason': 'Причина', 'adm.fee': 'Платформа', 'adm.payout': 'Юристу', 'adm.fee.none': 'Комиссия % не задана (LAWYER_COMMISSION_PCT)', 'adm.approve.q': 'Одобрить заявку?',
      'adm.grant': 'Выдать тариф', 'adm.grant.d': 'После подтверждения оплаты: пользователь, тариф и номер платежа.',
      'adm.search.user': 'Поиск пользователя (от 2 символов)', 'adm.plan': 'Тариф', 'adm.payref': 'Номер платежа (paymentRef)',
      'adm.amount': 'Сумма, сум (необязательно)', 'adm.grant.ok': 'Тариф выдан', 'adm.grant.dup': 'Этот платёж уже учтён',
      'adm.new': 'Новые', 'adm.reviewed': 'Проверенные', 'adm.dismissed': 'Отклонённые', 'adm.mark.rev': 'Проверено', 'adm.mark.dis': 'Отклонить',
      'adm.ingested': 'Загруженные', 'adm.ingest': 'Загрузить в корпус', 'adm.topic': 'Отрасль', 'adm.times': 'раз', 'adm.batch': 'Загрузить выбранные',
      'adm.batch.run': 'Загрузка', 'adm.topq': 'Самые частые вопросы', 'adm.csv': 'Скачать CSV', 'adm.weak': 'слабых',
      'adm.missing': 'Акты, которых нет в корпусе', 'adm.inbank': 'есть в qa-корпусе',
      'adm.filter': 'Поиск', 'adm.action': 'Действие', 'adm.who': 'Кто', 'adm.bg': 'Фон', 'adm.save': 'Сохранить', 'adm.saved': 'Сохранено',
      'adm.bg.1': 'Сетка', 'adm.bg.2': 'Точки', 'adm.bg.3': 'Цветной фон', 'adm.bg.5': 'Знак §', 'adm.bg.0': 'Нет',
      'adm.draft': 'Черновик', 'adm.active': 'Активные', 'adm.redeemed': 'Использованные', 'adm.expired': 'Истёкшие', 'adm.revoked': 'Отменённые',
      'adm.revoke': 'Отменить', 'adm.activate': 'Активировать', 'adm.offer.new': 'Новое предложение', 'adm.discount': 'Скидка, %',
      'adm.validdays': 'Срок действия, дней', 'adm.quote': 'Рассчитать', 'adm.create': 'Создать', 'adm.final': 'Итоговая цена', 'adm.minprice': 'Минимально допустимая',
      'adm.auto': 'Автомат', 'adm.human': 'Оператор', 'adm.mode': 'Режим', 'adm.switch': 'Переключить', 'adm.hermes': 'Hermes (теневой режим)',
      'adm.agree': 'Совпадение', 'adm.license': 'Лицензия', 'adm.published': 'В каталоге', 'adm.yes': 'Да', 'adm.no': 'Нет', 'adm.edit': 'Изменить',
      'adm.orders': 'Заказы', 'adm.catalog': 'Каталог цен', 'adm.price': 'Цена, сум', 'adm.name': 'Название',
      'adm.years': 'лет', 'adm.doc': 'документ', 'adm.role': 'Роль', 'adm.resource': 'Ресурс',
      'adm.del': 'Запросы на удаление', 'adm.del.d': 'Кто попросил удалить аккаунт в боте', 'adm.del.go': 'Удалить', 'adm.del.q': 'Аккаунт и личные данные будут удалены (записи об оплате останутся без личных данных). Продолжить?', 'adm.done.t': 'Выполненные', 'adm.cancelled': 'Отклонённые',
      'adm.req': 'Запрос', 'adm.calls.t': 'Вызовы', 'adm.close': 'Закрыть', 'adm.done': 'Готово', 'adm.err': 'Ошибка'
    },
    en: {
      'nav.admin': 'Admin', 'adm.sub': 'Platform management: requests, costs, corpus, users.', 'adm.back': 'Admin',
      'adm.old': 'Open in the old dashboard', 'adm.refresh': 'Refresh', 'adm.empty': 'No data',
      'adm.ai': 'AI requests', 'adm.spend': 'Spend', 'adm.reg': 'Applications & plans', 'adm.fb': 'Quality', 'adm.src': 'Suggested sources',
      'adm.cov': 'Corpus coverage', 'adm.audit': 'Audit log', 'adm.landing': 'Landing', 'adm.offers': 'Discounts', 'adm.tg': 'Telegram agent',
      'adm.att': 'Lawyers', 'adm.svc': 'Paid services', 'adm.more': 'Still in the old dashboard', 'adm.today': 'Today', 'adm.g.daily': 'Daily work', 'adm.g.money': 'Plans and spend', 'adm.g.catalog': 'Lawyers and sources', 'adm.g.tech': 'Technical', 'adm.del': 'Deletion requests'
    }
  };
  ['uz', 'ru', 'en'].forEach(function (l) { var d = G.JAI_I18N[l] = G.JAI_I18N[l] || {}; Object.keys(L[l]).forEach(function (k) { if (d[k] === undefined) d[k] = L[l][k]; }); });
  var t = J.t;

  J.isMaster = function () { return !!(J.S.user && J.S.user.role === 'master'); };

  /* ---------- yordamchilar ---------- */
  function usd(n) { return n == null ? '—' : '$' + Number(n).toFixed(Number(n) < 1 ? 4 : 2); }
  function uzs(n) { return n == null ? '—' : J.fmtNum(n) + " so'm"; }
  function dt(d) { if (!d) return ''; var x = new Date(d); if (isNaN(x)) return ''; var p = function (n) { return (n < 10 ? '0' : '') + n; }; return J.fmtDate(d) + ' ' + p(x.getHours()) + ':' + p(x.getMinutes()); }
  function n0(x) { return J.fmtNum(Number(x) || 0); }
  function empty() { return '<div class="empty-state">' + esc(t('adm.empty')) + '</div>'; }
  function errBox(r) { return '<div class="empty-state err">' + esc(J.errMsg(r && r.data)) + '</div>'; }
  function skel() { return '<div class="skel" style="margin:18px 0"></div><div class="skel" style="width:70%"></div>'; }
  function table(head, rows) {
    if (!rows.length) return empty();
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function td(v, raw) { return '<td>' + (raw ? v : esc(v == null ? '' : v)) + '</td>'; }
  function tabs(list, cur) { return '<div class="tabs">' + list.map(function (x) { return '<button type="button" data-tab="' + esc(x[0]) + '" class="' + (x[0] === cur ? 'on' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>'; }
  function kv(items) { return '<div class="kv">' + items.map(function (x) { return '<div><small>' + esc(x[0]) + '</small><b class="num">' + x[1] + '</b></div>'; }).join('') + '</div>'; }
  function busy(btn, on) { if (btn) { btn.disabled = !!on; } }

  // [key, icon, title key, group]; the hub shows the groups in this order (2026-10-21: "Xarajat" removed -
  // "AI so'rovlar" shows the same spend with unknown cost counted)
  var SECTIONS = [
    ['qabul', 'user', 'adm.reg', 'daily'], ['xizmatlar', 'doc', 'adm.svc', 'daily'], ['ochirish', 'trash', 'adm.del', 'daily'],
    ['sifat', 'flag', 'adm.fb', 'daily'], ['telegram', 'tg', 'adm.tg', 'daily'],
    ['chegirmalar', 'spark', 'adm.offers', 'money'], ['ai', 'chat', 'adm.ai', 'money'],
    ['advokatlar', 'scale', 'adm.att', 'catalog'], ['manbalar', 'book', 'adm.src', 'catalog'],
    ['korpus', 'search', 'adm.cov', 'tech'], ['audit', 'shield', 'adm.audit', 'tech'], ['landing', 'globe', 'adm.landing', 'tech']
  ];
  var GROUPS = [['daily', 'adm.g.daily'], ['money', 'adm.g.money'], ['catalog', 'adm.g.catalog'], ['tech', 'adm.g.tech']];

  /** Bo'lim qobig'i: sarlavha, orqaga, yangilash; body ichini loader to'ldiradi. */
  function shell(key, loader) {
    var sec = SECTIONS.filter(function (s) { return s[0] === key; })[0];
    J.setTitle(t(sec[2]));
    var v = J.mount('<div class="wrap"><div class="vh"><div><a class="muted" href="#/boshqaruv" style="font-size:13px">← ' + esc(t('adm.back')) + '</a><h2 style="margin-top:6px">' + esc(t(sec[2])) + '</h2><p>' + esc(t(sec[2] + '.d')) + '</p></div>' +
      '<button class="pill ghost sm" data-a="rf" type="button">' + esc(t('adm.refresh')) + '</button></div><div class="adm-b">' + skel() + '</div></div>');
    var body = $('.adm-b', v);
    var run = function () { body.innerHTML = skel(); loader(body, run); };
    $('[data-a=rf]', v).onclick = run;
    run();
    return v;
  }

  /* ---------- hub ---------- */
  J.viewAdmin = function () {
    J.setTitle(t('nav.admin'));
    function tile(s) {
      return '<a class="tile" href="#/boshqaruv/' + s[0] + '"><span class="tile-h">' + J.icon(s[1]) + '</span><b>' + esc(t(s[2])) + '</b><p>' + esc(t(s[2] + '.d')) + '</p><span class="tile-f"><span class="tag adm-count" data-k="' + s[0] + '"></span></span></a>';
    }
    var groups = GROUPS.map(function (g) {
      var list = SECTIONS.filter(function (s) { return s[3] === g[0]; }).map(tile).join('')
        + (g[0] === 'tech' ? '<a class="tile" href="/dashboard.html"><span class="tile-h">' + J.icon('layers') + '</span><b>' + esc(t('adm.more')) + '</b><p>' + esc(t('adm.more.d')) + '</p></a>' : '');
      return '<h3 class="adm-gh">' + esc(t(g[1])) + '</h3><div class="grid3">' + list + '</div>';
    }).join('');
    // "Bugun": what needs a decision now, and today's AI spend
    var today = '<div class="card adm-today"><h4>' + esc(t('adm.today')) + '</h4><div class="adm-today-b">' + skel() + '</div></div>';
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(t('nav.admin')) + '</h2><p>' + esc(t('adm.sub')) + '</p></div></div>' + today + groups + '</div>');
    var todayItems = {};
    function drawToday() {
      var order = [['qabul', 'adm.t.reg'], ['xizmatlar', 'adm.t.orders'], ['ochirish', 'adm.t.del'], ['sifat', 'adm.t.fb'], ['ai', 'adm.t.ai']];
      $('.adm-today-b', v).innerHTML = '<div class="kv">' + order.map(function (o) {
        var x = todayItems[o[0]];
        return '<a href="#/boshqaruv/' + o[0] + '" style="color:inherit;text-decoration:none"><small>' + esc(t(o[1])) + '</small><b class="num">' + (x == null ? '…' : esc(x)) + '</b></a>';
      }).join('') + '</div>';
    }
    drawToday();
    function put(k, val) { todayItems[k] = val; drawToday(); }
    J.api('/api/admin/service-orders?limit=100&status=pending_lawyer_review').then(function (r) { put('xizmatlar', r.ok ? String((r.data.items || []).length) : '—'); });
    J.api('/api/admin/ai-usage/report?period=day').then(function (r) {
      var ps = r.ok ? (r.data.periods || []) : [], last = ps[ps.length - 1] || null;
      // unknown cost is never shown as $0: the calls without a price are counted beside the known spend
      put('ai', last ? '$' + Number(last.known_cost_usd || 0).toFixed(2) + (Number(last.unknown_cost_calls) ? ' · +' + last.unknown_cost_calls + ' ' + t('adm.t.unknown') : '') : '—');
    });
    // kutilayotgan ishlar soni (bo'lsa)
    J.api('/api/registration-requests/stats').then(function (r) { put('qabul', r.ok ? String(Number(r.data.pending) || 0) : '—'); if (r.ok && Number(r.data.pending) > 0) setCount(v, 'qabul', r.data.pending + ' ' + t('adm.pending').toLowerCase()); });
    J.api('/api/admin/answer-feedback?status=new').then(function (r) { put('sifat', r.ok ? String(Number(r.data.newCount) || 0) : '—'); if (r.ok && r.data.newCount > 0) setCount(v, 'sifat', r.data.newCount + ' ' + t('adm.new').toLowerCase()); });
    J.api('/api/admin/suggested-sources?status=pending').then(function (r) { if (r.ok && (r.data.suggestions || []).length) setCount(v, 'manbalar', (r.data.suggestions || []).length + ' ' + t('adm.pending').toLowerCase()); });
    J.api('/api/admin/account-deletions?status=pending').then(function (r) { put('ochirish', r.ok ? String((r.data.requests || []).length) : '—'); if (r.ok && (r.data.requests || []).length) setCount(v, 'ochirish', (r.data.requests || []).length + ' ' + t('adm.pending').toLowerCase()); });
  };
  function setCount(v, k, txt) { var el = $('.adm-count[data-k="' + k + '"]', v); if (el) el.innerHTML = '<span class="dot warn"></span>' + esc(txt); }

  /* ---------- AI so'rovlar ---------- */
  var aiState = { period: 'day', days: 7, service: '' };
  function viewAi() {
    shell('ai', function (body, again) {
      body.innerHTML = '<div class="filters"><span class="seg">' + [['day', 'adm.day'], ['month', 'adm.month']].map(function (p) { return '<button type="button" data-p="' + p[0] + '" class="' + (aiState.period === p[0] ? 'on' : '') + '">' + esc(t(p[1])) + '</button>'; }).join('') + '</span></div>' +
        '<div class="ai-rep">' + skel() + '</div><h3 style="font-size:18px;margin:26px 0 12px">' + esc(t('adm.calls.t')) + '</h3>' +
        '<div class="filters"><select class="inp ai-days">' + [1, 7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (d === aiState.days ? ' selected' : '') + '>' + d + ' ' + esc(t('adm.days')) + '</option>'; }).join('') + '</select>' +
        '<select class="inp ai-svc"><option value="">' + esc(t('adm.all')) + '</option>' + ['web', 'telegram', 'workspace'].map(function (s) { return '<option' + (s === aiState.service ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div><div class="ai-req">' + skel() + '</div>';
      $$('[data-p]', body).forEach(function (b) { b.onclick = function () { aiState.period = b.dataset.p; again(); }; });
      $('.ai-days', body).onchange = function () { aiState.days = Number(this.value); loadReq(); };
      $('.ai-svc', body).onchange = function () { aiState.service = this.value; loadReq(); };
      J.selects(body);
      J.api('/api/admin/ai-usage/report?period=' + aiState.period).then(function (r) {
        var box = $('.ai-rep', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var ps = (r.data.periods || []).slice().reverse(), last = ps[0] || {};
        var models = {};
        (r.data.periods || []).forEach(function (p) { (p.by_model || []).forEach(function (m) { var k = m.model || '?'; var x = models[k] = models[k] || { model: k, provider: m.provider, calls: 0, usd: 0, unk: 0 }; x.calls += m.calls || 0; x.usd += m.known_cost_usd || 0; x.unk += m.unknown_cost_calls || 0; }); });
        box.innerHTML = kv([
          [t('adm.requests') + ' · ' + (last.period || ''), n0(last.requests)], [t('adm.known'), usd(last.known_cost_usd)],
          [t('adm.unknown'), n0(last.unknown_cost_calls) + ' ' + t('adm.calls')], [t('adm.avg'), last.average_cost_per_request_usd == null ? '—' : usd(last.average_cost_per_request_usd)]
        ]) + table([t('adm.time'), t('adm.requests'), t('adm.calls'), t('adm.known'), t('adm.unknown'), t('adm.failed')], ps.map(function (p) {
          return '<tr>' + td(p.period) + td(n0(p.requests)) + td(n0(p.calls)) + td(usd(p.known_cost_usd) + (p.cost_complete ? '' : ' (' + t('adm.incomplete') + ')')) + td(n0(p.unknown_cost_calls)) + td(n0(p.failed_calls)) + '</tr>';
        })) + '<h3 style="font-size:16px;margin:22px 0 10px">' + esc(t('adm.model')) + '</h3>' +
        table([t('adm.model'), t('adm.provider'), t('adm.calls'), t('adm.known'), t('adm.unknown')], Object.keys(models).map(function (k) { return models[k]; }).sort(function (a, b) { return b.usd - a.usd; }).map(function (m) {
          return '<tr>' + td(m.model) + td(m.provider) + td(n0(m.calls)) + td(usd(m.usd)) + td(n0(m.unk)) + '</tr>';
        })) + (r.data.note ? '<p class="note">' + esc(r.data.note) + '</p>' : '');
      });
      function loadReq() {
        var box = $('.ai-req', body); box.innerHTML = skel();
        J.api('/api/admin/ai-usage/requests?limit=100&days=' + aiState.days + (aiState.service ? '&service=' + encodeURIComponent(aiState.service) : '')).then(function (r) {
          if (!r.ok) { box.innerHTML = errBox(r); return; }
          var list = r.data.requests || [];
          box.innerHTML = table([t('adm.time'), t('adm.service'), t('adm.outcome'), t('adm.model'), t('adm.calls'), t('adm.cost'), ''], list.map(function (q) {
            return '<tr>' + td(dt(q.started_at)) + td(q.service + (q.kind ? ' · ' + q.kind : '')) + td(q.outcome || '') + td((q.models || []).join(', ')) +
              td(n0(q.calls) + (q.failed_calls ? ' · ' + q.failed_calls + ' ✕' : '')) + td(usd(q.known_cost_usd) + (q.unknown_cost_calls ? ' + ' + q.unknown_cost_calls + '?' : '')) +
              '<td><button class="pill ghost sm" data-id="' + esc(q.request_id) + '">' + esc(t('adm.open')) + '</button></td></tr>';
          }));
          $$('[data-id]', box).forEach(function (b) { b.onclick = function () { aiDetail(b.dataset.id); }; });
        });
      }
      loadReq();
    });
  }
  function aiDetail(id) {
    var m = J.modal({ html: '<h2>' + esc(t('adm.req')) + '</h2><p class="sub num">' + esc(id) + '</p><div class="ai-d">' + skel() + '</div>' });
    J.api('/api/admin/ai-usage/requests/' + encodeURIComponent(id)).then(function (r) {
      var box = $('.ai-d', m.body); if (!r.ok) { box.innerHTML = errBox(r); return; }
      var s = r.data.summary || {}, calls = r.data.calls || [];
      box.innerHTML = kv([[t('adm.calls'), n0(s.calls)], [t('adm.known'), usd(s.known_cost_usd)], [t('adm.unknown'), n0(s.unknown_cost_calls)], [t('adm.failed'), n0(s.failed_calls)]]) +
        (s.note ? '<p class="note">' + esc(s.note) + '</p>' : '') +
        table(['#', t('adm.stage'), t('adm.model'), t('adm.status'), t('adm.tokens'), 'ms', t('adm.cost')], calls.map(function (c) {
          return '<tr>' + td(c.seq) + td(c.stage) + td((c.model_returned || c.model_requested || '') + (c.fallback_from ? ' ← ' + c.fallback_from : '')) +
            td((c.status || '') + (c.error_code ? ' · ' + c.error_code : '') + (c.truncated ? ' · cut' : '') + (c.finish_reason ? ' · ' + c.finish_reason : '')) +
            td(n0(c.in_tokens) + ' / ' + n0(c.out_tokens) + (c.reasoning_tokens ? ' (r ' + n0(c.reasoning_tokens) + ')' : '')) + td(n0(c.latency_ms)) +
            td(c.cost_usd == null ? '— (' + (c.cost_source || 'unknown') + ')' : usd(c.cost_usd)) + '</tr>';
        }));
    });
  }

  /* ---------- Xarajat ---------- */
  var spendMonth = '';

  /* ---------- Qabul va tarif ---------- */
  var regTab = 'pending';
  function viewReg() {
    shell('qabul', function (body, again) {
      body.innerHTML = tabs([['pending', t('adm.pending')], ['approved', t('adm.approved')], ['rejected', t('adm.rejected')]], regTab) + '<div class="rg-l">' + skel() + '</div>' +
        '<div class="card" style="margin-top:28px"><h4>' + esc(t('adm.grant')) + '</h4><p class="muted" style="font-size:13.5px;margin-bottom:14px">' + esc(t('adm.grant.d')) + '</p>' +
        '<div class="field"><input class="inp g-q" placeholder="' + esc(t('adm.search.user')) + '"><div class="g-res" style="margin-top:6px"></div></div>' +
        '<div class="grid3"><div class="field"><label>' + esc(t('adm.plan')) + '</label><select class="inp g-plan"><option>silver</option><option>gold</option><option>platinum</option></select></div>' +
        '<div class="field"><label>' + esc(t('adm.payref')) + '</label><input class="inp g-ref" maxlength="120"></div>' +
        '<div class="field"><label>' + esc(t('adm.amount')) + '</label><input class="inp g-amt" inputmode="numeric"></div></div>' +
        '<button class="pill g-go" type="button" disabled>' + esc(t('adm.grant')) + '</button> <span class="muted g-who" style="font-size:13px;margin-left:8px"></span></div>';
      J.selects(body);
      $$('[data-tab]', body).forEach(function (b) { b.onclick = function () { regTab = b.dataset.tab; again(); }; });
      J.api('/api/registration-requests?status=' + regTab).then(function (r) {
        var box = $('.rg-l', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var list = Array.isArray(r.data) ? r.data : [];
        box.innerHTML = table([t('adm.user'), t('adm.role'), 'Telegram', t('adm.status'), ''], list.map(function (q) {
          return '<tr><td>' + esc(((q.first_name || '') + ' ' + (q.last_name || '')).trim()) + '<div class="tag">' + esc([dt(q.created_at), q.specialization, q.experience_years != null ? q.experience_years + ' ' + t('adm.years') : '', q.license_number ? '№ ' + q.license_number : '', q.has_document_base64 || q.document_file_name ? t('adm.doc') + ' ✓' : '', q.ai_screening_status ? 'AI: ' + q.ai_screening_status : ''].filter(Boolean).join(' · ')) + '</div></td>' +
            td((q.type || '') + (q.level ? ' · ' + q.level : '')) + td(q.telegram_username ? '@' + String(q.telegram_username).replace(/^@/, '') : '') +
            td((q.status || '') + (q.reviewer_name ? ' · ' + q.reviewer_name : '') + (q.rejection_reason ? ' · ' + q.rejection_reason : '')) +
            '<td style="white-space:nowrap">' + (q.status === 'pending' ? '<button class="pill sm" data-ok="' + q.id + '">' + esc(t('adm.approve')) + '</button> <button class="pill ghost sm" data-no="' + q.id + '">' + esc(t('adm.reject')) + '</button>' : '') + '</td></tr>';
        }));
        $$('[data-ok]', box).forEach(function (b) { b.onclick = async function () {
          if (!(await J.confirm(t('adm.approve.q'), t('adm.approve')))) return;
          busy(b, true); var x = await J.api('/api/registration-requests/' + b.dataset.ok + '/approve', { method: 'POST' });
          if (!x.ok) { busy(b, false); return J.toast(J.errMsg(x.data)); }
          var c = x.data.credentials || {};
          J.toast(t('adm.done') + (c.username ? ': ' + c.username : '') + (x.data.telegramSent === false ? ' · Telegram ✕' : ''), 6000); again();
        }; });
        $$('[data-no]', box).forEach(function (b) { b.onclick = function () {
          var m = J.modal({ cls: 'sm', html: '<h2>' + esc(t('adm.reject')) + '</h2><div class="field" style="margin-top:14px"><label>' + esc(t('adm.reason')) + '</label><textarea class="inp rj"></textarea></div><button class="pill rj-go">' + esc(t('adm.reject')) + '</button>' });
          $('.rj-go', m.body).onclick = async function () {
            var reason = $('.rj', m.body).value.trim(); if (!reason) return;
            busy(this, true); var x = await J.api('/api/registration-requests/' + b.dataset.no + '/reject', { method: 'POST', body: { reason: reason } });
            if (!x.ok) { busy(this, false); return J.toast(J.errMsg(x.data)); }
            m.close(); J.toast(t('adm.done')); again();
          };
        }; });
      });
      // tarif berish
      var picked = null, qT;
      $('.g-q', body).oninput = function () {
        var q = this.value.trim(); clearTimeout(qT); var res = $('.g-res', body);
        if (q.length < 2) { res.innerHTML = ''; return; }
        qT = setTimeout(function () {
          J.api('/api/admin/tariff/users?q=' + encodeURIComponent(q)).then(function (r) {
            var us = r.ok ? (r.data.users || []) : [];
            res.innerHTML = us.length ? us.map(function (u) { return '<button type="button" class="chip" data-u="' + u.id + '" style="margin:0 6px 6px 0">' + esc((u.full_name || '') + ' @' + (u.username || '') + (u.tariff_plan ? ' · ' + u.tariff_plan : '')) + '</button>'; }).join('') : '<small class="muted">' + esc(t('adm.empty')) + '</small>';
            $$('[data-u]', res).forEach(function (c) { c.onclick = function () {
              picked = us.filter(function (u) { return String(u.id) === c.dataset.u; })[0];
              $$('[data-u]', res).forEach(function (x) { x.classList.toggle('on', x === c); });
              $('.g-who', body).textContent = picked ? (picked.full_name || '') + ' @' + picked.username : '';
              check();
            }; });
          });
        }, 300);
      };
      function check() { $('.g-go', body).disabled = !(picked && $('.g-ref', body).value.trim().length >= 4); }
      $('.g-ref', body).oninput = check;
      $('.g-go', body).onclick = async function () {
        var amt = $('.g-amt', body).value.replace(/\D/g, '');
        var payload = { adminId: picked.id, plan: $('.g-plan', body).value, paymentRef: $('.g-ref', body).value.trim(), provider: 'manual' };
        if (amt) payload.amountUzs = Number(amt);
        if (!(await J.confirm(t('adm.grant') + ': ' + (picked.full_name || picked.username) + ' · ' + payload.plan + ' · ' + payload.paymentRef + '?', t('adm.grant')))) return;
        busy(this, true); var x = await J.api('/api/admin/tariff/grant', { method: 'POST', body: payload }); busy(this, false);
        if (!x.ok) return J.toast(J.errMsg(x.data), 6000);
        J.toast(x.data.duplicate ? t('adm.grant.dup') : t('adm.grant.ok'), 5000);
        $('.g-ref', body).value = ''; check();
      };
    });
  }

  /* ---------- Sifat (javob xatolari) ---------- */
  var fbTab = 'new';
  function viewFb() {
    shell('sifat', function (body, again) {
      body.innerHTML = tabs([['new', t('adm.new')], ['reviewed', t('adm.reviewed')], ['dismissed', t('adm.dismissed')]], fbTab) + '<div class="fb-l">' + skel() + '</div>';
      $$('[data-tab]', body).forEach(function (b) { b.onclick = function () { fbTab = b.dataset.tab; again(); }; });
      J.api('/api/admin/answer-feedback?status=' + fbTab).then(function (r) {
        var box = $('.fb-l', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var list = r.data.feedback || [];
        box.innerHTML = list.length ? '<div style="display:flex;flex-direction:column;gap:10px">' + list.map(function (f) {
          return '<div class="card"><div class="tag">' + esc(dt(f.created_at) + ' · ' + (f.submitter_name || '') + ' · ' + (f.error_type || '') + ' · ' + (f.source || '')) + '</div>' +
            (f.question ? '<p style="margin-top:8px"><b style="font-weight:500">' + esc(f.question) + '</b></p>' : '') +
            '<p style="margin-top:8px"><span class="muted">«</span>' + esc(f.selected_text || '') + '<span class="muted">»</span></p>' +
            (f.suggestion ? '<p class="muted" style="margin-top:6px;font-size:14px">→ ' + esc(f.suggestion) + '</p>' : '') +
            '<div class="btns">' + (fbTab !== 'reviewed' ? '<button class="pill sm" data-s="reviewed" data-id="' + f.id + '">' + esc(t('adm.mark.rev')) + '</button>' : '') +
            (fbTab !== 'dismissed' ? '<button class="pill ghost sm" data-s="dismissed" data-id="' + f.id + '">' + esc(t('adm.mark.dis')) + '</button>' : '') +
            (fbTab !== 'new' ? '<button class="pill ghost sm" data-s="new" data-id="' + f.id + '">' + esc(t('adm.new')) + '</button>' : '') + '</div></div>';
        }).join('') + '</div>' : empty();
        $$('[data-s]', box).forEach(function (b) { b.onclick = async function () {
          busy(b, true); var x = await J.api('/api/admin/answer-feedback/' + b.dataset.id + '/status', { method: 'POST', body: { status: b.dataset.s } });
          if (!x.ok) { busy(b, false); return J.toast(J.errMsg(x.data)); } again();
        }; });
      });
    });
  }

  /* ---------- Tavsiya etilgan manbalar ---------- */
  var srcTab = 'pending', TOPICS = ['mehnat', 'fuqarolik', 'oila', 'jinoyat', 'mamuriy', 'mamuriy_huquq', 'soliq', 'uy-joy', 'tadbirkorlik', 'talim', 'boshqa'];
  function viewSrc() {
    shell('manbalar', function (body, again) {
      body.innerHTML = tabs([['pending', t('adm.pending')], ['ingested', t('adm.ingested')], ['rejected', t('adm.rejected')]], srcTab) + '<div class="sr-job"></div><div class="sr-l">' + skel() + '</div>';
      $$('[data-tab]', body).forEach(function (b) { b.onclick = function () { srcTab = b.dataset.tab; again(); }; });
      pollJob(body);
      J.api('/api/admin/suggested-sources?status=' + srcTab).then(function (r) {
        var box = $('.sr-l', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var list = r.data.suggestions || [], pend = srcTab === 'pending';
        box.innerHTML = (pend && list.length ? '<div class="filters"><button class="pill sm sr-batch" type="button" disabled>' + esc(t('adm.batch')) + '</button></div>' : '') +
          table([pend ? '' : '', t('adm.name'), t('adm.topic'), t('adm.times'), ''], list.map(function (s) {
            return '<tr>' + (pend ? '<td><input type="checkbox" class="sr-c" data-id="' + s.id + '"></td>' : '<td></td>') +
              '<td><a href="' + esc(s.lex_url || '#') + '" target="_blank" rel="noopener" style="text-decoration:underline;text-underline-offset:3px">' + esc(s.title || s.lex_url || '') + '</a>' +
              '<div class="tag" style="margin-top:4px">' + esc([s.legal_force, s.status_label, s.is_active === false ? '✕ active' : '', s.last_error].filter(Boolean).join(' · ')) + '</div>' +
              (s.sample_query ? '<div class="muted" style="font-size:12.5px;margin-top:4px">' + esc(s.sample_query) + '</div>' : '') + '</td>' +
              '<td>' + (pend ? '<select class="inp sr-t" data-id="' + s.id + '" style="min-width:140px">' + TOPICS.map(function (x) { return '<option' + (x === s.topic ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' : esc(s.topic || '')) + '</td>' +
              td(n0(s.times_suggested)) + '<td style="white-space:nowrap">' + (pend ? '<button class="pill sm" data-in="' + s.id + '">' + esc(t('adm.ingest')) + '</button> <button class="pill ghost sm" data-rj="' + s.id + '">' + esc(t('adm.reject')) + '</button>' : '') + '</td></tr>';
          }));
        J.selects(box);
        var topicOf = function (id) { var s = $('.sr-t[data-id="' + id + '"]', box); return s ? s.value : ''; };
        $$('[data-in]', box).forEach(function (b) { b.onclick = async function () {
          busy(b, true); var x = await J.api('/api/admin/suggested-sources/' + b.dataset.in + '/ingest', { method: 'POST', body: { topic: topicOf(b.dataset.in) } });
          if (!x.ok) { busy(b, false); return J.toast(J.errMsg(x.data), 6000); }
          J.toast((x.data.doc_name || t('adm.done')) + ' · ' + (x.data.chunks || 0) + ' chunk' + (x.data.embed_warning ? ' · ' + x.data.embed_warning : ''), 6000); again();
        }; });
        $$('[data-rj]', box).forEach(function (b) { b.onclick = async function () {
          busy(b, true); var x = await J.api('/api/admin/suggested-sources/' + b.dataset.rj + '/reject', { method: 'POST' });
          if (!x.ok) { busy(b, false); return J.toast(J.errMsg(x.data)); } again();
        }; });
        var bb = $('.sr-batch', box);
        if (bb) {
          $$('.sr-c', box).forEach(function (c) { c.onchange = function () { var n = $$('.sr-c:checked', box).length; bb.disabled = !n || n > 10; }; });
          bb.onclick = async function () {
            var items = $$('.sr-c:checked', box).map(function (c) { return { id: Number(c.dataset.id), topic: topicOf(c.dataset.id) }; });
            busy(bb, true); var x = await J.api('/api/admin/suggested-sources/ingest-batch', { method: 'POST', body: { items: items } });
            if (!x.ok) { busy(bb, false); return J.toast(J.errMsg(x.data)); }
            pollJob(body, again);
          };
        }
      });
    });
  }
  var jobTimer;
  function pollJob(body, done) {
    clearTimeout(jobTimer);
    J.api('/api/admin/suggested-sources/ingest-batch').then(function (r) {
      var box = $('.sr-job', body); if (!box || !document.body.contains(box)) return;
      var j = r.ok && r.data.job; if (!j) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="card" style="margin-bottom:14px"><div class="tag">' + (j.running ? '<span class="spin"></span>' + esc(t('adm.batch.run')) : esc(t('adm.done'))) + ' · ' + n0(j.done) + ' / ' + n0(j.total) + '</div>' +
        '<div style="margin-top:8px;font-size:13.5px">' + (j.items || []).map(function (i) { return '<div>' + esc((i.status === 'done' ? '✓ ' : i.status === 'error' ? '✕ ' : '… ') + (i.title || i.id) + (i.chunks ? ' · ' + i.chunks + ' chunk' : '') + (i.error ? ' · ' + i.error : '') + (i.warning ? ' · ' + i.warning : '')) + '</div>'; }).join('') + '</div></div>';
      if (j.running) jobTimer = setTimeout(function () { pollJob(body, done); }, 3000); else if (done) done();
    });
  }

  /* ---------- Korpus qamrovi va top savollar ---------- */
  var covDays = 30;
  function viewCov() {
    shell('korpus', function (body) {
      body.innerHTML = '<div class="filters"><select class="inp cv-d">' + [7, 30, 90, 180].map(function (d) { return '<option value="' + d + '"' + (d === covDays ? ' selected' : '') + '>' + d + ' ' + esc(t('adm.days')) + '</option>'; }).join('') + '</select>' +
        '<a class="pill ghost sm cv-csv" href="#" download>' + esc(t('adm.csv')) + '</a></div><div class="cv-b">' + skel() + '</div><h3 style="font-size:18px;margin:26px 0 12px">' + esc(t('adm.topq')) + '</h3><div class="tq-b">' + skel() + '</div>';
      J.selects(body);
      $('.cv-d', body).onchange = function () { covDays = Number(this.value); load(); };
      function load() {
        $('.cv-csv', body).href = '/api/admin/top-questions?format=csv&days=' + covDays;
        var a = $('.cv-b', body); a.innerHTML = skel();
        J.api('/api/admin/coverage-gaps?days=' + covDays).then(function (r) {
          if (!r.ok) { a.innerHTML = errBox(r); return; }
          var d = r.data, tt = d.totals || {};
          a.innerHTML = kv([[t('adm.requests'), n0(tt.total_queries)], [t('adm.weak'), n0(tt.weak_queries)], [t('adm.weak') + ' (uniq)', n0(tt.distinct_weak)], [t('adm.days'), n0(d.days)]]) +
            '<div class="grid2"><div>' + table([t('adm.topic'), t('adm.requests'), t('adm.weak'), 'avg law'], (d.byTopic || []).map(function (x) { return '<tr>' + td(x.topic || '—') + td(n0(x.total)) + td(n0(x.weak)) + td(Number(x.avg_law_chunks || 0).toFixed(1)) + '</tr>'; })) + '</div>' +
            '<div>' + table([t('adm.req'), t('adm.times')], (d.topQueries || []).map(function (x) { return '<tr><td>' + esc(x.query) + '<div class="tag">' + esc((x.topic || '') + ' · ' + dt(x.last_seen)) + '</div></td>' + td(n0(x.times)) + '</tr>'; })) + '</div></div>';
        });
        var b = $('.tq-b', body); b.innerHTML = skel();
        J.api('/api/admin/top-questions?perTopic=15&days=' + covDays).then(function (r) {
          if (!r.ok) { b.innerHTML = errBox(r); return; }
          var d = r.data, srcErr = Object.keys(d.sources || {}).filter(function (k) { return d.sources[k].error; });
          b.innerHTML = (d.note ? '<p class="note" style="margin:0 0 14px">' + esc(d.note) + '</p>' : '') +
            (srcErr.length ? '<p class="note warn" style="margin:0 0 14px">' + esc(srcErr.map(function (k) { return k + ': ' + d.sources[k].error; }).join(' · ')) + '</p>' : '') +
            ((d.topics || []).map(function (tp) {
              return '<h4 style="font-size:15px;font-weight:500;margin:18px 0 8px">' + esc(tp.topic) + ' <span class="muted num" style="font-size:13px">' + n0(tp.questions) + '</span></h4>' +
                table([t('adm.req'), t('adm.times'), 'web / tg', t('adm.weak')], (tp.top || []).map(function (q) {
                  return '<tr><td>' + esc(q.example) + (q.inBank ? '<div class="tag">' + esc(t('adm.inbank')) + ' #' + q.inBank.id + '</div>' : '') + '</td>' + td(n0(q.count)) + td(n0((q.channels || {}).web) + ' / ' + n0((q.channels || {}).telegram)) + td(q.weakShare == null ? '—' : Math.round(q.weakShare * 100) + '%') + '</tr>';
                }));
            }).join('') || empty()) +
            ((d.missingActs || []).length ? '<h4 style="font-size:15px;font-weight:500;margin:22px 0 8px">' + esc(t('adm.missing')) + '</h4>' + table([t('adm.name'), t('adm.topic'), t('adm.times')], d.missingActs.map(function (m) {
              return '<tr><td><a href="' + esc(m.url || '#') + '" target="_blank" rel="noopener" style="text-decoration:underline;text-underline-offset:3px">' + esc(m.title || m.url) + '</a></td>' + td(m.topic) + td(n0(m.timesSuggested)) + '</tr>';
            })) : '');
        });
      }
      load();
    });
  }

  /* ---------- Audit ---------- */
  function viewAudit() {
    shell('audit', function (body) {
      J.api('/api/admin/audit-log?limit=500').then(function (r) {
        if (!r.ok) { body.innerHTML = errBox(r); return; }
        var list = r.data.entries || [];
        body.innerHTML = '<div class="filters"><div class="search" style="flex:1;min-width:220px">' + J.icon('search') + '<input class="inp au-q" placeholder="' + esc(t('adm.filter')) + '"></div></div><div class="au-l"></div>';
        function draw(q) {
          q = (q || '').toLowerCase();
          var rows = list.filter(function (e) { return !q || [e.action, e.resource, e.full_name, e.ip, e.resource_id].join(' ').toLowerCase().indexOf(q) > -1; }).slice(0, 300);
          $('.au-l', body).innerHTML = table([t('adm.time'), t('adm.who'), t('adm.action'), t('adm.resource'), 'IP'], rows.map(function (e) {
            return '<tr>' + td(dt(e.created_at)) + td((e.full_name || '') + (e.role ? ' · ' + e.role : '')) + td(e.action) + td((e.resource || '') + (e.resource_id ? ' #' + e.resource_id : '')) + td(e.ip || '') + '</tr>';
          }));
        }
        $('.au-q', body).oninput = function () { draw(this.value); };
        draw('');
      });
    });
  }

  /* ---------- Landing ---------- */
  function viewLanding() {
    shell('landing', function (body) {
      J.api('/api/landing-config', { allow401: true }).then(function (r) {
        var cur = r.ok ? String(r.data.bg) : '0';
        body.innerHTML = '<div class="card"><h4>' + esc(t('adm.bg')) + '</h4><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">' +
          ['1', '2', '3', '5', '0'].map(function (k) { return '<button type="button" class="chip' + (k === cur ? ' on' : '') + '" data-bg="' + k + '">' + esc(t('adm.bg.' + k)) + '</button>'; }).join('') +
          '</div><div class="btns"><a class="pill ghost sm" href="/" target="_blank" rel="noopener">juristai.uz ↗</a></div></div>';
        $$('[data-bg]', body).forEach(function (b) { b.onclick = async function () {
          var x = await J.api('/api/admin/landing-config', { method: 'PUT', body: { bg: b.dataset.bg } });
          if (!x.ok) return J.toast(J.errMsg(x.data));
          $$('[data-bg]', body).forEach(function (c) { c.classList.toggle('on', c === b); }); J.toast(t('adm.saved'));
        }; });
      });
    });
  }

  /* ---------- Chegirmalar ---------- */
  var offTab = 'active';
  function viewOffers() {
    shell('chegirmalar', function (body, again) {
      body.innerHTML = '<div class="filters"><button class="pill sm of-new" type="button">' + esc(t('adm.offer.new')) + '</button></div>' +
        tabs([['active', t('adm.active')], ['draft', t('adm.draft')], ['redeemed', t('adm.redeemed')], ['expired', t('adm.expired')], ['revoked', t('adm.revoked')]], offTab) + '<div class="of-l">' + skel() + '</div>';
      $$('[data-tab]', body).forEach(function (b) { b.onclick = function () { offTab = b.dataset.tab; again(); }; });
      $('.of-new', body).onclick = function () { newOffer(again); };
      J.api('/api/admin/tariff/offers?status=' + offTab).then(function (r) {
        var box = $('.of-l', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var list = r.data.offers || [];
        box.innerHTML = table([t('adm.user'), t('adm.plan'), t('adm.final'), t('adm.reason'), t('adm.time'), ''], list.map(function (o) {
          return '<tr>' + td((o.full_name || '') + ' @' + (o.username || '')) + td(o.plan) + td(uzs(o.final_price_uzs) + ' (−' + uzs(o.discount_uzs) + ')') + td(o.reason || '') + td(o.expires_at ? '→ ' + dt(o.expires_at) : '') +
            '<td style="white-space:nowrap">' + (o.status === 'active' || o.status === 'draft' ? '<button class="pill sm" data-act="' + o.id + '">' + esc(t('adm.activate')) + '</button> <button class="pill ghost sm" data-rv="' + o.id + '">' + esc(t('adm.revoke')) + '</button>' : esc(o.payment_ref || '')) + '</td></tr>';
        }));
        $$('[data-rv]', box).forEach(function (b) { b.onclick = async function () {
          if (!(await J.confirm(t('adm.revoke') + '?', t('adm.revoke')))) return;
          var x = await J.api('/api/admin/tariff/offers/' + b.dataset.rv + '/revoke', { method: 'POST', body: { reason: 'master' } });
          if (!x.ok) return J.toast(J.errMsg(x.data)); again();
        }; });
        $$('[data-act]', box).forEach(function (b) { b.onclick = function () {
          var o = list.filter(function (x) { return String(x.id) === b.dataset.act; })[0];
          var m = J.modal({ cls: 'sm', html: '<h2>' + esc(t('adm.activate')) + '</h2><p class="sub">' + esc((o.full_name || o.username) + ' · ' + o.plan + ' · ' + uzs(o.final_price_uzs)) + '</p><div class="field" style="margin-top:14px"><label>' + esc(t('adm.payref')) + '</label><input class="inp a-ref" maxlength="120"></div><button class="pill a-go">' + esc(t('adm.activate')) + '</button>' });
          $('.a-go', m.body).onclick = async function () {
            var ref = $('.a-ref', m.body).value.trim(); if (ref.length < 4) return;
            busy(this, true);
            var x = await J.api('/api/admin/tariff/grant', { method: 'POST', body: { adminId: o.user_id, plan: o.plan, paymentRef: ref, offerId: o.id, provider: 'manual' } });
            if (!x.ok) { busy(this, false); return J.toast(J.errMsg(x.data), 6000); }
            m.close(); J.toast(x.data.duplicate ? t('adm.grant.dup') : t('adm.grant.ok')); again();
          };
        }; });
      });
    });
  }
  function newOffer(done) {
    var m = J.modal({ cls: 'sm', html: '<h2>' + esc(t('adm.offer.new')) + '</h2><div class="field" style="margin-top:14px"><input class="inp o-q" placeholder="' + esc(t('adm.search.user')) + '"><div class="o-res" style="margin-top:6px"></div></div>' +
      '<div class="grid2"><div class="field"><label>' + esc(t('adm.plan')) + '</label><select class="inp o-plan"><option>silver</option><option>gold</option><option>platinum</option></select></div><div class="field"><label>' + esc(t('adm.discount')) + '</label><input class="inp o-pct" inputmode="decimal" value="10"></div></div>' +
      '<div class="grid2"><div class="field"><label>' + esc(t('adm.validdays')) + '</label><input class="inp o-days" inputmode="numeric" value="7"></div><div class="field"><label>' + esc(t('adm.reason')) + '</label><input class="inp o-reason"></div></div>' +
      '<div class="o-quote"></div><div class="btns" style="display:flex;gap:8px;margin-top:10px"><button class="pill ghost o-qt" disabled>' + esc(t('adm.quote')) + '</button><button class="pill o-go" disabled>' + esc(t('adm.create')) + '</button></div>' });
    J.selects(m.body);
    var picked = null, qT;
    $('.o-q', m.body).oninput = function () {
      var q = this.value.trim(), res = $('.o-res', m.body); clearTimeout(qT); if (q.length < 2) { res.innerHTML = ''; return; }
      qT = setTimeout(function () { J.api('/api/admin/tariff/users?q=' + encodeURIComponent(q)).then(function (r) {
        var us = r.ok ? (r.data.users || []) : [];
        res.innerHTML = us.map(function (u) { return '<button type="button" class="chip" data-u="' + u.id + '" style="margin:0 6px 6px 0">' + esc((u.full_name || '') + ' @' + u.username) + '</button>'; }).join('') || '<small class="muted">' + esc(t('adm.empty')) + '</small>';
        $$('[data-u]', res).forEach(function (c) { c.onclick = function () { picked = Number(c.dataset.u); $$('[data-u]', res).forEach(function (x) { x.classList.toggle('on', x === c); }); $('.o-qt', m.body).disabled = false; }; });
      }); }, 300);
    };
    function body() { return { userId: picked, plan: $('.o-plan', m.body).value, discountPercent: Number(String($('.o-pct', m.body).value).replace(',', '.')) }; }
    $('.o-qt', m.body).onclick = async function () {
      var x = await J.api('/api/admin/tariff/offers/quote', { method: 'POST', body: body() }); var q = x.data || {};
      $('.o-quote', m.body).innerHTML = '<div class="note' + (q.ok ? '' : ' warn') + '">' + esc(q.message || '') + (q.finalPriceUzs != null ? '<br>' + esc(t('adm.final')) + ': <b class="num">' + esc(uzs(q.finalPriceUzs)) + '</b> · ' + esc(t('adm.minprice')) + ': ' + esc(uzs(q.minPriceUzs)) : '') + '</div>';
      $('.o-go', m.body).disabled = !q.ok;
    };
    $('.o-go', m.body).onclick = async function () {
      var b = body(); b.reason = $('.o-reason', m.body).value.trim(); b.validDays = Number($('.o-days', m.body).value) || 7;
      if (b.reason.length < 3) return J.toast(t('adm.reason') + '?');
      busy(this, true); var x = await J.api('/api/admin/tariff/offers', { method: 'POST', body: b });
      if (!x.ok) { busy(this, false); return J.toast(J.errMsg(x.data), 6000); }
      m.close(); J.toast(t('adm.done')); done();
    };
  }

  /* ---------- Telegram agent ---------- */
  var tgMode = '';
  function viewTg() {
    shell('telegram', function (body, again) {
      body.innerHTML = tabs([['', t('adm.all')], ['automatic', t('adm.auto')], ['human', t('adm.human')]], tgMode) + '<div class="tg-l">' + skel() + '</div><h3 style="font-size:18px;margin:26px 0 12px">' + esc(t('adm.hermes')) + '</h3><div class="hm-b">' + skel() + '</div>';
      $$('[data-tab]', body).forEach(function (b) { b.onclick = function () { tgMode = b.dataset.tab; again(); }; });
      J.api('/api/admin/telegram-conversations?limit=100' + (tgMode ? '&mode=' + tgMode : '')).then(function (r) {
        var box = $('.tg-l', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var list = r.data.items || [];
        box.innerHTML = table([t('adm.user'), t('adm.mode'), t('adm.status'), t('adm.time'), ''], list.map(function (c) {
          return '<tr>' + td((c.name || c.first_name || '') + (c.username ? ' @' + c.username : '') + ' · ' + c.chat_id) + td(c.mode === 'human' ? t('adm.human') : t('adm.auto')) +
            td([c.state, c.last_intent, c.language, c.open_requests ? c.open_requests + ' open' : ''].filter(Boolean).join(' · ')) + td(dt(c.updated_at)) +
            '<td><button class="pill ghost sm" data-chat="' + esc(c.chat_id) + '" data-to="' + (c.mode === 'human' ? 'automatic' : 'human') + '">' + esc(c.mode === 'human' ? t('adm.auto') : t('adm.human')) + '</button></td></tr>';
        }));
        $$('[data-chat]', box).forEach(function (b) { b.onclick = async function () {
          busy(b, true); var x = await J.api('/api/admin/telegram-conversations/' + encodeURIComponent(b.dataset.chat), { method: 'PATCH', body: { mode: b.dataset.to } });
          if (!x.ok) { busy(b, false); return J.toast(J.errMsg(x.data)); } again();
        }; });
      });
      J.api('/api/admin/hermes-shadow?days=7&limit=25').then(function (r) {
        var box = $('.hm-b', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var d = r.data, s = d.stats || {};
        box.innerHTML = '<p class="tag" style="margin-bottom:10px">' + esc([d.status, d.model, d.sampleRate != null ? 'sample ' + d.sampleRate : ''].filter(Boolean).join(' · ')) + '</p>' +
          kv([[t('adm.total'), n0(s.total)], [t('adm.agree'), s.agreement_rate == null ? '—' : Math.round(Number(s.agreement_rate)) + '%'], [t('adm.failed'), n0(s.failed)], [t('adm.cost'), usd(s.estimated_cost_usd)]]) +
          table([t('adm.time'), t('adm.req'), 'Prod', 'Hermes', t('adm.agree')], (d.items || []).map(function (i) {
            return '<tr>' + td(dt(i.created_at)) + td(i.message_preview) + td((i.production_action || '') + ' · ' + (i.production_intent || '')) + td((i.hermes_action || '') + ' · ' + (i.hermes_intent || '') + (i.error ? ' · ' + i.error : '')) + td(i.agreement ? '✓' : '✕') + '</tr>';
          }));
      });
    });
  }

  /* ---------- Advokatlar ---------- */
  function viewAtt() {
    shell('advokatlar', function (body, again) {
      J.api('/api/admin/attorneys').then(function (r) {
        if (!r.ok) { body.innerHTML = errBox(r); return; }
        var list = r.data.items || [];
        body.innerHTML = table([t('adm.name'), t('adm.license'), t('adm.published'), '', ''], list.map(function (a) {
          return '<tr><td>' + esc(a.full_name || '') + '<div class="tag">' + esc([a.organization_name, a.region, (a.practice_areas || []).map(function (p) { return p.name_uz; }).join(', ')].filter(Boolean).join(' · ')) + '</div></td>' +
            td((a.license_status || '') + (a.license_number ? ' · ' + a.license_number : '')) + td(a.is_published ? t('adm.yes') : t('adm.no')) + td('') +
            '<td><button class="pill ghost sm" data-ed="' + a.id + '">' + esc(t('adm.edit')) + '</button></td></tr>';
        }));
        $$('[data-ed]', body).forEach(function (b) { b.onclick = function () {
          var a = list.filter(function (x) { return String(x.id) === b.dataset.ed; })[0];
          var m = J.modal({ cls: 'sm', html: '<h2>' + esc(a.full_name || '') + '</h2>' +
            '<div class="field" style="margin-top:14px"><label>' + esc(t('adm.license')) + '</label><select class="inp e-ls">' + ['pending', 'active', 'suspended', 'expired', 'rejected'].map(function (s) { return '<option' + (s === a.license_status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>№</label><input class="inp e-ln" value="' + esc(a.license_number || '') + '"></div>' +
            '<div class="field"><label>Verification source</label><input class="inp e-vs" value="' + esc(a.verification_source || '') + '"></div>' +
            '<label style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><input type="checkbox" class="e-pub"' + (a.is_published ? ' checked' : '') + '> ' + esc(t('adm.published')) + '</label>' +
            '<button class="pill e-go">' + esc(t('adm.save')) + '</button>' });
          J.selects(m.body);
          $('.e-go', m.body).onclick = async function () {
            var payload = {
              full_name: a.full_name, license_number: $('.e-ln', m.body).value.trim() || null, license_status: $('.e-ls', m.body).value,
              verification_source: $('.e-vs', m.body).value.trim() || null, organization_name: a.organization_name, bio: a.bio, region: a.region, district: a.district,
              languages: a.languages || [], consultation_formats: a.consultation_formats || [], is_accepting_requests: a.is_accepting_requests,
              is_published: $('.e-pub', m.body).checked, practice_area_ids: (a.practice_areas || []).map(function (p) { return p.id; })
            };
            busy(this, true); var x = await J.api('/api/admin/attorneys/' + a.id, { method: 'PATCH', body: payload });
            if (!x.ok) { busy(this, false); return J.toast(J.errMsg(x.data), 6000); }
            m.close(); J.toast(t('adm.saved')); again();
          };
        }; });
      });
    });
  }

  /* ---------- Pullik xizmatlar ---------- */
  var ORDER_ST = ['pending_lawyer_review', 'approved_awaiting_payment', 'rejected', 'paid', 'in_progress', 'ready', 'delivered', 'cancelled'];
  function viewSvc() {
    shell('xizmatlar', function (body, again) {
      body.innerHTML = '<h3 style="font-size:18px;margin:0 0 12px">' + esc(t('adm.orders')) + '</h3><div class="so-l">' + skel() + '</div><h3 style="font-size:18px;margin:26px 0 12px">' + esc(t('adm.catalog')) + '</h3><div class="sc-l">' + skel() + '</div>';
      J.api('/api/admin/service-orders?limit=100').then(function (r) {
        var box = $('.so-l', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var list = r.data.items || [];
        box.innerHTML = table([t('adm.time'), t('adm.name'), t('adm.user'), t('adm.price'), t('adm.status')], list.map(function (o) {
          return '<tr>' + td(dt(o.created_at)) + td(o.service_name || '') + td((o.first_name || '') + (o.username ? ' @' + o.username : '')) +
            '<td><input class="inp so-p" data-id="' + o.id + '" inputmode="numeric" style="width:120px;height:34px" value="' + esc(o.quoted_price_minor != null ? o.quoted_price_minor : '') + '">' +
            (o.quoted_price_minor == null ? '' : '<div class="muted" style="font-size:12px;margin-top:4px;white-space:nowrap">' + (o.platform_fee_minor != null
              ? esc(t('adm.fee')) + ': ' + esc(o.platform_fee_minor) + ' (' + esc(Number(o.platform_fee_pct)) + '%) · ' + esc(t('adm.payout')) + ': ' + esc(o.lawyer_payout_minor)
              : esc(t('adm.fee.none'))) + '</div>') + '</td>' +
            '<td><select class="inp so-s" data-id="' + o.id + '" style="min-width:200px">' + ORDER_ST.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td></tr>';
        }));
        J.selects(box);
        // status or price: either change is saved (the lawyer field is kept by the server when not sent)
        function saveOrder(id) {
          var p = $('.so-p[data-id="' + id + '"]', box).value.replace(/\D/g, ''), st = $('.so-s[data-id="' + id + '"]', box).value;
          var payload = { status: st }; if (p) payload.quoted_price_minor = Number(p);
          return J.api('/api/admin/service-orders/' + id, { method: 'PATCH', body: payload }).then(function (x) {
            if (!x.ok) { J.toast(J.errMsg(x.data), 6000); again(); return; } J.toast(t('adm.saved')); again();
          });
        }
        $$('.so-s', box).forEach(function (s) { s.onchange = function () { saveOrder(s.dataset.id); }; });
        $$('.so-p', box).forEach(function (i) { i.onchange = function () { saveOrder(i.dataset.id); }; });
      });
      J.api('/api/admin/service-catalog').then(function (r) {
        var box = $('.sc-l', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var list = r.data.items || [];
        box.innerHTML = table([t('adm.name'), t('adm.price'), t('adm.active'), ''], list.map(function (c) {
          return '<tr><td><input class="inp sc-n" data-id="' + c.id + '" value="' + esc(c.name_uz || '') + '"></td>' +
            '<td><input class="inp sc-p" data-id="' + c.id + '" inputmode="numeric" style="width:140px" value="' + esc(c.price_minor != null ? c.price_minor : '') + '"></td>' +
            '<td><input type="checkbox" class="sc-a" data-id="' + c.id + '"' + (c.is_active ? ' checked' : '') + '></td>' +
            '<td><button class="pill ghost sm" data-sv="' + c.id + '">' + esc(t('adm.save')) + '</button></td></tr>';
        }));
        $$('[data-sv]', box).forEach(function (b) { b.onclick = async function () {
          var id = b.dataset.sv, c = list.filter(function (x) { return String(x.id) === id; })[0];
          var p = $('.sc-p[data-id="' + id + '"]', box).value.replace(/\D/g, '');
          var x = await J.api('/api/admin/service-catalog/' + id, { method: 'PUT', body: { name_uz: $('.sc-n[data-id="' + id + '"]', box).value.trim(), description_uz: c.description_uz, price_minor: p ? Number(p) : null, is_active: $('.sc-a[data-id="' + id + '"]', box).checked } });
          if (!x.ok) return J.toast(J.errMsg(x.data), 6000); J.toast(t('adm.saved'));
        }; });
      });
    });
  }

  /* ---------- Akkauntni o'chirish so'rovlari ---------- */
  var delTab = 'pending';
  function viewDel() {
    shell('ochirish', function (body, again) {
      body.innerHTML = tabs([['pending', t('adm.pending')], ['done', t('adm.done.t')], ['cancelled', t('adm.cancelled')]], delTab) + '<div class="dl-l">' + skel() + '</div>';
      $$('[data-tab]', body).forEach(function (b) { b.onclick = function () { delTab = b.dataset.tab; again(); }; });
      J.api('/api/admin/account-deletions?status=' + delTab).then(function (r) {
        var box = $('.dl-l', body); if (!r.ok) { box.innerHTML = errBox(r); return; }
        var list = r.data.requests || [];
        // the tab already says the status: the last column is the action (pending) or the reason (declined)
        box.innerHTML = table([t('adm.time'), t('adm.user'), 'Telegram', delTab === 'cancelled' ? t('adm.reason') : ''], list.map(function (q) {
          return '<tr>' + td(dt(q.created_at)) + td(q.admin_id ? (q.full_name || '') + ' @' + (q.username || '') + ' · #' + q.admin_id : '—') +
            td((q.tg_first_name || '') + (q.tg_username ? ' @' + q.tg_username : '') + ' · ' + (q.telegram_user_id || '')) +
            (q.status === 'pending' ? '<td style="white-space:nowrap"><button class="pill sm" data-go="' + q.id + '">' + esc(t('adm.del.go')) + '</button> <button class="pill ghost sm" data-no="' + q.id + '">' + esc(t('adm.reject')) + '</button></td>' : td(q.reason || (q.handled_at ? dt(q.handled_at) : ''))) + '</tr>';
        }));
        $$('[data-go]', box).forEach(function (b) { b.onclick = async function () {
          if (!(await J.confirm(t('adm.del.q'), t('adm.del.go')))) return;
          busy(b, true); var x = await J.api('/api/admin/account-deletions/' + b.dataset.go + '/complete', { method: 'POST' });
          if (!x.ok) { busy(b, false); return J.toast(J.errMsg(x.data), 6000); } J.toast(t('adm.done')); again();
        }; });
        $$('[data-no]', box).forEach(function (b) { b.onclick = function () {
          var m = J.modal({ cls: 'sm', html: '<h2>' + esc(t('adm.reject')) + '</h2><div class="field" style="margin-top:14px"><label>' + esc(t('adm.reason')) + '</label><textarea class="inp rj"></textarea></div><button class="pill rj-go">' + esc(t('adm.reject')) + '</button>' });
          $('.rj-go', m.body).onclick = async function () {
            var reason = $('.rj', m.body).value.trim(); if (reason.length < 3) return;
            busy(this, true); var x = await J.api('/api/admin/account-deletions/' + b.dataset.no + '/cancel', { method: 'POST', body: { reason: reason } });
            if (!x.ok) { busy(this, false); return J.toast(J.errMsg(x.data)); } m.close(); J.toast(t('adm.done')); again();
          };
        }; });
      });
    });
  }

  /* ---------- marshrutlar ---------- */
  var VIEWS = { ai: viewAi, qabul: viewReg, sifat: viewFb, manbalar: viewSrc, korpus: viewCov, audit: viewAudit, landing: viewLanding, chegirmalar: viewOffers, telegram: viewTg, advokatlar: viewAtt, xizmatlar: viewSvc, ochirish: viewDel };
  function guard(fn) { return function () { if (!J.isMaster()) { J.go('#/'); return; } fn.apply(null, arguments); }; }
  J.route(/^\/boshqaruv$/, guard(function () { J.viewAdmin(); }));
  J.route(/^\/boshqaruv\/([a-z]+)$/, guard(function (k) { (VIEWS[k] || J.viewAdmin)(); }));
})(window);
