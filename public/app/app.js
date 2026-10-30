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
  var NAV = [
    ['#/', 'home', 'nav.home'], ['#/ishlar', 'folder', 'nav.matters'], ['#/hujjatlarim', 'doc', 'nav.docs'], ['#/tahlil', 'scan', 'nav.analyze'], ['#/tayyorlash', 'pen', 'nav.draft'],
    ['#/konikmalar', 'spark', 'nav.skills'], ['#/yozuvlar', 'mic', 'nav.voice'], ['#/jamoa', 'team', 'nav.team'], ['#/advokatlar', 'scale', 'nav.lawyers']
  ];
  function drawNav() {
    // Boshqaruv faqat bazada master bo'lgan hisobga (admin.js; server har so'rovni o'zi tekshiradi)
    // a role view (#/rol/<rol>) shows only that role's sections
    var rv = J.roleView && J.roleView(), keep = rv ? J.ROLE_VIEWS[rv].nav : null;
    var items = NAV.filter(function (n) { return !keep || keep.indexOf(n[0]) > -1; })
      .concat(J.salesAgent ? [['#/mijozlarim', 'user', 'nav.myClients']] : [], J.isMaster && J.isMaster() ? [['#/boshqaruv', 'shield', 'nav.admin']] : [],
        // the client's own role view: the other sections are one click away
        rv && !J.rolePreview() ? [['#/rol/hammasi', 'more', 'rv.all']] : []);
    $('#nav').innerHTML = items.map(function (n) {
      var lock = (n[0] === '#/tayyorlash' && !J.hasService('draft') && !J.needsPlan()) || (n[0] === '#/jamoa' && !J.isStaff() && /^(sinov|none)$/.test(J.planKey()));
      return '<a href="' + n[0] + '" data-r="' + n[0] + '" title="' + esc(t(n[2])) + '">' + J.icon(n[1]) + '<span>' + esc(t(n[2])) + '</span>' + (lock ? '<span class="lock">' + J.icon('lock') + '</span>' : '') + '</a>';
    }).join('');
    markNav();
  }
  J.redrawNav = function () { drawNav(); };
  function markNav() {
    var h = location.hash || '#/';
    $$('#nav a').forEach(function (a) { var r = a.dataset.r; a.classList.toggle('on', r === '#/' ? (h === '#/' || h === '' || h === '#') : h.indexOf(r) === 0); });
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
    if (!J.S.tariff || b.kind === 'none') {
      box.innerHTML = '<div class="usage-h"><b>' + esc(t('usage.none')) + '</b></div><button class="pill sm" data-a="plans">' + esc(t('usage.upgrade')) + '</button>';
    } else {
      var c = J.svc('chat') || { used: 0, limit: 0, remaining: 0 }, pct = c.limit ? Math.min(100, Math.round(100 * c.used / c.limit)) : 0;
      box.innerHTML = '<div class="usage-h"><b>' + esc(J.planLabel()) + '</b><span class="num muted">' + c.used + ' / ' + c.limit + '</span></div><div class="meter"><i style="width:' + pct + '%"></i></div>' +
        '<small>' + esc(c.remaining + ' ' + t('usage.chat')) + (b.endsAt ? ' · ' + esc(t('usage.until', { d: J.fmtDate(b.endsAt) })) : '') + '</small>' +
        '<small>' + J.icon('mic').replace('class="i"', 'class="i" style="width:12px;height:12px;vertical-align:-2px"') + ' ' + esc(J.VOICE_MIN && J.VOICE_MIN[J.planKey()] ? t('vc.min', { n: J.VOICE_MIN[J.planKey()] }) : t('vc.min.none')) + '</small>' +
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
      '<a class="mi" href="/dashboard.html">' + J.icon('layers') + '<span class="mi-t">' + esc(t('me.old')) + '</span></a>' +
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
    if (J.needsPlan()) J.openPlans({ forced: true });
    else if (J.trialEnded()) {
      var seen = null; try { seen = sessionStorage.getItem('jai-ended-shown'); } catch (e) {}
      if (!seen) { try { sessionStorage.setItem('jai-ended-shown', '1'); } catch (e) {} J.openPlans({ ended: true }); }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
