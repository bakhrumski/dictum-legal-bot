/* JuristAI ilovasi — umumiy yordamchilar: API, til, holat, belgilar, markdown, xabarlar, marshrut. */
(function (G) {
  'use strict';
  var J = G.JAI = G.JAI || {};

  /* ---------- DOM ---------- */
  J.$ = function (s, r) { return (r || document).querySelector(s); };
  J.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  J.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  J.h = function (html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  J.sleep = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };

  /* ---------- til ---------- */
  var LANGS = ['uz', 'ru', 'en'];
  function pickLang() {
    var l = null; try { l = localStorage.getItem('lang'); } catch (e) {}
    if (!l) l = (navigator.language || 'uz').slice(0, 2);
    return LANGS.indexOf(l) > -1 ? l : 'uz';
  }
  J.lang = pickLang();
  J.t = function (k, vars) {
    var d = G.JAI_I18N[J.lang] || G.JAI_I18N.uz, v = d[k];
    if (v === undefined) v = G.JAI_I18N.uz[k];
    if (v === undefined) return k;
    if (typeof v === 'string' && vars) v = v.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] != null ? vars[n] : m; });
    return v;
  };
  J.setLang = function (l) { try { localStorage.setItem('lang', l); } catch (e) {} location.reload(); };
  J.applyI18n = function (root) {
    J.$$('[data-t]', root).forEach(function (el) { el.textContent = J.t(el.dataset.t); });
    J.$$('[data-t-ph]', root).forEach(function (el) { el.placeholder = J.t(el.dataset.tPh); });
    J.$$('[data-t-title]', root).forEach(function (el) { el.title = J.t(el.dataset.tTitle); el.setAttribute('aria-label', J.t(el.dataset.tTitle)); });
    document.documentElement.lang = J.lang;
  };
  J.fmtNum = function (n) { return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' '); };
  J.fmtDate = function (d) {
    if (!d) return '';
    var x = new Date(d); if (isNaN(x)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(x.getDate()) + '.' + p(x.getMonth() + 1) + '.' + x.getFullYear();
  };

  /* ---------- tema ---------- */
  J.theme = (function () { try { return localStorage.getItem('jai-theme') || 'light'; } catch (e) { return 'light'; } })();
  document.documentElement.setAttribute('data-theme', J.theme);
  J.toggleTheme = function () {
    J.theme = J.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', J.theme);
    try { localStorage.setItem('jai-theme', J.theme); } catch (e) {}
  };

  /* ---------- API ---------- */
  J.api = async function (path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body instanceof FormData) init.body = opts.body;
    else if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    if (opts.signal) init.signal = opts.signal;
    var res;
    try { res = await fetch(path, init); } catch (e) { return { ok: false, status: 0, data: { error: J.t('err.net') }, network: true }; }
    if (res.status === 401 && !opts.allow401) { J.toLogin(); return { ok: false, status: 401, data: {} }; }
    if (opts.raw) return { ok: res.ok, status: res.status, res: res };
    var data = null, ct = res.headers.get('Content-Type') || '';
    if (ct.indexOf('json') > -1) { try { data = await res.json(); } catch (e) { data = {}; } }
    else { try { data = { text: await res.text() }; } catch (e) { data = {}; } }
    data = data || {};
    if (!res.ok && data && typeof data === 'object' && !Array.isArray(data)) data._status = res.status;
    return { ok: res.ok, status: res.status, data: data };
  };
  J.toLogin = function () { location.href = '/app/kirish.html?redirect=' + encodeURIComponent(location.pathname + location.hash); };
  // a reply with no readable reason (a proxy error page, a crash) says its HTTP code
  J.errMsg = function (d) { d = d || {}; return d.message || (typeof d.error === 'string' && d.error.length > 3 && !/^[a-z_]+$/.test(d.error) ? d.error : '') || (d._status ? J.t('err.http', { code: d._status }) : J.t('err.generic')); };

  /* ---------- botlar ---------- */
  // Production nomlari; staging o'z test botlarini /api/auth/options orqali beradi.
  J.bots = { legal: 'yuristga_savolbot', auth: 'juristAI_registration_bot' };
  J.botUrl = function (k, start) { return 'https://t.me/' + J.bots[k] + (start ? '?start=' + encodeURIComponent(start) : ''); };
  J.loadBots = function () {
    return fetch('/api/auth/options', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      var b = d && d.bots, ok = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
      if (b && ok.test(b.legal || '')) J.bots.legal = b.legal;
      if (b && ok.test(b.auth || '')) J.bots.auth = b.auth;
      return d;
    }).catch(function () { return null; });
  };

  /* ---------- holat ---------- */
  J.S = { user: null, tariff: null, plans: null, sessions: [], persona: null, skillsMine: [] };
  try { J.S.persona = localStorage.getItem('jai-persona') || null; } catch (e) {}
  J.setPersona = function (p) { J.S.persona = p; try { localStorage.setItem('jai-persona', p); } catch (e) {} };

  J.isStaff = function () { var u = J.S.user; return !!(u && u.role && u.role !== 'user'); };
  J.balance = function () { return (J.S.tariff && J.S.tariff.balance) || {}; };
  J.planKey = function () {
    if (J.isStaff()) return 'staff';
    var b = J.balance(); if (b.kind === 'trial') return 'sinov';
    return (b.plan || (J.S.tariff && J.S.tariff.plan) || (J.S.tariff && J.S.tariff.userPlan && J.S.tariff.userPlan.plan) || 'none');
  };
  J.planLabel = function (k) { k = k || J.planKey(); var p = J.S.plans && J.S.plans[k]; return p && p.label ? p.label : ({ sinov: 'Sinov', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', staff: 'Staff', none: '—' })[k] || k; };
  J.svc = function (name) { var b = J.balance(); return b.services && b.services[name] ? b.services[name] : null; };
  /** Tarif tanlanmagan (yangi foydalanuvchi): tariflar oynasi majburiy. */
  J.needsPlan = function () { return !J.isStaff() && J.balance().kind === 'none'; };
  /** Sinov tugadi: savol limiti 0. */
  J.trialEnded = function () { var b = J.balance(); var c = J.svc('chat'); return !J.isStaff() && b.kind === 'trial' && c && c.remaining <= 0; };
  /** Xizmat tarifda bormi (masalan, Sinov'da hujjat yaratish yo'q). */
  J.hasService = function (name) {
    if (J.isStaff()) return true;
    var s = J.svc(name); return !!(s && s.limit > 0);
  };
  J.loadMe = async function () {
    var r = await J.api('/api/user-info'); if (!r.ok) return false;
    J.S.user = r.data;
    var t = await J.api('/api/tariff/me'); J.S.tariff = t.ok ? t.data : null;
    var p = await J.api('/api/tariff/plans', { allow401: true }); if (p.ok) { J.S.plans = p.data.plans || null; J.S.paymentsEnabled = !!p.data.paymentsEnabled; }
    return true;
  };
  J.refreshTariff = async function () { var t = await J.api('/api/tariff/me'); if (t.ok) { J.S.tariff = t.data; J.emit('tariff'); } return t.ok; };

  /* ---------- hodisalar ---------- */
  var subs = {};
  J.on = function (ev, fn) { (subs[ev] = subs[ev] || []).push(fn); };
  J.emit = function (ev, a) { (subs[ev] || []).forEach(function (fn) { try { fn(a); } catch (e) { console.error(e); } }); };

  /* ---------- belgilar (yupqa chiziqli) ---------- */
  var P = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.4A8 8 0 1 1 21 12Z"/>',
    scan: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="m18.3 18.3 2.2 2.2"/>',
    pen: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m10 17 5.5-5.5 1.5 1.5L11.5 18.5H10z"/>',
    spark: '<path d="M12 3l1.8 5.4a2 2 0 0 0 1.3 1.3L20.5 11.5l-5.4 1.8a2 2 0 0 0-1.3 1.3L12 20l-1.8-5.4a2 2 0 0 0-1.3-1.3L3.5 11.5l5.4-1.8a2 2 0 0 0 1.3-1.3z"/>',
    team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.2 6-5.2s5.4 1.8 6 5.2"/><circle cx="17" cy="8.5" r="2.6"/><path d="M16.4 14.9c2.4.2 4.1 1.8 4.6 4.6"/>',
    scale: '<path d="M12 3v18M6 21h12M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    clip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L14.5 7"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    word: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 12l1.2 5 1.3-3.5 1.3 3.5 1.2-5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    up: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
    out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2.2 2.2L15 10.4"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    slash: '<path d="M16 3 8 21"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    tg: '<path d="M21 4 3 11l6 2.5L11 20l3.5-4.5L19 18z"/><path d="M9 13.5 21 4"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    pause: '<path d="M8.5 5v14M15.5 5v14"/>',
    back5: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.6"/><path d="M4 4v4.6h4.6"/><text x="12" y="15.5" font-size="7" text-anchor="middle" stroke="none" fill="currentColor" font-family="sans-serif">5</text>',
    fwd5: '<path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.6"/><path d="M20 4v4.6h-4.6"/><text x="12" y="15.5" font-size="7" text-anchor="middle" stroke="none" fill="currentColor" font-family="sans-serif">5</text>'
  };
  J.icon = function (n, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || P.doc) + '</svg>'; };

  /* ---------- xabar va oynalar ---------- */
  var toastT;
  J.toast = function (msg, ms) {
    var old = J.$('.toast'); if (old) old.remove();
    var el = J.h('<div class="toast" role="status"></div>'); el.textContent = msg; document.body.appendChild(el);
    clearTimeout(toastT); toastT = setTimeout(function () { el.remove(); }, ms || 3200);
  };

  /* ---------- tanlov ro'yxati: brauzer select'i o'rniga ilova uslubidagi ro'yxat ----------
     Asl <select> formada qoladi (qiymat va 'change' hodisasi o'shandan), ko'rinishi almashtiriladi. */
  J.select = function (sel) {
    if (!sel || sel.dataset.enh) return; sel.dataset.enh = '1';
    var box = J.h('<div class="sel"><button type="button" class="sel-b" aria-haspopup="listbox" aria-expanded="false"><span class="sel-v"></span>' + J.icon('chev') + '</button></div>');
    sel.parentNode.insertBefore(box, sel); box.appendChild(sel); sel.hidden = true; sel.tabIndex = -1;
    var btn = J.$('.sel-b', box), val = J.$('.sel-v', box), pop = null, cur = 0;
    if (sel.style.cssText) box.style.cssText = sel.style.cssText;
    function label() { var o = sel.options[sel.selectedIndex]; val.textContent = o ? o.textContent : ''; box.classList.toggle('empty', !sel.value); }
    function close() { if (!pop) return; pop.remove(); pop = null; btn.setAttribute('aria-expanded', 'false'); box.classList.remove('open'); document.removeEventListener('mousedown', out, true); }
    function out(e) { if (!box.contains(e.target) && !(pop && pop.contains(e.target))) close(); }
    function hl(k) { var it = J.$$('.sel-o', pop); cur = Math.max(0, Math.min(it.length - 1, k)); it.forEach(function (x, i) { x.classList.toggle('hl', i === cur); }); if (it[cur]) it[cur].scrollIntoView({ block: 'nearest' }); }
    function pick(k) { if (sel.selectedIndex !== k) { sel.selectedIndex = k; label(); sel.dispatchEvent(new Event('change', { bubbles: true })); } close(); btn.focus(); }
    function open() {
      if (pop) return close();
      var opts = Array.prototype.slice.call(sel.options);
      pop = J.h('<div class="sel-pop" role="listbox"></div>');
      pop.innerHTML = opts.map(function (o, i) { return '<div class="sel-o' + (i === sel.selectedIndex ? ' on' : '') + '" role="option" data-i="' + i + '"><span></span>' + J.icon('check') + '</div>'; }).join('');
      J.$$('.sel-o span', pop).forEach(function (s, i) { s.textContent = opts[i].textContent; });
      J.$$('.sel-o', pop).forEach(function (x) { x.onmousedown = function (e) { e.preventDefault(); }; x.onclick = function () { pick(+x.dataset.i); }; x.onmousemove = function () { hl(+x.dataset.i); }; });
      document.body.appendChild(pop);
      var r = btn.getBoundingClientRect(), h = Math.min(320, opts.length * 38 + 12), below = innerHeight - r.bottom > h + 12;
      pop.style.left = r.left + 'px'; pop.style.minWidth = r.width + 'px'; pop.style.maxHeight = h + 'px';
      pop.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
      if (r.left + pop.offsetWidth > innerWidth - 8) pop.style.left = Math.max(8, innerWidth - 8 - pop.offsetWidth) + 'px';
      btn.setAttribute('aria-expanded', 'true'); box.classList.add('open'); hl(sel.selectedIndex);
      document.addEventListener('mousedown', out, true);
    }
    btn.onclick = open;
    btn.onkeydown = function (e) {
      if (!pop) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); hl(cur + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hl(cur - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(cur); }
      else if (e.key === 'Escape' || e.key === 'Tab') close();
    };
    window.addEventListener('resize', close); window.addEventListener('hashchange', close);
    J.$('.view') && J.$('.view').addEventListener('scroll', close, { passive: true });
    sel.addEventListener('change', label); label();
    box.refresh = label;
  };
  J.selects = function (root) { J.$$('select', root).forEach(J.select); };
  /** Oddiy oyna. opts: {html, cls, closable, onClose} → {el, close} */
  J.modal = function (opts) {
    var ovl = J.h('<div class="ovl" role="dialog" aria-modal="true"><div class="modal ' + (opts.cls || '') + '">' +
      (opts.closable === false ? '' : '<button class="ib modal-x" type="button" aria-label="' + J.esc(J.t('close')) + '">' + J.icon('x') + '</button>') +
      '<div class="modal-b"></div></div></div>');
    J.$('.modal-b', ovl).innerHTML = opts.html || '';
    function close() { ovl.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); }
    function onKey(e) { if (e.key === 'Escape' && opts.closable !== false) close(); }
    document.addEventListener('keydown', onKey);
    var x = J.$('.modal-x', ovl); if (x) x.onclick = close;
    if (opts.closable !== false) ovl.addEventListener('mousedown', function (e) { if (e.target === ovl) close(); });
    document.body.appendChild(ovl);
    return { el: ovl, body: J.$('.modal-b', ovl), close: close };
  };
  J.confirm = function (msg, okLabel) {
    return new Promise(function (ok) {
      var m = J.modal({ cls: 'sm', html: '<p style="font-size:16px;margin:4px 30px 18px 0"></p><div class="card-btns" style="display:flex;gap:8px;justify-content:flex-end"><button class="pill ghost" data-a="no">' + J.esc(J.t('cancel')) + '</button><button class="pill" data-a="ok">' + J.esc(okLabel || 'OK') + '</button></div>', onClose: function () { ok(false); } });
      J.$('p', m.body).textContent = msg;
      J.$('[data-a=no]', m.body).onclick = function () { m.close(); };
      J.$('[data-a=ok]', m.body).onclick = function () { ok(true); m.el.remove(); };
    });
  };

  /* ---------- markdown (xavfsiz) va manbalar ---------- */
  function inline(s) {
    // s allaqachon escape qilingan
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  }
  /** Javob matnini HTML'ga aylantiradi. Qaytaradi {html, sources:[{n,title,url}]}
      opts.answer: huquqiy javob ko'rinishi - "**Tahlil**" kabi yolg'iz qalin qator
      sarlavha, ⚠️ izohi kichik, Xulosa bo'limi och ko'k fonda (2026-10-27, egasi). */
  J.md = function (text, opts) {
    var ans = !!(opts && opts.answer);
    text = String(text || '')
      .replace(/<!--REASONING-->[\s\S]*?<!--\/REASONING-->\s*/g, '')
      .replace(/<!--YURXIZMAT-->[\s\S]*?<!--\/YURXIZMAT-->\s*/g, '');
    var sources = [], byUrl = {};
    function addSrc(title, url) {
      var key = url.replace(/#.*$/, '') + '|' + (url.split('#')[1] || '');
      if (byUrl[key]) return byUrl[key];
      // an iqtibos link reads "O'RQ-1137, 21-modda · lex.uz ↗": the list shows the act part
      // and one act unit cited twice (an iqtibos and the text) keeps one number
      title = String(title || '').replace(/\s*·?\s*(?:lex\.uz)?\s*↗\s*$/i, '').trim() || 'lex.uz';
      var tk = 't|' + title.toLowerCase();
      if (title !== 'lex.uz' && byUrl[tk]) return (byUrl[key] = byUrl[tk]);
      var n = sources.length + 1; sources.push({ n: n, title: title, url: url }); byUrl[key] = n; byUrl[tk] = n; return n;
    }
    // "Manbalar:" pastki qismi — manba sifatida olinadi, matndan olib tashlanadi
    var foot = text.match(/(?:^|\n)\s*(?:---\s*\n\s*)?(?:#{1,6}\s*)?(?:\*{0,2})\s*(?:📎\s*)?(?:Manbalar|Источники|Sources)\s*(?:\*{0,2})\s*:?\s*([\s\S]*)$/iu);
    if (foot) {
      foot[1].replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, t, u) { addSrc(t, u); return m; });
      text = text.slice(0, foot.index);
    }
    var lines = J.esc(text).split('\n'), out = [], i = 0;
    function unesc(x) { return x.replace(/&(amp|lt|gt|quot|#39);/g, function (m, e) { return { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]; }); }
    // a link's own text: inline marks kept inside it, a stray "**" dropped; the
    // source list and the cite title get plain text (2026-10-27: "<b>Mehnat
    // kodeksi..." and "</b>...1-qism**" showed in the source chips)
    function links(s) {
      return s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, t, u) {
        var url = u.replace(/&amp;/g, '&');
        var shown = inline(t).replace(/\*\*/g, '');
        var plain = shown.replace(/<[^>]*>/g, '').trim();
        // the line was escaped before parsing: the list gets the act's own letters
        // (2026-10-28: "Mas&#39;uliyati" showed in the sources list), esc() on display
        if (/lex\.uz/i.test(url)) { var n = addSrc(unesc(plain), url); return '<a href="' + J.esc(url) + '" target="_blank" rel="noopener">' + shown + '</a><a class="cite" href="#" data-src="' + n + '" title="' + plain + '">' + n + '</a>'; }
        return '<a href="' + J.esc(url) + '" target="_blank" rel="noopener">' + shown + '</a>';
      });
    }
    // links are set aside before bold / italic, so a "**" outside a link never
    // pairs with one inside it, then put back
    function rich(s) {
      var kept = [];
      var held = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m) { kept.push(m); return '\u0000' + (kept.length - 1) + '\u0000'; });
      return inline(held).replace(/\u0000(\d+)\u0000/g, function (m, k) { return links(kept[+k]); });
    }
    var HEAD_ONLY = /^\s*\*\*([^*]{2,40}?)\s*:?\s*\*\*\s*:?\s*$/;
    var NOTE = /^\s*(?:⚠️|⚠|ℹ️)/;
    function para(buf) {
      if (!buf.length) return;
      if (ans) {
        var hh = buf[0].match(HEAD_ONLY);
        if (hh) { out.push('<h3 class="ans-h">' + rich(hh[1]) + '</h3>'); buf = buf.slice(1); if (!buf.length) return; }
        if (NOTE.test(buf[0])) { out.push('<p class="ans-note">' + rich(buf.join('<br>')) + '</p>'); return; }
      }
      out.push('<p>' + rich(buf.join('<br>')) + '</p>');
    }
    var buf = [];
    while (i < lines.length) {
      var l = lines[i];
      var hm = l.match(/^(#{1,6})\s+(.*)$/);
      if (/^\s*$/.test(l)) { para(buf); buf = []; i++; continue; }
      if (hm) { para(buf); buf = []; var lv = Math.min(4, Math.max(2, hm[1].length)); out.push('<h' + lv + '>' + rich(hm[2]) + '</h' + lv + '>'); i++; continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(l)) { para(buf); buf = []; out.push('<hr>'); i++; continue; }
      if (/^\s*&gt;\s?/.test(l)) {
        para(buf); buf = []; var q = [];
        while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++; }
        if (ans && NOTE.test(q[0])) out.push('<p class="ans-note">' + rich(q.join('<br>')) + '</p>');
        else out.push('<blockquote>' + rich(q.join('<br>')) + '</blockquote>');
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        para(buf); buf = [];
        var head = l.trim().replace(/^\||\|$/g, '').split('|'); i += 2; var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|')); i++; }
        out.push('<div class="tbl-wrap"><table><thead><tr>' + head.map(function (c) { return '<th>' + rich(c.trim()) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + rich(c.trim()) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        para(buf); buf = [];
        var ordered = /^\s*\d+[.)]\s+/.test(l), items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++; }
        var tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + items.map(function (x) { return '<li>' + rich(x) + '</li>'; }).join('') + '</' + tag + '>');
        continue;
      }
      buf.push(l); i++;
    }
    para(buf);
    if (ans) {
      // Xulosa: sarlavhasidan keyingi sarlavha, izoh yoki chiziqqacha
      var k = out.findIndex(function (x) { return /^<h\d/.test(x) && /^(?:xulosa|вывод|заключение|conclusion)\b/i.test(x.replace(/<[^>]*>/g, '').trim()); });
      if (k >= 0) {
        var j = k + 1;
        while (j < out.length && !/^<h\d|^<hr|class="ans-note"/.test(out[j])) j++;
        out.splice(k, j - k, '<section class="ans-sum">' + out.slice(k, j).join('') + '</section>');
      }
    }
    return { html: out.join(''), sources: sources };
  };
  /** Mikrofon yozayotganini ko'rsatadi (2026-10-28, egasi): qizil nuqta, ovoz balandligi
      bo'yicha 5 ta ustun va vaqt. host ichiga chiziladi; stop() hammasini to'xtatadi. */
  J.micMeter = function (stream, host, opts) {
    opts = opts || {};
    var el = J.h('<span class="mic-meter" role="status" aria-live="polite"><i class="mic-dot"></i><span class="mic-bars"><b></b><b></b><b></b><b></b><b></b></span><span class="mic-time">0:00</span>' + (opts.label ? '<span class="mic-lab"></span>' : '') + '</span>');
    if (opts.label) J.$('.mic-lab', el).textContent = opts.label;
    host.appendChild(el);
    var bars = J.$$('.mic-bars b', el), time = J.$('.mic-time', el), started = Date.now(), raf = 0, actx = null, an = null, data = null, level = 0;
    try {
      actx = new (G.AudioContext || G.webkitAudioContext)();
      an = actx.createAnalyser(); an.fftSize = 512; data = new Uint8Array(an.fftSize);
      actx.createMediaStreamSource(stream).connect(an);
      // made after an await (getUserMedia), the context may start suspended
      if (actx.state === 'suspended' && actx.resume) actx.resume().catch(function () {});
    } catch (e) { an = null; }
    var weights = [0.55, 0.8, 1, 0.8, 0.55];
    function frame() {
      if (an) {
        an.getByteTimeDomainData(data);
        var sum = 0; for (var i = 0; i < data.length; i++) { var v = (data[i] - 128) / 128; sum += v * v; }
        var rms = Math.sqrt(sum / data.length);
        // a little smoothing so the bars move with the voice, not with every sample
        level = Math.max(rms * 3.2, level * 0.82); if (level > 1) level = 1;
      }
      bars.forEach(function (b, i) { b.style.transform = 'scaleY(' + Math.max(0.18, Math.min(1, level * weights[i] * (0.85 + Math.random() * 0.3))).toFixed(2) + ')'; });
      var s = Math.floor((Date.now() - started) / 1000); time.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
      raf = G.requestAnimationFrame(frame);
    }
    frame();
    return { el: el, level: function () { return level; }, stop: function () { G.cancelAnimationFrame(raf); if (actx) actx.close().catch(function () {}); el.remove(); } };
  };
  /** Matndagi barcha lex.uz havolalari (oqim paytida ham) */
  J.plain = function (html) { var d = document.createElement('div'); d.innerHTML = html; return d.innerText; };

  /* ---------- hujjat HTML'ini tozalash ----------
     AI yozgan hujjat (xulosa, loyiha) o'z ko'rinishini saqlaydi, kod ishga tushiradigan hamma narsa
     olib tashlanadi: script, svg, iframe, img, hodisa atributlari, javascript: havolalar, murakkab style.
     Eski dashboarddagi sanitizeDocHtml bilan bir xil ro'yxat; server ham tozalaydi (src/rag/safe-html.js). */
  var SAFE_DOC_TAGS = { P: 1, DIV: 1, SPAN: 1, BR: 1, HR: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, SUP: 1, SUB: 1, SMALL: 1,
    UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, CODE: 1, TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1, COLGROUP: 1, COL: 1, A: 1 };
  var DROP_DOC = /^(SCRIPT|STYLE|TEMPLATE|IFRAME|FRAME|FRAMESET|OBJECT|EMBED|NOSCRIPT|TEXTAREA|SELECT|BUTTON|INPUT|FORM|LINK|META|BASE|SVG|MATH|AUDIO|VIDEO|SOURCE|IMG|CANVAS|TITLE|HEAD)$/;
  var SAFE_DOC_STYLE = /^(text-align|font-weight|font-style|text-decoration|text-indent|line-height|margin(-top|-bottom|-left|-right)?|padding(-top|-bottom|-left|-right)?|width|border(-collapse)?|vertical-align)\s*:\s*[-#%.,\w\s]*$/i;
  J.cleanHtml = function (html) {
    if (html == null || html === '') return '';
    var tpl = document.createElement('template');
    tpl.innerHTML = String(html);
    (function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 1 && DROP_DOC.test(c.tagName.toUpperCase())) { c.remove(); return; }
        if (c.nodeType === 1) {
          clean(c);
          var tag = c.tagName.toUpperCase();
          if (!SAFE_DOC_TAGS[tag]) { c.replaceWith.apply(c, Array.prototype.slice.call(c.childNodes)); return; }
          Array.prototype.slice.call(c.attributes).forEach(function (a) {
            var n = a.name.toLowerCase(), keep = false;
            if (n === 'class' || n === 'colspan' || n === 'rowspan' || n === 'align') keep = /^[-\w\s]*$/.test(a.value);
            else if (n === 'data-label' || n === 'data-hint' || n === 'data-key' || n === 'data-k') keep = true;
            else if (n === 'style') {
              var ok = a.value.split(';').map(function (x) { return x.trim(); }).filter(function (x) { return x && SAFE_DOC_STYLE.test(x); });
              if (ok.length) { c.setAttribute('style', ok.join('; ')); return; }
            } else if (n === 'href' && tag === 'A') keep = /^(https?:\/\/|\/(?![\/\\])|#)/i.test(a.value.trim());
            if (!keep) c.removeAttribute(a.name);
          });
          if (tag === 'A') { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
        } else if (c.nodeType !== 3) c.remove();
      });
    })(tpl.content);
    return tpl.innerHTML;
  };

  /* ---------- Word eksport (server: /api/draft/export-raw) ---------- */
  /** Chop etish oynasi: tozalangan hujjat + oddiy bezak (serverning HTML'i ishlatilmaydi). */
  J.printPage = function (title, html) {
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + J.esc(title || 'JuristAI') + '</title><style>body{font:12pt/1.5 "Times New Roman",serif;max-width:780px;margin:24px auto;color:#111}h1,h2,h3{line-height:1.25}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;vertical-align:top}a{color:#1a4fc4}</style></head><body>' + J.cleanHtml(html) + '</body></html>';
  };
  J.exportWord = async function (title, html) {
    html = J.cleanHtml(html);
    var r = await J.api('/api/draft/export-raw', { method: 'POST', body: { title: title, html: html, format: 'docx', lang: J.lang }, raw: true });
    if (!r.ok) { J.toast(J.t('err.generic')); return; }
    var ct = r.res.headers.get('Content-Type') || '';
    if (ct.indexOf('json') > -1) {                    // server PDF/DOCX yarata olmadi: brauzer chop etadi
      var w = window.open('', '_blank'); if (w) { w.document.write(J.printPage(title, html)); w.document.close(); w.print(); } return;
    }
    var blob = await r.res.blob(); var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = (title || 'JuristAI').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.docx';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  /* ---------- marshrut ---------- */
  var routes = [];
  J.route = function (pattern, fn) { routes.push({ re: pattern, fn: fn }); };
  J.go = function (hash) { if (location.hash === hash) J.render(); else location.hash = hash; };
  J.render = function () {
    var h = location.hash.replace(/^#/, '') || '/';
    for (var k = 0; k < routes.length; k++) { var m = h.match(routes[k].re); if (m) { routes[k].fn.apply(null, m.slice(1)); J.emit('route', h); return; } }
    routes[0].fn(); J.emit('route', '/');
  };
  G.addEventListener('hashchange', function () { J.render(); });
})(window);
