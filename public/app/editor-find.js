/* U5a (docs/design/ux-audit-2026-11.md): muharrirda topish va almashtirish — Ctrl+F / Ctrl+H.
   Topilganlar sahifaning o'z belgisi (bundle'dagi jaiSpots bezagi): matnga yozilmaydi, hammualliflarga ko'rinmaydi.
   Katta-kichik harf va apostrof shakllari (o' o‘ oʻ) bir xil hisoblanadi; qidiruv bitta xatboshi ichida.
   Almashtirish faqat tahrir huquqi borlarga; "Hammasini" bitta amal (Ctrl+Z bilan qaytadi). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, esc = J.esc;
  var S = {
    uz: { find: 'Topish', replace: 'Almashtirish', with: 'Nima bilan', one: 'Almashtirish', all: 'Hammasini', none: 'Topilmadi', prev: 'Oldingisi (Shift+Enter)', next: 'Keyingisi (Enter)', close: 'Yopish (Esc)', done: '{n} ta almashtirildi' },
    ru: { find: 'Найти', replace: 'Заменить', with: 'Чем заменить', one: 'Заменить', all: 'Все', none: 'Не найдено', prev: 'Предыдущее (Shift+Enter)', next: 'Следующее (Enter)', close: 'Закрыть (Esc)', done: 'Заменено: {n}' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  // one character in, one out: positions stay the positions of the document
  function fold(c) { if (/[ʻ‘’'`ʼ]/.test(c)) return "'"; var l = c.toLowerCase(); return l.length === 1 ? l : c; }

  /** Every place the query stands, as document ranges, inside one paragraph each. */
  function findAll(ed, q) {
    var want = ''; for (var i = 0; i < q.length; i++) want += fold(q[i]);
    var out = [];
    if (!want) return out;
    ed.state.doc.descendants(function (node, pos) {
      if (!node.isTextblock) return true;
      var text = '', map = [];
      node.descendants(function (ch, p) {
        if (ch.isText) { for (var k = 0; k < ch.text.length; k++) { text += fold(ch.text[k]); map.push(pos + 1 + p + k); } }
        else if (ch.isLeaf) { text += '\u0000'; map.push(-1); }
      });
      var at = text.indexOf(want);
      while (at > -1 && out.length < 1000) {
        out.push({ from: map[at], to: map[at + want.length - 1] + 1 });
        at = text.indexOf(want, at + want.length);
      }
      return false;
    });
    return out;
  }

  J.editorFind = function (v, ed, o) {
    var bar = J.h('<div class="ed-fbar" hidden role="search"><div class="ed-frow"><input class="inp ed-fq" type="search" autocomplete="off" spellcheck="false" placeholder="' + esc(s('find')) + '" aria-label="' + esc(s('find')) + '">' +
      '<span class="ed-fn muted"></span><button type="button" class="ed-b" data-f="prev" title="' + esc(s('prev')) + '" aria-label="' + esc(s('prev')) + '">↑</button><button type="button" class="ed-b" data-f="next" title="' + esc(s('next')) + '" aria-label="' + esc(s('next')) + '">↓</button>' +
      (o.canWrite ? '<button type="button" class="ed-b ed-ftg" data-f="tog" title="' + esc(s('replace')) + '" aria-label="' + esc(s('replace')) + '">⇄</button>' : '') +
      '<button type="button" class="ed-b" data-f="x" title="' + esc(s('close')) + '" aria-label="' + esc(s('close')) + '">×</button></div>' +
      (o.canWrite ? '<div class="ed-frow ed-frep" hidden><input class="inp ed-fr" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(s('with')) + '" aria-label="' + esc(s('with')) + '">' +
        '<button type="button" class="pill sm ghost" data-f="one">' + esc(s('one')) + '</button><button type="button" class="pill sm ghost" data-f="all">' + esc(s('all')) + '</button></div>' : '') + '</div>');
    var main = $('.ed-main', v); main.parentNode.insertBefore(bar, main);
    var q = $('.ed-fq', bar), r = $('.ed-fr', bar), rep = $('.ed-frep', bar), n = $('.ed-fn', bar), list = [], cur = -1;

    function scrollTo(range) {
      var dom = ed.view.domAtPos(range.from), el = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    function paint(scroll) {
      ed.commands.setFindRanges(list, cur);
      n.textContent = q.value ? (list.length ? (cur + 1) + ' / ' + list.length : s('none')) : '';
      n.classList.toggle('ed-fnone', !!q.value && !list.length);
      if (scroll && list[cur]) scrollTo(list[cur]);
    }
    function search(scroll) {
      list = findAll(ed, q.value);
      // the first hit at or after the cursor
      var at = ed.state.selection.from; cur = -1;
      for (var i = 0; i < list.length; i++) if (list[i].from >= at) { cur = i; break; }
      if (cur < 0 && list.length) cur = 0;
      paint(scroll);
    }
    function step(d) { if (!list.length) return; cur = (cur + d + list.length) % list.length; paint(true); }
    function replaceOne() {
      if (!list[cur]) return;
      var x = list[cur], text = r.value;
      ed.chain().command(function (p) { p.tr.insertText(text, x.from, x.to); return true; }).run();
      o.changed();
      list = findAll(ed, q.value);
      // the next one after the replaced words
      cur = -1; for (var i = 0; i < list.length; i++) if (list[i].from >= x.from + text.length) { cur = i; break; }
      if (cur < 0 && list.length) cur = 0;
      paint(true);
    }
    function replaceAll() {
      var all = findAll(ed, q.value), text = r.value;
      if (!all.length) return;
      // from the end, so the earlier positions stay right; one step for undo
      ed.chain().command(function (p) { for (var i = all.length - 1; i >= 0; i--) p.tr.insertText(text, all[i].from, all[i].to); return true; }).run();
      o.changed(); J.toast(s('done', { n: all.length }));
      search(false);
    }
    var timer = null;
    q.oninput = function () { clearTimeout(timer); timer = setTimeout(function () { search(true); }, 120); };
    q.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (list.length && q.value) step(e.shiftKey ? -1 : 1); else search(true); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    if (r) r.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } };
    bar.querySelectorAll('[data-f]').forEach(function (b) { b.addEventListener('mousedown', function (e) { if (b.tagName === 'BUTTON') e.preventDefault(); }); });
    $('[data-f=prev]', bar).onclick = function () { step(-1); };
    $('[data-f=next]', bar).onclick = function () { step(1); };
    $('[data-f=x]', bar).onclick = function () { close(); };
    var tg = $('[data-f=tog]', bar); if (tg) tg.onclick = function () { rep.hidden = !rep.hidden; tg.classList.toggle('on', !rep.hidden); if (!rep.hidden) r.focus(); };
    var b1 = $('[data-f=one]', bar); if (b1) b1.onclick = replaceOne;
    var ba = $('[data-f=all]', bar); if (ba) ba.onclick = replaceAll;
    // the text changed (typing, a co-editor): the hits follow it
    ed.on('update', function () { if (!bar.hidden && q.value) { var keep = cur; list = findAll(ed, q.value); cur = Math.min(Math.max(keep, 0), list.length - 1); paint(false); } });

    function open(withReplace) {
      bar.hidden = false;
      var sel = ed.state.selection;
      // the selected words (one line) become the query, as in Word
      if (!sel.empty) { var t = ed.state.doc.textBetween(sel.from, sel.to, ' '); if (t && t.length <= 200 && t.indexOf('\n') < 0) q.value = t; }
      if (rep) { rep.hidden = !withReplace && rep.hidden; if (withReplace) rep.hidden = false; if (tg) tg.classList.toggle('on', !rep.hidden); }
      q.focus(); q.select();
      search(true);
    }
    function close() { bar.hidden = true; list = []; cur = -1; ed.commands.setFindRanges([], -1); ed.commands.focus(); }
    return { open: open, close: close, el: bar };
  };
})(window);
