/* U3 (docs/design/ux-audit-2026-11.md): hujjat uchun bitta eshik - "Nima qilaylik?".
   Fayl chatga, bosh sahifaga yoki Hujjatlarga tashlansa (yoki Hujjatlardagi hujjat tanlansa) bitta karta chiqadi:
   har amal yonida natijasi va narxi bir qatorda. Hech narsa o'zi ishga tushmaydi; pullik amal serverda narxni
   ko'rsatib tasdiq so'raydi (409 DOC_COST_CONFIRM) - bu yerdagi narx faqat oldindan ma'lumot.
   Hozirgi sahifalar (Hujjat tahlili, Playbook, Jadval, muharrir) o'zgarmaydi - karta ularni hujjat bilan ochadi. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { title: 'Nima qilaylik?', close: 'Yopish', free: 'bepul', q1: '1 savol', units: '{n} birlik hujjat tahlili', unitsHint: '1 birlik = 10 sahifagacha; narx boshlashdan oldin ko‘rsatiladi',
      perDoc: 'har hujjatga 1 savol', unitsFrom: '{n} birlikdan', drop: 'Faylni shu yerga tashlang', reading: 'O‘qilmoqda…', act: 'Nima qilaylik?',
      a: {
        explain: ['Oddiy tilda tushuntirish', 'Asosiy mazmun, majburiyatlar va muddatlar'],
        risk: ['To‘liq tahlil (xavflar)', 'Xavfli bandlar, yetishmayotgan shartlar, tavsiyalar'],
        ask: ['Savol berish', 'Hujjat haqida o‘z savolingizni yozasiz'],
        editor: ['Muharrirda ochish', 'Word kabi tahrirlash, izoh va versiyalar'],
        full: ['Shartnomani to‘liq tekshirish', 'Xatarlar, firma qoidalari va qonun — bitta tekshiruvda, takliflar muharrirda'],
        playbook: ['Firma qoidalari bilan tekshirish', 'Sizning shartlaringizga mos-mos emasligi'],
        compare: ['Boshqa hujjatlar bilan solishtirish', 'Bir nechta hujjat bir jadvalda']
      }, askPh: 'Hujjat haqida savolingizni yozing…' },
    ru: { title: 'Что сделать?', close: 'Закрыть', free: 'бесплатно', q1: '1 вопрос', units: '{n} ед. анализа документа', unitsHint: '1 единица = до 10 страниц; цена показывается до начала',
      perDoc: '1 вопрос за документ', unitsFrom: 'от {n} ед.', drop: 'Перетащите файл сюда', reading: 'Читаем…', act: 'Что сделать?',
      a: {
        explain: ['Объяснить простым языком', 'Главное, обязанности и сроки'],
        risk: ['Полный анализ (риски)', 'Опасные пункты, недостающие условия, рекомендации'],
        ask: ['Задать вопрос', 'Свой вопрос по документу'],
        editor: ['Открыть в редакторе', 'Правка как в Word, комментарии и версии'],
        full: ['Полная проверка договора', 'Риски, правила фирмы и закон — за одну проверку, предложения в редакторе'],
        playbook: ['Проверить по правилам фирмы', 'Соответствие вашим условиям'],
        compare: ['Сравнить с другими документами', 'Несколько документов в одной таблице']
      }, askPh: 'Напишите вопрос по документу…' },
    en: { title: 'What should we do?', close: 'Close', free: 'free', q1: '1 question', units: '{n} document analysis unit(s)', unitsHint: '1 unit = up to 10 pages; the price is shown before it starts',
      perDoc: '1 question per document', unitsFrom: 'from {n} unit(s)', drop: 'Drop a file here', reading: 'Reading…', act: 'What to do?',
      a: {
        explain: ['Explain in plain words', 'Key points, obligations and deadlines'],
        risk: ['Full review (risks)', 'Risky clauses, missing terms, recommendations'],
        ask: ['Ask a question', 'Your own question about the document'],
        editor: ['Open in the editor', 'Edit like Word, comments and versions'],
        full: ['Full contract check', 'Risks, firm rules and the law in one check, proposals in the editor'],
        playbook: ['Check against firm rules', 'Whether it meets your terms'],
        compare: ['Compare with other documents', 'Several documents in one table']
      }, askPh: 'Write your question about the document…' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (typeof x === 'string' && v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  J.docActText = s;
  var ORDER = ['explain', 'risk', 'full', 'ask', 'editor', 'playbook', 'compare'];
  var ICON = { explain: 'doc', risk: 'scan', full: 'spark', ask: 'chat', editor: 'pen', playbook: 'check', compare: 'layers' };

  /** The library id of a read file (the server keeps every read document: /api/analyze/extract docId, OCR scanId). */
  function libId(f) { return (f && (f.docId || f.scanId)) || null; }
  /** Units by the size the server measured (max(pages/10, chars/40 000)); the server's own quote is what counts. */
  function unitsOf(f) {
    if (f && f.units) return f.units;
    var n = Math.max(1, Math.ceil(Math.max(((f && f.pages) || 0) / 10, ((f && f.chars) || 0) / 40000)));
    return n;
  }
  function cost(k, f) {
    if (k === 'ask') return s('q1');
    if (k === 'editor') return s('free');
    if (k === 'compare') return s('perDoc');
    if (k === 'full') return s('unitsFrom', { n: unitsOf(f) });
    return s('units', { n: unitsOf(f) });
  }

  /**
   * The card. f: a read file ({ name, text | scanId, docId?, pages, chars, units }); handlers: { explain, risk, ask, ... }
   * each a function (only the ones given are offered); onClose. Returns the element.
   */
  J.docActions = function (f, handlers, opts) {
    opts = opts || {};
    var A = s('a'), keys = ORDER.filter(function (k) { return typeof handlers[k] === 'function'; });
    // the editor needs the document kept in the library
    if (!libId(f)) keys = keys.filter(function (k) { return k !== 'editor'; });
    var el = J.h('<div class="da-card' + (opts.inline ? ' da-inline' : '') + '" role="group"><div class="da-h"><b>' + esc(s('title')) + '</b><span class="da-f muted" data-noalpha></span>' +
      (opts.onClose ? '<button type="button" class="ib da-x" aria-label="' + esc(s('close')) + '">' + J.icon('x') + '</button>' : '') + '</div>' +
      '<div class="da-list">' + keys.map(function (k) {
        return '<button type="button" class="da-row" data-da="' + k + '"><span class="da-ic">' + J.icon(ICON[k]) + '</span><span class="da-t"><b>' + esc(A[k][0]) + '</b><small>' + esc(A[k][1]) + '</small></span><span class="da-c">' + esc(cost(k, f)) + '</span></button>';
      }).join('') + '</div>' + (keys.some(function (k) { return k === 'explain' || k === 'risk' || k === 'playbook' || k === 'full'; }) ? '<p class="da-note muted">' + esc(s('unitsHint')) + '</p>' : '') + '</div>');
    $('.da-f', el).textContent = f.name || '';
    $$('[data-da]', el).forEach(function (b) { b.onclick = function () { handlers[b.dataset.da](f); }; });
    var x = $('.da-x', el); if (x) x.onclick = function () { opts.onClose(); };
    return el;
  };

  /* ---------- shared handlers: the existing pages, opened with this document ---------- */
  /** The document waits in memory for the page that takes it (playbook.js, tabular.js read and clear it). */
  J.docHandoff = null;
  function asPageDoc(f) {
    var d = { name: f.name || 'Hujjat', status: 'ok' };
    if (f.text) { d.text = f.text; d.chars = f.chars || f.text.length; } else { d.scanId = libId(f); d.chars = f.chars || 0; }
    // a text document kept in the library travels by its id too - it is not an OCR reading
    if (!f.text && f.kind === 'text') d.textDoc = true;
    return d;
  }
  J.docGo = {
    editor: function (f) { if (J.openLibraryInEditor) J.openLibraryInEditor({ id: libId(f), name: f.name }); },
    playbook: function (f) { J.docHandoff = asPageDoc(f); J.go('#/playbook'); },
    compare: function (f) { J.docHandoff = asPageDoc(f); J.go('#/jadval'); },
    /** G2: the full check of a contract - the document travels by its library id (the editor opens it from there) */
    full: function (f) { if (J.contractWithDoc) J.contractWithDoc(f); },
    /** a chat with this document: a service (explain / risk) is sent at once, a question waits in the box */
    chat: function (f, skillId) { if (J.chatWithDoc) J.chatWithDoc(f, skillId || null); }
  };

  /** The card in a window (Hujjatlar: a dropped file or a document of the list). */
  J.docActionsModal = function (f) {
    var m = J.modal({ cls: 'sm da-modal', html: '' });
    var close = function () { m.close(); };
    var card = J.docActions(f, {
      explain: function () { close(); J.docGo.chat(f, 'explain'); },
      risk: function () { close(); J.docGo.chat(f, 'risk'); },
      ask: function () { close(); J.docGo.chat(f, null); },
      editor: function () { close(); J.docGo.editor(f); },
      full: function () { close(); J.docGo.full(f); },
      playbook: function () { close(); J.docGo.playbook(f); },
      compare: function () { close(); J.docGo.compare(f); }
    });
    m.body.appendChild(card);
    return m;
  };

  /**
   * A drop zone on a page (Hujjatlar): a dropped file is read once (kept in the library by the server) and the card
   * opens. onRead(f) runs after reading (e.g. the list reloads). Returns nothing; a second binding is ignored.
   */
  J.bindDocDrop = function (root, onRead) {
    if (!root || root._daDrop) return; root._daDrop = true;
    var over = 0;
    root.addEventListener('dragenter', function (e) { if (hasFiles(e)) { over++; root.classList.add('da-over'); } });
    root.addEventListener('dragleave', function () { if (--over <= 0) { over = 0; root.classList.remove('da-over'); } });
    root.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    root.addEventListener('drop', async function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); over = 0; root.classList.remove('da-over');
      var file = e.dataTransfer.files[0]; if (!file) return;
      J.toast(s('reading'));
      try {
        var f = await J.readFile(file, J.scanConfirm);
        if (onRead) onRead(f);
        J.docActionsModal(f);
      } catch (err) { if (err && err.message !== 'cancel') J.toast(file.name + ': ' + err.message, 6000); }
    });
  };
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') > -1; }
})(window);
