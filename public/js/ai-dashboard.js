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
    // The graph measures its container, which has no width until its tab is
    // on screen, so its layout waits for that moment.
    if (state.tab === 'jamoa') { measureBar(); ensureLayout(); }
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

  /* ============================================================
     Workspace

     Three views over the same matters. The graph is the involved one: it
     lays cards out in owner groups, draws a curve from each card to its
     owner, lets both be dragged, and pushes overlapping boxes apart once a
     drag ends. Geometry and constants are the prototype's.
     ============================================================ */
  var MEMBERS = DATA.wsMembers || [];
  var MATTERS = DATA.matters || [];
  var SZ = DATA.graphSizes || { CARD_W: 168, CARD_H: 158, NODE_W: 152, NODE_H: 98 };
  var TONE = DATA.tone || {};

  var ws = {
    view: 'graph',
    pos: null,        // id -> {x,y}
    contentH: 0,
    dragId: null,
    drag: null,
    laidFor: null,
    laidW: 0,
    dragged: false,
    saved: {}         // matter id -> [{label, when}]
  };
  try {
    var savedView = localStorage.getItem('juristai-ws-view');
    if (['graph', 'timeline', 'list'].indexOf(savedView) >= 0) ws.view = savedView;
  } catch (e) { /* ignore */ }

  var wsBar = $('[data-ws-bar]');
  var wsGraph = $('[data-ws-graph]');
  var wsScroll = $('[data-ws-scroll]');
  var wsPaths = $('[data-ws-paths]');

  var isMember = function (id) { return MEMBERS.some(function (u) { return u.id === id; }); };
  var sizeOf = function (id) {
    return isMember(id) ? { w: SZ.NODE_W, h: SZ.NODE_H } : { w: SZ.CARD_W, h: SZ.CARD_H };
  };
  var member = function (id) { return MEMBERS.filter(function (u) { return u.id === id; })[0] || {}; };
  var posOf = function (id) { return (ws.pos && ws.pos[id]) || { x: -9999, y: -9999 }; };

  /* -- Toolbar ----------------------------------------------- */
  function renderWsViews() {
    var host = $('[data-ws-views]');
    if (!host || !DATA.wsViews) return;
    host.textContent = '';
    DATA.wsViews.forEach(function (v) {
      var b = el('button', {
        class: 'ws-viewbtn', type: 'button', title: v.label,
        'aria-pressed': String(ws.view === v.id)
      }, [svg(v.icon, 15, 1.9), el('span', { class: 'ws-barlabel', text: v.label })]);
      b.addEventListener('click', function () { setWsView(v.id); });
      host.appendChild(b);
    });
  }

  function setWsView(id) {
    ws.view = id;
    $$('[data-ws-view]').forEach(function (p) {
      if (p.getAttribute('data-ws-view') === id) p.setAttribute('data-active', '');
      else p.removeAttribute('data-active');
    });
    renderWsViews();
    try { localStorage.setItem('juristai-ws-view', id); } catch (e) { /* ignore */ }
    if (id === 'graph') { ws.laidFor = null; ensureLayout(); }
  }

  // The toolbar keeps its labels while there is room for them.
  function measureBar() {
    if (!wsBar) return;
    if (wsBar.clientWidth && wsBar.clientWidth < 560) wsBar.setAttribute('data-narrow', '');
    else wsBar.removeAttribute('data-narrow');
  }

  var wsMenu = $('[data-ws-menu]');
  var wsMenuToggle = $('[data-ws-menu-toggle]');
  if (wsMenuToggle && wsMenu) {
    wsMenuToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = wsMenu.hidden;
      wsMenu.hidden = !open;
      wsMenuToggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('pointerdown', function (e) {
      if (wsMenu.hidden) return;
      if (wsMenu.contains(e.target) || wsMenuToggle.contains(e.target)) return;
      wsMenu.hidden = true;
      wsMenuToggle.setAttribute('aria-expanded', 'false');
    }, true);
  }

  function renderLegend() {
    var host = $('[data-ws-legend]');
    if (!host || !DATA.wsLegend) return;
    host.textContent = '';
    DATA.wsLegend.forEach(function (l) {
      host.appendChild(el('span', { class: 'ws-legend-item' }, [
        el('span', { class: 'ws-legend-dot', style: 'background:' + TONE[l[1]] + ';' }),
        el('span', { text: l[0] })
      ]));
    });
  }

  /* -- Graph: layout ----------------------------------------
     One band of cards, grouped by owner, with each owner's avatar centred
     under their own group. If the band does not fit, the gaps shrink; if
     it still does not fit, it wraps into rows. */
  function layout() {
    if (!wsGraph || !wsGraph.clientWidth) return null;
    var w = wsGraph.clientWidth;
    var view = wsScroll ? wsScroll.clientHeight : 460;
    var groups = MEMBERS.map(function (u) {
      return { u: u, ms: MATTERS.filter(function (m) { return m.owner === u.id; }) };
    }).filter(function (g) { return g.ms.length; });
    var n = MATTERS.length;
    var edge = 10;
    var gap = 14, gGap = 46;
    var fits = function (g1, g2) {
      return n * SZ.CARD_W + (n - groups.length) * g1 + (groups.length - 1) * g2 + edge * 2 <= w;
    };
    if (!fits(gap, gGap)) { gap = 10; gGap = 30; }
    if (!fits(gap, gGap)) { gap = 6; gGap = 18; }

    var out = {};
    if (fits(gap, gGap)) {
      var total = n * SZ.CARD_W + (n - groups.length) * gap + (groups.length - 1) * gGap;
      var x = Math.round((w - total) / 2);
      var cardY = 14;
      var nodeY = cardY + SZ.CARD_H + 26;
      groups.forEach(function (g) {
        var start = x;
        g.ms.forEach(function (m, j) {
          out[m.id] = { x: Math.round(x), y: cardY };
          x += SZ.CARD_W + (j < g.ms.length - 1 ? gap : 0);
        });
        var bandW = x - start;
        out[g.u.id] = { x: Math.round(start + bandW / 2 - SZ.NODE_W / 2), y: nodeY };
        x += gGap;
      });
      var h = Math.max(view, nodeY + SZ.NODE_H + 16);
      Object.keys(out).forEach(function (id) {
        var s = sizeOf(id);
        out[id] = {
          x: Math.round(Math.max(0, Math.min(out[id].x, w - s.w))),
          y: Math.round(Math.max(0, Math.min(out[id].y, h - s.h)))
        };
      });
      return { pos: out, h: h };
    }

    var per = Math.max(1, Math.floor((w - edge * 2 + gap) / (SZ.CARD_W + gap)));
    var row = 0, col = 0;
    var rowH = SZ.CARD_H + 26 + SZ.NODE_H + 22;
    groups.forEach(function (g) {
      if (col && col + g.ms.length > per) { row++; col = 0; }
      var startCol = col;
      g.ms.forEach(function (m) {
        out[m.id] = { x: Math.round(edge + col * (SZ.CARD_W + gap)), y: 14 + row * rowH };
        col++;
      });
      var segW = (col - startCol) * SZ.CARD_W + (col - startCol - 1) * gap;
      out[g.u.id] = {
        x: Math.round(edge + startCol * (SZ.CARD_W + gap) + segW / 2 - SZ.NODE_W / 2),
        y: 14 + row * rowH + SZ.CARD_H + 26
      };
      if (col >= per) { row++; col = 0; }
    });
    var h2 = Math.max(view, 14 + (row + (col ? 1 : 0)) * rowH);
    Object.keys(out).forEach(function (id) {
      var s = sizeOf(id);
      out[id] = {
        x: Math.round(Math.max(0, Math.min(out[id].x, w - s.w))),
        y: Math.round(Math.max(0, out[id].y))
      };
    });
    return { pos: out, h: h2 };
  }

  function ensureLayout() {
    if (!wsGraph || !wsGraph.clientWidth) return;
    var key = wsGraph.clientWidth + 'x' + (wsScroll ? wsScroll.clientHeight : 0);
    if (ws.laidFor === key) return;
    // A dragged arrangement survives anything but a width change.
    if (ws.dragged && ws.pos && ws.laidW === wsGraph.clientWidth) { ws.laidFor = key; return; }
    ws.laidW = wsGraph.clientWidth;
    var L = layout();
    if (!L) return;
    ws.laidFor = key;
    ws.pos = L.pos;
    ws.contentH = L.h;
    separate();
  }

  /* -- Graph: keep boxes off each other ----------------------
     Pairwise, along whichever axis they overlap least, splitting the push
     between the two and handing the remainder to whichever has room. */
  function separate() {
    if (!wsGraph) return;
    var width = wsGraph.getBoundingClientRect().width;
    var ids = MATTERS.map(function (m) { return m.id; }).concat(MEMBERS.map(function (u) { return u.id; }));
    var pos = {};
    Object.keys(ws.pos || {}).forEach(function (k) { pos[k] = { x: ws.pos[k].x, y: ws.pos[k].y }; });
    ids.forEach(function (id) { if (!pos[id]) pos[id] = { x: posOf(id).x, y: posOf(id).y }; });
    var pad = 12;
    var clampAll = function () {
      ids.forEach(function (id) {
        var s = sizeOf(id);
        pos[id].x = Math.max(0, Math.min(pos[id].x, Math.max(0, width - s.w)));
        pos[id].y = Math.max(0, pos[id].y);
      });
    };
    clampAll();
    for (var it = 0; it < 120; it++) {
      var moved = false;
      for (var a = 0; a < ids.length; a++) {
        for (var b = a + 1; b < ids.length; b++) {
          var ia = ids[a], ib = ids[b];
          var sa = sizeOf(ia), sb = sizeOf(ib);
          var pa = pos[ia], pb = pos[ib];
          var ox = Math.min(pa.x + sa.w + pad, pb.x + sb.w + pad) - Math.max(pa.x, pb.x);
          var oy = Math.min(pa.y + sa.h + pad, pb.y + sb.h + pad) - Math.max(pa.y, pb.y);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (ox < oy) {
            var loX = pa.x <= pb.x ? pa : pb, hiX = pa.x <= pb.x ? pb : pa;
            var hiSz = pa.x <= pb.x ? sb : sa;
            var room = Math.max(0, width - hiSz.w - hiX.x);
            var loRoom = loX.x;
            var toLo = ox / 2, toHi = ox / 2;
            if (loRoom < toLo) { toHi += toLo - loRoom; toLo = loRoom; }
            if (room < toHi) { toLo = Math.min(loRoom, toLo + (toHi - room)); toHi = room; }
            loX.x -= toLo; hiX.x += toHi;
          } else {
            var loY = pa.y <= pb.y ? pa : pb, hiY = pa.y <= pb.y ? pb : pa;
            var tLo = oy / 2, tHi = oy / 2;
            if (loY.y < tLo) { tHi += tLo - loY.y; tLo = loY.y; }
            loY.y -= tLo; hiY.y += tHi;
          }
        }
      }
      clampAll();
      if (!moved) break;
    }
    var maxY = 0;
    ids.forEach(function (id) {
      var s = sizeOf(id);
      pos[id] = {
        x: Math.round(Math.max(0, Math.min(pos[id].x, width - s.w))),
        y: Math.round(Math.max(0, pos[id].y))
      };
      maxY = Math.max(maxY, pos[id].y + s.h);
    });
    ws.pos = pos;
    ws.contentH = Math.max(ws.contentH || 0, maxY + 16);
    paintGraph();
  }

  /* -- Graph: drag ------------------------------------------ */
  function startDrag(id, e) {
    if (!wsGraph) return;
    e.preventDefault();
    var r = wsGraph.getBoundingClientRect();
    if (!ws.pos || !Object.keys(ws.pos).length) {
      var L = layout();
      if (L) { ws.pos = L.pos; ws.contentH = L.h; }
    }
    var p = posOf(id);
    var s = sizeOf(id);
    ws.drag = {
      id: id, w: s.w, h: s.h,
      dx: e.clientX - r.left - p.x,
      dy: e.clientY - r.top - p.y,
      // Dragging a person carries their matters along at the same offsets.
      kids: isMember(id)
        ? MATTERS.filter(function (m) { return m.owner === id; }).map(function (m) {
            var q = posOf(m.id);
            return { id: m.id, ox: q.x - p.x, oy: q.y - p.y };
          })
        : []
    };
    ws.dragged = true;
    ws.dragId = id;
    paintGraph();
  }

  window.addEventListener('pointermove', function (e) {
    if (!ws.drag || !wsGraph) return;
    var r = wsGraph.getBoundingClientRect();
    var d = ws.drag;
    var H = ws.contentH || r.height;
    var x = Math.max(0, Math.min(e.clientX - r.left - d.dx, r.width - d.w));
    var y = Math.max(0, Math.min(e.clientY - r.top - d.dy, H - d.h));
    ws.pos[d.id] = { x: x, y: y };
    d.kids.forEach(function (k) {
      ws.pos[k.id] = {
        x: Math.max(0, Math.min(x + k.ox, r.width - SZ.CARD_W)),
        y: Math.max(0, Math.min(y + k.oy, H - SZ.CARD_H))
      };
    });
    paintGraph();
  });

  window.addEventListener('pointerup', function () {
    if (!ws.drag) return;
    ws.drag = null;
    ws.dragId = null;
    separate();
  });

  /* -- Graph: paint ----------------------------------------- */
  var graphNodes = {};

  function buildGraph() {
    if (!wsGraph) return;
    graphNodes = {};
    // Everything after the <svg> is rebuilt; the paths element stays.
    while (wsGraph.lastChild && wsGraph.lastChild !== wsPaths) wsGraph.removeChild(wsGraph.lastChild);

    MATTERS.forEach(function (m) {
      var accent = TONE[m.tone];
      var saved = el('span', {
        class: 'ws-card-saved', 'data-mono': true, title: 'Saqlangan AI javoblari', hidden: true
      }, [svg([], 9, 1), el('span', { text: '0' })]);
      // The star is filled, not stroked, so it is built by hand.
      var star = saved.firstChild;
      star.setAttribute('fill', 'currentColor');
      star.setAttribute('stroke', 'none');
      var sp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      sp.setAttribute('d', 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z');
      star.appendChild(sp);

      var ask = el('button', {
        class: 'ws-card-ask', type: 'button', title: "Shu masala bo'yicha AI'dan so'rash"
      }, [svg(['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z'], 12, 1.9)]);
      ask.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      ask.addEventListener('click', function (e) { e.stopPropagation(); openDock(m.id); });

      var card = el('article', {
        class: 'ws-card',
        style: 'border-color:color-mix(in srgb, ' + accent + ' 34%, transparent);'
      }, [
        el('div', { class: 'ws-card-top' }, [
          el('span', { class: 'ws-card-accent', style: 'background:' + accent + ';' }),
          saved, ask
        ]),
        el('h4', { text: m.title }),
        el('div', { class: 'ws-card-due', 'data-mono': true, text: m.due }),
        el('div', { class: 'ws-card-foot' }, [
          el('span', { class: 'ws-card-tag', text: m.tag }),
          el('span', { class: 'ws-card-docs' }, [
            svg(['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z', 'M14 3v6h6'], 11, 2),
            el('span', { text: String(m.docs) })
          ])
        ])
      ]);
      card.addEventListener('pointerdown', function (e) { startDrag(m.id, e); });
      wsGraph.appendChild(card);
      graphNodes[m.id] = { node: card, saved: saved };
    });

    MEMBERS.forEach(function (u) {
      var node = el('div', { class: 'ws-node' }, [
        el('span', {
          class: 'ws-node-avatar', text: u.init,
          style: 'background:' + (u.owner ? 'var(--brand)' : 'color-mix(in srgb, var(--brand) 74%, transparent)') + ';'
        }),
        el('div', { style: 'text-align:center; min-width:0;' }, [
          el('div', { class: 'ws-node-name', text: u.name }),
          el('div', { class: 'ws-node-role', text: u.role })
        ])
      ]);
      node.addEventListener('pointerdown', function (e) { startDrag(u.id, e); });
      wsGraph.appendChild(node);
      graphNodes[u.id] = { node: node };
    });
  }

  function paintGraph() {
    if (!wsGraph || !ws.pos) return;
    wsGraph.style.height = (ws.contentH || 460) + 'px';
    Object.keys(graphNodes).forEach(function (id) {
      var p = ws.pos[id];
      if (!p) return;
      var n = graphNodes[id].node;
      n.style.left = p.x + 'px';
      n.style.top = p.y + 'px';
      if (ws.dragId === id) n.setAttribute('data-dragging', '');
      else n.removeAttribute('data-dragging');
      var badge = graphNodes[id].saved;
      if (badge) {
        var list = ws.saved[id] || [];
        badge.hidden = !list.length;
        badge.lastChild.textContent = String(list.length);
      }
    });
    paintPaths();
  }

  /* A curve from the edge of each card to the rim of its owner's avatar,
     with the control points pushed along the same direction so the cord
     leaves and arrives square-on. */
  function paintPaths() {
    if (!wsPaths || !ws.pos) return;
    wsPaths.textContent = '';
    MATTERS.forEach(function (m) {
      var a = ws.pos[m.id], b = ws.pos[m.owner];
      if (!a || !b) return;
      var R = 25;
      var cx = b.x + SZ.NODE_W / 2, cy = b.y + 23;
      var ax = a.x + SZ.CARD_W / 2, ay = a.y + SZ.CARD_H / 2;
      var vx = cx - ax, vy = cy - ay;
      var len = Math.hypot(vx, vy) || 1;
      vx /= len; vy /= len;
      var sx = Math.abs(vx) > 1e-6 ? (SZ.CARD_W / 2) / Math.abs(vx) : Infinity;
      var sy = Math.abs(vy) > 1e-6 ? (SZ.CARD_H / 2) / Math.abs(vy) : Infinity;
      var t = Math.min(sx, sy);
      var x1 = ax + vx * t, y1 = ay + vy * t;
      var x2 = cx - vx * R, y2 = cy - vy * R;
      var k = Math.max(18, Math.hypot(x2 - x1, y2 - y1) * 0.3);
      var d = 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) +
        ' C' + (x1 + vx * k).toFixed(1) + ',' + (y1 + vy * k).toFixed(1) +
        ' ' + (x2 - vx * k).toFixed(1) + ',' + (y2 - vy * k).toFixed(1) +
        ' ' + x2.toFixed(1) + ',' + y2.toFixed(1);
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', TONE[m.tone]);
      p.setAttribute('stroke-width', '1.4');
      p.setAttribute('stroke-dasharray', '5 5');
      p.setAttribute('opacity', '0.75');
      wsPaths.appendChild(p);
    });
  }

  /* -- Timeline ---------------------------------------------- */
  function renderTimeline() {
    var days = $('[data-ws-days]');
    if (days && DATA.wsDays) {
      days.textContent = '';
      DATA.wsDays.forEach(function (d) { days.appendChild(el('span', { text: d })); });
    }
    var host = $('[data-ws-timeline]');
    if (!host) return;
    host.textContent = '';
    MATTERS.forEach(function (m) {
      var u = member(m.owner);
      host.appendChild(el('div', { class: 'ws-tl-row' }, [
        el('div', { style: 'min-width:0;' }, [
          el('div', { class: 'ws-tl-title', text: m.title }),
          el('div', { class: 'ws-tl-who' }, [
            el('span', { class: 'ws-tl-init', text: u.init || '' }),
            el('span', { class: 'ws-tl-whoname', text: (u.name || '') + ' · ' + (u.role || '') })
          ])
        ]),
        el('div', { class: 'ws-tl-track' }, [
          el('span', {
            class: 'ws-tl-bar',
            style: 'left:' + ((m.start / 10) * 100).toFixed(2) + '%; width:' +
              ((m.span / 10) * 100).toFixed(2) + '%; background:' + TONE[m.tone] + ';'
          })
        ])
      ]));
    });
  }

  /* -- List --------------------------------------------------- */
  function renderList() {
    var count = $('[data-ws-matter-count]');
    if (count) count.textContent = MATTERS.length + ' ta faol';

    var host = $('[data-ws-matters]');
    if (host) {
      host.textContent = '';
      MATTERS.forEach(function (m) {
        var tone = TONE[m.tone] || 'var(--muted)';
        var u = member(m.owner);
        var ask = el('button', { class: 'ws-matter-ask', type: 'button', title: "AI'dan so'rash" },
          [svg(['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z'], 14, 1.9)]);
        ask.addEventListener('click', function (e) { e.stopPropagation(); openDock(m.id); });
        var savedList = ws.saved[m.id] || [];
        var saved = savedList.length ? el('div', { class: 'ws-saved' }, savedList.map(function (s) {
          return el('div', { class: 'ws-saved-item' }, [
            el('b', { text: s.label }),
            el('span', { 'data-mono': true, text: s.when })
          ]);
        })) : null;
        host.appendChild(el('article', { class: 'ws-matter' }, [
          el('div', { style: 'min-width:0;' }, [
            el('h4', { text: m.title }),
            el('div', { class: 'ws-matter-meta' }, [
              el('span', { text: (u.name || '') + ' · ' + m.tag }),
              el('span', { class: 'ws-dot' }),
              el('span', {
                text: m.due, style: 'font-weight:600; color:' + (m.tone === 'late' ? 'var(--danger)' : 'var(--muted)') + ';'
              })
            ])
          ]),
          el('span', { class: 'ws-matter-state', text: m.state, style: 'color:' + tone + ';' }),
          ask,
          saved
        ]));
      });
    }

    var threads = $('[data-ws-threads]');
    if (threads && DATA.aiThreads) {
      threads.textContent = '';
      DATA.aiThreads.filter(function (t) { return t.scope === 'team'; }).forEach(function (t) {
        var by = member(t.by).name || '';
        threads.appendChild(el('article', { class: 'ws-thread' }, [
          el('h4', { text: t.q }),
          el('div', { class: 'ws-thread-meta' }, [
            el('span', { text: by + ' · ' + t.when }),
            el('span', { class: 'ws-dot' }),
            el('span', { text: 'Token ' + by + ' hisobidan · ' + t.cost.toLocaleString('ru-RU') + ' token' }),
            el('span', { class: 'ws-dot' }),
            el('span', { class: 'ws-thread-free', text: MEMBERS.length + " a'zoga token sarfsiz" })
          ])
        ]));
      });
    }

    var team = $('[data-ws-team]');
    if (team && DATA.wsTeam) {
      team.textContent = '';
      DATA.wsTeam.forEach(function (p) {
        var color = p.load >= 80 ? 'var(--danger)' : (p.load >= 60 ? 'var(--warn)' : 'var(--ok)');
        team.appendChild(el('div', { class: 'ws-load-row' }, [
          el('span', { class: 'ws-load-init', text: p.init }),
          el('div', { style: 'min-width:0;' }, [
            el('div', { class: 'ws-load-name', text: p.name }),
            el('div', { class: 'ws-load-role', text: p.role + ' · ' + p.open + ' ish' }),
            el('span', { class: 'ws-load-track' }, [
              el('span', { class: 'ws-load-fill', style: 'width:' + p.load + '%; background:' + color + ';' })
            ])
          ]),
          el('span', { class: 'ws-load-pct', text: p.load + '%', style: 'color:' + color + ';' })
        ]));
      });
    }

    var drafts = $('[data-ws-drafts]');
    if (drafts && DATA.wsDrafts) {
      drafts.textContent = '';
      DATA.wsDrafts.forEach(function (d) {
        var color = d.state === 'Tasdiqlangan' ? 'var(--ok)' : (d.state === 'Tahrirda' ? 'var(--brand)' : 'var(--warn)');
        drafts.appendChild(el('div', { class: 'ws-draft' }, [
          el('span', { class: 'ws-draft-icon' }, [svg(['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z', 'M14 3v6h6'], 18, 1.8)]),
          el('div', { style: 'min-width:0; flex:1;' }, [
            el('div', { class: 'ws-draft-name', text: d.name }),
            el('div', { class: 'ws-draft-meta', text: d.meta }),
            el('div', { class: 'ws-draft-state', text: d.state, style: 'color:' + color + ';' })
          ])
        ]));
      });
    }
  }

  /* ============================================================
     AI drawer

     Asking about a matter opens a panel beside the workspace rather than
     over it, so the graph or list stays readable while the answer arrives.
     A team-scoped answer files itself against the matter; a personal one
     offers a button to file it.
     ============================================================ */
  var dock = { matter: null, wide: false, msgs: [], savedOpen: false, timer: null };
  var dockEl = $('[data-dock]');
  var dockLog = $('[data-dock-log]');

  var now = function () {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };
  var matterTitle = function (id) {
    return (MATTERS.filter(function (m) { return m.id === id; })[0] || {}).title || '';
  };

  function openDock(matterId) {
    if (!dockEl) return;
    dock.matter = matterId;
    dock.msgs = [];
    dock.wide = false;
    clearTimeout(dock.timer);
    dockEl.hidden = false;
    dockEl.removeAttribute('data-wide');
    renderDock();
    // The drawer takes width off the graph, which has to be laid out again.
    ws.laidFor = null;
    ensureLayout();
  }

  function closeDock() {
    dock.matter = null;
    dock.msgs = [];
    clearTimeout(dock.timer);
    if (dockEl) dockEl.hidden = true;
  }

  function runQuick(q) {
    var draft = q.perMatter ? ((DATA.drafts || {})[dock.matter] || (DATA.drafts || {}).m1) : null;
    if (draft && !dock.wide) {
      dock.wide = true;
      if (dockEl) dockEl.setAttribute('data-wide', '');
    }
    var at = now();
    // A team-scoped answer is filed against the matter without being asked;
    // a personal one gets a button instead.
    var auto = ai.scope === 'team';
    dock.msgs.push({ role: 'user', text: q.q });
    renderDock();
    clearTimeout(dock.timer);
    dock.timer = setTimeout(function () {
      if (auto) {
        ws.saved[dock.matter] = (ws.saved[dock.matter] || []).concat([{ label: q.label, when: at }]);
      }
      dock.msgs.push({
        role: 'ai',
        text: draft ? draft.body : q.a,
        cite: draft ? draft.cite : q.cite,
        label: q.label,
        saved: auto,
        doc: !!draft,
        docTitle: draft ? draft.title : ''
      });
      renderDock();
      paintGraph();
      renderList();
    }, 620);
  }

  function saveAnswer(i) {
    var m = dock.msgs[i];
    if (!m || m.saved) return;
    m.saved = true;
    ws.saved[dock.matter] = (ws.saved[dock.matter] || []).concat([{ label: m.label || 'AI javobi', when: now() }]);
    renderDock();
    paintGraph();
    renderList();
  }

  function renderDock() {
    if (!dockEl || !dock.matter) return;
    var title = $('[data-dock-title]');
    if (title) title.textContent = matterTitle(dock.matter);
    var scope = $('[data-dock-scope]');
    if (scope) scope.textContent = ai.scope === 'team' ? 'juristAI jamoasi' : 'Shaxsiy';
    var note = $('[data-dock-note]');
    if (note) note.textContent = ai.scope === 'team' ? 'javob masalaga saqlanadi' : 'saqlash — qo‘lda';

    var actions = $('[data-dock-actions]');
    if (actions && DATA.quick) {
      actions.textContent = '';
      DATA.quick.forEach(function (q) {
        var b = el('button', { class: 'dock-action', type: 'button', text: q.label });
        b.addEventListener('click', function () { runQuick(q); });
        actions.appendChild(b);
      });
    }

    if (dockLog) {
      dockLog.textContent = '';
      if (!dock.msgs.length) {
        dockLog.appendChild(el('p', {
          class: 'dock-empty',
          text: "Yuqoridagi amallardan birini tanlang yoki savolingizni yozing — javob shu masalaga biriktiriladi."
        }));
      }
      dock.msgs.forEach(function (m, i) {
        var body;
        if (m.doc) {
          body = el('div', { class: 'dock-msg', 'data-role': m.role, 'data-doc': true }, [
            el('div', { class: 'dock-doc-head' }, [
              svg(['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z', 'M14 3v6h6'], 14, 1.9),
              el('span', { text: m.docTitle }),
              el('span', { class: 'dock-doc-hint', 'data-mono': true, text: 'tahrirlanadi' })
            ]),
            el('div', { class: 'dock-doc-body', contenteditable: 'true', text: m.text }),
            m.cite ? el('div', { class: 'dock-cite', 'data-mono': true, text: m.cite }) : null
          ]);
        } else {
          body = el('div', { class: 'dock-msg', 'data-role': m.role }, [
            el('div', { class: 'dock-text', text: m.text }),
            m.cite ? el('div', { class: 'dock-cite', 'data-mono': true, text: m.cite }) : null
          ]);
        }
        if (m.role === 'ai') {
          var save = el('button', {
            class: 'dock-save', type: 'button',
            text: m.saved ? 'Masalaga saqlandi' : 'Masalaga saqlash'
          });
          if (m.saved) save.disabled = true;
          else save.addEventListener('click', function () { saveAnswer(i); });
          body.appendChild(save);
        }
        dockLog.appendChild(body);
      });
      dockLog.scrollTop = dockLog.scrollHeight;
    }

    var savedList = ws.saved[dock.matter] || [];
    var savedBox = $('[data-dock-saved]');
    if (savedBox) {
      savedBox.hidden = !savedList.length;
      if (dock.savedOpen) savedBox.setAttribute('data-open', '');
      else savedBox.removeAttribute('data-open');
      var label = $('[data-dock-saved-label]');
      if (label) label.textContent = 'Masalaga saqlangan javoblar · ' + savedList.length;
      var host = $('[data-dock-saved-list]');
      if (host) {
        host.textContent = '';
        savedList.forEach(function (s) {
          host.appendChild(el('div', { class: 'dock-saved-item' }, [
            el('span', { class: 'dock-saved-dot' }),
            el('span', { class: 'dock-saved-label', text: s.label }),
            el('span', { class: 'dock-saved-when', 'data-mono': true, text: s.when })
          ]));
        });
      }
    }
  }

  var dockWideBtn = $('[data-dock-wide]');
  if (dockWideBtn) dockWideBtn.addEventListener('click', function () {
    dock.wide = !dock.wide;
    if (dock.wide) dockEl.setAttribute('data-wide', '');
    else dockEl.removeAttribute('data-wide');
    dockWideBtn.title = dock.wide ? 'Torroq' : 'Kengaytirish';
    ws.laidFor = null;
    ensureLayout();
  });
  var dockCloseBtn = $('[data-dock-close]');
  if (dockCloseBtn) dockCloseBtn.addEventListener('click', function () {
    closeDock();
    ws.laidFor = null;
    ensureLayout();
  });
  var dockExpandBtn = $('[data-dock-expand]');
  if (dockExpandBtn) dockExpandBtn.addEventListener('click', function () {
    // Full screen means the AI section itself, with the matter carried over.
    ai.matter = dock.matter;
    ai.scope = 'team';
    renderAi();
    closeDock();
    state.tab = 'ai';
    applyTab();
  });
  var savedToggle = $('[data-dock-saved-toggle]');
  if (savedToggle) savedToggle.addEventListener('click', function () {
    dock.savedOpen = !dock.savedOpen;
    renderDock();
  });

  var openAi = $('[data-open-ai]');
  if (openAi) openAi.addEventListener('click', function () {
    state.tab = 'ai';
    applyTab();
  });

  /* ============================================================
     Chat — group and private, together or one at a time
     ============================================================ */
  var chatMode = 'both';
  try {
    var savedMode = localStorage.getItem('juristai-chat-mode');
    if (['both', 'group', 'private'].indexOf(savedMode) >= 0) chatMode = savedMode;
  } catch (e) { /* ignore */ }

  function renderChatModes() {
    var host = $('[data-chat-modes]');
    if (!host || !DATA.chatModes) return;
    host.textContent = '';
    DATA.chatModes.forEach(function (m) {
      var dot = m.id === 'group' ? 'var(--grp)' : (m.id === 'private' ? 'var(--prv)' : 'var(--muted-dim)');
      var b = el('button', {
        class: 'chat-mode', type: 'button', text: '',
        'aria-pressed': String(chatMode === m.id)
      }, [
        el('span', { class: 'chat-mode-dot', style: 'background:' + dot + ';' }),
        el('span', { text: m.label })
      ]);
      b.addEventListener('click', function () { setChatMode(m.id); });
      host.appendChild(b);
    });
  }

  function setChatMode(id) {
    chatMode = id;
    var grid = $('[data-chat-grid]');
    if (grid) {
      if (id === 'both') grid.removeAttribute('data-one');
      else grid.setAttribute('data-one', '');
    }
    $$('[data-chat-pane]').forEach(function (p) {
      var kind = p.getAttribute('data-chat-pane');
      p.hidden = (id === 'group' && kind !== 'group') || (id === 'private' && kind !== 'private');
    });
    renderChatModes();
    try { localStorage.setItem('juristai-chat-mode', id); } catch (e) { /* ignore */ }
  }

  function renderChat() {
    var group = $('[data-chat-group]');
    if (group && DATA.groupMsgs) {
      group.textContent = '';
      DATA.groupMsgs.forEach(function (m) {
        group.appendChild(el('div', { class: 'chat-msg', 'data-me': !!m.me }, [
          el('span', { class: 'chat-msg-init', text: m.init }),
          el('div', { class: 'chat-msg-body' }, [
            el('div', { class: 'chat-msg-meta' }, [
              el('span', { class: 'chat-msg-who', text: m.who }),
              el('span', { class: 'chat-msg-time', text: m.time })
            ]),
            el('div', { class: 'chat-bubble', text: m.txt })
          ])
        ]));
      });
      group.scrollTop = group.scrollHeight;
    }

    var priv = $('[data-chat-private]');
    if (priv && DATA.privMsgs) {
      priv.textContent = '';
      DATA.privMsgs.forEach(function (m) {
        priv.appendChild(el('div', { class: 'chat-priv', 'data-me': !!m.me }, [
          el('div', { class: 'chat-bubble', text: m.txt }),
          el('span', { class: 'chat-priv-time', text: m.time })
        ]));
      });
      priv.scrollTop = priv.scrollHeight;
    }
  }

  /* ============================================================
     AI

     Personal and team scope over the same panel. Team scope adds what only
     a shared thread needs: the workspace's token balance, the matter the
     thread is filed under, and a way to keep one out of the team's feed.
     ============================================================ */
  var ai = { scope: 'personal', matter: '', topicsOpen: false };
  try {
    var savedScope = localStorage.getItem('juristai-ai-scope');
    if (savedScope === 'team' || savedScope === 'personal') ai.scope = savedScope;
  } catch (e) { /* ignore */ }

  function shapes(list, size, width) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', width);
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    list.forEach(function (pair) {
      var n = document.createElementNS('http://www.w3.org/2000/svg', pair[0]);
      Object.keys(pair[1]).forEach(function (k) { n.setAttribute(k, pair[1][k]); });
      s.appendChild(n);
    });
    return s;
  }

  var nf = function (n) { return n.toLocaleString('ru-RU'); };

  function renderAi() {
    var team = ai.scope === 'team';
    var scopes = DATA.aiScopes || [];

    var side = $('[data-ai-scopes]');
    if (side) {
      side.textContent = '';
      side.style.display = 'flex';
      side.style.flexDirection = 'column';
      side.style.gap = '6px';
      scopes.forEach(function (s) {
        var b = el('button', {
          class: 'ai-scope', type: 'button', 'aria-pressed': String(ai.scope === s.id)
        }, [el('span', { text: s.label }), el('small', { text: s.sub })]);
        b.addEventListener('click', function () { setAiScope(s.id); });
        side.appendChild(b);
      });
    }

    var pills = $('[data-ai-scopepills]');
    if (pills) {
      pills.textContent = '';
      scopes.forEach(function (s) {
        var b = el('button', {
          class: 'ai-scopepill', type: 'button', title: s.sub, text: s.short,
          'aria-pressed': String(ai.scope === s.id)
        });
        b.addEventListener('click', function () { setAiScope(s.id); });
        pills.appendChild(b);
      });
    }

    // The balance, the matter picker and "hide from the team" only mean
    // something once the thread belongs to the workspace.
    var budget = DATA.wsBudget || { used: 0, limit: 1 };
    var pct = Math.round((budget.used / budget.limit) * 100) + '%';
    var box = $('[data-ai-budget]');
    if (box) {
      box.hidden = !team;
      var pctEl = $('[data-ai-budget-pct]');
      var fill = $('[data-ai-budget-fill]');
      var text = $('[data-ai-budget-text]');
      if (pctEl) pctEl.textContent = pct;
      if (fill) fill.style.width = pct;
      if (text) text.textContent = nf(budget.used) + ' / ' + nf(budget.limit);
    }
    var pill = $('[data-ai-budgetpill]');
    if (pill) {
      pill.hidden = !team;
      var pf = $('[data-ai-budgetpill-fill]');
      var pt = $('[data-ai-budgetpill-text]');
      if (pf) pf.style.width = pct;
      if (pt) pt.textContent = nf(budget.used) + ' / ' + nf(budget.limit);
    }
    var mw = $('[data-ai-matterwrap]');
    if (mw) mw.hidden = !team;
    var hide = $('[data-ai-hide]');
    if (hide) hide.hidden = !team;

    var threads = (DATA.aiThreads || []).filter(function (t) { return t.scope === ai.scope; });
    var count = $('[data-ai-thread-count]');
    if (count) count.textContent = String(threads.length);
    var list = $('[data-ai-threads]');
    if (list) {
      list.textContent = '';
      threads.forEach(function (t) {
        var matter = t.matter ? (MATTERS.filter(function (m) { return m.id === t.matter; })[0] || {}).title : '';
        var by = (member(t.by).name || '').split(' ')[0];
        list.appendChild(el('button', { class: 'ai-thread', type: 'button' }, [
          el('span', { class: 'ai-thread-q', text: t.q }),
          matter ? el('span', { class: 'ai-thread-matter', text: matter }) : null,
          el('small', { 'data-mono': true, text: by + ' · ' + t.when + ' · ' + nf(t.cost) + ' token' })
        ]));
      });
    }

    renderMatterMenu();
  }

  function setAiScope(id) {
    ai.scope = id;
    renderAi();
    try { localStorage.setItem('juristai-ai-scope', id); } catch (e) { /* ignore */ }
  }

  function renderMatterMenu() {
    var label = $('[data-ai-matter-label]');
    var current = ai.matter ? (MATTERS.filter(function (m) { return m.id === ai.matter; })[0] || {}).title : 'Biriktirilmagan';
    if (label) label.textContent = current;
    var menu = $('[data-ai-mattermenu]');
    if (!menu) return;
    menu.textContent = '';
    [{ id: '', title: 'Biriktirilmagan', tone: null }].concat(MATTERS).forEach(function (o) {
      var b = el('button', {
        class: 'ai-matteropt', type: 'button', 'aria-pressed': String(ai.matter === o.id)
      }, [
        el('span', { class: 'ai-matteropt-dot', style: 'background:' + (o.tone ? TONE[o.tone] : 'var(--muted-dim)') + ';' }),
        el('span', { class: 'ai-matteropt-label', text: o.title })
      ]);
      b.addEventListener('click', function () {
        ai.matter = o.id;
        menu.hidden = true;
        var tg = $('[data-ai-matter-toggle]');
        if (tg) tg.setAttribute('aria-expanded', 'false');
        renderMatterMenu();
      });
      menu.appendChild(b);
    });
  }

  var matterToggle = $('[data-ai-matter-toggle]');
  var matterMenu = $('[data-ai-mattermenu]');
  if (matterToggle && matterMenu) {
    matterToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = matterMenu.hidden;
      matterMenu.hidden = !open;
      matterToggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('pointerdown', function (e) {
      if (matterMenu.hidden) return;
      if (matterMenu.contains(e.target) || matterToggle.contains(e.target)) return;
      matterMenu.hidden = true;
      matterToggle.setAttribute('aria-expanded', 'false');
    }, true);
  }

  function renderAiStatic() {
    var dds = $('[data-ai-dds]');
    if (dds && DATA.hdrDd) {
      dds.textContent = '';
      DATA.hdrDd.forEach(function (label) {
        dds.appendChild(el('button', { class: 'ai-dd', type: 'button' }, [
          el('span', { text: label }),
          svg(['M6 9l6 6 6-6'], 11, 2.5)
        ]));
      });
    }

    var st = $('[data-ai-starters]');
    if (st && DATA.starters) {
      st.textContent = '';
      DATA.starters.forEach(function (s) {
        st.appendChild(el('button', { class: 'ai-starter', type: 'button' }, [
          el('span', { class: 'ai-starter-icon' }, [shapes(s.icon, 21, 1.7)]),
          el('span', { class: 'ai-starter-text' }, [
            el('strong', { text: s.h }),
            el('small', { text: s.sub })
          ])
        ]));
      });
    }

    var tl = $('[data-ai-topics-list]');
    if (tl && DATA.topics) {
      tl.textContent = '';
      DATA.topics.forEach(function (t) {
        tl.appendChild(el('button', { class: 'ai-topic', type: 'button', text: t }));
      });
    }
  }

  var topicsToggle = $('[data-ai-topics-toggle]');
  var topicsBox = $('[data-ai-topics]');
  if (topicsToggle && topicsBox) {
    topicsToggle.addEventListener('click', function () {
      ai.topicsOpen = !ai.topicsOpen;
      topicsBox.hidden = !ai.topicsOpen;
      topicsToggle.setAttribute('aria-expanded', String(ai.topicsOpen));
    });
  }

  /* ============================================================
     Boshqaruv — an overview grid over a set of collapsible areas
     ============================================================ */
  var mgOpen = 'reg';

  function renderMgmt() {
    var grid = $('[data-mg-cards]');
    if (grid && DATA.mgmt) {
      grid.textContent = '';
      DATA.mgmt.forEach(function (m) {
        var b = el('button', {
          class: 'mg-card', type: 'button', 'aria-pressed': String(mgOpen === m.target)
        }, [
          el('span', { text: m.label }),
          el('small', { text: m.sub }),
          m.count != null ? el('b', { class: 'mg-count', text: String(m.count) }) : null
        ]);
        b.addEventListener('click', function () {
          mgOpen = m.target;
          renderMgmt();
          var target = $('[data-mg-sec="' + m.target + '"]');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        grid.appendChild(b);
      });
    }

    var host = $('[data-mg-sections]');
    if (!host || !DATA.mgmtSections) return;
    host.textContent = '';
    DATA.mgmtSections.forEach(function (s) {
      var body = el('div', { class: 'mg-sec-body' }, [
        s.note ? el('p', { text: s.note }) : null,
        s.kanban ? el('div', { class: 'mg-kanban' }, s.kanban.map(function (c) {
          return el('div', { class: 'mg-col' }, [
            el('div', { class: 'mg-col-h', text: c }),
            el('div', { class: 'mg-col-note', text: "So'rovlarni ko'rish uchun bo'limni oching" })
          ]);
        })) : null,
        s.control ? el('div', { class: 'mg-control' }, [
          el('label', { text: s.control.label }),
          (function () {
            var sel = el('select', {});
            s.control.options.forEach(function (o, i) {
              var opt = el('option', { text: o });
              if (i === s.control.selected) opt.selected = true;
              sel.appendChild(opt);
            });
            return sel;
          })()
        ]) : null,
        !s.kanban ? el('div', { class: 'mg-empty', text: "Bo'limni oching" }) : null
      ]);

      var head = el('button', { class: 'mg-sec-head', type: 'button' }, [
        (function () { var c = svg(['M6 9l6 6 6-6'], 14, 2.5); c.setAttribute('class', 'mg-sec-chev'); return c; })(),
        el('h2', { text: s.h }),
        s.badge ? el('span', { class: 'mg-sec-badge', text: s.badge }) : null
      ]);
      var sec = el('div', { class: 'mg-sec', 'data-mg-sec': s.id }, [head, body]);
      if (mgOpen === s.id) sec.setAttribute('data-open', '');
      head.setAttribute('aria-expanded', String(mgOpen === s.id));
      head.addEventListener('click', function () {
        mgOpen = mgOpen === s.id ? '' : s.id;
        renderMgmt();
      });
      host.appendChild(sec);
    });
  }

  window.addEventListener('resize', function () {
    ws.laidFor = null;
    measureBar();
    ensureLayout();
  });

  applyTheme();
  applyTab();
  renderBits();
  renderHealth();
  renderQueue();

  renderChat();
  setChatMode(chatMode);

  renderAiStatic();
  renderAi();
  renderMgmt();

  renderWsViews();
  renderLegend();
  buildGraph();
  renderTimeline();
  renderList();
  setWsView(ws.view);
  measureBar();
  // The graph can only be laid out once its container has a width, which it
  // does not while its tab is hidden.
  ensureLayout();
  setTimeout(function () { measureBar(); ensureLayout(); }, 120);
})();
