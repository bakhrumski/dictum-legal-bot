/* Har bir matn maydonida 🎙 (2026-10-29, egasi): maydonga kirilganda uning o'ng chetida mikrofon chiqadi; gapirilgan matn
   (POST /api/voice/dictate — chatdagi bilan bir xil: 2 daqiqagacha, lug'at takliflari bilan) kursor turgan joyga yoziladi.
   Hech narsa o'z-o'zidan yuborilmaydi yoki bajarilmaydi — siz tekshirib, o'zingiz bosasiz. Parol, kod, email, telefon,
   son va sana maydonlarida, o'z mikrofoni bor joylarda (chat, Ishlar buyruq qatori) va [data-nomic] belgisi bor joyda yo'q. */
(function (G) {
  'use strict';
  var J = G.JAI, t = J.t;
  if (!G.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  var MAX = 120;
  var SKIP_TYPES = /^(password|email|tel|number|date|datetime-local|time|month|week|url|file|checkbox|radio|range|color|hidden|submit|button)$/i;

  function eligible(el) {
    if (!el || !el.matches) return false;
    if (!el.matches('textarea, input')) return false;
    if (el.tagName === 'INPUT' && SKIP_TYPES.test(el.type || 'text')) return false;
    if (el.readOnly || el.disabled) return false;
    if (/one-time-code|username|current-password|new-password/i.test(el.getAttribute('autocomplete') || '')) return false;
    // places with their own microphone, and anything marked off
    // (the voice card's own field, e.g. the matter name asked after "yangi ish och", takes it: .vc-name)
    if (el.closest('.cmp, .mt-cmd, [data-nomic]') && !el.classList.contains('vc-name')) return false;
    if (!el.closest('#app, .modal, main, body')) return false;
    return true;
  }

  var btn = null, field = null, rec = null, meter = null, timer = null, busy = false, padded = new WeakMap();
  function make() {
    btn = J.h('<button type="button" class="chip cmp-mic field-mic" aria-label="' + J.esc(t('cmp.mic')) + '" title="' + J.esc(t('cmp.mic')) + '" hidden>' + J.icon('mic') + '<span class="mic-t"></span></button>');
    btn.style.position = 'fixed'; btn.style.zIndex = '60'; btn.style.margin = '0';
    // pressing the button must not take the focus away from the field
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.onclick = toggle;
    document.body.appendChild(btn);
  }
  function place() {
    if (!btn || !field || !document.body.contains(field)) { hide(true); return; }
    var r = field.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > G.innerHeight) { btn.hidden = true; return; }
    btn.hidden = false;
    var h = btn.offsetHeight || 32;
    var top = field.tagName === 'TEXTAREA' ? r.top + 6 : r.top + Math.max(0, (r.height - h) / 2);
    btn.style.top = Math.round(top) + 'px';
    btn.style.right = Math.round(Math.max(4, G.innerWidth - r.right + 6)) + 'px';
    btn.style.left = 'auto';
  }
  function show(el) {
    if (!btn) make();
    field = el;
    // room for the button at the field's end (kept so it is put back)
    if (!padded.has(el)) { padded.set(el, el.style.paddingRight); el.style.paddingRight = '44px'; }
    place();
  }
  function hide(force) {
    if (!btn || (!force && (rec || busy))) return;
    btn.hidden = true;
    if (field && padded.has(field)) { field.style.paddingRight = padded.get(field); padded.delete(field); }
    field = null;
  }
  function insert(el, text) {
    var v = el.value || '', a = el.selectionStart != null ? el.selectionStart : v.length, b = el.selectionEnd != null ? el.selectionEnd : v.length;
    var before = v.slice(0, a), after = v.slice(b);
    var piece = (before && !/\s$/.test(before) ? ' ' : '') + text + (after && !/^\s/.test(after) ? ' ' : '');
    var max = el.maxLength > 0 ? el.maxLength : Infinity;
    var next = (before + piece + after).slice(0, max);
    el.value = next;
    var pos = Math.min(next.length, (before + piece).length);
    try { el.setSelectionRange(pos, pos); } catch (e) { /* some inputs have no selection */ }
    // the page's own handlers (search filters, counters) see it as typed
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }
  function reset() {
    clearInterval(timer); timer = null;
    if (meter) { meter.stop(); meter = null; }
    if (btn) { btn.classList.remove('on'); btn.disabled = false; btn.querySelector('.mic-t').textContent = ''; }
    rec = null; busy = false;
  }
  async function toggle() {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    if (busy || !field) return;
    var target = field, stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { J.toast(t('cmp.mic.denied')); return; }
    var chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async function () {
      stream.getTracks().forEach(function (tr) { tr.stop(); });
      if (meter) { meter.stop(); meter = null; }
      clearInterval(timer);
      busy = true; btn.classList.remove('on'); btn.disabled = true; btn.querySelector('.mic-t').textContent = t('cmp.mic.busy'); place();
      var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), fd = new FormData();
      fd.append('file', blob, 'dictation.' + (/ogg/.test(blob.type) ? 'ogg' : /mp4|aac/.test(blob.type) ? 'm4a' : 'webm'));
      fd.append('lang', J.lang === 'ru' ? 'ru' : 'uz');
      var r = await J.api('/api/voice/dictate', { method: 'POST', body: fd });
      reset();
      if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
      if (document.body.contains(target)) insert(target, r.data.text);
      // a word that looks like a mis-heard legal term is named, never changed (src/voice/glossary.js)
      var sg = r.data.suggestions || [];
      if (sg.length) J.toast(t('cmp.mic.check') + ' ' + sg.map(function (x) { return '«' + x.from + '» → «' + x.to + '»?'; }).join(', '), 7000);
      place();
    };
    rec.start();
    btn.classList.add('on');
    meter = J.micMeter(stream, btn);
    var secs = 0;
    timer = setInterval(function () { secs++; place(); if (secs >= MAX && rec && rec.state === 'recording') rec.stop(); }, 1000);
    place();
  }

  // the same switch as the chat's microphone (/api/voice/balance -> dictation), asked
  // on the first field the person enters - by then they are signed in; a failed
  // answer is not kept, so a later field asks again
  var allowed = null;
  function ok() {
    if (allowed) return allowed;
    if (J.dictationOk === undefined) J.dictationOk = J.api('/api/voice/balance', { allow401: true }).then(function (r) { return !!(r.ok && r.data && r.data.dictation); });
    allowed = J.dictationOk.then(function (v) { if (!v) { allowed = null; J.dictationOk = undefined; } return v; });
    return allowed;
  }

  function start() {
    document.addEventListener('focusin', function (e) {
      if (rec || busy) return;
      var el = e.target;
      if (!eligible(el)) { if (el !== btn) hide(); return; }
      ok().then(function (yes) { if (yes && document.activeElement === el) show(el); });
    });
    document.addEventListener('focusout', function () {
      // a moment later: focus may be moving to another field
      setTimeout(function () { var a = document.activeElement; if (!eligible(a) && a !== btn) hide(); }, 120);
    });
    G.addEventListener('scroll', function () { if (field) place(); }, true);
    G.addEventListener('resize', function () { if (field) place(); });
    J.on && J.on('route', function () { if (rec && rec.state === 'recording') rec.stop(); hide(true); });
  }

  start();
  J.fieldMic = { eligible: eligible };
})(window);
