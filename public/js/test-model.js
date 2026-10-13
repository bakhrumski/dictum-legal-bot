/* A master's own test model (2026-10-13; server side: src/ai/test-model.js).
 *
 * Only an account the server confirms as master gets the "🧪 Sinov modeli"
 * picker (GET /api/admin/test-models answers masters only). The choice is
 * kept for this tab (sessionStorage) and sent as X-JAI-Test-Model on this
 * page's own API requests; the server checks the master role in the database
 * on every request and ignores the header for anyone else. "Standart" sends
 * nothing: the production model answers. Customers are never affected. */
(function () {
  'use strict';
  var KEY = 'jai.testModel';
  var HEADER = 'X-JAI-Test-Model';

  function chosen() {
    try { return sessionStorage.getItem(KEY) || ''; } catch (_) { return ''; }
  }
  function choose(v) {
    try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (_) { /* private mode: not kept */ }
  }

  // this page's own API requests only (same origin, /api/)
  function ownApi(url) {
    try {
      var u = new URL(url, location.href);
      return u.origin === location.origin && u.pathname.indexOf('/api/') === 0 && u.pathname !== '/api/admin/test-models';
    } catch (_) { return false; }
  }

  var nativeFetch = window.fetch && window.fetch.bind(window);
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var model = chosen();
      var url = typeof input === 'string' ? input : (input && input.url);
      if (!model || !url || !ownApi(url)) return nativeFetch(input, init);
      init = init ? Object.assign({}, init) : {};
      var headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || undefined);
      headers.set(HEADER, model);
      init.headers = headers;
      return nativeFetch(input, init);
    };
  }

  function build(models) {
    if (document.getElementById('jaiTestModel')) return;
    var box = document.createElement('div');
    box.id = 'jaiTestModel';
    box.className = 'jai-tm';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Sinov modeli (faqat master)');
    var sel = document.createElement('select');
    sel.id = 'jaiTestModelSelect';
    // a native select: the redesign's custom dropdown (no-jai-select opts out)
    // is too tall for a corner control
    sel.className = 'jai-tm-select no-jai-select';
    sel.setAttribute('aria-label', 'Sinov modeli (faqat master)');
    var std = document.createElement('option');
    std.value = '';
    std.textContent = '🧪 Standart model';
    sel.appendChild(std);
    models.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id;
      o.textContent = '🧪 ' + m.label;
      sel.appendChild(o);
    });
    var known = models.some(function (m) { return m.id === chosen(); });
    if (!known) choose('');
    sel.value = chosen();
    var paint = function () { box.classList.toggle('jai-tm-on', !!sel.value); box.title = sel.value ? 'Sizning so‘rovlaringizga ' + sel.value + ' javob beradi (faqat shu tabda; mijozlarga ta’sir qilmaydi)' : 'Production modeli'; };
    sel.addEventListener('change', function () { choose(sel.value); paint(); });
    box.appendChild(sel);
    document.body.appendChild(box);
    paint();
  }

  function start() {
    if (!nativeFetch) return;
    nativeFetch('/api/admin/test-models', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && Array.isArray(d.models) && d.models.length) build(d.models); else choose(''); })
      .catch(function () { /* not a master, or offline: no picker */ });
  }

  var css = document.createElement('style');
  css.textContent =
    // above the bottom tab bar (redesign-v2.css: 14px / 8px from the bottom);
    // beside it on wide screens, where the bar is centred and narrower
    '.jai-tm{position:fixed;left:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:9000;display:flex;align-items:center;' +
    'padding:3px;border-radius:999px;background:rgba(20,22,28,.9);color:#e8e8ea;font:500 12px/1.2 var(--font-sans,system-ui,sans-serif);' +
    'box-shadow:0 4px 14px rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.12)}' +
    '@media (min-width:1200px){.jai-tm{bottom:calc(24px + env(safe-area-inset-bottom,0px))}}' +
    '.jai-tm-on{background:#7a4b00;border-color:#f0a020}' +
    '.jai-tm-select{font:inherit;color:inherit;background:transparent;border:0;border-radius:999px;padding:4px 6px;max-width:170px;cursor:pointer}' +
    '.jai-tm-select:focus-visible{outline:2px solid #f0a020;outline-offset:1px}' +
    '.jai-tm-select option{color:#111;background:#fff}' +
    '@media print{.jai-tm{display:none}}';
  document.head.appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
