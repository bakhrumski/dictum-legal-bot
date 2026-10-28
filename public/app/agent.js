/* Da'vo arizasi agenti (2026-10-21): bosqichma-bosqich ish oqimi — ma'lumotlar → lex.uz → huquqiy asos
   (so'zma-so'z iqtibos bilan) → loyiha → mexanik tekshiruv. Server: POST /api/agent/claim-draft
   (src/agents/agent-routes.js); 1 hujjat birligi faqat loyiha chiqqanda yechiladi. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;

  var S = {
    uz: {
      title: "Da’vo arizasi agenti", sub: "Agent ishni bosqichlarga bo‘lib bajaradi: faktlarni tekshiradi, lex.uz’dan qonunni qidiradi, har bir talab uchun moddani manbadan so‘zma-so‘z iqtibos bilan tanlaydi, loyihani yozadi va tekshiradi.",
      court: 'Sud (ma’lum bo‘lsa)', courtPh: 'Masalan: Toshkent shahar iqtisodiy sudi', pl: "Da’vogar", plPh: 'F.I.O. yoki tashkilot nomi', det: 'Manzil va aloqa', df: 'Javobgar',
      circ: "Nima bo‘ldi", circPh: "Voqealar, sanalar, shartnoma yoki harakat — batafsil (kamida 80 belgi)", dem: "Suddan nimani so‘raysiz", demPh: "Masalan: 12 000 000 so‘m avansni undirish",
      amount: "Da’vo summasi", ev: 'Dalillar', evPh: 'Shartnoma, to‘lov hujjati, yozishma…', run: 'Agentni ishga tushirish', cost: '1 hujjat birligi — faqat loyiha tayyor bo‘lsa yechiladi',
      working: 'Agent ishlamoqda… odatda 30–90 soniya', steps: ["Ma’lumotlarni tekshirish", 'Huquqiy masalalarni aniqlash', 'Qonunchilikni qidirish (lex.uz)', 'Huquqiy asosni tanlash va iqtiboslarni tekshirish', "Da’vo arizasini yozish", 'Loyihani tekshirish (mexanik)'],
      missing: "Yetishmayotgan ma’lumotlar", basis: 'Huquqiy asos (manbada tasdiqlangan iqtiboslar)', noBasis: 'Tasdiqlangan asos topilmadi — moddalarni yurist bilan aniqlang.',
      dropped: '{n} ta iqtibos manbada so‘zma-so‘z topilmadi va ishlatilmadi.', warn: 'Tekshiring', draft: 'Loyiha', word: 'Word yuklab olish', again: 'Yangi ariza', fail: "Loyihani tayyorlab bo‘lmadi; birlik qaytarildi.",
      nounit: "Hujjat tayyorlash birligi qolmagan. Tarif tanlang yoki Telegram botda bitta loyihani alohida sotib oling.", plans: 'Tariflar', note: 'Bu AI loyiha: yuridik xulosa emas. Imzolashdan oldin yurist bilan tekshiring.', entry: 'Agent bilan tayyorlash'
    },
    ru: {
      title: 'Агент: исковое заявление', sub: 'Агент работает по шагам: проверяет факты, ищет закон на lex.uz, подбирает статьи с дословными цитатами из источника, пишет проект и проверяет его.',
      court: 'Суд (если известен)', courtPh: 'Например: экономический суд г. Ташкента', pl: 'Истец', plPh: 'Ф.И.О. или название организации', det: 'Адрес и контакты', df: 'Ответчик',
      circ: 'Что произошло', circPh: 'События, даты, договор или действие — подробно (не менее 80 знаков)', dem: 'Что вы просите у суда', demPh: 'Например: взыскать аванс 12 000 000 сум',
      amount: 'Сумма иска', ev: 'Доказательства', evPh: 'Договор, платёжный документ, переписка…', run: 'Запустить агента', cost: '1 единица документа — списывается только если проект готов',
      working: 'Агент работает… обычно 30–90 секунд', steps: ['Проверка данных', 'Определение правовых вопросов', 'Поиск законодательства (lex.uz)', 'Выбор правового основания и проверка цитат', 'Составление искового заявления', 'Проверка проекта (механическая)'],
      missing: 'Не хватает данных', basis: 'Правовое основание (цитаты подтверждены в источнике)', noBasis: 'Подтверждённое основание не найдено — уточните статьи с юристом.',
      dropped: '{n} цитат не найдено в источнике дословно — они не использованы.', warn: 'Проверьте', draft: 'Проект', word: 'Скачать Word', again: 'Новое заявление', fail: 'Не удалось подготовить проект; единица возвращена.',
      nounit: 'Единицы на документы закончились. Выберите тариф или купите один проект в Telegram-боте.', plans: 'Тарифы', note: 'Это AI-проект, не юридическое заключение. Перед подписанием проверьте у юриста.', entry: 'Подготовить с агентом'
    }
  };
  function s(k) { var d = S[J.lang] || S.uz; return d[k] !== undefined ? d[k] : S.uz[k]; }
  J.agentText = s;

  J.viewAgentClaim = function () {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><div class="kicker">AI · lex.uz</div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('sub')) + '</p></div></div><div class="ag-body"></div></div>');
    var body = $('.ag-body', v);
    var last = {};

    function field(key, label, ph, area) {
      return '<div class="field"><label>' + esc(label) + '</label>' + (area
        ? '<textarea class="inp" data-f="' + key + '" rows="4" placeholder="' + esc(ph || '') + '"></textarea>'
        : '<input class="inp" data-f="' + key + '" placeholder="' + esc(ph || '') + '">') + '</div>';
    }
    function form() {
      body.innerHTML = '<div class="card">' +
        field('court', s('court'), s('courtPh')) +
        '<div class="grid2">' + field('pl', s('pl'), s('plPh')) + field('pld', s('det')) + '</div>' +
        '<div class="grid2">' + field('df', s('df'), s('plPh')) + field('dfd', s('det')) + '</div>' +
        field('circ', s('circ'), s('circPh'), true) + field('dem', s('dem'), s('demPh'), true) +
        '<div class="grid2">' + field('amount', s('amount')) + field('ev', s('ev'), s('evPh')) + '</div>' +
        '<div class="ag-miss"></div>' +
        '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:6px"><button class="pill" data-a="run">' + esc(s('run')) + '<i>→</i></button><span class="muted" style="font-size:13px">' + esc(s('cost')) + '</span></div></div>';
      Object.keys(last).forEach(function (k) { var el = $('[data-f=' + k + ']', body); if (el) el.value = last[k]; });
      $('[data-a=run]', body).onclick = run;
    }
    function val(k) { var el = $('[data-f=' + k + ']', body); return el ? el.value.trim() : ''; }

    function progress() {
      return '<div class="card ag-prog"><p class="muted" style="font-size:14px;margin-bottom:12px">' + esc(s('working')) + '</p><ol class="ag-steps">' +
        s('steps').map(function (x, i) { return '<li class="' + (i === 0 ? 'cur' : '') + '"><span class="ag-dot"></span>' + esc(x) + '</li>'; }).join('') + '</ol></div>';
    }

    async function run() {
      ['court', 'pl', 'pld', 'df', 'dfd', 'circ', 'dem', 'amount', 'ev'].forEach(function (k) { last[k] = val(k); });
      var payload = { court: last.court, plaintiff: { name: last.pl, details: last.pld }, defendant: { name: last.df, details: last.dfd },
        circumstances: last.circ, demands: last.dem, amount: last.amount, evidence: last.ev, lang: J.lang === 'ru' ? 'ru' : 'uz' };
      body.innerHTML = progress();
      // the server runs the steps in one request; the list advances as a guide, the real trace replaces it
      var i = 0, lis = $$('.ag-steps li', body);
      var tick = setInterval(function () { if (i < lis.length - 1) { lis[i].className = 'done'; i++; lis[i].className = 'cur'; } }, 9000);
      // a long queue answers 202 { runId }: J.agentApi follows the run to its end (matters.js)
      var r = await (J.agentApi || J.api)('/api/agent/claim-draft', { method: 'POST', body: payload });
      clearInterval(tick);
      if (r.status === 422 && r.data && r.data.missing) {
        form();
        $('.ag-miss', body).innerHTML = '<div class="note-blue" style="margin:4px 0 14px"><b>' + esc(s('missing')) + '</b><ul>' + r.data.missing.map(function (m) { return '<li>' + esc(m.question) + '</li>'; }).join('') + '</ul></div>';
        return;
      }
      if (r.status === 402) {
        body.innerHTML = '<div class="card"><p>' + esc(s('nounit')) + '</p><a class="pill" href="/tariff.html">' + esc(s('plans')) + '<i>→</i></a></div>';
        return;
      }
      result(r.data || {}, r.ok);
    }

    function result(d, ok) {
      var trace = '<ol class="ag-steps">' + (d.trace || []).map(function (x) {
        var cls = x.status === 'ok' ? 'done' : (x.status === 'skipped' ? 'skip' : 'bad');
        return '<li class="' + cls + '"><span class="ag-dot"></span><span style="flex:1">' + esc(x.label || x.id) + (x.note ? '<small class="muted"> — ' + esc(x.note) + '</small>' : '') + (x.error ? '<small class="err"> — ' + esc(x.error) + '</small>' : '') + '</span><small class="muted">' + (x.ms != null ? (x.ms / 1000).toFixed(1) + ' s' : '') + '</small></li>';
      }).join('') + '</ol>';
      var html = '<div class="card" style="margin-bottom:18px">' + trace + '</div>';
      if (!ok || !d.draftHtml) {
        body.innerHTML = html + '<div class="card"><p class="err">' + esc(d.message || s('fail')) + '</p><button class="pill ghost" data-a="back">' + esc(s('again')) + '</button></div>';
        $('[data-a=back]', body).onclick = form;
        return;
      }
      var basis = (d.basis || []).length
        ? '<ul class="ag-basis">' + d.basis.map(function (b) {
          return '<li><b>' + esc(b.act) + (b.article ? ', ' + esc(b.article) + '-modda' : '') + '</b>' + (b.url ? ' <a href="' + esc(b.url) + '" target="_blank" rel="noopener">lex.uz ↗</a>' : '') +
            '<blockquote>«' + esc(b.quote) + '»</blockquote><small class="muted">' + esc(b.demand) + '</small></li>';
        }).join('') + '</ul>'
        : '<p class="muted">' + esc(s('noBasis')) + '</p>';
      if (d.droppedQuotes) basis += '<p class="muted" style="font-size:13px">' + esc(s('dropped').replace('{n}', d.droppedQuotes)) + '</p>';
      var warn = (d.warnings || []).length ? '<div class="note-blue" style="margin-bottom:18px"><b>' + esc(s('warn')) + '</b><ul>' + d.warnings.map(function (w) { return '<li>' + esc(w.text) + '</li>'; }).join('') + '</ul></div>' : '';
      body.innerHTML = html + warn +
        '<div class="card" style="margin-bottom:18px"><h4>' + esc(s('basis')) + '</h4>' + basis + '</div>' +
        '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px"><h4 style="margin:0">' + esc(s('draft')) + '</h4><div style="display:flex;gap:8px"><button class="pill sm" data-a="word">' + J.icon('word') + esc(s('word')) + '</button>' + (J.wsSaveButton ? J.wsSaveButton() : '') + (d.runId && J.matterButton ? J.matterButton() : '') + '<button class="pill sm ghost" data-a="back">' + esc(s('again')) + '</button></div></div>' +
        '<div class="ag-doc doc-prev"></div><p class="muted" style="font-size:12.5px;margin-top:12px">' + esc(s('note')) + '</p></div>';
      $('.ag-doc', body).innerHTML = d.draftHtml; // sanitized on the server (src/rag/safe-html.js)
      $('[data-a=word]', body).onclick = function () { J.exportWord(s('title'), d.draftHtml); };
      var ws = $('[data-a=wssave]', body);
      if (ws) ws.onclick = function () {
        var plain = String(d.draftHtml).replace(/<\/(p|h\d|li|div)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        var basisText = (d.basis || []).map(function (b) { return '• ' + b.act + (b.article ? ', ' + b.article + '-modda' : '') + ': «' + b.quote + '»'; }).join('\n');
        J.saveToWorkspace({ title: s('title') + (last.df ? ' — ' + last.df : ''), text: plain + (basisText ? '\n\n' + s('basis') + ':\n' + basisText : '') + '\n\n' + s('note'),
          json: { type: 'claim_draft', draftHtml: d.draftHtml, basis: d.basis || [], warnings: d.warnings || [] } });
      };
      if (J.wireMatterButton) J.wireMatterButton(body, function () { return { kind: 'agent_run', ref: d.runId, title: s('title') + (last.df ? ' — ' + last.df : '') }; });
      $('[data-a=back]', body).onclick = function () { last = {}; form(); };
      if (J.refreshTariff) J.refreshTariff();
    }

    form();
  };

  J.route(/^\/agent\/dava$/, function () { J.viewAgentClaim(); });
})(window);
