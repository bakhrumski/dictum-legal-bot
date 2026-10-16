/* JuristAI — Word'da o'ng tugma menyusi (manifest: ContextMenuText → ExecuteFunction).
   Panel ochilmaydi: belgilangan bandga darhol "ishlanmoqda" izohi qo'yiladi, javob kelgach
   tuzatish Track Changes bilan kiritiladi va izoh sababi bilan yangilanadi. Token panel bilan bir xil. */
(function () {
  'use strict';
  var S = window.JAIShared;
  var WAIT = 'JuristAI: ishlanmoqda…';

  function token() { try { return localStorage.getItem(S.TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function has14() { try { return Office.context.requirements.isSetSupported('WordApi', '1.4'); } catch (e) { return false; } }

  /** tanlangan diapazon (kuzatiladi) va matni; izoh qo'yish mumkin bo'lsa "ishlanmoqda" izohi */
  function begin() {
    return Word.run(function (ctx) {
      var r = ctx.document.getSelection(); r.load('text'); r.track();
      return ctx.sync().then(function () {
        if (!String(r.text || '').trim()) return { range: r, text: '' };
        if (has14()) r.insertComment(WAIT);
        return ctx.sync().then(function () { return { range: r, text: r.text }; });
      });
    });
  }
  /** "ishlanmoqda" izohini yangi matn bilan almashtiradi (yoki izohsiz Word'da hech narsa qilmaydi) */
  function setNote(sel, text) {
    if (!has14()) return Promise.resolve();
    return Word.run(sel.range, function (ctx) {
      var cs = ctx.document.body.getComments(); cs.load('items/content');
      return ctx.sync().then(function () {
        var mine = cs.items.filter(function (c) { return c.content === WAIT; });
        if (mine.length) mine[mine.length - 1].content = text.slice(0, 2000);
        else sel.range.insertComment(text.slice(0, 2000));
        return ctx.sync();
      });
    });
  }
  function replaceTracked(sel, newText) {
    return Word.run(sel.range, function (ctx) {
      var doc = ctx.document, prev = null, api14 = has14();
      var chain = Promise.resolve();
      if (api14) { doc.load('changeTrackingMode'); chain = ctx.sync().then(function () { prev = doc.changeTrackingMode; doc.changeTrackingMode = 'TrackAll'; return ctx.sync(); }); }
      return chain.then(function () { sel.range.insertText(newText, 'Replace'); return ctx.sync(); })
        .then(function () { if (prev != null && prev !== 'TrackAll') { doc.changeTrackingMode = prev; return ctx.sync(); } });
    });
  }

  function errText(status, d) {
    d = d || {};
    if (status === 401) return 'JuristAI: ulanish muddati tugagan. Bosh sahifadagi JuristAI paneli orqali akkauntni qayta ulang.';
    if (status === 409 && d.code === 'DOC_COST_CONFIRM') return 'JuristAI: tanlov juda katta — uni JuristAI panelining "Hujjat" bo‘limi orqali tahlil qiling.';
    var m = d.message || (typeof d.error === 'string' && d.error.length > 3 && !/^[a-z_]+$/.test(d.error) ? d.error : '') || 'xatolik yuz berdi, qayta urinib ko‘ring.';
    return 'JuristAI: ' + m;
  }

  function ask(message, documentText) {
    return fetch('/api/legal-chat', {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify({ message: message, history: [], databases: ['lex.uz'], topic: null, topics: null, autoDetect: true,
        documentText: documentText, docTicket: null, scanIds: null, confirmedJob: null, stream: false })
    }).then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { status: res.status, ok: res.ok && !!d.reply, d: d }; }); });
  }

  function run(event, kind) {
    var done = function () { try { event.completed(); } catch (e) {} };
    var sel = null;
    begin().then(function (s) {
      sel = s;
      if (!s.text.trim()) return;
      if (!token()) return setNote(s, 'JuristAI: avval Bosh sahifadagi JuristAI tugmasi orqali panelni ochib, akkauntni ulang.');
      var edit = kind !== 'explain';
      var msg = edit ? S.PRESETS[kind] + S.EDIT_FORMAT : S.PRESETS.explain;
      return ask(msg, s.text).then(function (r) {
        if (!r.ok) return setNote(s, errText(r.status, r.d));
        var reply = r.d.reply;
        if (!edit) return setNote(s, 'JuristAI: ' + S.plainOf(reply));
        var prop = S.splitProposal(reply);
        if (!prop || !prop.text) return setNote(s, 'JuristAI (yangi matn ajratilmadi): ' + S.plainOf(reply));
        return replaceTracked(s, prop.text).then(function () { return setNote(s, 'JuristAI: ' + S.plainOf(prop.rest)); });
      });
    }).catch(function (e) {
      if (sel) return setNote(sel, 'JuristAI: ' + ((e && e.message) || 'xatolik')).catch(function () {});
    }).then(done, done);
  }

  var ACTIONS = {
    jaiFix: function (e) { run(e, 'fix'); },
    jaiClear: function (e) { run(e, 'clear'); },
    jaiProtect: function (e) { run(e, 'protect'); },
    jaiExplain: function (e) { run(e, 'explain'); }
  };
  Object.keys(ACTIONS).forEach(function (k) { window[k] = ACTIONS[k]; });
  Office.onReady(function () {
    if (Office.actions && Office.actions.associate) Object.keys(ACTIONS).forEach(function (k) { Office.actions.associate(k, ACTIONS[k]); });
  });
  window.__jaiCommands = { run: run, errText: errText };
})();
