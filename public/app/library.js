/* Hujjatlarim (2026-10-29): yuklangan har bir hujjat (Word, PDF yoki skan) shu yerda, egasi o'chirmaguncha saqlanadi va
   keyingi amallarda qayta yuklamasdan tanlanadi — chat, hujjat tahlili, xulosa. Matn brauzerga qaytmaydi: xizmat hujjatni
   id (scanId) bo'yicha serverda o'qiydi. Server: src/documents/routes.js, src/ocr/scan-store.js (migratsiya 029). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { title: 'Hujjatlarim', lead: 'Yuklagan hujjatlaringiz shu yerda — siz o‘chirmaguningizcha saqlanadi. Keyingi safar qayta yuklamasdan tanlang.',
      sealed: 'Matnlar bazada shifrlangan holda saqlanadi.', notSealed: '', none: 'Hali hujjat yo‘q. Chatga yoki «Hujjat tahlili»ga fayl yuklang — u shu yerda qoladi.',
      pick: 'Hujjatlarimdan tanlash', choose: 'Tanlash', cancel: 'Bekor qilish', rename: 'Nomini o‘zgartirish', del: 'O‘chirish', delQ: 'Hujjat butunlay o‘chiriladi (matni ham). Davom etasizmi?',
      kinds: { text: 'Matnli', pdf: 'Skan PDF', image: 'Rasm' }, pages: '{n} bet', used: 'oxirgi ishlatilgan', added: 'qo‘shilgan', count: '{n} / {m} ta hujjat', search: 'Qidirish', max: 'Ko‘pi bilan {n} ta', edit: 'Muharrirda' },
    ru: { title: 'Мои документы', lead: 'Загруженные документы хранятся здесь, пока вы их не удалите. В следующий раз выберите без повторной загрузки.',
      sealed: 'Тексты хранятся в базе в зашифрованном виде.', notSealed: '', none: 'Документов пока нет. Загрузите файл в чат или в «Анализ документа» — он останется здесь.',
      pick: 'Выбрать из моих документов', choose: 'Выбрать', cancel: 'Отмена', rename: 'Переименовать', del: 'Удалить', delQ: 'Документ будет удалён полностью (вместе с текстом). Продолжить?',
      kinds: { text: 'Текстовый', pdf: 'Скан PDF', image: 'Изображение' }, pages: '{n} стр.', used: 'последнее использование', added: 'добавлен', count: '{n} / {m} документов', search: 'Поиск', max: 'Не более {n}', edit: 'В редакторе' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (typeof x === 'string' && v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  if (G.JAI_I18N) ['uz', 'ru', 'en'].forEach(function (l) { var d = G.JAI_I18N[l] = G.JAI_I18N[l] || {}; if (d['nav.docs'] === undefined) d['nav.docs'] = l === 'ru' ? 'Мои документы' : (l === 'en' ? 'My documents' : 'Hujjatlarim'); });

  function meta(d) {
    return [(s('kinds') || {})[d.kind] || d.kind, d.pages ? s('pages', { n: d.pages }) : '', J.fmtNum ? J.fmtNum(d.chars) + ' bel.' : '',
      (d.last_used_at ? s('used') + ' ' + J.fmtDate(d.last_used_at) : s('added') + ' ' + J.fmtDate(d.created_at))].filter(Boolean).join(' · ');
  }
  /** As a composer / analysis file: the service reads it by id on the server. */
  function asFile(d) { return { name: d.name || 'Hujjat', scanId: d.id, pages: d.pages, chars: d.chars, status: 'ready', fromLibrary: true }; }

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

  J.viewDocs = function () {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h2>' + esc(s('title')) + '</h2><p class="lib-lead"></p></div></div>' +
      '<div class="lib-ed"></div>' +
      '<div class="search" style="margin-bottom:14px">' + J.icon('search') + '<input class="inp" data-f="q" placeholder="' + esc(s('search')) + '"></div><div class="lib-l"><div class="skel"></div></div></div>');
    // the editor's documents and "open a Word / PDF" (public/app/editor.js)
    if (J.editorDocsBlock) J.editorDocsBlock($('.lib-ed', v));
    var all = [];
    function draw() {
      var q = ($('[data-f=q]', v).value || '').toLowerCase();
      var list = all.filter(function (d) { return !q || String(d.name || '').toLowerCase().indexOf(q) > -1; });
      $('.lib-l', v).innerHTML = list.length ? list.map(function (d) {
        return '<div class="mt-item lib-it" data-id="' + esc(d.id) + '"><span>' + J.icon(d.kind === 'text' ? 'doc' : 'scan') + '</span><span style="flex:1;min-width:0"><b class="lib-n" data-noalpha style="display:block;overflow-wrap:anywhere"></b><small class="muted">' + esc(meta(d)) + '</small></span>' +
          (J.openLibraryInEditor ? '<button class="pill sm ghost" type="button" data-ed="' + esc(d.id) + '">' + esc(s('edit')) + '</button>' : '') +
          '<button class="pill sm ghost" type="button" data-rn="' + esc(d.id) + '" aria-label="' + esc(s('rename')) + '">' + J.icon('pen') + '</button>' +
          '<button class="pill sm ghost" type="button" data-del="' + esc(d.id) + '" aria-label="' + esc(s('del')) + '">' + J.icon('trash') + '</button></div>';
      }).join('') : '<div class="empty-state">' + esc(s('none')) + '</div>';
      list.forEach(function (d) { var el = $('[data-id="' + d.id + '"] .lib-n', v); if (el) el.textContent = d.name || 'Hujjat'; });
      $$('[data-ed]', v).forEach(function (b) {
        b.onclick = function () { b.disabled = true; J.openLibraryInEditor(all.filter(function (x) { return x.id === b.dataset.ed; })[0]); };
      });
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
    J.api('/api/documents').then(function (r) {
      if (!r.ok) { $('.lib-l', v).innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      all = r.data.documents || [];
      // say "encrypted" only when the server says the texts are sealed
      $('.lib-lead', v).textContent = s('lead') + (r.data.sealed ? ' ' + s('sealed') : '') + ' ' + s('count', { n: all.length, m: r.data.max });
      draw();
    });
  };

  J.route(/^\/hujjatlarim$/, function () { J.viewDocs(); });
})(window);
