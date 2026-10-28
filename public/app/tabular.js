/* Jadvalli tahlil (2026-10-22): bir nechta hujjat × bir nechta savol. Har katakda javob va hujjatning
   o'z so'zlari bilan iqtibos; iqtibos hujjat matnida so'zma-so'z topilgani tekshiriladi (javob to'g'riligi emas).
   Server: POST /api/analyze/extract (har fayl), POST /api/agent/tabular-review (src/agents/agent-routes.js).
   2-bosqich (2026-10-28): 100 tagacha hujjat fonda (agent run; bosqichlar ko'rinadi, sahifa yopilsa ham
   ish davom etadi va #/jadval/<runId> da ochiladi), "tanlov" ustuni, qator teglari (run bilan saqlanadi),
   Excel (POST /api/agent/tabular-review/export). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;

  var S = {
    uz: {
      title: 'Jadvalli tahlil', sub: 'Bir nechta hujjatni bir vaqtda ko‘ring: har hujjat — qator, har savol — ustun. Har bir javob yonida hujjatdan iqtibos va sahifa.',
      docs: 'Hujjatlar', add: 'Hujjat qo‘shish', types: 'PDF, DOCX yoki skan/rasm (OCR — narxi oldin ko‘rsatiladi), 100 tagacha', reading: 'o‘qilmoqda…', scanned: 'skan — hozircha qo‘llab-quvvatlanmaydi', bad: 'o‘qib bo‘lmadi',
      cols: 'Savollar (ustunlar)', colPh: 'O‘z savolingiz, masalan: Javobgarlik chegarasi qancha?', addCol: 'Qo‘shish', presets: 'Tayyor savollar',
      run: 'Jadvalni tuzish', cost: 'Har hujjat — 1 ta savol birligi (10 tagacha savol); faqat o‘qilgan hujjat uchun yechiladi.',
      working: 'Hujjatlar o‘qilmoqda… 20 hujjat uchun 1–2 daqiqa', bg: 'Ish fonda davom etadi: sahifani yopsangiz ham natija saqlanadi va shu havola orqali ochiladi.', progress: 'O‘qildi: {done} hujjat · {k}/{n} qism',
      queued: 'Navbatda…', last: 'Oxirgi jadval', openLast: 'Ochish', cancel: 'To‘xtatish', cancelled: 'To‘xtatildi',
      opts: 'Variantlar, vergul bilan: Ijara, Oldi-sotdi, Pudrat', optsHint: 'Tanlov uchun kamida 2 ta variant kerak',
      tags: 'Teglar', addTag: 'Teg', tagPh: 'Masalan: muhim, qayta ko‘rish', all: 'Hammasi', xlsx: 'Excel yuklab olish', tagSaveErr: 'Teglarni saqlab bo‘lmadi',
      partialNote: 'Jadval to‘liq emas', max: 'Ko‘pi bilan {n} ta hujjat', doc: 'Hujjat', verified: 'Iqtibos hujjatda topildi', unverified: 'Iqtibos hujjatda so‘zma-so‘z topilmadi — qo‘lda tekshiring',
      notfound: 'Topilmadi', part: 'uzun hujjat: savollarga mos qismlar o‘qildi', failed: 'O‘qib bo‘lmadi', csv: 'CSV yuklab olish', again: 'Yangi jadval',
      page: 'sahifa', quote: 'Iqtibos', note: 'Iqtibos hujjat matnida borligi tekshiriladi — javobning huquqiy to‘g‘riligi emas. Muhim qarordan oldin hujjatning o‘zini o‘qing.',
      nounit: 'Savol birligi yetarli emas', plans: 'Tariflar', need: 'Kamida bitta hujjat va bitta savol kerak', entry: 'Bir nechta hujjat × savollar jadvali', open: 'Jadvalni ochish',
      types_: { text: 'Matn', yesno: 'Ha/Yo‘q', date: 'Sana', amount: 'Summa', choice: 'Tanlov' }
    },
    ru: {
      title: 'Табличный анализ', sub: 'Несколько документов сразу: документ — строка, вопрос — столбец. У каждого ответа — цитата из документа и страница.',
      docs: 'Документы', add: 'Добавить документ', types: 'PDF, DOCX или скан/фото (OCR — цена показывается заранее), до 100', reading: 'читается…', scanned: 'скан — пока не поддерживается', bad: 'не удалось прочитать',
      cols: 'Вопросы (столбцы)', colPh: 'Свой вопрос, например: Каков предел ответственности?', addCol: 'Добавить', presets: 'Готовые вопросы',
      run: 'Построить таблицу', cost: 'Каждый документ — 1 единица вопроса (до 10 вопросов); списывается только за прочитанные.',
      working: 'Документы читаются… 1–2 минуты на 20 документов', bg: 'Работа идёт в фоне: если закрыть страницу, результат сохранится и откроется по этой ссылке.', progress: 'Прочитано: {done} док. · часть {k}/{n}',
      queued: 'В очереди…', last: 'Последняя таблица', openLast: 'Открыть', cancel: 'Остановить', cancelled: 'Остановлено',
      opts: 'Варианты через запятую: Аренда, Купля-продажа, Подряд', optsHint: 'Для выбора нужно минимум 2 варианта',
      tags: 'Теги', addTag: 'Тег', tagPh: 'Например: важно, перепроверить', all: 'Все', xlsx: 'Скачать Excel', tagSaveErr: 'Не удалось сохранить теги',
      partialNote: 'Таблица неполная', max: 'Не более {n} документов', doc: 'Документ', verified: 'Цитата найдена в документе', unverified: 'Цитата не найдена дословно — проверьте вручную',
      notfound: 'Не найдено', part: 'длинный документ: прочитаны части по вопросам', failed: 'Не прочитан', csv: 'Скачать CSV', again: 'Новая таблица',
      page: 'стр.', quote: 'Цитата', note: 'Проверяется наличие цитаты в тексте документа — не правовая верность ответа. Перед важным решением прочитайте сам документ.',
      nounit: 'Недостаточно единиц вопросов', plans: 'Тарифы', need: 'Нужен хотя бы один документ и один вопрос', entry: 'Таблица: документы × вопросы', open: 'Открыть таблицу',
      types_: { text: 'Текст', yesno: 'Да/Нет', date: 'Дата', amount: 'Сумма', choice: 'Выбор' }
    }
  };
  function s(k, vars) {
    var d = S[J.lang] || S.uz, v = d[k] !== undefined ? d[k] : S.uz[k];
    if (vars && typeof v === 'string') Object.keys(vars).forEach(function (x) { v = v.replace('{' + x + '}', vars[x]); });
    return v;
  }
  var MAX_DOCS = 100, READERS = 3, BG_FROM = 10, TYPES = ['text', 'yesno', 'date', 'amount', 'choice'], FINAL = ['done', 'failed', 'cancelled', 'budget', 'needs_input'];
  var LAST = 'jai-tabular-run';
  function lastRun(v) { try { if (v === undefined) return localStorage.getItem(LAST) || ''; if (v) localStorage.setItem(LAST, v); else localStorage.removeItem(LAST); } catch (e) { return ''; } return ''; }
  J.tabularText = s;

  var PRESETS = {
    uz: [['Tomonlar kimlar?', 'text'], ['Shartnoma summasi', 'amount'], ['Amal qilish muddati', 'date'], ['Javobgarlik chegarasi bormi?', 'yesno'], ['Bir tomonlama bekor qilish shartlari', 'text'], ['Nizolar qayerda hal qilinadi?', 'text'], ['Penya yoki jarima miqdori', 'amount'], ['Maxfiylik bandi bormi?', 'yesno']],
    ru: [['Кто стороны?', 'text'], ['Сумма договора', 'amount'], ['Срок действия', 'date'], ['Есть ли предел ответственности?', 'yesno'], ['Условия одностороннего расторжения', 'text'], ['Где разрешаются споры?', 'text'], ['Размер пени или штрафа', 'amount'], ['Есть ли пункт о конфиденциальности?', 'yesno']]
  };

  J.viewTabular = function (openRunId) {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap"><div class="vh"><div><div class="kicker">AI · ' + esc(s('quote')) + '</div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('sub')) + '</p></div></div><div class="tb-body"></div></div>');
    var body = $('.tb-body', v);
    var docs = [], cols = [], queue = [], reading = 0, alive = true;
    var off = function () { if (!document.body.contains(v)) { alive = false; window.removeEventListener('hashchange', off); } };
    window.addEventListener('hashchange', off);

    function setup() {
      var presets = PRESETS[J.lang] || PRESETS.uz;
      body.innerHTML = '<div class="grid2 tb-setup">' +
        '<div class="card"><h4>' + esc(s('docs')) + '</h4><p class="muted" style="font-size:13px;margin-bottom:12px">' + esc(s('types')) + '</p><div class="tb-docs"></div>' +
        '<label class="pill ghost sm" style="cursor:pointer;margin-top:10px">' + J.icon('up') + esc(s('add')) + '<input type="file" hidden multiple accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.heic,image/*"></label></div>' +
        '<div class="card"><h4>' + esc(s('cols')) + '</h4><div class="tb-cols"></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px"><input class="inp tb-new" placeholder="' + esc(s('colPh')) + '"><button class="pill sm ghost" data-a="addcol" type="button">' + esc(s('addCol')) + '</button></div>' +
        '<p class="muted" style="font-size:12.5px;margin:14px 0 8px">' + esc(s('presets')) + '</p><div class="tb-presets">' + presets.map(function (p, i) { return '<button type="button" class="chip" data-p="' + i + '">' + esc(p[0]) + '</button>'; }).join('') + '</div></div></div>' +
        '<div class="tb-miss"></div><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:18px"><button class="pill" data-a="run" type="button">' + esc(s('run')) + '<i>→</i></button><span class="muted" style="font-size:13px">' + esc(s('cost')) + '</span></div>' +
        (lastRun() ? '<div class="tb-last"><span class="muted">' + esc(s('last')) + '</span><a class="pill sm ghost" href="#/jadval/' + esc(lastRun()) + '">' + esc(s('openLast')) + '</a></div>' : '');
      drawDocs(); drawCols();
      $('input[type=file]', body).onchange = function () { Array.prototype.slice.call(this.files).forEach(addFile); this.value = ''; pump(); };
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
        return '<li class="tb-col"><div class="tb-row"><span class="tb-n">' + esc(c.label) + '</span><select class="inp tb-type" data-ct="' + i + '">' + TYPES.map(function (k) { return '<option value="' + k + '"' + (k === c.type ? ' selected' : '') + '>' + esc(s('types_')[k]) + '</option>'; }).join('') + '</select><button type="button" class="ib" data-rc="' + i + '" aria-label="x">' + J.icon('x') + '</button></div>' +
          (c.type === 'choice' ? '<input class="inp tb-opts" data-co="' + i + '" maxlength="500" placeholder="' + esc(s('opts')) + '" value="' + esc((c.options || []).join(', ')) + '">' : '') + '</li>';
      }).join('') + '</ul>' : '';
      $$('[data-rc]', box).forEach(function (b) { b.onclick = function () { cols.splice(+b.dataset.rc, 1); drawCols(); }; });
      $$('[data-ct]', box).forEach(function (sel) { sel.onchange = function () { cols[+sel.dataset.ct].type = sel.value; drawCols(); var o = $('[data-co="' + sel.dataset.ct + '"]', box); if (o) o.focus(); }; });
      $$('[data-co]', box).forEach(function (inp) { inp.oninput = function () { cols[+inp.dataset.co].options = inp.value.split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 8); }; });
    }
    function addCol(label, type) {
      if (cols.length >= 10 || cols.some(function (c) { return c.label === label; })) return;
      cols.push({ label: label, type: type }); drawCols();
    }
    // a scan or photo goes through the shared OCR step (chat.js J.readFile: its
    // price shown and confirmed first); the text stays on the server as scanId.
    // Files are read three at a time (100 at once would be 100 parallel requests).
    function addFile(f) {
      if (docs.length >= MAX_DOCS) { J.toast(s('max', { n: MAX_DOCS })); return; }
      var d = { name: f.name, status: 'reading', text: '' }; docs.push(d);
      queue.push(function () { return readOne(f, d); });
      drawDocs();
    }
    function pump() {
      while (reading < READERS && queue.length) {
        reading++;
        queue.shift()().then(function () { reading--; pump(); }, function () { reading--; pump(); });
      }
    }
    async function readOne(f, d) {
      if (docs.indexOf(d) < 0) return;
      try {
        var r = await J.readFile(f, J.scanConfirm, 'chat');
        d.status = 'ok';
        if (r.scanId) { d.scanId = r.scanId; d.chars = r.chars || 0; } else { d.text = r.text; d.chars = r.text.length; }
      } catch (e) {
        if (e && e.message === 'cancel') { var at = docs.indexOf(d); if (at > -1) docs.splice(at, 1); drawDocs(); return; }
        d.status = 'bad'; d.error = e && e.message;
      }
      drawDocs();
    }

    async function run() {
      var ready = docs.filter(function (d) { return d.status === 'ok'; });
      var badChoice = cols.filter(function (c) { return c.type === 'choice' && (c.options || []).length < 2; });
      if (!ready.length || !cols.length) { $('.tb-miss', body).innerHTML = '<div class="note-blue" style="margin-top:14px">' + esc(s('need')) + '</div>'; return; }
      if (badChoice.length) { $('.tb-miss', body).innerHTML = '<div class="note-blue" style="margin-top:14px">' + esc(s('optsHint')) + ': ' + esc(badChoice.map(function (c) { return c.label; }).join(', ')) + '</div>'; return; }
      body.innerHTML = '<div class="card" style="display:flex;gap:12px;align-items:center"><span class="spin"></span>' + esc(s('working')) + '</div>';
      var bg = ready.length > BG_FROM;
      var payload = { documents: ready.map(function (d) { return d.scanId ? { name: d.name, scanId: d.scanId } : { name: d.name, text: d.text }; }),
        columns: cols.map(function (c) { return c.type === 'choice' ? { label: c.label, type: c.type, options: c.options } : { label: c.label, type: c.type }; }) };
      if (bg) payload.async = true;
      // a large table: its own progress page (#/jadval/<runId>); a small one waits here as before
      var r = await (bg ? J.api : (J.agentApi || J.api))('/api/agent/tabular-review', { method: 'POST', body: payload });
      if (bg && r.status === 202 && r.data && r.data.runId) { lastRun(r.data.runId); J.go('#/jadval/' + r.data.runId); return; }
      shown(r);
    }
    function shown(r) {
      if (r.status === 402) { body.innerHTML = '<div class="card"><p>' + esc((r.data && r.data.message) || s('nounit')) + '</p><a class="pill" href="/tariff.html">' + esc(s('plans')) + '<i>→</i></a> <button class="pill ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>'; $('[data-a=back]', body).onclick = setup; return; }
      if (!r.ok) { body.innerHTML = '<div class="card"><p class="err">' + esc(J.errMsg(r.data)) + '</p><button class="pill ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>'; $('[data-a=back]', body).onclick = function () { J.go('#/jadval'); setup(); }; return; }
      result(r.data);
    }

    // a table in the background: its steps as they finish, then the table
    async function follow(runId) {
      var total = 0;
      body.innerHTML = '<div class="card ag-prog"><p class="muted tb-bgnote" style="font-size:14px;margin-bottom:12px">' + esc(s('bg')) + '</p>' +
        '<p class="tb-count" style="font-size:15px;margin-bottom:10px">' + esc(s('queued')) + '</p><div class="tb-bar" aria-hidden="true"><i></i></div><ol class="ag-steps tb-steps"></ol>' +
        '<div style="margin-top:16px"><button class="pill sm ghost" data-a="stop" type="button">' + esc(s('cancel')) + '</button></div></div>';
      $('[data-a=stop]', body).onclick = async function () { this.disabled = true; await J.api('/api/agent/runs/' + encodeURIComponent(runId) + '/cancel', { method: 'POST' }); };
      while (alive) {
        var r = await J.api('/api/agent/runs/' + encodeURIComponent(runId));
        if (!alive) return;
        if (r.status === 404) { if (lastRun() === runId) lastRun(''); shown({ ok: false, status: 404, data: r.data }); return; }
        if (r.ok) {
          var run = r.data, steps = run.steps || [];
          if (FINAL.indexOf(run.status) > -1 && run.result) {
            var body_ = run.result.body || {}; body_.runId = runId;
            shown({ ok: (run.result.httpStatus || 200) < 300, status: run.result.httpStatus || 200, data: body_ });
            return;
          }
          var ex = steps.filter(function (x) { return /^extract/.test(x.id); });
          var m = ex.length && /(\d+)\/(\d+)/.exec(ex[ex.length - 1].label || '');
          total = m ? +m[2] : total;
          var fin = ex.filter(function (x) { return x.status === 'ok'; });
          var read = fin.reduce(function (n, x) { var k = /(\d+)/.exec(x.note || ''); return n + (k ? +k[1] : 0); }, 0);
          var cnt = $('.tb-count', body), list = $('.tb-steps', body), bar = $('.tb-bar i', body);
          if (cnt) cnt.textContent = run.status === 'queued' ? s('queued') : (total ? s('progress', { done: read, k: fin.length, n: total }) : s('working'));
          if (bar) bar.style.width = (total ? Math.round(100 * fin.length / total) : 0) + '%';
          if (list) list.innerHTML = steps.map(function (x) { return '<li class="' + (x.status === 'ok' ? 'done' : x.status === 'failed' ? 'bad' : 'cur') + '"><span class="ag-dot"></span><span style="flex:1">' + esc(x.label) + '</span>' + (x.note ? '<small class="muted">' + esc(x.note) + '</small>' : '') + '</li>'; }).join('') +
            (run.status === 'running' ? '<li class="cur"><span class="ag-dot"></span><span>…</span></li>' : '');
        }
        await J.sleep(2500);
      }
    }

    function cellHtml(c) {
      if (!c) return '';
      var mark = c.notFound ? '' : (c.verified ? '<span class="tb-ok" title="' + esc(s('verified')) + '">✓</span>' : '<span class="tb-warn" title="' + esc(s('unverified')) + '">!</span>');
      return '<button type="button" class="tb-cell' + (c.notFound ? ' nf' : '') + '">' + mark + '<span>' + esc(c.notFound ? s('notfound') : c.answer) + '</span>' + (c.page ? '<small>' + esc(s('page')) + ' ' + c.page + '</small>' : '') + '</button>';
    }
    function result(d) {
      var columns = d.columns || [], rows = d.rows || [], runId = d.runId || '';
      var tags = (d.tags && typeof d.tags === 'object') ? d.tags : {}, filter = '';
      if (runId) lastRun(runId);
      function allTags() { var seen = {}; Object.keys(tags).forEach(function (k) { (tags[k] || []).forEach(function (t) { seen[t] = (seen[t] || 0) + 1; }); }); return Object.keys(seen).sort(); }
      function tagsHtml(r) {
        return '<span class="tb-tags">' + (tags[r.docId] || []).map(function (t, i) { return '<span class="tb-tag">' + esc(t) + '<button type="button" data-tx="' + esc(r.docId) + '" data-ti="' + i + '" aria-label="x">×</button></span>'; }).join('') +
          '<button type="button" class="tb-tadd" data-ta="' + esc(r.docId) + '">+ ' + esc(s('addTag')) + '</button></span>';
      }
      var head = '<tr><th>' + esc(s('doc')) + '</th>' + columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr>';
      function rowsHtml() {
        return rows.map(function (r, ri) {
          if (filter && (tags[r.docId] || []).indexOf(filter) < 0) return '';
          var name = '<th scope="row"><b>' + esc(r.name) + '</b>' + (r.excerpt ? '<small>' + esc(s('part')) + '</small>' : '') + tagsHtml(r) + '</th>';
          if (r.status !== 'ok') return '<tr>' + name + '<td colspan="' + columns.length + '" class="err">' + esc(s('failed')) + '</td></tr>';
          return '<tr>' + name + columns.map(function (c) { return '<td data-r="' + ri + '" data-c="' + esc(c.id) + '">' + cellHtml(r.cells[c.id]) + '</td>'; }).join('') + '</tr>';
        }).join('');
      }
      body.innerHTML = (d.partial ? '<div class="note-blue" style="margin-bottom:10px">' + esc(d.message || s('partialNote')) + '</div>' : '') +
        '<div class="note-blue" style="margin-bottom:14px">' + esc(s('note')) + '</div>' +
        '<div class="tb-filter"></div>' +
        '<div class="tb-wrap"><table class="tb-grid"><thead>' + head + '</thead><tbody></tbody></table></div>' +
        '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="pill sm" data-a="xlsx" type="button">' + esc(s('xlsx')) + '</button><button class="pill sm ghost" data-a="csv" type="button">' + esc(s('csv')) + '</button>' + (J.wsSaveButton ? J.wsSaveButton() : '') + (runId && J.matterButton ? J.matterButton() : '') + '<button class="pill sm ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>';
      var tbody = $('tbody', body);
      function draw() {
        var list = allTags();
        if (filter && list.indexOf(filter) < 0) filter = '';
        $('.tb-filter', body).innerHTML = list.length ? '<span class="muted">' + esc(s('tags')) + ':</span><button type="button" class="chip' + (filter ? '' : ' on') + '" data-f="">' + esc(s('all')) + '</button>' +
          list.map(function (t) { return '<button type="button" class="chip' + (filter === t ? ' on' : '') + '" data-f="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') : '';
        $$('[data-f]', body).forEach(function (b) { b.onclick = function () { filter = b.dataset.f; draw(); }; });
        tbody.innerHTML = rowsHtml();
        wireCells();
      }
      var saving = null;
      function saveTags() {
        if (!runId) return;
        clearTimeout(saving);
        saving = setTimeout(async function () {
          var r = await J.api('/api/agent/runs/' + encodeURIComponent(runId) + '/tags', { method: 'PUT', body: { tags: tags } });
          if (!r.ok) J.toast(s('tagSaveErr'));
        }, 600);
      }
      tbody.addEventListener('click', function (e) {
        var x = e.target.closest('[data-tx]'), add = e.target.closest('[data-ta]');
        if (x) { var list = tags[x.dataset.tx] || []; list.splice(+x.dataset.ti, 1); if (!list.length) delete tags[x.dataset.tx]; draw(); saveTags(); return; }
        if (add) {
          var id = add.dataset.ta;
          var m = J.modal({ cls: 'sm', html: '<h2>' + esc(s('addTag')) + '</h2><div class="field" style="margin-top:12px"><input class="inp tb-tagin" maxlength="40" placeholder="' + esc(s('tagPh')) + '"></div>' +
            (allTags().length ? '<div class="tb-presets" style="margin-top:6px">' + allTags().map(function (t) { return '<button type="button" class="chip" data-pt="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
            '<div style="display:flex;justify-content:flex-end;margin-top:16px"><button type="button" class="pill" data-a="ok">' + esc(s('addCol')) + '</button></div>' });
          var inp = $('.tb-tagin', m.body);
          var put = function (t) {
            t = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 40);
            if (t) { var list = tags[id] || (tags[id] = []); if (list.indexOf(t) < 0 && list.length < 8) list.push(t); draw(); saveTags(); }
            m.close ? m.close() : m.el.remove();
          };
          $('[data-a=ok]', m.body).onclick = function () { put(inp.value); };
          inp.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); put(inp.value); } };
          $$('[data-pt]', m.body).forEach(function (b) { b.onclick = function () { put(b.dataset.pt); }; });
          setTimeout(function () { inp.focus(); }, 30);
        }
      });
      $('[data-a=xlsx]', body).onclick = async function () {
        var btn = this; btn.disabled = true;
        var r = await J.api('/api/agent/tabular-review/export', { method: 'POST', body: { columns: columns, rows: rows, tags: tags }, raw: true });
        btn.disabled = false;
        if (!r.ok) { J.toast(J.t('err.generic')); return; }
        var blob = await r.res.blob(), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'jadvalli-tahlil.xlsx';
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      };
      function wireCells() { $$('td[data-r]', body).forEach(function (td) {
        td.onclick = function () {
          var r = rows[+td.dataset.r], c = r.cells[td.dataset.c], col = columns.filter(function (x) { return x.id === td.dataset.c; })[0];
          var m = J.modal({ cls: 'sm', html: '<div class="kicker">' + esc(r.name) + '</div><h2 style="margin-bottom:10px">' + esc(col.label) + '</h2><p style="font-size:15px"></p>' +
            (c.quote ? '<h4 style="margin-top:16px">' + esc(s('quote')) + (c.page ? ' · ' + esc(s('page')) + ' ' + c.page : '') + '</h4><blockquote class="tb-q"></blockquote><p class="muted" style="font-size:12.5px">' + esc(c.verified ? s('verified') : s('unverified')) + '</p>' : '') });
          $('p', m.body).textContent = c.notFound ? s('notfound') : c.answer;
          var q = $('.tb-q', m.body); if (q) q.textContent = '«' + c.quote + '»';
        };
      }); }
      draw();
      $('[data-a=csv]', body).onclick = function () {
        var q = function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; };
        var lines = [[s('doc'), s('tags')].concat(columns.map(function (c) { return c.label; }), columns.map(function (c) { return c.label + ' — ' + s('quote'); })).map(q).join(',')];
        rows.forEach(function (r) {
          var cells = columns.map(function (c) { var x = r.cells && r.cells[c.id]; return x ? (x.notFound ? s('notfound') : x.answer) : s('failed'); });
          var quotes = columns.map(function (c) { var x = r.cells && r.cells[c.id]; return x && x.quote ? x.quote + (x.page ? ' (' + s('page') + ' ' + x.page + ')' : '') + (x.verified ? '' : ' [!]') : ''; });
          lines.push([r.name, (tags[r.docId] || []).join(', ')].concat(cells, quotes).map(q).join(','));
        });
        var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'jadvalli-tahlil.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      };
      if (J.wireMatterButton) J.wireMatterButton(body, function () { return { kind: 'agent_run', ref: d.runId, title: s('title') + ' — ' + rows.length + ' ' + s('doc').toLowerCase() }; });
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

    if (openRunId) follow(openRunId); else setup();
  };

  J.route(/^\/jadval$/, function () { J.viewTabular(); });
  J.route(/^\/jadval\/([0-9a-f-]{36})$/, function (id) { J.viewTabular(id); });
})(window);
