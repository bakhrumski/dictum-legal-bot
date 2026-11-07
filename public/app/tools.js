/* U4 (docs/design/ux-audit-2026-11.md): menyuda 5 band (Savol, Hujjatlar, Ishlar, Asboblar, Advokatlar), qolgan har bir
   imkoniyat "Asboblar" sahifasida - kartochka: nima qiladi, misol, narx. Hech bir bo'lim o'chirilmadi: eski havolalar
   (#/tahlil, #/jadval, #/playbook ...) ishlaydi. Rol ko'rinishi (Fuqaro, Yurist ...) kartalar tartibini o'zgartiradi.
   Telefonda pastda 4 tugma: Savol, Hujjatlar, Ishlar, Ko'proq. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { title: 'Asboblar', lead: 'Platformaning barcha imkoniyatlari shu yerda. Narx — tarifingizdagi birliklarda; pullik ish boshlanishidan oldin narxi ko‘rsatiladi.',
      eg: 'Misol', lock: 'Silver tarifidan', notInPlan: 'Tarifingizda yo‘q', more: 'Ko‘proq',
      unit: '1 birlik = 10 sahifagacha',
      t: {
        tahlil: ['Hujjat tahlili', 'Shartnoma yoki arizani yuklang: oddiy tilda tushuntirish, xavflar yoki yuridik xulosa.', 'Ijara shartnomasidagi xavfli bandlar', 'hujjat hajmiga qarab birlik'],
        tayyorlash: ['Hujjat tayyorlash', 'Namunadan yoki AI bilan ariza, shartnoma, bayonnoma.', 'Ishdan bo‘shash haqida ariza', '1 hujjat'],
        dava: ['Da’vo arizasi', 'Faktlarni yozasiz — lex.uz asosida da’vo arizasi loyihasi va tekshiruv.', 'Qarzni undirish haqida da’vo', '1 hujjat'],
        jadval: ['Ko‘p hujjatni solishtirish', 'Bir nechta hujjat bir jadvalda: har hujjat — qator, har savol — ustun.', '20 ta shartnomada muddat va jarima', 'har hujjatga 1 savol'],
        playbook: ['Firma qoidalari bilan tekshirish', 'Shartnoma sizning shartlaringizga mos-mosmasligi, tuzatish taklifi bilan.', 'Yetkazib berish shartnomasini firma qoidasiga solish', 'hujjat hajmiga qarab birlik'],
        firma: ['Firma bazasi', 'Firmangiz hujjatlaridan band qidirish va AI javobida foydalanish.', '“Fors-major” bandi bizning shartnomalarda', 'bepul'],
        konikmalar: ['Tayyor buyruqlar', 'Tez-tez beradigan topshiriqlaringizni bir marta yozib, «/» bilan chaqirasiz.', '/xavf — shartnomani xavf bo‘yicha ko‘rish', 'savol narxida'],
        yozuvlar: ['Ovozli yozuvlar', 'Uchrashuvni yozib oling — matn, xulosa va topshiriqlar.', 'Mijoz bilan 20 daqiqalik suhbat', 'hozircha bepul'],
        jamoa: ['Jamoa', 'Vazifalar, hujjatlar va xabarlar hamkasblar bilan bitta joyda.', 'Ish bo‘yicha vazifani yordamchiga berish', 'Silver tarifidan'],
        moslashish: ['Moslashish', 'Javob uzunligi, alifbo va ma’lumotingiz qaysi AI’ga borishini o‘zingiz tanlaysiz.', 'Javoblar qisqa bo‘lsin', 'bepul']
      } },
    ru: { title: 'Инструменты', lead: 'Все возможности платформы здесь. Цена — в единицах тарифа; перед платной работой цена показывается.',
      eg: 'Пример', lock: 'С тарифа Silver', notInPlan: 'Нет в вашем тарифе', more: 'Ещё',
      unit: '1 единица = до 10 страниц',
      t: {
        tahlil: ['Анализ документа', 'Загрузите договор или заявление: простое объяснение, риски или заключение.', 'Опасные пункты договора аренды', 'единицы по объёму'],
        tayyorlash: ['Подготовка документа', 'Заявление, договор, протокол — по образцу или с AI.', 'Заявление об увольнении', '1 документ'],
        dava: ['Исковое заявление', 'Вы описываете факты — проект иска на основе lex.uz и проверка.', 'Иск о взыскании долга', '1 документ'],
        jadval: ['Сравнение нескольких документов', 'Несколько документов в одной таблице: документ — строка, вопрос — столбец.', 'Сроки и штрафы в 20 договорах', '1 вопрос за документ'],
        playbook: ['Проверка по правилам фирмы', 'Соответствует ли договор вашим условиям, с предложением правки.', 'Договор поставки по правилам фирмы', 'единицы по объёму'],
        firma: ['База фирмы', 'Поиск пунктов в документах фирмы и их использование в ответах AI.', 'Пункт о форс-мажоре в наших договорах', 'бесплатно'],
        konikmalar: ['Готовые команды', 'Частые задания пишете один раз и вызываете через «/».', '/риск — проверить договор на риски', 'по цене вопроса'],
        yozuvlar: ['Аудиозаписи', 'Запишите встречу — текст, итоги и задачи.', 'Разговор с клиентом на 20 минут', 'пока бесплатно'],
        jamoa: ['Команда', 'Задачи, документы и сообщения с коллегами в одном месте.', 'Поручить задачу по делу помощнику', 'С тарифа Silver'],
        moslashish: ['Настройки', 'Длина ответа, алфавит и какому AI уходят ваши данные — выбираете вы.', 'Короткие ответы', 'бесплатно']
      } },
    en: { title: 'Tools', lead: 'Everything the platform does is here. Prices are in your plan’s units; a paid job shows its price before it starts.',
      eg: 'Example', lock: 'From the Silver plan', notInPlan: 'Not in your plan', more: 'More',
      unit: '1 unit = up to 10 pages',
      t: {
        tahlil: ['Document review', 'Upload a contract or application: plain explanation, risks or a legal opinion.', 'Risky clauses in a lease', 'units by size'],
        tayyorlash: ['Drafting', 'Application, contract, minutes — from a template or with AI.', 'A resignation letter', '1 document'],
        dava: ['Statement of claim', 'You write the facts — a claim draft based on lex.uz, checked.', 'A claim to recover a debt', '1 document'],
        jadval: ['Compare many documents', 'Several documents in one table: a row per document, a column per question.', 'Terms and penalties across 20 contracts', '1 question per document'],
        playbook: ['Check against firm rules', 'Whether a contract meets your terms, with proposed wording.', 'A supply contract against the firm’s rules', 'units by size'],
        firma: ['Firm knowledge base', 'Find clauses in your firm’s documents and use them in AI answers.', 'Our force majeure clause', 'free'],
        konikmalar: ['Ready prompts', 'Write a frequent task once and call it with “/”.', '/risk — review a contract for risks', 'priced as a question'],
        yozuvlar: ['Voice notes', 'Record a meeting — text, summary and tasks.', 'A 20-minute client call', 'free for now'],
        jamoa: ['Team', 'Tasks, documents and messages with colleagues in one place.', 'Give a matter task to an assistant', 'From the Silver plan'],
        moslashish: ['Preferences', 'Answer length, alphabet and which AI gets your data — your choice.', 'Shorter answers', 'free']
      } }
  };
  function s(k) { var d = S[J.lang] || S.uz; return d[k] !== undefined ? d[k] : S.uz[k]; }
  J.toolsText = s;

  // every tool, its page and icon; a role view puts its own sections first (core.js J.ROLE_VIEWS)
  var TOOLS = [
    ['tahlil', '#/tahlil', 'scan'], ['tayyorlash', '#/tayyorlash', 'pen'], ['dava', '#/agent/dava', 'flag'], ['jadval', '#/jadval', 'copy'],
    ['playbook', '#/playbook', 'check'], ['firma', '#/firma', 'layers'], ['konikmalar', '#/konikmalar', 'spark'], ['yozuvlar', '#/yozuvlar', 'mic'],
    ['jamoa', '#/jamoa', 'team'], ['moslashish', '#/moslashish', 'user']
  ];
  /** The routes that belong to "Asboblar" (the menu marks it while one of them is open). */
  J.TOOL_ROUTES = TOOLS.map(function (x) { return x[1]; }).concat(['#/agent']);
  function locked(k) {
    if (J.isStaff()) return false;
    if (k === 'tayyorlash' || k === 'dava') return !J.hasService('draft') && !J.needsPlan() && !(J.trialWaiting && J.trialWaiting());
    if (k === 'jamoa' || k === 'firma') return /^(sinov|none)$/.test(J.planKey());
    return false;
  }
  function ordered() {
    var rv = J.roleView ? J.roleView() : null, first = rv && J.ROLE_VIEWS[rv] ? J.ROLE_VIEWS[rv].nav : [];
    var rank = function (x) { var i = first.indexOf(x[1]); return i < 0 ? 100 + TOOLS.indexOf(x) : i; };
    return TOOLS.slice().sort(function (a, b) { return rank(a) - rank(b); });
  }

  J.viewTools = function () {
    J.setTitle(s('title'));
    var T = s('t');
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('lead')) + '</p></div></div><div class="tl-grid"></div>' +
      '<p class="muted tl-unit">' + esc(s('unit')) + '</p></div>');
    $('.tl-grid', v).innerHTML = ordered().map(function (x) {
      var k = x[0], d = T[k], lk = locked(k);
      return '<a class="tl-card" href="' + x[1] + '"><span class="tl-ic">' + J.icon(x[2]) + '</span><span class="tl-t"><b>' + esc(d[0]) + (lk ? ' <span class="lock">' + J.icon('lock') + '</span>' : '') + '</b>' +
        '<small>' + esc(d[1]) + '</small><span class="tl-eg"><i>' + esc(s('eg')) + ':</i> ' + esc(d[2]) + '</span></span><span class="tl-price">' + esc(lk ? (/^(sinov|none)$/.test(J.planKey()) ? s('lock') : s('notInPlan')) : d[3]) + '</span></a>';
    }).join('');
  };
  J.route(/^\/asboblar$/, function () { J.viewTools(); });

  /* ---------- telefon: pastki panel ---------- */
  var BOTTOM = [['#/', 'chat', 'nav.ask'], ['#/hujjatlarim', 'doc', 'nav.docs'], ['#/ishlar', 'folder', 'nav.matters']];
  J.drawBottomNav = function () {
    var bar = document.getElementById('bnav');
    if (!bar) { bar = J.h('<nav class="bnav" id="bnav" aria-label="Menu"></nav>'); document.body.appendChild(bar); }
    bar.innerHTML = BOTTOM.map(function (b) { return '<a href="' + b[0] + '" data-r="' + b[0] + '">' + J.icon(b[1]) + '<span>' + esc(J.t(b[2])) + '</span></a>'; }).join('') +
      '<button type="button" data-a="more">' + J.icon('more') + '<span>' + esc(s('more')) + '</span></button>';
    $('[data-a=more]', bar).onclick = function (e) { e.stopPropagation(); document.body.classList.toggle('nav-open'); };
    J.markBottomNav();
  };
  J.markBottomNav = function () {
    var h = location.hash || '#/';
    $$('#bnav a').forEach(function (a) {
      var r = a.dataset.r;
      a.classList.toggle('on', r === '#/' ? (h === '#/' || h === '' || h === '#' || /^#\/c\//.test(h)) : h.indexOf(r) === 0);
    });
  };
})(window);
