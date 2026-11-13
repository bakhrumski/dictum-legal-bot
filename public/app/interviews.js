/* Intervyu yozuvlari (2026-10-28, CustDev 4-bosqich): ish sahifasida, faqat xodimga. Rozilik (kim, qachon, qanday) va
   ogohlantirish tasdig'isiz yuklab bo'lmaydi; yozuv matnga aylanadi (bo'laklab), transkript versiyalar bilan saqlanadi,
   audio muddatidan keyin o'chadi (transkript qoladi); AI xulosasi ixtiyoriy va iqtiboslar transkriptda so'zma-so'z tekshiriladi.
   Yozuvni faqat yuklagan xodim va master ko'radi. Server: src/interviews/routes.js. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    title: 'Intervyu yozuvlari', lead: 'Mijoz bilan suhbat yozuvi — faqat uning roziligi bilan. Yozuvni faqat siz va master ko‘rasiz.',
    add: 'Yozuv yuklash', none: 'Hali yozuv yo‘q.', who: 'Kim rozilik berdi', when: 'Qachon', how: 'Qanday',
    verbal: 'Yozuv boshida og‘zaki', written: 'Yozma', note: 'Izoh (ixtiyoriy)', client: 'Pilot mijoz (ixtiyoriy)', file: 'Audio fayl',
    ack: 'Ishtirokchiga shu aytildi va u rozi bo‘ldi', upload: 'Yuklash', cancel: 'Bekor qilish', name: 'Sarlavha (ixtiyoriy)',
    st: { queued: 'Navbatda', transcribing: 'Matnga aylanmoqda…', transcribed: 'Tayyor', failed: 'Xato' },
    audioUntil: 'Audio {d} da o‘chadi', audioGone: 'Audio o‘chirilgan', transcript: 'Transkript', version: 'versiya',
    saveVersion: 'Yangi versiya sifatida saqlash', saved: 'Saqlandi', summary: 'AI xulosasi', makeSummary: 'AI xulosasi tayyorlash',
    quotes: 'Eng kuchli iqtiboslar', removed: '{n} ta iqtibos transkriptda so‘zma-so‘z topilmadi va olib tashlandi',
    f: { problem: 'Muammo', current_solution: 'Hozirgi yechim', current_price: 'Hozirgi yechim narxi', confusing: 'Chalkash joylar', missing: 'Yetishmayotgan narsalar', signal: 'Signal', price_answers: 'Narx haqidagi javoblar' },
    delAudio: 'Audioni hozir o‘chirish', delQ: 'Audio butunlay o‘chiriladi, transkript qoladi. Davom etasizmi?', retry: 'Qayta urinish',
    log: 'Jurnal', ev: { uploaded: 'Rozilik bilan yuklandi', transcribed: 'Matnga aylantirildi', transcription_failed: 'Matnga aylantirib bo‘lmadi', transcript_version: 'Yangi transkript versiyasi', summary: 'AI xulosasi', audio_deleted: 'Audio o‘chirildi' },
    retention: 'muddat tugagani uchun', manual: 'qo‘lda', missing: 'To‘ldiring: rozilik kim, qachon, qanday va tasdiq belgisi'
  };
  var fmtDur = function (s) { s = Number(s) || 0; return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  J.interviewsCard = function (host, M) {
    if (!host || !J.isStaff || !J.isStaff()) return;
    var timer = null;
    host.innerHTML = '<div class="card iv-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h4 style="margin:0">' + esc(S.title) + '</h4>' +
      '<button class="pill sm" type="button" data-a="ivadd">' + J.icon('plus') + esc(S.add) + '</button></div><p class="muted" style="font-size:13px;margin:6px 0 10px">' + esc(S.lead) + '</p><div class="iv-list"></div></div>';
    $('[data-a=ivadd]', host).onclick = function () { openUpload(M, load); };
    async function load() {
      if (!document.body.contains(host)) { clearTimeout(timer); return; }
      var r = await J.api('/api/matters/' + encodeURIComponent(M.id) + '/interviews');
      var box = $('.iv-list', host);
      if (!r.ok) { box.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      var list = r.data.recordings || [];
      box.innerHTML = list.length ? list.map(function (x) {
        var audio = x.audioDeletedAt ? S.audioGone : (x.audioDeleteAfter ? S.audioUntil.replace('{d}', J.fmtDate(x.audioDeleteAfter)) : '');
        return '<div class="mt-item go iv-row" role="button" tabindex="0" data-iv="' + esc(x.id) + '"><span>' + J.icon('mic') + '</span><span style="flex:1;min-width:0"><b></b>' +
          '<small class="muted" style="display:block">' + esc((S.st[x.status] || x.status) + ' · ' + fmtDur(x.durationSec) + ' · ' + x.consent.by + ' · ' + (x.consent.method === 'written' ? S.written : S.verbal) + (audio ? ' · ' + audio : '')) + '</small></span></div>';
      }).join('') : '<div class="empty-state">' + esc(S.none) + '</div>';
      list.forEach(function (x) { var b = $('[data-iv="' + x.id + '"] b', box); if (b) b.textContent = x.title; });
      $$('[data-iv]', box).forEach(function (b) {
        b.onclick = function () { openDetail(b.dataset.iv, load); };
        b.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(b.dataset.iv, load); } };
      });
      clearTimeout(timer);
      if (list.some(function (x) { return x.status === 'queued' || x.status === 'transcribing'; })) timer = setTimeout(load, 5000);
    }
    load();
  };

  async function openUpload(M, done) {
    var notice = await J.api('/api/interviews/notice');
    var text = notice.ok ? notice.data.text : '';
    var now = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    var m = J.modal({ cls: 'sm', html: '<h2>' + esc(S.add) + '</h2>' +
      '<div class="field" style="margin-top:12px"><label>' + esc(S.who) + '</label><input class="inp iv-who" maxlength="160" placeholder="F.I.Sh."></div>' +
      '<div class="field"><label>' + esc(S.when) + '</label><input class="inp iv-when" type="datetime-local" value="' + now + '"></div>' +
      '<div class="field"><label>' + esc(S.how) + '</label><div style="display:flex;gap:14px;flex-wrap:wrap"><label><input type="radio" name="ivm" value="verbal_recording" checked> ' + esc(S.verbal) + '</label><label><input type="radio" name="ivm" value="written"> ' + esc(S.written) + '</label></div></div>' +
      '<div class="field"><label>' + esc(S.note) + '</label><input class="inp iv-note" maxlength="1000"></div>' +
      '<div class="field iv-cl" hidden><label>' + esc(S.client) + '</label><select class="inp iv-client"><option value="">—</option></select></div>' +
      '<div class="field"><label>' + esc(S.name) + '</label><input class="inp iv-title" maxlength="160"></div>' +
      '<div class="field"><label>' + esc(S.file) + '</label><input class="iv-file" type="file" accept="audio/*,.ogg,.oga,.opus,.mp3,.m4a,.wav,.webm,.aac,.flac"></div>' +
      '<div class="note-blue" style="font-size:13px;margin:6px 0 10px"></div>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:14px"><input type="checkbox" class="iv-ack"> <span>' + esc(S.ack) + '</span></label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" class="pill ghost" data-a="no">' + esc(S.cancel) + '</button><button type="button" class="pill" data-a="ok">' + esc(S.upload) + '</button></div>' });
    $('.note-blue', m.body).textContent = text;
    J.api('/api/sales/me', { allow401: true }).then(function (r) {
      if (!r.ok || !(r.data.clients || []).length) return;
      var sel = $('.iv-client', m.body);
      r.data.clients.forEach(function (c) { var o = document.createElement('option'); o.value = c.id; o.textContent = c.full_name || ('#' + c.id); sel.appendChild(o); });
      $('.iv-cl', m.body).hidden = false;
    });
    $('[data-a=no]', m.body).onclick = function () { m.close(); };
    $('[data-a=ok]', m.body).onclick = async function () {
      var who = $('.iv-who', m.body).value.trim(), when = $('.iv-when', m.body).value, ack = $('.iv-ack', m.body).checked, f = $('.iv-file', m.body).files[0];
      var how = ($('input[name=ivm]:checked', m.body) || {}).value;
      if (who.length < 2 || !when || !how || !ack) { J.toast(S.missing, 5000); return; }
      if (!f) { $('.iv-file', m.body).focus(); return; }
      var fd = new FormData();
      fd.append('consentBy', who); fd.append('consentAt', new Date(when).toISOString()); fd.append('consentMethod', how);
      fd.append('consentNote', $('.iv-note', m.body).value.trim()); fd.append('consentAck', 'yes');
      fd.append('title', $('.iv-title', m.body).value.trim()); fd.append('clientId', $('.iv-client', m.body).value || '');
      fd.append('lang', J.lang === 'ru' ? 'ru' : 'uz'); fd.append('file', f);
      var b = this; b.disabled = true;
      var r = await J.api('/api/matters/' + encodeURIComponent(M.id) + '/interviews', { method: 'POST', body: fd });
      b.disabled = false;
      if (!r.ok) { J.toast(J.errMsg(r.data), 6000); return; }
      m.close(); done();
    };
  }

  async function openDetail(id, done) {
    var r = await J.api('/api/interviews/' + encodeURIComponent(id));
    if (!r.ok) { J.toast(J.errMsg(r.data)); return; }
    var d = r.data, x = d.recording, sm = x.summary;
    var sumHtml = sm ? '<div class="iv-sum"><p class="note-blue" style="font-size:13px">' + esc(sm.label) + '</p>' +
      (sm.quotes.length ? '<h4>' + esc(S.quotes) + '</h4><ul>' + sm.quotes.map(function (q) { return '<li>«' + esc(q) + '»</li>'; }).join('') + '</ul>' : '') +
      (sm.quotesRemoved ? '<p class="muted" style="font-size:12.5px">' + esc(S.removed.replace('{n}', sm.quotesRemoved)) + '</p>' : '') +
      ['problem', 'current_solution', 'current_price', 'confusing', 'missing', 'signal', 'price_answers'].map(function (k) {
        var v = sm[k]; if (!v || (Array.isArray(v) && !v.length)) return '';
        return '<p style="margin:6px 0"><b>' + esc(S.f[k]) + ':</b> ' + esc(Array.isArray(v) ? v.join('; ') : v) + '</p>';
      }).join('') + '</div>' : '';
    var m = J.modal({ html: '<h2></h2><p class="muted" style="font-size:13px">' + esc((S.st[x.status] || x.status) + ' · ' + fmtDur(x.durationSec) + ' · ' + x.consent.by + ', ' + J.fmtDate(x.consent.at) + ' · ' + (x.consent.method === 'written' ? S.written : S.verbal)) + '</p>' +
      (d.transcript ? '<h4>' + esc(S.transcript) + ' · ' + esc(String(d.transcript.version)) + '-' + esc(S.version) + '</h4><textarea class="inp iv-tx" style="min-height:220px;width:100%"></textarea>' +
        '<div style="margin-top:8px"><button class="pill sm ghost" type="button" data-a="ver">' + esc(S.saveVersion) + '</button></div>' : (x.error ? '<p class="err">' + esc(x.error) + '</p>' : '')) +
      '<div style="margin-top:16px"><h4>' + esc(S.summary) + '</h4>' + sumHtml + (d.transcript ? '<button class="pill sm" type="button" data-a="sum">' + J.icon('spark') + esc(S.makeSummary) + '</button>' : '') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">' + (x.audioDeletedAt ? '' : '<button class="pill sm ghost" type="button" data-a="del">' + J.icon('trash') + esc(S.delAudio) + '</button>') +
        (x.status === 'failed' && !x.audioDeletedAt ? '<button class="pill sm ghost" type="button" data-a="retry">' + esc(S.retry) + '</button>' : '') + '</div>' +
      '<h4 style="margin-top:16px">' + esc(S.log) + '</h4><ul class="iv-log" style="font-size:13px">' + d.events.map(function (e) {
        var why = e.event === 'audio_deleted' && e.details && e.details.reason ? ' (' + (S[e.details.reason] || e.details.reason) + ')' : '';
        return '<li>' + esc(J.fmtDate(e.at) + ' — ' + (S.ev[e.event] || e.event) + why) + '</li>';
      }).join('') + '</ul>' });
    $('h2', m.body).textContent = x.title;
    var tx = $('.iv-tx', m.body); if (tx) { tx.value = d.transcript.body; tx.setAttribute('data-noalpha', ''); }
    var vb = $('[data-a=ver]', m.body);
    if (vb) vb.onclick = async function () {
      vb.disabled = true;
      var q = await J.api('/api/interviews/' + encodeURIComponent(id) + '/transcript', { method: 'PUT', body: { body: tx.value } });
      vb.disabled = false;
      if (!q.ok) { J.toast(J.errMsg(q.data), 5000); return; }
      J.toast(S.saved); m.close(); openDetail(id, done);
    };
    var sb = $('[data-a=sum]', m.body);
    if (sb) sb.onclick = async function () {
      sb.disabled = true; sb.innerHTML = '<span class="spin"></span>';
      var q = await J.api('/api/interviews/' + encodeURIComponent(id) + '/summary', { method: 'POST', body: {} });
      if (!q.ok) { sb.disabled = false; sb.textContent = S.makeSummary; J.toast(J.errMsg(q.data), 6000); return; }
      m.close(); openDetail(id, done);
    };
    var db = $('[data-a=del]', m.body);
    if (db) db.onclick = async function () {
      if (!(await J.confirm(S.delQ, S.delAudio))) return;
      var q = await J.api('/api/interviews/' + encodeURIComponent(id) + '/audio', { method: 'DELETE' });
      if (!q.ok) { J.toast(J.errMsg(q.data), 5000); return; }
      m.close(); done(); openDetail(id, done);
    };
    var rb = $('[data-a=retry]', m.body);
    if (rb) rb.onclick = async function () {
      var q = await J.api('/api/interviews/' + encodeURIComponent(id) + '/retry', { method: 'POST', body: {} });
      if (!q.ok) { J.toast(J.errMsg(q.data), 5000); return; }
      m.close(); done();
    };
  }
})(window);
