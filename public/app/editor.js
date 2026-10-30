/* Hujjat muharriri, D1 (docs/design/hujjat-muharriri.md; egasi 2026-10-30: "Platformaning o'zida Word kabi ochiladi
   va shu joyida o'zgartirishlar kiritiladi"). AI loyiha, yuklangan Word/PDF yoki Hujjatlarimdagi hujjat A4 sahifada ochiladi,
   asboblar paneli bilan tahrirlanadi, o'zi saqlanadi (versiyalar bilan), Word yoki PDF qilib yuklab olinadi.
   Muharrir kodi: /vendor/editor (TipTap, MIT, bir marta yig'ilgan); faqat shu sahifa ochilganda yuklanadi.
   Server: src/editor/ (migratsiya 036). Birgalikda tahrir, izohlar, AI paneli — D2-D5. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var BUNDLE = '/vendor/editor/editor-3.31.4.js';
  var S = {
    uz: { title: 'Muharrir', docs: 'Muharrirdagi hujjatlar', none: 'Hali hujjat yo‘q. Bo‘sh hujjat oching yoki Word / PDF faylni yuklang.',
      blank: 'Bo‘sh hujjat', open: 'Word / PDF ochish', openHint: 'Word (.docx) formatlash bilan ochiladi; PDF — matn sifatida.',
      inEditor: 'Muharrirda ochish', untitled: 'Nomsiz hujjat', saving: 'Saqlanmoqda…', saved: 'Saqlandi', unsaved: 'Saqlanmadi — qayta urinilmoqda',
      stale: 'Bu hujjat boshqa oynada o‘zgartirilgan. Yo‘qotmaslik uchun saqlash to‘xtatildi.', reload: 'Qayta yuklash',
      download: 'Yuklab olish', word: 'Word (.docx)', pdf: 'PDF (chop etish oynasi)', versions: 'Versiyalar', saveVer: 'Versiyani saqlash', verLabel: 'Versiya nomi (ixtiyoriy)',
      restore: 'Tiklash', view: 'Ko‘rish', restoreQ: 'Shu versiya tiklansinmi? Hozirgi matn ham versiya bo‘lib saqlanadi.', restored: 'Versiya tiklandi',
      kinds: { auto: 'avto', named: 'nomli', restore: 'tiklashdan oldin' }, noVer: 'Hali versiya yo‘q — birinchisi 10 daqiqada o‘zi saqlanadi.',
      del: 'O‘chirish', delQ: 'Hujjat va uning barcha versiyalari butunlay o‘chiriladi. Davom etasizmi?', back: 'Hujjatlarim',
      page: 'Sahifa {n} / {m}', chars: '{n} belgi', loading: 'Muharrir yuklanmoqda…', loadFail: 'Muharrirni yuklab bo‘lmadi. Sahifani yangilang.',
      notes: 'Ochishda saqlanmagan qismlar:', note: { header_footer: 'yuqori / pastki kolontitul', footnotes: 'sahifa osti izohlari', comments: 'Word izohlari',
        tracked_changes: 'Track Changes (qabul qilingan ko‘rinish olindi)', images: 'rasmlar', pdf_layout: 'PDF sahifa ko‘rinishi (matn olindi)', plain_text: 'formatlash (matn olindi)', unreadable_parts: 'faylning ayrim qismlari' },
      notesTail: 'Asl faylingiz o‘zgarmaydi.', ph: 'Hujjat matnini yozing…', table: 'Jadval', undo: 'Bekor qilish', redo: 'Qaytarish',
      color: 'Matn rangi', hl: 'Belgilash', font: 'Shrift', size: 'O‘lcham', bullet: 'Belgili ro‘yxat', ordered: 'Raqamli ro‘yxat', h: 'Sarlavha', para: 'Oddiy matn',
      left: 'Chapga', center: 'Markazga', right: 'O‘ngga', justify: 'Ikki tomonga', created: 'Hujjat yaratildi', busy: 'Ochilmoqda…' },
    ru: { title: 'Редактор', docs: 'Документы в редакторе', none: 'Документов пока нет. Создайте пустой или откройте файл Word / PDF.',
      blank: 'Пустой документ', open: 'Открыть Word / PDF', openHint: 'Word (.docx) открывается с форматированием; PDF — как текст.',
      inEditor: 'Открыть в редакторе', untitled: 'Документ без названия', saving: 'Сохранение…', saved: 'Сохранено', unsaved: 'Не сохранено — повторяем',
      stale: 'Документ изменён в другой вкладке. Сохранение остановлено, чтобы ничего не потерять.', reload: 'Обновить',
      download: 'Скачать', word: 'Word (.docx)', pdf: 'PDF (окно печати)', versions: 'Версии', saveVer: 'Сохранить версию', verLabel: 'Название версии (необязательно)',
      restore: 'Восстановить', view: 'Просмотр', restoreQ: 'Восстановить эту версию? Текущий текст тоже сохранится как версия.', restored: 'Версия восстановлена',
      kinds: { auto: 'авто', named: 'именная', restore: 'перед восстановлением' }, noVer: 'Версий пока нет — первая сохранится сама через 10 минут.',
      del: 'Удалить', delQ: 'Документ и все его версии будут удалены. Продолжить?', back: 'Мои документы',
      page: 'Стр. {n} / {m}', chars: '{n} знаков', loading: 'Загрузка редактора…', loadFail: 'Не удалось загрузить редактор. Обновите страницу.',
      notes: 'При открытии не сохранены:', note: { header_footer: 'колонтитулы', footnotes: 'сноски', comments: 'примечания Word', tracked_changes: 'исправления (взят принятый вид)',
        images: 'изображения', pdf_layout: 'вид страниц PDF (взят текст)', plain_text: 'форматирование (взят текст)', unreadable_parts: 'некоторые части файла' },
      notesTail: 'Исходный файл не меняется.', ph: 'Введите текст документа…', table: 'Таблица', undo: 'Отменить', redo: 'Повторить',
      color: 'Цвет текста', hl: 'Выделение', font: 'Шрифт', size: 'Размер', bullet: 'Маркированный список', ordered: 'Нумерованный список', h: 'Заголовок', para: 'Обычный текст',
      left: 'По левому краю', center: 'По центру', right: 'По правому краю', justify: 'По ширине', created: 'Документ создан', busy: 'Открывается…' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (typeof x === 'string' && v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }

  var kitP = null;
  function loadKit() {
    if (G.JAIEditorKit) return Promise.resolve(G.JAIEditorKit);
    if (kitP) return kitP;
    kitP = new Promise(function (ok, no) {
      var sc = document.createElement('script'); sc.src = BUNDLE; sc.async = true;
      sc.onload = function () { G.JAIEditorKit ? ok(G.JAIEditorKit) : no(new Error('kit')); };
      sc.onerror = function () { kitP = null; no(new Error('load')); };
      document.head.appendChild(sc);
    });
    return kitP;
  }

  /* ---------- kirish nuqtalari: AI loyiha, Hujjatlarim, fayl ---------- */
  J.openInEditor = async function (title, html) {
    var r = await J.api('/api/editor/docs', { method: 'POST', body: { title: title || s('untitled'), html: html || '', source: 'draft' } });
    if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
    J.go('#/muharrir/' + r.data.id);
  };
  J.openLibraryInEditor = async function (doc) {
    var r = await J.api('/api/editor/docs', { method: 'POST', body: { libraryId: doc.id, title: doc.name || '' } });
    if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
    J.go('#/muharrir/' + r.data.id);
  };
  J.editorUploadButton = function () { return '<button class="pill sm" type="button" data-a="ed-open">' + J.icon('up') + esc(s('open')) + '</button><input type="file" data-f="ed-file" accept=".docx,.pdf,.txt" hidden>'; };
  J.wireEditorUpload = function (root) {
    var b = $('[data-a=ed-open]', root), f = $('[data-f=ed-file]', root);
    if (!b || !f) return;
    b.onclick = function () { f.click(); };
    f.onchange = async function () {
      var file = f.files && f.files[0]; f.value = '';
      if (!file) return;
      b.disabled = true; var old = b.innerHTML; b.innerHTML = '<span class="spin"></span>' + esc(s('busy'));
      var fd = new FormData(); fd.append('file', file);
      var r = await J.api('/api/editor/import', { method: 'POST', body: fd });
      b.disabled = false; b.innerHTML = old;
      if (!r.ok) { J.toast(J.errMsg(r.data), 7000); return; }
      J.go('#/muharrir/' + r.data.id);
    };
  };

  /** The editor documents block on Hujjatlarim (library.js calls it). */
  J.editorDocsBlock = function (host) {
    host.innerHTML = '<div class="ed-block"><div class="ed-bh"><h3>' + esc(s('docs')) + '</h3><div class="ed-bb"><button class="pill sm ghost" type="button" data-a="ed-blank">' + J.icon('plus') + esc(s('blank')) + '</button>' + J.editorUploadButton() + '</div></div>' +
      '<p class="muted ed-hint">' + esc(s('openHint')) + '</p><div class="ed-list"><div class="skel"></div></div></div>';
    J.wireEditorUpload(host);
    $('[data-a=ed-blank]', host).onclick = function () { J.openInEditor(s('untitled'), ''); };
    J.api('/api/editor/docs').then(function (r) {
      var box = $('.ed-list', host);
      if (!r.ok) { box.innerHTML = r.status === 503 ? '' : '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      var list = r.data.documents || [];
      box.innerHTML = list.length ? list.slice(0, 50).map(function (d) {
        return '<a class="mt-item ed-it" href="#/muharrir/' + esc(d.id) + '"><span>' + J.icon('pen') + '</span><span style="flex:1;min-width:0"><b class="ed-n" data-noalpha style="display:block;overflow-wrap:anywhere"></b><small class="muted">' +
          esc(s('chars', { n: J.fmtNum(d.chars) }) + ' · ' + J.fmtDate(d.updated_at)) + '</small></span></a>';
      }).join('') : '<div class="empty-state" style="padding:14px 4px;text-align:left">' + esc(s('none')) + '</div>';
      list.slice(0, 50).forEach(function (d) { var el = $('a[href="#/muharrir/' + d.id + '"] .ed-n', box); if (el) el.textContent = d.title; });
    });
  };

  /* ---------- muharrir sahifasi ---------- */
  var FONTS = ['Arial', 'Times New Roman', 'Calibri', 'Golos Text'];
  var SIZES = ['10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt'];
  var PAGE_PX = 1123; // A4 at 96 dpi

  J.viewEditor = async function (id) {
    J.setTitle(s('title'));
    var v = J.mount('<div class="ed-wrap"><div class="ed-top"><a class="ed-back" href="#/hujjatlarim">' + J.icon('back') + '<span>' + esc(s('back')) + '</span></a>' +
      '<input class="ed-title" maxlength="200" aria-label="' + esc(s('title')) + '"><span class="ed-st muted"></span><span class="ed-sp"></span>' +
      '<button class="pill sm ghost" type="button" data-a="ver">' + esc(s('versions')) + '</button>' +
      '<div class="ed-dl"><button class="pill sm" type="button" data-a="dl">' + J.icon('up') + esc(s('download')) + '</button><div class="ed-menu" hidden><button type="button" data-a="docx">' + J.icon('word') + esc(s('word')) + '</button><button type="button" data-a="pdf">' + J.icon('doc') + esc(s('pdf')) + '</button><button type="button" data-a="del" class="ed-del">' + J.icon('trash') + esc(s('del')) + '</button></div></div></div>' +
      '<div class="ed-bar" role="toolbar"></div><div class="ed-banner" hidden></div>' +
      '<div class="ed-scroll"><div class="ed-paper"><div class="ed-loading muted">' + esc(s('loading')) + '</div></div></div><div class="ed-foot muted"><span class="ed-pg"></span><span class="ed-cc"></span></div></div>');
    document.body.classList.add('ed-on');
    var r = await J.api('/api/editor/docs/' + encodeURIComponent(id));
    if (!r.ok) { $('.ed-paper', v).innerHTML = '<div class="empty-state">' + esc(r.status === 404 ? J.t('err.notFound') || 'Topilmadi' : J.errMsg(r.data)) + '</div>'; return; }
    var doc = r.data, rev = doc.revision, dirty = false, saving = false, stopped = false, timer = null, titleDirty = false;
    var titleIn = $('.ed-title', v); titleIn.value = doc.title;
    J.setTitle(doc.title);
    if (doc.importNotes && doc.importNotes.length) {
      var bn = $('.ed-banner', v); bn.hidden = false;
      bn.textContent = s('notes') + ' ' + doc.importNotes.map(function (k) { return (s('note') || {})[k] || k; }).join(', ') + '. ' + s('notesTail');
    }
    var kit;
    try { kit = await loadKit(); } catch (e) { $('.ed-paper', v).innerHTML = '<div class="empty-state">' + esc(s('loadFail')) + '</div>'; return; }
    if (!document.body.contains(v)) return;
    var paper = $('.ed-paper', v); paper.innerHTML = '';
    var ed = new kit.Editor({ element: paper, extensions: kit.extensions({ placeholder: s('ph') }), content: doc.html || '<p></p>',
      editorProps: { attributes: { class: 'ed-doc', spellcheck: 'false', 'data-noalpha': '' } },
      onUpdate: function () { dirty = true; status('saving'); schedule(); counts(); },
      onSelectionUpdate: function () { syncBar(); } });
    var st = $('.ed-st', v);
    function status(k) { st.textContent = k ? s(k) : ''; st.dataset.k = k || ''; }
    status('saved');

    /* saqlash: 1,5 soniya jimlikdan keyin; eskirgan revision — to'xtaydi va aytadi */
    function schedule() { clearTimeout(timer); timer = setTimeout(save, 1500); }
    async function save() {
      if (stopped || saving || (!dirty && !titleDirty)) return;
      saving = true;
      var body = { revision: rev };
      if (dirty) body.html = ed.getHTML();
      if (titleDirty) body.title = titleIn.value;
      dirty = false; titleDirty = false;
      var x = await J.api('/api/editor/docs/' + encodeURIComponent(id), { method: 'PUT', body: body });
      saving = false;
      if (x.ok) { rev = x.data.revision; status(dirty || titleDirty ? 'saving' : 'saved'); if (dirty || titleDirty) schedule(); return; }
      if (x.status === 409) {
        stopped = true; status('');
        var bn2 = $('.ed-banner', v); bn2.hidden = false;
        bn2.innerHTML = esc(s('stale')) + ' <button type="button" class="pill sm ghost" data-a="reload">' + esc(s('reload')) + '</button>';
        $('[data-a=reload]', bn2).onclick = function () { J.viewEditor(id); };
        return;
      }
      if (body.html != null) dirty = true;
      if (body.title != null) titleDirty = true;
      status('unsaved'); clearTimeout(timer); timer = setTimeout(save, 5000);
    }
    titleIn.oninput = function () { titleDirty = true; status('saving'); schedule(); };
    titleIn.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); ed.commands.focus('start'); } };
    function flush() { clearTimeout(timer); return save(); }
    var beforeUnload = function (e) { if (dirty || titleDirty || saving) { e.preventDefault(); e.returnValue = ''; } };
    G.addEventListener('beforeunload', beforeUnload);
    G.addEventListener('hashchange', function off() {
      G.removeEventListener('hashchange', off); G.removeEventListener('beforeunload', beforeUnload);
      document.body.classList.remove('ed-on');
      if (dirty || titleDirty) save(); // the last edits are sent even when leaving
      setTimeout(function () { try { ed.destroy(); } catch (e) { /* allaqachon */ } }, 2000);
    });

    /* asboblar paneli */
    var bar = $('.ed-bar', v);
    function btn(a, icon, label) { return '<button type="button" class="ed-b" data-c="' + a + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + icon + '</button>'; }
    bar.innerHTML =
      '<select class="ed-sel" data-c="block" aria-label="' + esc(s('h')) + '"><option value="p">' + esc(s('para')) + '</option><option value="1">' + esc(s('h')) + ' 1</option><option value="2">' + esc(s('h')) + ' 2</option><option value="3">' + esc(s('h')) + ' 3</option></select>' +
      '<select class="ed-sel" data-c="font" aria-label="' + esc(s('font')) + '"><option value="">' + esc(s('font')) + '</option>' + FONTS.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('') + '</select>' +
      '<select class="ed-sel sm" data-c="size" aria-label="' + esc(s('size')) + '"><option value="">' + esc(s('size')) + '</option>' + SIZES.map(function (z) { return '<option value="' + z + '">' + parseInt(z, 10) + '</option>'; }).join('') + '</select><span class="ed-sep"></span>' +
      btn('bold', '<b>B</b>', 'Bold') + btn('italic', '<i>I</i>', 'Italic') + btn('underline', '<u>U</u>', 'Underline') + btn('strike', '<s>S</s>', 'Strike') +
      '<label class="ed-b ed-col" title="' + esc(s('color')) + '"><span style="text-decoration:underline">A</span><input type="color" data-c="color" value="#c00000" aria-label="' + esc(s('color')) + '"></label>' +
      '<label class="ed-b ed-col" title="' + esc(s('hl')) + '"><span class="ed-hl">ab</span><input type="color" data-c="hl" value="#fff59d" aria-label="' + esc(s('hl')) + '"></label><span class="ed-sep"></span>' +
      btn('left', '<span class="ed-al l"></span>', s('left')) + btn('center', '<span class="ed-al c"></span>', s('center')) + btn('right', '<span class="ed-al r"></span>', s('right')) + btn('justify', '<span class="ed-al j"></span>', s('justify')) + '<span class="ed-sep"></span>' +
      btn('bullet', '•≡', s('bullet')) + btn('ordered', '1≡', s('ordered')) + btn('table', '▦', s('table')) + '<span class="ed-sep"></span>' +
      btn('undo', '↶', s('undo')) + btn('redo', '↷', s('redo'));
    var C = function () { return ed.chain().focus(); };
    var ACT = {
      bold: function () { C().toggleBold().run(); }, italic: function () { C().toggleItalic().run(); }, underline: function () { C().toggleUnderline().run(); }, strike: function () { C().toggleStrike().run(); },
      left: function () { C().setTextAlign('left').run(); }, center: function () { C().setTextAlign('center').run(); }, right: function () { C().setTextAlign('right').run(); }, justify: function () { C().setTextAlign('justify').run(); },
      bullet: function () { C().toggleBulletList().run(); }, ordered: function () { C().toggleOrderedList().run(); },
      table: function () { C().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run(); },
      undo: function () { C().undo().run(); }, redo: function () { C().redo().run(); }
    };
    $$('[data-c]', bar).forEach(function (b) {
      if (b.tagName === 'BUTTON') { b.addEventListener('mousedown', function (e) { e.preventDefault(); }); b.onclick = function () { ACT[b.dataset.c](); syncBar(); }; }
    });
    $('[data-c=block]', bar).onchange = function () { var x = this.value; if (x === 'p') C().setParagraph().run(); else C().toggleHeading({ level: +x }).run(); };
    $('[data-c=font]', bar).onchange = function () { this.value ? C().setFontFamily(this.value).run() : C().unsetFontFamily().run(); };
    $('[data-c=size]', bar).onchange = function () { this.value ? C().setFontSize(this.value).run() : C().unsetFontSize().run(); };
    $('[data-c=color]', bar).oninput = function () { C().setColor(this.value).run(); };
    $('[data-c=hl]', bar).oninput = function () { C().toggleHighlight({ color: this.value }).run(); };
    function syncBar() {
      ['bold', 'italic', 'underline', 'strike', 'bulletList', 'orderedList'].forEach(function (m) {
        var b = $('[data-c="' + ({ bulletList: 'bullet', orderedList: 'ordered' }[m] || m) + '"]', bar); if (b) b.classList.toggle('on', ed.isActive(m));
      });
      ['left', 'center', 'right', 'justify'].forEach(function (a) { var b = $('[data-c=' + a + ']', bar); if (b) b.classList.toggle('on', ed.isActive({ textAlign: a })); });
      var bl = $('[data-c=block]', bar); bl.value = ed.isActive('heading', { level: 1 }) ? '1' : ed.isActive('heading', { level: 2 }) ? '2' : ed.isActive('heading', { level: 3 }) ? '3' : 'p';
      var ts = ed.getAttributes('textStyle') || {};
      $('[data-c=font]', bar).value = FONTS.indexOf(String(ts.fontFamily || '').replace(/["']/g, '')) > -1 ? String(ts.fontFamily).replace(/["']/g, '') : '';
      $('[data-c=size]', bar).value = SIZES.indexOf(ts.fontSize) > -1 ? ts.fontSize : '';
    }

    /* sahifa va belgi soni (A4 balandligi bo'yicha, taxminan — Word'da sahifa chegaralari biroz farq qilishi mumkin) */
    var scroller = $('.ed-scroll', v);
    function counts() {
      var h = paper.scrollHeight, m = Math.max(1, Math.ceil(h / PAGE_PX));
      var n = Math.min(m, Math.max(1, Math.floor((scroller.scrollTop + scroller.clientHeight / 3) / PAGE_PX) + 1));
      $('.ed-pg', v).textContent = s('page', { n: n, m: m });
      var cc = ed.storage.characterCount ? ed.storage.characterCount.characters() : ed.getText().length;
      $('.ed-cc', v).textContent = s('chars', { n: J.fmtNum(cc) });
    }
    scroller.addEventListener('scroll', counts, { passive: true });
    counts(); syncBar();

    /* yuklab olish, versiyalar, o'chirish */
    var menu = $('.ed-menu', v);
    $('[data-a=dl]', v).onclick = function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', function () { menu.hidden = true; });
    $('[data-a=docx]', v).onclick = async function () { await flush(); location.href = '/api/editor/docs/' + encodeURIComponent(id) + '/export.docx'; };
    $('[data-a=pdf]', v).onclick = async function () { await flush(); document.title = titleIn.value || 'Hujjat'; G.print(); };
    $('[data-a=del]', v).onclick = async function () {
      if (!(await J.confirm(s('delQ'), s('del')))) return;
      stopped = true; dirty = false; titleDirty = false;
      var x = await J.api('/api/editor/docs/' + encodeURIComponent(id), { method: 'DELETE' });
      if (!x.ok) { J.toast(J.errMsg(x.data)); return; }
      J.go('#/hujjatlarim');
    };
    $('[data-a=ver]', v).onclick = async function () {
      await flush();
      var m = J.modal({ html: '<h2>' + esc(s('versions')) + '</h2><div class="ed-vn"><input class="inp" maxlength="120" data-f="vl" placeholder="' + esc(s('verLabel')) + '"><button class="pill sm" type="button" data-a="vs">' + esc(s('saveVer')) + '</button></div><div class="ed-vl"><div class="skel"></div></div>' });
      async function load() {
        var x = await J.api('/api/editor/docs/' + encodeURIComponent(id) + '/versions');
        var list = x.ok ? x.data.versions || [] : [];
        $('.ed-vl', m.body).innerHTML = list.length ? list.map(function (o) {
          return '<div class="mt-item"><span style="flex:1;min-width:0"><b>#' + o.number + '</b> <span class="ed-vlab"></span><small class="muted" style="display:block">' + esc(((s('kinds') || {})[o.kind] || o.kind) + ' · ' + J.fmtDate(o.created_at) + ' ' + new Date(o.created_at).toTimeString().slice(0, 5) + ' · ' + s('chars', { n: J.fmtNum(o.chars) })) + '</small></span>' +
            '<button class="pill sm ghost" type="button" data-pv="' + o.number + '">' + esc(s('view')) + '</button><button class="pill sm ghost" type="button" data-rs="' + o.number + '">' + esc(s('restore')) + '</button></div>';
        }).join('') : '<p class="muted">' + esc(s('noVer')) + '</p>';
        list.forEach(function (o, i) { var el = $$('.ed-vlab', m.body)[i]; if (el) el.textContent = o.label || ''; });
        $$('[data-pv]', m.body).forEach(function (b) {
          b.onclick = async function () {
            var x2 = await J.api('/api/editor/docs/' + encodeURIComponent(id) + '/versions/' + b.dataset.pv);
            if (!x2.ok) return;
            var pm = J.modal({ html: '<h2>#' + esc(b.dataset.pv) + '</h2><div class="ed-paper ed-preview"><div class="ed-doc"></div></div>' });
            $('.ed-doc', pm.body).innerHTML = J.cleanHtml ? J.cleanHtml(x2.data.html) : '';
          };
        });
        $$('[data-rs]', m.body).forEach(function (b) {
          b.onclick = async function () {
            if (!(await J.confirm(s('restoreQ'), s('restore')))) return;
            await flush();
            var x3 = await J.api('/api/editor/docs/' + encodeURIComponent(id) + '/versions/' + b.dataset.rs + '/restore', { method: 'POST' });
            if (!x3.ok) { J.toast(J.errMsg(x3.data)); return; }
            rev = x3.data.revision; ed.commands.setContent(x3.data.html || '<p></p>', { emitUpdate: false }); dirty = false; status('saved'); counts();
            m.close(); J.toast(s('restored'));
          };
        });
      }
      $('[data-a=vs]', m.body).onclick = async function () {
        var x = await J.api('/api/editor/docs/' + encodeURIComponent(id) + '/versions', { method: 'POST', body: { label: $('[data-f=vl]', m.body).value } });
        if (!x.ok) { J.toast(J.errMsg(x.data)); return; }
        $('[data-f=vl]', m.body).value = ''; load();
      };
      load();
    };
    ed.commands.focus('start');
  };

  J.route(/^\/muharrir\/([0-9a-f-]{36})$/, function (id) { J.viewEditor(id); });
})(window);
