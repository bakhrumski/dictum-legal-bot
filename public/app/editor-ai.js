/* Muharrir, D4: AI tahlil paneli (docs/design/hujjat-muharriri.md; egasi 2026-11-03 "D4 ni boshla").
   Hujjatning o'zi tahlil qilinadi (saytdagi tahlil, tahlil birligi: narx avval ko'rsatiladi, tasdiq bilan ishlaydi).
   Har bir xavf hujjatdagi so'zma-so'z joyiga bog'lanadi: topilsa — "Joyini ko'rsatish" va taklif; topilmasa — "joyi topilmadi".
   AI hech narsani o'zi o'zgartirmaydi: taklif avval eski / yangi ko'rinishda chiqadi, odam qabul qilsa kiritiladi
   (birinchi qabuldan oldin versiya saqlanadi, ↶ bilan ham qaytadi), rad etsa — yopiladi.
   Server: src/editor/analysis.js (POST .../analysis/quote, POST .../analysis, GET .../analysis). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { btn: 'AI tahlil', title: 'AI tahlil', intro: 'Hujjat xavflar, yetishmayotgan bandlar va qonunga mosligi bo‘yicha tahlil qilinadi. Har bir xavf hujjatdagi joyiga bog‘lanadi, tuzatish taklifini bir bosishda kiritasiz — hech narsa o‘zingiz qabul qilmaguncha o‘zgarmaydi.',
      price: 'Narxini ko‘rish', cost: 'Tahlil: {u} birlik. Qoladi: {r}.', costUnl: 'Tahlil: {u} birlik.', run: 'Tahlil qilish', running: 'Hujjat tahlil qilinmoqda… (1–2 daqiqa)', again: 'Qayta tahlil',
      tooBig: 'Hujjat bitta tahlil uchun katta ({p} sahifa, eng ko‘pi {m}). Qisqartirilmaydi.', cannot: 'Tahlilni hujjat egasi, tahrirlovchi yoki izohlovchi ishga tushiradi.',
      score: 'Baho', risks: 'Xavflar', missing: 'Yetishmayotgan bandlar', compliance: 'Qonunga moslik', strengths: 'Kuchli tomonlar',
      lv: { high: 'Yuqori', medium: 'O‘rta', low: 'Past' }, show: 'Joyini ko‘rsatish', notFound: 'Joyi hujjatda topilmadi', propose: 'Taklifni ko‘rish',
      insert: 'Kursor joyiga qo‘shish', accept: 'Qabul qilish', reject: 'Rad etish', was: 'Hozir', becomes: 'Taklif', applied: 'Kiritildi', dismissed: 'Rad etildi',
      moved: 'Bu so‘zlar hujjatda endi topilmadi — matn o‘zgargan.', verLabel: 'AI taklifidan oldin', noText: 'Taklif matni yo‘q — tavsiyani o‘zingiz qo‘llang.',
      by: '{w} · {d} · {u} birlik', you: 'Siz', disclaimer: 'AI tahlili — yordamchi. Muhim qarordan oldin manbani va matnni tekshiring.', none: 'Yo‘q',
      readonly: 'Takliflarni hujjatga faqat tahrirlovchi kirita oladi.', stale: 'Tahlildan keyin hujjat o‘zgargan: joylar yangi matndan qidiriladi.' },
    ru: { btn: 'ИИ-анализ', title: 'ИИ-анализ', intro: 'Документ проверяется на риски, недостающие пункты и соответствие закону. Каждый риск привязан к месту в тексте, исправление вставляется в один клик — ничего не меняется без вашего согласия.',
      price: 'Узнать стоимость', cost: 'Анализ: {u} ед. Останется: {r}.', costUnl: 'Анализ: {u} ед.', run: 'Проанализировать', running: 'Документ анализируется… (1–2 минуты)', again: 'Повторить анализ',
      tooBig: 'Документ слишком большой для одного анализа ({p} стр., максимум {m}). Он не обрезается.', cannot: 'Анализ запускает владелец, редактор или комментатор.',
      score: 'Оценка', risks: 'Риски', missing: 'Недостающие пункты', compliance: 'Соответствие закону', strengths: 'Сильные стороны',
      lv: { high: 'Высокий', medium: 'Средний', low: 'Низкий' }, show: 'Показать место', notFound: 'Место в документе не найдено', propose: 'Посмотреть предложение',
      insert: 'Вставить у курсора', accept: 'Принять', reject: 'Отклонить', was: 'Сейчас', becomes: 'Предложение', applied: 'Вставлено', dismissed: 'Отклонено',
      moved: 'Этих слов в документе больше нет — текст изменился.', verLabel: 'До предложения ИИ', noText: 'Текста предложения нет — примените рекомендацию сами.',
      by: '{w} · {d} · {u} ед.', you: 'Вы', disclaimer: 'ИИ-анализ — помощник. Перед важным решением проверьте источник и текст.', none: 'Нет',
      readonly: 'Вносить предложения в документ может только редактор.', stale: 'После анализа документ менялся: места ищутся в новом тексте.' },
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (typeof x === 'string' && v) Object.keys(v).forEach(function (n) { x = x.split('{' + n + '}').join(v[n]); }); return x; }

  /** The same folding as the server (src/editor/analysis.js fold), one character at a time. */
  function foldCh(c) {
    if (/[‘’ʻʼ`´]/.test(c)) return '\'';
    if (/[«»“”„"]/.test(c)) return '"';
    if (/[–—]/.test(c)) return '-';
    if (/\s/.test(c)) return ' ';
    return c.toLowerCase();
  }
  function foldStr(t) { var o = '', sp = false; for (var i = 0; i < t.length; i++) { var f = foldCh(t[i]); if (f === ' ') { if (sp || !o) continue; sp = true; } else sp = false; o += f; } return o.trim(); }

  /** Where the excerpt stands in the editor's document now: { from, to } or null. Never a guess. */
  function locate(ed, excerpt) {
    var want = foldStr(String(excerpt || '').normalize('NFC'));
    if (want.length < 4 || /\.\.\.|…/.test(want)) return null;
    var text = '', map = [], lastSpace = true;
    ed.state.doc.descendants(function (node, pos) {
      if (node.isText) {
        var t = node.text.normalize('NFC');
        for (var i = 0; i < t.length; i++) {
          var f = foldCh(t[i]);
          if (f === ' ') { if (lastSpace) continue; lastSpace = true; } else lastSpace = false;
          text += f; map.push(pos + i);
        }
      } else if (node.isBlock && !lastSpace) { text += ' '; map.push(-1); lastSpace = true; }
    });
    var at = text.indexOf(want);
    if (at < 0) return null;
    var a = map[at], b = map[at + want.length - 1];
    if (a < 0 || b < 0) return null;
    return { from: a, to: b + 1 };
  }

  J.editorAiLabel = function () { return s('btn'); };
  /** U5b: where these words stand in the document now ({ from, to } or null) - the same word-for-word rule */
  J.editorFindQuote = function (ed, words) { return locate(ed, words); };

  /**
   * The panel. o: { id, canWrite, canRun, flush(), changed(), revision() }.
   * Returns { open, hide, el }.
   */
  J.editorAi = function (v, ed, o) {
    var side = J.h('<aside class="ed-side ed-ai" hidden></aside>');
    $('.ed-main', v).appendChild(side);
    var base = '/api/editor/docs/' + encodeURIComponent(o.id) + '/analysis';
    var data = null, quote = null, busy = false, versioned = false, open = {};
    var key = function () { return 'jai-ed-ai-' + (data && data.id); };
    // where the person's cursor last stood in the text (a click on the panel takes the focus away)
    var lastPos = null;
    ed.on('selectionUpdate', function () { if (ed.isFocused) lastPos = ed.state.selection.to; });
    function marks() { try { return JSON.parse(localStorage.getItem(key()) || '{}'); } catch (e) { return {}; } }
    function mark(itemId, what) { try { var m = marks(); m[itemId] = what; localStorage.setItem(key(), JSON.stringify(m)); } catch (e) { /* this browser only */ } }

    function head() { return '<div class="ed-sh"><b>' + esc(s('title')) + '</b><button type="button" class="ed-x" data-a="close" aria-label="×">×</button></div>'; }
    function bindClose() { $('[data-a=close]', side).onclick = function () { side.hidden = true; }; }

    function intro(extra) {
      side.innerHTML = head() + '<p class="ed-ai-p">' + esc(s('intro')) + '</p>' + (extra || '') +
        (o.canRun ? '<div class="ed-ai-q"><button class="pill sm" type="button" data-a="q">' + esc(s('price')) + '</button></div>' : '<p class="muted ed-ai-p">' + esc(s('cannot')) + '</p>');
      bindClose();
      var qb = $('[data-a=q]', side); if (qb) qb.onclick = getQuote;
    }
    async function getQuote() {
      var box = $('.ed-ai-q', side); box.innerHTML = '<span class="spin"></span>';
      await o.flush(); // the server analyses the text it keeps
      var r = await J.api(base + '/quote', { method: 'POST', body: {} });
      if (!r.ok) { box.innerHTML = '<p class="err"></p>'; $('p', box).textContent = J.errMsg(r.data); return; }
      quote = r.data;
      if (quote.fits === false) { box.innerHTML = '<div class="note warn"></div>'; $('.note', box).textContent = s('tooBig', { p: quote.size && quote.size.pages, m: quote.maxPages }); return; }
      var msg = quote.unlimited ? s('costUnl', { u: quote.units || 1 }) : s('cost', { u: quote.units, r: quote.remainingAfter });
      box.innerHTML = '<div class="card ed-ai-cost"><p></p><button class="pill sm" type="button" data-a="run">' + esc(s('run')) + ' →</button></div>';
      $('p', box).textContent = msg;
      $('[data-a=run]', box).onclick = run;
    }
    async function run() {
      if (busy) return; busy = true;
      side.innerHTML = head() + '<div class="card ed-ai-run"><span class="spin"></span><span>' + esc(s('running')) + '</span></div>'; bindClose();
      await o.flush();
      var r = await J.api(base, { method: 'POST', body: { confirmed: true, langHint: J.lang } });
      busy = false;
      J.refreshTariff && J.refreshTariff();
      if (!r.ok) { if (!(J.handleLimit && J.handleLimit(r.data))) J.toast(J.errMsg(r.data), 6000); intro(); return; }
      data = r.data; draw();
    }

    function lvTag(l) { var c = l === 'high' ? 'bad' : l === 'medium' ? 'warn' : 'ok'; return '<span class="tag"><span class="dot ' + c + '"></span>' + esc(s('lv')[l] || l) + '</span>'; }
    // U5a: the place in light blue (editor.js J.editorSpot); the panel steps aside on a phone
    function show(at) { J.editorSpot(ed, at, side); }
    async function keepVersion() {
      if (versioned) return; versioned = true;
      await o.flush();
      await J.api('/api/editor/docs/' + encodeURIComponent(o.id) + '/versions', { method: 'POST', body: { label: s('verLabel') } });
    }
    function paragraphs(text) {
      return String(text).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean)
        .map(function (l) { return { type: 'paragraph', content: [{ type: 'text', text: l }] }; });
    }

    function draw() {
      var a = data || {}, m = marks();
      var who = a.byMe ? s('you') : (a.by || '—');
      var html = head() +
        '<div class="ed-ai-sum">' + (a.score != null ? '<div class="ed-ai-score"><b>' + esc(String(a.score)) + '</b><small>/100 · ' + esc(s('score')) + '</small></div>' : '') +
        (a.docType ? '<div class="kicker">' + esc(a.docType) + '</div>' : '') + '<p class="ed-ai-p ed-ai-s"></p>' +
        '<p class="muted ed-ai-by">' + esc(s('by', { w: who, d: J.fmtDate(a.createdAt), u: a.units == null ? '—' : a.units })) + '</p>' +
        (o.revision && a.revision != null && o.revision() > a.revision ? '<p class="muted ed-ai-by">' + esc(s('stale')) + '</p>' : '') + '</div>' +
        '<div class="ed-ai-h">' + esc(s('risks')) + ' (' + (a.risks || []).length + ')</div><div class="ed-ai-list" data-l="r"></div>' +
        '<div class="ed-ai-h">' + esc(s('missing')) + ' (' + (a.missing || []).length + ')</div><div class="ed-ai-list" data-l="m"></div>' +
        ((a.compliance || []).length ? '<div class="ed-ai-h">' + esc(s('compliance')) + '</div><div class="ed-ai-list" data-l="c"></div>' : '') +
        ((a.strengths || []).length ? '<div class="ed-ai-h">' + esc(s('strengths')) + '</div><ul class="ed-ai-str"></ul>' : '') +
        (o.canWrite ? '' : '<p class="muted ed-ai-p">' + esc(s('readonly')) + '</p>') +
        '<p class="muted ed-ai-disc">' + esc(s('disclaimer')) + '</p>' +
        (o.canRun ? '<div class="ed-ai-q"><button class="pill sm ghost" type="button" data-a="q">' + esc(s('again')) + '</button></div>' : '');
      side.innerHTML = html; bindClose();
      $('.ed-ai-s', side).textContent = a.summary || '';
      var qb = $('[data-a=q]', side); if (qb) qb.onclick = getQuote;
      var rl = $('[data-l=r]', side);
      (a.risks || []).forEach(function (r) {
        var at = locate(ed, r.excerpt), done = m[r.id];
      // accepted in another browser or by a co-editor: the proposal's own words stand in the text now
      if (!done && !at && r.replacement && locate(ed, r.replacement)) done = 'applied';
        var card = J.h('<div class="ed-card ed-ai-c' + (done ? ' ed-ai-done' : '') + (at ? ' ed-go' : '') + '"' + (at ? ' tabindex="0" title="' + esc(s('show')) + '"' : '') + '>' +
          '<div class="ed-ai-ch">' + lvTag(r.level) + '<b class="ed-ai-cl"></b>' + (done ? '<span class="ed-ai-st">' + esc(s(done)) + '</span>' : '') + '</div>' +
          (r.excerpt ? '<p class="ed-q"></p>' : '') + (r.excerpt && !at ? '<p class="ed-gone">' + esc(s('notFound')) + '</p>' : '') +
          '<p class="ed-ai-i"></p>' + (r.suggestion ? '<p class="ed-ai-sg"></p>' : '') +
          '<div class="ed-ai-prop" hidden></div>' +
          '<div class="ed-ca">' + (at && r.replacement && o.canWrite && !done ? '<button type="button" class="link" data-a="prop">' + esc(s('propose')) + '</button>' : '') +
          // U5b: ask about this place in the side chat (editor-ask.js)
          (J.editorAskAt && r.excerpt ? '<button type="button" class="link" data-a="askat">' + esc(J.editorAskText('ask')) + '</button>' : '') + '</div></div>');
        $('.ed-ai-cl', card).textContent = r.clause || '';
        if (r.excerpt) $('.ed-q', card).textContent = '«' + r.excerpt + '»';
        $('.ed-ai-i', card).textContent = r.issue || '';
        if (r.suggestion) $('.ed-ai-sg', card).textContent = r.suggestion;
        // U5a: a click on the card (not on its buttons) marks the place - no separate "show" button
        if (at) {
          var go = function () { var x = locate(ed, r.excerpt); if (x) show(x); else J.toast(s('moved')); };
          card.addEventListener('click', function (e) { if (e.target.closest('button, a, textarea, input')) return; go(); });
          card.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); go(); } });
        }
        var ab = $('[data-a=askat]', card); if (ab) ab.onclick = function () { if (J.editorAskAt) J.editorAskAt(r.excerpt); };
        var pb = $('[data-a=prop]', card);
        if (pb) pb.onclick = function () {
          var x = locate(ed, r.excerpt); if (!x) { J.toast(s('moved')); return; }
          show(x);
          proposal(card, r.excerpt, r.replacement, async function () {
            var y = locate(ed, r.excerpt); if (!y) { J.toast(s('moved')); return false; }
            await keepVersion();
            ed.chain().focus().insertContentAt(y, { type: 'text', text: r.replacement }).run();
            o.changed(); mark(r.id, 'applied'); return true;
          }, function () { mark(r.id, 'dismissed'); });
        };
        rl.appendChild(card);
      });
      if (!(a.risks || []).length) rl.innerHTML = '<p class="muted ed-empty">' + esc(s('none')) + '</p>';
      var ml = $('[data-l=m]', side);
      (a.missing || []).forEach(function (x) {
        var done = m[x.id];
        if (!done && x.text && locate(ed, String(x.text).split(/\n+/)[0])) done = 'applied';
        var card = J.h('<div class="ed-card ed-ai-c' + (done ? ' ed-ai-done' : '') + '"><div class="ed-ai-ch">' + lvTag(x.importance === 'high' ? 'high' : 'medium') + '<b class="ed-ai-cl"></b>' + (done ? '<span class="ed-ai-st">' + esc(s(done)) + '</span>' : '') + '</div>' +
          '<p class="ed-ai-i"></p>' + (x.text ? '' : '<p class="muted ed-ai-sg">' + esc(s('noText')) + '</p>') + '<div class="ed-ai-prop" hidden></div>' +
          '<div class="ed-ca">' + (x.text && o.canWrite && !done ? '<button type="button" class="link" data-a="ins">' + esc(s('insert')) + '</button>' : '') + '</div></div>');
        $('.ed-ai-cl', card).textContent = x.clause || '';
        $('.ed-ai-i', card).textContent = x.description || '';
        var ib = $('[data-a=ins]', card);
        if (ib) ib.onclick = function () {
          // where the cursor is now (the end of the document when it is nowhere)
          var pos = lastPos != null ? lastPos : ed.state.doc.content.size;
          proposal(card, '', x.text, async function () {
            await keepVersion();
            var $pos = ed.state.doc.resolve(Math.min(pos, ed.state.doc.content.size));
            var after = $pos.depth ? $pos.after(1) : ed.state.doc.content.size;
            ed.chain().focus().insertContentAt(after, paragraphs(x.text)).run();
            o.changed(); mark(x.id, 'applied'); return true;
          }, function () { mark(x.id, 'dismissed'); });
        };
        ml.appendChild(card);
      });
      if (!(a.missing || []).length) ml.innerHTML = '<p class="muted ed-empty">' + esc(s('none')) + '</p>';
      var cl = $('[data-l=c]', side);
      if (cl) (a.compliance || []).forEach(function (c) {
        var card = J.h('<div class="ed-card ed-ai-c"><div class="ed-ai-ch"><b class="ed-ai-cl"></b></div><p class="ed-ai-i"></p><p class="ed-ai-sg"></p></div>');
        $('.ed-ai-cl', card).textContent = c.article || ''; $('.ed-ai-i', card).textContent = c.issue || ''; $('.ed-ai-sg', card).textContent = c.suggestion || '';
        cl.appendChild(card);
      });
      var su = $('.ed-ai-str', side); if (su) (a.strengths || []).forEach(function (t) { var li = document.createElement('li'); li.textContent = t; su.appendChild(li); });
    }

    /** Old and new side by side; nothing changes until "Qabul qilish". */
    function proposal(card, was, becomes, onAccept, onReject) {
      var box = $('.ed-ai-prop', card);
      box.hidden = false;
      box.innerHTML = (was ? '<div class="kicker">' + esc(s('was')) + '</div><p class="ed-ai-was"></p>' : '') + '<div class="kicker">' + esc(s('becomes')) + '</div><p class="ed-ai-new"></p>' +
        '<div class="ed-ca"><button type="button" class="pill sm" data-a="acc">' + esc(s('accept')) + '</button><button type="button" class="pill sm ghost" data-a="rej">' + esc(s('reject')) + '</button></div>';
      if (was) $('.ed-ai-was', box).textContent = was;
      $('.ed-ai-new', box).textContent = becomes;
      $('[data-a=acc]', box).onclick = async function () { this.disabled = true; var ok = await onAccept(); if (ok) { J.toast(s('applied')); draw(); } else this.disabled = false; };
      $('[data-a=rej]', box).onclick = function () { onReject(); draw(); };
    }

    async function loadLast() {
      var r = await J.api(base);
      if (!r.ok) { intro(); return; }
      if (r.data.none) { intro(); return; }
      data = r.data; draw();
    }
    return {
      el: side,
      open: function () { side.hidden = false; if (!data && !busy) loadLast(); },
      hide: function () { side.hidden = true; },
    };
  };
})(window);
