/* Playbook (2026-10-22): shartnomani firmaning o'z qoidalari bilan solishtirish — qonun bilan emas.
   Server: GET/POST/PUT/DELETE /api/playbooks, POST /api/agent/playbook-review (src/agents/agent-routes.js),
   POST /api/analyze/extract (shartnoma matni). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;

  var S = {
    uz: {
      title: 'Playbook bo‘yicha tekshiruv', sub: 'Shartnomani firmangizning o‘z qoidalari bilan solishtiring: qaysi band talabga mos, qaysi biri farq qiladi yoki yo‘q — va o‘rniga taklif matni.',
      pick: '1. Playbook tanlang', builtin: 'Tayyor', mine: 'Meniki', newPb: 'Yangi playbook', copy: 'Nusxa olib tahrirlash', edit: 'Tahrirlash', del: 'O‘chirish', rules: 'qoida',
      doc: '2. Shartnomani yuklang', upload: 'PDF, DOCX yoki skan tanlash', reading: 'O‘qilmoqda…', scanned: 'Skan hujjat — hozircha qo‘llab-quvvatlanmaydi', bad: 'Faylni o‘qib bo‘lmadi',
      run: 'Solishtirish', cost: 'Tahlil birligi shartnoma hajmiga qarab (40 000 belgigacha — 1 birlik); faqat natija chiqsa yechiladi.',
      working: 'Shartnoma qoidalar bilan solishtirilmoqda…', need: 'Playbook tanlang va shartnoma yuklang',
      st: { mos: 'Mos', farq: 'Farq qiladi', yoq: 'Band yo‘q', noaniq: 'Noaniq' }, sev: { high: 'Muhim', medium: 'O‘rta', low: 'Past' },
      quote: 'Shartnomadan', page: 'sahifa', verified: 'Iqtibos shartnomada topildi', unverified: 'Iqtibos shartnomada so‘zma-so‘z topilmadi', suggestion: 'Taklif matni', copyTxt: 'Nusxa olish',
      word: 'Word hisobot', again: 'Boshqa shartnoma', part: 'Uzun shartnoma: qoidalarga mos qismlar o‘qildi.',
      note: 'Bu firma qoidalari bilan solishtirish — yuridik xulosa emas. “Mos” faqat shartnoma matnidan iqtibos topilganda ko‘rsatiladi.',
      eName: 'Nomi', eDesc: 'Izoh', eRule: 'Qoida', eTitle: 'Qisqa nomi', eReq: 'Talab — shartnomada nima bo‘lishi kerak', eSev: 'Muhimligi', ePref: 'Afzal matn (ixtiyoriy)', eAdd: 'Qoida qo‘shish', save: 'Saqlash', cancel: 'Bekor qilish',
      delQ: 'Playbookni o‘chirasizmi?', nounit: 'Tahlil birligi yetarli emas', plans: 'Tariflar', entry: 'Playbook: firma qoidalari bilan tekshiruv', open: 'Ochish'
    },
    ru: {
      title: 'Проверка по плейбуку', sub: 'Сравните договор с правилами вашей фирмы: какой пункт соответствует, какой отличается или отсутствует — и предложенная формулировка.',
      pick: '1. Выберите плейбук', builtin: 'Готовые', mine: 'Мои', newPb: 'Новый плейбук', copy: 'Скопировать и изменить', edit: 'Изменить', del: 'Удалить', rules: 'правил',
      doc: '2. Загрузите договор', upload: 'Выбрать PDF, DOCX или скан', reading: 'Читается…', scanned: 'Скан — пока не поддерживается', bad: 'Не удалось прочитать файл',
      run: 'Сравнить', cost: 'Единицы анализа по объёму договора (до 40 000 знаков — 1); списываются только при результате.',
      working: 'Договор сравнивается с правилами…', need: 'Выберите плейбук и загрузите договор',
      st: { mos: 'Соответствует', farq: 'Отличается', yoq: 'Нет пункта', noaniq: 'Неясно' }, sev: { high: 'Важно', medium: 'Средне', low: 'Низко' },
      quote: 'Из договора', page: 'стр.', verified: 'Цитата найдена в договоре', unverified: 'Цитата не найдена дословно', suggestion: 'Предлагаемая формулировка', copyTxt: 'Копировать',
      word: 'Отчёт Word', again: 'Другой договор', part: 'Длинный договор: прочитаны части по правилам.',
      note: 'Это сравнение с правилами фирмы, а не юридическое заключение. «Соответствует» показывается только при найденной цитате из договора.',
      eName: 'Название', eDesc: 'Описание', eRule: 'Правило', eTitle: 'Краткое название', eReq: 'Требование — что должно быть в договоре', eSev: 'Важность', ePref: 'Желаемая формулировка (необязательно)', eAdd: 'Добавить правило', save: 'Сохранить', cancel: 'Отмена',
      delQ: 'Удалить плейбук?', nounit: 'Недостаточно единиц анализа', plans: 'Тарифы', entry: 'Плейбук: проверка по правилам фирмы', open: 'Открыть'
    }
  };
  function s(k) { var d = S[J.lang] || S.uz; return d[k] !== undefined ? d[k] : S.uz[k]; }
  J.playbookText = s;

  J.viewPlaybook = function () {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><div class="kicker">AI · Playbook</div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('sub')) + '</p></div></div><div class="pb-body"></div></div>');
    var body = $('.pb-body', v);
    var data = { builtin: [], mine: [] }, chosen = null, doc = null;

    async function load() {
      var r = await J.api('/api/playbooks');
      data = r.ok ? r.data : { builtin: [], mine: [] };
      setup();
    }
    function card(p, kind) {
      var on = chosen && chosen.kind === kind && String(chosen.id) === String(kind === 'b' ? p.key : p.id);
      return '<div class="pb-card' + (on ? ' on' : '') + '" data-k="' + kind + '" data-id="' + esc(kind === 'b' ? p.key : p.id) + '"><b>' + esc(p.name) + '</b><small>' + esc(p.description || '') + '</small>' +
        '<span class="pb-meta">' + (p.rules || []).length + ' ' + esc(s('rules')) + '</span><span class="pb-acts">' +
        (kind === 'b' ? '<button type="button" class="chip" data-a="copy">' + esc(s('copy')) + '</button>' : '<button type="button" class="chip" data-a="edit">' + esc(s('edit')) + '</button><button type="button" class="chip" data-a="del">' + esc(s('del')) + '</button>') + '</span></div>';
    }
    function setup() {
      body.innerHTML = '<div class="card" style="margin-bottom:18px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px"><h4 style="margin:0">' + esc(s('pick')) + '</h4><button class="pill sm ghost" data-a="new" type="button">+ ' + esc(s('newPb')) + '</button></div>' +
        (data.mine.length ? '<p class="muted pb-gh">' + esc(s('mine')) + '</p><div class="pb-grid">' + data.mine.map(function (p) { return card(p, 'm'); }).join('') + '</div>' : '') +
        '<p class="muted pb-gh">' + esc(s('builtin')) + '</p><div class="pb-grid">' + data.builtin.map(function (p) { return card(p, 'b'); }).join('') + '</div></div>' +
        '<div class="card"><h4>' + esc(s('doc')) + '</h4><div class="pb-doc" style="margin:10px 0 14px"></div><label class="pill ghost sm" style="cursor:pointer">' + J.icon('up') + esc(s('upload')) + '<input type="file" hidden accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.heic,image/*"></label></div>' +
        '<div class="pb-miss"></div><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:18px"><button class="pill" data-a="run" type="button">' + esc(s('run')) + '<i>→</i></button><span class="muted" style="font-size:13px">' + esc(s('cost')) + '</span></div>';
      drawDoc();
      $$('.pb-card', body).forEach(function (c) {
        c.onclick = function (e) {
          var a = e.target.closest('[data-a]'), kind = c.dataset.k, id = c.dataset.id;
          var p = kind === 'b' ? data.builtin.filter(function (x) { return x.key === id; })[0] : data.mine.filter(function (x) { return String(x.id) === id; })[0];
          if (a && a.dataset.a === 'copy') { editor({ name: p.name, description: p.description, rules: p.rules }); return; }
          if (a && a.dataset.a === 'edit') { editor(p); return; }
          if (a && a.dataset.a === 'del') { J.confirm(s('delQ'), s('del')).then(function (ok) { if (ok) J.api('/api/playbooks/' + p.id, { method: 'DELETE' }).then(function () { if (chosen && chosen.kind === 'm' && String(chosen.id) === id) chosen = null; load(); }); }); return; }
          chosen = { kind: kind, id: id, name: p.name }; setup();
        };
      });
      $('[data-a=new]', body).onclick = function () { editor({ name: '', description: '', rules: [{ title: '', requirement: '', severity: 'medium', preferred: '' }] }); };
      $('input[type=file]', body).onchange = async function () {
        var f = this.files[0]; if (!f) return;
        doc = { name: f.name, status: 'reading' }; drawDoc();
        // a scan goes through the shared OCR step for an analysis (price confirmed first;
        // the analysis units it holds are the ones this review uses)
        try {
          var r = await J.readFile(f, J.scanConfirm, 'analysis');
          doc.status = 'ok';
          if (r.scanId) { doc.scanId = r.scanId; doc.chars = r.chars || 0; } else { doc.text = r.text; doc.chars = r.text.length; }
        } catch (e) {
          if (e && e.message === 'cancel') { doc = null; drawDoc(); return; }
          doc.status = 'bad'; doc.error = e && e.message;
        }
        drawDoc();
      };
      $('[data-a=run]', body).onclick = run;
    }
    function drawDoc() {
      var box = $('.pb-doc', body); if (!box) return;
      if (!doc) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="pb-file">' + J.icon('doc') + '<span>' + esc(doc.name) + '</span><small class="' + (doc.status === 'ok' ? 'muted' : doc.status === 'reading' ? 'muted' : 'err') + '">' +
        (doc.status === 'ok' ? (doc.scanId ? 'OCR · ' : '') + Math.round((doc.chars || 0) / 1000) + 'k' : esc(doc.status === 'bad' && doc.error ? doc.error : s(doc.status === 'reading' ? 'reading' : doc.status))) + '</small></div>';
    }

    function editor(p) {
      var rules = (p.rules || []).map(function (r) { return { title: r.title || '', requirement: r.requirement || '', severity: r.severity || 'medium', preferred: r.preferred || '' }; });
      var m = J.modal({ cls: '', html: '<h2>' + esc(p.id ? s('edit') : s('newPb')) + '</h2>' +
        '<div class="field" style="margin-top:14px"><label>' + esc(s('eName')) + '</label><input class="inp pe-name"></div>' +
        '<div class="field"><label>' + esc(s('eDesc')) + '</label><input class="inp pe-desc"></div><div class="pe-rules"></div>' +
        '<button type="button" class="pill sm ghost pe-add">+ ' + esc(s('eAdd')) + '</button>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button type="button" class="pill ghost pe-cancel">' + esc(s('cancel')) + '</button><button type="button" class="pill pe-save">' + esc(s('save')) + '</button></div>' });
      $('.pe-name', m.body).value = p.name || ''; $('.pe-desc', m.body).value = p.description || '';
      function read() {
        $$('.pe-rule', m.body).forEach(function (el, i) {
          rules[i] = { title: $('.pe-t', el).value.trim(), requirement: $('.pe-r', el).value.trim(), severity: $('.pe-s', el).value, preferred: $('.pe-p', el).value.trim() };
        });
      }
      function draw() {
        $('.pe-rules', m.body).innerHTML = rules.map(function (r, i) {
          return '<div class="pe-rule card"><div style="display:flex;justify-content:space-between;align-items:center"><b>' + esc(s('eRule')) + ' ' + (i + 1) + '</b><button type="button" class="ib pe-x" data-i="' + i + '" aria-label="x">' + J.icon('x') + '</button></div>' +
            '<div class="field"><label>' + esc(s('eTitle')) + '</label><input class="inp pe-t"></div><div class="field"><label>' + esc(s('eReq')) + '</label><textarea class="inp pe-r" rows="2"></textarea></div>' +
            '<div class="field"><label>' + esc(s('eSev')) + '</label><select class="inp pe-s">' + ['high', 'medium', 'low'].map(function (k) { return '<option value="' + k + '">' + esc(s('sev')[k]) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>' + esc(s('ePref')) + '</label><textarea class="inp pe-p" rows="2"></textarea></div></div>';
        }).join('');
        $$('.pe-rule', m.body).forEach(function (el, i) { $('.pe-t', el).value = rules[i].title; $('.pe-r', el).value = rules[i].requirement; $('.pe-s', el).value = rules[i].severity; $('.pe-p', el).value = rules[i].preferred; });
        $$('.pe-x', m.body).forEach(function (b) { b.onclick = function () { read(); rules.splice(+b.dataset.i, 1); draw(); }; });
      }
      draw();
      $('.pe-add', m.body).onclick = function () { read(); if (rules.length < 20) rules.push({ title: '', requirement: '', severity: 'medium', preferred: '' }); draw(); };
      $('.pe-cancel', m.body).onclick = function () { m.close(); };
      $('.pe-save', m.body).onclick = async function () {
        read();
        var payload = { name: $('.pe-name', m.body).value.trim(), description: $('.pe-desc', m.body).value.trim(), rules: rules };
        this.disabled = true;
        var r = await J.api(p.id ? '/api/playbooks/' + p.id : '/api/playbooks', { method: p.id ? 'PUT' : 'POST', body: payload });
        this.disabled = false;
        if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
        m.close(); chosen = { kind: 'm', id: String(r.data.id), name: r.data.name }; load();
      };
    }

    async function run() {
      if (!chosen || !doc || doc.status !== 'ok') { $('.pb-miss', body).innerHTML = '<div class="note-blue" style="margin-top:14px">' + esc(s('need')) + '</div>'; return; }
      var payload = doc.scanId ? { scanId: doc.scanId, name: doc.name } : { text: doc.text, name: doc.name };
      if (chosen.kind === 'b') payload.builtin = chosen.id; else payload.playbookId = Number(chosen.id);
      body.innerHTML = '<div class="card" style="display:flex;gap:12px;align-items:center"><span class="spin"></span>' + esc(s('working')) + '</div>';
      var r = await (J.agentApi || J.api)('/api/agent/playbook-review', { method: 'POST', body: payload });
      if (r.status === 402) { body.innerHTML = '<div class="card"><p>' + esc((r.data && r.data.message) || s('nounit')) + '</p><a class="pill" href="/tariff.html">' + esc(s('plans')) + '<i>→</i></a> <button class="pill ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>'; $('[data-a=back]', body).onclick = setup; return; }
      if (!r.ok) { body.innerHTML = '<div class="card"><p class="err">' + esc(J.errMsg(r.data)) + '</p><button class="pill ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>'; $('[data-a=back]', body).onclick = setup; return; }
      result(r.data);
    }

    function itemHtml(x) {
      var rl = x.rule || {};
      return '<div class="pb-res card"><div class="pb-rh"><b>' + esc(rl.title || x.id) + '</b><span class="pb-st st-' + esc(x.status) + '">' + esc(s('st')[x.status] || x.status) + '</span></div>' +
        '<p class="muted" style="font-size:13px;margin:4px 0 10px">' + esc(s('sev')[rl.severity] || '') + ' · ' + esc(rl.requirement || '') + '</p>' +
        (x.quote ? '<small class="muted">' + esc(s('quote')) + (x.page ? ' · ' + esc(s('page')) + ' ' + x.page : '') + ' · ' + esc(x.verified ? s('verified') : s('unverified')) + '</small><blockquote class="tb-q">«' + esc(x.quote) + '»</blockquote>' : '') +
        (x.note ? '<p style="font-size:14px">' + esc(x.note) + '</p>' : '') +
        (x.suggestion ? '<div class="pb-sug"><small class="muted">' + esc(s('suggestion')) + '</small><p>' + esc(x.suggestion) + '</p><button type="button" class="chip pb-cp">' + J.icon('copy') + esc(s('copyTxt')) + '</button></div>' : '') + '</div>';
    }
    function result(d) {
      var c = d.counts || {}, items = d.results || [];
      var order = { yoq: 0, farq: 1, noaniq: 2, mos: 3 }, sevOrder = { high: 0, medium: 1, low: 2 };
      items = items.slice().sort(function (a, b) { return (order[a.status] - order[b.status]) || (sevOrder[(a.rule || {}).severity] - sevOrder[(b.rule || {}).severity]); });
      body.innerHTML = '<div class="note-blue" style="margin-bottom:14px">' + esc(s('note')) + (d.excerpt ? ' ' + esc(s('part')) : '') + '</div>' +
        '<div class="card" style="margin-bottom:14px"><div class="kv">' + ['yoq', 'farq', 'noaniq', 'mos'].map(function (k) { return '<div><small>' + esc(s('st')[k]) + '</small><b class="num pb-st st-' + k + '">' + (c[k] || 0) + '</b></div>'; }).join('') + '</div></div>' +
        items.map(itemHtml).join('') +
        '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="pill sm" data-a="word" type="button">' + J.icon('word') + esc(s('word')) + '</button>' + (J.wsSaveButton ? J.wsSaveButton() : '') + (d.runId && J.matterButton ? J.matterButton() : '') + '<button class="pill sm ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>';
      $$('.pb-cp', body).forEach(function (b) { b.onclick = function () { navigator.clipboard.writeText(b.parentNode.querySelector('p').textContent).then(function () { J.toast(J.t('act.copied')); }); }; });
      $('[data-a=word]', body).onclick = function () {
        var html = '<p><i>' + esc(s('note')) + '</i></p>' + items.map(function (x) {
          var rl = x.rule || {};
          return '<h3>' + esc(rl.title || '') + ' — ' + esc(s('st')[x.status]) + '</h3><p><b>' + esc(s('sev')[rl.severity] || '') + ':</b> ' + esc(rl.requirement || '') + '</p>' +
            (x.quote ? '<p><b>' + esc(s('quote')) + (x.page ? ' (' + esc(s('page')) + ' ' + x.page + ')' : '') + ':</b> «' + esc(x.quote) + '»</p>' : '') +
            (x.note ? '<p>' + esc(x.note) + '</p>' : '') + (x.suggestion ? '<p><b>' + esc(s('suggestion')) + ':</b> ' + esc(x.suggestion) + '</p>' : '');
        }).join('');
        J.exportWord(s('title') + (chosen ? ' — ' + chosen.name : ''), html);
      };
      var ws = $('[data-a=wssave]', body);
      if (ws) ws.onclick = function () {
        var text = items.map(function (x) {
          var rl = x.rule || {};
          return (rl.title || '') + ' — ' + s('st')[x.status] + '\n  ' + (rl.requirement || '') + (x.quote ? '\n  «' + x.quote + '»' + (x.page ? ' (' + s('page') + ' ' + x.page + ')' : '') : '') + (x.note ? '\n  ' + x.note : '') + (x.suggestion ? '\n  ' + s('suggestion') + ': ' + x.suggestion : '');
        }).join('\n\n');
        J.saveToWorkspace({ title: s('title') + (chosen ? ' — ' + chosen.name : '') + (doc ? ' — ' + doc.name : ''), text: s('note') + '\n\n' + text, json: { type: 'playbook_review', playbook: chosen ? chosen.name : null, document: doc ? doc.name : null, counts: c, results: items } });
      };
      if (J.wireMatterButton) J.wireMatterButton(body, function () { return { kind: 'agent_run', ref: d.runId, title: s('title') + (chosen ? ' — ' + chosen.name : '') + (doc ? ' — ' + doc.name : '') }; });
      $('[data-a=back]', body).onclick = function () { doc = null; setup(); };
      if (J.refreshTariff) J.refreshTariff();
    }

    load();
  };

  J.route(/^\/playbook$/, function () { J.viewPlaybook(); });
})(window);
