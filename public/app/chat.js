/* AI huquqiy chat: yozish oynasi (@ hujjat, / ko'nikma), oqimli javob (bosqichlar), manbalar paneli, suhbatlar tarixi.
   Server: POST /api/legal-chat (SSE), /api/ai-chat-sessions, /api/analyze/extract, /api/analyze/scan-quote, /api/analyze/ocr-image. */
(function (G) {
  'use strict';
  var J = G.JAI, t = J.t, esc = J.esc, $ = J.$, $$ = J.$$;

  /* ================= KO'NIKMALAR =================
     kind 'chat'  — xabar serverga yuboriladi (msg: tayyor so'rov; prefix: foydalanuvchi matnidan oldin).
     kind 'nav'   — tegishli bo'limni ochadi.
     needDoc      — avval hujjat biriktirilishi kerak (tahlil va xulosa butun hujjat bo'yicha xizmat sifatida ishlaydi,
                    server narxni ko'rsatib tasdiq so'raydi: 409 DOC_COST_CONFIRM). */
  var L3 = function (uz, ru, en) { return { uz: uz, ru: ru, en: en }; };
  var BUILTIN = [
    { id: 'risk', icon: 'scan', kind: 'chat', needDoc: true, area: L3('Shartnoma', 'Договоры', 'Contracts'),
      name: L3('Shartnoma xavf tahlili', 'Анализ рисков договора', 'Contract risk review'),
      desc: L3('Xavfli bandlar, yetishmayotgan shartlar va tavsiyalar.', 'Опасные пункты, недостающие условия и рекомендации.', 'Risky clauses, missing terms and recommendations.'),
      msg: L3('Ushbu hujjatni to‘liq tahlil qiling: xavfli bandlar, yetishmayotgan shartlar va tavsiyalar.', 'Проанализируйте этот документ целиком: опасные пункты, недостающие условия и рекомендации.', 'Ushbu hujjatni to‘liq tahlil qiling: xavfli bandlar, yetishmayotgan shartlar va tavsiyalar. Answer in English.') },
    { id: 'opinion', icon: 'book', kind: 'chat', needDoc: true, area: L3('Umumiy', 'Общее', 'General'),
      name: L3('Yuridik xulosa', 'Юридическое заключение', 'Legal opinion'),
      desc: L3('Hujjat bo‘yicha rasmiy uslubdagi xulosa.', 'Заключение по документу в официальном стиле.', 'A formal opinion on the document.'),
      msg: L3('Ushbu hujjat bo‘yicha yuridik xulosa tayyorlang.', 'Подготовьте юридическое заключение по этому документу.', 'Ushbu hujjat bo‘yicha yuridik xulosa tayyorlang. Answer in English.') },
    { id: 'explain', icon: 'doc', kind: 'chat', needDoc: true, area: L3('Umumiy', 'Общее', 'General'),
      name: L3('Hujjatni oddiy tilda tushuntirish', 'Объяснить документ простым языком', 'Explain a document in plain words'),
      desc: L3('Asosiy mazmun, majburiyatlar va muddatlar.', 'Главное, обязанности и сроки.', 'Key points, obligations and deadlines.'),
      msg: L3('Ushbu hujjatning asosiy mazmunini, taraflar majburiyatlarini va muddatlarini oddiy tilda tushuntiring.', 'Объясните простым языком главное в этом документе, обязанности сторон и сроки.', 'Explain in plain English the key points of this document, the parties’ obligations and the deadlines.') },
    { id: 'deadline', icon: 'cal', kind: 'chat', area: L3('Umumiy', 'Общее', 'General'),
      name: L3('Muddatlarni aniqlash', 'Определить сроки', 'Find the deadlines'),
      desc: L3('Qonundagi muddatlar va ular qachon boshlanishi.', 'Сроки по закону и когда они начинаются.', 'Statutory deadlines and when they start.'),
      prefix: L3('Quyidagi vaziyatda qonunda belgilangan muddatlarni aniqlang va har biri qachon boshlanishini ko‘rsating: ', 'Определите сроки, установленные законом в следующей ситуации, и укажите, когда начинается каждый: ', 'List the statutory deadlines in the following situation and when each starts: ') },
    { id: 'labor', icon: 'team', kind: 'chat', area: L3('Mehnat', 'Труд', 'Employment'),
      name: L3('Mehnat nizosi bo‘yicha yo‘l', 'Порядок по трудовому спору', 'Employment dispute steps'),
      desc: L3('Xodim va ish beruvchining huquqlari, qadamlar.', 'Права работника и работодателя, шаги.', 'Rights of both sides and the steps.'),
      prefix: L3('Mehnat nizosi bo‘yicha xodim va ish beruvchining huquqlarini hamda qadamlarni tushuntiring: ', 'Объясните права работника и работодателя и шаги по трудовому спору: ', 'Explain the rights of employee and employer and the steps in this employment dispute: ') },
    { id: 'claim', icon: 'flag', kind: 'nav', to: '#/tayyorlash?type=claim', area: L3('Sud', 'Суд', 'Litigation'),
      name: L3('Talabnoma yoki ariza', 'Претензия или заявление', 'Demand letter or application'),
      desc: L3('Loyiha hujjat tayyorlash bo‘limida ochiladi.', 'Проект открывается в разделе подготовки.', 'Opens a draft in Drafting.') },
    { id: 'draft', icon: 'pen', kind: 'nav', to: '#/tayyorlash', area: L3('Hujjatlar', 'Документы', 'Documents'),
      name: L3('Hujjat yaratish', 'Создать документ', 'Draft a document'),
      desc: L3('Shablondan yoki AI bilan: shartnoma, buyruq, ariza.', 'По шаблону или с AI: договор, приказ, заявление.', 'From a template or with AI: contract, order, application.') },
    { id: 'lawyer', icon: 'scale', kind: 'nav', to: '#/advokatlar', area: L3('Advokatura', 'Адвокатура', 'Bar'),
      name: L3('Advokat topish', 'Найти адвоката', 'Find an attorney'),
      desc: L3('Litsenziyali advokat soha va hudud bo‘yicha.', 'Лицензированный адвокат по сфере и региону.', 'Licensed attorney by field and region.') }
  ];
  function L(o) { return o ? (o[J.lang] || o.uz) : ''; }
  J.skills = {
    builtin: BUILTIN,
    mine: function () { try { return JSON.parse(localStorage.getItem('jai-skills') || '[]'); } catch (e) { return []; } },
    saveMine: function (list) { try { localStorage.setItem('jai-skills', JSON.stringify(list.slice(0, 40))); } catch (e) {} },
    all: function () {
      return BUILTIN.map(function (s) { return { id: s.id, icon: s.icon, name: L(s.name), desc: L(s.desc), area: L(s.area), scope: 'j', builtin: true, src: s }; })
        .concat(J.skills.mine().map(function (s) { return { id: 'u:' + s.id, icon: 'spark', name: s.name, desc: s.ins, area: t('sk.mine'), scope: 'p', mine: true, src: s }; }));
    },
    byId: function (id) { return J.skills.all().filter(function (s) { return s.id === id; })[0] || null; },
    title: L
  };
  var SCOPE_IC = { p: 'user', t: 'team', o: 'layers', j: 'shield' };
  J.scopeTag = function (sc) { return '<span class="tag">' + J.icon(SCOPE_IC[sc] || 'user') + esc(t('sk.scope.' + sc)) + '</span>'; };

  /* ================= FAYL O'QISH ================= */
  var SCANNABLE = /\.(png|jpe?g|webp|heic|tiff?)$/i;
  async function readFile(file, onScanQuote, service) {
    var name = file.name || 'hujjat';
    var isImg = SCANNABLE.test(name) || /^image\//.test(file.type || '');
    if (!isImg) {
      var fd = new FormData(); fd.append('file', file);
      var r = await J.api('/api/analyze/extract', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(J.errMsg(r.data));
      if (!r.data.scanned && r.data.text && r.data.text.trim()) {
        return { name: name, text: r.data.text, docTicket: r.data.docTicket || null, pages: r.data.pageCount || null, chars: r.data.charCount || r.data.text.length, units: r.data.units || null };
      }
    }
    // skan yoki rasm: avval narx, so'ng tasdiq bilan OCR
    var fq = new FormData(); fq.append('file', file); fq.append('service', service || 'chat');
    var q = await J.api('/api/analyze/scan-quote', { method: 'POST', body: fq });
    if (!q.ok) throw new Error(J.errMsg(q.data));
    var ok = await onScanQuote(q.data);
    if (!ok) throw new Error('cancel');
    var fo = new FormData(); fo.append('file', file); fo.append('scanTicket', q.data.scanTicket); fo.append('confirmed', 'true');
    var o = await J.api('/api/analyze/ocr-image', { method: 'POST', body: fo });
    if (!o.ok) throw new Error(J.errMsg(o.data));
    return { name: name, scanId: o.data.scanId, pages: o.data.pages, chars: o.data.chars, units: o.data.units };
  }
  J.readFile = readFile;
  J.scanConfirm = function (q) {
    return new Promise(function (ok) {
      var m = J.modal({ cls: 'sm', onClose: function () { ok(false); }, html: '<h2>' + esc(q.title || t('cost.title')) + '</h2><p class="sub"></p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px"><button class="pill ghost" data-a="no">' + esc(t('cost.no')) + '</button><button class="pill" data-a="ok">' + esc(t('cost.ok')) + '</button></div>' });
      $('.sub', m.body).textContent = q.message || t('an.scan', { p: q.pages, u: q.units });
      $('[data-a=no]', m.body).onclick = function () { m.close(); };
      $('[data-a=ok]', m.body).onclick = function () { ok(true); m.el.remove(); };
    });
  };

  /* ================= YOZISH OYNASI ================= */
  /** opts: {onSend(payload), placeholder, compact} → api {el, focus, setSkill, addFiles, busy(bool), clearDocs} */
  J.composer = function (host, opts) {
    var st = { skill: null, files: [], busy: false };
    var el = J.h('<div class="cmp">' +
      '<div class="cmp-chips"></div>' +
      '<textarea rows="1"></textarea>' +
      '<div class="cmp-bar">' +
        '<button type="button" class="chip" data-a="at">' + J.icon('clip') + '<span>' + esc(t('cmp.attach')) + '</span></button>' +
        '<button type="button" class="chip" data-a="sl"><b>/</b><span>' + esc(t('cmp.skills')) + '</span></button>' +
        '<button type="button" class="chip cmp-mic" data-a="mic" hidden aria-label="' + esc(t('cmp.mic')) + '" title="' + esc(t('cmp.mic')) + '">' + J.icon('mic') + '<span class="mic-t"></span></button>' +
        '<span class="sp"></span><span class="src-lock">' + J.icon('shield') + esc(t('cmp.src')) + '</span>' +
        '<button type="button" class="send" aria-label="Send">' + J.icon('send') + '</button>' +
      '</div><input type="file" hidden multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,image/*"></div>');
    host.appendChild(el);
    var ta = $('textarea', el), chips = $('.cmp-chips', el), send = $('.send', el), fileIn = $('input[type=file]', el), menu = null;
    ta.placeholder = opts.placeholder || t('cmp.ph');
    function grow() { ta.style.height = 'auto'; ta.style.height = Math.min(240, ta.scrollHeight) + 'px'; }
    function drawChips() {
      var html = '';
      if (st.skill) html += '<span class="chip on static"><b>/</b><span>' + esc(st.skill.name) + '</span><button type="button" data-x="skill" aria-label="x">' + J.icon('x') + '</button></span>';
      st.files.forEach(function (f, i) {
        html += '<span class="chip static">' + (f.status === 'reading' ? '<span class="spin"></span>' : J.icon('doc')) + '<span>' + esc(f.name) + (f.status === 'reading' ? ' · ' + esc(t('cmp.reading')) : '') + '</span>' +
          '<button type="button" data-x="' + i + '" aria-label="x">' + J.icon('x') + '</button></span>';
      });
      chips.innerHTML = html;
      $$('[data-x]', chips).forEach(function (b) {
        b.onclick = function () { var x = b.dataset.x; if (x === 'skill') st.skill = null; else st.files.splice(+x, 1); drawChips(); };
      });
      sync();
    }
    function sync() { send.disabled = st.busy ? false : !(ta.value.trim() || st.skill || st.files.length); send.innerHTML = J.icon(st.busy ? 'stop' : 'send'); }
    function closeMenu() { if (menu) { menu.remove(); menu = null; } }
    function openMenu(kind, q) {
      closeMenu();
      menu = J.h('<div class="menu"></div>'); el.appendChild(menu);
      if (opts.menuDown) menu.classList.add('down');
      if (kind === 'at') {
        menu.innerHTML = '<div class="menu-h">' + esc(t('cmp.attach')) + '</div><button type="button" class="mi on" data-a="up">' + J.icon('up') + '<span class="mi-t">' + esc(t('an.drop')) + '<small>' + esc(t('an.types')) + '</small></span></button>';
        $('[data-a=up]', menu).onclick = function () { closeMenu(); fileIn.click(); };
        return;
      }
      var list = J.skills.all().filter(function (s) { return !q || (s.name + ' ' + s.area).toLowerCase().indexOf(q.toLowerCase()) > -1; });
      menu.innerHTML = '<div class="menu-h">' + esc(t('nav.skills')) + '</div>' + (list.length ? list.map(function (s, i) {
        return '<button type="button" class="mi' + (i === 0 ? ' on' : '') + '" data-id="' + esc(s.id) + '"><b class="k">/</b><span class="mi-t">' + esc(s.name) + '<small>' + esc(s.desc || '') + '</small></span>' + J.scopeTag(s.scope) + '</button>';
      }).join('') : '<div class="empty">—</div>');
      $$('.mi', menu).forEach(function (b) { b.onclick = function () { pick(b.dataset.id); }; });
    }
    function pick(id) {
      var s = J.skills.byId(id); if (!s) return;
      closeMenu(); ta.value = ta.value.replace(/(^|\s)\/[^\s]*$/, '$1').trimStart();
      if (s.src.kind === 'nav') { J.go(s.src.to); return; }
      st.skill = s; drawChips(); ta.focus();
      if (s.src.needDoc && !st.files.length && !(opts.hasDocs && opts.hasDocs())) J.toast(t('sk.attachfirst'));
    }
    function menuMove(d) {
      if (!menu) return false; var items = $$('.mi', menu); if (!items.length) return false;
      var i = items.findIndex(function (x) { return x.classList.contains('on'); });
      items.forEach(function (x) { x.classList.remove('on'); }); var n = items[(i + d + items.length) % items.length]; n.classList.add('on'); n.scrollIntoView({ block: 'nearest' });
      return true;
    }
    /* ---------- ovoz bilan yozish (diktovka): /api/voice/dictate, matn maydonga tushadi, avtomatik yuborilmaydi ---------- */
    (function dictation() {
      var mic = $('[data-a=mic]', el), lab = $('.mic-t', mic), rec = null, chunks = [], timer = null, secs = 0, MAX = 120;
      if (!G.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      if (J.dictationOk === undefined) J.dictationOk = J.api('/api/voice/balance').then(function (r) { return !!(r.ok && r.data && r.data.dictation); });
      J.dictationOk.then(function (ok) { mic.hidden = !ok; });
      var meter = null;
      function reset() { clearInterval(timer); timer = null; secs = 0; lab.textContent = ''; mic.classList.remove('on'); mic.disabled = false; if (meter) { meter.stop(); meter = null; } }
      async function stop() { if (rec && rec.state !== 'inactive') rec.stop(); }
      mic.onclick = async function () {
        if (rec && rec.state === 'recording') return stop();
        var stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { J.toast(t('cmp.mic.denied')); return; }
        chunks = [];
        rec = new MediaRecorder(stream);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = async function () {
          stream.getTracks().forEach(function (tr) { tr.stop(); });
          if (meter) { meter.stop(); meter = null; }
          clearInterval(timer); mic.classList.remove('on'); mic.disabled = true; lab.textContent = t('cmp.mic.busy');
          var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), fd = new FormData();
          fd.append('file', blob, 'dictation.' + (/ogg/.test(blob.type) ? 'ogg' : /mp4|aac/.test(blob.type) ? 'm4a' : 'webm'));
          fd.append('lang', J.lang === 'ru' ? 'ru' : 'uz');
          var r = await J.api('/api/voice/dictate', { method: 'POST', body: fd });
          reset();
          if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
          ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + r.data.text; grow(); sync(); ta.focus();
          // a word that looks like a mis-heard legal term is named, never changed (src/voice/glossary.js)
          var sg = r.data.suggestions || [];
          if (sg.length) J.toast(t('cmp.mic.check') + ' ' + sg.map(function (x) { return '«' + x.from + '» → «' + x.to + '»?'; }).join(', '), 7000);
        };
        rec.start();
        // the level and the time are shown by the meter; the label stays for "transcribing…"
        mic.classList.add('on'); secs = 0; lab.textContent = '';
        meter = J.micMeter(stream, mic);
        timer = setInterval(function () { secs++; if (secs >= MAX) stop(); }, 1000);
      };
    })();

    ta.addEventListener('input', function () {
      grow(); sync();
      var m = ta.value.match(/(?:^|\s)\/([^\s]*)$/);
      if (m) openMenu('sl', m[1]); else if (/(?:^|\s)@$/.test(ta.value)) { ta.value = ta.value.replace(/@$/, ''); openMenu('at'); } else if (menu && !menu.querySelector('[data-a=up]')) closeMenu();
    });
    ta.addEventListener('keydown', function (e) {
      if (menu) {
        if (e.key === 'ArrowDown') { if (menuMove(1)) e.preventDefault(); return; }
        if (e.key === 'ArrowUp') { if (menuMove(-1)) e.preventDefault(); return; }
        if (e.key === 'Escape') { closeMenu(); return; }
        if (e.key === 'Enter') { var on = $('.mi.on', menu); if (on) { e.preventDefault(); on.click(); return; } }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    document.addEventListener('mousedown', function (e) { if (menu && !el.contains(e.target)) closeMenu(); });
    $('[data-a=at]', el).onclick = function () { menu ? closeMenu() : openMenu('at'); };
    $('[data-a=sl]', el).onclick = function () { menu ? closeMenu() : openMenu('sl', ''); };
    fileIn.onchange = function () { addFiles(Array.prototype.slice.call(fileIn.files)); fileIn.value = ''; };
    el.addEventListener('dragover', function (e) { e.preventDefault(); });
    el.addEventListener('drop', function (e) { e.preventDefault(); addFiles(Array.prototype.slice.call(e.dataTransfer.files || [])); });
    function addFiles(files) {
      files.slice(0, 5).forEach(function (file) {
        var f = { name: file.name, status: 'reading' }; st.files.push(f); drawChips();
        readFile(file, J.scanConfirm).then(function (d) { Object.assign(f, d, { status: 'ready' }); drawChips(); })
          .catch(function (err) { var i = st.files.indexOf(f); if (i > -1) st.files.splice(i, 1); drawChips(); if (err.message !== 'cancel') J.toast(f.name + ': ' + err.message); });
      });
    }
    function submit() {
      if (st.busy) { if (opts.onStop) opts.onStop(); return; }
      if (st.files.some(function (f) { return f.status === 'reading'; })) { J.toast(t('cmp.wait')); return; }
      var text = ta.value.trim();
      if (!text && !st.skill && !st.files.length) return;
      var payload = { text: text, skill: st.skill, files: st.files.slice() };
      if (opts.onSend(payload) === false) return;
      ta.value = ''; st.skill = null; st.files = []; drawChips(); grow();
    }
    send.onclick = submit;
    drawChips();
    return {
      el: el, focus: function () { ta.focus(); },
      setText: function (s) { ta.value = s; grow(); sync(); ta.focus(); },
      setSkill: function (id) { pick(id); },
      addFiles: addFiles,
      busy: function (b) { st.busy = !!b; sync(); }
    };
  };

  /* ================= SUHBAT ================= */
  var C = J.chat = { id: null, history: [], docs: [], ctrl: null, pending: null };
  J.on('route', function (h) { if (!/^\/c\//.test(h) && C.ctrl) { /* boshqa bo'limga o'tganda oqim davom etadi */ } });

  J.newChat = function () { C.id = null; C.history = []; C.docs = []; C.title = ''; J.go('#/c/new'); };

  /** Bosh sahifadan birinchi xabar: suhbat ko'rinishiga o'tadi va yuboradi */
  J.startChat = function (payload) { C.id = null; C.history = []; C.docs = []; C.pending = payload; J.go('#/c/new'); };

  J.viewChat = async function (id) {
    var v = J.mount('<div class="chatv"><div class="thread"><div class="thread-in"></div></div><div class="dock"></div>' +
      '<aside class="drawer" aria-label="' + esc(t('src.title')) + '"><div class="drawer-h"><b>' + esc(t('src.title')) + '</b><button class="ib" data-a="cx">' + J.icon('x') + '</button></div><div class="drawer-b"></div></aside></div>');
    var thread = $('.thread-in', v), scroller = $('.thread', v), drawer = $('.drawer', v);
    $('[data-a=cx]', v).onclick = function () { drawer.classList.remove('open'); };
    v.addEventListener('click', function (e) {
      var c = e.target.closest('a.cite'); if (!c) return; e.preventDefault();
      var box = c.closest('.m-ai'); if (box && box._sources) openSources(box._sources, +c.dataset.src);
    });
    function openSources(list, focus) {
      var b = $('.drawer-b', drawer);
      b.innerHTML = list.length ? list.map(function (s) {
        return '<div class="src-item" data-n="' + s.n + '"><div><span class="n">' + s.n + '</span><b>' + esc(s.title) + '</b></div><p>' + esc(s.url.replace(/^https?:\/\//, '')) + '</p><a class="pill sm ghost" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(t('src.open')) + ' ↗</a></div>';
      }).join('') : '<p class="muted">' + esc(t('src.none')) + '</p>';
      drawer.classList.add('open');
      if (focus) { var it = $('[data-n="' + focus + '"]', b); if (it) { it.scrollIntoView({ block: 'center' }); it.style.borderColor = 'var(--cta)'; } }
    }
    var cmp = J.composer($('.dock', v), {
      placeholder: t('cmp.ph2'),
      hasDocs: function () { return C.docs.length > 0; },
      onSend: function (p) {
        var ready = p.files.filter(function (f) { return f.status === 'ready'; }).length;
        if (p.skill && p.skill.src.needDoc && !C.docs.length && !ready) { J.toast(t('sk.attachfirst')); return false; }
        send(p);
      },
      onStop: function () { if (C.ctrl) C.ctrl.abort(); }
    });
    $('.dock', v).appendChild(J.h('<p class="hint">' + esc(t('cmp.hint')) + '</p>'));
    var scroll = function () { scroller.scrollTop = scroller.scrollHeight; };

    function userBubble(text, chipsHtml) {
      var b = J.h('<div class="m-user">' + (chipsHtml ? '<div class="cmp-chips">' + chipsHtml + '</div>' : '') + '<span></span></div>');
      $('span:last-child', b).textContent = text; thread.appendChild(b); return b;
    }
    function aiBox() { var a = J.h('<div class="m-ai"></div>'); thread.appendChild(a); return a; }
    function finishAi(a, data, question) {
      var r = J.md(data.reply || '', { answer: true }); a._sources = r.sources; a._raw = data.reply || '';
      var html = '<div class="md">' + r.html + '</div>';
      if (data.documentScope && data.documentScope.note) html += '<div class="note' + ((data.documentScope.insufficient || (data.documentScope.unread && data.documentScope.unread.length)) ? ' warn' : '') + '"></div>';
      if (r.sources.length) {
        // tartibli ro'yxat: raqam, akt va qism, lex.uz havolasi (bir xil nom J.md'da bitta raqam)
        var rows = r.sources;
        html += '<div class="srcs"><div class="srcs-h">' + esc(t('act.sources')) + '</div><ol class="srcs-l">' + rows.slice(0, 8).map(function (s) {
          return '<li><span class="n">' + s.n + '</span><a class="srcs-t" href="#" data-s="' + s.n + '" title="' + esc(s.title) + '">' + esc(s.title) + '</a><a class="srcs-go" href="' + esc(s.url) + '" target="_blank" rel="noopener">lex.uz ↗</a></li>';
        }).join('') + '</ol>' + (rows.length > 8 ? '<button class="srcs-more" data-a="src">+' + (rows.length - 8) + '</button>' : '') + '</div>';
      }
      if (data.nextActions && data.nextActions.length) html += '<div class="next">' + data.nextActions.slice(0, 3).map(function (x, i) { return '<button class="chip" data-nx="' + i + '">' + J.icon('arrow') + esc(x.label || t('next.title')) + '</button>'; }).join('') + '</div>';
      html += '<div class="acts"><button class="ib" data-a="copy" title="' + esc(t('act.copy')) + '">' + J.icon('copy') + '</button><button class="ib" data-a="word" title="' + esc(t('act.word')) + '">' + J.icon('word') + '</button>' +
        (r.sources.length ? '<button class="ib" data-a="src" title="' + esc(t('act.sources')) + '">' + J.icon('book') + '</button>' : '') +
        (J.addToMatter ? '<button class="ib" data-a="matter" title="' + esc(J.matterText('add')) + '">' + J.icon('folder') + '</button>' : '') + '</div>';
      var body = J.h('<div>' + html + '</div>');
      var note = $('.note', body); if (note) note.textContent = data.documentScope.note;
      a.appendChild(body);
      $$('[data-s]', body).forEach(function (c) { c.onclick = function (e) { e.preventDefault(); openSources(r.sources, +c.dataset.s); }; });
      $$('[data-nx]', body).forEach(function (b) {
        b.onclick = function () {
          var x = data.nextActions[+b.dataset.nx];
          if (x.kind === 'attorney') J.go('#/advokatlar');
          else if (x.kind === 'document') { J.draftPrefill = { type: x.documentType || x.label, question: question, answer: data.reply, action: x.label, from: location.hash || '#/' }; J.go('#/tayyorlash?type=ai'); }
        };
      });
      $('[data-a=copy]', body).onclick = function () { navigator.clipboard.writeText(J.plain(r.html)).then(function () { J.toast(t('act.copied')); }); };
      $('[data-a=word]', body).onclick = function () { J.exportWord((question || 'JuristAI').slice(0, 60), '<h2>' + esc(question || '') + '</h2>' + r.html); };
      $$('[data-a=src]', body).forEach(function (sb) { sb.onclick = function () { openSources(r.sources); }; });
      // the whole chat goes into a matter (the session is saved after the answer)
      var mb = $('[data-a=matter]', body);
      if (mb) mb.onclick = async function () {
        if (!C.id) await save();
        if (!C.id) { J.toast(J.matterText('waitChat')); return; }
        J.addToMatter({ kind: 'chat', ref: Number(C.id) || C.id, title: C.title || (question || '').slice(0, 80) });
      };
    }

    // ---- javob bosqichlari (6 qatlamning foydalanuvchiga ko'rinadigan qismi) ----
    var STEP_OF = { search: 1, sources: 1, compose: 2, verify: 3 };
    function stepsEl() {
      return J.h('<div class="steps">' + [0, 1, 2, 3].map(function (i) { return '<div class="step' + (i === 0 ? ' cur' : '') + '"><span class="s"></span><span>' + esc(t('steps.' + i)) + '</span></div>'; }).join('') + '</div>');
    }
    function setStep(se, i) { $$('.step', se).forEach(function (s, k) { s.classList.toggle('ok', k < i); s.classList.toggle('cur', k === i); }); }
    function doneSteps(se, nSrc) {
      $$('.step', se).forEach(function (s) { s.classList.remove('cur'); s.classList.add('ok'); });
      se.classList.add('done'); var last = $$('.step', se).pop();
      $('span:last-child', last).textContent = t('steps.done', { n: 4 }) + (nSrc ? ' · ' + t('src.n', { n: nSrc }) : '');
    }

    async function send(p) {
      var skill = p.skill, text = p.text;
      C.docs = C.docs.concat(p.files.filter(function (f) { return f.status === 'ready'; }));
      var msg = text;
      if (skill && skill.builtin) {
        var s = skill.src;
        if (s.msg) msg = L(s.msg) + (text ? '\n\n' + text : '');
        else if (s.prefix) msg = L(s.prefix) + (text || '');
      } else if (skill && skill.mine) {
        msg = (text || skill.name) + '\n\n' + (J.lang === 'ru' ? 'Требования к ответу: ' : J.lang === 'en' ? 'Answer requirements: ' : 'Javobga talablar: ') + skill.src.ins;
      }
      if (!msg && C.docs.length) msg = L(BUILTIN[2].msg);
      if (!msg) return false;
      var shown = text || (skill ? skill.name : msg);
      var chipsHtml = (skill ? '<span class="chip on static"><b>/</b><span>' + esc(skill.name) + '</span></span>' : '') +
        p.files.map(function (f) { return '<span class="chip static">' + J.icon('doc') + '<span>' + esc(f.name) + '</span></span>'; }).join('');
      userBubble(shown, chipsHtml);
      C.history.push({ role: 'user', text: msg });
      if (!C.title) C.title = shown.slice(0, 60);
      J.setTitle(C.title);
      scroll();
      await ask(msg, shown, null);
    }

    async function ask(msg, shown, confirmedJob) {
      var a = aiBox(), se = stepsEl(); a.appendChild(se); scroll();
      cmp.busy(true);
      var typed = C.docs.filter(function (d) { return !d.scanId; }), scans = C.docs.filter(function (d) { return d.scanId; });
      var documentText = typed.length === 1 ? typed[0].text : typed.map(function (d) { return '【' + d.name + '】\n' + d.text; }).join('\n\n');
      var body = {
        message: msg, history: C.history.slice(0, -1).map(function (h) { return { role: h.role, text: h.text }; }),
        databases: ['lex.uz'], topic: null, topics: null, autoDetect: true,
        documentText: documentText || null, docTicket: typed.length === 1 ? (typed[0].docTicket || null) : null,
        scanIds: scans.length ? scans.map(function (d) { return { id: d.scanId, name: d.name }; }) : null,
        confirmedJob: confirmedJob, stream: true
      };
      C.ctrl = new AbortController();
      var res;
      try { res = await fetch('/api/legal-chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: C.ctrl.signal }); }
      catch (e) { cmp.busy(false); se.remove(); a.appendChild(J.h('<p class="err">' + esc(t('err.net')) + '</p>')); return; }
      if (res.status === 401) return J.toLogin();
      var ct = res.headers.get('Content-Type') || '';
      if (!res.ok || ct.indexOf('event-stream') < 0) {
        var d = {}; try { d = await res.json(); } catch (e) {}
        if (!res.ok && d && typeof d === 'object') d._status = res.status;
        se.remove(); cmp.busy(false);
        if (res.status === 409 && d.code === 'DOC_COST_CONFIRM') return costCard(a, d, msg, shown);
        if (res.ok) { finishAi(a, d, shown); afterReply(d); return; }
        C.history.pop();
        var lim = J.handleLimit(d);
        a.appendChild(J.h('<div class="note"></div>')); $('.note', a).textContent = J.errMsg(d);
        if (lim) { var bt = J.h('<div class="btns" style="margin-top:10px"><button class="pill sm">' + esc(t('limit.btn')) + '</button></div>'); bt.firstChild.onclick = function () { J.openPlans({ ended: true }); }; a.appendChild(bt); }
        return;
      }
      // SSE oqimi
      var live = null, acc = '', done = null, err = null;
      function ensureLive() { if (!live) { live = J.h('<div class="md live"></div>'); a.appendChild(live); } return live; }
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
            if (ev.type === 'status') setStep(se, STEP_OF[ev.kind] != null ? STEP_OF[ev.kind] : 1);
            else if (ev.type === 'status_clear') { acc = ''; if (live) live.textContent = ''; }
            else if (ev.type === 'token') { setStep(se, 2); acc += ev.t; ensureLive().textContent = acc; if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160) scroll(); }
            else if (ev.type === 'replace') { setStep(se, 3); acc = ev.text; ensureLive().textContent = acc; }
            else if (ev.type === 'done') done = ev;
            else if (ev.type === 'error') err = ev;
          }
        }
      } catch (e) { if (e.name === 'AbortError') err = { error: '—' }; else err = err || { error: t('err.cut') }; }
      cmp.busy(false); C.ctrl = null;
      if (live) live.remove();
      if (done) { var n = J.md(done.reply || '').sources.length; doneSteps(se, n); finishAi(a, done, shown); afterReply(done); scroll(); return; }
      se.remove(); C.history.pop();
      var p2 = J.h('<p class="err"></p>'); p2.textContent = (err && err.error) || t('err.cut'); a.appendChild(p2);
      if (err && err.quotaRefunded) a.appendChild(J.h('<p class="muted" style="font-size:13px">↺</p>'));
    }
    function afterReply(d) {
      C.history.push({ role: 'model', text: d.reply || '', nextActions: d.nextActions || [] });
      save(); J.refreshTariff();
    }
    function costCard(a, d, msg, shown) {
      var card = J.h('<div class="card"><h4>' + esc(t('cost.title')) + '</h4><p class="muted" style="font-size:14px"></p><div class="btns"><button class="pill sm" data-a="ok">' + esc(t('cost.ok')) + '</button><button class="pill sm ghost" data-a="no">' + esc(t('cost.no')) + '</button></div></div>');
      $('p', card).textContent = d.message || '';
      a.appendChild(card); scroll();
      $('[data-a=no]', card).onclick = function () { a.remove(); C.history.pop(); };
      $('[data-a=ok]', card).onclick = function () {
        var cj = {}; var sv = d.services || [d.service || 'analysis'];
        (d.quotes || [d.quote]).forEach(function (q, i) { if (q) cj[sv[i]] = q.units; });
        a.remove(); ask(msg, shown, cj);
      };
    }
    async function save() {
      if (C.history.length < 2) return;
      // birinchi saqlash tugamay ikkinchisi kelsa, ikkita bir xil suhbat yaratilmasin
      if (C.saving) { C.saveAgain = true; return; }
      C.saving = true;
      try { await saveNow(); } finally { C.saving = false; }
      if (C.saveAgain) { C.saveAgain = false; save(); }
    }
    async function saveNow() {
      var r = await J.api('/api/ai-chat-sessions', { method: 'POST', body: { id: C.id, title: C.title || C.history[0].text.slice(0, 60), databases: ['lex.uz'], topic: null, messages: C.history } });
      if (r.ok && r.data.id) {
        var isNew = !C.id; C.id = r.data.id;
        if (isNew) history.replaceState(null, '', '#/c/' + C.id);
        J.loadSessions();
      }
    }

    // ---- ochish: yangi yoki saqlangan suhbat ----
    if (id && id !== 'new') {
      if (String(C.id) !== String(id) || !C.history.length) {
        C.id = id; C.history = []; C.docs = [];
        thread.innerHTML = '<div class="skel" style="width:60%"></div><div class="skel" style="width:90%"></div>';
        var r = await J.api('/api/ai-chat-sessions/' + encodeURIComponent(id));
        thread.innerHTML = '';
        if (!r.ok) { thread.appendChild(J.h('<p class="muted">' + esc(J.errMsg(r.data)) + '</p>')); return; }
        C.title = r.data.title || ''; C.history = (r.data.messages || []).map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', text: m.text || '', nextActions: m.nextActions || [] }; });
      }
      J.setTitle(C.title);
      var lastQ = '';
      C.history.forEach(function (m) { if (m.role === 'user') { lastQ = m.text; userBubble(m.text); } else finishAi(aiBox(), { reply: m.text, nextActions: m.nextActions }, lastQ); });
      scroll();
    } else {
      J.setTitle(t('new'));
      if (C.pending) { var p = C.pending; C.pending = null; send(p); }
      else cmp.focus();
    }
  };

  /* ================= TARIX ================= */
  J.loadSessions = async function () {
    var r = await J.api('/api/ai-chat-sessions');
    J.S.sessions = r.ok && Array.isArray(r.data) ? r.data : [];
    J.emit('sessions');
  };
})(window);
