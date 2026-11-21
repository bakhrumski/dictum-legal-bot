/* "Shartnomani to'liq tekshirish" (2026-11-11, audit X8 / G2): bitta tugma bilan AI tahlil, firma qoidalari va
   qonunchilikdan asos - uch sahifani aylanmasdan; narx boshlashdan oldin ko'rinadi; takliflar muharrirda tayyor turadi.
   Server: POST /api/agent/contract-review/quote, POST /api/agent/contract-review (agent run),
   POST /api/agent/contract-review/:runId/editor (src/agents/contract-routes.js); GET /api/playbooks; J.firm. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: {
      title: 'Shartnomani to‘liq tekshirish', sub: 'Bitta tekshiruvda: xatarlar va yetishmayotgan bandlar, firmangiz qoidalariga mosligi va qonunchilikdan asos. Takliflar muharrirda tayyor turadi.',
      doc: '1. Shartnoma', upload: 'PDF, DOCX yoki skan tanlash', reading: 'O‘qilmoqda…', bad: 'Faylni o‘qib bo‘lmadi',
      rules: '2. Firma qoidalari', rulesHint: 'Ixtiyoriy. Tanlasangiz, shartnoma shu qoidalar bilan ham solishtiriladi.', none: 'Qoidalarsiz', noneSub: 'Faqat tahlil va qonunchilik', firm: 'Firma', mine: 'Meniki', builtin: 'Tayyor', nRules: 'qoida', editRules: 'Qoidalarni tahrirlash',
      price: 'Narx', units: '{n} ta tahlil birligi', pA: 'tahlil {n}', pR: 'firma qoidalari {n}', priceNote: 'Qonunchilikdan asos qidirish qo‘shimcha birlik olmaydi. Chiqmagan qism uchun birlik qaytariladi.', pricing: 'Narx hisoblanmoqda…',
      run: 'Tekshirishni boshlash', need: 'Avval shartnomani yuklang', nounit: 'Tahlil birligi yetarli emas', plans: 'Tariflar', again: 'Boshqa shartnoma',
      working: 'Shartnoma tekshirilmoqda', workingSub: 'Odatda 1–3 daqiqa. Sahifani yopsangiz ham ish davom etadi — natija Hujjatlar → Natijalar bo‘limida turadi.',
      failed: 'Tekshirib bo‘lmadi; birliklar qaytarildi.', gone: 'Natija topilmadi yoki muddati o‘tgan.',
      note: 'Bu AI tekshiruvi — yuridik xulosa emas. Firma qoidalari bir tomonning afzalliklari, qonun emas. Qonun iqtibosi so‘zlar manbada borligini bildiradi, izoh to‘g‘riligini yurist tekshiradi.',
      score: 'Baho', risks: 'Xatarlar', missing: 'Yetishmayotgan bandlar', law: 'Qonunchilik', rulesT: 'Firma qoidalari', charged: 'Yechildi', unitsShort: 'birlik',
      toEditor: 'Muharrirda takliflar bilan ochish', toEditorSub: '{n} ta taklif — har birini qabul qilasiz yoki rad etasiz', opening: 'Ochilmoqda…', noEditor: 'Muharrirda ochish uchun hujjat Hujjatlar bo‘limida saqlangan bo‘lishi kerak.',
      lvl: { high: 'Yuqori', medium: 'O‘rta', low: 'Past' }, notFound: 'joyi matnda topilmadi', proposal: 'Taklif matni', addText: 'Qo‘shiladigan matn',
      lawFound: 'Manbada so‘zma-so‘z topildi', lawNone: 'Manba topilmadi — bu AI fikri, qo‘lda tekshiring', lawNotSearched: 'Manba qidirilmadi (birinchi {n} ta izoh qidiriladi) — qo‘lda tekshiring', lawDropped: '{n} ta iqtibos manbada topilmadi va ko‘rsatilmadi.',
      partRules: 'Firma qoidalari bilan solishtirib bo‘lmadi — bu qism uchun birlik qaytarildi.', partAnalysis: 'AI tahlil chiqmadi — bu qism uchun birlik qaytarildi.', excerpt: 'Uzun shartnoma: qoidalarga mos qismlar o‘qildi.',
      empty: 'Topilmadi', st: { ok: 'tayyor', running: 'bajarilmoqda', failed: 'bajarilmadi', skipped: 'kerak emas', skipped_error: 'bajarilmadi' }
    },
    ru: {
      title: 'Полная проверка договора', sub: 'За одну проверку: риски и недостающие пункты, соответствие правилам фирмы и основание из законодательства. Предложения уже ждут в редакторе.',
      doc: '1. Договор', upload: 'Выбрать PDF, DOCX или скан', reading: 'Читается…', bad: 'Не удалось прочитать файл',
      rules: '2. Правила фирмы', rulesHint: 'Необязательно. Если выбрать, договор сравнивается и с этими правилами.', none: 'Без правил', noneSub: 'Только анализ и законодательство', firm: 'Фирма', mine: 'Мои', builtin: 'Готовые', nRules: 'правил', editRules: 'Изменить правила',
      price: 'Цена', units: '{n} ед. анализа', pA: 'анализ {n}', pR: 'правила фирмы {n}', priceNote: 'Поиск основания в законодательстве единиц не берёт. За часть, которая не получилась, единица возвращается.', pricing: 'Считаем цену…',
      run: 'Начать проверку', need: 'Сначала загрузите договор', nounit: 'Недостаточно единиц анализа', plans: 'Тарифы', again: 'Другой договор',
      working: 'Договор проверяется', workingSub: 'Обычно 1–3 минуты. Страницу можно закрыть — результат будет в «Документы → Результаты».',
      failed: 'Проверить не удалось; единицы возвращены.', gone: 'Результат не найден или срок истёк.',
      note: 'Это проверка AI, а не юридическое заключение. Правила фирмы — предпочтения одной стороны, не закон. Цитата закона значит, что эти слова есть в источнике; верность замечания проверяет юрист.',
      score: 'Оценка', risks: 'Риски', missing: 'Недостающие пункты', law: 'Законодательство', rulesT: 'Правила фирмы', charged: 'Списано', unitsShort: 'ед.',
      toEditor: 'Открыть в редакторе с предложениями', toEditorSub: 'Предложений: {n} — каждое принимаете или отклоняете', opening: 'Открывается…', noEditor: 'Чтобы открыть в редакторе, документ должен быть сохранён в «Документах».',
      lvl: { high: 'Высокий', medium: 'Средний', low: 'Низкий' }, notFound: 'место в тексте не найдено', proposal: 'Предлагаемый текст', addText: 'Текст для добавления',
      lawFound: 'Найдено в источнике дословно', lawNone: 'Источник не найден — это мнение AI, проверьте вручную', lawNotSearched: 'Источник не искали (ищем для первых {n} замечаний) — проверьте вручную', lawDropped: 'Цитат, не найденных в источнике и не показанных: {n}.',
      partRules: 'Сравнить с правилами фирмы не удалось — единица за эту часть возвращена.', partAnalysis: 'Анализ AI не получился — единица за эту часть возвращена.', excerpt: 'Длинный договор: прочитаны части по правилам.',
      empty: 'Не найдено', st: { ok: 'готово', running: 'выполняется', failed: 'не выполнено', skipped: 'не нужно', skipped_error: 'не выполнено' }
    },
    en: {
      title: 'Full contract check', sub: 'In one check: risks and missing clauses, your firm’s rules, and the law behind the remarks. The proposals wait in the editor.',
      doc: '1. Contract', upload: 'Choose a PDF, DOCX or scan', reading: 'Reading…', bad: 'Could not read the file',
      rules: '2. Firm rules', rulesHint: 'Optional. If chosen, the contract is also compared with these rules.', none: 'No rules', noneSub: 'Analysis and law only', firm: 'Firm', mine: 'Mine', builtin: 'Built-in', nRules: 'rules', editRules: 'Edit rules',
      price: 'Price', units: '{n} analysis units', pA: 'analysis {n}', pR: 'firm rules {n}', priceNote: 'The law lookup takes no extra unit. A part that does not come out gives its unit back.', pricing: 'Pricing…',
      run: 'Start the check', need: 'Upload the contract first', nounit: 'Not enough analysis units', plans: 'Plans', again: 'Another contract',
      working: 'Checking the contract', workingSub: 'Usually 1–3 minutes. You can close the page — the result stays under Documents → Results.',
      failed: 'The check failed; the units were returned.', gone: 'The result was not found or has expired.',
      note: 'This is an AI check, not a legal opinion. Firm rules are one side’s preferences, not the law. A law quote means the words are in the source; a lawyer checks that the remark is right.',
      score: 'Score', risks: 'Risks', missing: 'Missing clauses', law: 'Law', rulesT: 'Firm rules', charged: 'Charged', unitsShort: 'units',
      toEditor: 'Open in the editor with the proposals', toEditorSub: '{n} proposals — accept or reject each', opening: 'Opening…', noEditor: 'To open in the editor the document must be kept under Documents.',
      lvl: { high: 'High', medium: 'Medium', low: 'Low' }, notFound: 'place not found in the text', proposal: 'Proposed wording', addText: 'Text to add',
      lawFound: 'Found in the source word for word', lawNone: 'No source found — this is the AI’s view, check by hand', lawNotSearched: 'No source searched (the first {n} remarks are) — check by hand', lawDropped: '{n} quotes were not in the source and are not shown.',
      partRules: 'The firm rules could not be compared — that part’s unit was returned.', partAnalysis: 'The AI analysis did not come out — that part’s unit was returned.', excerpt: 'Long contract: the parts matching the rules were read.',
      empty: 'None found', st: { ok: 'done', running: 'running', failed: 'failed', skipped: 'not needed', skipped_error: 'failed' }
    }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (v && typeof x === 'string') Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  J.contractText = s;
  var FINAL = ['done', 'failed', 'cancelled', 'budget', 'needs_input'];

  function shell() {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><div class="kicker">AI</div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('sub')) + '</p></div></div><div class="ct-body"></div></div>');
    return $('.ct-body', v);
  }

  /* ---------- tayyorlash ---------- */
  J.viewContract = function () {
    var body = shell();
    var data = { builtin: [], mine: [], firm: [] }, chosen = null, doc = null, quote = null, quoteSeq = 0;
    if (J.docHandoff) { doc = J.docHandoff; J.docHandoff = null; }

    async function load() {
      var r = await J.api('/api/playbooks');
      data = r.ok ? r.data : { builtin: [], mine: [] };
      data.firm = J.firm ? (await J.firm.load(true)).filter(function (x) { return x.kind === 'playbook'; }).map(function (x) { return { id: x.id, name: x.name, description: x.data.description || '', rules: x.data.rules || [] }; }) : [];
      setup(); price();
    }
    function payload() {
      var p = doc.scanId ? { scanId: doc.scanId, name: doc.name } : { text: doc.text, name: doc.name };
      if (chosen && chosen.kind === 'b') p.builtin = chosen.id;
      else if (chosen && chosen.kind === 'f') p.rules = chosen.rules;
      else if (chosen && chosen.kind === 'm') p.playbookId = Number(chosen.id);
      return p;
    }
    function card(p, kind) {
      var id = kind === 'b' ? p.key : p.id, on = chosen && chosen.kind === kind && String(chosen.id) === String(id);
      return '<div class="pb-card' + (on ? ' on' : '') + '" data-k="' + kind + '" data-id="' + esc(id) + '"><b>' + esc(p.name) + '</b><small>' + esc(p.description || '') + '</small><span class="pb-meta">' + (p.rules || []).length + ' ' + esc(s('nRules')) + '</span></div>';
    }
    function group(label, list, kind) { return list.length ? '<p class="muted pb-gh">' + esc(label) + '</p><div class="pb-grid">' + list.map(function (p) { return card(p, kind); }).join('') + '</div>' : ''; }
    function setup() {
      body.innerHTML = '<div class="card" style="margin-bottom:18px"><h4>' + esc(s('doc')) + '</h4><div class="ct-doc" style="margin:10px 0 14px"></div><label class="pill ghost sm" style="cursor:pointer">' + J.icon('up') + esc(s('upload')) + '<input type="file" hidden accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.heic,image/*"></label></div>' +
        '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h4 style="margin:0">' + esc(s('rules')) + '</h4><a class="chip" href="#/playbook">' + esc(s('editRules')) + '</a></div><p class="muted" style="font-size:13px;margin:6px 0 12px">' + esc(s('rulesHint')) + '</p>' +
        '<div class="pb-grid"><div class="pb-card' + (!chosen ? ' on' : '') + '" data-k="n"><b>' + esc(s('none')) + '</b><small>' + esc(s('noneSub')) + '</small></div></div>' +
        group(s('firm'), data.firm, 'f') + group(s('mine'), data.mine, 'm') + group(s('builtin'), data.builtin, 'b') + '</div>' +
        '<div class="ct-price"></div><div class="ct-miss"></div><div style="margin-top:18px"><button class="pill" data-a="run" type="button">' + esc(s('run')) + '<i>→</i></button></div>';
      drawDoc(); drawPrice();
      $$('.pb-card', body).forEach(function (c) {
        c.onclick = function () {
          var kind = c.dataset.k, id = c.dataset.id;
          if (kind === 'n') chosen = null;
          else {
            var p = kind === 'b' ? data.builtin.filter(function (x) { return x.key === id; })[0] : (kind === 'f' ? data.firm : data.mine).filter(function (x) { return String(x.id) === id; })[0];
            chosen = { kind: kind, id: id, name: p.name, rules: p.rules };
          }
          setup(); price();
        };
      });
      $('input[type=file]', body).onchange = async function () {
        var f = this.files[0]; if (!f) return;
        doc = { name: f.name, status: 'reading' }; quote = null; drawDoc(); drawPrice();
        try {
          var r = await J.readFile(f, J.scanConfirm, 'analysis');
          doc.status = 'ok';
          // the library id first: the editor opens the document from the library, never from the page
          var lib = r.docId || r.scanId;
          if (lib) { doc.scanId = lib; doc.chars = r.chars || (r.text ? r.text.length : 0); } else { doc.text = r.text; doc.chars = r.text.length; }
        } catch (e) {
          if (e && e.message === 'cancel') { doc = null; drawDoc(); return; }
          doc.status = 'bad'; doc.error = e && e.message;
        }
        drawDoc(); price();
      };
      $('[data-a=run]', body).onclick = run;
    }
    function drawDoc() {
      var box = $('.ct-doc', body); if (!box) return;
      if (!doc) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="pb-file">' + J.icon('doc') + '<span data-noalpha></span><small class="' + (doc.status === 'bad' ? 'err' : 'muted') + '">' +
        (doc.status === 'ok' ? (doc.chars ? Math.round(doc.chars / 1000) + 'k' : '') : esc(doc.status === 'bad' && doc.error ? doc.error : s(doc.status === 'reading' ? 'reading' : 'bad'))) + '</small></div>';
      $('span', box).textContent = doc.name;
    }
    async function price() {
      if (!doc || doc.status !== 'ok') { quote = null; drawPrice(); return; }
      var seq = ++quoteSeq; quote = { loading: true }; drawPrice();
      var r = await J.api('/api/agent/contract-review/quote', { method: 'POST', body: payload() });
      if (seq !== quoteSeq) return;
      quote = r.ok ? r.data : { error: J.errMsg(r.data) }; drawPrice();
    }
    function drawPrice() {
      var box = $('.ct-price', body); if (!box) return;
      if (!quote) { box.innerHTML = ''; return; }
      if (quote.loading) { box.innerHTML = '<p class="muted" style="margin-top:16px;font-size:14px">' + esc(s('pricing')) + '</p>'; return; }
      if (quote.error) { box.innerHTML = '<p class="err" style="margin-top:16px;font-size:14px">' + esc(quote.error) + '</p>'; return; }
      var parts = quote.parts.map(function (p) { return s(p.key === 'rules' ? 'pR' : 'pA', { n: p.units }); }).join(' + ');
      box.innerHTML = '<div class="note-blue" style="margin-top:16px"><b>' + esc(s('price')) + ': ' + esc(s('units', { n: quote.total })) + '</b>' + (quote.parts.length > 1 ? ' (' + esc(parts) + ')' : '') + '<br><span style="font-size:13px">' + esc(s('priceNote')) + '</span></div>';
    }
    async function run() {
      if (!doc || doc.status !== 'ok') { $('.ct-miss', body).innerHTML = '<div class="note-blue" style="margin-top:14px">' + esc(s('need')) + '</div>'; return; }
      var btn = $('[data-a=run]', body); btn.disabled = true;
      var p = payload(); p.async = true;
      var r = await J.api('/api/agent/contract-review', { method: 'POST', body: p });
      if (r.status === 402) {
        body.innerHTML = '<div class="card"><p>' + esc((r.data && r.data.message) || s('nounit')) + '</p><a class="pill" href="/tariff.html">' + esc(s('plans')) + '<i>→</i></a> <button class="pill ghost" data-a="back" type="button">' + esc(s('again')) + '</button></div>';
        $('[data-a=back]', body).onclick = function () { setup(); price(); }; return;
      }
      if (r.data && r.data.runId && (r.status === 202 || r.ok)) { J.go('#/shartnoma/' + r.data.runId); return; }
      btn.disabled = false;
      $('.ct-miss', body).innerHTML = '<p class="err" style="margin-top:14px">' + esc(J.errMsg(r.data)) + '</p>';
    }
    load();
  };

  /* ---------- ish va natija ---------- */
  J.viewContractRun = function (runId) {
    var body = shell(), alive = true, token = {};
    J.viewContractRun._t = token;
    var live = function () { return alive && J.viewContractRun._t === token && document.body.contains(body); };
    function progress(run) {
      var steps = (run && run.steps) || [];
      body.innerHTML = '<div class="card"><div style="display:flex;gap:12px;align-items:center"><span class="spin"></span><b style="font-weight:500">' + esc(s('working')) + '</b></div>' +
        '<p class="muted" style="font-size:13px;margin:8px 0 12px">' + esc(s('workingSub')) + '</p><ul class="ct-steps">' + steps.map(function (x) {
          return '<li><span>' + esc(x.label || x.id) + '</span><small class="muted">' + esc(s('st')[x.status] || x.status) + '</small></li>';
        }).join('') + '</ul></div>';
    }
    async function poll() {
      progress(null);
      for (var i = 0; i < 600 && live(); i++) {
        var r = await J.api('/api/agent/runs/' + encodeURIComponent(runId));
        if (!live()) return;
        if (r.status === 404) return fail(s('gone'));
        if (r.ok && r.data.workflow !== 'contract_review') return fail(s('gone'));
        if (r.ok && FINAL.indexOf(r.data.status) > -1 && r.data.result) {
          var b = r.data.result.body || {};
          if (!b.report) return fail(b.message || s('failed'));
          return result(b);
        }
        if (r.ok) progress(r.data);
        await J.sleep(2000);
      }
    }
    function fail(msg) {
      body.innerHTML = '<div class="card"><p class="err">' + esc(msg) + '</p><a class="pill ghost" href="#/shartnoma">' + esc(s('again')) + '</a></div>';
      if (J.refreshTariff) J.refreshTariff();
    }
    function chip(text) { return '<span class="ct-chip">' + esc(text) + '</span>'; }
    var copyLabel = (J.playbookText && J.playbookText('copyTxt')) || 'Copy';
    function sug(label, text) { return text ? '<div class="pb-sug"><small class="muted">' + esc(label) + '</small><p>' + esc(text) + '</p><button type="button" class="chip ct-cp">' + J.icon('copy') + esc(copyLabel) + '</button></div>' : ''; }
    function section(title, n, html) { return '<h3 class="ct-h">' + esc(title) + ' <span class="muted">' + n + '</span></h3>' + (html || '<p class="muted" style="font-size:14px">' + esc(s('empty')) + '</p>'); }
    function result(b) {
      var rep = b.report, a = rep.analysis, rl = rep.rules, u = b.units || {};
      var risks = a ? a.risks : [], missing = a ? a.missing : [], comp = a ? a.compliance : [];
      var lvlOrder = { high: 0, medium: 1, low: 2 };
      risks = risks.slice().sort(function (x, y) { return lvlOrder[x.level] - lvlOrder[y.level]; });
      var P = J.playbookText || function (k) { return k; };
      var order = { yoq: 0, farq: 1, noaniq: 2, mos: 3 };
      var rules = rl ? rl.results.slice().sort(function (x, y) { return order[x.status] - order[y.status]; }) : [];
      var proposals = risks.filter(function (x) { return x.found && x.replacement; }).length + missing.filter(function (x) { return x.text; }).length +
        rules.filter(function (x) { return (x.status === 'farq' && x.verified && x.suggestion) || (x.status === 'yoq' && (x.suggestion || (x.rule || {}).preferred)); }).length;
      var searched = comp.filter(function (c) { return c.searched; }).length;
      body.innerHTML = '<div class="note-blue" style="margin-bottom:14px">' + esc(s('note')) + '</div>' +
        (rep.parts.analysis === 'failed' ? '<div class="note-blue" style="margin-bottom:14px">' + esc(s('partAnalysis')) + '</div>' : '') +
        (rep.parts.rules === 'failed' ? '<div class="note-blue" style="margin-bottom:14px">' + esc(s('partRules')) + '</div>' : '') +
        '<div class="card" style="margin-bottom:14px"><b class="ct-name" data-noalpha></b>' + (a && a.docType ? ' <span class="muted">· ' + esc(a.docType) + '</span>' : '') +
        (a && a.summary ? '<p style="font-size:14px;margin:8px 0 14px">' + esc(a.summary) + '</p>' : '<div style="height:12px"></div>') +
        '<div class="kv">' + [[s('risks'), risks.length], [s('missing'), missing.length], [s('law'), comp.length], [s('rulesT'), rl ? (rl.counts.farq + rl.counts.yoq) + ' / ' + rl.results.length : '—']].map(function (x) { return '<div><small>' + esc(x[0]) + '</small><b class="num">' + x[1] + '</b></div>'; }).join('') + '</div>' +
        '<p class="muted" style="font-size:13px;margin:0">' + (a && a.score != null ? esc(s('score')) + ': ' + a.score + ' / 100 · ' : '') + esc(s('charged')) + ': ' + (u.charged || 0) + ' ' + esc(s('unitsShort')) + '</p></div>' +
        '<div class="ct-acts">' + (b.docRef ? '<button class="pill" data-a="editor" type="button">' + J.icon('pen') + esc(s('toEditor')) + '</button>' : '') +
        (J.matterButton ? J.matterButton() : '') + '<a class="pill sm ghost" href="#/shartnoma">' + esc(s('again')) + '</a></div>' +
        '<p class="muted ct-ed-sub" style="font-size:13px;margin:8px 0 0">' + esc(b.docRef ? s('toEditorSub', { n: proposals }) : s('noEditor')) + '</p>' +
        (a ? section(s('risks'), risks.length, risks.map(function (x) {
          return '<div class="pb-res card"><div class="pb-rh"><b>' + esc(x.clause || s('risks')) + '</b>' + chip(s('lvl')[x.level] || x.level) + '</div>' +
            (x.excerpt ? '<blockquote class="tb-q">«' + esc(x.excerpt) + '»' + (x.found ? '' : ' <small class="muted">(' + esc(s('notFound')) + ')</small>') + '</blockquote>' : '') +
            (x.issue ? '<p style="font-size:14px">' + esc(x.issue) + '</p>' : '') + (x.suggestion ? '<p class="muted" style="font-size:14px">' + esc(x.suggestion) + '</p>' : '') + sug(s('proposal'), x.replacement) + '</div>';
        }).join('')) : '') +
        (a ? section(s('missing'), missing.length, missing.map(function (x) {
          return '<div class="pb-res card"><div class="pb-rh"><b>' + esc(x.clause) + '</b>' + chip(s('lvl')[x.importance] || x.importance) + '</div>' + (x.description ? '<p style="font-size:14px">' + esc(x.description) + '</p>' : '') + sug(s('addText'), x.text) + '</div>';
        }).join('')) : '') +
        (a ? section(s('law'), comp.length, comp.map(function (c) {
          var l = c.law;
          return '<div class="pb-res card">' + (c.article ? '<b style="font-weight:500">' + esc(c.article) + '</b>' : '') + '<p style="font-size:14px">' + esc(c.issue) + '</p>' + (c.suggestion ? '<p class="muted" style="font-size:14px">' + esc(c.suggestion) + '</p>' : '') +
            (l ? '<small class="muted">' + esc(s('lawFound')) + '</small><blockquote class="tb-q">«' + esc(l.quote) + '»<br><small>— ' + esc(l.act) + (l.article ? ', ' + esc(l.article) + '-modda' : '') + (l.url ? ' · <a href="' + esc(l.url) + '" target="_blank" rel="noopener">lex.uz ↗</a>' : '') + '</small></blockquote>'
              : '<small class="muted">' + esc(c.searched ? s('lawNone') : s('lawNotSearched', { n: searched || 3 })) + '</small>') + '</div>';
        }).join('') + (rep.lawDropped ? '<p class="muted" style="font-size:13px">' + esc(s('lawDropped', { n: rep.lawDropped })) + '</p>' : '')) : '') +
        (rl ? section(s('rulesT'), rules.length, (rl.excerpt ? '<p class="muted" style="font-size:13px">' + esc(s('excerpt')) + '</p>' : '') + rules.map(function (x) {
          var r0 = x.rule || {};
          return '<div class="pb-res card"><div class="pb-rh"><b>' + esc(r0.title || x.id) + '</b><span class="pb-st st-' + esc(x.status) + '">' + esc((P('st') || {})[x.status] || x.status) + '</span></div>' +
            '<p class="muted" style="font-size:13px;margin:4px 0 10px">' + esc(r0.requirement || '') + '</p>' +
            (x.quote ? '<blockquote class="tb-q">«' + esc(x.quote) + '»' + (x.page ? ' <small class="muted">· ' + x.page + '</small>' : '') + (x.verified ? '' : ' <small class="muted">(' + esc(s('notFound')) + ')</small>') + '</blockquote>' : '') +
            (x.note ? '<p style="font-size:14px">' + esc(x.note) + '</p>' : '') + sug(s('proposal'), x.suggestion) + '</div>';
        }).join('')) : '');
      $('.ct-name', body).textContent = rep.name || '';
      $$('.ct-cp', body).forEach(function (btn) { btn.onclick = function () { navigator.clipboard.writeText(btn.parentNode.querySelector('p').textContent).then(function () { J.toast(J.t('act.copied')); }); }; });
      var ed = $('[data-a=editor]', body);
      if (ed) ed.onclick = async function () {
        ed.disabled = true; var sub = $('.ct-ed-sub', body), was = sub.textContent; sub.textContent = s('opening');
        var r = await J.api('/api/agent/contract-review/' + encodeURIComponent(runId) + '/editor', { method: 'POST', body: {} });
        if (r.ok && r.data.id) { J.go('#/muharrir/' + r.data.id); return; }
        ed.disabled = false; sub.textContent = was; J.toast(J.errMsg(r.data), 6000);
      };
      if (J.wireMatterButton) J.wireMatterButton(body, function () { return { kind: 'agent_run', ref: runId, title: s('title') + (rep.name ? ' — ' + rep.name : '') }; });
      if (J.refreshTariff) J.refreshTariff();
    }
    poll();
    return function () { alive = false; };
  };

  /** U3: "Nima qilaylik?" kartasidan - hujjat qayta yuklanmaydi. */
  J.contractWithDoc = function (f) {
    var lib = f && (f.docId || f.scanId), d = { name: (f && f.name) || 'Hujjat', status: 'ok', chars: (f && f.chars) || (f && f.text ? f.text.length : 0) };
    if (lib) d.scanId = lib; else d.text = f.text;
    J.docHandoff = d; J.go('#/shartnoma');
  };

  J.route(/^\/shartnoma$/, function () { J.viewContract(); });
  J.route(/^\/shartnoma\/([0-9a-f-]{36})$/, function (id) { J.viewContractRun(id); });
})(window);
