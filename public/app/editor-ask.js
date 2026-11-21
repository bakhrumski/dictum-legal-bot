/* U5b (docs/design/ux-audit-2026-11.md; egasi 2026-11-06: "har savol 1 chat birligi, javob shu hujjat bilan va
   Suhbatlarda saqlansin"): muharrirda "Shu joy haqida so'rash" - o'ng panelda chat.
   - Kontekst: belgilangan band (yoki AI / tekshiruv kartasining joyi) va hujjatning o'zi.
   - Javob oddiy chatdagi zanjirdan keladi: POST /api/legal-chat (stream), lex.uz qidiruvi, iqtibos va da'vo
     tekshiruvlari bilan; hujjat matni documentText bo'lib boradi - savol 1 chat birligi (document-job chat_excerpt);
     tahlil so'ralsa server narxni ko'rsatadi (409 DOC_COST_CONFIRM) va tasdiqsiz hech narsa yechilmaydi.
   - Umumiy chatga o'tib ketmaydi. Savol-javoblar Suhbatlarga saqlanadi (topic "editor:<hujjat>"); shu hujjatda
     panel qayta ochilganda o'sha suhbat davom etadi (bu brauzer eslab qoladi).
   - Javobni bir bosishda izoh qilish (shu joyga) yoki hujjatga matn sifatida qo'shish (shu band ostiga). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { btn: 'So‘rash', title: 'Shu joy haqida so‘rash', ph: 'Masalan: bu band menga qanday xavf tug‘diradi?', send: 'Yuborish',
      ctx: 'Kontekst', whole: 'Butun hujjat', pickHint: 'Matndan band belgilasangiz, savol o‘sha joy haqida bo‘ladi.',
      cost: 'Har savol — 1 savol (chat birligi). Javob lex.uz asosida, oddiy chatdagi tekshiruvlar bilan.',
      asComment: 'Izoh qilish', asText: 'Matnga qo‘shish', commented: 'Izoh qo‘shildi', inserted: 'Matnga qo‘shildi',
      noPlace: 'Joyi hujjatda topilmadi — izoh qilib bo‘lmaydi', chats: 'Suhbatlarda ochish', newQ: 'Yangi suhbat',
      wait: 'Javob tayyorlanmoqda…', cut: 'Javob uzildi — qayta yuboring.', readonly: 'Bu hujjatga faqat o‘qish huquqingiz bor: javobni matnga qo‘shib bo‘lmaydi.',
      costTitle: 'Narx', costOk: 'Tasdiqlash', costNo: 'Bekor', ask: 'Shu joy haqida so‘rash',
      q: 'Hujjatdagi quyidagi joy haqida savol:\n«{quote}»\n\nSavol: {q}' },
    ru: { btn: 'Спросить', title: 'Спросить об этом месте', ph: 'Например: чем этот пункт рискован для меня?', send: 'Отправить',
      ctx: 'Контекст', whole: 'Весь документ', pickHint: 'Выделите пункт в тексте — вопрос будет о нём.',
      cost: 'Каждый вопрос — 1 вопрос (единица чата). Ответ на основе lex.uz, с проверками как в обычном чате.',
      asComment: 'В комментарий', asText: 'В текст', commented: 'Комментарий добавлен', inserted: 'Добавлено в текст',
      noPlace: 'Место в документе не найдено — комментарий не добавить', chats: 'Открыть в диалогах', newQ: 'Новый диалог',
      wait: 'Готовим ответ…', cut: 'Ответ прервался — отправьте ещё раз.', readonly: 'У вас доступ только для чтения: ответ нельзя вставить в текст.',
      costTitle: 'Цена', costOk: 'Подтвердить', costNo: 'Отмена', ask: 'Спросить об этом месте',
      q: 'Вопрос о следующем месте документа:\n«{quote}»\n\nВопрос: {q}' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (v) Object.keys(v).forEach(function (n) { x = x.split('{' + n + '}').join(v[n]); }); return x; }
  J.editorAskLabel = function () { return s('btn'); };
  J.editorAskText = s;

  /**
   * The panel. o: { id, title(), canWrite, canComment, flush(), changed(), addComment(range, text) }.
   * Returns { el, open(context?), hide }. context: { quote, range } - the place asked about.
   */
  J.editorAsk = function (v, ed, o) {
    var side = J.h('<aside class="ed-side ed-ask" hidden></aside>');
    $('.ed-main', v).appendChild(side);
    var KEY = 'jai-ed-ask-' + o.id;
    var chat = { id: null, history: [] };
    try { chat.id = localStorage.getItem(KEY) || null; } catch (e) { /* this browser only */ }
    var ctx = null, busy = false, ctrl = null;

    function draw() {
      side.innerHTML = '<div class="ed-sh"><b>' + esc(s('title')) + '</b><button type="button" class="ed-x" data-a="close" aria-label="×">×</button></div>' +
        '<div class="ea-ctx"><span class="kicker">' + esc(s('ctx')) + '</span><p class="ea-q"></p></div>' +
        '<div class="ea-thread"></div>' +
        '<div class="ea-box"><textarea class="inp" rows="3" maxlength="4000" placeholder="' + esc(s('ph')) + '"></textarea>' +
        '<div class="ea-bar"><small class="muted">' + esc(s('cost')) + '</small><button type="button" class="pill sm" data-a="send">' + esc(s('send')) + '</button></div>' +
        '<div class="ea-links">' + (chat.id ? '<a class="link" href="#/c/' + esc(chat.id) + '">' + esc(s('chats')) + '</a>' : '') + (chat.history.length ? '<button type="button" class="link" data-a="new">' + esc(s('newQ')) + '</button>' : '') + '</div></div>';
      $('.ea-q', side).textContent = ctx && ctx.quote ? '«' + ctx.quote + '»' : s('whole') + ' — ' + s('pickHint');
      $('[data-a=close]', side).onclick = function () { side.hidden = true; };
      $('[data-a=send]', side).onclick = function () { send(); }; // never the click event as a "confirmed job"
      var nb = $('[data-a=new]', side); if (nb) nb.onclick = function () { chat = { id: null, history: [] }; try { localStorage.removeItem(KEY); } catch (e) {} draw(); };
      var ta = $('textarea', side);
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
      var th = $('.ea-thread', side);
      chat.history.forEach(function (m, i) { if (m.role === 'user') th.appendChild(userEl(shownOf(m))); else th.appendChild(answerEl(m.text, chat.history[i - 1] && chat.history[i - 1].place)); });
      th.scrollTop = th.scrollHeight;
      setTimeout(function () { ta.focus(); }, 0);
    }
    /** only the cost card's { service: units } - never anything else that reached send() */
    function isJob(x) { return !!x && Object.prototype.toString.call(x) === '[object Object]' && Object.keys(x).every(function (k) { return /^(analysis|opinion|explain)$/.test(k) && Number.isFinite(x[k]); }); }
    /** the question as the person wrote it (a saved message carries the place it was asked about before it) */
    function shownOf(m) {
      if (m.shown) return m.shown;
      var x = /\n\n(?:Savol|Вопрос): ([\s\S]*)$/.exec(String(m.text || ''));
      return x ? x[1] : m.text;
    }
    function userEl(text) { var el = J.h('<div class="ea-u"></div>'); el.textContent = text; return el; }
    /** An answer with its two one-tap actions: a comment on the place, or the text under the paragraph. */
    function answerEl(text, place) {
      var md = J.md(text, { answer: true });
      var el = J.h('<div class="ea-a"><div class="md"></div><div class="ea-act">' +
        (o.canComment ? '<button type="button" class="pill sm ghost" data-a="cm">' + J.icon('chat') + esc(s('asComment')) + '</button>' : '') +
        (o.canWrite ? '<button type="button" class="pill sm ghost" data-a="ins">' + J.icon('plus') + esc(s('asText')) + '</button>' : '') + '</div></div>');
      $('.md', el).innerHTML = md.html; // J.md escapes the text and only writes its own markup
      var plain = String(text || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
      var cm = $('[data-a=cm]', el);
      if (cm) cm.onclick = async function () {
        var r = place && place.quote ? J.editorFindQuote(ed, place.quote) : null;
        if (place && place.quote && !r) { J.toast(s('noPlace')); return; }
        cm.disabled = true;
        var ok = await o.addComment(r, place && place.quote, plain.slice(0, 4000));
        cm.disabled = false;
        if (ok) J.toast(s('commented'));
      };
      var ins = $('[data-a=ins]', el);
      if (ins) ins.onclick = function () {
        // under the paragraph asked about (or at the end), as plain paragraphs - never markup from the answer
        var r = place && place.quote ? J.editorFindQuote(ed, place.quote) : null;
        var at = ed.state.doc.content.size;
        if (r) { var $p = ed.state.doc.resolve(r.to); at = $p.depth ? $p.after(1) : at; }
        // the answer's own section headings (Tahlil / Xulosa) stay out of the document
        var paras = plain.split(/\n{2,}|\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^(Tahlil|Xulosa|Анализ|Вывод|Analysis|Conclusion):?$/i.test(l); }).slice(0, 60)
          .map(function (l) { return { type: 'paragraph', content: [{ type: 'text', text: l }] }; });
        if (!paras.length) return;
        ed.chain().focus().insertContentAt(at, paras).run();
        o.changed(); J.toast(s('inserted'));
      };
      return el;
    }

    async function send(confirmedJob) {
      if (busy) return;
      var ta = $('textarea', side), q = (ta.value || '').trim();
      if (!q) { ta.focus(); return; }
      busy = true;
      await o.flush();
      var docText = ed.getText({ blockSeparator: '\n' }).slice(0, 200000);
      var place = ctx && ctx.quote ? { quote: ctx.quote } : null;
      var msg = place ? s('q', { quote: place.quote.slice(0, 1500), q: q }) : q;
      var th = $('.ea-thread', side);
      th.appendChild(userEl(q));
      var a = J.h('<div class="ea-a ea-wait"><span class="spin"></span><span>' + esc(s('wait')) + '</span></div>'); th.appendChild(a); th.scrollTop = th.scrollHeight;
      ta.value = '';
      var body = { message: msg, history: chat.history.map(function (m) { return { role: m.role, text: m.text }; }), databases: ['lex.uz'], topic: null, topics: null, autoDetect: true,
        documentText: docText || null, docTicket: null, scanIds: null, confirmedJob: isJob(confirmedJob) ? confirmedJob : null, stream: true };
      ctrl = new AbortController();
      var done = null, err = null, res;
      try { res = await fetch('/api/legal-chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }); }
      catch (e) { err = { error: J.t('err.net') }; }
      if (res && (!res.ok || (res.headers.get('Content-Type') || '').indexOf('event-stream') < 0)) {
        var d = {}; try { d = await res.json(); } catch (e) { /* no body */ }
        if (res.status === 409 && d.code === 'DOC_COST_CONFIRM') { busy = false; a.remove(); th.lastChild && th.lastChild.remove(); return costCard(d, q); }
        if (res.ok) done = d; else { if (J.handleLimit && J.handleLimit(d)) { busy = false; a.remove(); return; } err = { error: J.errMsg(d) }; }
      } else if (res) {
        try {
          var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
          for (;;) {
            var rr = await reader.read(); if (rr.done) break;
            buf += dec.decode(rr.value, { stream: true });
            var idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
              var line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
              if (line.indexOf('data:') !== 0) continue;
              var ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
              if (ev.type === 'done') done = ev; else if (ev.type === 'error') err = ev;
            }
          }
        } catch (e) { err = err || { error: s('cut') }; }
      }
      busy = false; ctrl = null;
      J.refreshTariff && J.refreshTariff();
      if (!done) { a.className = 'ea-a'; a.innerHTML = '<p class="err"></p>'; $('.err', a).textContent = (err && (err.error || err.message)) || s('cut'); ta.value = q; return; }
      var reply = done.reply || '';
      chat.history.push({ role: 'user', text: msg, shown: q, place: place });
      chat.history.push({ role: 'model', text: reply });
      a.replaceWith(answerEl(reply, place));
      th.scrollTop = th.scrollHeight;
      save();
    }
    function costCard(d, q) {
      var th = $('.ea-thread', side);
      var card = J.h('<div class="card ea-cost"><b>' + esc(s('costTitle')) + '</b><p class="muted"></p><div class="btns"><button class="pill sm" data-a="ok">' + esc(s('costOk')) + '</button><button class="pill sm ghost" data-a="no">' + esc(s('costNo')) + '</button></div></div>');
      $('p', card).textContent = d.message || '';
      th.appendChild(card);
      $('[data-a=no]', card).onclick = function () { card.remove(); };
      $('[data-a=ok]', card).onclick = function () {
        var cj = {}, sv = d.services || [d.service || 'analysis'];
        (d.quotes || [d.quote]).forEach(function (x, i) { if (x) cj[sv[i]] = x.units; });
        card.remove(); $('textarea', side).value = q; send(cj);
      };
    }
    /** Into the person's chats (Suhbatlar), titled by the document; the same chat goes on next time. */
    async function save() {
      var r = await J.api('/api/ai-chat-sessions', { method: 'POST', body: { id: chat.id, title: '📝 ' + (o.title() || '').slice(0, 56), databases: ['lex.uz'], topic: 'editor:' + o.id,
        messages: chat.history.map(function (m) { return { role: m.role, text: m.text }; }) } });
      if (r.ok && r.data && r.data.id) {
        var first = !chat.id; chat.id = r.data.id;
        try { localStorage.setItem(KEY, String(chat.id)); } catch (e) { /* this browser only */ }
        if (first) { var links = $('.ea-links', side); if (links && !$('a', links)) links.insertBefore(J.h('<a class="link" href="#/c/' + esc(chat.id) + '">' + esc(s('chats')) + '</a>'), links.firstChild); }
        if (J.loadSessions) J.loadSessions();
      }
    }
    /** The saved chat of this document (this browser remembers which one). */
    async function load() {
      if (!chat.id || chat.history.length) return;
      var r = await J.api('/api/ai-chat-sessions/' + encodeURIComponent(chat.id));
      if (!r.ok || (r.data.topic && r.data.topic !== 'editor:' + o.id)) { chat.id = null; try { localStorage.removeItem(KEY); } catch (e) {} return; }
      chat.history = (r.data.messages || []).map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', text: m.text || '' }; });
    }

    return {
      el: side,
      open: async function (context) {
        // the place asked about: given by a card, else the words selected in the text
        if (context) ctx = context;
        else {
          var sel = ed.state.selection, q = sel.empty ? '' : ed.state.doc.textBetween(sel.from, sel.to, ' ').trim();
          ctx = q ? { quote: q.slice(0, 1500) } : null;
        }
        side.hidden = false;
        await load();
        draw();
      },
      hide: function () { side.hidden = true; if (ctrl) { /* the answer may still arrive; nothing is cut */ } }
    };
  };
})(window);
