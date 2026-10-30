/* JuristAI — Word task pane (va Google Docs yon paneli: window.JAI_HOST + window.JAI_BASE, public/gdocs/).
   Kirish: qurilmani ulash (POST /api/addin/pair → brauzerda /word/ulash.html → token).
   Server: POST /api/legal-chat (SSE), GET /api/user-info, POST /api/addin/logout, playbook (GET /api/playbooks,
   POST /api/agent/playbook-review, GET /api/agent/runs/:id) va ishlar (GET/POST /api/matters, POST /api/matters/:id/items)
   — hammasi "Authorization: Bearer". */
(function () {
  'use strict';
  var TOKEN_KEY = (window.JAIShared && window.JAIShared.TOKEN_KEY) || 'juristai-word-token';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  var store = {
    get: function () { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return mem.token || ''; } },
    set: function (v) { mem.token = v; try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  };
  var mem = { token: '' };

  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3800); }

  /* ---------------- Office ---------------- */
  var inWord = false;
  function has14() { try { return inWord && Office.context.requirements.isSetSupported('WordApi', '1.4'); } catch (e) { return false; } }
  function needWord() { if (!inWord || typeof Word === 'undefined') throw new Error("Bu amal faqat Word ichida ishlaydi."); }
  function openBrowser(url) {
    if (window.JAI_HOST && window.JAI_HOST.openBrowser) { window.JAI_HOST.openBrowser(url); return; }
    try {
      if (inWord && Office.context.requirements.isSetSupported('OpenBrowserWindowApi', '1.1')) { Office.context.ui.openBrowserWindow(url); return; }
    } catch (e) {}
    window.open(url, '_blank', 'noopener');
  }

  var W = {
    bodyText: function () {
      needWord();
      return Word.run(function (ctx) { var b = ctx.document.body; b.load('text'); return ctx.sync().then(function () { return b.text || ''; }); });
    },
    /** tanlangan matn va keyin almashtirish uchun kuzatiladigan diapazon */
    selection: function () {
      needWord();
      return Word.run(function (ctx) {
        var r = ctx.document.getSelection(); r.load('text'); r.track();
        return ctx.sync().then(function () { return { text: r.text || '', range: r }; });
      });
    },
    /** saqlangan diapazonni yangi matn bilan almashtiradi; track: Track Changes bilan; comment: izoh */
    replace: function (saved, text, o) {
      needWord(); o = o || {};
      var api14 = has14();
      return Word.run(saved.range, function (ctx) {
        var doc = ctx.document, prev = null;
        var chain = Promise.resolve();
        if (o.track && api14) {
          doc.load('changeTrackingMode');
          chain = ctx.sync().then(function () { prev = doc.changeTrackingMode; doc.changeTrackingMode = 'TrackAll'; return ctx.sync(); });
        }
        return chain.then(function () {
          var nr = saved.range.insertText(text, 'Replace');
          if (o.comment && api14) nr.insertComment(o.comment);
          return ctx.sync();
        }).then(function () {
          if (prev != null && prev !== 'TrackAll') { doc.changeTrackingMode = prev; return ctx.sync(); }
        });
      });
    },
    comment: function (saved, text) {
      needWord();
      if (!has14()) return Promise.reject(new Error("Bu Word versiyasida izoh qo'shib bo'lmaydi."));
      return Word.run(saved.range, function (ctx) { saved.range.insertComment(text); return ctx.sync(); });
    },
    /** ko'rib chiqish natijasini hujjatga yozadi: har bir muammo o'z joyiga izoh (WordApi 1.4) yoki sariq belgi;
        edits: iqtibos to'liq topilsa, tuzatish Track Changes bilan kiritiladi */
    review: function (items, o) {
      needWord(); o = o || {};
      var S = window.JAIShared, api14 = has14();
      return Word.run(async function (ctx) {
        var doc = ctx.document, body = doc.body;
        var head = body.paragraphs.getFirst().getRange('Whole');
        var found = items.map(function (it) {
          var q = String(it.quote || '').replace(/\s+/g, ' ').trim();
          return S.needles(q).map(function (n) {
            var rc = body.search(S.wordSearchText(n), { matchCase: false, ignorePunct: true, ignoreSpace: true });
            rc.load('items');
            return { rc: rc, full: n === q };
          });
        });
        await ctx.sync();
        var prev = null;
        if (o.edits && api14) {
          doc.load('changeTrackingMode'); await ctx.sync();
          prev = doc.changeTrackingMode; doc.changeTrackingMode = 'TrackAll'; await ctx.sync();
        }
        var out = items.map(function (it, i) {
          var hit = null;
          found[i].some(function (f) { if (f.rc.items.length) { hit = f; return true; } return false; });
          var where = hit ? 'found' : (it.quote ? 'missing' : 'general'), edited = false;
          var target = hit ? hit.rc.items[0] : head;
          var text = S.commentText(it);
          if (where === 'missing') text = '«' + it.quote.slice(0, 120) + '» (matnda aniq topilmadi)\n' + text;
          if (where === 'general') text = text.replace(/^JuristAI: /, 'JuristAI (yetishmayotgan shart): ');
          if (hit && o.edits && api14 && it.newText && hit.full) { target = target.insertText(it.newText, 'Replace'); edited = true; }
          if (api14) target.insertComment(text); else if (hit) target.font.highlightColor = 'Yellow';
          return { where: where, edited: edited };
        });
        await ctx.sync();
        if (prev != null && prev !== 'TrackAll') { doc.changeTrackingMode = prev; await ctx.sync(); }
        return out;
      });
    },
    /** JuristAI qo'ygan izohlarni o'chiradi (Track Changes tuzatishlari Word'ning o'zida qabul/rad qilinadi) */
    removeReview: function () {
      needWord();
      if (!has14()) return Promise.reject(new Error("Bu Word versiyasida izohlar bilan ishlab bo'lmaydi."));
      return Word.run(async function (ctx) {
        var cs = ctx.document.body.getComments(); cs.load('items/content'); await ctx.sync();
        var n = 0;
        cs.items.forEach(function (c) { if (/^(«[^»]*» \(matnda aniq topilmadi\)\n)?JuristAI[ :(]/.test(c.content || '')) { c.delete(); n++; } });
        await ctx.sync();
        return n;
      });
    },
    /** javobni kursor (tanlov) dan keyin formatlangan holda qo'yadi */
    insertAfter: function (html) {
      needWord();
      return Word.run(function (ctx) {
        var r = ctx.document.getSelection();
        r.insertHtml(html, 'After');
        return ctx.sync();
      });
    }
  };

  /* ---------------- hujjat muhiti: Word (standart) yoki tashqi (Google Docs) ---------------- */
  var BASE = String(window.JAI_BASE || '').replace(/\/+$/, '');
  var docReady = false;
  var host = window.JAI_HOST || {
    name: 'word',
    bodyText: W.bodyText, selection: W.selection, replace: W.replace, comment: W.comment,
    review: W.review, removeReview: W.removeReview,
    insertAnswer: function (reply, r) { return W.insertAfter(wordHtml(r)); },
    caps: function () {
      var y = has14();
      return { track: y, comment: y, trackLabel: 'Track Changes bilan qo\'yish', noTrackLabel: 'Almashtirish (Track Changes yo\'q)',
        reviewSub: y ? 'Har bir xavfli band hoshiyada izoh bilan belgilanadi' : 'Xavfli bandlar sariq rang bilan belgilanadi',
        reviewEdits: y ? 'Tuzatishlarni Track Changes bilan kiritish' : '', reviewClear: y };
    }
  };

  /* ---------------- API ---------------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json' };
    var tok = store.get(); if (tok) headers.Authorization = 'Bearer ' + tok;
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(BASE + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'omit', signal: opts.signal });
  }
  function jsonOf(res) { return res.json().catch(function () { return {}; }); }

  /* ---------------- views ---------------- */
  function show(v) { $('#vConnect').hidden = v !== 'connect'; $('#vMain').hidden = v !== 'main'; $('#who').hidden = v !== 'main'; }

  function boot() {
    if (!store.get()) { show('connect'); return; }
    api('/api/user-info').then(function (res) {
      if (res.status === 401) { store.set(''); show('connect'); return; }
      return jsonOf(res).then(function (d) {
        $('#whoName').textContent = (d.fullName || d.username || '') + (d.tariffPlan ? ' · ' + d.tariffPlan : '');
        show('main');
        loadPlaybooks();
      });
    }).catch(function () { show('main'); toast("Server bilan aloqa yo'q. Internetni tekshiring."); });
  }

  /* ---- ulash ---- */
  var pollT = null;
  function stopPoll() { if (pollT) { clearInterval(pollT); pollT = null; } }
  $('#connect').onclick = function () {
    var btn = this; btn.disabled = true; $('#connectErr').hidden = true;
    fetch(BASE + '/api/addin/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit' })
      .then(function (res) { return jsonOf(res).then(function (d) { if (!res.ok) throw new Error(d.message || d.error || ('Xato ' + res.status)); return d; }); })
      .then(function (p) {
        $('#pairBox').hidden = false; $('#pairCode').textContent = p.code; $('#pairUrl').textContent = p.connectUrl;
        $('#pairState').textContent = 'Tasdiqlash kutilmoqda…';
        $('#openLink').onclick = function () { openBrowser(p.connectUrl); };
        openBrowser(p.connectUrl);
        var until = Date.now() + (p.expiresIn || 600) * 1000;
        stopPoll();
        pollT = setInterval(function () {
          if (Date.now() > until) { stopPoll(); expired(); return; }
          fetch(BASE + '/api/addin/pair/' + p.pairId, { credentials: 'omit', cache: 'no-store' }).then(jsonOf).then(function (d) {
            if (d.status === 'approved' && d.token) { stopPoll(); store.set(d.token); $('#pairBox').hidden = true; btn.disabled = false; toast('Akkaunt ulandi'); boot(); }
            else if (d.status === 'expired') { stopPoll(); expired(); }
          }).catch(function () {});
        }, 2000);
      })
      .catch(function (e) { btn.disabled = false; $('#connectErr').textContent = e.message || "Ulab bo'lmadi"; $('#connectErr').hidden = false; });
    function expired() { btn.disabled = false; $('#pairState').textContent = "Kod muddati o'tdi. Qaytadan \"Ulash\"ni bosing."; }
  };
  $('#logout').onclick = function () {
    api('/api/addin/logout', { method: 'POST', body: {} }).catch(function () {}).then(function () { store.set(''); $('#outDoc').innerHTML = ''; $('#outSel').innerHTML = ''; $('#chatLog').innerHTML = ''; history = []; show('connect'); });
  };

  /* ---- yorliqlar ---- */
  $$('.tabs button').forEach(function (b) {
    b.onclick = function () {
      $$('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      $$('.tab').forEach(function (p) { p.hidden = p.dataset.pane !== b.dataset.tab; });
      if (b.dataset.tab === 'sel') refreshSel();
    };
  });

  /* ---------------- markdown (xavfsiz) ---------------- */
  function md(text) {
    text = String(text || '').replace(/<!--REASONING-->[\s\S]*?<!--\/REASONING-->\s*/g, '').replace(/<!--YURXIZMAT-->[\s\S]*?<!--\/YURXIZMAT-->\s*/g, '');
    var sources = [], byUrl = {};
    function addSrc(title, url) { var k = url; if (byUrl[k]) return byUrl[k]; var n = sources.length + 1; sources.push({ n: n, title: title, url: url }); byUrl[k] = n; return n; }
    var foot = text.match(/(?:^|\n)\s*(?:---\s*\n\s*)?(?:#{1,6}\s*)?(?:\*{0,2})\s*(?:📎\s*)?(?:Manbalar|Источники|Sources)\s*(?:\*{0,2})\s*:?\s*([\s\S]*)$/iu);
    if (foot) { foot[1].replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, t, u) { addSrc(t, u); return m; }); text = text.slice(0, foot.index); }
    function inline(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>'); }
    function links(s) {
      return s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, t, u) {
        var url = u.replace(/&amp;/g, '&');
        if (/lex\.uz/i.test(url)) { var n = addSrc(t, url); return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + t + '</a><a class="cite" href="' + esc(url) + '" target="_blank" rel="noopener">' + n + '</a>'; }
        return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + t + '</a>';
      });
    }
    var lines = esc(text).split('\n'), out = [], buf = [], i = 0;
    function para() { if (buf.length) out.push('<p>' + links(inline(buf.join('<br>'))) + '</p>'); buf = []; }
    while (i < lines.length) {
      var l = lines[i], hm = l.match(/^(#{1,6})\s+(.*)$/);
      if (/^\s*$/.test(l)) { para(); i++; continue; }
      if (hm) { para(); var lv = Math.min(4, Math.max(2, hm[1].length)); out.push('<h' + lv + '>' + links(inline(hm[2])) + '</h' + lv + '>'); i++; continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(l)) { para(); out.push('<hr>'); i++; continue; }
      if (/^\s*&gt;\s?/.test(l)) { para(); var q = []; while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++; } out.push('<blockquote>' + links(inline(q.join('<br>'))) + '</blockquote>'); continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        para(); var head = l.trim().replace(/^\||\|$/g, '').split('|'); i += 2; var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|')); i++; }
        out.push('<div class="tbl"><table><thead><tr>' + head.map(function (c) { return '<th>' + links(inline(c.trim())) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + links(inline(c.trim())) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        para(); var ordered = /^\s*\d+[.)]\s+/.test(l), items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++; }
        out.push((ordered ? '<ol>' : '<ul>') + items.map(function (it) { return '<li>' + links(inline(it)) + '</li>'; }).join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }
      buf.push(l); i++;
    }
    para();
    return { html: out.join(''), sources: sources };
  }
  function srcHtml(sources) {
    if (!sources.length) return '';
    return '<div class="srcs"><span class="kicker">Manbalar</span><ol>' + sources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></li>'; }).join('') + '</ol></div>';
  }
  /** Word'ga qo'yiladigan HTML: iqtibos raqamlari olib tashlanadi, manbalar ro'yxat bo'lib qo'shiladi */
  function wordHtml(r) {
    var body = r.html.replace(/<a class="cite"[^>]*>\d+<\/a>/g, '').replace(/<div class="tbl">|<\/div>/g, '');
    var src = r.sources.length ? '<p><b>Manbalar:</b></p><ol>' + r.sources.map(function (s) { return '<li><a href="' + esc(s.url) + '">' + esc(s.title) + '</a></li>'; }).join('') + '</ol>' : '';
    return '<div style="font-family:Calibri,Arial,sans-serif">' + body + src + '</div>';
  }

  function copyText(t) {
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
    try { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(fallback); } catch (e) {}
    fallback(); return Promise.resolve();
  }

  /* ---------------- natija kartasi ---------------- */
  // Word 2016/2019 (EdgeHTML) has no TextDecoder / streamed body: the answer then comes whole, as JSON
  var CAN_STREAM = !!(window.TextDecoder && window.ReadableStream && window.Response && Response.prototype && 'body' in Response.prototype);
  var busy = false, ctrl = null;
  function setBusy(v) { busy = v; $$('.act, #selGo, #chatGo, #pbGo').forEach(function (b) { b.disabled = v; }); }
  function card(title, where) {
    var el = h('<div class="res"><div class="res-h"><span class="kicker"></span><button type="button" class="x" title="Yopish" aria-label="Yopish">×</button></div><div class="steps"><span class="spin"></span><span class="st">Qonunlar qidirilmoqda…</span></div><div class="live" hidden></div><div class="body"></div></div>');
    $('.kicker', el).textContent = title;
    $('.x', el).onclick = function () { if (ctrl && busy) ctrl.abort(); el.remove(); };
    where.insertBefore(el, where.firstChild);
    return el;
  }
  var STEP = { search: 'Qonunlar qidirilmoqda…', retrieve: 'Manbalar tanlanmoqda…', generate: 'Javob yozilmoqda…', verify: 'Manbalar tekshirilmoqda…' };

  var TOO_BIG_BYTES = 1900000;
  function jsonBytes(o) {
    var str = JSON.stringify(o);
    if (window.TextEncoder) return new TextEncoder().encode(str).length;
    try { return unescape(encodeURIComponent(str)).length; } catch (e) { return str.length * 3; }
  }
  /** /api/legal-chat (SSE). Qaytaradi: { reply } yoki null (xato kartada ko'rsatilgan) */
  function askLegal(el, payload) {
    var body = { message: payload.message, history: payload.history || [], databases: ['lex.uz'], topic: null, topics: null, autoDetect: true,
      documentText: payload.documentText || null, docTicket: null, scanIds: null, confirmedJob: payload.confirmedJob || null, stream: CAN_STREAM };
    // the server takes a JSON body up to 2 MB: count UTF-8 bytes (a Cyrillic
    // letter is 2), not characters - a 700 000-letter Russian contract is ~1.4 MB
    if (body.documentText && jsonBytes(body) > TOO_BIG_BYTES) { fail(el, "Hujjat juda katta (2 MB chegarasidan oshadi). Bir qismini belgilab, \"Tanlangan matn\" orqali yuboring."); return Promise.resolve(null); }
    ctrl = window.AbortController ? new AbortController() : null; setBusy(true);
    var st = $('.st', el), live = $('.live', el), acc = '';
    return api('/api/legal-chat', { method: 'POST', body: body, signal: ctrl ? ctrl.signal : undefined }).then(function (res) {
      if (res.status === 401) { setBusy(false); store.set(''); show('connect'); toast("Ulanish muddati tugagan. Akkauntni qayta ulang."); el.remove(); return null; }
      var ct = res.headers.get('Content-Type') || '';
      if (!res.ok || ct.indexOf('event-stream') < 0) {
        return jsonOf(res).then(function (d) {
          setBusy(false);
          if (res.status === 409 && d.code === 'DOC_COST_CONFIRM') return costConfirm(el, d, payload);
          if (res.ok && d.reply) return d;
          if (res.status === 413) { fail(el, "Hujjat juda katta (2 MB chegarasidan oshadi). Bir qismini belgilab, \"Tanlangan matn\" orqali yuboring."); return null; }
          limitOrFail(el, d); return null;
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', done = null, err = null;
      function pump() {
        return reader.read().then(function (rr) {
          if (rr.done) return;
          buf += dec.decode(rr.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n')) !== -1) {
            var line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
            if (line.indexOf('data:') !== 0) continue;
            var ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
            if (ev.type === 'status') st.textContent = STEP[ev.kind] || ev.text || st.textContent;
            else if (ev.type === 'status_clear') { acc = ''; live.textContent = ''; }
            else if (ev.type === 'token') { st.textContent = STEP.generate; acc += ev.t; live.hidden = false; live.textContent = acc; live.scrollTop = live.scrollHeight; }
            else if (ev.type === 'replace') { st.textContent = STEP.verify; acc = ev.text; live.hidden = false; live.textContent = acc; }
            else if (ev.type === 'done') done = ev;
            else if (ev.type === 'error') err = ev;
          }
          return pump();
        });
      }
      return pump().then(function () {
        setBusy(false); live.hidden = true;
        if (done) return done;
        limitOrFail(el, err || { error: "Javob uzilib qoldi. Qayta urinib ko'ring." }); return null;
      });
    }).catch(function (e) {
      setBusy(false); live.hidden = true;
      fail(el, e && e.name === 'AbortError' ? "To'xtatildi." : "Server bilan aloqa yo'q. Internetni tekshiring.");
      return null;
    });
  }
  function fail(el, msg) { $('.steps', el).remove(); $('.body', el).appendChild(h('<p class="err"></p>')).textContent = msg; }
  function limitOrFail(el, d) {
    d = d || {};
    var msg = d.message || (typeof d.error === 'string' && d.error.length > 3 && !/^[a-z_]+$/.test(d.error) ? d.error : '') || "Xatolik yuz berdi. Qayta urinib ko'ring.";
    fail(el, msg);
    var url = null, label = null;
    if (d.code === 'QUOTA_EXCEEDED' || d.code === 'PLAN_REQUIRED' || d.code === 'NOT_IN_PLAN' || d.upgradeUrl) { url = '/tariflar.html'; label = 'Tariflarni ko\'rish'; }
    else if (d.code === 'CHANNEL_REQUIRED' || d.code === 'SURVEY_REQUIRED') { url = '/app/'; label = 'Saytda davom etish'; }
    if (url) { var b = h('<div class="btns"><button type="button" class="pill sm"></button></div>'); b.firstChild.textContent = label; b.firstChild.onclick = function () { openBrowser((BASE || location.origin) + url); }; $('.body', el).appendChild(b); }
  }
  function costConfirm(el, d, payload) {
    $('.steps', el).remove();
    return new Promise(function (resolve) {
      var c = h('<div><p class="note"></p><div class="btns"><button type="button" class="pill sm" data-a="ok">Davom etish</button><button type="button" class="pill sm ghost" data-a="no">Bekor qilish</button></div></div>');
      $('.note', c).textContent = d.message || 'Bu xizmat tarif limitidan bir necha birlik oladi.';
      $('.body', el).appendChild(c);
      $('[data-a=no]', c).onclick = function () { el.remove(); resolve(null); };
      $('[data-a=ok]', c).onclick = function () {
        var cj = {}, sv = d.services || [d.service || 'analysis'];
        (d.quotes || [d.quote]).forEach(function (q, i) { if (q) cj[sv[i]] = q.units; });
        c.remove(); el.insertBefore(h('<div class="steps"><span class="spin"></span><span class="st">Tahlil boshlandi…</span></div>'), $('.live', el));
        resolve(askLegal(el, Object.assign({}, payload, { confirmedJob: cj })));
      };
    });
  }
  function renderReply(el, reply, extraBtns) {
    var s = $('.steps', el); if (s) s.remove();
    var r = md(String(reply).replace(/^[ \t]*<<<\s*YANGI_MATN[ \t]*$|^[ \t]*YANGI_MATN\s*>>>[ \t]*$/gm, ''));
    var body = $('.body', el);
    body.innerHTML = '<div class="md">' + r.html + '</div>' + srcHtml(r.sources);
    var b = h('<div class="btns"><button type="button" class="pill sm ghost" data-a="ins">Hujjatga qo\'yish</button><button type="button" class="pill sm ghost" data-a="cp">Nusxa</button></div>');
    $('[data-a=cp]', b).onclick = function () { copyText(reply.replace(/<!--[\s\S]*?-->/g, '')).then(function () { toast('Nusxa olindi'); }); };
    $('[data-a=ins]', b).onclick = function () { host.insertAnswer(reply, r).then(function () { toast("Kursor joyidan keyin qo'yildi"); }).catch(function (e) { toast(e.message || "Qo'yib bo'lmadi"); }); };
    (extraBtns || []).forEach(function (x) { b.insertBefore(x, b.firstChild); });
    body.appendChild(b);
    return r;
  }

  /* ---------------- 1. Hujjat: hujjatning o'zida ko'rib chiqish ---------------- */
  function setupReview() {
    var cp = host.caps();
    if (!host.review) { $('#review').hidden = true; $('#pb').hidden = true; return; }
    $('#revSub').textContent = cp.reviewSub || '';
    if (cp.reviewEdits) $('#revEditsL').textContent = cp.reviewEdits; else $('#revEditsRow').hidden = true;
    $('#revClear').hidden = !cp.reviewClear;
    if (cp.reviewEdits) $('#pbEditsL').textContent = cp.reviewEdits.replace(/^Tuzatishlarni/, 'Takliflarni'); else $('#pbEditsRow').hidden = true;
  }
  $('#revGo').onclick = function () {
    if (busy) return;
    var S = window.JAIShared, edits = !$('#revEditsRow').hidden && $('#revEdits').checked;
    host.bodyText().then(function (text) {
      if (!text.trim()) { toast("Hujjat bo'sh."); return; }
      var el = card("Hujjatda ko'rib chiqish", $('#outDoc'));
      return askLegal(el, { message: S.REVIEW_PROMPT, documentText: text }).then(function (d) {
        if (!d) return;
        var reply = d.reply || '', pr = S.parseReview(reply);
        if (!pr.items.length) {
          renderReply(el, reply);
          $('.body', el).insertBefore(h('<p class="note">Javobdan alohida izohlar ajratilmadi, shuning uchun u panelda ko\'rsatildi.</p>'), $('.body', el).firstChild);
          return;
        }
        var st = $('.st', el); if (st) st.textContent = "Hujjatga izohlar qo'yilmoqda…";
        setBusy(true);
        return host.review(pr.items, { edits: edits }).then(function (res) {
          setBusy(false); reviewDone(el, pr, res, reply);
        }).catch(function (e) { setBusy(false); renderReply(el, reply); toast((e && e.message) || "Izohlarni qo'yib bo'lmadi"); });
      });
    }).catch(function (e) { toast(e.message || "Hujjatni o'qib bo'lmadi"); });
  };
  function reviewDone(el, pr, res, reply) {
    var s = $('.steps', el); if (s) s.remove();
    var n = res.length, ed = 0, miss = [];
    res.forEach(function (r, i) { if (r.edited) ed++; if (r.where === 'missing') miss.push(pr.items[i]); });
    var r = md(pr.summary || '');
    var src = md(reply).sources;
    var body = $('.body', el);
    body.innerHTML = '<p class="done"><b>' + n + ' ta izoh</b> hujjatga qo\'yildi' + (ed ? ', <b>' + ed + ' tasi</b> tuzatish bilan (Track Changes)' : '') + '.</p>' +
      (miss.length ? '<p class="note">' + miss.length + ' ta iqtibos matnda aniq topilmadi — ularning izohi hujjat boshida turibdi.</p>' : '') +
      (pr.summary ? '<div class="md">' + r.html + '</div>' : '') + srcHtml(src);
    var b = h('<div class="btns"><button type="button" class="pill sm ghost" data-a="full">To\'liq javob</button></div>');
    if (host.caps().reviewClear) {
      var c = h('<button type="button" class="pill sm ghost">Izohlarni o\'chirish</button>');
      c.onclick = clearReview; b.appendChild(c);
    }
    $('[data-a=full]', b).onclick = function () { renderReply(el, reply); };
    body.appendChild(b);
  }
  function clearReview() {
    if (!host.removeReview) return;
    host.removeReview().then(function (k) { toast(k ? k + ' ta JuristAI izohi o\'chirildi' : "JuristAI izohlari topilmadi"); })
      .catch(function (e) { toast(e.message || "O'chirib bo'lmadi"); });
  }
  $('#revClear').onclick = clearReview;

  /* ---------------- 1. Hujjat: playbook bilan solishtirish (2026-10-28) ----------------
     POST /api/agent/playbook-review (saytdagi bilan bir xil xizmat: tahlil birligi shartnoma hajmiga qarab,
     natija chiqsa yechiladi). Farq va yetishmayotgan bandlar hujjatga izoh bo'ladi; taklif - Track Changes. */
  var pbList = { builtin: [], mine: [] };
  function loadPlaybooks() {
    var sel = $('#pbPick'); if (!sel) return;
    api('/api/playbooks').then(function (res) { return jsonOf(res).then(function (d) { if (!res.ok) throw new Error(); return d; }); }).then(function (d) {
      pbList = { builtin: d.builtin || [], mine: d.mine || [] };
      var opt = function (v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; };
      sel.innerHTML = (pbList.mine.length ? '<optgroup label="Mening playbooklarim">' + pbList.mine.map(function (p) { return opt('id:' + p.id, p.name); }).join('') + '</optgroup>' : '') +
        '<optgroup label="Tayyor">' + pbList.builtin.map(function (p) { return opt('b:' + p.key, p.name); }).join('') + '</optgroup>';
      pbDesc();
    }).catch(function () { sel.innerHTML = '<option value="">Playbooklarni yuklab bo\'lmadi</option>'; });
  }
  function pbChosen() {
    var v = $('#pbPick').value || '';
    if (v.indexOf('id:') === 0) { var id = v.slice(3); return { body: { playbookId: Number(id) }, p: pbList.mine.filter(function (x) { return String(x.id) === id; })[0] }; }
    if (v.indexOf('b:') === 0) { var k = v.slice(2); return { body: { builtin: k }, p: pbList.builtin.filter(function (x) { return x.key === k; })[0] }; }
    return null;
  }
  function pbDesc() { var c = pbChosen(); $('#pbDesc').textContent = c && c.p ? (c.p.description || '') + (c.p.rules ? ' · ' + c.p.rules.length + ' ta qoida' : '') : ''; }
  $('#pbPick').onchange = pbDesc;

  /** a queued review answers 202 { runId }: follow it to its end */
  function followRun(runId, el) {
    var until = Date.now() + 20 * 60 * 1000;
    return new Promise(function (resolve) {
      (function tick() {
        if (Date.now() > until) { resolve({ ok: false, data: { message: "Tekshiruv hali tugamadi. Natija saytda, Ishlar bo'limida ko'rinadi." } }); return; }
        setTimeout(function () {
          api('/api/agent/runs/' + encodeURIComponent(runId)).then(function (res) { return jsonOf(res).then(function (d) { return { res: res, d: d }; }); }).then(function (x) {
            if (x.res.status === 404) { resolve({ ok: false, data: { message: "Tekshiruv topilmadi." } }); return; }
            var st = $('.st', el), run = x.d || {};
            if (st && run.steps && run.steps.length) st.textContent = run.steps[run.steps.length - 1].label + '…';
            if (['done', 'failed', 'cancelled', 'budget', 'needs_input'].indexOf(run.status) > -1 && run.result) {
              var body = run.result.body || {}; body.runId = runId;
              resolve({ ok: (run.result.httpStatus || 200) < 300, data: body }); return;
            }
            tick();
          }).catch(function () { tick(); });
        }, 2500);
      })();
    });
  }

  $('#pbGo').onclick = function () {
    if (busy) return;
    var chosen = pbChosen();
    if (!chosen) { toast('Playbookni tanlang.'); return; }
    var S = window.JAIShared, edits = !$('#pbEditsRow').hidden && $('#pbEdits').checked;
    host.bodyText().then(function (text) {
      if (!text.trim()) { toast("Hujjat bo'sh."); return; }
      var el = card('Playbook: ' + ((chosen.p && chosen.p.name) || ''), $('#outDoc'));
      $('.st', el).textContent = 'Bandlar qoidalar bilan solishtirilmoqda…';
      try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
      setBusy(true);
      return api('/api/agent/playbook-review', { body: Object.assign({ text: text, name: 'Word hujjati' }, chosen.body) })
        .then(function (res) { return jsonOf(res).then(function (d) { return { ok: res.ok, status: res.status, data: d }; }); })
        .then(function (r) { return r.status === 202 && r.data && r.data.runId ? followRun(r.data.runId, el) : r; })
        .then(function (r) {
          if (!r.ok) { setBusy(false); limitOrFail(el, r.data); return; }
          var d = r.data, items = S.playbookItems(d.results);
          if (!items.length) { setBusy(false); pbDone(el, d, []); return; }
          var st = $('.st', el); if (st) st.textContent = "Hujjatga izohlar qo'yilmoqda…";
          return host.review(items, { edits: edits }).then(function (res) { setBusy(false); pbDone(el, d, res); })
            .catch(function (e) { setBusy(false); pbDone(el, d, null); toast((e && e.message) || "Izohlarni qo'yib bo'lmadi"); });
        });
    }).catch(function (e) { setBusy(false); toast((e && e.message) || "Server bilan aloqa yo'q. Internetni tekshiring."); });
  };
  function pbDone(el, d, res) {
    var s = $('.steps', el); if (s) s.remove();
    var c = d.counts || {}, body = $('.body', el);
    var ed = (res || []).filter(function (x) { return x.edited; }).length, miss = (res || []).filter(function (x) { return x.where === 'missing'; }).length;
    var lab = window.JAIShared.PB_STATUS;
    body.innerHTML = '<div class="counts">' + ['farq', 'yoq', 'noaniq', 'mos'].map(function (k) { return '<span>' + esc(lab[k]) + ': <b>' + (c[k] || 0) + '</b></span>'; }).join('') + '</div>' +
      (res ? '<p class="done"><b>' + res.length + ' ta izoh</b> hujjatga qo\'yildi' + (ed ? ', <b>' + ed + ' tasi</b> taklif bilan (Track Changes)' : '') + '.</p>'
        : (d.results && d.results.length && (c.mos || 0) < d.results.length ? '<p class="note">Izohlar hujjatga qo\'yilmadi.</p>' : '<p class="done">Hamma qoida bajarilgan.</p>')) +
      (miss ? '<p class="note">' + miss + ' ta band matni hujjatda aniq topilmadi — izohi hujjat boshida.</p>' : '') +
      (d.downgraded ? '<p class="note">' + d.downgraded + ' ta "mos" javobning iqtibosi shartnomada topilmadi, ular "noaniq" deb belgilandi.</p>' : '') +
      '<p class="note">Playbook — firmangiz qoidalari, qonun emas. Iqtibos shartnomada borligi tekshiriladi, xulosaning to\'g\'riligi emas.</p>';
    var b = h('<div class="btns"></div>');
    if (d.runId) { var sv = h('<button type="button" class="pill sm">Ishga saqlash</button>'); sv.onclick = function () { saveToMatter(el, d.runId, sv); }; b.appendChild(sv); }
    if (host.caps().reviewClear) { var cl = h('<button type="button" class="pill sm ghost">Izohlarni o\'chirish</button>'); cl.onclick = clearReview; b.appendChild(cl); }
    body.appendChild(b);
  }
  /** "Ishga saqlash": natija (agent run) tanlangan ishga bog'lanadi; yangi ish ham shu yerda ochiladi */
  function saveToMatter(el, runId, btn) {
    btn.disabled = true;
    api('/api/matters').then(function (res) { return jsonOf(res).then(function (d) { if (!res.ok) throw new Error(d.message || "Ishlarni yuklab bo'lmadi"); return d; }); }).then(function (d) {
      var list = (d.matters || []).filter(function (m) { return m.status === 'open' && m.access === 'write'; });
      var box = h('<div class="save"><select class="inp" aria-label="Ish"></select><input class="inp" maxlength="160" placeholder="Yangi ish nomi" hidden><div class="btns"><button type="button" class="pill sm" data-a="ok">Saqlash</button><button type="button" class="pill sm ghost" data-a="no">Bekor</button></div></div>');
      var sel = $('select', box), name = $('input', box);
      sel.innerHTML = list.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.title) + '</option>'; }).join('') + '<option value="__new">+ Yangi ish</option>';
      var upd = function () { name.hidden = sel.value !== '__new'; };
      sel.onchange = upd; upd();
      $('.body', el).appendChild(box);
      $('[data-a=no]', box).onclick = function () { box.remove(); btn.disabled = false; };
      $('[data-a=ok]', box).onclick = function () {
        var ok = this; ok.disabled = true;
        var mid = sel.value;
        var made = mid !== '__new' ? Promise.resolve(mid) : api('/api/matters', { body: { title: name.value.trim() } }).then(function (res) {
          return jsonOf(res).then(function (x) { if (!res.ok) throw new Error(x.message || "Ishni ochib bo'lmadi"); return x.id; });
        });
        made.then(function (id) {
          return api('/api/matters/' + encodeURIComponent(id) + '/items', { body: { kind: 'agent_run', ref: runId, title: 'Playbook tekshiruvi (Word)' } }).then(function (res) {
            if (!res.ok && res.status !== 409) return jsonOf(res).then(function (x) { throw new Error(x.message || "Saqlab bo'lmadi"); });
            box.remove(); btn.textContent = 'Ishga saqlandi'; toast(res.status === 409 ? 'Bu natija shu ishda bor' : 'Ishga saqlandi');
          });
        }).catch(function (e) { ok.disabled = false; toast(e.message || "Saqlab bo'lmadi"); });
      };
    }).catch(function (e) { btn.disabled = false; toast(e.message || "Ishlarni yuklab bo'lmadi"); });
  }

  /* ---------------- 1. Hujjat: panelda javob ---------------- */
  var DOC_PROMPTS = {
    risk: ['Xavf tahlili', 'Ushbu hujjatni to‘liq tahlil qiling: xavfli bandlar, yetishmayotgan shartlar va tavsiyalar.'],
    opinion: ['Yuridik xulosa', 'Ushbu hujjat bo‘yicha yuridik xulosa tayyorlang.'],
    explain: ['Oddiy tilda', 'Ushbu hujjatning asosiy mazmunini, taraflar majburiyatlarini va muddatlarini oddiy tilda tushuntiring.']
  };
  $$('[data-doc]').forEach(function (b) {
    b.onclick = function () {
      if (busy) return;
      var p = DOC_PROMPTS[b.dataset.doc];
      host.bodyText().then(function (text) {
        if (!text.trim()) { toast("Hujjat bo'sh."); return; }
        var el = card(p[0], $('#outDoc'));
        return askLegal(el, { message: p[1], documentText: text }).then(function (d) { if (d) renderReply(el, d.reply || ''); });
      }).catch(function (e) { toast(e.message || "Hujjatni o'qib bo'lmadi"); });
    };
  });

  /* ---------------- 2. Tanlangan matn ---------------- */
  var mode = 'ask', selT = null;
  function refreshSel() {
    if (!docReady) return;
    host.selection().then(function (s) {
      var p = $('#selPrev');
      if (s.text.trim()) { p.textContent = s.text.length > 600 ? s.text.slice(0, 600) + '…' : s.text; p.classList.add('has'); }
      else { p.textContent = "Hujjatda bandni belgilang."; p.classList.remove('has'); }
    }).catch(function () {});
  }
  $('#selRefresh').onclick = refreshSel;
  $$('.seg button').forEach(function (b) {
    b.onclick = function () {
      mode = b.dataset.mode;
      $$('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      $('#presets').hidden = mode !== 'edit';
      $('#selInput').placeholder = mode === 'edit' ? "Qanday o'zgartirish kerak? (masalan: jarima miqdorini qonunga moslashtiring)" : "Bu band bo'yicha savolingiz…";
      $('#selGo').textContent = mode === 'edit' ? 'Taklif olish' : "So'rash";
    };
  });
  $$('#presets .chip').forEach(function (c) { c.onclick = function () { $('#selInput').value = c.dataset.p; $('#selInput').focus(); }; });

  var EDIT_FORMAT = window.JAIShared.EDIT_FORMAT;
  function splitProposal(reply) { return window.JAIShared.splitProposal(reply); }

  function plainOf(s) { return window.JAIShared.plainOf(s); }

  $('#selGo').onclick = function () {
    if (busy) return;
    var q = $('#selInput').value.trim();
    if (!q) { toast(mode === 'edit' ? "Qanday o'zgartirish kerakligini yozing." : 'Savolni yozing.'); return; }
    host.selection().then(function (s) {
      if (!s.text.trim()) { toast("Avval Hujjatda bandni belgilang."); return; }
      selT = s;
      var el = card(mode === 'edit' ? 'Tahrir taklifi' : 'Tanlangan matn bo\'yicha', $('#outSel'));
      var editMode = mode === 'edit';
      var message = editMode ? q + EDIT_FORMAT : q;
      return askLegal(el, { message: message, documentText: s.text }).then(function (d) {
        if (!d) return;
        var reply = d.reply || '';
        if (!editMode) { renderReply(el, reply); return; }
        var prop = splitProposal(reply);
        var r = renderReply(el, prop ? prop.rest : reply);
        if (!prop) { $('.body', el).appendChild(h('<p class="note">Yangi matn alohida ajratilmadi — kerakli qismini nusxa olib qo\'ying.</p>')); return; }
        var box = h('<div><span class="kicker">Yangi matn</span><div class="prop"></div><div class="btns"><button type="button" class="pill sm" data-a="track">Track Changes bilan qo\'yish</button><button type="button" class="pill sm ghost" data-a="rep">Almashtirish</button><button type="button" class="pill sm ghost" data-a="com">Izoh qoldirish</button></div></div>');
        $('.prop', box).textContent = prop.text;
        var why = plainOf(prop.rest).slice(0, 1800);
        var sv = s;
        function guard(fn) { return function () { fn().then(function () { toast('Hujjatga kiritildi'); }).catch(function (e) { toast((e && e.message) || "Kiritib bo'lmadi. Bandni qayta belgilang."); }); }; }
        $('[data-a=track]', box).onclick = guard(function () { return host.replace(sv, prop.text, { track: true, comment: 'JuristAI: ' + why }); });
        $('[data-a=rep]', box).onclick = guard(function () { return host.replace(sv, prop.text, {}); });
        $('[data-a=com]', box).onclick = guard(function () { return host.comment(sv, 'JuristAI taklifi:\n' + prop.text + (why ? '\n\nIzoh: ' + why : '')); });
        var cp = host.caps();
        $('[data-a=track]', box).textContent = cp.track ? cp.trackLabel : cp.noTrackLabel;
        if (!cp.comment) $('[data-a=com]', box).remove();
        $('.body', el).insertBefore(box, $('.body', el).querySelector('.btns'));
      });
    }).catch(function (e) { toast(e.message || "Tanlovni o'qib bo'lmadi"); });
  };

  /* ---------------- 3. Chat ---------------- */
  var history = [];
  $('#chatNew').onclick = function () { history = []; $('#chatLog').innerHTML = ''; toast('Yangi suhbat'); };
  $('#chatGo').onclick = function () {
    if (busy) return;
    var q = $('#chatInput').value.trim(); if (!q) return;
    var withDoc = $('#chatDoc').checked;
    (withDoc && docReady ? host.bodyText() : Promise.resolve('')).then(function (text) {
      $('#chatInput').value = '';
      var log = $('#chatLog');
      log.appendChild(h('<div class="ubub"></div>')).textContent = q;
      var el = h('<div class="res"><div class="steps"><span class="spin"></span><span class="st">Qonunlar qidirilmoqda…</span></div><div class="live" hidden></div><div class="body"></div></div>');
      log.appendChild(el);
      var hist = history.slice();
      history.push({ role: 'user', text: q });
      return askLegal(el, { message: q, history: hist, documentText: text && text.trim() ? text : null }).then(function (d) {
        if (!d) { history.pop(); return; }
        history.push({ role: 'model', text: d.reply || '' });
        renderReply(el, d.reply || '');
        el.scrollIntoView({ block: 'nearest' });
      });
    }).catch(function (e) { toast(e.message || 'Xatolik'); });
  };
  $('#chatInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#chatGo').click(); });

  /* ---------------- start ---------------- */
  var selDeb;
  function onSel() { clearTimeout(selDeb); selDeb = setTimeout(function () { if (!$('[data-pane=sel]').hidden) refreshSel(); }, 350); }
  function start(info) {
    if (window.JAI_HOST) {
      docReady = true;
      if (window.JAI_HOST.onSelection) window.JAI_HOST.onSelection(onSel);
      setupReview(); boot(); return;
    }
    inWord = !!(info && info.host && typeof Word !== 'undefined' && String(info.host).toLowerCase().indexOf('word') > -1);
    docReady = inWord;
    setupReview();
    if (inWord) {
      try {
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onSel);
      } catch (e) {}
    }
    boot();
  }
  if (!window.fetch || !window.Promise) {
    // Internet Explorer engine (Word 2016 MSI and older): the pane cannot run here
    document.getElementById('vConnect').hidden = false;
    document.getElementById('vConnect').innerHTML = '<h1>Word versiyasi eski</h1><p class="muted">Bu Word ichki brauzeri (Internet Explorer) JuristAI panelini ishlata olmaydi. Word Online (office.com) yoki Microsoft 365 Word\'dan foydalaning.</p>';
    return;
  }
  if (!window.JAI_HOST && window.Office && Office.onReady) Office.onReady(start); else start(null);
  window.__jaiWord = { md: md, splitProposal: splitProposal, wordHtml: wordHtml, plainOf: plainOf };
})();
