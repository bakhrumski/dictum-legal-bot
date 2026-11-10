/* Hujjatlarim (2026-10-29): yuklangan har bir hujjat (Word, PDF yoki skan) shu yerda, egasi o'chirmaguncha saqlanadi va
   keyingi amallarda qayta yuklamasdan tanlanadi — chat, hujjat tahlili, xulosa. Matn brauzerga qaytmaydi: xizmat hujjatni
   id (scanId) bo'yicha serverda o'qiydi. Server: src/documents/routes.js, src/ocr/scan-store.js (migratsiya 029). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { emptyBtn: 'Hujjat yuklash va tekshirish', runsBtn: 'Bir nechta hujjatni solishtirish', title: 'Hujjatlar', tabs: { yuklangan: 'Yuklanganlar', muharrir: 'Tahrirdagilar', natijalar: 'Natijalar' }, runsLead: 'Ko‘p hujjatni solishtirish, firma qoidalari bilan tekshirish, da’vo arizasi loyihasi va agent topshiriqlari natijalari — 90 kun saqlanadi (ishga qo‘shilgani ish ochiq turguncha).', runsNone: 'Hali natija yo‘q.', st: { done: 'tayyor', failed: 'xato', cancelled: 'bekor qilingan', budget: 'limit tugadi', needs_input: 'savolingizni kutmoqda', queued: 'navbatda', running: 'bajarilmoqda' }, lead: 'Yuklagan hujjatlaringiz shu yerda — siz o‘chirmaguningizcha saqlanadi. Keyingi safar qayta yuklamasdan tanlang.',
      sealed: 'Matnlar bazada shifrlangan holda saqlanadi.', notSealed: '', none: 'Hali hujjat yo‘q. Chatga yoki «Hujjat tahlili»ga fayl yuklang — u shu yerda qoladi.',
      pick: 'Hujjatlarimdan tanlash', choose: 'Tanlash', cancel: 'Bekor qilish', rename: 'Nomini o‘zgartirish', del: 'O‘chirish', delQ: 'Hujjat butunlay o‘chiriladi (matni ham). Davom etasizmi?',
      kinds: { text: 'Matnli', pdf: 'Skan PDF', image: 'Rasm' }, pages: '{n} bet', used: 'oxirgi ishlatilgan', added: 'qo‘shilgan', count: '{n} / {m} ta hujjat', search: 'Qidirish', max: 'Ko‘pi bilan {n} ta', edit: 'Muharrirda' },
    ru: { emptyBtn: 'Загрузить и проверить документ', runsBtn: 'Сравнить несколько документов', title: 'Документы', tabs: { yuklangan: 'Загруженные', muharrir: 'В редакторе', natijalar: 'Результаты' }, runsLead: 'Результаты сравнения документов, проверки по правилам фирмы, проекта иска и задач агента — хранятся 90 дней (добавленные в дело — пока дело открыто).', runsNone: 'Результатов пока нет.', st: { done: 'готово', failed: 'ошибка', cancelled: 'отменено', budget: 'лимит исчерпан', needs_input: 'ждёт ответа', queued: 'в очереди', running: 'выполняется' }, lead: 'Загруженные документы хранятся здесь, пока вы их не удалите. В следующий раз выберите без повторной загрузки.',
      sealed: 'Тексты хранятся в базе в зашифрованном виде.', notSealed: '', none: 'Документов пока нет. Загрузите файл в чат или в «Анализ документа» — он останется здесь.',
      pick: 'Выбрать из моих документов', choose: 'Выбрать', cancel: 'Отмена', rename: 'Переименовать', del: 'Удалить', delQ: 'Документ будет удалён полностью (вместе с текстом). Продолжить?',
      kinds: { text: 'Текстовый', pdf: 'Скан PDF', image: 'Изображение' }, pages: '{n} стр.', used: 'последнее использование', added: 'добавлен', count: '{n} / {m} документов', search: 'Поиск', max: 'Не более {n}', edit: 'В редакторе' },
    en: { emptyBtn: 'Upload and check a document', runsBtn: 'Compare several documents', title: 'Documents', tabs: { yuklangan: 'Uploaded', muharrir: 'In the editor', natijalar: 'Results' }, runsLead: 'Results of document comparison, firm-rule checks, claim drafts and agent tasks — kept 90 days (one added to a matter stays while the matter is open).', runsNone: 'No results yet.', st: { done: 'done', failed: 'failed', cancelled: 'cancelled', budget: 'limit reached', needs_input: 'waiting for your answer', queued: 'queued', running: 'running' }, lead: 'The documents you uploaded are here — kept until you delete them. Next time, pick one without uploading again.',
      sealed: 'Texts are stored encrypted.', notSealed: '', none: 'No documents yet. Upload a file in the chat or in Document review — it stays here.',
      pick: 'Pick from my documents', choose: 'Choose', cancel: 'Cancel', rename: 'Rename', del: 'Delete', delQ: 'The document is deleted for good (its text too). Continue?',
      kinds: { text: 'Text', pdf: 'Scanned PDF', image: 'Image' }, pages: '{n} p.', used: 'last used', added: 'added', count: '{n} / {m} documents', search: 'Search', max: 'At most {n}', edit: 'In the editor' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (typeof x === 'string' && v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  if (G.JAI_I18N) ['uz', 'ru', 'en'].forEach(function (l) { var d = G.JAI_I18N[l] = G.JAI_I18N[l] || {}; if (d['nav.docs'] === undefined) d['nav.docs'] = l === 'ru' ? 'Мои документы' : (l === 'en' ? 'My documents' : 'Hujjatlarim'); });

  function meta(d) {
    return [(s('kinds') || {})[d.kind] || d.kind, d.pages ? s('pages', { n: d.pages }) : '', J.fmtNum ? J.fmtNum(d.chars) + ' bel.' : '',
      (d.last_used_at ? s('used') + ' ' + J.fmtDate(d.last_used_at) : s('added') + ' ' + J.fmtDate(d.created_at))].filter(Boolean).join(' · ');
  }
  /** As a composer / analysis file: the service reads it by id on the server. */
  function asFile(d) { return { name: d.name || 'Hujjat', scanId: d.id, pages: d.pages, chars: d.chars, status: 'ready', fromLibrary: true, kind: d.kind }; }

  /** Pick documents from the library: resolves with [file] (empty when cancelled). opts.max: how many at most. */
  J.pickDocs = function (opts) {
    opts = opts || {};
    var max = opts.max || 5;
    return new Promise(function (done) {
      var m = J.modal({ onClose: function () { done([]); }, html: '<h2>' + esc(s('pick')) + '</h2><p class="muted" style="font-size:13px">' + esc(s('max', { n: max })) + '</p>' +
        '<div class="search" style="margin:12px 0">' + J.icon('search') + '<input class="inp" data-f="q" placeholder="' + esc(s('search')) + '"></div><div class="lib-pl" style="max-height:52vh;overflow:auto"><div class="skel"></div></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="pill ghost" type="button" data-a="no">' + esc(s('cancel')) + '</button><button class="pill" type="button" data-a="ok" disabled>' + esc(s('choose')) + '</button></div>' });
      var all = [], chosen = {};
      function draw() {
        var q = ($('[data-f=q]', m.body).value || '').toLowerCase();
        var list = all.filter(function (d) { return !q || String(d.name || '').toLowerCase().indexOf(q) > -1; });
        $('.lib-pl', m.body).innerHTML = list.length ? list.map(function (d) {
          return '<label class="lib-row" style="display:flex;gap:10px;align-items:flex-start;padding:10px 4px;border-bottom:1px solid var(--line, rgba(0,0,0,.08));cursor:pointer">' +
            '<input type="checkbox" data-id="' + esc(d.id) + '"' + (chosen[d.id] ? ' checked' : '') + ' style="margin-top:3px"><span style="min-width:0"><b class="lib-n" data-noalpha style="font-weight:500;display:block;overflow-wrap:anywhere"></b><small class="muted">' + esc(meta(d)) + '</small></span></label>';
        }).join('') : '<div class="empty-state">' + esc(s('none')) + '</div>';
        list.forEach(function (d) { var el = $('[data-id="' + d.id + '"]', m.body); if (el) $('.lib-n', el.parentNode).textContent = d.name || 'Hujjat'; });
        $$('[data-id]', m.body).forEach(function (c) {
          c.onchange = function () {
            if (c.checked && Object.keys(chosen).length >= max) { c.checked = false; J.toast(s('max', { n: max })); return; }
            if (c.checked) chosen[c.dataset.id] = all.filter(function (d) { return d.id === c.dataset.id; })[0]; else delete chosen[c.dataset.id];
            $('[data-a=ok]', m.body).disabled = !Object.keys(chosen).length;
          };
        });
      }
      $('[data-f=q]', m.body).oninput = draw;
      $('[data-a=no]', m.body).onclick = function () { m.close(); };
      $('[data-a=ok]', m.body).onclick = function () { var out = Object.keys(chosen).map(function (k) { return asFile(chosen[k]); }); m.el.remove(); done(out); };
      J.api('/api/documents').then(function (r) { all = r.ok ? (r.data.documents || []) : []; draw(); });
    });
  };

  /* U1 (docs/design/ux-audit-2026-11.md): one "Hujjatlar" page, three tabs - uploaded, in the editor, results */
  var TABS = ['yuklangan', 'muharrir', 'natijalar'];
  J.viewDocs = function (tab) {
    tab = TABS.indexOf(tab) > -1 ? tab : 'yuklangan';
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h2>' + esc(s('title')) + '</h2></div></div>' +
      '<div class="tabs lib-tabs" role="tablist">' + TABS.map(function (k) { return '<button type="button" role="tab" data-tab="' + k + '"' + (k === tab ? ' class="on" aria-selected="true"' : ' aria-selected="false"') + '>' + esc(s('tabs')[k]) + '</button>'; }).join('') + '</div>' +
      '<div class="lib-pane"></div></div>');
    $$('.lib-tabs [data-tab]', v).forEach(function (b) {
      // the tab is in the address, so "back" and a shared link land on it; replaceState keeps one history entry per page
      b.onclick = function () { if (b.dataset.tab === tab) return; try { history.replaceState(null, '', '#/hujjatlarim?' + b.dataset.tab); } catch (e) {} J.viewDocs(b.dataset.tab); };
    });
    var pane = $('.lib-pane', v);
    if (tab === 'muharrir') {
      // the editor's documents and "open a Word / PDF" (public/app/editor.js)
      if (J.editorDocsBlock) J.editorDocsBlock(pane);
      return;
    }
    if (tab === 'natijalar') { drawRuns(pane); return; }
    pane.innerHTML = '<p class="lib-lead muted" style="margin:0 0 14px"></p><div class="search" style="margin-bottom:14px">' + J.icon('search') + '<input class="inp" data-f="q" placeholder="' + esc(s('search')) + '"></div><div class="lib-l"><div class="skel"></div></div>';
    var all = [];
    function draw() {
      var q = ($('[data-f=q]', v).value || '').toLowerCase();
      var list = all.filter(function (d) { return !q || String(d.name || '').toLowerCase().indexOf(q) > -1; });
      $('.lib-l', v).innerHTML = list.length ? list.map(function (d) {
        return '<div class="mt-item lib-it" data-id="' + esc(d.id) + '"><span>' + J.icon(d.kind === 'text' ? 'doc' : 'scan') + '</span><span style="flex:1;min-width:0"><b class="lib-n" data-noalpha style="display:block;overflow-wrap:anywhere"></b><small class="muted">' + esc(meta(d)) + '</small></span>' +
          // U3: everything this document can go to, with its price, in one card (docact.js)
          (J.docActionsModal ? '<button class="pill sm" type="button" data-da="' + esc(d.id) + '">' + esc(J.docActText('act')) + '</button>' : '') +
          (J.openLibraryInEditor ? '<button class="pill sm ghost" type="button" data-ed="' + esc(d.id) + '">' + esc(s('edit')) + '</button>' : '') +
          // K2b: into the firm's searchable base (a text document; a scan has its text after OCR too)
          (J.kbAdd ? '<button class="pill sm ghost" type="button" data-kb="' + esc(d.id) + '" title="' + esc(J.kbText('toKb')) + '" aria-label="' + esc(J.kbText('toKb')) + '">' + J.icon('layers') + '</button>' : '') +
          '<button class="pill sm ghost" type="button" data-rn="' + esc(d.id) + '" aria-label="' + esc(s('rename')) + '">' + J.icon('pen') + '</button>' +
          '<button class="pill sm ghost" type="button" data-del="' + esc(d.id) + '" aria-label="' + esc(s('del')) + '">' + J.icon('trash') + '</button></div>';
      // U2: an empty page says what goes here and offers the one step that fills it
      }).join('') : (all.length ? '<div class="empty-state">' + esc(s('none')) + '</div>' : '<div class="empty-state st-empty"><p>' + esc(s('none')) + '</p><a class="pill sm" href="#/tahlil">' + esc(s('emptyBtn')) + '</a></div>');
      list.forEach(function (d) { var el = $('[data-id="' + d.id + '"] .lib-n', v); if (el) el.textContent = d.name || 'Hujjat'; });
      $$('[data-ed]', v).forEach(function (b) {
        b.onclick = function () { b.disabled = true; J.openLibraryInEditor(all.filter(function (x) { return x.id === b.dataset.ed; })[0]); };
      });
      $$('[data-da]', v).forEach(function (b) {
        b.onclick = function () { var d = all.filter(function (x) { return x.id === b.dataset.da; })[0]; if (d) J.docActionsModal(asFile(d)); };
      });
      $$('[data-kb]', v).forEach(function (b) { b.onclick = async function () { b.disabled = true; await J.kbAdd({ kind: 'library', id: b.dataset.kb }); b.disabled = false; }; });
      $$('[data-rn]', v).forEach(function (b) {
        b.onclick = async function () {
          var d = all.filter(function (x) { return x.id === b.dataset.rn; })[0];
          var name = G.prompt(s('rename'), d.name || '');
          if (name == null || !name.trim()) return;
          var r = await J.api('/api/documents/' + encodeURIComponent(d.id), { method: 'PATCH', body: { name: name.trim() } });
          if (!r.ok) { J.toast(J.errMsg(r.data)); return; }
          d.name = name.trim(); draw();
        };
      });
      $$('[data-del]', v).forEach(function (b) {
        b.onclick = async function () {
          if (!(await J.confirm(s('delQ'), s('del')))) return;
          var r = await J.api('/api/documents/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
          if (!r.ok) { J.toast(J.errMsg(r.data)); return; }
          all = all.filter(function (x) { return x.id !== b.dataset.del; }); draw();
        };
      });
    }
    $('[data-f=q]', v).oninput = draw;
    // U3: a file dropped anywhere on the page is read (kept here) and gets "Nima qilaylik?"
    if (J.bindDocDrop) J.bindDocDrop(v, function () { J.api('/api/documents').then(function (r) { if (r.ok && document.body.contains(v)) { all = r.data.documents || []; draw(); } }); });
    // opened from search (find.js): the document's name is the filter
    if (J.libQuery) { $('[data-f=q]', v).value = J.libQuery; J.libQuery = ''; }
    J.api('/api/documents').then(function (r) {
      if (!r.ok) { $('.lib-l', v).innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      all = r.data.documents || [];
      // say "encrypted" only when the server says the texts are sealed
      $('.lib-lead', v).textContent = s('lead') + (r.data.sealed ? ' ' + s('sealed') : '') + ' ' + s('count', { n: all.length, m: r.data.max });
      draw();
    });
  };

  /** Natijalar: the person's agent runs (GET /api/agent/runs, own only); a table review opens its page, the rest a window (matters.js). */
  function drawRuns(pane) {
    pane.innerHTML = '<p class="muted" style="margin:0 0 14px">' + esc(s('runsLead')) + '</p><div class="rows lib-runs"><div class="skel"></div></div>';
    var box = $('.lib-runs', pane);
    J.api('/api/agent/runs?limit=100').then(function (r) {
      if (!document.body.contains(box)) return;
      if (!r.ok) { box.innerHTML = '<div class="empty-state">' + esc(r.status === 404 ? s('runsNone') : J.errMsg(r.data)) + '</div>'; return; }
      var list = (r.data.runs || []).filter(function (x) { return x.status !== 'awaiting_approval'; });
      if (!list.length) { box.innerHTML = '<div class="empty-state st-empty"><p>' + esc(s('runsNone')) + '</p><a class="pill sm" href="#/jadval">' + esc(s('runsBtn')) + '</a></div>'; return; }
      box.innerHTML = list.map(function (x, i) {
        return '<a class="fd-row" href="#" data-i="' + i + '"><span class="fd-ic">' + J.icon(x.workflow === 'tabular_review' ? 'layers' : 'spark') + '</span><span class="fd-t"><b></b><small class="muted"></small></span></a>';
      }).join('');
      $$('.fd-row', box).forEach(function (a) {
        var x = list[+a.dataset.i], item = { kind: 'run', id: x.id, title: '', at: x.finishedAt || x.createdAt, meta: { workflow: x.workflow, status: x.status } };
        $('b', a).textContent = J.itemTitle ? J.itemTitle(item) : x.workflow;
        $('small', a).textContent = [(s('st') || {})[x.status] || x.status, J.fmtDate(item.at)].join(' · ');
        a.onclick = function (e) { e.preventDefault(); if (J.openItem) J.openItem(item); };
      });
    });
  }

  J.route(/^\/hujjatlarim(?:\?(\w+))?$/, function (tab) { J.viewDocs(tab); });
})(window);
