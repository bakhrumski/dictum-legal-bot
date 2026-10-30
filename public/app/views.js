/* Bo'limlar: bosh sahifa, hujjat tahlili, hujjat tayyorlash, ko'nikmalar, advokatlar, jamoa, suhbatlar, hisob. */
(function (G) {
  'use strict';
  var J = G.JAI, t = J.t, esc = J.esc, $ = J.$, $$ = J.$$;
  function L(o) { return o && typeof o === 'object' ? (o[J.lang] || o.uz || o.ru || '') : (o || ''); }
  var ROLES = ['citizen', 'biz', 'lawyer', 'acct', 'hr', 'firm'];
  var TASK_IC = { chat: 'chat', explain: 'doc', claim: 'flag', lawyer: 'scale', risk: 'scan', draft: 'pen', opinion: 'book', deadline: 'cal', team: 'team', skills: 'spark' };

  /** Tarifda yo'q imkoniyat */
  J.lockBox = function (planName, text) {
    return '<div class="locked-box">' + J.icon('lock') + '<h3>' + esc(t('lock.title', { p: planName })) + '</h3><p>' + esc(text || '') + '</p><button class="pill" data-a="plans">' + esc(t('lock.btn')) + '</button></div>';
  };
  function bindLock(v) { var b = $('[data-a=plans]', v); if (b) b.onclick = function () { J.openPlans({}); }; }

  /* ================= BOSH SAHIFA ================= */
  J.viewHome = function () {
    J.setTitle(t('nav.home'));
    var hr = new Date().getHours(), greet = hr < 11 ? t('hello.m') : hr < 18 ? t('hello.d') : t('hello.e');
    var name = ((J.S.user && J.S.user.fullName) || '').split(' ')[0];
    var rv = J.roleView ? J.roleView() : null;
    var persona = rv || J.S.persona || 'citizen';
    document.body.classList.toggle('role-view', !!rv);
    // a role view: the role's own page - no field chips, no sub-line, no Telegram banner, three recent chats
    if (rv) {
      // a preview (#/rol/<rol>, this tab) or the client's own view (their field; core.js J.roleAuto)
      var preview = !!J.rolePreview();
      var chips = '<div class="rv-pick"' + (preview || !J.roleChosen() ? '' : ' hidden') + '>' + (preview ? '' : '<span class="rv-pick-t">' + esc(t(J.roleChosen() ? 'roles.label' : 'rv.pick')) + '</span>') +
        (preview ? '' : ROLES.map(function (r) { return '<button type="button" class="chip' + (r === rv ? ' on' : '') + '" data-r="' + r + '">' + esc(t('role.' + r)) + '</button>'; }).join('')) + '</div>';
      var bar = preview
        ? '<div class="rv-bar"><span class="rv-tag">' + esc(t('rv.badge')) + ' <b>' + esc(t('role.' + rv)) + '</b></span><a href="#/rol">' + esc(t('rv.other')) + '</a><a href="#/rol/chiqish">' + esc(t('rv.exit')) + '</a></div>'
        : (J.roleChosen() ? '<div class="rv-bar"><span class="rv-tag">' + esc(t('roles.label')) + ': <b>' + esc(t('role.' + rv)) + '</b></span><button type="button" class="link rv-change">' + esc(t('rv.change')) + '</button><a href="#/rol/hammasi">' + esc(t('rv.all')) + '</a></div>' : '') + chips;
      var lean = J.mount('<div class="home rh">' + bar +
        '<h1 class="hello"></h1><div class="cmp-host"></div><p class="hint">' + esc(t('cmp.hint')) + '</p>' +
        '<div class="tasks"></div><div class="recent"><h3>' + esc(t('recent')) + '</h3><div class="rows"></div></div></div>');
      $('.hello', lean).textContent = greet + (name ? ', ' + name : '') + '.';
      var lc = J.composer($('.cmp-host', lean), { menuDown: true, placeholder: t('rv.ph.' + rv), onSend: function (p) { J.startChat(p); } });
      J.homeComposer = lc;
      var list = t('tasks.' + rv).slice(0, 4);
      $('.tasks', lean).innerHTML = list.map(function (x, i) {
        return '<button class="task" data-i="' + i + '"><span class="ti">' + J.icon(TASK_IC[x[0]] || 'spark') + '</span><span><b>' + esc(x[1]) + '</b><small>' + esc(x[2]) + '</small></span></button>';
      }).join('');
      $$('.task', lean).forEach(function (b) {
        b.onclick = function () {
          var x = list[+b.dataset.i], k = x[0];
          if (k === 'chat') { lc.setText(x[3] || ''); return; }
          if (k === 'lawyer') return J.go('#/advokatlar');
          if (k === 'draft') return J.go('#/tayyorlash');
          if (k === 'claim') return J.go('#/tayyorlash?type=claim');
          if (k === 'team') return J.go('#/jamoa');
          if (k === 'skills') return J.go('#/konikmalar');
          lc.setSkill(k);
        };
      });
      var drawLeanRecent = function () {
        var rows = (J.S.sessions || []).slice(0, 3);
        $('.rows', lean).innerHTML = rows.length ? rows.map(function (s) { return '<div class="row" data-id="' + esc(s.id) + '">' + J.icon('chat') + '<span>' + esc(s.title || s.first_message || '—') + '</span><small>' + esc(J.fmtDate(s.updated_at || s.created_at)) + '</small></div>'; }).join('')
          : '<div class="empty-state" style="padding:18px 4px;text-align:left">' + esc(t('hist.empty')) + '</div>';
        $$('.row', lean).forEach(function (r) { r.onclick = function () { J.go('#/c/' + r.dataset.id); }; });
      };
      drawLeanRecent(); J.on('sessions', function () { if (document.body.contains(lean)) drawLeanRecent(); });
      // the client's field: picked here, saved as their type (grants nothing), the view follows it
      var ch = $('.rv-change', lean); if (ch) ch.onclick = function () { var pk = $('.rv-pick', lean); pk.hidden = !pk.hidden; };
      $$('.rv-pick [data-r]', lean).forEach(function (b) {
        b.onclick = function () { J.setPersona(b.dataset.r, true); J.redrawNav(); J.viewHome(); };
      });
      lc.focus();
      return;
    }
    var v = J.mount('<div class="home">' +
      '<h1 class="hello"></h1><p class="hello-sub">' + esc(t('hello.sub')) + '</p>' +
      '<div class="cmp-host"></div><p class="hint">' + esc(t('cmp.hint')) + '</p>' +
      '<div class="roles"><span class="kicker">' + esc(t('roles.label')) + '</span>' + ROLES.map(function (r) { return '<button class="chip' + (r === persona ? ' on' : '') + '" data-r="' + r + '">' + esc(t('role.' + r)) + '</button>'; }).join('') +
        // a client who opened every section can go back to their field's simpler view
        (J.S.user && J.S.user.role === 'user' && J.roleFull() ? '<a class="rv-back" href="#/rol/sodda">' + esc(t('rv.lean')) + '</a>' : '') + '</div>' +
      '<div class="tasks"></div><div class="tg-host"></div>' +
      '<div class="recent"><h3>' + esc(t('recent')) + '</h3><div class="rows"></div></div></div>');
    $('.hello', v).textContent = greet + (name ? ', ' + name : '') + '.';
    var cmp = J.composer($('.cmp-host', v), { menuDown: true, onSend: function (p) { J.startChat(p); } });
    J.homeComposer = cmp;
    if (!J.isStaff()) J.tg.banner($('.tg-host', v));
    function drawTasks() {
      var list = t('tasks.' + (J.S.persona || 'citizen'));
      $('.tasks', v).innerHTML = list.map(function (x, i) {
        var locked = (x[0] === 'draft' || x[0] === 'claim') && !J.hasService('draft') && !J.needsPlan();
        return '<button class="task" data-i="' + i + '"><span class="ti">' + J.icon(TASK_IC[x[0]] || 'spark') + '</span><span><b>' + esc(x[1]) + '</b><small>' + esc(x[2]) + '</small></span>' + (locked ? '<span class="lk">' + J.icon('lock') + '</span>' : '') + '</button>';
      }).join('');
      $$('.task', v).forEach(function (b) {
        b.onclick = function () {
          var x = list[+b.dataset.i], k = x[0];
          if (k === 'chat') { cmp.setText(x[3] || ''); return; }
          if (k === 'lawyer') return J.go('#/advokatlar');
          if (k === 'draft') return J.go('#/tayyorlash');
          if (k === 'claim') return J.go('#/tayyorlash?type=claim');
          if (k === 'team') return J.go('#/jamoa');
          if (k === 'skills') return J.go('#/konikmalar');
          if (k === 'risk' || k === 'opinion' || k === 'explain') { cmp.setSkill(k); return; }
          if (k === 'deadline') { cmp.setSkill('deadline'); return; }
        };
      });
    }
    $$('[data-r]', v).forEach(function (b) {
      b.onclick = function () { J.setPersona(b.dataset.r, true); $$('[data-r]', v).forEach(function (x) { x.classList.toggle('on', x === b); }); drawTasks(); };
    });
    function drawRecent() {
      var rows = (J.S.sessions || []).slice(0, 5);
      $('.rows', v).innerHTML = rows.length ? rows.map(function (s) { return '<div class="row" data-id="' + esc(s.id) + '">' + J.icon('chat') + '<span>' + esc(s.title || s.first_message || '—') + '</span><small>' + esc(J.fmtDate(s.updated_at || s.created_at)) + '</small></div>'; }).join('')
        : '<div class="empty-state" style="padding:18px 4px;text-align:left">' + esc(t('hist.empty')) + '</div>';
      $$('.row', v).forEach(function (r) { r.onclick = function () { J.go('#/c/' + r.dataset.id); }; });
    }
    drawTasks(); drawRecent(); J.on('sessions', function () { if (document.body.contains(v)) drawRecent(); });
    cmp.focus();
  };

  /* ================= ROLLAR BO'YICHA KO'RINISH (#/rol) ================= */
  J.viewRoles = function () {
    J.setTitle(t('rv.title'));
    var cur = J.roleView ? J.roleView() : null;
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(t('rv.title')) + '</h2><p>' + esc(t('rv.lead')) + '</p></div></div><div class="rv-grid"></div>' +
      (cur ? '<p style="margin-top:18px"><a class="pill ghost" href="#/rol/chiqish">' + esc(t('rv.exit')) + '</a></p>' : '') + '</div>');
    $('.rv-grid', v).innerHTML = ROLES.map(function (r) {
      var n = J.ROLE_VIEWS[r].nav.length;
      return '<a class="card rv-card' + (r === cur ? ' on' : '') + '" href="#/rol/' + J.ROLE_VIEWS[r].slug + '"><b>' + esc(t('role.' + r)) + '</b><small class="muted">' + esc(t('rv.sections', { n: n })) + '</small></a>';
    }).join('');
  };

  /* ================= HUJJAT TAHLILI ================= */
  var SVC_PLAN = { analysis: 'analysis', explain: 'analysis', opinion: 'opinion' };
  J.viewAnalyze = function () {
    J.setTitle(t('nav.analyze'));
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(t('an.title')) + '</h2><p>' + esc(t('an.sub')) + '</p></div></div><div class="an-body"></div></div>');
    var body = $('.an-body', v), doc = null, file = null;
    function stepDrop() {
      doc = null; file = null;
      // many documents at once: the tabular review (tabular.js)
      var tableCard = J.tabularText ? '<div class="card" style="margin-bottom:18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:220px"><h4>' + J.icon('layers') + ' ' + esc(J.tabularText('entry')) + '</h4><p class="muted" style="font-size:14px">' + esc(J.tabularText('sub')) + '</p></div><a class="pill ghost" href="#/jadval">' + esc(J.tabularText('open')) + '<i>→</i></a></div>' : '';
      var pbCard = J.playbookText ? '<div class="card" style="margin-bottom:18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:220px"><h4>' + J.icon('flag') + ' ' + esc(J.playbookText('entry')) + '</h4><p class="muted" style="font-size:14px">' + esc(J.playbookText('sub')) + '</p></div><a class="pill ghost" href="#/playbook">' + esc(J.playbookText('open')) + '<i>→</i></a></div>' : '';
      body.innerHTML = tableCard + pbCard + '<label class="drop"><span class="drop-ic">' + J.icon('up') + '</span><b>' + esc(t('an.drop')) + '</b><small>' + esc(t('an.types')) + '</small><span class="pill sm ghost drop-btn">' + esc(t('an.pick')) + '</span><input type="file" hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,image/*"></label>' +
        (J.pickDocs ? '<div style="text-align:center;margin:10px 0 4px"><button class="chip" type="button" data-a="anlib">' + J.icon('folder') + esc(t('nav.docs')) + '</button></div>' : '') +
        '<div class="an-gets">' + t('an.gets').map(function (x, i) { return '<div class="an-get"><span class="an-gi">' + J.icon(['flag', 'doc', 'scale'][i]) + '</span><div><b>' + esc(x[0]) + '</b><small>' + esc(x[1]) + '</small></div></div>'; }).join('') + '</div>';
      var drop = $('.drop', body), inp = $('input', body);
      inp.onchange = function () { if (inp.files[0]) take(inp.files[0]); };
      // an earlier upload from "Hujjatlarim": used by its id, no second upload or OCR
      var lib = $('[data-a=anlib]', body);
      if (lib) lib.onclick = function () {
        J.pickDocs({ max: 1 }).then(function (p) { if (!p.length) return; file = null; doc = { name: p[0].name, scanId: p[0].scanId, pages: p[0].pages, chars: p[0].chars, fromLibrary: true }; stepChoose(); });
      };
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
      drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); });
    }
    async function take(f) {
      file = f;
      var isImg = /\.(png|jpe?g|webp|heic|tiff?)$/i.test(f.name) || /^image\//.test(f.type || '');
      body.innerHTML = '<div class="card" style="display:flex;gap:12px;align-items:center"><span class="spin"></span><span>' + esc(t('an.reading')) + ' — ' + esc(f.name) + '</span></div>';
      if (isImg) { doc = { name: f.name, scan: true }; return stepChoose(); }
      var fd = new FormData(); fd.append('file', f);
      var r = await J.api('/api/analyze/extract', { method: 'POST', body: fd });
      if (!r.ok) { J.toast(J.errMsg(r.data)); return stepDrop(); }
      if (r.data.scanned || !(r.data.text || '').trim()) { doc = { name: f.name, scan: true, pages: r.data.pageCount }; return stepChoose(); }
      doc = { name: f.name, text: r.data.text, docTicket: r.data.docTicket || null, pages: r.data.pageCount || null, chars: r.data.charCount || r.data.text.length, units: r.data.units || null };
      stepChoose();
    }
    function stepChoose() {
      var info = doc.scan ? '' : t('an.pages', { p: doc.pages || '—', c: J.fmtNum(doc.chars), u: doc.units || '—' });
      body.innerHTML = '<div class="card" style="display:flex;gap:12px;align-items:center;margin-bottom:18px">' + J.icon('doc') + '<div style="flex:1;min-width:0"><b style="font-weight:500">' + esc(doc.name) + '</b><div class="muted" style="font-size:13px">' + esc(info) + '</div></div><button class="pill sm ghost" data-a="again">' + esc(t('an.again')) + '</button></div>' +
        '<div class="kicker" style="margin-bottom:10px">' + esc(t('an.choose')) + '</div><div class="grid3">' +
        ['analysis', 'explain', 'opinion'].map(function (s) {
          var ok = J.hasService(SVC_PLAN[s]);
          return '<button class="tile" data-s="' + s + '"><div class="tile-h">' + J.icon(s === 'analysis' ? 'scan' : s === 'explain' ? 'doc' : 'book') + (ok ? '' : J.icon('lock')) + '</div><b>' + esc(t('an.s.' + s)) + '</b><p>' + esc(t('an.s.' + s + '.d')) + '</p></button>';
        }).join('') + '</div><div class="an-quote" style="margin-top:16px"></div>';
      $('[data-a=again]', body).onclick = stepDrop;
      $$('[data-s]', body).forEach(function (b) { b.onclick = function () { $$('[data-s]', body).forEach(function (x) { x.style.borderColor = x === b ? 'var(--fg)' : ''; }); quote(b.dataset.s); }; });
    }
    async function quote(s) {
      var q = $('.an-quote', body);
      if (!J.hasService(SVC_PLAN[s])) { q.innerHTML = J.lockBox('Silver'); bindLock(q); return; }
      q.innerHTML = '<span class="spin"></span>';
      var units = null, remaining = null, msg = '';
      if (doc.scan && !doc.scanId) {
        var fq = new FormData(); fq.append('file', file); fq.append('service', SVC_PLAN[s]);
        var sq = await J.api('/api/analyze/scan-quote', { method: 'POST', body: fq });
        if (!sq.ok) { q.innerHTML = '<p class="err"></p>'; $('p', q).textContent = J.errMsg(sq.data); return; }
        doc.scanQuote = sq.data; units = sq.data.units; remaining = sq.data.remainingAfter; msg = sq.data.message || t('an.scan', { p: sq.data.pages, u: sq.data.units });
      } else {
        // a library document: its size as the server measured it at upload (the charge itself is signed on the run)
        var r = await J.api('/api/tariff/quote', { method: 'POST', body: doc.fromLibrary ? { service: SVC_PLAN[s], pages: doc.pages, chars: doc.chars } : { service: SVC_PLAN[s], text: doc.text, docTicket: doc.docTicket } });
        if (r.ok && !r.data.unlimited) {
          if (r.data.fits === false) { q.innerHTML = '<div class="note warn"></div>'; $('.note', q).textContent = t('an.toobig', { p: r.data.size && r.data.size.pages, m: r.data.maxPages }); return; }
          units = r.data.units; remaining = r.data.remainingAfter; msg = t('an.cost', { u: units, r: remaining });
        }
      }
      q.innerHTML = '<div class="card"><p class="muted" style="font-size:14px"></p><div class="btns"><button class="pill" data-a="run">' + esc(t('an.run')) + '<i>→</i></button></div></div>';
      $('p', q).textContent = msg || '';
      $('[data-a=run]', q).onclick = function () { run(s); };
    }
    async function run(s) {
      body.innerHTML = '<div class="card" style="display:flex;gap:12px;align-items:center"><span class="spin"></span><span>' + esc(t('an.running')) + '</span></div>';
      // skan bo'lsa: avval OCR (tasdiqlangan)
      if (doc.scan && !doc.scanId) {
        var fo = new FormData(); fo.append('file', file); fo.append('scanTicket', doc.scanQuote.scanTicket); fo.append('confirmed', 'true');
        var o = await J.api('/api/analyze/ocr-image', { method: 'POST', body: fo });
        if (!o.ok) { J.toast(J.errMsg(o.data)); return stepChoose(); }
        doc.scanId = o.data.scanId;
      }
      var r;
      if (s === 'analysis') r = await J.api('/api/analyze', { method: 'POST', body: doc.scanId ? { scanIds: [doc.scanId], langHint: J.lang, confirmed: true } : { text: doc.text, docTicket: doc.docTicket, langHint: J.lang, confirmed: true } });
      else if (s === 'explain') r = await J.api('/api/draft/explain-document', { method: 'POST', body: doc.scanId ? { scanIds: [doc.scanId], confirmed: true } : { documentText: doc.text, docTicket: doc.docTicket, confirmed: true } });
      else r = await J.api('/api/draft/legal-opinion', { method: 'POST', body: doc.scanId ? { scanId: doc.scanId, confirmed: true } : { documentText: doc.text, docTicket: doc.docTicket, confirmed: true } });
      J.refreshTariff();
      if (!r.ok) { if (!J.handleLimit(r.data)) J.toast(J.errMsg(r.data)); return stepChoose(); }
      if (s === 'analysis') showAnalysis(r.data); else if (s === 'explain') showMd(r.data); else showOpinion(r.data);
    }
    function head(title) {
      return '<div class="vh" style="margin-bottom:16px"><div><div class="kicker">' + esc(doc.name) + '</div><h2 style="font-size:24px;margin-top:6px">' + esc(title) + '</h2></div><div style="display:flex;gap:8px"><button class="pill sm ghost" data-a="word">' + J.icon('word') + esc(t('dr.export')) + '</button><button class="pill sm ghost" data-a="again">' + esc(t('an.again')) + '</button></div></div>';
    }
    function showAnalysis(d) {
      var a = d.analysis || {};
      if (d.parseError || !d.analysis) return showMd({ reply: d.raw || '' });
      var lvl = function (x) { var k = String(x || '').toLowerCase(); var c = k === 'high' ? 'bad' : k === 'medium' ? 'warn' : 'ok'; return '<span class="tag"><span class="dot ' + c + '"></span>' + esc(t('lv.' + (k === 'high' || k === 'medium' ? k : 'low'))) + '</span>'; };
      var html = head(t('an.s.analysis')) +
        '<div class="kv"><div><small>' + esc(t('an.risks')) + '</small><b class="num">' + a.riskItems.length + '</b></div><div><small>' + esc(t('an.missing')) + '</small><b class="num">' + a.missingClauses.length + '</b></div><div><small>' + esc(t('an.compliance')) + '</small><b class="num">' + a.complianceIssues.length + '</b></div>' +
        (a.overallScore != null ? '<div><small>' + esc(t('an.score')) + '</small><b class="num">' + esc(a.overallScore) + '/100</b></div>' : '<div><small>' + esc(t('an.strengths')) + '</small><b class="num">' + a.strengths.length + '</b></div>') + '</div>' +
        (a.summary ? '<div class="card" style="margin-bottom:18px"><h4>' + esc(t('an.summary')) + '</h4><p>' + esc(a.summary) + '</p></div>' : '') +
        (a.riskItems.length ? '<h3 style="font-size:17px;margin:22px 0 10px">' + esc(t('an.risks')) + '</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(t('an.level')) + '</th><th>' + esc(t('an.clause')) + '</th><th>' + esc(t('an.issue')) + '</th><th>' + esc(t('an.rec')) + '</th></tr></thead><tbody>' +
          a.riskItems.map(function (x) { return '<tr><td>' + lvl(x.level) + '</td><td><b style="font-weight:500">' + esc(x.clause) + '</b>' + (x.excerpt ? '<div class="muted" style="font-size:12.5px;margin-top:4px">«' + esc(x.excerpt) + '»</div>' : '') + '</td><td>' + esc(x.issue) + '</td><td>' + esc(x.suggestion) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        (a.missingClauses.length ? '<h3 style="font-size:17px;margin:26px 0 10px">' + esc(t('an.missing')) + '</h3><div class="tbl-wrap"><table class="tbl"><tbody>' + a.missingClauses.map(function (x) { return '<tr><td style="width:130px">' + lvl(x.importance) + '</td><td><b style="font-weight:500">' + esc(x.clause) + '</b><div class="muted" style="font-size:13px">' + esc(x.description) + '</div></td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        (a.complianceIssues.length ? '<h3 style="font-size:17px;margin:26px 0 10px">' + esc(t('an.compliance')) + '</h3><div class="tbl-wrap"><table class="tbl"><tbody>' + a.complianceIssues.map(function (x) { return '<tr><td style="width:200px"><b style="font-weight:500">' + esc(x.article) + '</b></td><td>' + esc(x.issue) + '<div class="muted" style="font-size:13px;margin-top:4px">' + esc(x.suggestion) + '</div></td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        (a.strengths.length ? '<h3 style="font-size:17px;margin:26px 0 10px">' + esc(t('an.strengths')) + '</h3><ul class="muted">' + a.strengths.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        '<p class="hint" style="text-align:left;margin-top:24px">' + esc(t('cmp.hint')) + '</p>';
      body.innerHTML = html;
      $('[data-a=again]', body).onclick = stepDrop;
      $('[data-a=word]', body).onclick = function () { J.exportWord(doc.name + ' — ' + t('an.s.analysis'), body.innerHTML.replace(/<div class="vh"[\s\S]*?<\/div><\/div><\/div>/, '')); };
    }
    function showMd(d) {
      var r = J.md(d.reply || '');
      body.innerHTML = head(t('an.s.explain')) + (d.partial ? '<div class="note warn" style="margin-bottom:14px">⚠</div>' : '') + '<div class="card"><div class="md">' + r.html + '</div></div><p class="hint" style="text-align:left;margin-top:18px">' + esc(t('cmp.hint')) + '</p>';
      $('[data-a=again]', body).onclick = stepDrop;
      $('[data-a=word]', body).onclick = function () { J.exportWord(doc.name, r.html); };
    }
    function showOpinion(d) {
      var clean = J.cleanHtml(d.html || '');
      body.innerHTML = head(t('an.s.opinion')) + (d.partial ? '<div class="note warn" style="margin-bottom:14px">⚠</div>' : '') + '<div class="card"><div class="md op"></div></div>';
      $('.op', body).innerHTML = clean;
      $('[data-a=again]', body).onclick = stepDrop;
      $('[data-a=word]', body).onclick = function () { J.exportWord(doc.name + ' — ' + t('an.s.opinion'), clean); };
    }
    // V4: "shu hujjatni tahlil qil" from the chat brings its document here
    if (J.analyzePrefill) { doc = J.analyzePrefill; J.analyzePrefill = null; stepChoose(); } else stepDrop();
  };

  /* ================= HUJJAT TAYYORLASH ================= */
  J.viewDraft = function (query) {
    J.setTitle(t('nav.draft'));
    var q = new URLSearchParams(query || '');
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(t('dr.title')) + '</h2><p>' + esc(t('dr.sub')) + '</p></div></div><div class="dr-body"></div></div>');
    var body = $('.dr-body', v);
    if (!J.hasService('draft')) { body.innerHTML = J.lockBox('Silver', t('pl.f.draft', { n: '10+' })); bindLock(body); return; }
    // a next step chosen under a chat answer (or a recording): kept for the whole visit, so "back" from a result keeps it
    var pre = J.draftPrefill; J.draftPrefill = null;
    function home() {
      // the claim-draft agent (agent.js): step by step, quotes checked against lex.uz
      var agentCard = J.agentText ? '<div class="card" style="margin-bottom:18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:220px"><h4>' + J.icon('scale') + ' ' + esc(J.agentText('title')) + '</h4><p class="muted" style="font-size:14px">' + esc(J.agentText('sub')) + '</p></div><a class="pill" href="#/agent/dava">' + esc(J.agentText('entry')) + '<i>→</i></a></div>' : '';
      var aiCard = '<div class="card" style="margin-bottom:' + (pre ? '18' : '26') + 'px"><h4>' + J.icon('spark') + ' ' + esc(t('dr.ai')) + '</h4><p class="muted" style="font-size:14px;margin-bottom:14px">' + esc(t('dr.ai.d')) + '</p>' +
        (pre ? '<div class="note-blue dr-cont" style="font-size:13.5px;margin-bottom:14px"><b>' + esc(t('dr.cont')) + ':</b> <span class="dr-cont-a"></span><br>' + esc(t('dr.cont.d')) + '</div>' : '') +
        '<div class="field"><label>' + esc(t('dr.type')) + '</label><input class="inp" data-f="type" placeholder="' + esc(t('dr.type.ph')) + '"></div>' +
        '<div class="field"><label>' + esc(t('dr.details')) + '</label><textarea class="inp" data-f="det" placeholder="' + esc(t(pre ? 'dr.cont.ph' : 'dr.details.ph')) + '"></textarea></div>' +
        '<button class="pill" data-a="gen">' + esc(t('dr.gen')) + '<i>→</i></button></div>';
      // from a chat: the way back first, and the AI card (the step chosen there) above the agent card
      body.innerHTML = (pre && pre.from ? '<button class="chip" data-a="backchat" type="button" style="margin-bottom:16px">' + J.icon('back') + esc(t('dr.backchat')) + '</button>' : '') +
        (pre ? aiCard + agentCard : agentCard + aiCard) +
        '<div class="tabs"><button class="on" data-tab="all">' + esc(t('dr.templates')) + '</button><button data-tab="mine">' + esc(t('dr.mine')) + '</button></div>' +
        '<div class="dr-up" hidden></div>' +
        '<div class="search" style="margin-bottom:14px">' + J.icon('search') + '<input class="inp" data-f="q" placeholder="' + esc(t('dr.search')) + '"></div><div class="grid3 tpl-list"><div class="skel"></div></div>';
      var bc = $('[data-a=backchat]', body);
      if (bc) bc.onclick = function () { J.go(pre.from); };
      if (pre) { $('[data-f=type]', body).value = pre.type || ''; $('[data-f=det]', body).value = ''; $('.dr-cont-a', body).textContent = pre.action || pre.type || ''; }
      else if (q.get('type') === 'claim') $('[data-f=type]', body).value = J.lang === 'ru' ? 'Претензия' : J.lang === 'en' ? 'Demand letter' : 'Talabnoma';
      $('[data-a=gen]', body).onclick = function () { gen(pre); };
      var all = [], tab = 'all';
      $$('[data-tab]', body).forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; $$('[data-tab]', body).forEach(function (x) { x.classList.toggle('on', x === b); }); $('.dr-up', body).hidden = tab !== 'mine'; draw(); }; });
      // own templates from this computer (POST /api/templates/analyze -> review -> /api/templates/mine)
      $('.dr-up', body).innerHTML = '<div class="card" style="margin-bottom:14px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><p class="muted" style="font-size:14px;flex:1;min-width:220px;margin:0">' + esc(t('dr.upload.d')) + '</p>' +
        '<label class="pill" style="cursor:pointer">' + J.icon('plus') + esc(t('dr.upload')) + '<input type="file" accept=".docx,.doc,.pdf" hidden data-f="tplfile"></label></div>';
      $('[data-f=tplfile]', body).onchange = function () { var f = this.files[0]; this.value = ''; if (f) uploadTpl(f, function () { J.api('/api/templates').then(function (r) { all = r.ok ? (r.data.templates || []) : []; draw(); }); }); };
      $('[data-f=q]', body).oninput = draw;
      function draw() {
        var s = ($('[data-f=q]', body).value || '').toLowerCase();
        var list = all.filter(function (x) { return (tab === 'mine' ? x.isMine : true) && (!s || (L(x.name) + ' ' + L(x.description)).toLowerCase().indexOf(s) > -1); });
        $('.tpl-list', body).innerHTML = list.length ? list.map(function (x) {
          return '<button class="tile" data-id="' + esc(x.slug || x.id) + '"><div class="tile-h">' + J.icon('doc') + esc(x.category || '') + '</div><b>' + esc(L(x.name)) + '</b><p>' + esc(L(x.description)) + '</p><div class="tile-f"><span class="tag">' + (x.fieldCount || 0) + ' ·</span>' + (x.isMine ? J.scopeTag('p') + ' <span class="pill sm ghost" role="button" tabindex="0" data-del="' + esc(x.id) + '" aria-label="' + esc(t('dr.del')) + '" style="margin-left:auto">' + J.icon('trash') + '</span>' : '') + '</div></button>';
        }).join('') : '<div class="empty-state">' + esc(tab === 'mine' ? t('dr.mine.empty') : '—') + '</div>';
        $$('.tile', body).forEach(function (b) { b.onclick = function (e) { if (e.target.closest('[data-del]')) return; openTpl(b.dataset.id); }; });
        $$('[data-del]', body).forEach(function (d) {
          d.onclick = async function (e) {
            e.stopPropagation();
            if (!(await J.confirm(t('dr.del.q'), t('dr.del')))) return;
            var r = await J.api('/api/templates/mine/' + encodeURIComponent(d.dataset.del), { method: 'DELETE' });
            if (!r.ok) { J.toast(J.errMsg(r.data)); return; }
            all = all.filter(function (x) { return String(x.id) !== String(d.dataset.del); }); draw();
          };
        });
      }
      J.api('/api/templates').then(function (r) { all = r.ok ? (r.data.templates || []) : []; draw(); });
    }
    async function gen(pre) {
      var type = $('[data-f=type]', body).value.trim(), det = $('[data-f=det]', body).value.trim();
      // continuing a chat: the question and answer are the details; extra lines are optional
      if (!det && pre) det = t('dr.cont.none');
      if (!type || !det) { J.toast(t('dr.details.ph')); return; }
      var btn = $('[data-a=gen]', body); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      var r = await J.api('/api/draft/ai-generate', { method: 'POST', body: { docType: type, details: det, continuation: pre ? { question: pre.question, answer: pre.answer, selectedAction: pre.action } : null } });
      J.refreshTariff();
      if (!r.ok) { btn.disabled = false; btn.textContent = t('dr.gen'); if (!J.handleLimit(r.data)) J.toast(J.errMsg(r.data)); return; }
      result(type, r.data.html || '');
    }
    function result(title, html) {
      var clean = J.cleanHtml(html);
      body.innerHTML = '<div class="vh" style="margin-bottom:14px"><div><div class="kicker">' + esc(t('dr.result')) + '</div><h2 style="font-size:24px;margin-top:6px"></h2></div><div style="display:flex;gap:8px"><button class="pill sm" data-a="word">' + J.icon('word') + esc(t('dr.export')) + '</button>' + (J.openInEditor ? '<button class="pill sm ghost" data-a="ed">' + J.icon('pen') + esc(t('dr.editor')) + '</button>' : '') + '<button class="pill sm ghost" data-a="back">' + esc(t('dr.back')) + '</button></div></div><div class="card"><div class="md doc" contenteditable="true" spellcheck="false"></div></div>';
      $('h2', body).textContent = title; $('.doc', body).innerHTML = clean;
      $('[data-a=back]', body).onclick = home;
      $('[data-a=word]', body).onclick = function () { J.exportWord(title, $('.doc', body).innerHTML); };
      var edb = $('[data-a=ed]', body); if (edb) edb.onclick = function () { edb.disabled = true; J.openInEditor(title, $('.doc', body).innerHTML); };
    }
    async function uploadTpl(file, done) {
      var m = J.modal({ cls: 'sm', html: '<h2>' + esc(t('dr.upload')) + '</h2><div style="display:flex;gap:10px;align-items:center;margin-top:14px"><span class="spin"></span>' + esc(t('dr.upload.busy')) + '</div>' });
      var fd = new FormData(); fd.append('file', file);
      var r = await J.api('/api/templates/analyze', { method: 'POST', body: fd });
      J.refreshTariff && J.refreshTariff();
      if (!r.ok) { m.close(); if (!J.handleLimit(r.data)) J.toast(J.errMsg(r.data), 6000); return; }
      var tpl = r.data.template || {}, fields = Array.isArray(tpl.fields) ? tpl.fields.slice() : [];
      m.close();
      var mm = J.modal({ html: '<h2>' + esc(t('dr.upload.review')) + '</h2><p class="muted" style="font-size:13px"></p>' +
        '<div class="field" style="margin-top:12px"><label>' + esc(t('dr.upload.name')) + '</label><input class="inp" data-f="tn" maxlength="120"></div>' +
        '<h4 style="margin:14px 0 6px">' + esc(t('dr.upload.fields')) + '</h4><div class="dr-ff"></div>' +
        '<h4 style="margin:16px 0 6px">' + esc(t('dr.upload.preview')) + '</h4><div class="card" style="max-height:260px;overflow:auto"><div class="md doc dr-pv"></div></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="pill ghost" type="button" data-a="no">' + esc(J.t('cancel')) + '</button><button class="pill" type="button" data-a="ok">' + esc(t('dr.upload.save')) + '</button></div>' });
      $('p.muted', mm.body).textContent = file.name;
      $('[data-f=tn]', mm.body).value = L(tpl.name) || file.name.replace(/\.[^.]+$/, '');
      $('.dr-pv', mm.body).innerHTML = J.cleanHtml(String(tpl.body || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, '[$1]'));
      function drawFields() {
        $('.dr-ff', mm.body).innerHTML = fields.length ? fields.map(function (f, i) {
          return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><input class="inp" data-fl="' + i + '" maxlength="80" style="flex:1"><small class="muted">' + esc(f.type || 'text') + '</small><button class="pill sm ghost" type="button" data-fx="' + i + '" aria-label="' + esc(t('dr.del')) + '">×</button></div>';
        }).join('') : '<p class="muted" style="font-size:13px">' + esc(t('dr.upload.nofields')) + '</p>';
        fields.forEach(function (f, i) { $('[data-fl="' + i + '"]', mm.body).value = L(f.label) || f.key; });
        $$('[data-fl]', mm.body).forEach(function (el) { el.oninput = function () { var f = fields[+el.dataset.fl]; f.label = { uz: el.value, ru: (f.label && f.label.ru) || el.value }; }; });
        $$('[data-fx]', mm.body).forEach(function (b) { b.onclick = function () { fields.splice(+b.dataset.fx, 1); drawFields(); }; });
      }
      drawFields();
      $('[data-a=no]', mm.body).onclick = function () { mm.close(); };
      $('[data-a=ok]', mm.body).onclick = async function () {
        var name = $('[data-f=tn]', mm.body).value.trim(); if (!name) { $('[data-f=tn]', mm.body).focus(); return; }
        // a removed field stays in the text as its own placeholder, so nothing of the document is lost
        var keep = {}; fields.forEach(function (f) { keep[f.key] = 1; });
        var bodyHtml = String(tpl.body || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, function (m0, k) { return keep[k] ? m0 : '[' + k + ']'; });
        var b = this; b.disabled = true;
        var s2 = await J.api('/api/templates/mine', { method: 'POST', body: { name: { uz: name, ru: (tpl.name && tpl.name.ru) || name }, description: tpl.description || { uz: '', ru: '' }, category: tpl.category || 'boshqa', lang: tpl.lang || 'uz', fields: fields, body: bodyHtml } });
        b.disabled = false;
        if (!s2.ok) { J.toast(J.errMsg(s2.data), 6000); return; }
        mm.close(); J.toast(t('dr.upload.saved')); done();
      };
    }
    async function openTpl(id) {
      body.innerHTML = '<div class="skel"></div>';
      var r = await J.api('/api/templates/' + encodeURIComponent(id));
      if (!r.ok) { J.toast(J.errMsg(r.data)); return home(); }
      var tpl = r.data, fields = tpl.fields || [];
      body.innerHTML = '<button class="chip" data-a="back" style="margin-bottom:16px">' + J.icon('back') + esc(t('dr.back')) + '</button><h3 style="font-size:22px;margin-bottom:6px"></h3><p class="muted" style="margin-bottom:18px"></p><div class="card"><div class="kicker" style="margin-bottom:12px">' + esc(t('dr.fields')) + '</div><form class="tpl-f"></form><div class="btns"><button class="pill" data-a="docx">' + J.icon('word') + esc(t('dr.export')) + '</button><button class="pill ghost" data-a="pdf">' + esc(t('dr.pdf')) + '</button></div></div>';
      $('h3', body).textContent = L(tpl.name); $('p.muted', body).textContent = L(tpl.description);
      $('.tpl-f', body).innerHTML = fields.map(function (f) {
        var lab = esc(L(f.label) || f.key) + (f.required ? ' *' : ''), ph = esc(L(f.placeholder) || '');
        var input = f.type === 'textarea' ? '<textarea class="inp" name="' + esc(f.key) + '" placeholder="' + ph + '"></textarea>'
          : f.type === 'select' ? '<select class="inp" name="' + esc(f.key) + '">' + (f.options || []).map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(L(o.label) || o.value) + '</option>'; }).join('') + '</select>'
          : '<input class="inp" name="' + esc(f.key) + '" type="' + (f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text') + '" placeholder="' + ph + '">';
        return '<div class="field"><label>' + lab + '</label>' + input + '</div>';
      }).join('');
      J.selects($('.tpl-f', body));
      $('[data-a=back]', body).onclick = home;
      async function exp(format) {
        var values = {}; $$('[name]', $('.tpl-f', body)).forEach(function (i) { values[i.name] = i.value; });
        var miss = fields.filter(function (f) { return f.required && !String(values[f.key] || '').trim(); });
        if (miss.length) { J.toast((L(miss[0].label) || miss[0].key) + ' *'); return; }
        var rr = await J.api('/api/draft/export', { method: 'POST', body: { templateId: tpl.slug || tpl.id, values: values, format: format }, raw: true });
        if (!rr.ok) { J.toast(J.t('err.generic')); return; }
        var ct = rr.res.headers.get('Content-Type') || '';
        if (ct.indexOf('json') > -1) { var d = await rr.res.json(); var w = window.open('', '_blank'); if (w) { w.document.write(J.printPage(L(tpl.name) || 'JuristAI', d.html || '')); w.document.close(); w.print(); } return; }
        var blob = await rr.res.blob(), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (L(tpl.name) || 'hujjat') + '.' + (format === 'pdf' ? 'pdf' : 'docx'); document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
      }
      $('[data-a=docx]', body).onclick = function () { exp('docx'); };
      $('[data-a=pdf]', body).onclick = function () { exp('pdf'); };
    }
    home();
  };

  /* ================= KO'NIKMALAR ================= */
  J.viewSkills = function () {
    J.setTitle(t('nav.skills'));
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(t('sk.title')) + '</h2><p>' + esc(t('sk.sub')) + '</p></div><button class="pill" data-a="new">' + J.icon('plus') + esc(t('sk.new')) + '</button></div>' +
      '<div class="tabs"><button class="on" data-tab="all">' + esc(t('sk.all')) + '</button><button data-tab="b">' + esc(t('sk.builtin')) + '</button><button data-tab="p">' + esc(t('sk.mine')) + '</button><button data-tab="t">' + esc(t('sk.team')) + '</button></div><div class="grid3 sk-list"></div></div>');
    var tab = 'all';
    function draw() {
      if (tab === 't') { $('.sk-list', v).innerHTML = '<div class="empty-state" style="grid-column:1/-1">' + esc(t('sk.scope.soon')) + '</div>'; return; }
      var list = J.skills.all().filter(function (s) { return tab === 'all' || (tab === 'b' ? s.builtin : s.mine); });
      $('.sk-list', v).innerHTML = list.length ? list.map(function (s) {
        return '<div class="tile" data-id="' + esc(s.id) + '"><div class="tile-h">' + J.icon(s.icon) + esc(s.area) + '</div><b>' + esc(s.name) + '</b><p>' + esc(s.desc || '') + '</p><div class="tile-f">' + J.scopeTag(s.scope) +
          '<span style="display:flex;gap:6px">' + (s.mine ? '<button class="pill sm ghost" data-ed="1" aria-label="edit">✎</button>' : '') + '<button class="pill sm" data-use="1">' + esc(t('sk.use')) + '</button></span></div>' +
          (s.src.needDoc ? '<span class="tag">' + J.icon('clip') + esc(t('sk.needdoc')) + '</span>' : '') + '</div>';
      }).join('') : '<div class="empty-state" style="grid-column:1/-1">—</div>';
      $$('.tile', v).forEach(function (el) {
        var s = J.skills.byId(el.dataset.id);
        var use = $('[data-use]', el); if (use) use.onclick = function (e) { e.stopPropagation(); useSkill(s); };
        var ed = $('[data-ed]', el); if (ed) ed.onclick = function (e) { e.stopPropagation(); editor(s.src); };
        el.onclick = function () { useSkill(s); };
      });
    }
    function useSkill(s) {
      if (s.src.kind === 'nav') return J.go(s.src.to);
      J.go('#/'); setTimeout(function () { var c = J.homeComposer; if (c) c.setSkill(s.id); }, 60);
    }
    function editor(existing) {
      var sk = existing || { id: Date.now().toString(36), name: '', ins: '', scope: 'p' };
      var m = J.modal({ cls: 'sm', html: '<h2>' + esc(existing ? existing.name : t('sk.new')) + '</h2><p class="sub" style="margin-bottom:16px">' + esc(t('sk.local')) + '</p>' +
        '<div class="field"><label>' + esc(t('sk.form.name')) + '</label><input class="inp" data-f="n" maxlength="60"></div>' +
        '<div class="field"><label>' + esc(t('sk.form.ins')) + '</label><textarea class="inp" data-f="i" maxlength="600" placeholder="' + esc(t('sk.form.ins.ph')) + '"></textarea></div>' +
        '<div class="field"><label>' + esc(t('sk.form.scope')) + '</label><div class="seg"><button class="on" type="button">' + esc(t('sk.scope.p')) + '</button><button type="button" disabled title="' + esc(t('sk.scope.soon')) + '">' + esc(t('sk.scope.t')) + '</button><button type="button" disabled title="' + esc(t('sk.scope.soon')) + '">' + esc(t('sk.scope.o')) + '</button></div></div>' +
        '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:18px">' + (existing ? '<button class="pill ghost" data-a="del">' + J.icon('trash') + esc(t('sk.form.del')) + '</button>' : '<span></span>') + '<button class="pill" data-a="save">' + esc(t('sk.form.save')) + '</button></div>' });
      $('[data-f=n]', m.body).value = sk.name; $('[data-f=i]', m.body).value = sk.ins;
      $('[data-a=save]', m.body).onclick = function () {
        var n = $('[data-f=n]', m.body).value.trim(), i = $('[data-f=i]', m.body).value.trim(); if (!n || !i) return;
        var list = J.skills.mine().filter(function (x) { return x.id !== sk.id; }); list.unshift({ id: sk.id, name: n, ins: i, scope: 'p' }); J.skills.saveMine(list); m.close(); draw();
      };
      var del = $('[data-a=del]', m.body); if (del) del.onclick = function () { J.skills.saveMine(J.skills.mine().filter(function (x) { return x.id !== sk.id; })); m.close(); draw(); };
    }
    $('[data-a=new]', v).onclick = function () { editor(null); };
    $$('[data-tab]', v).forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; $$('[data-tab]', v).forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
    draw();
  };

  /* ================= ADVOKATLAR ================= */
  var REGIONS = ['Toshkent shahar', 'Toshkent viloyati', 'Andijon viloyati', 'Buxoro viloyati', "Farg'ona viloyati", 'Jizzax viloyati', 'Namangan viloyati', 'Navoiy viloyati', 'Qashqadaryo viloyati', "Qoraqalpog'iston Respublikasi", 'Samarqand viloyati', 'Sirdaryo viloyati', 'Surxondaryo viloyati', 'Xorazm viloyati'];
  J.viewLawyers = function () {
    J.setTitle(t('nav.lawyers'));
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(t('lw.title')) + '</h2><p>' + esc(t('lw.sub')) + '</p></div></div>' +
      '<form class="filters"><div class="search" style="flex:1;min-width:220px">' + J.icon('search') + '<input class="inp" name="q" placeholder="' + esc(t('lw.q')) + '"></div>' +
      '<select class="inp" name="field"><option value="">' + esc(t('lw.field')) + '</option></select><select class="inp" name="region"><option value="">' + esc(t('lw.region')) + '</option>' + REGIONS.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select>' +
      '<button class="pill">' + esc(t('lw.find')) + '</button></form><div class="lw-list rows"></div></div>');
    var form = $('form', v);
    J.api('/api/practice-areas', { allow401: true }).then(function (r) {
      (r.ok ? r.data.items || [] : []).filter(function (a) { return !a.parent_slug; }).forEach(function (a) { var o = document.createElement('option'); o.value = a.slug; o.textContent = a.name_uz; form.field.appendChild(o); });
    });
    J.selects(form);
    form.field.addEventListener('change', load); form.region.addEventListener('change', load);
    async function load() {
      var p = new URLSearchParams(); ['q', 'field', 'region'].forEach(function (k) { if (form[k].value) p.set(k, form[k].value); }); p.set('language', J.lang === 'ru' ? 'ru' : 'uz');
      var list = $('.lw-list', v); list.innerHTML = '<div style="padding:18px"><div class="skel"></div></div>';
      var r = await J.api('/api/attorneys?' + p.toString(), { allow401: true });
      var items = r.ok ? (r.data.items || []) : [];
      list.innerHTML = items.length ? items.map(function (a) {
        var init = String(a.full_name || '?').split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase();
        var exp = a.experience_started_on ? Math.max(0, new Date().getFullYear() - new Date(a.experience_started_on).getFullYear()) : null;
        return '<div class="row" style="cursor:default;align-items:flex-start;padding:16px 4px"><span class="av">' + esc(init) + '</span><div style="flex:1;min-width:0"><b style="font-weight:500">' + esc(a.full_name) + '</b>' +
          '<div class="muted" style="font-size:13px">' + esc([a.organization_name, a.region].filter(Boolean).join(' · ')) + (exp ? ' · ' + esc(t('lw.exp', { y: exp })) : '') + '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + (a.practice_areas || []).slice(0, 4).map(function (x) { return '<span class="chip static" style="height:26px;font-size:12px">' + esc(x.name_uz) + '</span>'; }).join('') + '</div></div>' +
          '<div class="lw-side"><div class="tag">' + J.icon('shield') + esc(t('lw.lic')) + ' ' + esc(a.license_number || '') + '</div>' +
          '<a class="pill sm ghost" target="_blank" rel="noopener" href="' + esc(J.botUrl('legal', 'advokat')) + '">' + esc(t('lw.contact')) + '</a></div></div>';
      }).join('') : '<div class="empty-state">' + esc(t('lw.empty')) + '</div>';
    }
    form.onsubmit = function (e) { e.preventDefault(); load(); };
    load();
  };

  /* ================= JAMOA (mavjud Workspace moduli) ================= */
  var wsLoaded = null;
  function loadWorkspaceModule() {
    if (wsLoaded) return wsLoaded;
    wsLoaded = new Promise(function (ok, no) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/workspace.css?v=2'; document.head.appendChild(css);
      // dashboard.css'dagi Jamoa uslublari, ilova shrifti va ranglarida (tools/build-ws-skin.js)
      var skin = document.createElement('link'); skin.rel = 'stylesheet'; skin.href = '/app/ws-skin.css?v=2'; document.head.appendChild(skin);
      var s = document.createElement('script'); s.src = '/js/workspace.js'; s.onload = ok; s.onerror = no; document.body.appendChild(s);
    });
    return wsLoaded;
  }
  J.viewTeam = function (opts) {
    J.setTitle(t('nav.team'));
    var plan = J.planKey();
    if (!J.isStaff() && (plan === 'sinov' || plan === 'none')) {
      var v0 = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(t('tm.title')) + '</h2><p>' + esc(t('tm.sub')) + '</p></div></div>' + J.lockBox('Silver', t('ws.need')) + '</div>'); bindLock(v0); return;
    }
    var host = J.mount('<div class="ws-host"><main class="workspace-app" id="workspaceApp" aria-live="polite"></main></div>');
    loadWorkspaceModule().then(function () {
      var W = G.JuristWorkspace; if (!W) return;
      if (W.setCurrentUser) W.setCurrentUser(J.S.user);
      W.activate();
      if (opts && opts.ai && W.openAi) setTimeout(function () { if (document.querySelector('#workspaceApp .ws-bar')) W.openAi(null); }, 800);
    }).catch(function () { host.innerHTML = '<div class="wrap"><p class="err">' + esc(t('err.generic')) + '</p></div>'; });
  };
  J.on('route', function (h) { if (!/^\/jamoa/.test(h) && G.JuristWorkspace && G.JuristWorkspace.deactivate) G.JuristWorkspace.deactivate(); });

  /* ================= SUHBATLAR ================= */
  J.viewHistory = function () {
    J.setTitle(t('nav.history'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h2>' + esc(t('hi.title')) + '</h2></div><button class="pill" data-a="new">' + J.icon('plus') + esc(t('new')) + '</button></div><div class="search" style="margin-bottom:14px">' + J.icon('search') + '<input class="inp" placeholder="' + esc(t('hi.search')) + '"></div><div class="rows"></div></div>');
    $('[data-a=new]', v).onclick = J.newChat;
    function draw() {
      var s = ($('input', v).value || '').toLowerCase();
      var list = (J.S.sessions || []).filter(function (x) { return !s || String(x.title || x.first_message || '').toLowerCase().indexOf(s) > -1; });
      $('.rows', v).innerHTML = list.length ? list.map(function (x) { return '<div class="row" data-id="' + esc(x.id) + '">' + J.icon('chat') + '<span>' + esc(x.title || x.first_message || '—') + '</span><small>' + esc(J.fmtDate(x.updated_at || x.created_at)) + '</small><button class="ib" data-del="' + esc(x.id) + '" title="' + esc(t('hi.del')) + '">' + J.icon('trash') + '</button></div>'; }).join('')
        : '<div class="empty-state">' + esc(t('hist.empty')) + '</div>';
      $$('.row', v).forEach(function (r) { r.onclick = function (e) { if (e.target.closest('[data-del]')) return; J.go('#/c/' + r.dataset.id); }; });
      $$('[data-del]', v).forEach(function (b) {
        b.onclick = async function () {
          if (!(await J.confirm(t('hi.del.q'), t('hi.del')))) return;
          var r = await J.api('/api/ai-chat-sessions/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
          if (!r.ok) { J.toast(J.errMsg(r.data)); return; }
          if (String(J.chat.id) === String(b.dataset.del)) { J.chat.id = null; J.chat.history = []; }
          await J.loadSessions(); draw();
        };
      });
    }
    $('input', v).oninput = draw; draw(); J.on('sessions', function () { if (document.body.contains(v)) draw(); });
  };

  /* ================= HISOB ================= */
  J.viewAccount = function () {
    J.setTitle(t('nav.account'));
    var b = J.balance(), u = J.S.user || {};
    var svcs = ['chat', 'analysis', 'opinion', 'draft'];
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h2>' + esc(t('ac.title')) + '</h2></div>' + (J.isStaff() ? '' : '<button class="pill" data-a="plans">' + esc(t('ac.change')) + '</button>') + '</div>' +
      '<div class="card" style="display:flex;gap:14px;align-items:center;margin-bottom:14px"><span class="av" style="width:44px;height:44px;font-size:15px"></span><div><b style="font-weight:500;font-size:16px" class="nm"></b><div class="muted" style="font-size:13px">@' + esc(u.username || '') + '</div></div></div>' +
      '<div class="kv" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><small>' + esc(t('ac.plan')) + '</small><b>' + esc(J.isStaff() ? t('usage.unlimited') : (b.kind === 'none' ? t('usage.none') : J.planLabel())) + '</b></div><div><small>' + esc(t('ac.period')) + '</small><b style="font-size:16px">' + esc(b.endsAt ? J.fmtDate(b.startsAt) + ' — ' + J.fmtDate(b.endsAt) : (b.kind === 'trial' ? t('pl.once') : '—')) + '</b></div></div>' +
      (b.services ? '<div class="card"><h4>' + esc(t('ac.usage')) + '</h4>' + svcs.filter(function (s) { return b.services[s]; }).map(function (s) {
        var x = b.services[s], pct = x.limit ? Math.round(100 * x.used / x.limit) : 0;
        return '<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;font-size:14px"><span>' + esc(t('ac.svc.' + s)) + '</span><span class="num muted">' + x.used + ' / ' + x.limit + '</span></div><div class="meter"><i style="width:' + Math.min(100, pct) + '%"></i></div></div>';
      }).join('') + '</div>' : '') +
      '<div class="grid2" style="margin-top:14px"><a class="tile" href="/account.html"><div class="tile-h">' + J.icon('lock') + '</div><b>' + esc(t('ac.login')) + '</b><p>' + esc(t('ac.login.d')) + '</p></a><div class="tile" style="cursor:default"><div class="tile-h">' + J.icon('shield') + '</div><b>' + esc(t('ac.security')) + '</b><p>' + esc(t('ac.security.d')) + '</p></div>' +
        (J.adaptiveText ? '<a class="tile" href="#/moslashish"><div class="tile-h">' + J.icon('spark') + '</div><b>' + esc(J.adaptiveText('title')) + '</b><p>' + esc(J.adaptiveText('card')) + '</p></a>' : '') +
        '</div><div class="tg-acc" style="margin-top:14px"></div></div>');
    J.tg.card($('.tg-acc', v));
    $('.av', v).textContent = J.initials(u.fullName || u.username); $('.nm', v).textContent = u.fullName || u.username || '';
    var pb = $('[data-a=plans]', v); if (pb) pb.onclick = function () { J.openPlans({}); };
  };
})(window);
