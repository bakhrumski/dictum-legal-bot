/* Word panelini akkauntga ulash: kirgan foydalanuvchi Word'da ko'rsatilgan kodni tasdiqlaydi.
   POST /api/addin/pair/approve, GET /api/addin/connections, POST /api/addin/connections/revoke-all */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var params = new URLSearchParams(location.search);
  var code = (params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  function view(v) { ['vLoad', 'vAsk', 'vDone'].forEach(function (id) { $('#' + id).hidden = id !== v; }); }
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); });
  }
  function connections() {
    fetch('/api/addin/connections', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      $('#foot').hidden = false;
      $('#conn').textContent = d.n ? 'Ulangan Word nusxalari: ' + d.n + '. ' : "Hozircha ulangan Word yo'q. ";
      $('#revoke').hidden = !d.n;
    }).catch(function () {});
  }

  fetch('/api/user-info', { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) {
      location.replace('/app/kirish.html?redirect=' + encodeURIComponent(location.pathname + location.search));
      return null;
    }
    return r.json();
  }).then(function (u) {
    if (!u) return;
    $('#acc').textContent = u.fullName || u.username || '';
    $('#code').value = code;
    view('vAsk');
    connections();
    if (!code) $('#code').focus();
  }).catch(function () { $('#vLoad').innerHTML = '<p class="err">Server bilan aloqa yo‘q. Sahifani yangilang.</p>'; });

  $('#go').onclick = function () {
    var c = $('#code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 6) { $('#err').textContent = 'Kod 6 ta belgidan iborat.'; $('#err').hidden = false; return; }
    var btn = this; btn.disabled = true; $('#err').hidden = true;
    post('/api/addin/pair/approve', { code: c }).then(function (r) {
      btn.disabled = false;
      if (r.ok) { view('vDone'); connections(); return; }
      $('#err').textContent = r.data.message || r.data.error || ('Xato ' + r.status);
      $('#err').hidden = false;
    }).catch(function () { btn.disabled = false; $('#err').textContent = "Server bilan aloqa yo'q."; $('#err').hidden = false; });
  };
  $('#code').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#go').click(); });
  $('#revoke').onclick = function () {
    if (!confirm("Barcha kompyuterlardagi Word panellari akkauntdan uziladi. Davom etasizmi?")) return;
    post('/api/addin/connections/revoke-all').then(function () { connections(); });
  };
})();
