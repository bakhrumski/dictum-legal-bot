/* JuristAI — Word task pane.
   Kirish: qurilmani ulash (POST /api/addin/pair → brauzerda /word/ulash.html → token).
   Server: POST /api/legal-chat (SSE), GET /api/user-info, POST /api/addin/logout — hammasi "Authorization: Bearer". */
(function () {
  'use strict';
  var TOKEN_KEY = 'juristai-word-token';
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

  /* ---------------- API ---------------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json' };
    var tok = store.get(); if (tok) headers.Authorization = 'Bearer ' + tok;
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'omit', signal: opts.signal });
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
      });
    }).catch(function () { show('main'); toast("Server bilan aloqa yo'q. Internetni tekshiring."); });
  }

  /* ---- ulash ---- */
  var pollT = null;
  function stopPoll() { if (pollT) { clearInterval(pollT); pollT = null; } }
  $('#connect').onclick = function () {
    var btn = this; btn.disabled = true; $('#connectErr').hidden = true;
    fetch('/api/addin/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit' })
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
          fetch('/api/addin/pair/' + p.pairId, { credentials: 'omit', cache: 'no-store' }).then(jsonOf).then(function (d) {
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
  function setBusy(v) { busy = v; $$('.act, #selGo, #chatGo').forEach(function (b) { b.disabled = v; }); }
  function card(title, where) {
    var el = h('<div class="res"><div class="res-h"><span class="kicker"></span><button type="button" class="x" title="Yopish" aria-label="Yopish">×</button></div><div class="steps"><span class="spin"></span><span class="st">Qonunlar qidirilmoqda…</span></div><div class="live" hidden></div><div class="body"></div></div>');
    $('.kicker', el).textContent = title;
    $('.x', el).onclick = function () { if (ctrl && busy) ctrl.abort(); el.remove(); };
    where.insertBefore(el, where.firstChild);
    return el;
  }
  var STEP = { search: 'Qonunlar qidirilmoqda…', retrieve: 'Manbalar tanlanmoqda…', generate: 'Javob yozilmoqda…', verify: 'Manbalar tekshirilmoqda…' };

  /** /api/legal-chat (SSE). Qaytaradi: { reply } yoki null (xato kartada ko'rsatilgan) */
  function askLegal(el, payload) {
    var body = { message: payload.message, history: payload.history || [], databases: ['lex.uz'], topic: null, topics: null, autoDetect: true,
      documentText: payload.documentText || null, docTicket: null, scanIds: null, confirmedJob: payload.confirmedJob || null, stream: CAN_STREAM };
    if (body.documentText && body.documentText.length > 900000) { fail(el, "Hujjat juda katta (900 000 belgidan ortiq). Bir qismini belgilab, \"Tanlangan matn\" orqali yuboring."); return Promise.resolve(null); }
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
    if (url) { var b = h('<div class="btns"><button type="button" class="pill sm"></button></div>'); b.firstChild.textContent = label; b.firstChild.onclick = function () { openBrowser(location.origin + url); }; $('.body', el).appendChild(b); }
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
    $('[data-a=ins]', b).onclick = function () { W.insertAfter(wordHtml(r)).then(function () { toast("Kursor joyidan keyin qo'yildi"); }).catch(function (e) { toast(e.message || "Qo'yib bo'lmadi"); }); };
    (extraBtns || []).forEach(function (x) { b.insertBefore(x, b.firstChild); });
    body.appendChild(b);
    return r;
  }

  /* ---------------- 1. Hujjat ---------------- */
  var DOC_PROMPTS = {
    risk: ['Xavf tahlili', 'Ushbu hujjatni to‘liq tahlil qiling: xavfli bandlar, yetishmayotgan shartlar va tavsiyalar.'],
    opinion: ['Yuridik xulosa', 'Ushbu hujjat bo‘yicha yuridik xulosa tayyorlang.'],
    explain: ['Oddiy tilda', 'Ushbu hujjatning asosiy mazmunini, taraflar majburiyatlarini va muddatlarini oddiy tilda tushuntiring.']
  };
  $$('[data-doc]').forEach(function (b) {
    b.onclick = function () {
      if (busy) return;
      var p = DOC_PROMPTS[b.dataset.doc];
      W.bodyText().then(function (text) {
        if (!text.trim()) { toast("Hujjat bo'sh."); return; }
        var el = card(p[0], $('#outDoc'));
        return askLegal(el, { message: p[1], documentText: text }).then(function (d) { if (d) renderReply(el, d.reply || ''); });
      }).catch(function (e) { toast(e.message || "Hujjatni o'qib bo'lmadi"); });
    };
  });

  /* ---------------- 2. Tanlangan matn ---------------- */
  var mode = 'ask', selT = null;
  function refreshSel() {
    if (!inWord) return;
    W.selection().then(function (s) {
      var p = $('#selPrev');
      if (s.text.trim()) { p.textContent = s.text.length > 600 ? s.text.slice(0, 600) + '…' : s.text; p.classList.add('has'); }
      else { p.textContent = "Word'da bandni belgilang."; p.classList.remove('has'); }
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

  var EDIT_FORMAT = "\n\nJavobni quyidagi tartibda bering:\n1) Qisqa izoh: nima o‘zgardi va nega, tegishli qonun normasi va manbasi bilan.\n2) Bandning yangi matni — faqat quyidagi belgilar orasida, boshqa hech narsa qo‘shmasdan:\n<<<YANGI_MATN\n(bandning to‘liq yangi matni)\nYANGI_MATN>>>";
  function splitProposal(reply) {
    var m = String(reply).match(/<<<\s*YANGI_MATN\s*\n?([\s\S]*?)\n?\s*YANGI_MATN\s*>>>/);
    if (m) return { text: m[1].trim(), rest: reply.replace(m[0], '').trim() };
    var f = String(reply).match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (f) return { text: f[1].trim(), rest: reply.replace(f[0], '').trim() };
    return null;
  }
  function plainOf(s) { return String(s).replace(/<!--[\s\S]*?-->/g, '').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)').replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/gm, '').trim(); }

  $('#selGo').onclick = function () {
    if (busy) return;
    var q = $('#selInput').value.trim();
    if (!q) { toast(mode === 'edit' ? "Qanday o'zgartirish kerakligini yozing." : 'Savolni yozing.'); return; }
    W.selection().then(function (s) {
      if (!s.text.trim()) { toast("Avval Word'da bandni belgilang."); return; }
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
        $('[data-a=track]', box).onclick = guard(function () { return W.replace(sv, prop.text, { track: true, comment: 'JuristAI: ' + why }); });
        $('[data-a=rep]', box).onclick = guard(function () { return W.replace(sv, prop.text, {}); });
        $('[data-a=com]', box).onclick = guard(function () { return W.comment(sv, 'JuristAI taklifi:\n' + prop.text + (why ? '\n\nIzoh: ' + why : '')); });
        if (!has14()) { $('[data-a=com]', box).remove(); $('[data-a=track]', box).textContent = 'Almashtirish (Track Changes yo\'q)'; }
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
    (withDoc && inWord ? W.bodyText() : Promise.resolve('')).then(function (text) {
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
  function start(info) {
    inWord = !!(info && info.host && typeof Word !== 'undefined' && String(info.host).toLowerCase().indexOf('word') > -1);
    if (inWord) {
      try {
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, function () {
          clearTimeout(selDeb); selDeb = setTimeout(function () { if (!$('[data-pane=sel]').hidden) refreshSel(); }, 350);
        });
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
  if (window.Office && Office.onReady) Office.onReady(start); else start(null);
  window.__jaiWord = { md: md, splitProposal: splitProposal, wordHtml: wordHtml };
})();
