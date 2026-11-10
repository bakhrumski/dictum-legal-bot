/* Ilova qobig'i: chap panel, yuqori qator, foydalanuvchi menyusi, marshrutlar, ishga tushirish. */
(function (G) {
  'use strict';
  var J = G.JAI, t = J.t, esc = J.esc, $ = J.$, $$ = J.$$;

  J.initials = function (n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?'; };
  J.mount = function (html) {
    var view = $('#view'); view.innerHTML = ''; view.scrollTop = 0;
    var el = J.h(html); view.appendChild(el); document.body.classList.remove('nav-open'); return el;
  };
  J.setTitle = function (s) { $('#title').textContent = s || ''; document.title = (s ? s + ' — ' : '') + 'JuristAI'; };

  /* ---------- chap panel ---------- */
  /* U4 (docs/design/ux-audit-2026-11.md): five items for everyone - the rest are cards on "Asboblar" (tools.js),
     ordered by the role view there; old links (#/tahlil, #/jadval, #/playbook ...) still open their pages */
  var NAV = [
    ['#/', 'chat', 'nav.ask'], ['#/hujjatlarim', 'doc', 'nav.docs'], ['#/ishlar', 'folder', 'nav.matters'], ['#/asboblar', 'layers', 'nav.tools'], ['#/advokatlar', 'scale', 'nav.lawyers']
  ];
  function drawNav() {
    // Boshqaruv faqat bazada master bo'lgan hisobga (admin.js; server har so'rovni o'zi tekshiradi)
    var items = NAV.slice();
    // staff answer the human queue (queue.js): their work, right under the first item
    if (J.isStaff()) items.splice(1, 0, ['#/navbat', 'chat', 'nav.queue']);
    items = items.concat(J.salesAgent ? [['#/mijozlarim', 'user', 'nav.myClients']] : [],
        // the client of a lawyer's matter (portal.js): their matters
        J.portalClient ? [['#/portal', 'folder', 'nav.portal']] : [], J.isMaster && J.isMaster() ? [['#/boshqaruv', 'shield', 'nav.admin']] : []);
    $('#nav').innerHTML = items.map(function (n) {
      return '<a href="' + n[0] + '" data-r="' + n[0] + '" title="' + esc(t(n[2])) + '">' + J.icon(n[1]) + '<span>' + esc(t(n[2])) + '</span></a>';
    }).join('');
    markNav();
    if (J.drawBottomNav) J.drawBottomNav();
  }
  J.redrawNav = function () { drawNav(); };
  function markNav() {
    var h = location.hash || '#/';
    var tool = (J.TOOL_ROUTES || []).some(function (r) { return h.indexOf(r) === 0; });
    $$('#nav a').forEach(function (a) {
      var r = a.dataset.r;
      // "Savol" is the home page and every chat; "Asboblar" is any tool's page
      a.classList.toggle('on', r === '#/' ? (h === '#/' || h === '' || h === '#') : r === '#/asboblar' ? (tool || h.indexOf(r) === 0) : h.indexOf(r) === 0);
    });
    if (J.markBottomNav) J.markBottomNav();
    $$('#hist a').forEach(function (a) { a.classList.toggle('on', h === '#/c/' + a.dataset.id); });
  }
  function drawHist() {
    var list = (J.S.sessions || []).slice(0, 14);
    $('#hist').innerHTML = list.length ? list.map(function (s) { return '<a href="#/c/' + esc(s.id) + '" data-id="' + esc(s.id) + '" title="' + esc(s.title || '') + '">' + esc(s.title || s.first_message || '—') + '</a>'; }).join('')
      : '<div class="empty">' + esc(t('hist.empty')) + '</div>';
    markNav();
  }
  function drawUsage() {
    var box = $('#usage'), b = J.balance();
    if (J.isStaff()) { box.innerHTML = '<div class="usage-h"><b>' + esc(t('usage.unlimited')) + '</b></div>'; return; }
    // U2: no plan yet, the one-time Sinov still there - it starts with the first question; nothing to choose
    if (J.trialWaiting && J.trialWaiting()) {
      box.innerHTML = J.trialUsageHtml();
    } else if (!J.S.tariff || b.kind === 'none') {
      box.innerHTML = '<div class="usage-h"><b>' + esc(t('usage.none')) + '</b></div><button class="pill sm" data-a="plans">' + esc(t('usage.upgrade')) + '</button>';
    } else {
      // U4: in plain words - what is left this period, not "0 / 0"; a document unit says what it is
      var c = J.svc('chat') || { used: 0, limit: 0, remaining: 0 }, an = J.svc('analysis'), pct = c.limit ? Math.min(100, Math.round(100 * c.used / c.limit)) : 0;
      box.innerHTML = '<div class="usage-h"><b>' + esc(J.planLabel()) + '</b>' + (b.endsAt ? '<span class="muted">' + esc(t('usage.until', { d: J.fmtDate(b.endsAt) })) + '</span>' : '') + '</div><div class="meter"><i style="width:' + pct + '%"></i></div>' +
        '<small>' + esc(t(b.kind === 'trial' ? 'usage.left.trial' : 'usage.left', { n: J.fmtNum(c.remaining) })) + (an ? ' · ' + esc(t('usage.left.an', { n: J.fmtNum(an.remaining) })) : '') + '</small>' +
        (an ? '<small class="muted">' + esc(t('usage.unit')) + '</small>' : '') +
        (b.kind === 'trial' || c.remaining <= Math.ceil(c.limit * 0.1) ? '<button class="pill sm" data-a="plans">' + esc(t('usage.upgrade')) + '</button>' : '');
    }
    var p = $('[data-a=plans]', box); if (p) p.onclick = function () { J.openPlans({ ended: J.trialEnded() }); };
  }
  function drawMe() {
    var u = J.S.user || {};
    $('#me .av').textContent = J.initials(u.fullName || u.username);
    $('#me b').textContent = u.fullName || u.username || '';
    // a staff lawyer works for the platform: shown as "Ekspert" (a client lawyer is role user with client type lawyer)
    $('#me small').textContent = J.isStaff() ? (u.role === 'lawyer' ? 'Ekspert' : u.role) : (u.username ? '@' + u.username : '');
  }
  function meMenu() {
    var old = $('#mePop'); if (old) { old.remove(); return; }
    var btn = $('#me'), r = btn.getBoundingClientRect();
    var pop = J.h('<div class="popover" id="mePop" role="menu">' +
      '<button class="mi" data-a="acc">' + J.icon('user') + '<span class="mi-t">' + esc(t('me.account')) + '</span></button>' +
      '<div class="mi" style="cursor:default">' + J.icon('globe') + '<span class="mi-t">' + esc(t('me.lang')) + '</span><span class="seg">' + ['uz', 'ru', 'en'].map(function (l) { return '<button data-l="' + l + '" class="' + (l === J.lang ? 'on' : '') + '">' + l.toUpperCase() + '</button>'; }).join('') + '</span></div>' +
      '<button class="mi" data-a="tg">' + J.icon('tg') + '<span class="mi-t">' + esc(t('tg.menu')) + '</span>' + (J.tg && J.tg.linked ? '<span class="tag">✓</span>' : '') + '</button>' +
      '<button class="mi" data-a="theme">' + J.icon('moon') + '<span class="mi-t">' + esc(t('me.theme')) + '</span><span class="tag">' + (J.theme === 'dark' ? '●' : '○') + '</span></button>' +
      '<a class="mi" href="/index.html">' + J.icon('globe') + '<span class="mi-t">' + esc(t('me.site')) + '</span></a>' +
      (J.isMaster && J.isMaster() ? '<a class="mi" href="#/boshqaruv">' + J.icon('shield') + '<span class="mi-t">' + esc(t('nav.admin')) + '</span></a>' : '') +
      (J.isMaster && J.isMaster() ? '<a class="mi" href="/dashboard.html">' + J.icon('layers') + '<span class="mi-t">' + esc(t('me.old')) + '</span></a>' : '') +
      '<button class="mi" data-a="out">' + J.icon('out') + '<span class="mi-t">' + esc(t('me.logout')) + '</span></button></div>');
    pop.style.left = (r.left) + 'px'; pop.style.bottom = (innerHeight - r.top + 6) + 'px'; pop.style.position = 'fixed'; pop.style.width = Math.max(280, r.width) + 'px';
    document.body.appendChild(pop);
    $$('[data-l]', pop).forEach(function (b) { b.onclick = function () { J.setLang(b.dataset.l); }; });
    $('[data-a=acc]', pop).onclick = function () { pop.remove(); J.go('#/hisob'); };
    $$('a[href^="#/"]', pop).forEach(function (a) { a.addEventListener('click', function () { pop.remove(); }); });
    $('[data-a=tg]', pop).onclick = function () { pop.remove(); J.tg.info(); };
    $('[data-a=theme]', pop).onclick = function () { J.toggleTheme(); pop.remove(); };
    $('[data-a=out]', pop).onclick = async function () { await J.api('/api/logout', { method: 'POST', allow401: true }); location.href = '/'; };
    setTimeout(function () { document.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }); }, 0);
  }

  /* ---------- marshrutlar ---------- */
  J.route(/^\/$/, function () { J.viewHome(); });
  // role views: #/rol (the list), #/rol/<fuqaro|tadbirkor|yurist|buxgalter|hr|firma>, #/rol/chiqish
  J.route(/^\/rol$/, function () { J.viewRoles(); });
  // the client's own view (core.js J.roleAuto): every section, or the role's sections again
  J.route(/^\/rol\/(hammasi|sodda)$/, function (w) {
    J.setRoleFull(w === 'hammasi');
    document.body.classList.toggle('role-view', !!J.roleView());
    J.redrawNav(); J.go('#/');
  });
  J.route(/^\/rol\/([a-z]+)$/, function (slug) {
    var key = null;
    Object.keys(J.ROLE_VIEWS).forEach(function (k) { if (J.ROLE_VIEWS[k].slug === slug) key = k; });
    J.setRoleView(slug === 'chiqish' ? null : key);
    if (slug === 'chiqish' && J.S.user && J.S.user.clientType && J.TYPE_PERSONA[J.S.user.clientType]) J.S.persona = J.TYPE_PERSONA[J.S.user.clientType];
    J.redrawNav(); J.go(key || slug === 'chiqish' ? '#/' : '#/rol');
  });
  J.route(/^\/c\/([\w-]+)$/, function (id) { J.viewChat(id); });
  J.route(/^\/tahlil$/, function () { J.viewAnalyze(); });
  J.route(/^\/tayyorlash(?:\?(.*))?$/, function (q) { J.viewDraft(q); });
  J.route(/^\/konikmalar$/, function () { J.viewSkills(); });
  J.route(/^\/jamoa(\?ai)?$/, function (ai) { J.viewTeam({ ai: !!ai }); });
  J.route(/^\/advokatlar$/, function () { J.viewLawyers(); });
  J.route(/^\/suhbatlar$/, function () { J.viewHistory(); });
  J.route(/^\/hisob$/, function () { J.viewAccount(); });
  J.route(/^\/yozuvlar$/, function () { J.viewVoiceList(); });
  J.route(/^\/yozuvlar\/yangi$/, function () { J.viewVoiceRecord(); });
  J.route(/^\/yozuvlar\/([\w-]+)$/, function (id) { J.viewVoiceItem(id); });
  J.on('route', function (h) {
    markNav();
    var team = /^\/jamoa/.test(h);
    $$('#scope button').forEach(function (b) { b.classList.toggle('on', (b.dataset.s === 'team') === team); });
    // a citizen's view has no team to switch to: the switch shows for the other views and on the team pages themselves
    var sc = document.getElementById('scope');
    if (sc) sc.hidden = !team && !!J.roleView && J.roleView() === 'citizen';
  });
  J.on('sessions', drawHist);
  J.on('tariff', function () { drawUsage(); drawNav(); });

  /* ---------- ishga tushirish ---------- */
  async function boot() {
    J.applyI18n(document);
    $('#newBtn').onclick = J.newChat;
    $('#me').onclick = meMenu;
    $('#burger').onclick = function () { document.body.classList.toggle('nav-open'); };
    // chap panelni yig'ish: kompyuterda faqat belgilar qoladi (tanlov eslab qolinadi); telefonda panelni yopadi
    $('#collapse').onclick = function () {
      if (matchMedia('(max-width:900px)').matches) { document.body.classList.remove('nav-open'); return; }
      var mini = document.documentElement.classList.toggle('side-mini');
      try { localStorage.setItem('jai-side', mini ? 'mini' : 'full'); } catch (e) {}
      this.setAttribute('aria-expanded', String(!mini)); this.title = t(mini ? 'side.expand' : 'side.collapse');
    };
    if (document.documentElement.classList.contains('side-mini')) { $('#collapse').setAttribute('aria-expanded', 'false'); $('#collapse').title = t('side.expand'); }
    document.addEventListener('click', function (e) { if (document.body.classList.contains('nav-open') && !e.target.closest('.side') && !e.target.closest('#burger')) document.body.classList.remove('nav-open'); });
    $$('#scope button').forEach(function (b) { b.onclick = function () { J.go(b.dataset.s === 'team' ? '#/jamoa?ai' : '#/'); }; });
    await J.loadBots();
    J.tg.bot = J.bots.legal;
    var ok = await J.loadMe();
    if (!ok) return J.toLogin();
    // ishchi guruhga taklif: kirishdan oldin saqlangan bo'lsa, taklif sahifasiga
    try { var inv = sessionStorage.getItem('juristai-workspace-invite'); if (inv) { sessionStorage.removeItem('juristai-workspace-invite'); location.href = '/workspace-invite.html?token=' + encodeURIComponent(inv); return; } } catch (e) {}
    document.body.classList.toggle('role-view', !!J.roleView());
    drawMe(); drawNav(); drawUsage(); drawHist();
    document.body.classList.remove('booting');
    J.render();
    J.loadSessions();
    // the editor is on every plan (D3): someone opening a shared document or its invite link is not stopped by the plan picker
    var editorPage = /^#\/muharrir\//.test(location.hash || '');
    // U2: the plan picker is forced only when there is nothing to start with (the Sinov used up / not offered);
    // a new person asks their first question and the Sinov starts on the server then
    if (J.needsPlan() && !editorPage && !(J.trialWaiting && J.trialWaiting())) J.openPlans({ forced: true });
    else if (J.trialEnded()) {
      var seen = null; try { seen = sessionStorage.getItem('jai-ended-shown'); } catch (e) {}
      if (!seen) { try { sessionStorage.setItem('jai-ended-shown', '1'); } catch (e) {} J.openPlans({ ended: true }); }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
