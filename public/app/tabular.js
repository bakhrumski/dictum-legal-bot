/* Jadvalli tahlil (2026-10-22): bir nechta hujjat × bir nechta savol. Har katakda javob va hujjatning
   o'z so'zlari bilan iqtibos; iqtibos hujjat matnida so'zma-so'z topilgani tekshiriladi (javob to'g'riligi emas).
   Server: POST /api/analyze/extract (har fayl), POST /api/agent/tabular-review (src/agents/agent-routes.js). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;

  var S = {
    uz: {
      title: 'Jadvalli tahlil', sub: 'Bir nechta hujjatni bir vaqtda ko‘ring: har hujjat — qator, har savol — ustun. Har bir javob yonida hujjatdan iqtibos va sahifa.',
      docs: 'Hujjatlar', add: 'Hujjat qo‘shish', types: 'PDF, DOCX yoki skan/rasm (OCR — narxi oldin ko‘rsatiladi), 20 tagacha', reading: 'o‘qilmoqda…', scanned: 'skan — hozircha qo‘llab-quvvatlanmaydi', bad: 'o‘qib bo‘lmadi',
      cols: 'Savollar (ustunlar)', colPh: 'O‘z savolingiz, masalan: Javobgarlik chegarasi qancha?', addCol: 'Qo‘shish', presets: 'Tayyor savollar',
      run: 'Jadvalni tuzish', cost: 'Har hujjat — 1 ta savol birligi (10 tagacha savol); faqat o‘qilgan hujjat uchun yechiladi.',
      working: 'Hujjatlar o‘qilmoqda… 20 hujjat uchun 1–2 daqiqa', doc: 'Hujjat', verified: 'Iqtibos hujjatda topildi', unverified: 'Iqtibos hujjatda so‘zma-so‘z topilmadi — qo‘lda tekshiring',
      notfound: 'Topilmadi', part: 'uzun hujjat: savollarga mos qismlar o‘qildi', failed: 'O‘qib bo‘lmadi', csv: 'CSV yuklab olish', again: 'Yangi jadval',
      page: 'sahifa', quote: 'Iqtibos', note: 'Iqtibos hujjat matnida borligi tekshiriladi — javobning huquqiy to‘g‘riligi emas. Muhim qarordan oldin hujjatning o‘zini o‘qing.',
      nounit: 'Savol birligi yetarli emas', plans: 'Tariflar', need: 'Kamida bitta hujjat va bitta savol kerak', entry: 'Bir nechta hujjat × savollar jadvali', open: 'Jadvalni ochish',
      types_: { text: 'Matn', yesno: 'Ha/Yo‘q', date: 'Sana', amount: 'Summa' }
    },
    ru: {
      title: 'Табличный анализ', sub: 'Несколько документов сразу: документ — строка, вопрос — столбец. У каждого ответа — цитата из документа и страница.',
      docs: 'Документы', add: 'Добавить документ', types: 'PDF, DOCX или скан/фото (OCR — цена показывается заранее), до 20', reading: 'читается…', scanned: 'скан — пока не поддерживается', bad: 'не удалось прочитать',
      cols: 'Вопросы (столбцы)', colPh: 'Свой вопрос, например: Каков предел ответственности?', addCol: 'Добавить', presets: 'Готовые вопросы',
      run: 'Построить таблицу', cost: 'Каждый документ — 1 единица вопроса (до 10 вопросов); списывается только за прочитанные.',
      working: 'Документы читаются… 1–2 минуты на 20 документов', doc: 'Документ', verified: 'Цитата найдена в документе', unverified: 'Цитата не найдена дословно — проверьте вручную',
      notfound: 'Не найдено', part: 'длинный документ: прочитаны части по вопросам', failed: 'Не прочитан', csv: 'Скачать CSV', again: 'Новая таблица',
      page: 'стр.', quote: 'Цитата', note: 'Проверяется наличие цитаты в тексте документа — не правовая верность ответа. Перед важным решением прочитайте сам документ.',
      nounit: 'Недостаточно единиц вопросов', plans: 'Тарифы', need: 'Нужен хотя бы один документ и один вопрос', entry: 'Таблица: документы × вопросы', open: 'Открыть таблицу',
      types_: { text: 'Текст', yesno: 'Да/Нет', date: 'Дата', amount: 'Сумма' }
    }
  };
  function s(k) { var d = S[J.lang] || S.uz; return d[k] !== undefined ? d[k] : S.uz[k]; }
  J.tabularText = s;

  var PRESETS = {
    uz: [['Tomonlar kimlar?', 'text'], ['Shartnoma summasi', 'amount'], ['Amal qilish muddati', 'date'], ['Javobgarlik chegarasi bormi?', 'yesno'], ['Bir tomonlama bekor qilish shartlari', 'text'], ['Nizolar qayerda hal qilinadi?', 'text'], ['Penya yoki jarima miqdori', 'amount'], ['Maxfiylik bandi bormi?', 'yesno']],
    ru: [['Кто стороны?', 'text'], ['Сумма договора', 'amount'], ['Срок действия', 'date'], ['Есть ли предел ответственности?', 'yesno'], ['Условия одностороннего расторжения', 'text'], ['Где разрешаются споры?', 'text'], ['Размер пени или штрафа', 'amount'], ['Есть ли пункт о конфиденциальности?', 'yesno']]
  };

  J.viewTabular = function () {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap"><div class="vh"><div><div class="kicker">AI · ' + esc(s('quote')) + '</div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('sub')) + '</p></div></div><div class="tb-body"></div></div>');
    var body = $('.tb-body', v);
    var docs = [], cols = [];

    function setup() {
      var presets = PRESETS[J.lang] || PRESETS.uz;
      body.innerHTML = '<div class="grid2 tb-setup">' +
        '<div class="card"><h4>' + esc(s('docs')) + '</h4><p class="muted" style="font-size:13px;margin-bottom:12px">' + esc(s('types')) + '</p><div class="tb-docs"></div>' +
        '<label class="pill ghost sm" style="cursor:pointer;margin-top:10px">' + J.icon('up') + esc(s('add')) + '<input type="file" hidden multiple accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.heic,image/*"></label></div>' +
        '<div class="card"><h4>' + esc(s('cols')) + '</h4><div class="tb-cols"></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px"><input class="inp tb-new" placeholder="' + esc(s('colPh')) + '"><button class="pill sm ghost" data-a="addcol" type="button">' + esc(s('addCol')) + '</button></div>' +
        '<p class="muted" style="font-size:12.5px;margin:14px 0 8px">' + esc(s('presets')) + '</p><div class="tb-presets">' + presets.map(function (p, i) { return '<button type="button" class="chip" data-p="' + i + '">' + esc(p[0]) + '</button>'; }).join('') + '</div></div></div>' +
        '<div class="tb-miss"></div><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:18px"><button class="pill" data-a="run" type="button">' + esc(s('run')) + '<i>→</i></button><span class="muted" style="font-size:13px">' + esc(s('cost')) + '</span></div>';
      drawDocs(); drawCols();
      $('input[type=file]', body).onchange = function () { Array.prototype.slice.call(this.files).forEach(addFile); this.value = ''; };
      $('[data-a=addcol]', body).onclick = function () { var i = $('.tb-new', body); if (i.value.trim().length >= 3) { addCol(i.value.trim(), 'text'); i.value = ''; } };
      $('.tb-new', body).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('[data-a=addcol]', body).click(); } };
      $$('[data-p]', body).forEach(function (b) { b.onclick = function () { var p = presets[+b.dataset.p]; addCol(p[0], p[1]); }; });
      $('[data-a=run]', body).onclick = run;
    }
    function drawDocs() {
      var box = $('.tb-docs', body); if (!box) return;
      box.innerHTML = docs.length ? '<ul class="tb-list">' + docs.map(function (d, i) {
        var st = d.status === 'reading' ? '<span class="spin"></span>' + esc(s('reading')) : d.status === 'ok' ? '<span class="muted">' + (d.scanId ? 'OCR · ' : '') + Math.round((d.chars || 0) / 1000) + 'k</span>' : '<span class="err" title="' + esc(d.error || '') + '">' + esc(s(d.status)) + '</span>';
        return '<li>' + J.icon('doc') + '<span class="tb-n">' + esc(d.name) + '</span><small>' + st + '</small><button type="button" class="ib" data-rd="' + i + '" aria-label="x">' + J.icon('x') + '</button></li>';
      }).join('') + '</ul>' : '';
      $$('[data-rd]', box).forEach(function (b) { b.onclick = function () { docs.splice(+b.dataset.rd, 1); drawDocs(); }; });
    }
    function drawCols() {
      var box = $('.tb-cols', body); if (!box) return;
      box.innerHTML = cols.length ? '<ul class="tb-list">' + cols.map(function (c, i) {
        return '<li><span class="tb-n">' + esc(c.label) + '</span><select class="inp tb-type" data-ct="' + i + '">' + ['text', 'yesno', 'date', 'amount'].map(function (k) { return '<option value="' + k + '"' + (k === c.type ? ' selected' : '') + '>' + esc(s('types_')[k]) + '</option>'; }).join('') + '</select><button type="button" class="ib" data-rc="' + i + '" aria-label="x">' + J.icon('x') + '</button></li>';
      }).join('') + '</ul>' : '';
      $$('[data-rc]', box).forEach(function (b) { b.onclick = function () { cols.splice(+b.dataset.rc, 1); drawCols(); }; });
      $$('[data-ct]', box).forEach(function (sel) { sel.onchange = function () { cols[+sel.dataset.ct].type = sel.value; }; });
    }
    function addCol(label, type) {
      if (cols.length >= 10 || cols.some(function (c) { return c.label === label; })) return;
      cols.push({ label: label, type: type }); drawCols();
    }
    // a scan or photo goes through the shared OCR step (chat.js J.readFile: its
    // price shown and confirmed first); the text stays on the server as scanId
    async function addFile(f) {
      if (docs.length >= 20) return;
      var d = { name: f.name, status: 'reading', text: '' }; docs.push(d); drawDocs();
      try {
        var r = await J.readFile(f, J.scanConfirm, 'chat');
        d.status = 'ok';
        if (r.scanId) { d.scanId = r.scanId; d.chars = r.chars || 0; } else { d.text = r.text; d.chars = r.text.length; }
      } catch (e) {
        if (e && e.message === 'cancel') { docs.splice(docs.indexOf(d), 1); drawDocs(); return; }
        d.status = 'bad'; d.error = e && e.message;
      }
      drawDocs();
    }

    async function run() {
      var ready = docs.filter(function (d) { return d.status === 'ok'; });
      if (!ready.length || !cols.length) { $('.tb-miss', body).innerHTML = '<div class="note-blue" style="margin-top:14px">' + esc(s('need')) + '</div>'; return; }
      body.innerHTML = '<div class="card" style="display:flex;gap:12px;align-items:center"><span class="spin"></span>' + esc(s('working')) + '</div>';
      var r = await J.api('/api/agent/tabular-review', { method: 'POST', body: { documents: ready.map(function (d) { return d.scanId ? { name: d.name, scanId: d.scanId } : { name: d.name, text: d.text }; }), columns: cols } });
      if (r.status === 402) { body.innerHTML = '<div class="card"><p>' + esc((r.data && r.data.message) || s('nounit')) + '</p><a class="pill" href="/tariff.html">' + esc(s('plans')) + '<i>→</i></a> <button class="pill ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>'; $('[data-a=back]', body).onclick = setup; return; }
      if (!r.ok) { body.innerHTML = '<div class="card"><p class="err">' + esc(J.errMsg(r.data)) + '</p><button class="pill ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>'; $('[data-a=back]', body).onclick = setup; return; }
      result(r.data);
    }

    function cellHtml(c) {
      if (!c) return '';
      var mark = c.notFound ? '' : (c.verified ? '<span class="tb-ok" title="' + esc(s('verified')) + '">✓</span>' : '<span class="tb-warn" title="' + esc(s('unverified')) + '">!</span>');
      return '<button type="button" class="tb-cell' + (c.notFound ? ' nf' : '') + '">' + mark + '<span>' + esc(c.notFound ? s('notfound') : c.answer) + '</span>' + (c.page ? '<small>' + esc(s('page')) + ' ' + c.page + '</small>' : '') + '</button>';
    }
    function result(d) {
      var columns = d.columns || [], rows = d.rows || [];
      var head = '<tr><th>' + esc(s('doc')) + '</th>' + columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr>';
      var trs = rows.map(function (r, ri) {
        var name = '<th scope="row"><b>' + esc(r.name) + '</b>' + (r.excerpt ? '<small>' + esc(s('part')) + '</small>' : '') + '</th>';
        if (r.status !== 'ok') return '<tr>' + name + '<td colspan="' + columns.length + '" class="err">' + esc(s('failed')) + '</td></tr>';
        return '<tr>' + name + columns.map(function (c) { return '<td data-r="' + ri + '" data-c="' + esc(c.id) + '">' + cellHtml(r.cells[c.id]) + '</td>'; }).join('') + '</tr>';
      }).join('');
      body.innerHTML = '<div class="note-blue" style="margin-bottom:14px">' + esc(s('note')) + '</div>' +
        '<div class="tb-wrap"><table class="tb-grid"><thead>' + head + '</thead><tbody>' + trs + '</tbody></table></div>' +
        '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="pill sm" data-a="csv" type="button">' + esc(s('csv')) + '</button>' + (J.wsSaveButton ? J.wsSaveButton() : '') + '<button class="pill sm ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>';
      $$('td[data-r]', body).forEach(function (td) {
        td.onclick = function () {
          var r = rows[+td.dataset.r], c = r.cells[td.dataset.c], col = columns.filter(function (x) { return x.id === td.dataset.c; })[0];
          var m = J.modal({ cls: 'sm', html: '<div class="kicker">' + esc(r.name) + '</div><h2 style="margin-bottom:10px">' + esc(col.label) + '</h2><p style="font-size:15px"></p>' +
            (c.quote ? '<h4 style="margin-top:16px">' + esc(s('quote')) + (c.page ? ' · ' + esc(s('page')) + ' ' + c.page : '') + '</h4><blockquote class="tb-q"></blockquote><p class="muted" style="font-size:12.5px">' + esc(c.verified ? s('verified') : s('unverified')) + '</p>' : '') });
          $('p', m.body).textContent = c.notFound ? s('notfound') : c.answer;
          var q = $('.tb-q', m.body); if (q) q.textContent = '«' + c.quote + '»';
        };
      });
      $('[data-a=csv]', body).onclick = function () {
        var q = function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; };
        var lines = [[s('doc')].concat(columns.map(function (c) { return c.label; }), columns.map(function (c) { return c.label + ' — ' + s('quote'); })).map(q).join(',')];
        rows.forEach(function (r) {
          var cells = columns.map(function (c) { var x = r.cells && r.cells[c.id]; return x ? (x.notFound ? s('notfound') : x.answer) : s('failed'); });
          var quotes = columns.map(function (c) { var x = r.cells && r.cells[c.id]; return x && x.quote ? x.quote + (x.page ? ' (' + s('page') + ' ' + x.page + ')' : '') + (x.verified ? '' : ' [!]') : ''; });
          lines.push([r.name].concat(cells, quotes).map(q).join(','));
        });
        var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'jadvalli-tahlil.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      };
      $('[data-a=back]', body).onclick = function () { setup(); };
      // the table as text (Workspace AI reads it) and as data
      var ws = $('[data-a=wssave]', body);
      if (ws) ws.onclick = function () {
        var text = rows.map(function (r) {
          if (r.status !== 'ok') return r.name + ': ' + s('failed');
          return r.name + '\n' + columns.map(function (c) { var x = r.cells[c.id]; return '  • ' + c.label + ': ' + (x.notFound ? s('notfound') : x.answer) + (x.quote ? ' — «' + x.quote + '»' + (x.page ? ' (' + s('page') + ' ' + x.page + ')' : '') + (x.verified ? '' : ' [!]') : ''); }).join('\n');
        }).join('\n\n');
        J.saveToWorkspace({ title: s('title') + ' — ' + rows.length + ' ' + s('doc').toLowerCase(), text: s('note') + '\n\n' + text, json: { type: 'tabular_review', columns: columns, rows: rows } });
      };
      if (J.refreshTariff) J.refreshTariff();
    }

    setup();
  };

  J.route(/^\/jadval$/, function () { J.viewTabular(); });
})(window);
