/* Ovozli yozuvlar: muloqotni yozib olish → matnga aylantirish (STT) → qisqacha mazmun, topshiriqlar, keyingi qadamlar, hujjat tavsiyasi.
   Server kelishuvi (hali yo'q, README'ga qarang):
     POST /api/voice/transcribe  multipart {file, lang:'auto'} → {segments:[{speaker,start,end,text}], keywords:[], durationSec}
     POST /api/voice/analyze     {segments, lang}                    → {title, summary, points[], tasks:[{text,owner,due}], nextSteps[], document:{type,reason}|null}
     GET  /api/voice/balance                                          → {minutesLimit, minutesUsed}
   Server javob bermasa (404/501), yozuv saqlanadi va "xizmat tez orada ulanadi" deb ko'rsatiladi.
   Audio shu brauzerda (IndexedDB) saqlanadi; matn va tahlil — localStorage'da. Daqiqa limitlari hali aniqlanmagan: "X daqiqa". */
(function (G) {
  'use strict';
  var J = G.JAI, t = J.t, esc = J.esc, $ = J.$, $$ = J.$$;
  J.VOICE_MIN = { sinov: null, silver: null, gold: null, platinum: null };   // daqiqalar hali hisoblanmaydi: raqam o'ylab topilmaydi

  /* ---------- saqlash ---------- */
  var LS = 'jai-voice-list';
  function list() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } }
  function saveList(l) { try { localStorage.setItem(LS, JSON.stringify(l.slice(0, 100))); } catch (e) { J.toast(t('err.generic')); } }
  function get(id) { return list().filter(function (x) { return x.id === id; })[0] || null; }
  function put(item) { var l = list().filter(function (x) { return x.id !== item.id; }); l.unshift(item); saveList(l); }
  function del(id) { saveList(list().filter(function (x) { return x.id !== id; })); idb('delete', id); }
  function idb(op, key, val) {
    return new Promise(function (ok) {
      if (!G.indexedDB) return ok(null);
      var r = indexedDB.open('jai-voice', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('audio'); };
      r.onerror = function () { ok(null); };
      r.onsuccess = function () {
        try {
          var tx = r.result.transaction('audio', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('audio');
          var q = op === 'get' ? st.get(key) : op === 'put' ? st.put(val, key) : st.delete(key);
          q.onsuccess = function () { ok(op === 'get' ? q.result : true); }; q.onerror = function () { ok(null); };
        } catch (e) { ok(null); }
      };
    });
  }
  function fmt(sec) { sec = Math.max(0, Math.round(sec || 0)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function minutesText() { var k = J.planKey(), m = J.VOICE_MIN[k]; return m ? t('vc.min', { n: m }) : t('vc.min.none'); }

  /* ---------- server ---------- */
  async function transcribe(item, blob) {
    item.status = 'working'; put(item); J.emit('voice', item.id);
    var fd = new FormData(); fd.append('file', blob, (item.title || 'yozuv') + '.webm'); fd.append('lang', 'auto'); // the speech's language, not the interface's: auto-detect (mixed uz/ru speech too); the server measures the length
    var r = await J.api('/api/voice/transcribe', { method: 'POST', body: fd });
    if (r.status === 404 || r.status === 501 || r.network) { item.status = 'pending'; put(item); J.emit('voice', item.id); return; }
    if (!r.ok) { item.status = 'error'; item.error = J.errMsg(r.data); put(item); J.emit('voice', item.id); if (r.status === 402 || r.status === 429) buyMinutes(); return; }
    item.segments = r.data.segments || []; item.keywords = r.data.keywords || []; if (r.data.durationSec) item.duration = r.data.durationSec;
    put(item); J.emit('voice', item.id);
    var a = await J.api('/api/voice/analyze', { method: 'POST', body: { segments: item.segments, lang: J.lang } });
    if (a.ok) { item.analysis = a.data; if (a.data.title && /^(Yozuv|Запись|Recording)\b/.test(item.title)) item.title = a.data.title; }
    item.status = 'done'; put(item); J.emit('voice', item.id); J.refreshTariff();
  }

  /* ---------- daqiqa paketlari ---------- */
  function buyMinutes() {
    var packs = [['60', ''], ['300', ''], ['1000', '']];
    var m = J.modal({ cls: 'sm', html: '<h2>' + esc(t('vc.buy')) + '</h2><p class="sub">' + esc(t('vc.buy.d')) + '</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:18px">' + packs.map(function (p) {
        return '<button class="method" data-p="' + p[0] + '"><span class="ic" style="background:var(--fg);color:var(--bg)">' + J.icon('mic') + '</span><span style="flex:1"><b>' + esc(t('vc.pack', { n: p[0] })) + '</b><small>' + esc(t('vc.pack.price', { p: p[1] })) + '</small></span></button>';
      }).join('') + '</div><p class="muted" style="font-size:12.5px;margin-top:14px">' + esc(t('vc.buy.note')) + '</p>' });
    $$('[data-p]', m.body).forEach(function (b) {
      b.onclick = async function () {
        var r = await J.api('/api/tariff/interest', { method: 'POST', body: { plan: 'voice_minutes', minutes: +b.dataset.p } });
        m.close();
        if (r.ok) J.toast(t('pay.sent')); else window.open(J.botUrl('auth'), '_blank', 'noopener');
      };
    });
  }
  J.buyMinutes = buyMinutes;

  /* ================= RO'YXAT ================= */
  J.viewVoiceList = function () {
    J.setTitle(t('nav.voice'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h2>' + esc(t('vc.title')) + '</h2><p>' + esc(t('vc.sub')) + '</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><label class="pill ghost" style="cursor:pointer">' + J.icon('up') + esc(t('vc.upload')) + '<input type="file" accept="audio/*,video/webm,.m4a,.mp3,.wav,.ogg,.oga,.webm" hidden></label><button class="pill" data-a="rec">' + J.icon('mic') + esc(t('vc.new')) + '</button></div></div>' +
      '<div class="card vc-min" style="display:flex;align-items:center;gap:14px;margin-bottom:18px">' + J.icon('clock') + '<div style="flex:1"><b style="font-weight:500">' + esc(minutesText()) + '</b><div class="muted" style="font-size:13px">' + esc(t('vc.min.note')) + '</div></div><button class="pill sm ghost" data-a="buy">' + esc(t('vc.buy')) + '</button></div>' +
      '<div class="grid3 vc-why" style="margin-bottom:26px">' + [0, 1, 2].map(function (i) { return '<div class="tile" style="cursor:default;min-height:0"><div class="tile-h">' + J.icon(['mic', 'team', 'user'][i]) + '</div><b>' + esc(t('vc.why' + i)) + '</b><p>' + esc(t('vc.why' + i + '.d')) + '</p></div>'; }).join('') + '</div>' +
      '<div class="rows vc-list"></div></div>');
    $('[data-a=rec]', v).onclick = function () { J.go('#/yozuvlar/yangi'); };
    $('[data-a=buy]', v).onclick = buyMinutes;
    // say plainly when recordings cannot be transcribed for this person (2026-10-21: the page used to stay silent)
    J.api('/api/voice/balance').then(function (r) {
      if (!r.ok || !r.data || r.data.enabled) return;
      var key = r.data.reason === 'stt_not_configured' ? 'vc.off.stt' : r.data.reason === 'staff_only' ? 'vc.off.staff' : 'vc.off.notes';
      var note = J.h('<div class="note-blue" style="margin-bottom:18px"></div>'); note.textContent = t(key);
      var min = $('.vc-min', v); if (min) min.parentNode.insertBefore(note, min);
    });
    $('input[type=file]', v).onchange = function () { var f = this.files[0]; if (f) fromFile(f); };
    function draw() {
      var l = list();
      $('.vc-list', v).innerHTML = l.length ? l.map(function (x) {
        var st = x.status === 'done' ? '' : x.status === 'working' ? '<span class="spin"></span>' : x.status === 'pending' ? '<span class="tag">' + esc(t('vc.pending.s')) + '</span>' : x.status === 'error' ? '<span class="tag"><span class="dot bad"></span>' + esc(t('err.generic')) + '</span>' : '';
        return '<div class="row" data-id="' + esc(x.id) + '">' + J.icon('mic') + '<span>' + esc(x.title) + '</span>' + st + '<small>' + esc(J.fmtDate(x.created)) + ' · ' + fmt(x.duration) + '</small><button class="ib" data-del="' + esc(x.id) + '" title="' + esc(t('hi.del')) + '">' + J.icon('trash') + '</button></div>';
      }).join('') : '<div class="empty-state">' + esc(t('vc.empty')) + '</div>';
      $$('.row', v).forEach(function (r) { r.onclick = function (e) { if (e.target.closest('[data-del]')) return; J.go('#/yozuvlar/' + r.dataset.id); }; });
      $$('[data-del]', v).forEach(function (b) { b.onclick = async function () { if (await J.confirm(t('vc.del.q'), t('hi.del'))) { del(b.dataset.del); draw(); } }; });
    }
    draw(); J.on('voice', function () { if (document.body.contains(v)) draw(); });
  };
  function newItem(duration) {
    var d = new Date();
    return { id: 'v' + Date.now().toString(36), title: t('vc.untitled') + ' ' + J.fmtDate(d) + ' ' + d.toTimeString().slice(0, 5), created: d.toISOString(), duration: duration || 0, status: 'recorded', segments: [], speakers: {} };
  }
  async function fromFile(f) {
    var dur = await new Promise(function (ok) { var a = document.createElement('audio'); a.preload = 'metadata'; a.onloadedmetadata = function () { ok(isFinite(a.duration) ? a.duration : 0); }; a.onerror = function () { ok(0); }; a.src = URL.createObjectURL(f); });
    var item = newItem(dur); item.title = f.name.replace(/\.[^.]+$/, '');
    await idb('put', item.id, f); put(item); J.go('#/yozuvlar/' + item.id); transcribe(item, f);
  }

  /* ================= YOZIB OLISH ================= */
  J.viewVoiceRecord = function () {
    J.setTitle(t('vc.new'));
    var v = J.mount('<div class="wrap narrow"><button class="chip" data-a="back" style="margin-bottom:18px">' + J.icon('back') + esc(t('nav.voice')) + '</button>' +
      '<div class="card" style="text-align:center;padding:36px 24px">' +
        '<div class="rec-time num" style="font-size:44px;letter-spacing:-.03em">0:00</div>' +
        '<canvas class="rec-wave" width="640" height="90" style="width:100%;max-width:560px;height:90px;margin:18px auto;display:block"></canvas>' +
        '<label class="muted rec-consent" style="display:flex;gap:10px;align-items:flex-start;justify-content:center;text-align:left;font-size:13.5px;max-width:520px;margin:0 auto 20px"><input type="checkbox" style="margin-top:3px"><span>' + esc(t('vc.consent')) + '</span></label>' +
        '<div style="display:flex;gap:10px;justify-content:center"><button class="pill" data-a="start">' + J.icon('mic') + esc(t('vc.start')) + '</button><button class="pill ghost" data-a="pause" hidden>' + esc(t('vc.pause')) + '</button><button class="pill dark" data-a="stop" hidden>' + J.icon('stop') + esc(t('vc.stop')) + '</button></div>' +
        '<p class="hint" style="margin-top:18px">' + esc(minutesText()) + ' · ' + esc(t('vc.local')) + '</p>' +
      '</div></div>');
    var btnStart = $('[data-a=start]', v), btnPause = $('[data-a=pause]', v), btnStop = $('[data-a=stop]', v), timeEl = $('.rec-time', v), cv = $('.rec-wave', v), ctx2 = cv.getContext('2d');
    var stream = null, rec = null, chunks = [], t0 = 0, acc = 0, timer = null, raf = null, an = null, actx = null, paused = false;
    $('[data-a=back]', v).onclick = function () { cleanup(); J.go('#/yozuvlar'); };
    function elapsed() { return acc + (paused || !t0 ? 0 : (Date.now() - t0) / 1000); }
    function drawWave() {
      raf = requestAnimationFrame(drawWave);
      var w = cv.width, h = cv.height; ctx2.clearRect(0, 0, w, h);
      var col = getComputedStyle(document.documentElement).getPropertyValue('--fg') || '#111';
      var n = 56, bw = w / n, data = new Uint8Array(an ? an.frequencyBinCount : 0); if (an) an.getByteFrequencyData(data);
      for (var i = 0; i < n; i++) {
        var val = an ? data[Math.floor(i * data.length / n / 1.6)] / 255 : 0; var bh = Math.max(3, val * h * (paused ? .15 : 1));
        ctx2.fillStyle = col.trim(); ctx2.globalAlpha = .25 + val * .75; ctx2.fillRect(i * bw + bw * .3, (h - bh) / 2, bw * .4, bh);
      }
    }
    btnStart.onclick = async function () {
      if (!$('.rec-consent input', v).checked) { J.toast(t('vc.consent.need')); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { J.toast(t('vc.mic.err')); return; }
      try { actx = new (G.AudioContext || G.webkitAudioContext)(); an = actx.createAnalyser(); an.fftSize = 256; actx.createMediaStreamSource(stream).connect(an); } catch (e) {}
      var mime = (G.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : '';
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = finish;
      rec.start(1000); t0 = Date.now(); acc = 0;
      timer = setInterval(function () { timeEl.textContent = fmt(elapsed()); }, 250); drawWave();
      btnStart.hidden = true; btnPause.hidden = false; btnStop.hidden = false; $('.rec-consent', v).hidden = true;
    };
    btnPause.onclick = function () {
      if (!rec) return;
      if (!paused) { rec.pause(); acc = elapsed(); paused = true; btnPause.textContent = t('vc.resume'); }
      else { rec.resume(); t0 = Date.now(); paused = false; btnPause.textContent = t('vc.pause'); }
    };
    btnStop.onclick = function () { if (rec && rec.state !== 'inactive') { acc = elapsed(); paused = true; rec.stop(); } };
    async function finish() {
      var blob = new Blob(chunks, { type: (rec && rec.mimeType) || 'audio/webm' });
      var item = newItem(acc); cleanup();
      await idb('put', item.id, blob); put(item);
      J.go('#/yozuvlar/' + item.id); transcribe(item, blob);
    }
    function cleanup() {
      clearInterval(timer); if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); });
      if (actx && actx.state !== 'closed') { try { actx.close().catch(function () {}); } catch (e) {} }
      actx = null; an = null;
      stream = null;
    }
    J.on('route', function (h) { if (!/^\/yozuvlar\/yangi/.test(h)) cleanup(); });
  };

  /* ================= YOZUV (Otter uslubida) ================= */
  var SPK_COL = ['#5B6472', '#B4307E', '#7B4FD0', '#2F7D6D', '#B5652A', '#3D6BF2'];
  J.viewVoiceItem = async function (id) {
    var item = get(id);
    if (!item) { J.go('#/yozuvlar'); return; }
    J.setTitle(item.title);
    var v = J.mount('<div class="vc"><div class="wrap narrow" style="padding-bottom:140px">' +
      '<button class="chip" data-a="back" style="margin-bottom:16px">' + J.icon('back') + esc(t('nav.voice')) + '</button>' +
      '<h2 class="vc-title" contenteditable="true" spellcheck="false" style="font-size:28px;outline:0"></h2>' +
      '<div class="vc-meta muted" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;font-size:13.5px;margin:10px 0 18px"></div>' +
      '<div class="tabs"><button data-tab="sum" class="on">' + esc(t('vc.tab.sum')) + '</button><button data-tab="tr">' + esc(t('vc.tab.tr')) + '</button></div>' +
      '<div class="vc-body"></div></div>' +
      '<div class="vc-player"><audio preload="metadata"></audio><div class="vc-prog"><i></i></div><div class="vc-pt"><span class="num cur">0:00</span><span class="num tot">0:00</span></div>' +
      '<div class="vc-ctl"><button class="ib" data-a="b5" title="−5s">' + J.icon('back5') + '</button><button class="ib vc-play" data-a="play">' + J.icon('play') + '</button><button class="ib" data-a="f5" title="+5s">' + J.icon('fwd5') + '</button><button class="chip" data-a="spd">1x</button></div></div></div>');
    var audio = $('audio', v), tab = 'sum';
    var blob = await idb('get', id); if (blob) audio.src = URL.createObjectURL(blob);
    $('[data-a=back]', v).onclick = function () { audio.pause(); J.go('#/yozuvlar'); };
    var title = $('.vc-title', v); title.textContent = item.title;
    title.onblur = function () { var it = get(id); it.title = title.textContent.trim() || it.title; put(it); J.setTitle(it.title); };
    title.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
    $$('[data-tab]', v).forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; $$('[data-tab]', v).forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });

    function spkName(it, s) { return (it.speakers && it.speakers[s]) || (t('vc.speaker') + ' ' + (String(s).replace(/\D/g, '') || s)); }
    function shares(it) {
      var tot = 0, m = {};
      (it.segments || []).forEach(function (g) { var d = Math.max(0, (g.end || g.start) - g.start) || 1; m[g.speaker] = (m[g.speaker] || 0) + d; tot += d; });
      return Object.keys(m).map(function (k) { return [k, tot ? Math.round(100 * m[k] / tot) : 0]; }).sort(function (a, b) { return b[1] - a[1]; });
    }
    function meta(it) {
      var sp = shares(it).length;
      $('.vc-meta', v).innerHTML = '<span>' + J.icon('cal') + ' ' + esc(J.fmtDate(it.created)) + '</span><span>' + J.icon('clock') + ' ' + fmt(it.duration) + '</span>' + (sp ? '<span>' + J.icon('team') + ' ' + sp + '</span>' : '') +
        (it.analysis ? '<button class="chip" data-a="copy">' + J.icon('copy') + esc(t('vc.copy')) + '</button><button class="chip" data-a="word">' + J.icon('word') + 'Word</button>' : '');
      var c = $('[data-a=copy]', v); if (c) c.onclick = function () { navigator.clipboard.writeText(sumText(get(id))).then(function () { J.toast(t('act.copied')); }); };
      var w = $('[data-a=word]', v); if (w) w.onclick = function () { var it2 = get(id); J.exportWord(it2.title, sumHtml(it2) + '<h2>' + esc(t('vc.tab.tr')) + '</h2>' + (it2.segments || []).map(function (g) { return '<p><b>' + esc(spkName(it2, g.speaker)) + '</b> [' + fmt(g.start) + ']: ' + esc(g.text) + '</p>'; }).join('')); };
    }
    function sumText(it) {
      var a = it.analysis || {};
      return [it.title, '', a.summary || '', '', t('vc.points') + ':'].concat((a.points || []).map(function (x) { return '• ' + x; }))
        .concat(['', t('vc.tasks') + ':']).concat((a.tasks || []).map(function (x) { return '☐ ' + x.text + (x.owner ? ' — ' + x.owner : '') + (x.due ? ' (' + x.due + ')' : ''); }))
        .concat(['', t('vc.next') + ':']).concat((a.nextSteps || []).map(function (x) { return '→ ' + x; })).join('\n');
    }
    function sumHtml(it) {
      var a = it.analysis || {};
      return '<h2>' + esc(t('vc.summary')) + '</h2><p>' + esc(a.summary || '') + '</p>' +
        ((a.points || []).length ? '<h3>' + esc(t('vc.points')) + '</h3><ul>' + a.points.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        ((a.tasks || []).length ? '<h3>' + esc(t('vc.tasks')) + '</h3><ul>' + a.tasks.map(function (x) { return '<li>' + esc(x.text) + (x.owner ? ' — <b>' + esc(x.owner) + '</b>' : '') + (x.due ? ' <span class="muted">(' + esc(x.due) + ')</span>' : '') + '</li>'; }).join('') + '</ul>' : '') +
        ((a.nextSteps || []).length ? '<h3>' + esc(t('vc.next')) + '</h3><ol>' + a.nextSteps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '');
    }
    function state(it) {
      if (it.status === 'working') return '<div class="card" style="display:flex;gap:12px;align-items:center"><span class="spin"></span>' + esc(t('vc.working')) + '</div>';
      if (it.status === 'pending') return '<div class="card"><h4>' + esc(t('vc.pending')) + '</h4><p class="muted" style="font-size:14px">' + esc(t('vc.pending.d')) + '</p><div class="btns"><button class="pill sm" data-a="retry">' + esc(t('retry')) + '</button></div></div>';
      if (it.status === 'error') return '<div class="card"><h4 class="err">' + esc(t('err.generic')) + '</h4><p class="muted" style="font-size:14px"></p><div class="btns"><button class="pill sm" data-a="retry">' + esc(t('retry')) + '</button></div></div>';
      return '';
    }
    function draw() {
      var it = get(id); if (!it) return;
      meta(it);
      var body = $('.vc-body', v), s = state(it);
      if (s) {
        body.innerHTML = s;
        var p = $('.card p', body); if (p && it.status === 'error') p.textContent = it.error || '';
        var rb = $('[data-a=retry]', body); if (rb) rb.onclick = async function () { var bl = await idb('get', id); if (bl) transcribe(get(id), bl); else J.toast(t('vc.noaudio')); };
        var bb = $('[data-a=buy]', body); if (bb) bb.onclick = buyMinutes;
        return;
      }
      if (tab === 'tr') {
        var sh = shares(it);
        body.innerHTML = (it.keywords && it.keywords.length ? '<div class="kicker" style="margin-bottom:6px">' + esc(t('vc.keywords')) + '</div><p class="muted" style="font-size:14px;margin-bottom:16px">' + esc(it.keywords.join(', ')) + '</p>' : '') +
          '<div class="kicker" style="margin-bottom:6px">' + esc(t('vc.speakers')) + '</div><p class="muted" style="font-size:14px;margin-bottom:22px">' + sh.map(function (x) { return esc(spkName(it, x[0])) + ' (' + (x[1] || '<1') + '%)'; }).join(', ') + '</p>' +
          '<div class="vsegs">' + (it.segments || []).map(function (g, i) {
            var k = sh.findIndex(function (x) { return x[0] === g.speaker; });
            return '<div class="vseg" data-i="' + i + '" data-t="' + g.start + '"><div class="vseg-h"><span class="av" style="width:24px;height:24px;font-size:11px;background:' + SPK_COL[k % SPK_COL.length] + ';color:#fff">' + esc(spkName(it, g.speaker).charAt(0).toUpperCase()) + '</span><b class="vseg-n" data-s="' + esc(g.speaker) + '" title="' + esc(t('vc.rename')) + '">' + esc(spkName(it, g.speaker)) + '</b><span class="num muted vseg-t">' + fmt(g.start) + '</span></div><p></p></div>';
          }).join('') + '</div>';
        $$('.vseg', body).forEach(function (el) {
          $('p', el).textContent = it.segments[+el.dataset.i].text;
          el.onclick = function (e) {
            if (e.target.closest('.vseg-n')) {
              var sp = e.target.closest('.vseg-n').dataset.s, nm = prompt(t('vc.rename'), spkName(get(id), sp));
              if (nm && nm.trim()) { var it2 = get(id); it2.speakers = it2.speakers || {}; it2.speakers[sp] = nm.trim().slice(0, 40); put(it2); draw(); }
              return;
            }
            audio.currentTime = +el.dataset.t; audio.play();
          };
        });
        hl();
      } else {
        var a = it.analysis;
        if (!a) { body.innerHTML = '<div class="empty-state">' + esc(t('vc.noanalysis')) + '</div>'; return; }
        body.innerHTML = '<div class="card" style="margin-bottom:16px"><h4>' + esc(t('vc.summary')) + '</h4><p></p></div>' +
          ((a.points || []).length ? '<h3 class="vc-h">' + esc(t('vc.points')) + '</h3><ul class="vc-ul">' + a.points.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
          ((a.tasks || []).length ? '<h3 class="vc-h">' + esc(t('vc.tasks')) + '</h3><div class="rows">' + a.tasks.map(function (x, i) { return '<label class="row" style="cursor:pointer"><input type="checkbox" data-task="' + i + '"' + (x.done ? ' checked' : '') + '><span style="white-space:normal">' + esc(x.text) + '</span>' + (x.owner ? '<span class="chip static" style="flex:none">' + J.icon('user') + esc(x.owner) + '</span>' : '') + (x.due ? '<small>' + esc(x.due) + '</small>' : '') + '</label>'; }).join('') + '</div>' : '') +
          ((a.nextSteps || []).length ? '<h3 class="vc-h">' + esc(t('vc.next')) + '</h3><ol class="vc-ul">' + a.nextSteps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') +
          (a.document ? '<div class="card" style="margin-top:22px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><span class="ti" style="width:38px;height:38px;border-radius:10px;background:var(--panel);display:grid;place-items:center">' + J.icon('pen') + '</span><div style="flex:1;min-width:200px"><div class="kicker">' + esc(t('vc.doc')) + '</div><b style="font-weight:500;font-size:16px" class="doc-t"></b><p class="muted doc-r" style="font-size:13.5px"></p></div><button class="pill" data-a="draft">' + esc(t('vc.doc.btn')) + '<i>→</i></button></div>' : '') +
          '<div class="btns" style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap"><button class="pill sm ghost" data-a="ask">' + J.icon('chat') + esc(t('vc.ask')) + '</button><button class="pill sm ghost" data-a="ctasks">' + J.icon('copy') + esc(t('vc.copytasks')) + '</button><button class="pill sm ghost" data-a="tg">' + J.icon('send') + esc(t('vc.tg')) + '</button></div>' +
          '<p class="hint" style="text-align:left;margin-top:18px">' + esc(t('vc.hint')) + '</p>';
        $('.card p', body).textContent = a.summary || '';
        if (a.document) { $('.doc-t', body).textContent = a.document.type || ''; $('.doc-r', body).textContent = a.document.reason || ''; }
        $$('[data-task]', body).forEach(function (c) { c.onchange = function () { var it2 = get(id); it2.analysis.tasks[+c.dataset.task].done = c.checked; put(it2); }; });
        var d = $('[data-a=draft]', body); if (d) d.onclick = function () { J.draftPrefill = { type: a.document.type, question: sumText(get(id)), answer: (it.segments || []).map(function (g) { return spkName(it, g.speaker) + ': ' + g.text; }).join('\n').slice(0, 11000), action: a.document.type, from: location.hash || '#/yozuvlar' }; J.go('#/tayyorlash?type=ai'); };
        $('[data-a=ask]', body).onclick = function () { J.startChat({ text: t('vc.ask.q') + '\n\n' + sumText(get(id)).slice(0, 4000), skill: null, files: [] }); };
        $('[data-a=tg]', body).onclick = async function () {
          var r = await J.api('/api/voice/send-telegram', { method: 'POST', body: { text: sumText(get(id)) } });
          J.toast(r.ok ? t('vc.tg.ok') : (r.status === 409 ? t('vc.tg.nolink') : J.errMsg(r.data)));
        };
        $('[data-a=ctasks]', body).onclick = function () { navigator.clipboard.writeText((a.tasks || []).map(function (x) { return '☐ ' + x.text + (x.owner ? ' — ' + x.owner : '') + (x.due ? ' (' + x.due + ')' : ''); }).join('\n')).then(function () { J.toast(t('act.copied')); }); };
      }
    }
    // ---- pleyer ----
    var prog = $('.vc-prog', v), bar = $('.vc-prog i', v), cur = $('.cur', v), tot = $('.tot', v), playB = $('[data-a=play]', v);
    var SPEEDS = [1, 1.25, 1.5, 2], si = 0;
    function dur() { return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (get(id) || {}).duration || 0; }
    audio.addEventListener('loadedmetadata', function () { tot.textContent = fmt(dur()); });
    audio.addEventListener('timeupdate', function () { cur.textContent = fmt(audio.currentTime); bar.style.width = (dur() ? 100 * audio.currentTime / dur() : 0) + '%'; hl(); });
    audio.addEventListener('play', function () { playB.innerHTML = J.icon('pause'); });
    audio.addEventListener('pause', function () { playB.innerHTML = J.icon('play'); });
    tot.textContent = fmt(dur());
    prog.onclick = function (e) { var r = prog.getBoundingClientRect(); audio.currentTime = dur() * (e.clientX - r.left) / r.width; };
    playB.onclick = function () { if (!audio.src) { J.toast(t('vc.noaudio')); return; } audio.paused ? audio.play() : audio.pause(); };
    $('[data-a=b5]', v).onclick = function () { audio.currentTime = Math.max(0, audio.currentTime - 5); };
    $('[data-a=f5]', v).onclick = function () { audio.currentTime = Math.min(dur(), audio.currentTime + 5); };
    $('[data-a=spd]', v).onclick = function () { si = (si + 1) % SPEEDS.length; audio.playbackRate = SPEEDS[si]; this.textContent = SPEEDS[si] + 'x'; };
    var lastOn = -1;
    function hl() {
      var it = get(id); if (!it || tab !== 'tr') return;
      var tm = audio.currentTime, idx = -1;
      (it.segments || []).forEach(function (g, i) { if (tm >= g.start - .05) idx = i; });
      if (idx === lastOn && $('.vseg.on', v)) return; lastOn = idx;
      $$('.vseg', v).forEach(function (el) { el.classList.toggle('on', +el.dataset.i === idx && !audio.paused); });
    }
    J.on('voice', function (vid) { if (vid === id && document.body.contains(v)) draw(); });
    J.on('route', function (h) { if (h.indexOf('/yozuvlar/' + id) !== 0) audio.pause(); });
    draw();
  };
})(window);
