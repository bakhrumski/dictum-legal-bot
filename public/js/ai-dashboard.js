/* ============================================================
   JuristAI application shell behaviour.

   Ported from the logic class in public/preview/dashboard.dc.html. At this
   stage the shell only has to do two things the prototype does: switch
   theme, and switch tab. The sections behind the tabs come later, along
   with the data they read.
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('db-root');
  if (!root) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  var DATA = window.DB_DATA || {};
  var TABS = ['home', 'jamoa', 'chat', 'ai', 'sorov'];

  var state = { theme: 'light', tab: 'home', view: 'priority' };
  try {
    if (localStorage.getItem('dictum-theme') === 'dark') state.theme = 'dark';
    var savedTab = localStorage.getItem('juristai-db-tab');
    if (TABS.indexOf(savedTab) >= 0) state.tab = savedTab;
  } catch (e) { /* private mode: defaults stand */ }

  /* -- Small DOM helpers ------------------------------------- */
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function svg(paths, size, width) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', size || 20); s.setAttribute('height', size || 20);
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', width || 2);
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    paths.forEach(function (d) {
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }

  // A tab named in the URL wins over the stored one, so a link can open a
  // particular section.
  var fromHash = (location.hash || '').replace('#', '');
  if (TABS.indexOf(fromHash) >= 0) state.tab = fromHash;

  function applyTheme() {
    var dark = state.theme === 'dark';
    root.setAttribute('data-theme', state.theme);
    $$('[data-wordmark-light]').forEach(function (el) { el.hidden = dark; });
    $$('[data-wordmark-dark]').forEach(function (el) { el.hidden = !dark; });
    var light = $('[data-theme-icon="light"]');
    var night = $('[data-theme-icon="dark"]');
    if (light) light.hidden = dark;
    if (night) night.hidden = !dark;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#060814' : '#f6f8fc');
    try { localStorage.setItem('dictum-theme', state.theme); } catch (e) { /* ignore */ }
  }

  function applyTab() {
    $$('[data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === state.tab;
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $$('[data-panel]').forEach(function (p) {
      var on = p.getAttribute('data-panel') === state.tab;
      if (on) p.setAttribute('data-active', '');
      else p.removeAttribute('data-active');
    });
    if (history.replaceState) history.replaceState(null, '', '#' + state.tab);
    try { localStorage.setItem('juristai-db-tab', state.tab); } catch (e) { /* ignore */ }
  }

  $$('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.tab = b.getAttribute('data-tab');
      applyTab();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  var themeBtn = $('[data-theme-toggle]');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });

  /* ============================================================
     Asosiy — counters, service health, and the work queue
     ============================================================ */
  function renderBits() {
    var host = $('[data-bits]');
    if (!host || !DATA.stateBits) return;
    var max = Math.max.apply(null, DATA.stateBits.map(function (b) { return b.n; }));
    host.textContent = '';
    DATA.stateBits.forEach(function (b) {
      var fill = el('span', { class: 'db-bit-fill', style: 'width:' + Math.round((b.n / max) * 100) + '%; background:' + b.tone + ';' });
      var btn = el('button', { class: 'db-bit', type: 'button', title: b.label }, [
        el('span', { class: 'db-bit-top' }, [
          el('b', { class: 'db-bit-n', 'data-mono': true, text: String(b.n), style: 'color:' + b.tone + ';' }),
          el('span', { class: 'db-bit-label', text: b.label })
        ]),
        el('span', { class: 'db-bit-track' }, [fill])
      ]);
      btn.addEventListener('click', function () { state.view = b.view; renderQueue(); });
      host.appendChild(btn);
    });
  }

  function renderHealth() {
    var host = $('[data-health]');
    if (!host || !DATA.health) return;
    host.textContent = '';
    DATA.health.forEach(function (h) {
      host.appendChild(el('div', { class: 'db-health-item' }, [
        el('span', { class: 'db-health-dot', style: 'background:' + h.color + ';' }),
        el('span', { text: h.label }),
        el('strong', { 'data-mono': true, text: h.value })
      ]));
    });
  }

  function renderQueue() {
    var chips = $('[data-views]');
    if (chips && DATA.views) {
      chips.textContent = '';
      DATA.views.forEach(function (v) {
        var b = el('button', {
          class: 'db-chip', type: 'button', text: v[1],
          'aria-pressed': String(state.view === v[0])
        });
        b.addEventListener('click', function () { state.view = v[0]; renderQueue(); });
        chips.appendChild(b);
      });
    }
    var sum = $('[data-queue-summary]');
    if (sum) sum.textContent = (DATA.summary || {})[state.view] || '';

    var host = $('[data-rows]');
    if (!host || !DATA.rows) return;
    host.textContent = '';
    if (!DATA.rows.length) {
      host.appendChild(el('div', { class: 'db-empty', text: 'Bu ko‘rinishda murojaat yo‘q.' }));
      return;
    }
    DATA.rows.forEach(function (r) {
      var status = (DATA.statusStyle || {})[r.status] || ['var(--muted)'];
      host.appendChild(el('article', { class: 'db-row', 'data-r': 'row' }, [
        el('span', { class: 'db-row-dot', title: r.urgency, style: 'background:' + (DATA.urgency || {})[r.urgency] + ';' }),
        el('div', { style: 'min-width:0;' }, [
          el('div', { class: 'db-row-title', text: r.title }),
          el('div', { class: 'db-row-meta' }, [
            el('span', { text: r.category }),
            el('span', { text: r.channel }),
            el('span', { text: r.assignee })
          ])
        ]),
        el('div', { class: 'db-row-person', 'data-r': 'row-person' }, [
          el('strong', { text: r.person }),
          el('span', { text: r.username })
        ]),
        el('div', { class: 'db-row-time', 'data-r': 'row-time' }, [
          el('strong', { text: r.age }),
          el('span', { text: r.time })
        ]),
        el('span', { class: 'db-row-status', text: r.status, style: 'color:' + status[0] + ';' })
      ]));
    });
  }

  applyTheme();
  applyTab();
  renderBits();
  renderHealth();
  renderQueue();
})();
