/* ============================================================
   JuristAI landing page behaviour.

   A vanilla port of the logic class in the design prototype
   (public/preview/landing.dc.html). Every timing, easing, seed and
   threshold below is the prototype's; docs/design-handoff/ANIMATIONS.md
   describes what each one produces on screen.

   Copy comes from window.JAI_I18N, inlined by public/index.html so the
   language switch needs no round trip.
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('jai-root');
  if (!root) return;

  var I18N = window.JAI_I18N || {};
  var STAT_NUMS = window.JAI_STAT_NUMS || [];
  var CHAT = window.JAI_CHAT || { uz: [], ru: [] };
  var CODE_REFS = window.JAI_CODE_REFS || [];

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || root).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); };

  /* ── State ─────────────────────────────────────────────── */
  var state = {
    lang: 'uz',
    theme: 'light',
    ad: 0,      // LED panel frame
    car: 0,     // "Qanday ishlaydi" carousel position
    ci: 0,      // chat pair index
    qLen: 0, aLen: 0,
    dots: false, showSrc: false, sent: false, send: false,
    history: []
  };

  try {
    if (localStorage.getItem('jai-theme') === 'dark') state.theme = 'dark';
    if (localStorage.getItem('jai-lang') === 'ru') state.lang = 'ru';
  } catch (e) { /* private mode: fall back to the defaults above */ }

  var t = function () { return I18N[state.lang] || I18N.uz || {}; };
  var chatList = function () { return CHAT[state.lang] || CHAT.uz; };
  var pair = function () { var l = chatList(); return l[state.ci % l.length]; };

  /* ============================================================
     Theme and language
     ============================================================ */
  function applyTheme() {
    var dark = state.theme === 'dark';
    root.setAttribute('data-theme', state.theme);
    $$('[data-wordmark-light]').forEach(function (el) { el.hidden = dark; });
    $$('[data-wordmark-dark]').forEach(function (el) { el.hidden = !dark; });
    var lightIcon = $('[data-theme-icon="light"]');
    var darkIcon = $('[data-theme-icon="dark"]');
    if (lightIcon) lightIcon.hidden = dark;
    if (darkIcon) darkIcon.hidden = !dark;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#060814' : '#f6f8fc');
    try { localStorage.setItem('jai-theme', state.theme); } catch (e) { /* ignore */ }
  }

  function resolve(dict, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, dict);
  }

  function applyLang() {
    var dict = t();
    root.setAttribute('data-lang', state.lang);
    document.documentElement.lang = state.lang;
    $$('[data-i18n]').forEach(function (el) {
      var v = resolve(dict, el.getAttribute('data-i18n'));
      if (v != null) el.textContent = v;
    });
    var glitch = $('[data-txt]');
    if (glitch) glitch.setAttribute('data-txt', resolve(dict, glitch.getAttribute('data-i18n')) || '');
    $$('[data-statnum]').forEach(function (el) {
      el.textContent = STAT_NUMS[Number(el.getAttribute('data-statnum'))] || '';
    });
    $$('[data-lang-set]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang-set') === state.lang));
    });
    renderAd();
    try { localStorage.setItem('jai-lang', state.lang); } catch (e) { /* ignore */ }
  }

  function setLang(l) {
    if (l === state.lang) return;
    state.lang = l;
    applyLang();
    // The quotes and the phone conversation are both language-bound: restart
    // them rather than leaving half-typed text from the previous language.
    restartTesti();
    restartChat();
  }

  $$('[data-lang-set]').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-lang-set')); });
  });
  var themeBtn = $('[data-theme-toggle]');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  });

  /* ============================================================
     Hero — drifting article references
     Each label flies out of the vanishing point on its own keyframe and
     leaves the frame in a different direction.
     ============================================================ */
  (function codeRefs() {
    var host = $('[data-coderefs]');
    if (!host) return;
    CODE_REFS.forEach(function (r) {
      var s = document.createElement('span');
      s.textContent = r.label;
      s.style.cssText = 'position:absolute; left:' + r.x + '; top:' + r.y +
        '; opacity:0; will-change:transform, opacity; animation:' + r.anim + ' ' +
        r.dur + ' cubic-bezier(.32,0,.62,1) ' + r.delay + ' infinite;';
      host.appendChild(s);
    });
  })();

  /* ============================================================
     Hero — phone mock
     The question types character by character, the send button dips, the
     bubble rises, three dots think, then the answer types and its source
     chip appears. Answered pairs stack up behind, four deep.
     ============================================================ */
  var chatLog = $('[data-chat-log]');
  var draftEl = $('[data-chat-draft]');
  var sendEl = $('[data-chat-send]');
  var chatTimer = null;
  var chatNodes = null;

  var KEY_ROWS = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm']
  ];
  var keyEls = {};
  KEY_ROWS.forEach(function (keys, i) {
    var row = $('[data-keyrow="' + i + '"]');
    if (!row) return;
    keys.forEach(function (ch) {
      var el = document.createElement('div');
      el.className = 'jai-key';
      el.textContent = ch;
      row.appendChild(el);
      keyEls[ch] = el;
    });
  });
  var spaceEl = $('[data-keyspace]');

  function buildChatNodes() {
    if (!chatLog) return null;
    var history = document.createElement('div');
    history.style.cssText = 'display:contents;';

    var q = document.createElement('div');
    q.className = 'jai-msg-q';
    q.hidden = true;

    var dots = document.createElement('div');
    dots.style.cssText = 'align-self:flex-start; display:flex; gap:5px; padding:10px 13px; background:var(--panel-hover); border:1px solid var(--line); border-radius:14px;';
    ['', '.2s', '.4s'].forEach(function (delay) {
      var d = document.createElement('span');
      d.className = 'jai-dot';
      if (delay) d.style.animationDelay = delay;
      dots.appendChild(d);
    });
    dots.hidden = true;

    var a = document.createElement('div');
    a.className = 'jai-msg-a';
    a.hidden = true;
    var aText = document.createElement('span');
    var aSrc = document.createElement('div');
    aSrc.className = 'jai-msg-src';
    aSrc.hidden = true;
    a.appendChild(aText);
    a.appendChild(aSrc);

    chatLog.appendChild(history);
    chatLog.appendChild(q);
    chatLog.appendChild(dots);
    chatLog.appendChild(a);
    return { history: history, q: q, dots: dots, a: a, aText: aText, aSrc: aSrc };
  }

  // Replaying an animation needs the name cleared and the layout flushed,
  // otherwise the browser keeps the finished run.
  function replay(el, animation) {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = animation;
  }

  function appendHistory(entry) {
    if (!chatNodes) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; flex-direction:column; gap:10px;';
    var q = document.createElement('div');
    q.className = 'jai-msg-q';
    q.textContent = entry.q;
    var a = document.createElement('div');
    a.className = 'jai-msg-a';
    var at = document.createElement('span');
    at.textContent = entry.a;
    var as = document.createElement('div');
    as.className = 'jai-msg-src';
    as.textContent = entry.src;
    a.appendChild(at);
    a.appendChild(as);
    wrap.appendChild(q);
    wrap.appendChild(a);
    chatNodes.history.appendChild(wrap);
    while (chatNodes.history.children.length > 4) {
      chatNodes.history.removeChild(chatNodes.history.firstChild);
    }
  }

  function activeChar() {
    if (state.sent || state.qLen === 0) return null;
    return (pair().q[state.qLen - 1] || '').toLowerCase();
  }

  function renderChat() {
    var p = pair();
    if (draftEl) draftEl.textContent = state.sent ? '' : p.q.slice(0, state.qLen);
    if (sendEl) sendEl.style.transform = 'scale(' + (state.send ? 0.86 : 1) + ')';

    var act = activeChar();
    Object.keys(keyEls).forEach(function (ch) {
      keyEls[ch].classList.toggle('is-on', ch === act);
    });
    if (spaceEl) spaceEl.style.background = act === ' ' ? 'var(--brand)' : 'var(--panel-solid)';

    if (!chatNodes) return;
    if (state.sent && chatNodes.q.hidden) {
      chatNodes.q.textContent = p.q;
      chatNodes.q.hidden = false;
      replay(chatNodes.q, 'jai-rise .3s ease both');
    } else if (!state.sent && !chatNodes.q.hidden) {
      chatNodes.q.hidden = true;
    }

    chatNodes.dots.hidden = !state.dots;

    var showA = state.aLen > 0;
    if (showA && chatNodes.a.hidden) {
      chatNodes.a.hidden = false;
      replay(chatNodes.a, 'jai-rise .3s ease both');
    } else if (!showA && !chatNodes.a.hidden) {
      chatNodes.a.hidden = true;
    }
    chatNodes.aText.textContent = p.a.slice(0, state.aLen);

    if (state.showSrc && chatNodes.aSrc.hidden) {
      chatNodes.aSrc.textContent = p.src;
      chatNodes.aSrc.hidden = false;
      replay(chatNodes.aSrc, 'jai-rise .3s ease both');
    } else if (!state.showSrc && !chatNodes.aSrc.hidden) {
      chatNodes.aSrc.hidden = true;
    }
  }

  function typeQ() {
    var q = pair().q;
    if (state.qLen < q.length) {
      state.qLen = Math.min(state.qLen + 1, q.length);
      state.sent = false;
      renderChat();
      chatTimer = setTimeout(typeQ, 46);
    } else {
      state.send = true;
      renderChat();
      chatTimer = setTimeout(function () {
        state.sent = true; state.send = false;
        renderChat();
        chatTimer = setTimeout(function () {
          state.dots = true;
          renderChat();
          chatTimer = setTimeout(function () {
            state.dots = false;
            renderChat();
            typeA();
          }, 1200);
        }, 420);
      }, 420);
    }
  }

  function typeA() {
    var a = pair().a;
    if (state.aLen < a.length) {
      state.aLen = Math.min(state.aLen + 1, a.length);
      renderChat();
      chatTimer = setTimeout(typeA, 19);
    } else {
      state.showSrc = true;
      renderChat();
      chatTimer = setTimeout(nextPair, 3600);
    }
  }

  function nextPair() {
    var done = pair();
    appendHistory({ q: done.q, a: done.a, src: done.src });
    state.ci = (state.ci + 1) % chatList().length;
    state.qLen = 0; state.aLen = 0;
    state.dots = false; state.showSrc = false; state.sent = false; state.send = false;
    renderChat();
    chatTimer = setTimeout(typeQ, 800);
  }

  function restartChat() {
    clearTimeout(chatTimer);
    state.ci = 0; state.qLen = 0; state.aLen = 0;
    state.dots = false; state.showSrc = false; state.sent = false; state.send = false;
    if (chatNodes) chatNodes.history.textContent = '';
    renderChat();
    chatTimer = setTimeout(typeQ, 700);
  }

  chatNodes = buildChatNodes();

  /* ============================================================
     Feature card — retrieval match bar
     ============================================================ */
  setTimeout(function () {
    var bar = $('[data-progbar]');
    if (bar) bar.style.width = '84%';
  }, 700);

  /* ============================================================
     Shared typewriter. Characters are derived from elapsed time rather
     than counted per frame, so a dropped frame does not slow the line.
     ============================================================ */
  var rafs = [];
  function runType(cards, cps, onDone) {
    var t0 = performance.now();
    function tick(now) {
      var done = true;
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var n = Math.max(0, Math.min(c.full.length,
          Math.floor((now - t0 - (c.delay || 0)) / 1000 * cps)));
        if (c.out.textContent.length !== n) c.out.textContent = c.full.slice(0, n);
        if (c.caret) c.caret.style.opacity = (n > 0 && n < c.full.length) ? '1' : '0';
        if (n < c.full.length) done = false;
      }
      if (done) { if (onDone) onDone(); return; }
      rafs.push(requestAnimationFrame(tick));
    }
    rafs.push(requestAnimationFrame(tick));
  }

  /* ============================================================
     Testimonials — quotes type in, hold three seconds, repeat
     ============================================================ */
  var testiRoot = $('[data-testi]');
  var testiRunning = false;
  var testiLoopT = null;

  function testiCards() {
    return $$('blockquote', testiRoot).map(function (bq, i) {
      return {
        out: $('[data-typed]', bq),
        caret: $('[data-caret]', bq),
        full: (bq.firstElementChild && bq.firstElementChild.textContent) || '',
        delay: i * 320
      };
    }).filter(function (c) { return c.out; });
  }

  function startTesti() {
    if (!testiRoot || testiRunning || !$('[data-typed]', testiRoot)) return;
    var r = testiRoot.getBoundingClientRect();
    if (r.bottom < 0 || r.top > (window.innerHeight || 800)) return;
    testiRunning = true;
    (function cycle() {
      var cards = testiCards();
      cards.forEach(function (c) { c.out.textContent = ''; });
      runType(cards, 42, function () { testiLoopT = setTimeout(cycle, 3000); });
    })();
  }

  function restartTesti() {
    clearTimeout(testiLoopT);
    testiRunning = false;
    rafs.forEach(cancelAnimationFrame);
    rafs = [];
    startTesti();
  }

  /* ============================================================
     Checklist — ticks draw themselves in turn, then the list resets
     ============================================================ */
  var checksRoot = $('[data-checks]');
  var checkTs = [];
  var checksTicked = false;

  if (checksRoot && 'IntersectionObserver' in window) {
    var checksIO = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; }) || checksTicked) return;
      checksTicked = true;
      var items = $$('[data-chk]', checksRoot);
      var gap = 520;
      (function cycle() {
        checkTs = [];
        items.forEach(function (li) {
          var box = $('[data-chkbox]', li);
          var path = $('[data-chkpath]', li);
          var txt = $('[data-chktext]', li);
          if (path) { path.style.animation = 'none'; path.style.strokeDashoffset = '26'; }
          if (box) { box.style.animation = 'none'; box.style.borderColor = 'var(--line)'; box.style.background = 'transparent'; }
          if (txt) txt.style.color = 'var(--muted)';
        });
        items.forEach(function (li, i) {
          checkTs.push(setTimeout(function () {
            var box = $('[data-chkbox]', li);
            var path = $('[data-chkpath]', li);
            var txt = $('[data-chktext]', li);
            if (path) { path.style.strokeDashoffset = ''; path.style.animation = 'jai-tickdraw 420ms cubic-bezier(.2,.8,.2,1) forwards'; }
            if (box) {
              box.style.borderColor = 'var(--brand-border)';
              box.style.background = 'var(--brand-soft)';
              box.style.animation = 'jai-tickpop 420ms cubic-bezier(.2,.8,.2,1)';
            }
            if (txt) checkTs.push(setTimeout(function () { txt.style.color = 'var(--ink)'; }, 180));
          }, 260 + i * gap));
        });
        checkTs.push(setTimeout(cycle, 260 + items.length * gap + 420 + 2000));
      })();
    }, { threshold: 0.35 });
    checksIO.observe(checksRoot);
  }

  /* ============================================================
     FAQ — split-flap board
     The rows drop in on a cascade, then the whole board turns over to the
     second set of questions every four seconds.
     ============================================================ */
  var faqRoot = $('[data-faq]');
  var faqDone = false;
  var faqTs = [];
  var faqBatch = 0;

  $$('[data-faqrow]').forEach(function (row) {
    var btn = $('.jai-faq-btn', row);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var open = row.classList.contains('is-open');
      $$('[data-faqrow]').forEach(function (r) { r.classList.remove('is-open'); });
      if (!open) row.classList.add('is-open');
    });
  });

  function startFaq() {
    if (!faqRoot || faqDone) return;
    var rows = $$('[data-faqrow]', faqRoot);
    if (!rows.length) return;
    var r = faqRoot.getBoundingClientRect();
    if (r.bottom < 0 || r.top > (window.innerHeight || 800) * 0.9) return;
    faqDone = true;
    var dur = 900;
    rows.forEach(function (row, i) {
      row.style.animation = 'jai-flipboard ' + dur + 'ms cubic-bezier(.2,.8,.2,1) ' + (i * dur * 0.5) + 'ms both';
    });
    var intro = rows.length * dur * 0.5 + dur;

    function flap() {
      var dict = t();
      var batches = [dict.faqs, dict.faqs2].filter(Boolean);
      faqBatch = (faqBatch + 1) % batches.length;
      var next = batches[faqBatch];
      rows.forEach(function (row, i) {
        faqTs.push(setTimeout(function () {
          row.style.animation = 'jai-flapout 300ms cubic-bezier(.4,0,.2,1) forwards';
          faqTs.push(setTimeout(function () {
            var p = next[i % next.length];
            var q = $('[data-faqq]', row);
            var a = $('[data-faqa]', row);
            if (q) q.textContent = p[0];
            if (a) a.textContent = p[1];
            row.style.animation = 'jai-flapin 320ms cubic-bezier(.2,.8,.2,1) forwards';
          }, 300));
        }, i * 90));
      });
      faqTs.push(setTimeout(flap, 4000));
    }
    faqTs.push(setTimeout(flap, intro + 4000));
  }

  /* ── FAQ backdrop: a grid of flap cells that snap shut at random ─ */
  (function flapCells() {
    var host = $('[data-flapcells]');
    if (!host) return;
    var cols = 22, rows = 11;
    var s = 77771;
    var rnd = function () { return (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (rnd() > 0.55) continue;
        var x = (c * (100 / cols) + rnd() * 1.2).toFixed(2) + '%';
        var y = (r * (100 / rows) + rnd() * 1.2).toFixed(2) + '%';
        var dur = (7 + Math.floor(rnd() * 9)) + 's';
        var delay = (rnd() * 9).toFixed(1) + 's';
        var span = document.createElement('span');
        span.style.cssText = 'position:absolute; left:' + x + '; top:' + y +
          '; width:34px; height:20px; border-radius:3px; background:color-mix(in srgb, var(--ink) 5%, transparent); transform-origin:center; animation:jai-flapcell ' +
          dur + ' steps(1) ' + delay + ' infinite;';
        host.appendChild(span);
      }
    }
  })();

  /* ============================================================
     LED panel — four frames on a 4.2s rotation
     ============================================================ */
  function renderAd() {
    var ads = t().led_ads || [];
    var cur = ads[state.ad] || [];
    var ey = $('[data-ad-ey]'), h = $('[data-ad-h]'), p = $('[data-ad-p]');
    if (ey) ey.textContent = cur[0] || '';
    if (h) h.textContent = cur[1] || '';
    if (p) p.textContent = cur[2] || '';
    $$('[data-adframe]').forEach(function (el) {
      var i = Number(el.getAttribute('data-adframe'));
      el.style.opacity = state.ad === i ? '1' : '0';
      el.style.zIndex = state.ad === i ? '2' : '1';
    });
    $$('[data-adbar]').forEach(function (el) {
      var i = Number(el.getAttribute('data-adbar'));
      el.style.width = state.ad > i ? '100%' : '0%';
      el.style.animation = state.ad === i ? 'jai-barfill 4200ms linear forwards' : 'none';
    });
  }

  /* ── The panel's video is optional: the still frames carry the
     section on their own until it loads, then it fades in over them. ── */
  var ledCache = {};
  function playLedVideo() {
    $$('video[data-led-video]').forEach(function (v) {
      v.muted = true; v.loop = true; v.playsInline = true;
      var want = v.getAttribute('data-led-video');
      if (!v.dataset.ledBound) {
        v.dataset.ledBound = '1';
        v.addEventListener('ended', function () { v.currentTime = 0; v.play().catch(function () {}); });
        v.addEventListener('playing', function () { v.style.opacity = '1'; });
        v.addEventListener('pause', function () { v.play().catch(function () {}); });
      }
      if (!v.dataset.ledLoading) {
        v.dataset.ledLoading = '1';
        var use = function (url) {
          v.src = url; v.load();
          var pr = v.play();
          if (pr && pr.catch) pr.catch(function () { setTimeout(function () { v.play().catch(function () {}); }, 300); });
        };
        if (ledCache[want]) use(ledCache[want]);
        else fetch(want).then(function (r) {
          if (!r.ok) throw new Error('no asset');
          return r.blob();
        }).then(function (bl) {
          ledCache[want] = URL.createObjectURL(bl);
          use(ledCache[want]);
        }).catch(function () { /* still frames stay */ });
      } else if (v.paused) {
        v.play().catch(function () {});
      }
    });
  }
  [0, 400, 1500].forEach(function (d) { setTimeout(playLedVideo, d); });

  /* ============================================================
     "Qanday ishlaydi" — three cards on a turntable
     ============================================================ */
  function renderSteps() {
    $$('[data-step]').forEach(function (el) {
      var i = Number(el.getAttribute('data-step'));
      var r = (i - state.car + 3) % 3;
      var slot = r === 0
        ? { x: '-50%', z: 0, sc: 1, rot: 0, op: 1, blur: 'none', zi: 3, anim: 'jai-cardfloat 4.2s ease-in-out infinite' }
        : r === 1
          ? { x: '-16%', z: -330, sc: 0.86, rot: -14, op: 0.62, blur: 'blur(3px)', zi: 2, anim: 'none' }
          : { x: '-84%', z: -330, sc: 0.86, rot: 14, op: 0.62, blur: 'blur(3px)', zi: 2, anim: 'none' };
      el.style.transform = 'translateX(' + slot.x + ') translateZ(' + slot.z + 'px) rotateY(' + slot.rot + 'deg) scale(' + slot.sc + ')';
      el.style.filter = slot.blur;
      el.style.opacity = String(slot.op);
      el.style.zIndex = String(slot.zi);
      var card = $('[data-step-card]', el);
      if (card) card.style.animation = slot.anim;
      var num = $('[data-step-num]', el);
      if (num) {
        num.style.animation = r === 0
          ? 'jai-numroll 900ms cubic-bezier(.2,.8,.2,1) both, jai-numglow 2.6s ease-out 900ms infinite'
          : 'none';
      }
    });
  }

  /* ============================================================
     Cards — tilt away from the cursor, with the light following it
     ============================================================ */
  document.addEventListener('pointermove', function (e) {
    var card = e.target && e.target.closest && e.target.closest('[data-tilt]');
    if (!card || reduceMotion) return;
    var r = card.getBoundingClientRect();
    var px = (e.clientX - r.left) / r.width - 0.5;
    var py = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = 'perspective(900px) rotateX(' + (py * 7).toFixed(2) +
      'deg) rotateY(' + (-px * 8).toFixed(2) + 'deg) translateY(-3px) scale(1.012)';
    card.style.setProperty('--gx', ((px + 0.5) * 100).toFixed(1) + '%');
    card.style.setProperty('--gy', ((py + 0.5) * 100).toFixed(1) + '%');
  }, { passive: true });

  document.addEventListener('pointerout', function (e) {
    var card = e.target && e.target.closest && e.target.closest('[data-tilt]');
    if (!card) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    card.style.transform = '';
    card.style.removeProperty('--gx');
    card.style.removeProperty('--gy');
  }, { passive: true });

  /* ============================================================
     Background field — 132 rungs of a ladder that scatter and reassemble
     with the scroll position through #features and #how.
     Seeded, so the arrangement is the same on every load.
     ============================================================ */
  var solveEl = $('[data-r="solve"]');
  var canvas = $('[data-field]');
  var fieldW = 0, fieldH = 0, ladder = null, ladderKey = '', gather, tickN = 0;

  function sizeField() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    var dpr = 1;
    fieldW = r.width; fieldH = r.height;
    var cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch;
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function buildLadder(w, h) {
    var s = 20260829;
    var rnd = function () { return (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
    var steps = 132, perRung = 9;
    var pts = [];
    for (var i = 0; i < steps; i++) {
      var tt = i / (steps - 1);
      pts.push({ t: tt, k: 0, strand: true });
      pts.push({ t: tt, k: 1, strand: true });
      if (i % 3 === 0) for (var j = 1; j < perRung; j++) pts.push({ t: tt, k: j / perRung, strand: false });
    }
    for (var n = 0; n < pts.length; n++) {
      var p = pts[n];
      p.sx = rnd() * w * 1.4 - w * 0.2;
      p.sy = rnd() * h * 1.4 - h * 0.2;
      p.ph = rnd() * Math.PI * 2;
      p.sp = 0.4 + rnd() * 0.9;
    }
    ladder = pts;
    ladderKey = Math.round(w) + 'x' + Math.round(h);
  }

  function drawField() {
    if (!canvas) return;
    if (!fieldW) { sizeField(); if (!fieldW) return; }
    var w = fieldW, h = fieldH;
    if (!ladder || ladderKey !== Math.round(w) + 'x' + Math.round(h)) buildLadder(w, h);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    var sy = window.scrollY || window.pageYOffset || 0;
    var vh = window.innerHeight || 800;
    var p = 0;
    if (solveEl) {
      var r = solveEl.getBoundingClientRect();
      p = (vh - r.top) / (r.height + vh);
    }
    // Scroll position, not velocity, drives assembly: scattered at the
    // section's entry, gathered by its middle.
    var target = (p - 0.06) / 0.44;
    target = Math.max(0, Math.min(1, target));
    if (reduceMotion) target = 1;
    if (gather === undefined) gather = target;
    gather += (target - gather) * 0.18;
    var g = gather;
    var ease = g * g * (3 - 2 * g);
    tickN += reduceMotion ? 0 : 0.01;

    // Diagonal helix axis.
    var ang = -0.62;
    var cs = Math.cos(ang), sn = Math.sin(ang);
    var cx = w * 0.5, cy = h * 0.5;
    var L = Math.hypot(w, h) * 1.15;
    var R = Math.min(w, h) * 0.34;
    var turns = 3.1;
    var spin = tickN * 0.55 + sy * 0.0016;
    var blue = state.theme === 'dark' ? '128,176,255' : '37,88,214';

    var i, pt;
    for (i = 0; i < ladder.length; i++) {
      pt = ladder[i];
      var u = (pt.t - 0.5) * L;
      var a = pt.t * Math.PI * 2 * turns + spin;
      var off = Math.cos(a + pt.k * Math.PI) * R;
      var dep = (Math.sin(a + pt.k * Math.PI) + 1) / 2;
      var tx = cx + u * cs - off * sn;
      var ty = cy + u * sn + off * cs;
      var drift = 1 - ease;
      pt.x = pt.sx + (tx - pt.sx) * ease + Math.cos(tickN * pt.sp * 2 + pt.ph) * 30 * drift;
      pt.y = pt.sy + (ty - pt.sy) * ease + Math.sin(tickN * pt.sp * 1.6 + pt.ph) * 26 * drift;
      pt.dep = dep;
    }

    for (i = 0; i < ladder.length; i++) {
      pt = ladder[i];
      var base = pt.strand ? 3.6 : 2.4;
      var rad = base * (0.45 + pt.dep * 0.85) * (0.6 + ease * 0.6);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + blue + ',' + (0.3 + pt.dep * 0.5 + ease * 0.2).toFixed(3) + ')';
      ctx.arc(pt.x, pt.y, Math.max(0.6, rad), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  window.addEventListener('resize', sizeField);
  window.addEventListener('scroll', sizeField, { passive: true });
  [0, 120, 500].forEach(function (d) { setTimeout(sizeField, d); });
  (function loop() { drawField(); requestAnimationFrame(loop); })();

  /* ============================================================
     Start
     ============================================================ */
  applyTheme();
  applyLang();
  renderSteps();
  renderAd();
  restartChat();

  setInterval(function () { state.ad = (state.ad + 1) % 4; renderAd(); }, 4200);
  setInterval(function () { state.car = (state.car + 1) % 3; renderSteps(); }, 4000);

  var visPoll = setInterval(function () {
    startTesti();
    startFaq();
    if (testiRunning && faqDone) clearInterval(visPoll);
  }, 400);
})();
