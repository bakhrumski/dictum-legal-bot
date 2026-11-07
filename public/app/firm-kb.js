/* Firma bazasi (K2b, docs/design/firma-bilim-bazasi.md): firmaning avvalgi hujjatlaridan bandni so'z bilan topish.
   Sahifa #/firma — qidiruv (hujjat, band, sahifa va parcha), hujjatlar ro'yxati, "Hujjat qo'shish" (Hujjatlarimdan);
   muharrirda "Firma bandlari" paneli — topilgan bandni kursor turgan joyga qo'yish va shu hujjatni bazaga qo'shish;
   Hujjatlarimda har hujjat yonida "Firma bazasiga". AI yo'q. Server: src/workspace/kb.js (/api/workspaces/:id/kb). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { nav: 'Firma bazasi', title: 'Firma bazasi', lead: 'Firmangizning avvalgi hujjatlaridan kerakli bandni so‘z bilan toping: hujjat, band, sahifa va parcha bir joyda. AI ishlatilmaydi.', sealed: 'Matnlar bazada shifrlangan holda saqlanadi.',
      ph: 'Masalan: penya kechiktirilgan kun', find: 'Qidirish', ws: 'Firma (Workspace)', none: 'Faol Workspace yo‘q. Firma bazasi pullik tarifdagi Workspace’da ishlaydi.',
      tabFind: 'Qidiruv', tabDocs: 'Hujjatlar', add: 'Hujjat qo‘shish', addHint: 'Hujjatlarimdan tanlang — matni firma bazasiga nusxalanadi (keyingi o‘zgarishlari kuzatilmaydi).',
      empty: 'Hech narsa topilmadi.', emptyDocs: 'Firma bazasida hali hujjat yo‘q. «Hujjat qo‘shish» yoki Hujjatlarim / muharrirdagi «Firma bazasiga» tugmasi bilan qo‘shing.',
      partial: 'so‘zlarning bir qismi', band: '{n}-band', page: '{n}-bet', open: 'To‘liq ko‘rish', copy: 'Nusxa olish', copied: 'Nusxalandi', insert: 'Hujjatga qo‘yish', inserted: 'Kursor turgan joyga qo‘yildi',
      remove: 'Olib tashlash', removeQ: 'Hujjat firma bazasidan olib tashlanadi (asl nusxasi o‘z joyida qoladi).', added: 'Firma bazasiga qo‘shildi', adding: 'Qo‘shilmoqda…',
      toKb: 'Firma bazasiga', limits: 'Qidiruv so‘z ildizi bo‘yicha: «shartnoma», «shartnomaga» bir xil topiladi; so‘zning bir qismi, ma’nodosh so‘z va xato yozilgan so‘z topilmaydi.',
      used: '{n} / {m} hujjat', by: 'qo‘shgan', viewer: 'Siz bu firmada faqat o‘qiysiz (viewer).', thisDoc: 'Shu hujjatni firma bazasiga qo‘shish', panel: 'Firma bandlari' },
    ru: { nav: 'База фирмы', title: 'База фирмы', lead: 'Найдите нужный пункт в прежних документах фирмы по словам: документ, пункт, страница и отрывок сразу. ИИ не используется.', sealed: 'Тексты хранятся в базе в зашифрованном виде.',
      ph: 'Например: неустойка за день просрочки', find: 'Найти', ws: 'Фирма (Workspace)', none: 'Нет активного Workspace. База фирмы работает в Workspace на платном тарифе.',
      tabFind: 'Поиск', tabDocs: 'Документы', add: 'Добавить документ', addHint: 'Выберите из «Моих документов» — текст копируется в базу фирмы (дальнейшие изменения не отслеживаются).',
      empty: 'Ничего не найдено.', emptyDocs: 'В базе фирмы пока нет документов. Добавьте кнопкой «Добавить документ» или «В базу фирмы» в «Моих документах» / редакторе.',
      partial: 'часть слов', band: 'п. {n}', page: 'стр. {n}', open: 'Показать полностью', copy: 'Копировать', copied: 'Скопировано', insert: 'Вставить в документ', inserted: 'Вставлено в место курсора',
      remove: 'Убрать', removeQ: 'Документ будет убран из базы фирмы (оригинал останется на месте).', added: 'Добавлено в базу фирмы', adding: 'Добавляется…',
      toKb: 'В базу фирмы', limits: 'Поиск по основе слова: «договор», «договору» находятся одинаково; часть слова, синоним и опечатка не находятся.',
      used: '{n} / {m} документов', by: 'добавил(а)', viewer: 'В этой фирме вы только читаете (viewer).', thisDoc: 'Добавить этот документ в базу фирмы', panel: 'Пункты фирмы' },
    en: { nav: 'Firm base', title: 'Firm knowledge base', lead: 'Find a clause in your firm’s past documents by its words: the document, clause, page and passage at once. No AI is used.', sealed: 'Texts are stored encrypted.',
      ph: 'E.g. penalty for each day of delay', find: 'Search', ws: 'Firm (Workspace)', none: 'No active Workspace. The firm base works in a Workspace on a paid plan.',
      tabFind: 'Search', tabDocs: 'Documents', add: 'Add a document', addHint: 'Pick from My documents — its text is copied to the firm base (later changes are not followed).',
      empty: 'Nothing found.', emptyDocs: 'No documents in the firm base yet. Add one with “Add a document” or “To the firm base” in My documents / the editor.',
      partial: 'some of the words', band: 'clause {n}', page: 'page {n}', open: 'Show all', copy: 'Copy', copied: 'Copied', insert: 'Insert into the document', inserted: 'Inserted at the cursor',
      remove: 'Remove', removeQ: 'The document leaves the firm base (the original stays where it is).', added: 'Added to the firm base', adding: 'Adding…',
      toKb: 'To the firm base', limits: 'Search by word root: “contract” and “contracts” match alike; part of a word, a synonym or a typo does not.',
      used: '{n} / {m} documents', by: 'added by', viewer: 'You only read in this firm (viewer).', thisDoc: 'Add this document to the firm base', panel: 'Firm clauses' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (typeof x === 'string' && v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  if (G.JAI_I18N) ['uz', 'ru', 'en'].forEach(function (l) { var d = G.JAI_I18N[l] = G.JAI_I18N[l] || {}; if (d['nav.kb'] === undefined) d['nav.kb'] = (S[l] || S.uz).nav; });

  /* ---------- the Workspaces this account may use (active only), remembered per browser ---------- */
  var WS = null;
  async function workspaces() {
    if (WS) return WS;
    var r = await J.api('/api/workspaces');
    WS = r.ok ? (r.data.workspaces || []).filter(function (w) { return w.is_active; }) : [];
    return WS;
  }
  function lastWs(list) {
    var id = null; try { id = localStorage.getItem('jai-kb-ws'); } catch (e) {}
    return list.filter(function (w) { return w.id === id; })[0] || list[0] || null;
  }
  function keepWs(id) { try { localStorage.setItem('jai-kb-ws', id); } catch (e) {} }
  var base = function (ws) { return '/api/workspaces/' + encodeURIComponent(ws) + '/kb'; };

  /* ---------- the query's roots, marked in a passage (light blue, the owner's rule) ---------- */
  function fold(x) { var A = G.JAIAlphabet; return String(A && A.fold ? A.fold(String(x || '')) : x).toLowerCase(); }
  function roots(q) { return fold(q).split(/[^\p{L}\p{N}]+/u).filter(function (w) { return w.length >= 3 || /^\d{2,}$/.test(w); }).map(function (w) { return /^\d+$/.test(w) ? w : w.slice(0, 5); }); }
  function marked(text, q) {
    var rs = roots(q);
    return String(text || '').split(/([\p{L}\p{N}ʻʼ'‘’`]+)/u).map(function (part, i) {
      if (i % 2 === 0) return esc(part);
      var f = fold(part);
      return rs.some(function (r) { return f.indexOf(r) === 0; }) ? '<mark class="kb-hit">' + esc(part) + '</mark>' : esc(part);
    }).join('');
  }
  function where(r) { return [r.label ? s('band', { n: r.label }) : '', r.page ? s('page', { n: r.page }) : ''].filter(Boolean).join(' · '); }

  /** Adds a source { kind: library | editor | workspace_doc, id } to a firm's base (a Workspace picked when several). */
  J.kbAdd = async function (from) {
    var list = (await workspaces()).filter(function (w) { return w.role !== 'viewer'; });
    if (!list.length) { J.toast(s('none'), 6000); return false; }
    var go = async function (ws) {
      J.toast(s('adding'));
      var r = await J.api(base(ws), { method: 'POST', body: { from: from } });
      if (!r.ok) { J.toast(J.errMsg(r.data), 6000); return false; }
      keepWs(ws); J.toast(s('added')); return r.data;
    };
    if (list.length === 1) return go(list[0].id);
    return J.firm && J.firm.pick ? J.firm.pick(go) : go(lastWs(list).id);
  };
  J.kbText = s;

  /** One band, whole, in a window (copy; insert when an editor gives `onInsert`). */
  async function openBand(ws, r, q, onInsert) {
    var x = await J.api(base(ws) + '/' + encodeURIComponent(r.documentId) + '/chunks/' + r.n);
    if (!x.ok) { J.toast(J.errMsg(x.data)); return; }
    var m = J.modal({ html: '<h2 data-noalpha></h2><p class="muted kb-w" style="font-size:13px"></p><div class="card kb-full" style="max-height:56vh;overflow:auto;white-space:pre-wrap;font-size:14.5px;line-height:1.6" data-noalpha></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px"><button class="pill ghost" type="button" data-a="copy">' + J.icon('copy') + esc(s('copy')) + '</button>' +
      (onInsert ? '<button class="pill" type="button" data-a="ins">' + esc(s('insert')) + '</button>' : '') + '</div>' });
    $('h2', m.body).textContent = x.data.name;
    $('.kb-w', m.body).textContent = where({ label: r.label, page: r.page });
    $('.kb-full', m.body).innerHTML = marked(x.data.text, q);
    $('[data-a=copy]', m.body).onclick = function () { navigator.clipboard.writeText(x.data.text).then(function () { J.toast(s('copied')); }); };
    var ins = $('[data-a=ins]', m.body); if (ins) ins.onclick = function () { onInsert(x.data.text); m.close(); };
  }

  /** Results list into `box` for query q in Workspace ws; onInsert(text) when inserting is possible. */
  async function search(box, ws, q, onInsert) {
    box.innerHTML = '<div class="skel"></div>';
    var r = await J.api(base(ws) + '/search', { method: 'POST', body: { q: q } });
    if (!r.ok) { box.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
    var res = r.data.results || [];
    box.innerHTML = res.length ? res.map(function (x, i) {
      return '<button type="button" class="kb-r" data-i="' + i + '"><span class="kb-rh"><b data-noalpha></b><small class="muted">' + esc(where(x)) + (x.partial ? ' · <span class="kb-part">' + esc(s('partial')) + '</span>' : '') + '</small></span>' +
        '<span class="kb-p" data-noalpha>' + marked(x.passage, q) + '</span></button>';
    }).join('') : '<div class="empty-state">' + esc(s('empty')) + '</div>';
    res.forEach(function (x, i) { var b = $('[data-i="' + i + '"] b', box); if (b) b.textContent = x.name; });
    $$('.kb-r', box).forEach(function (b) { b.onclick = function () { openBand(ws, res[+b.dataset.i], q, onInsert); }; });
  }

  /* ---------- the page ---------- */
  J.viewKb = async function () {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('lead')) + '</p></div></div><div class="kb-body"><div class="skel"></div></div></div>');
    var body = $('.kb-body', v);
    var list = await workspaces();
    if (!list.length) { body.innerHTML = '<div class="empty-state">' + esc(s('none')) + '</div>'; return; }
    var cur = lastWs(list), tab = 'find', lastQ = '';
    function draw() {
      body.innerHTML = (list.length > 1 ? '<div class="field" style="max-width:360px"><label>' + esc(s('ws')) + '</label><select class="inp kb-ws">' + list.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === cur.id ? ' selected' : '') + '>' + esc(w.name) + '</option>'; }).join('') + '</select></div>' : '') +
        '<div class="tabs"><button type="button" data-tab="find"' + (tab === 'find' ? ' class="on"' : '') + '>' + esc(s('tabFind')) + '</button><button type="button" data-tab="docs"' + (tab === 'docs' ? ' class="on"' : '') + '>' + esc(s('tabDocs')) + '</button></div>' +
        '<div class="kb-tab"></div>';
      var sel = $('.kb-ws', body); if (sel) sel.onchange = function () { cur = list.filter(function (w) { return w.id === sel.value; })[0]; keepWs(cur.id); draw(); };
      $$('[data-tab]', body).forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; draw(); }; });
      if (tab === 'find') find(); else docs();
    }
    function find() {
      var box = $('.kb-tab', body);
      box.innerHTML = '<form class="kb-q"><div class="search" style="flex:1">' + J.icon('search') + '<input class="inp" data-f="q" maxlength="200"></div><button class="pill" type="submit">' + esc(s('find')) + '</button></form>' +
        '<p class="muted" style="font-size:12.5px;margin:6px 0 14px">' + esc(s('limits')) + '</p><div class="kb-res"></div>';
      var inp = $('[data-f=q]', box); inp.placeholder = s('ph'); inp.value = lastQ;
      $('form', box).onsubmit = function (e) { e.preventDefault(); lastQ = inp.value.trim(); if (lastQ) search($('.kb-res', box), cur.id, lastQ, null); };
      if (lastQ) search($('.kb-res', box), cur.id, lastQ, null);
      inp.focus();
    }
    async function docs() {
      var box = $('.kb-tab', body), canWrite = cur.role !== 'viewer';
      box.innerHTML = '<div class="skel"></div>';
      var r = await J.api(base(cur.id));
      if (!r.ok) { box.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      var ds = r.data.documents || [];
      // "encrypted" only when the server says the texts are sealed
      box.innerHTML = '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><span class="muted" style="font-size:13px;flex:1;min-width:180px">' + esc(s('used', { n: r.data.used.documents, m: r.data.max.documents })) + (r.data.sealed ? ' · ' + esc(s('sealed')) : '') + (canWrite ? '' : ' · ' + esc(s('viewer'))) + '</span>' +
        (canWrite ? '<button class="pill sm" type="button" data-a="add">' + J.icon('plus') + esc(s('add')) + '</button>' : '') + '</div>' +
        (ds.length ? ds.map(function (d) {
          return '<div class="mt-item" data-id="' + esc(d.id) + '"><span>' + J.icon('doc') + '</span><span style="flex:1;min-width:0"><b class="kb-dn" data-noalpha style="display:block;overflow-wrap:anywhere"></b><small class="muted">' +
            esc([J.fmtNum ? J.fmtNum(d.chars) + ' bel.' : '', d.added_by_name ? s('by') + ': ' + d.added_by_name : '', J.fmtDate ? J.fmtDate(d.created_at) : ''].filter(Boolean).join(' · ')) + '</small></span>' +
            (canWrite ? '<button class="pill sm ghost" type="button" data-rm="' + esc(d.id) + '" aria-label="' + esc(s('remove')) + '">' + J.icon('trash') + '</button>' : '') + '</div>';
        }).join('') : '<div class="empty-state">' + esc(s('emptyDocs')) + '</div>');
      ds.forEach(function (d) { var b = $('[data-id="' + d.id + '"] .kb-dn', box); if (b) b.textContent = d.name; });
      var add = $('[data-a=add]', box);
      if (add) add.onclick = async function () {
        if (!J.pickDocs) return;
        J.toast(s('addHint'), 5000);
        var picked = await J.pickDocs({ max: 10 });
        for (var i = 0; i < picked.length; i++) {
          var x = await J.api(base(cur.id), { method: 'POST', body: { from: { kind: 'library', id: picked[i].scanId } } });
          if (!x.ok) J.toast(picked[i].name + ': ' + J.errMsg(x.data), 6000);
        }
        if (picked.length) { J.toast(s('added')); docs(); }
      };
      $$('[data-rm]', box).forEach(function (b) {
        b.onclick = async function () {
          if (!(await J.confirm(s('removeQ'), s('remove')))) return;
          var x = await J.api(base(cur.id) + '/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' });
          if (!x.ok) { J.toast(J.errMsg(x.data)); return; }
          docs();
        };
      });
    }
    draw();
  };
  J.route(/^\/firma$/, function () { J.viewKb(); });

  /* ---------- the editor's "Firma bandlari" panel: find a clause, put it where the cursor is ---------- */
  J.editorKbLabel = function () { return s('panel'); };
  J.editorKb = function (v, ed, o) {
    var side = J.h('<aside class="ed-side ed-kb" hidden></aside>');
    $('.ed-main', v).appendChild(side);
    var cur = null, list = [], lastQ = '', at = null;
    // the last place of the cursor, so a click in the panel does not lose it
    ed.on('selectionUpdate', function () { at = ed.state.selection.from; });
    function insert(text) {
      var paras = String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
      var content = paras.map(function (p) { return { type: 'paragraph', content: [{ type: 'text', text: p.replace(/\n/g, ' ') }] }; });
      var chain = ed.chain().focus();
      if (at != null) chain = chain.setTextSelection(at);
      chain.insertContent(content).run();
      o.changed(); J.toast(s('inserted'));
    }
    async function draw() {
      list = await workspaces();
      if (!list.length) { side.innerHTML = '<div class="ed-sh"><b>' + esc(s('panel')) + '</b><button type="button" class="ed-x" data-a="close">×</button></div><p class="muted" style="font-size:13px">' + esc(s('none')) + '</p>'; bind(); return; }
      cur = cur || lastWs(list);
      side.innerHTML = '<div class="ed-sh"><b>' + esc(s('panel')) + '</b><button type="button" class="ed-x" data-a="close" aria-label="×">×</button></div>' +
        (list.length > 1 ? '<select class="inp kb-ws" style="margin-bottom:8px">' + list.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === cur.id ? ' selected' : '') + '>' + esc(w.name) + '</option>'; }).join('') + '</select>' : '') +
        '<form class="kb-q"><input class="inp" data-f="q" maxlength="200"><button class="pill sm" type="submit">' + esc(s('find')) + '</button></form>' +
        '<p class="muted" style="font-size:12px;margin:6px 0 10px">' + esc(s('limits')) + '</p><div class="kb-res"></div>' +
        (cur.role !== 'viewer' ? '<button type="button" class="chip" data-a="this" style="margin-top:12px">' + J.icon('plus') + esc(s('thisDoc')) + '</button>' : '');
      var inp = $('[data-f=q]', side); inp.placeholder = s('ph'); inp.value = lastQ;
      var sel = $('.kb-ws', side); if (sel) sel.onchange = function () { cur = list.filter(function (w) { return w.id === sel.value; })[0]; keepWs(cur.id); draw(); };
      $('form', side).onsubmit = function (e) { e.preventDefault(); lastQ = inp.value.trim(); if (lastQ) search($('.kb-res', side), cur.id, lastQ, o.canWrite ? insert : null); };
      if (lastQ) search($('.kb-res', side), cur.id, lastQ, o.canWrite ? insert : null);
      var th = $('[data-a=this]', side);
      if (th) th.onclick = async function () {
        th.disabled = true; await o.flush();
        var r = await J.api(base(cur.id), { method: 'POST', body: { from: { kind: 'editor', id: o.id } } });
        th.disabled = false;
        J.toast(r.ok ? s('added') : J.errMsg(r.data), r.ok ? 2500 : 6000);
      };
      bind();
    }
    function bind() { var x = $('[data-a=close]', side); if (x) x.onclick = function () { side.hidden = true; }; }
    return { el: side, open: function () { side.hidden = false; draw(); }, hide: function () { side.hidden = true; } };
  };

  /* ---------- K4: chatda "Firma bazasi" manbasi (o'zi tanlaydi, brauzerda eslab qolinadi). Faqat hujjati bor
     Workspace'lar; server a'zolikni qayta tekshiradi (src/workspace/kb-chat.js). AI chaqiruvi va limit qo'shilmaydi. ---------- */
  var KS = {
    uz: { chip: 'Firma bazasi', tip: 'Javobda qonun bilan birga firmangiz hujjatlaridagi mos bandlar ham hisobga olinadi (qonun emas, alohida ko‘rsatiladi).', only: 'Faqat lex.uz', head: 'Manba', lock: 'Manba: lex.uz + firma bazasi',
      used: 'Firma bazasidan olingan bandlar (qonun emas):', none: 'Firma bazasida bu savolga mos band topilmadi — javob lex.uz bo‘yicha.', noAccess: 'Firma bazasini ochib bo‘lmadi (a’zolik yoki tarif) — javob lex.uz bo‘yicha.', off: 'Firma bazasi hozir o‘chirilgan — javob lex.uz bo‘yicha.' },
    ru: { chip: 'База фирмы', tip: 'Ответ учтёт вместе с законом и подходящие пункты документов вашей фирмы (это не закон, показываются отдельно).', only: 'Только lex.uz', head: 'Источник', lock: 'Источник: lex.uz + база фирмы',
      used: 'Пункты из базы фирмы (не закон):', none: 'В базе фирмы подходящего пункта не найдено — ответ по lex.uz.', noAccess: 'Базу фирмы открыть не удалось (участие или тариф) — ответ по lex.uz.', off: 'База фирмы сейчас отключена — ответ по lex.uz.' },
    en: { chip: 'Firm base', tip: 'The answer also weighs matching clauses of your firm’s documents alongside the law (not law, shown apart).', only: 'lex.uz only', head: 'Source', lock: 'Source: lex.uz + firm base',
      used: 'Clauses from the firm base (not law):', none: 'No matching clause in the firm base — the answer is from lex.uz.', noAccess: 'The firm base could not be opened (membership or plan) — the answer is from lex.uz.', off: 'The firm base is switched off — the answer is from lex.uz.' }
  };
  function ks(k) { var d = KS[J.lang] || KS.uz; return d[k] !== undefined ? d[k] : KS.uz[k]; }
  var CK = { p: null, list: [] };
  function chatOptions() {
    if (!CK.p) CK.p = workspaces().then(async function (list) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var r = await J.api(base(list[i].id));
        if (r.ok && (r.data.documents || []).length) out.push({ id: list[i].id, name: list[i].name || 'Workspace' });
      }
      CK.list = out; return out;
    }).catch(function () { CK.list = []; return []; });
    return CK.p;
  }
  function chosen() {
    var id = null; try { id = localStorage.getItem('jai-chat-kb'); } catch (e) {}
    return CK.list.filter(function (w) { return w.id === id; })[0] || null;
  }
  function choose(id) { try { if (id) localStorage.setItem('jai-chat-kb', id); else localStorage.removeItem('jai-chat-kb'); } catch (e) {} }
  J.chatKb = {
    /** the Workspace id to send as firmWorkspaceId, or null */
    chosen: function () { var w = chosen(); return w ? w.id : null; },
    /** the composer's chip: hidden until a Workspace with documents exists; a tap switches it, a menu when there are several */
    bind: function (btn, host, menuDown) {
      var menu = null;
      function paint() {
        var w = chosen();
        btn.hidden = !CK.list.length;
        btn.classList.toggle('on', !!w);
        btn.setAttribute('aria-pressed', w ? 'true' : 'false');
        $('span', btn).textContent = w && CK.list.length > 1 ? ks('chip') + ': ' + w.name : ks('chip');
        btn.title = ks('tip');
        // the composer's "Manba: lex.uz" line says the firm base is in too
        var lock = host.querySelector('.src-lock'), tx = lock && lock.lastChild;
        if (tx && tx.nodeType === 3) { if (lock._base === undefined) lock._base = tx.textContent; tx.textContent = w ? ks('lock') : lock._base; }
      }
      function closeMenu() { if (menu) { menu.remove(); menu = null; } }
      btn.onclick = function () {
        if (menu) return closeMenu();
        if (CK.list.length === 1) { choose(chosen() ? null : CK.list[0].id); paint(); return; }
        var cur = chosen();
        menu = J.h('<div class="menu' + (menuDown ? ' down' : '') + '"><div class="menu-h">' + esc(ks('head')) + '</div></div>');
        var items = [{ id: null, name: ks('only') }].concat(CK.list);
        items.forEach(function (w) {
          var b = J.h('<button type="button" class="mi' + ((cur ? cur.id : null) === w.id ? ' on' : '') + '">' + J.icon(w.id ? 'layers' : 'shield') + '<span class="mi-t" data-noalpha></span></button>');
          $('.mi-t', b).textContent = w.name;
          b.onclick = function () { choose(w.id); closeMenu(); paint(); };
          menu.appendChild(b);
        });
        host.appendChild(menu);
      };
      document.addEventListener('mousedown', function (e) { if (menu && !host.contains(e.target)) closeMenu(); });
      paint();
      chatOptions().then(paint);
    },
    /** the line under an answer: which firm bands it was given, or why none (names only - the server sends no band text) */
    note: function (firm) {
      if (!firm) return null;
      var el = J.h('<div class="kb-note">' + J.icon('layers') + '<div></div></div>'), body = $('div', el);
      if (firm.used > 0) {
        body.appendChild(J.h('<span></span>')).textContent = ks('used') + ' ';
        firm.bands.forEach(function (b, i) {
          var a = J.h('<a href="#/firma"></a>');
          a.textContent = '«' + b.name + '»' + (b.label ? ', ' + s('band', { n: b.label }) : '') + (b.page ? ', ' + s('page', { n: b.page }) : '');
          if (i) body.appendChild(document.createTextNode('; '));
          body.appendChild(a);
        });
      } else {
        body.textContent = ks(firm.reason === 'no_access' ? 'noAccess' : firm.reason === 'off' ? 'off' : 'none');
      }
      return el;
    }
  };
})(window);
