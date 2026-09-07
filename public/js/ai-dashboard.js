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

  var TABS = ['home', 'jamoa', 'chat', 'ai', 'sorov'];

  var state = { theme: 'light', tab: 'home' };
  try {
    if (localStorage.getItem('dictum-theme') === 'dark') state.theme = 'dark';
    var savedTab = localStorage.getItem('juristai-db-tab');
    if (TABS.indexOf(savedTab) >= 0) state.tab = savedTab;
  } catch (e) { /* private mode: defaults stand */ }

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

  applyTheme();
  applyTab();
})();
