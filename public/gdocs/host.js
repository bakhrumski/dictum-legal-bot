/* JuristAI — Google Docs yon paneli uchun hujjat muhiti.
   Apps Script (addins/gdocs/Code.gs) funksiyalari google.script.run orqali chaqiriladi;
   panelning o'zi /word/taskpane.js (window.JAI_HOST shu yerda beriladi). */
(function () {
  'use strict';
  function run(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      if (!window.google || !google.script || !google.script.run) { reject(new Error('Google Docs bilan aloqa yo‘q. Panelni qayta oching.')); return; }
      var r = google.script.run.withSuccessHandler(resolve).withFailureHandler(function (e) { reject(new Error((e && e.message) || String(e))); });
      r[fn].apply(r, args);
    });
  }

  /* Javob matnidan Google Docs bloklari: sarlavha, paragraf, ro'yxat; **qalin** va [havola](url) saqlanadi */
  var FOOT = /(?:^|\n)\s*(?:---\s*\n\s*)?(?:#{1,6}\s*)?(?:\*{0,2})\s*(?:📎\s*)?(?:Manbalar|Источники|Sources)\s*(?:\*{0,2})\s*:?\s*([\s\S]*)$/iu;
  function blocksOf(reply, sources) {
    var text = String(reply || '').replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^[ \t]*<<<\s*YANGI_MATN[ \t]*$|^[ \t]*YANGI_MATN\s*>>>[ \t]*$/gm, '');
    var f = text.match(FOOT); if (f) text = text.slice(0, f.index);
    var out = [];
    text.split('\n').forEach(function (l) {
      var m;
      if (/^\s*$/.test(l) || /^\s*(---|\*\*\*)\s*$/.test(l) || /^\s*\|?\s*:?-{2,}/.test(l)) return;
      if ((m = l.match(/^#{1,6}\s+(.*)$/))) out.push({ t: 'h', text: m[1] });
      else if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) out.push({ t: 'li', text: m[1] });
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) out.push({ t: 'oli', text: m[1] });
      else if (/^\s*\|.*\|\s*$/.test(l)) out.push({ t: 'p', text: l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }).join(' — ') });
      else if ((m = l.match(/^\s*&?gt;\s?(.*)$|^\s*>\s?(.*)$/))) out.push({ t: 'p', text: m[1] || m[2] || '' });
      else out.push({ t: 'p', text: l.trim() });
    });
    if (sources && sources.length) {
      out.push({ t: 'p', text: '**Manbalar:**' });
      sources.forEach(function (s) { out.push({ t: 'oli', text: '[' + s.title + '](' + s.url + ')' }); });
    }
    return out;
  }

  window.JAI_HOST = {
    name: 'gdocs',
    bodyText: function () { return run('jaiBodyText'); },
    selection: function () { return run('jaiSelection').then(function (s) { return { text: (s && s.text) || '' }; }); },
    /** track = "tahrir belgisi": eski matn qizil ustidan chizilgan, yangisi ko'k tagiga chizilgan holda */
    replace: function (saved, text, o) { return run('jaiReplace', saved.text, text, !!(o && o.track)); },
    comment: function () { return Promise.reject(new Error('Google Docs’da izoh qo‘shish hozircha yo‘q.')); },
    insertAnswer: function (reply, r) { return run('jaiInsertBlocks', blocksOf(reply, r && r.sources)); },
    caps: function () { return { track: true, comment: false, trackLabel: 'Tahrir belgisi bilan qo‘yish', noTrackLabel: 'Almashtirish' }; },
    openBrowser: function (url) { window.open(url, '_blank'); },
    // Google Docs tanlov hodisasini bermaydi: panel ochiq va "Tanlangan" yorlig'ida bo'lsa, vaqti-vaqti bilan tekshiriladi
    onSelection: function (fn) { setInterval(function () { if (!document.hidden) fn(); }, 3000); },
    _blocksOf: blocksOf
  };

  // Word'ga oid matnlar
  var h1 = document.querySelector('#vConnect h1'); if (h1) h1.textContent = 'Google Docs uchun JuristAI';
  var tip = document.querySelector('#selPrev'); if (tip) tip.textContent = 'Hujjatda bandni belgilang.';
  document.title = 'JuristAI — Google Docs';
})();
