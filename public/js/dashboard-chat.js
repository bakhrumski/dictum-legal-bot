/* ============================================================
   dashboard.html — Chat section: view switch and private messages.

   The group pane is the dashboard's own team chat (/api/chat, rendered by
   renderChatMessages() in dashboard.html). This file adds what the
   ai-dashboard.html canvas has beside it:

   - the "Ikkisi / Guruh / Shaxsiy" switch, remembered per browser;
   - the private pane: one colleague at a time, over the workspace direct
     messages API (the same endpoints ai-dashboard.js uses):
       GET   /api/workspaces
       GET   /api/workspaces/:id/direct-threads
       GET   /api/workspaces/:id/direct-messages/:peerId
       POST  /api/workspaces/:id/direct-messages/:peerId
       PATCH /api/workspaces/:id/direct-messages/:peerId/read

   Private threads refresh every 8 seconds while the Chat tab is open.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function chatTabOpen() {
    try { return typeof currentTab !== 'undefined' && currentTab === 'chat'; } catch (e) { return false; }
  }

  /* -- View switch --------------------------------------------- */
  var MODES = [
    { id: 'both', label: 'Ikkisi' },
    { id: 'group', label: 'Guruh' },
    { id: 'private', label: 'Shaxsiy' }
  ];
  var mode = 'both';
  try {
    var savedMode = localStorage.getItem('juristai-chat-mode');
    if (['both', 'group', 'private'].indexOf(savedMode) >= 0) mode = savedMode;
  } catch (e) { /* ignore */ }

  function renderModes() {
    var host = $('[data-chat-modes]');
    if (!host) return;
    host.textContent = '';
    MODES.forEach(function (m) {
      var dot = m.id === 'group' ? 'var(--grp)' : (m.id === 'private' ? 'var(--prv)' : 'var(--muted-dim)');
      var unread = m.id === 'private' ? totalUnread() : 0;
      var b = el('button', { class: 'chat-mode', type: 'button', 'aria-pressed': String(mode === m.id) }, [
        el('span', { class: 'chat-mode-dot', style: 'background:' + dot + ';' }),
        el('span', { text: m.label }),
        unread ? el('span', { class: 'chat-mode-count', text: String(unread) }) : null
      ]);
      b.addEventListener('click', function () { setMode(m.id); });
      host.appendChild(b);
    });
  }

  function setMode(id) {
    mode = id;
    var grid = $('[data-chat-grid]');
    if (grid) {
      if (id === 'both') grid.removeAttribute('data-one');
      else grid.setAttribute('data-one', '');
    }
    $$('[data-chat-pane]').forEach(function (p) {
      var kind = p.getAttribute('data-chat-pane');
      p.hidden = (id === 'group' && kind !== 'group') || (id === 'private' && kind !== 'private');
    });
    renderModes();
    try { localStorage.setItem('juristai-chat-mode', id); } catch (e) { /* ignore */ }
    if (id !== 'private' && typeof scrollChatToBottom === 'function') scrollChatToBottom();
  }

  /* -- Private messages ---------------------------------------- */
  var live = { me: null, workspace: null, status: 'loading', detail: '' };
  var priv = { threads: [], peer: null, messages: [], seen: {}, status: 'loading', detail: '', sending: false, menuOpen: false };
  var poll = null;

  function api(method, path, body) {
    return fetch('/api' + path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var e = new Error(data.error || ('HTTP ' + r.status));
          e.status = r.status;
          throw e;
        }
        return data;
      });
    });
  }

  var initialsOf = function (name, username) {
    var src = (name || username || '?').trim();
    return src.split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || '?';
  };
  var clock = function (iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };
  var ROLE_LABEL = { owner: 'Egasi', member: "A'zo", viewer: 'Kuzatuvchi' };
  var peerName = function (p) { return p ? (p.full_name || p.username || "A'zo") : ''; };
  var myId = function () { return live.me && (live.me.adminId != null ? live.me.adminId : live.me.id); };

  function notice(text, action) {
    var box = el('div', { class: 'chat-notice' }, [el('p', { text: text })]);
    if (action) box.appendChild(el('a', { class: 'chat-notice-link', href: action.href, text: action.label }));
    return box;
  }

  function canWrite() {
    return live.status === 'ready' && !!live.workspace && live.workspace.role !== 'viewer';
  }

  function totalUnread() {
    return priv.threads.reduce(function (n, t) { return n + Number(t.unread || 0); }, 0);
  }

  function renderPeer() {
    var pane = $('[data-chat-pane="private"]');
    if (!pane) return;
    var who = priv.peer;
    var name = $('[data-chat-peer-name]');
    var init = $('[data-chat-peer-init]');
    var status = $('[data-chat-peer-status]');
    var box = pane.querySelector('[data-chat-private-input]');
    var send = pane.querySelector('.chat-send');
    var button = $('[data-chat-peer]');

    if (name) name.textContent = who ? peerName(who) : 'Suhbatdosh tanlang';
    if (init) init.textContent = who ? initialsOf(who.full_name, who.username) : '·';
    if (status) status.textContent = who ? (ROLE_LABEL[who.role] || who.role || '') : '';
    if (button) button.disabled = !priv.threads.length;

    var writable = !!who && canWrite();
    if (box) {
      box.disabled = !writable;
      box.placeholder = !who ? 'Suhbatdosh tanlang'
        : (writable ? peerName(who).split(/\s+/)[0] + 'ga yozing…' : 'Kuzatuvchi rolida yozib bo‘lmaydi');
    }
    if (send) send.disabled = !writable;
  }

  function renderPeerMenu() {
    var menu = $('[data-chat-peer-menu]');
    if (!menu) return;
    menu.textContent = '';
    if (!priv.threads.length) {
      menu.appendChild(notice("Jamoada sizdan boshqa a'zo yo'q."));
      return;
    }
    priv.threads.forEach(function (thread) {
      var mine = thread.last_sender_id === myId();
      var last = thread.last_body ? (mine ? 'Siz: ' : '') + thread.last_body : 'Hali yozishmagansiz';
      var row = el('button', {
        class: 'chat-peer-item', type: 'button', role: 'option',
        'aria-selected': String(!!(priv.peer && priv.peer.id === thread.id))
      }, [
        el('span', { class: 'chat-peer-init', text: initialsOf(thread.full_name, thread.username) }),
        el('span', { class: 'chat-peer-lines' }, [
          el('span', { class: 'chat-peer-who', text: peerName(thread) }),
          el('span', { class: 'chat-peer-last', text: last })
        ]),
        Number(thread.unread) ? el('span', { class: 'chat-peer-unread', text: String(thread.unread) }) : null
      ]);
      row.addEventListener('click', function () { pickPeer(thread); });
      menu.appendChild(row);
    });
  }

  function setPeerMenu(open) {
    priv.menuOpen = !!open && priv.threads.length > 0;
    var menu = $('[data-chat-peer-menu]');
    var button = $('[data-chat-peer]');
    if (menu) menu.hidden = !priv.menuOpen;
    if (button) button.setAttribute('aria-expanded', String(priv.menuOpen));
  }

  function pickPeer(thread) {
    priv.peer = thread;
    priv.messages = [];
    priv.seen = {};
    priv.status = 'loading';
    setPeerMenu(false);
    try { localStorage.setItem('juristai-chat-peer', String(thread.id)); } catch (e) { /* ignore */ }
    renderPrivate();
    loadPrivateMessages().then(markPeerRead);
  }

  function renderPrivate() {
    var host = $('[data-chat-private]');
    if (!host) return;
    host.textContent = '';
    renderPeer();

    if (live.status === 'loading') { host.appendChild(notice('Suhbat yuklanmoqda…')); return; }
    if (live.status === 'signedOut') {
      host.appendChild(notice('Shaxsiy yozishmalar uchun hisobingizga kiring.', { href: '/login.html', label: 'Kirish' }));
      return;
    }
    if (live.status === 'noWorkspace') {
      host.appendChild(notice('Shaxsiy yozishmalar Workspace a’zolari orasida ishlaydi. Siz hali birorta Workspace a’zosi emassiz.'));
      return;
    }
    if (live.status === 'error') {
      host.appendChild(notice('Suhbatni yuklab bo‘lmadi' + (live.detail ? ': ' + live.detail : '.')));
      return;
    }
    if (!priv.peer) {
      host.appendChild(notice(priv.threads.length ? 'Yozish uchun yuqoridan suhbatdosh tanlang.' : "Jamoada sizdan boshqa a'zo yo'q."));
      return;
    }
    if (priv.status === 'loading') { host.appendChild(notice('Suhbat yuklanmoqda…')); return; }
    if (priv.status === 'error') {
      host.appendChild(notice('Suhbatni yuklab bo‘lmadi' + (priv.detail ? ': ' + priv.detail : '.')));
      return;
    }
    if (!priv.messages.length) { host.appendChild(notice('Hozircha xabar yo‘q — birinchi bo‘lib yozing.')); return; }

    priv.messages.forEach(function (m) {
      var mine = m.sender_id === myId();
      host.appendChild(el('div', { class: 'chat-priv', 'data-me': !!mine }, [
        el('div', { class: 'chat-bubble', text: m.body }),
        el('span', { class: 'chat-priv-time' }, [
          document.createTextNode(clock(m.created_at)),
          mine && m.read_at ? el('span', { class: 'chat-priv-read', text: "o'qildi" }) : null
        ])
      ]));
    });
    host.scrollTop = host.scrollHeight;
  }

  function absorbPrivate(rows) {
    var changed = false;
    (rows || []).forEach(function (m) {
      if (!m) return;
      if (priv.seen[m.id]) {
        priv.messages.forEach(function (existing) {
          if (existing.id === m.id && m.read_at && !existing.read_at) { existing.read_at = m.read_at; changed = true; }
        });
        return;
      }
      priv.seen[m.id] = true;
      priv.messages.push(m);
      changed = true;
    });
    if (changed) {
      priv.messages.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
      renderPrivate();
    }
    return changed;
  }

  function loadPrivateMessages() {
    if (!live.workspace || !priv.peer) return Promise.resolve();
    var id = priv.peer.id;
    return api('GET', '/workspaces/' + live.workspace.id + '/direct-messages/' + id + '?limit=100')
      .then(function (d) {
        if (!priv.peer || priv.peer.id !== id) return;
        priv.status = 'ready';
        if (d.counterpart) priv.peer = Object.assign({}, priv.peer, d.counterpart);
        absorbPrivate(d.messages);
        renderPrivate();
      })
      .catch(function (e) {
        if (!priv.peer || priv.peer.id !== id) return;
        priv.status = 'error';
        priv.detail = e.message;
        renderPrivate();
      });
  }

  // Only a thread actually on screen is marked read.
  function markPeerRead() {
    if (!live.workspace || !priv.peer || !chatTabOpen() || mode === 'group') return Promise.resolve();
    var unread = priv.messages.some(function (m) { return m.recipient_id === myId() && !m.read_at; });
    if (!unread) return Promise.resolve();
    return api('PATCH', '/workspaces/' + live.workspace.id + '/direct-messages/' + priv.peer.id + '/read')
      .then(function () { return loadThreads(); })
      .catch(function () { /* a receipt that does not land is not worth interrupting the thread over */ });
  }

  function sendPrivateMessage(text) {
    if (!live.workspace || !priv.peer || priv.sending || !text.trim()) return;
    priv.sending = true;
    api('POST', '/workspaces/' + live.workspace.id + '/direct-messages/' + priv.peer.id, { body: text.trim() })
      .then(function (d) {
        if (d && d.message) absorbPrivate([d.message]);
        else loadPrivateMessages();
        loadThreads();
      })
      .catch(function (e) {
        var host = $('[data-chat-private]');
        if (host) { host.appendChild(notice('Yuborilmadi: ' + e.message)); host.scrollTop = host.scrollHeight; }
      })
      .then(function () { priv.sending = false; });
  }

  function loadThreads() {
    if (!live.workspace) return Promise.resolve();
    return api('GET', '/workspaces/' + live.workspace.id + '/direct-threads')
      .then(function (d) {
        priv.threads = (d && d.threads) || [];
        if (priv.peer) priv.peer = priv.threads.filter(function (t) { return t.id === priv.peer.id; })[0] || null;
        if (!priv.peer && priv.threads.length) {
          var saved = null;
          try { saved = localStorage.getItem('juristai-chat-peer'); } catch (e) { /* ignore */ }
          priv.peer = priv.threads.filter(function (t) { return String(t.id) === saved; })[0] || priv.threads[0];
          priv.status = 'loading';
          loadPrivateMessages().then(markPeerRead);
        }
        renderPeerMenu();
        renderPrivate();
        renderModes();
      })
      .catch(function () { /* the pane's own notice covers a failure */ });
  }

  function startPolling() {
    if (poll) return;
    poll = setInterval(function () {
      if (!chatTabOpen() || !live.workspace) return;
      loadThreads();
      if (priv.peer) loadPrivateMessages().then(markPeerRead);
    }, 8000);
  }

  function init() {
    renderPrivate();
    var me = (typeof currentUser !== 'undefined' && currentUser && currentUser.role) ? Promise.resolve(currentUser) : api('GET', '/user-info');
    me.then(function (u) {
      live.me = u;
      return api('GET', '/workspaces');
    }).then(function (d) {
      var list = (d && d.workspaces) || [];
      live.workspace = list.filter(function (w) { return w.is_active; })[0] || list[0] || null;
      if (!live.workspace) { live.status = 'noWorkspace'; renderPrivate(); return; }
      live.status = 'ready';
      return loadThreads().then(startPolling);
    }).catch(function (e) {
      live.status = e.status === 401 ? 'signedOut' : (e.status === 403 ? 'noWorkspace' : 'error');
      live.detail = e.message;
      renderPrivate();
    });
  }

  function wireComposer() {
    var pane = $('[data-chat-pane="private"]');
    if (!pane) return;
    var box = pane.querySelector('[data-chat-private-input]');
    var send = pane.querySelector('.chat-send');
    var submit = function () {
      if (!box || !box.value.trim()) return;
      sendPrivateMessage(box.value);
      box.value = '';
      box.style.height = '';
    };
    if (send) send.addEventListener('click', submit);
    if (box) {
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      });
      box.addEventListener('input', function () {
        box.style.height = 'auto';
        box.style.height = Math.min(box.scrollHeight, 120) + 'px';
      });
    }
    var button = $('[data-chat-peer]');
    if (button) button.addEventListener('click', function (e) {
      e.stopPropagation();
      setPeerMenu(!priv.menuOpen);
    });
    document.addEventListener('click', function (e) {
      if (priv.menuOpen) {
        var menu = $('[data-chat-peer-menu]');
        if (menu && !menu.contains(e.target)) setPeerMenu(false);
      }
      // The group pane's members list closes the same way.
      var members = document.getElementById('chatMembersPanel');
      if (members && members.classList.contains('open') && !members.contains(e.target) && !e.target.closest('#chatMemberCount')) {
        members.classList.remove('open');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (priv.menuOpen) setPeerMenu(false);
      var members = document.getElementById('chatMembersPanel');
      if (members) members.classList.remove('open');
    });
  }

  function start() {
    if (!$('[data-chat-grid]')) return;
    renderModes();
    setMode(mode);
    wireComposer();
    init();
  }

  window.DashboardChat = {
    // Called by switchTab() when the Chat tab opens.
    activate: function () {
      if (!live.workspace) return;
      loadThreads();
      if (priv.peer) loadPrivateMessages().then(markPeerRead);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
