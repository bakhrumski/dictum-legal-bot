/* U1 (docs/design/ux-audit-2026-11.md): bitta qidiruv va "Davom ettirish".
   Qidiruv (chap paneldagi maydon yoki Ctrl+K / ⌘K): bo'limlar nomi shu yerda, suhbatlar, hujjatlar, muharrirdagi
   hujjatlar, ishlar va agent natijalari NOMI bo'yicha serverda (GET /api/search, src/search/routes.js) — matn o'qilmaydi.
   "Davom ettirish": har turdagi oxirgi 8 ta narsa birga (GET /api/recent). AI yo'q, birlik yo'q. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc, t = J.t;
  var S = {
    uz: { find: 'Qidirish', ph: 'Suhbat, hujjat, ish yoki bo‘lim nomi…', pages: 'Bo‘limlar', none: 'Hech narsa topilmadi. Nomidagi so‘zni yozing — matn ichidan qidirilmaydi.',
      hint: 'Nomi bo‘yicha: suhbatlar, hujjatlar, ishlar, natijalar', cont: 'Davom ettirish', empty: 'Hali hech narsa yo‘q — savol bering yoki hujjat yuklang.',
      kinds: { chat: 'Suhbat', doc: 'Hujjat', editor: 'Muharrirda', matter: 'Ish', run: 'Natija', page: 'Bo‘lim' }, shared: 'ulashilgan', closed: 'yopilgan',
      keys: '↑↓ tanlash · Enter ochish · Esc yopish', fail: 'Qidiruv bajarilmadi' },
    ru: { find: 'Поиск', ph: 'Название чата, документа, дела или раздела…', pages: 'Разделы', none: 'Ничего не найдено. Введите слово из названия — по тексту не ищем.',
      hint: 'По названию: чаты, документы, дела, результаты', cont: 'Продолжить', empty: 'Пока ничего нет — задайте вопрос или загрузите документ.',
      kinds: { chat: 'Чат', doc: 'Документ', editor: 'В редакторе', matter: 'Дело', run: 'Результат', page: 'Раздел' }, shared: 'общий', closed: 'закрыто',
      keys: '↑↓ выбор · Enter открыть · Esc закрыть', fail: 'Поиск не выполнен' },
    en: { find: 'Search', ph: 'Name of a chat, document, matter or section…', pages: 'Sections', none: 'Nothing found. Type a word from the name — text is not searched.',
      hint: 'By name: chats, documents, matters, results', cont: 'Continue', empty: 'Nothing yet — ask a question or upload a document.',
      kinds: { chat: 'Chat', doc: 'Document', editor: 'In editor', matter: 'Matter', run: 'Result', page: 'Section' }, shared: 'shared', closed: 'closed',
      keys: '↑↓ select · Enter open · Esc close', fail: 'Search failed' }
  };
  function s(k) { var d = S[J.lang] || S.uz; return d[k] !== undefined ? d[k] : S.uz[k]; }
  J.findText = s;
  var ICON = { chat: 'chat', doc: 'doc', editor: 'pen', matter: 'folder', run: 'spark', page: 'more' };

  function wfLabel(w) { var wf = J.matterText ? J.matterText('wf') : null; return (wf && wf[w]) || w; }
  /** What a row is called: its name, an agent run without one by its workflow. */
  J.itemTitle = function (x) { return x.title || (x.kind === 'run' ? wfLabel(x.meta && x.meta.workflow) : '') || '—'; };
  /** Where a row opens; an agent result other than the table review opens in a window (matters.js J.openRun). */
  J.openItem = function (x) {
    if (x.kind === 'page') return J.go(x.href);
    if (x.kind === 'chat') return J.go('#/c/' + x.id);
    if (x.kind === 'doc') { J.libQuery = x.title || ''; return J.go('#/hujjatlarim?yuklangan'); }
    if (x.kind === 'editor') return J.go('#/muharrir/' + x.id);
    if (x.kind === 'matter') return J.go('#/ishlar/' + x.id);
    if (x.kind === 'run') {
      if (x.meta && x.meta.workflow === 'tabular_review') return J.go('#/jadval/' + x.id);
      if (J.openRun) return J.openRun(x.id, J.itemTitle(x));
    }
  };
  function sub(x) {
    var bits = [s('kinds')[x.kind] || ''];
    if (x.kind === 'run' && x.title) bits.push(wfLabel(x.meta && x.meta.workflow));
    if (x.meta && x.meta.shared) bits.push(s('shared'));
    if (x.meta && x.meta.status === 'closed') bits.push(s('closed'));
    if (x.at) bits.push(J.fmtDate(x.at));
    return bits.filter(Boolean).join(' · ');
  }
  /** One row; the name goes in as text, never markup. A file name keeps its letters (data-noalpha, as on Hujjatlar);
      chat and matter titles follow the chosen alphabet like the side list. */
  function rowHtml(x, i) {
    return '<a class="fd-row" href="#" data-i="' + i + '" role="option"><span class="fd-ic">' + J.icon(ICON[x.kind] || 'doc') + '</span><span class="fd-t"><b' + (x.kind === 'doc' || x.kind === 'editor' ? ' data-noalpha' : '') + '></b><small class="muted"></small></span></a>';
  }
  function fill(host, list) {
    $$('.fd-row', host).forEach(function (a) { var x = list[+a.dataset.i]; $('b', a).textContent = J.itemTitle(x); $('small', a).textContent = sub(x); });
  }

  /* ---------- Davom ettirish (bosh sahifa) ---------- */
  /** Draws the last items of every kind into host; falls back to the recent chats when the server has no list. */
  J.recentBlock = function (host, opts) {
    opts = opts || {};
    host.innerHTML = '<h3>' + esc(s('cont')) + '</h3><div class="rows fd-rows"><div class="skel"></div></div>';
    var box = $('.fd-rows', host);
    J.api('/api/recent').then(function (r) {
      if (!document.body.contains(box)) return;
      if (!r.ok) { if (opts.onItems) opts.onItems(null); if (opts.fallback) opts.fallback(box); return; }
      var list = (r.data.items || []).slice(0, opts.max || 8);
      // U2: the home page asks "Nimadan boshlaysiz?" while there is nothing yet (start.js)
      if (opts.onItems) opts.onItems(list);
      if (!list.length) { box.innerHTML = '<div class="empty-state" style="padding:18px 4px;text-align:left">' + esc(s('empty')) + '</div>'; return; }
      box.innerHTML = list.map(rowHtml).join('');
      fill(box, list);
      $$('.fd-row', box).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); J.openItem(list[+a.dataset.i]); }; });
    });
  };

  /* ---------- qidiruv oynasi ---------- */
  var PAGES = [['#/', 'nav.ask'], ['#/ishlar', 'nav.matters'], ['#/hujjatlarim', 'nav.docs'], ['#/tahlil', 'nav.analyze'], ['#/tayyorlash', 'nav.draft'],
    ['#/konikmalar', 'nav.skills'], ['#/firma', 'nav.kb'], ['#/yozuvlar', 'nav.voice'], ['#/jamoa', 'nav.team'], ['#/advokatlar', 'nav.lawyers'],
    ['#/suhbatlar', 'nav.history'], ['#/hisob', 'nav.account'], ['#/asboblar', 'nav.tools'], ['#/jadval', null, 'Ko‘p hujjatni solishtirish'], ['#/jadval', null, 'Jadvalli tahlil'], ['#/playbook', null, 'Firma qoidalari bilan tekshirish'], ['#/playbook', null, 'Playbook'], ['#/moslashish', null, 'Moslashish'], ['#/agent/dava', null, 'Da’vo arizasi']];
  function fold(x) { return G.JAIAlphabet && G.JAIAlphabet.fold ? G.JAIAlphabet.fold(x) : String(x || '').toLowerCase(); }
  function pagesFor(q) {
    var words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return PAGES.map(function (p) { return { kind: 'page', href: p[0], title: p[1] ? t(p[1]) : p[2] }; })
      .filter(function (p) { var n = fold(p.title); return p.title && words.every(function (w) { return n.indexOf(w) > -1; }); }).slice(0, 4);
  }

  J.openFind = function (q0) {
    if ($('.modal.find')) { $('.modal.find .fd-q').focus(); return; }
    var m = J.modal({ cls: 'find', html: '<div class="fd-in">' + J.icon('search') + '<input class="fd-q" type="search" autocomplete="off" spellcheck="false" aria-label="' + esc(s('find')) + '" placeholder="' + esc(s('ph')) + '"><kbd class="fd-k">Esc</kbd></div>' +
      '<div class="fd-res" role="listbox"></div><div class="fd-foot muted">' + esc(s('keys')) + '</div>' });
    var inp = $('.fd-q', m.body), res = $('.fd-res', m.body), list = [], cur = 0, seq = 0, timer = null;
    function mark() { $$('.fd-row', res).forEach(function (a) { var on = +a.dataset.i === cur; a.classList.toggle('on', on); if (on) a.scrollIntoView({ block: 'nearest' }); }); }
    function draw(items, note) {
      list = items; cur = 0;
      var pages = items.filter(function (x) { return x.kind === 'page'; }).length;
      res.innerHTML = items.length ? items.map(function (x, i) { return (i === 0 && pages ? '<div class="fd-h">' + esc(s('pages')) + '</div>' : '') + (i === pages && i > 0 ? '<div class="fd-h">' + esc(s('hint')) + '</div>' : '') + rowHtml(x, i); }).join('')
        : '<div class="fd-empty muted">' + esc(note || '') + '</div>';
      fill(res, items); mark();
      $$('.fd-row', res).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); go(+a.dataset.i); }; a.onmousemove = function () { if (cur !== +a.dataset.i) { cur = +a.dataset.i; mark(); } }; });
    }
    function go(i) { var x = list[i]; if (!x) return; m.close(); J.openItem(x); }
    async function run() {
      var q = inp.value.trim(), my = ++seq;
      if (!q) { draw([], s('hint')); return; }
      var pages = pagesFor(q);
      draw(pages, '');
      // the server folds the 2026 letters and apostrophes itself; the query goes as typed
      var r = await J.api('/api/search?q=' + encodeURIComponent(q.slice(0, 120)));
      if (my !== seq) return;
      draw(pages.concat(r.ok ? (r.data.items || []) : []), r.ok ? s('none') : s('fail'));
    }
    inp.oninput = function () { clearTimeout(timer); timer = setTimeout(run, 180); };
    inp.onkeydown = function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.length) { cur = (cur + 1) % list.length; mark(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (list.length) { cur = (cur - 1 + list.length) % list.length; mark(); } }
      else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (list.length) go(cur); else run(); }
    };
    if (q0) inp.value = q0;
    run();
    setTimeout(function () { inp.focus(); }, 0);
  };

  /* ---------- chap paneldagi maydon va Ctrl+K ---------- */
  function mountSideField() {
    var nb = document.getElementById('newBtn');
    if (!nb || document.getElementById('findBtn')) return;
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    var b = J.h('<button class="side-find" id="findBtn" type="button" title="' + esc(s('find')) + ' (' + (mac ? '⌘K' : 'Ctrl+K') + ')">' + J.icon('search') + '<span>' + esc(s('find')) + '</span><kbd>' + (mac ? '⌘K' : 'Ctrl K') + '</kbd></button>');
    nb.parentNode.insertBefore(b, nb.nextSibling);
    b.onclick = function () { document.body.classList.remove('nav-open'); J.openFind(); };
  }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
      if (document.body.classList.contains('booting') || !J.S || !J.S.user) return;
      e.preventDefault(); J.openFind();
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountSideField); else mountSideField();
})(window);
