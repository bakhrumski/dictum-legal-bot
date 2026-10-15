/* JuristAI landing — til, navigatsiya, video, qatlamlar animatsiyasi */
(function () {
  'use strict';

  /* ====== SOZLAMALAR: shu yerni o'zingizga moslang ====== */
  var LINKS = {
    login: '/app/kirish.html',                        // Kirish sahifasi (yangi ilova)
    signup: '/app/kirish.html',                       // «Bepul boshlash»: kirish/ro'yxatdan o'tish, keyin tariflar oynasi
    telegram: 'https://t.me/juristAI_registration_bot',
    offer: '/oferta.html', privacy: '/maxfiylik.html', terms: '/shartlar.html',
    app: '/app/',                                      // kirgan foydalanuvchi uchun ilova
    contact: 'https://t.me/juristAI_registration_bot',   // Aloqa: hozircha Telegram bot
    instagram: 'https://www.instagram.com/bakhrom_abdimuminov/', linkedin: 'https://www.linkedin.com/in/bakhrom-abdimuminov-0a479218a/'                     // ijtimoiy tarmoq manzillarini shu yerga yozing
  };
  /* ru/ va en/ papkalaridagi sahifalar umumiy fayllarga '../' orqali murojaat qiladi (tools/build-i18n.js qo'yadi) */
  var ROOT = document.documentElement.getAttribute('data-root') || '';
  var VIDEO_DIR = ROOT + 'videos/';
  var VIDEO_VER = '5';         // videoni almashtirsangiz shu raqamni oshiring: brauzer eski faylni keshdan olmaydi   // F1-web.mp4, F1-mobile.mp4, F1-poster.webp ...
  var FEATURE_VIDEOS = ['P1', 'P2', 'P3', 'P5', 'P7', 'P8', 'P9'];   // P8 — ovozli yozuv, P9 — Telegram
  var FEATURE_PAGES = ['ai-chat.html', 'hujjat-tahlili.html', 'hujjat-tayyorlash.html', 'workspace.html', 'advokatlar.html', '#ovozli-yozuv', '#telegram'];     // ichki sahifa tayyor bo'lgach shu yerga yoziladi
  /* ====================================================== */

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var mobile = window.matchMedia('(max-width: 720px)');
  /* harakat: tizim sozlamasi yoki footerdagi tugma bilan to'xtatiladi */
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)'), userStill = false;
  try { userStill = localStorage.getItem('still') === '1'; } catch (e) {}
  var still = { get matches() { return reduceMQ.matches || userStill; } };
  if (userStill) document.documentElement.classList.add('still');
  var dict;

  /* ---------- til ---------- */
  var PAGE_LANG = document.documentElement.lang || 'uz';
  function pickLang() {
    var q = new URLSearchParams(location.search).get('lang');
    return q && window.I18N[q] ? q : (window.I18N[PAGE_LANG] ? PAGE_LANG : 'uz');
  }
  /* har bir til o'z manzilida: uz — ildizda, ru — ru/, en — en/ */
  function langURL(l) {
    var file = location.pathname.split('/').pop() || 'index.html';
    return ROOT + (l === 'uz' ? '' : l + '/') + file + location.hash;
  }
  function goLang(l, keepScroll) {
    try { localStorage.setItem('lang', l); if (keepScroll) sessionStorage.setItem('restoreY', String(window.scrollY)); } catch (e) {}
    location.href = langURL(l);
  }
  (function autoLang() {                               // avval tanlangan til bo'lsa, o'sha manzilga o'tadi; qidiruv robotlariga tegmaydi
    if (new URLSearchParams(location.search).get('lang') || /bot|crawl|spider|slurp|lighthouse|headless/i.test(navigator.userAgent)) return;
    var saved = null; try { saved = localStorage.getItem('lang'); } catch (e) {}
    var target = null;
    if (saved && saved !== PAGE_LANG && window.I18N[saved]) target = saved;
    else if (!saved && PAGE_LANG === 'uz' && (navigator.language || '').slice(0, 2) === 'ru') target = 'ru';   // birinchi tashrif: rus tilidagi brauzer
    if (target) location.replace(langURL(target));
  })();
  function setLang(l) {
    dict = window.I18N[l];
    document.documentElement.lang = l;
    $$('[data-i18n]').forEach(function (el) { el.textContent = dict[el.dataset.i18n] || ''; });
    $$('[data-i18n-html]').forEach(function (el) { el.innerHTML = dict[el.dataset.i18nHtml] || ''; });
    $$('[data-lang]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === l)); });
    renderLayers(); renderFeatures(); renderAudience(); renderTiers(); renderAsks(); renderAnalysis(); renderBlocks(); renderSkills(); renderPromos(); startDemos();
  }
  $$('[data-lang]').forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.lang === PAGE_LANG && !new URLSearchParams(location.search).get('lang')) return; goLang(b.dataset.lang, true); }); });
  $$('[data-link]').forEach(function (a) { a.href = LINKS[a.dataset.link] || '#'; });
  /* Foydalanuvchi allaqachon kirgan bo'lsa (bitta sayt, bitta sessiya): "Kirish" → "Ilovaga o'tish", "Bepul boshlash" → ilova */
  (function () {
    if (!window.fetch || location.protocol === 'file:') return;
    fetch('/api/user-info', { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) return;
      document.documentElement.classList.add('signed-in');
      var go = dict['nav.app'] || 'JuristAI';
      $$('[data-link=login]').forEach(function (a) {                // yuqori menyuda takror bo'lmasin: matnli havola yashiriladi, pastki qismda qoladi
        a.href = LINKS.app; a.removeAttribute('data-i18n'); a.textContent = go;
        if (a.closest('.nav-r') || a.closest('.mnav')) a.style.display = 'none';
      });
      $$('[data-link=signup]').forEach(function (a) {               // "Bepul boshlash" → "Ilovaga o'tish"
        a.href = LINKS.app; var sp = $('span', a) || a; sp.removeAttribute('data-i18n'); sp.textContent = go;
      });
    }).catch(function () {});
  })();

  /* ---------- navigatsiya: video ustida shaffof, skrollda oq ---------- */
  var nav = $('#nav'), hero = $('.hero');
  function navState() {
    if (!hero) return;
    nav.classList.toggle('solid', window.scrollY > hero.offsetHeight - nav.offsetHeight - 8);
  }

  /* ---------- video ----------
     Fon videolari (F1, F2): kompyuterda -web, telefonda -mobile (bo'lmasa -web).
     Karta videolari (P*): har doim kichik -mobile fayl (bo'lmasa -web).
     Poster rasm darhol ko'rinadi; video ekranga yaqinlashganda yuklanadi va ekrandan chiqqanda to'xtaydi. */
  var touch = window.matchMedia('(hover: none)');
  function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  function loadVideo(v) {
    if (v.dataset.loaded) return;
    v.dataset.loaded = '1';
    var name = VIDEO_DIR + v.dataset.video, card = !!v.dataset.card;
    var list = (card || mobile.matches) ? [name + '-mobile.mp4', name + '-web.mp4'] : [name + '-web.mp4'];
    list = list.map(function (u) { return u + '?v=' + VIDEO_VER; });
    list.forEach(function (src) { var s = document.createElement('source'); s.src = src; s.type = 'video/mp4'; v.appendChild(s); });
    v.load();
  }
  var vio = ('IntersectionObserver' in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) {
        if (still.matches) return;            // harakatni kamaytirish: faqat poster
        loadVideo(v);
        if (!v.dataset.card || touch.matches || v.dataset.auto) play(v);
      } else if (v.dataset.loaded) v.pause();
    });
  }, { rootMargin: '200px' }) : null;
  function watchVideos(root) {
    $$('video[data-video]', root).forEach(function (v) {
      if (v.dataset.watched) return; v.dataset.watched = '1';
      if (!v.dataset.auto) v.poster = VIDEO_DIR + v.dataset.video + '-poster.webp?v=' + VIDEO_VER;
      if (vio) vio.observe(v); else if (!still.matches) { loadVideo(v); if (!v.dataset.card) play(v); }
    });
  }

  /* ---------- olti qatlam ---------- */
  var iso = $('#iso'), lay = $('#layers'), pin = $('#platforma'), step = -1;
  function renderLayers() {
    if (!iso) return;
    var items = dict['layers.items'];
    lay.innerHTML = ''; iso.innerHTML = '<div class="iso-in"></div>';
    var inner = iso.firstChild;
    items.forEach(function (it, i) {
      var b = document.createElement('button'); b.type = 'button';
      b.appendChild(document.createTextNode(it[0]));
      var sm = document.createElement('small'); sm.textContent = it[1]; b.appendChild(sm);
      b.addEventListener('click', function () { goStep(i); });
      lay.appendChild(b);
      var p = document.createElement('div'); p.className = 'plate'; p.style.setProperty('--i', i); p.textContent = it[0];
      inner.appendChild(p);
    });
    fitStack();
    var s = step; step = -1; setStep(s < 0 ? (pinned() ? 0 : 5) : s);
  }
  function fitStack() { if (iso) iso.style.setProperty('--k', Math.min(1, iso.clientHeight / 400, iso.clientWidth / 420).toFixed(3)); }
  function pinned() { return pin && !still.matches && !mobile.matches; }
  function setStep(n) {
    if (!iso || n === step) return; step = n;
    var merged = n >= 6, items = dict['layers.items'];
    $$('.plate', iso).forEach(function (pl, k) {
      pl.classList.toggle('off', k > n);
      pl.classList.toggle('on', !merged && k === n);
      pl.textContent = (merged && k === 5) ? 'JURISTAI' : items[k][0];
    });
    iso.classList.toggle('merged', merged);
    $$('button', lay).forEach(function (b, k) { b.setAttribute('aria-pressed', String(!merged && k === n)); });
  }
  function goStep(i) {
    if (!pinned()) { setStep(i); return; }
    var r = pin.getBoundingClientRect(), range = r.height - window.innerHeight;
    window.scrollTo({ top: window.scrollY + r.top + range * (i + 0.5) / 7, behavior: 'smooth' });
  }
  function pinScroll() {
    if (!pinned()) return;
    var r = pin.getBoundingClientRect(), range = r.height - window.innerHeight;
    if (range <= 0) return;
    var p = Math.max(0, Math.min(0.999, -r.top / range));
    setStep(Math.floor(p * 7));
  }

  /* ---------- imkoniyatlar ---------- */
  var W = 'stroke="#fff" stroke-width="1" fill="none"', A = '#7DA2FF';
  var win = '<rect x="20" y="10" width="120" height="76" rx="3" ' + W + '/><path d="M20 22h120" ' + W + '/>';
  /* videolar kelguncha kartalarda ichki sahifa maketlarining kichik jonli nusxasi turadi */
  var MINI = ["<div class=\"mini m-chat\"><i class=\"b q\"></i><i class=\"b a\"></i><i class=\"b a s\"></i><i class=\"chip\"></i></div>", "<div class=\"mini m-an\"><svg viewBox=\"0 0 40 40\"><circle cx=\"20\" cy=\"20\" r=\"16\" class=\"tr\"/><circle cx=\"20\" cy=\"20\" r=\"16\" class=\"ar\" pathLength=\"100\"/></svg><i class=\"r red\"></i><i class=\"r amb\"></i><i class=\"r grn\"></i></div>", "<div class=\"mini m-dr\"><div><i class=\"f\"></i><i class=\"f\"></i><i class=\"f\"></i></div><div class=\"pg\"><i class=\"l\"></i><i class=\"l\"></i><i class=\"l s\"></i><i class=\"okk\"></i></div></div>", "<div class=\"mini m-ws\"><i class=\"g g1\"></i><i class=\"g g2\"></i><i class=\"g g3\"></i><i class=\"g g4\"></i><i class=\"td\"></i></div>", "<div class=\"mini m-at\"><i class=\"p\"></i><i class=\"p\"></i><i class=\"p\"></i></div>",
    "<div class=\"mini m-vc\"><div class=\"vh\"><i class=\"dot\"></i><i class=\"tm\"></i></div><div class=\"wv\">" + new Array(15).join("<i></i>") + "</div><i class=\"l a\"></i><i class=\"l b\"></i><i class=\"l a s\"></i><i class=\"chip\"></i></div>",
    "<div class=\"mini m-tg\"><div class=\"th\"><i class=\"av\"></i><i class=\"nm\"></i></div><i class=\"b in\"></i><i class=\"b out\"></i><i class=\"b in s\"></i><i class=\"ok\"></i></div>"];
  var ART = [
    win + '<rect x="70" y="30" width="60" height="9" rx="4.5" fill="#fff" opacity=".7"/><rect x="30" y="45" width="78" height="22" rx="5" ' + W + '/><path d="M36 52h60M36 58h44" ' + W + ' opacity=".6"/><rect x="30" y="70" width="40" height="7" rx="3.5" fill="' + A + '"/>',
    win + '<rect x="28" y="28" width="62" height="52" ' + W + '/><path d="M34 36h50M34 42h50M34 60h50M34 72h36" ' + W + ' opacity=".5"/><rect x="33" y="46" width="52" height="5" fill="#FFC857" opacity=".8"/><rect x="33" y="64" width="40" height="5" fill="#FF6B6B" opacity=".8"/><rect x="98" y="30" width="36" height="12" rx="2" fill="' + A + '" opacity=".85"/><rect x="98" y="46" width="36" height="12" rx="2" ' + W + '/>',
    win + '<rect x="28" y="30" width="44" height="8" rx="2" ' + W + '/><rect x="28" y="42" width="44" height="8" rx="2" ' + W + '/><rect x="28" y="54" width="44" height="8" rx="2" ' + W + '/><rect x="28" y="68" width="26" height="9" rx="4.5" fill="' + A + '"/><rect x="82" y="28" width="50" height="54" ' + W + '/><path d="M88 36h38M88 42h38M88 48h30M88 56h38M88 62h38" ' + W + ' opacity=".5"/>',
    win + '<circle cx="34" cy="32" r="4" fill="#fff" opacity=".8"/><circle cx="44" cy="32" r="4" fill="' + A + '"/><circle cx="54" cy="32" r="4" fill="#fff" opacity=".4"/><rect x="28" y="42" width="104" height="38" ' + W + '/><path d="M34 50h80M34 57h92M34 64h60M34 71h84" ' + W + ' opacity=".5"/><path d="M118 50v6" stroke="' + A + '" stroke-width="1.6"/><path d="M98 64v6" stroke="#FFC857" stroke-width="1.6"/>',
    win + [0, 1, 2].map(function (i) { var x = 28 + i * 36; return '<rect x="' + x + '" y="34" width="30" height="42" rx="3" ' + W + '/><circle cx="' + (x + 15) + '" cy="46" r="6" fill="' + (i === 1 ? A : '#fff') + '" opacity="' + (i === 1 ? 1 : 0.5) + '"/><path d="M' + (x + 5) + ' 60h20M' + (x + 5) + ' 66h14" ' + W + ' opacity=".5"/>'; }).join('')
  ];
  function renderFeatures() {
    var box = $('#tools'); if (!box) return;
    box.innerHTML = '';
    dict['features.items'].forEach(function (it, i) {
      var d = document.createElement('article'); d.className = 'tool';
      d.innerHTML = '<div class="media">' + MINI[i] + (FEATURE_VIDEOS[i] ? '<video data-video="' + FEATURE_VIDEOS[i] + '" data-card="1" muted loop playsinline preload="none"></video>' : '') + '</div><h3></h3><p></p>';
      $('h3', d).textContent = it[0]; $('p', d).textContent = it[1];
      if (dict['features.long']) {                      // ustiga borilganda: shisha panel — ko'proq ma'lumot va o'q tugmasi
        var hv = document.createElement('div'); hv.className = 'tool-hv'; hv.setAttribute('aria-hidden', 'true');
        hv.innerHTML = '<small></small><b></b><p></p><span class="hv-f"><em></em><i><svg viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4"/></svg></i></span>';
        $('small', hv).textContent = (i < 9 ? '0' : '') + (i + 1) + ' / ' + (dict['features.items'].length < 10 ? '0' : '') + dict['features.items'].length;
        $('b', hv).textContent = it[0]; $('p', hv).textContent = dict['features.long'][i] || it[1]; $('em', hv).textContent = dict['features.more'];
        d.appendChild(hv);
      }
      if (FEATURE_PAGES[i]) { var more = document.createElement('a'); more.className = 'more'; more.href = FEATURE_PAGES[i]; more.textContent = '↳ ' + dict['features.more']; d.appendChild(more); d.addEventListener('click', function (e) { if (e.target.closest('a')) return; d.classList.add('go'); setTimeout(function () { d.classList.remove('go'); location.href = FEATURE_PAGES[i]; }, still.matches ? 0 : 170); }); d.style.cursor = 'pointer'; }
      var v = $('video', d);
      if (v) {
        d.addEventListener('mouseenter', function () { if (!still.matches) { loadVideo(v); play(v); } });
        d.addEventListener('mouseleave', function () { if (!touch.matches) v.pause(); });
      }
      box.appendChild(d);
    });
    watchVideos(box);
  }

  /* ---------- kimlar uchun ----------
     Har bir auditoriyada chapda uchta va'da, o'ngda qurilma ekrani (telefon yoki noutbuk).
     Ekrandagi uchta sahna chapdagi uchta va'dani navbat bilan ko'rsatadi; joriy va'da chapda belgilanadi.
     videos/A1…A5 (-mobile.mp4 yoki -web.mp4) qo'yilsa, sahnalar o'rnida o'sha video o'ynaydi. */
  var audIdx = 0, runId = 0, flowVisible = false, hasVideo = false, devScale = 1;
  var DEVICE = ['phone', 'phone', 'mac', 'mac', 'mac'], DEV_SIZE = { phone: [296, 610], mac: [580, 384] };
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sleep(ms, id) { return new Promise(function (ok, no) { if (still.matches) return id === runId ? ok() : no(); setTimeout(function () { id === runId ? ok() : no(); }, ms); }); }
  async function type(el, text, id, sp) {
    if (still.matches) { el.textContent = text; return; }
    el.textContent = ''; el.classList.add('caret');
    for (var k = 0; k < text.length; k++) { el.textContent += text[k]; await sleep(sp || 30, id); }
    el.classList.remove('caret');
  }
  async function stream(el, text, id) {
    if (still.matches) { el.textContent = text; return; }
    var w = text.split(' '); el.textContent = '';
    for (var k = 0; k < w.length; k++) { el.textContent += (k ? ' ' : '') + w[k]; await sleep(65, id); }
  }
  function on(el) { el.classList.add('on'); }
  function off(el) { el.classList.remove('on'); }
  async function each(list, ms, id, fn) { for (var k = 0; k < list.length; k++) { (fn || on)(list[k], k); await sleep(ms, id); } }
  function cursorEl(st) { return $('.mk-cursor', st.parentNode); }
  async function point(st, target, id, keep) {     // ko'rsatkich (yoki barmoq) borib bosadi
    var c = cursorEl(st); if (!c || still.matches) return;
    var a = st.parentNode.getBoundingClientRect(), b = target.getBoundingClientRect();
    c.classList.add('on'); c.style.transform = 'translate(' + ((b.left - a.left) / devScale + Math.min(b.width / devScale / 2, 70)) + 'px,' + ((b.top - a.top + b.height / 2) / devScale) + 'px)';
    await sleep(800, id); c.classList.add('tap'); await sleep(240, id); c.classList.remove('tap');
    if (!keep) c.classList.remove('on');
  }
  /* kichik chiziqli ikonalar */
  var IC = {
    file: '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>',
    up: '<path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13.5h10"/>',
    down: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
    send: '<path d="M14 2 2 7l4.5 2L8 13.5z"/><path d="M14 2 6.5 9"/>',
    check: '<path d="m3 8.5 3.2 3.2L13 4.8"/>',
    link: '<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8"/><path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8"/>',
    phone: '<path d="M3 2.5h2.5l1 3-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 3 1V13a1.5 1.5 0 0 1-1.6 1.5C6.6 14 2 9.4 1.5 4.1A1.5 1.5 0 0 1 3 2.5z"/>'
  };
  function ic(n) { return '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">' + IC[n] + '</svg>'; }
  /* ekran tepasidagi holat qatori: telefon (soat, antenna, wifi, batareya) va noutbuk */
  var SB_NET = '<svg viewBox="0 0 17 12"><rect x="0" y="8" width="3" height="4" rx=".8"/><rect x="4.5" y="5.5" width="3" height="6.5" rx=".8"/><rect x="9" y="3" width="3" height="9" rx=".8"/><rect x="13.5" y="0" width="3" height="12" rx=".8"/></svg>';
  var SB_IC = '<svg viewBox="0 0 16 12"><path d="M1.2 4.4a9.8 9.8 0 0 1 13.6 0M3.7 7a6.2 6.2 0 0 1 8.6 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="10" r="1.5"/></svg>' +
    '<svg viewBox="0 0 26 12"><rect x=".6" y=".6" width="21.8" height="10.8" rx="3" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/><rect x="2.3" y="2.3" width="14" height="7.4" rx="1.6"/><path d="M24 4v4c.8-.3 1.4-1.100 1.4-2S24.800 4.300 24 4z" opacity=".5"/></svg>';
  function statusBar(dv) {
    return dv === 'phone' ? '<div class="sbar"><span>12:12</span><span class="si">' + SB_NET + SB_IC + '</span></div>'
      : '<div class="mbar"><span><b>JuristAI</b></span><span class="si">' + SB_IC + '<em>12:12</em></span></div>';
  }
  /* telefon klaviaturasi: yozilayotgan harfning tugmasi bosiladi */
  var KB = { ru: ['йцукенгшщзх', 'фывапролджэ', 'ячсмитьбю'] }, KB_LAT = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  function kbd() {
    var rows = KB[document.documentElement.lang] || KB_LAT;
    return '<div class="kbd">' + rows.map(function (r, i) {
      return '<div class="kr">' + (i === 2 ? '<b class="kx">⇧</b>' : '') + r.split('').map(function (c) { return '<b data-k="' + c + '">' + c + '</b>'; }).join('') + (i === 2 ? '<b class="kx">⌫</b>' : '') + '</div>';
    }).join('') + '<div class="kr"><b class="kx">123</b><b class="sp" data-k=" "></b><b class="kx go">↵</b></div></div>';
  }
  async function typeKb(st, el, text, id, sp) {
    var kb = $('.kbd', st);
    if (still.matches || !kb) { el.textContent = text; return; }
    var keys = {}; $$('[data-k]', kb).forEach(function (b) { keys[b.dataset.k] = b; });
    function hit(b) { if (!b) return; b.classList.add('hit'); setTimeout(function () { b.classList.remove('hit'); }, 130); }
    on(kb); await sleep(450, id);
    el.textContent = ''; el.classList.add('caret');
    for (var k = 0; k < text.length; k++) { el.textContent += text[k]; hit(keys[text[k].toLowerCase()]); await sleep(sp || 55, id); }
    el.classList.remove('caret'); await sleep(250, id);
    hit($('.go', kb)); await sleep(200, id); off(kb);
  }
  /* yuklangan fayl qatori: yuklanish chizig'i to'ladi, so'ng «Yuklandi» belgisi chiqadi */
  function upFile(name) { return '<div class="upf">' + ic('file') + '<span class="fn">' + esc(name) + '</span><em>' + ic('check') + esc(dict['aud.upd']) + '</em><i class="pg"></i></div>'; }
  async function upload(st, id) { var f = $('.upf', st); on(f); await sleep(250, id); f.classList.add('load'); await sleep(950, id); f.classList.add('done'); await sleep(450, id); }
  function fileRow(name) { return '<div class="mk-file fx"><span class="fn">' + ic('file') + esc(name) + '</span><span class="dl">' + ic('down') + esc(dict['aud.dl']) + '</span></div>'; }
  async function download(st, id) {
    var row = $('.mk-file', st); on(row); await sleep(500, id);
    await point(st, $('.dl', row), id); row.classList.add('got'); $('.dl', row).innerHTML = ic('check') + esc(dict['aud.dled']);
  }
  function bars(n) { var s = ''; for (var k = 0; k < n; k++) s += '<u></u>'; return s; }

  /* lex.uz telefon skrinshotidagi qatorlar: [x0, x1, y0, y1], asl skrinshot (589x1280) piksellarida */
  var LEX_IMG = ROOT + 'img/lex-128-4-2x.webp', LEX_W = 589, LEX_H = 1280;
  var LEX_LINES = [[106, 549, 337, 362], [30, 549, 364, 388], [30, 549, 391, 415], [30, 549, 418, 442], [30, 377, 444, 465],
    [107, 549, 515, 540], [30, 549, 542, 566], [30, 107, 569, 589],
    [105, 549, 750, 774], [30, 549, 776, 801], [30, 549, 803, 827], [30, 420, 830, 850],
    [107, 549, 901, 925], [30, 549, 928, 952], [30, 107, 955, 975]].map(function (r) { return [r[0] / LEX_W, r[1] / LEX_W, r[2] / LEX_H, r[3] / LEX_H]; });

  var SHARE_IC = [
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#2AABEE"/><path fill="#fff" d="M8.5 19.3 29 11.4c1-.4 1.8.2 1.5 1.7L27 29.5c-.2 1.2-1 1.5-1.9.9l-5.300-3.900-2.500 2.500c-.3.3-.5.5-1.100.5l.4-5.400 9.800-8.800c.4-.4-.1-.6-.7-.2l-12.100 7.600-5.200-1.600c-1.100-.4-1.200-1.100.1-1.800z"/></svg>',
    '<svg viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#1E88F5"/><rect x="8" y="12" width="24" height="16" rx="2.5" fill="#fff"/><path d="m9 13.5 11 8.5 11-8.5" fill="none" stroke="#1E88F5" stroke-width="1.8"/></svg>',
    '<svg viewBox="0 0 40 40"><rect x=".5" y=".5" width="39" height="39" rx="10" fill="#fff" stroke="#DDD"/><path d="M12 6.5h11l6 6v21H12z" fill="#E5252A"/><path d="M23 6.5v6h6z" fill="#fff" opacity=".5"/><text x="20.5" y="27.5" text-anchor="middle" font-size="7.5" font-weight="700" fill="#fff" font-family="Arial,sans-serif">PDF</text></svg>'
  ];
  var ACTS = [
  /* ================= 0. FUQAROLAR (telefon) ================= */
  [
    /* AI chat: savol yoziladi, javob keladi, manba bosiladi, lex.uz sahifasi yaqinlashib qatorma-qator o'qiladi */
    { html: function (s) {
        return '<div class="app-h">JuristAI</div><div class="chat"><div class="mk-q fx"></div><div class="mk-dots"><i></i><i></i><i></i></div><div class="mk-a fx"></div><div class="mk-src fx">' + esc(s.src) + '</div></div>' +
          '<div class="mk-input"><span class="ph">' + esc(s.ph) + '</span><span class="tx"></span><i class="snd">' + ic('send') + '</i></div>' + kbd() +
          '<div class="lex"><div class="lex-view"><div class="lex-cam"><img src="' + LEX_IMG + '?v=' + VIDEO_VER + '" alt="">' +
          LEX_LINES.map(function (r) { return '<i class="lh" style="left:' + r[0] * 100 + '%;width:' + (r[1] - r[0]) * 100 + '%;top:' + r[2] * 100 + '%;height:' + (r[3] - r[2]) * 100 + '%"></i>'; }).join('') + '</div></div></div>';
      },
      play: async function (st, s, id) {
        var tx = $('.tx', st), q = $('.mk-q', st);
        $('.ph', st).hidden = true; await typeKb(st, tx, s.q, id); await sleep(200, id);
        q.textContent = s.q; on(q); tx.textContent = ''; $('.ph', st).hidden = false;
        on($('.mk-dots', st)); await sleep(1200, id); off($('.mk-dots', st));
        on($('.mk-a', st)); await stream($('.mk-a', st), s.a, id); await sleep(300, id);
        on($('.mk-src', st)); await sleep(400, id); await point(st, $('.mk-src', st), id);
        on($('.lex', st)); st.parentNode.classList.add('lexon');
        var lh = $$('.lh', st);
        if (still.matches) { lh.forEach(on); return; }
        await sleep(900, id);
        var view = $('.lex-view', st), cam = $('.lex-cam', st), W = view.clientWidth, VH = view.clientHeight, H = W * LEX_H / LEX_W, S = 1.75;
        function at(fx, fy) {
          var x = Math.max(W - S * W, Math.min(0, W / 2 - S * fx * W)), y = Math.max(VH - S * H, Math.min(0, VH / 2 - S * fy * H));
          return 'translate(' + x + 'px,' + y + 'px) scale(' + S + ')';
        }
        function cam2(t, dur, ease) { cam.style.transition = 'transform ' + dur + 's ' + (ease || 'cubic-bezier(.3,.7,.2,1)'); cam.style.transform = t; }
        for (var k = 0; k < LEX_LINES.length; k++) {
          var r = LEX_LINES[k], yc = (r[2] + r[3]) / 2, d = Math.max(0.3, (r[1] - r[0]) * LEX_W / 10.7 / 51);
          cam2(at(r[0] + 0.27, yc), k ? 0.34 : 1.1); await sleep(k ? 360 : 1200, id);
          if (k) lh[k - 1].classList.add('out');
          lh[k].style.transitionDuration = d + 's'; on(lh[k]);
          cam2(at(r[1] - 0.27, yc), d, 'linear'); await sleep(d * 1000 + 90, id);
        }
        await sleep(350, id); lh[lh.length - 1].classList.add('out');
        cam2('none', 0.9); await sleep(2100, id);          // sahifa asl hajmiga qaytadi
      } },
    /* Telegram bot: «Boshlash» bosiladi, bot salomlashadi, savol yuboriladi, javob manba bilan qaytadi */
    { html: function (s) {
        return '<div class="tg-h"><b></b><div><strong>' + esc(s.bot) + '</strong><small>bot</small></div></div><div class="tg-body">' + (dict['tgd.linked'] ? '<div class="tg-m in fx tg-lk">✓ ' + esc(dict['tgd.linked']) + '</div>' : '') + '<div class="tg-m in fx">' + esc(s.hi) + '</div>' +
          '<div class="tg-m out fx"><span class="t"></span><em>✓✓</em></div><div class="tg-m in fx r2"><span class="t"></span><a class="fx">' + esc(s.src2) + '</a></div></div>' +
          '<div class="tg-start">' + esc(s.start) + '</div><div class="tg-in fx"><span class="tx"></span><i>' + ic('send') + '</i></div>' + kbd();
      },
      play: async function (st, s, id) {
        var ms = $$('.tg-m:not(.tg-lk)', st), lk = $('.tg-lk', st), start = $('.tg-start', st), inp = $('.tg-in', st);
        await sleep(500, id); await point(st, start, id); start.classList.add('gone'); on(inp);
        if (lk) { await sleep(250, id); on(lk); await sleep(900, id); }
        await sleep(300, id); on(ms[0]); await sleep(700, id);
        await typeKb(st, $('.tx', inp), s.q2, id); await sleep(150, id);
        $('.tx', inp).textContent = ''; $('.t', ms[1]).textContent = s.q2; on(ms[1]); await sleep(500, id); ms[1].classList.add('read');
        await sleep(700, id); on(ms[2]); await stream($('.t', ms[2]), s.a2, id); on($('a', ms[2])); await sleep(900, id);
      } },
    /* Advokatlar katalogi: soha tanlanadi, ro'yxat ko'tariladi, bitta advokat ochiladi, «Bog'lanish» */
    { html: function (s) {
        return '<div class="app-h">' + esc(s.cat) + '</div><div class="chips">' + s.filters.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div><div class="law">' +
          s.lawyers.map(function (l) { return '<div class="lw fx"><b></b><div><strong>' + esc(l[0]) + '</strong><small>' + esc(l[1]) + '</small><div class="more"><span>✓ ' + esc(s.lic) + '</span><button>' + ic('phone') + esc(s.call) + '</button></div></div></div>'; }).join('') + '</div>';
      },
      play: async function (st, s, id) {
        var chips = $$('.chips span', st), lw = $$('.lw', st);
        await sleep(400, id); await point(st, chips[0], id); chips[0].classList.add('sel');
        await each(lw, 160, id); await sleep(400, id);
        await point(st, lw[0], id); lw[0].classList.add('open'); lw.slice(1).forEach(function (x) { x.classList.add('dim'); }); await sleep(900, id);
        await point(st, $('button', lw[0]), id); $('button', lw[0]).classList.add('ok'); await sleep(900, id);
      } }
  ],
  /* ================= 1. TADBIRKORLAR (telefon) ================= */
  [
    /* Hujjat tahlili: fayl yuklanadi, nur bandlar ustidan o'tadi, xavf belgilanadi, tavsiya yoziladi */
    { html: function (s) {
        return '<div class="app-h">' + esc(s.title) + '<small>' + esc(s.file) + '</small></div><div class="upz"><div class="upc">' + ic('up') + '<span>' + esc(dict['aud.up']) + '</span></div>' + upFile(dict['aud.fn'][0]) + '</div><div class="scan">' +
          '<div class="sc-t">' + esc(s.title) + '</div>' + s.c.map(function (t) { return '<div class="mk-cl fx"><p>' + esc(t) + '</p><span class="mk-tag fx"></span></div>' + bars(2); }).join('') + '<i class="beam"></i></div><div class="rec"></div><div class="mk-sum fx">' + esc(s.sum) + '</div>';
      },
      play: async function (st, s, id) {
        var lv = ['ok', 'risk', 'warn'], cl = $$('.mk-cl', st), beam = $('.beam', st);
        await sleep(500, id); await point(st, $('.upc', st), id); $('.upz', st).classList.add('pick'); await upload(st, id); await each(cl, 200, id);
        on(beam); await sleep(250, id);
        for (var k = 0; k < cl.length; k++) {
          beam.style.top = (cl[k].offsetTop + cl[k].offsetHeight + 4) + 'px'; await sleep(850, id);
          cl[k].classList.add(lv[k]); var t = $('.mk-tag', cl[k]); t.textContent = s[lv[k]]; on(t);
        }
        off(beam); await sleep(400, id); cl[1].classList.add('focus'); await type($('.rec', st), s.rec, id, 22); on($('.mk-sum', st)); await sleep(700, id);
      } },
    /* AI chat: mavzu tanlanadi, savol ketadi, javob tekshiruv ro'yxati sifatida birma-bir belgilanadi */
    { html: function (s) {
        return '<div class="app-h">JuristAI</div><div class="chips">' + s.topics.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div><div class="chat"><div class="mk-q fx">' + esc(s.q2) + '</div>' +
          '<div class="ck fx">' + s.checks.map(function (x) { return '<div class="ckr"><i></i><span>' + esc(x) + '</span></div>'; }).join('') + '<div class="mk-src fx">' + esc(s.src2) + '</div><div class="srcl">' + dict['aud.srcs'].map(function (x) { return '<a class="fx">' + ic('link') + '<span>' + esc(x) + '</span></a>'; }).join('') + '</div></div></div>';
      },
      play: async function (st, s, id) {
        var chips = $$('.chips span', st), rows = $$('.ckr', st);
        await sleep(400, id); await point(st, chips[1], id); chips[1].classList.add('sel'); await sleep(300, id);
        on($('.mk-q', st)); await sleep(700, id); on($('.ck', st)); await sleep(400, id);
        await each(rows, 800, id, function (r) { r.classList.add('run'); setTimeout(function () { r.classList.add('ok'); }, 520); });
        on($('.mk-src', st)); await sleep(350, id); await each($$('.srcl a', st), 280, id); await sleep(900, id);
      } },
    /* Hujjat tayyorlash: shartnoma bo'limlari yozilib boradi, tayyor bo'lgach pastdan ulashish oynasi chiqadi */
    { html: function (s) {
        return '<div class="app-h">' + esc(s.tplName) + '</div><div class="build">' + s.secs.map(function (x) { return '<div class="bs fx"><strong>' + esc(x) + '</strong>' + bars(2) + '</div>'; }).join('') + '</div>' +
          fileRow(s.file) + '<div class="rdy"><i></i>' + esc(s.ready) + '</div><div class="sheet"><b></b><div class="shr">' + s.share.map(function (x, k) { return '<span><i>' + SHARE_IC[k] + '</i>' + esc(x) + '</span>'; }).join('') + '</div></div>';
      },
      play: async function (st, s, id) {
        var bs = $$('.bs', st);
        await sleep(300, id); await each(bs, 480, id, function (b) { on(b); b.classList.add('w'); });
        await sleep(300, id); await download(st, id); await sleep(400, id); on($('.rdy', st)); await sleep(800, id); on($('.sheet', st)); await sleep(700, id);
        var sp = $$('.shr span', st); await point(st, sp[0], id); sp[0].classList.add('sel'); await sleep(900, id);
      } }
  ],
  /* ================= 2. YURISTLAR (noutbuk) ================= */
  [
    /* Qonunchilik qidiruvi: so'rov yoziladi, chapdagi filtrlar yonadi, manbalar kirib kelib tekshiriladi */
    { html: function (s) {
        return '<div class="win"><aside>' + s.kinds.map(function (x) { return '<label class="fx"><i></i>' + esc(x) + '</label>'; }).join('') + '</aside><main><div class="mk-search">' + ic('search') + '<span class="tx"></span></div><div class="res">' +
          s.r.map(function (t, k) { return '<div class="mk-res fx"><div class="rs-t"><p><sup>' + (k + 1) + '</sup> ' + esc(t) + '</p><span class="mk-tag state">' + esc(s.chk) + '</span></div>' + bars(2) + '</div>'; }).join('') + '</div></main></div>';
      },
      play: async function (st, s, id) {
        var rows = $$('.mk-res', st), labs = $$('aside label', st);
        labs.forEach(on); await type($('.mk-search .tx', st), s.q, id, 30); await sleep(250, id);
        for (var k = 0; k < rows.length; k++) { labs[k].classList.add('hit'); on(rows[k]); await sleep(420, id); }
        for (k = 0; k < rows.length; k++) { await sleep(560, id); var s2 = $('.state', rows[k]); s2.textContent = s.tag; s2.classList.add('ok'); }
        await sleep(900, id);
      } },
    /* Yuridik xulosa: chapda manbalar, o'ngda xulosa yozilib boradi; har jumla manbaga bog'lanadi; fayl yuklab olinadi */
    { html: function (s) {
        return '<div class="win two"><aside class="srcs">' + s.r.map(function (t, k) { return '<div class="sr"><sup>' + (k + 1) + '</sup> ' + esc(t) + bars(3) + '</div>'; }).join('') + '</aside><main><div class="draft on"><div class="p-t">' + esc(s.dT) + '</div>' +
          s.d.map(function (t, k) { return '<p><span class="tx"></span><sup class="fx">' + s.n[k] + '</sup></p>'; }).join('') + '</div>' + fileRow(s.file) + '</main></div>';
      },
      play: async function (st, s, id) {
        var ps = $$('.draft p', st), sr = $$('.sr', st);
        await sleep(400, id);
        for (var k = 0; k < ps.length; k++) {
          sr[s.n[k] - 1].classList.add('cite'); await type($('.tx', ps[k]), s.d[k], id, 22); on($('sup', ps[k])); await sleep(500, id); sr[s.n[k] - 1].classList.remove('cite');
        }
        await download(st, id); await sleep(700, id);
      } },
    /* Hujjat tahlili: belgi shartnoma bandlari bo'ylab pastga yuradi, har bandga o'ng hoshiyada izoh chiqadi */
    { html: function (s) {
        var lv = ['ok', 'warn', 'risk'];
        return '<div class="win two rev"><main>' + upFile(dict['aud.fn'][1]) + '<div class="p-t">' + esc(s.docT) + '</div><div class="cls">' + s.cls.map(function (t) { return '<div class="cl2"><strong>' + esc(t) + '</strong>' + bars(3) + '</div>'; }).join('') + '<i class="cband"></i></div></main>' +
          '<aside class="notes">' + s.notes.map(function (t, k) { return '<div class="nt fx ' + lv[k] + '">' + esc(t) + '</div>'; }).join('') + '</aside></div>';
      },
      play: async function (st, s, id) {
        var cl = $$('.cl2', st), nt = $$('.nt', st), band = $('.cband', st);
        await sleep(300, id); await upload(st, id); on(band);
        for (var k = 0; k < cl.length; k++) {
          band.style.transform = 'translateY(' + cl[k].offsetTop + 'px)'; band.style.height = cl[k].offsetHeight + 'px'; await sleep(750, id);
          nt[k].style.marginTop = k ? '' : (cl[0].getBoundingClientRect().top - nt[0].parentNode.getBoundingClientRect().top) / devScale + 'px'; on(nt[k]); await sleep(650, id);
        }
        band.classList.add('risk'); await sleep(1100, id);
      } }
  ],
  /* ================= 3. HR VA BUXGALTERIYA (noutbuk) ================= */
  [
    /* Hujjat tayyorlash: shablon tanlanadi, maydonlar to'ldiriladi, o'ngdagi hujjatda bo'sh joylar qiymatga almashadi */
    { html: function (s) {
        var body = esc(s.body).replace(/\{(\d)\}/g, function (_, n) { return '<span class="slot" data-n="' + n + '">' + esc(s.f[n]) + '</span>'; });
        return '<div class="win two"><aside class="form"><div class="tpl">' + s.tpl.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
          s.f.map(function (t) { return '<div class="mk-field"><label>' + esc(t) + '</label><i><span class="tx"></span></i></div>'; }).join('') + '</aside>' +
          '<main><div class="paper on"><div class="p-t">' + esc(s.title) + '<span class="stamp">' + esc(s.btn) + '</span></div><p>' + body + '</p>' + bars(6) + '</div>' + fileRow(s.file) + '</main></div>';
      },
      play: async function (st, s, id) {
        var chips = $$('.tpl span', st), fields = $$('.mk-field', st), slots = $$('.slot', st), k;
        await sleep(300, id); await point(st, chips[0], id); chips[0].classList.add('sel');
        for (k = 0; k < fields.length; k++) {                       // maydon yozilishi bilan hujjatdagi o'rni ham almashadi
          await type($('.tx', fields[k]), s.vals[k], id, 42);
          for (var j = 0; j < slots.length; j++) if (+slots[j].dataset.n === k) { slots[j].classList.add('flip'); await sleep(200, id); slots[j].textContent = s.vals[k]; slots[j].classList.add('set'); slots[j].classList.remove('flip'); }
          await sleep(250, id);
        }
        on($('.stamp', st)); $('.paper', st).classList.add('ready'); await sleep(700, id); await download(st, id); await sleep(600, id);
      } },
    /* O'z shablonlaringiz: fayl maydonga tashlanadi, ro'yxatga qo'shiladi, hujjat firma blankasi ko'rinishini oladi */
    { html: function (s) {
        return '<div class="win two"><aside class="form"><div class="drop"><span>' + ic('up') + '<br>' + esc(s.drop) + '</span><b class="chip">' + ic('file') + '<span>' + esc(s.tfile) + '</span></b><i class="pg"></i></div>' +
          '<div class="tlist"><div><span>' + ic('file') + esc(s.tpl[0]) + '</span></div><div><span>' + ic('file') + esc(s.tpl[1]) + '</span></div><div class="new fx"><span>' + ic('file') + esc(s.tfile) + '</span><em>' + esc(s.mine) + '</em></div></div></aside>' +
          '<main><div class="paper on bp"><div class="lhd"><b></b><strong>' + esc(s.org) + '</strong></div><div class="p-t">' + esc(s.title) + '</div>' + bars(10) + '<div class="applied fx">' + esc(s.applied) + '</div></div></main></div>';
      },
      play: async function (st, s, id) {
        var drop = $('.drop', st);
        await sleep(400, id); drop.classList.add('drag'); await sleep(1000, id); drop.classList.add('in'); await sleep(900, id);
        drop.classList.add('done'); $('.chip', drop).innerHTML = ic('check') + '<span>' + esc(dict['aud.upd']) + '</span>'; on($('.tlist .new', st)); await sleep(700, id);
        await point(st, $('.tlist .new', st), id); $('.tlist .new', st).classList.add('sel');
        $('.paper', st).classList.add('styled'); await sleep(900, id); on($('.applied', st)); await sleep(1000, id);
      } },
    /* Skan tahlili: qiyshiq qog'oz to'g'rilanadi, skaner chapdan o'ngga o'tadi, o'ngda ma'lumot jadvalga ajraladi */
    { html: function (s) {
        return '<div class="win two"><aside class="scanbox">' + upFile(dict['aud.fn'][2]) + '<div class="sheet2">' + bars(6) + '<i class="vbeam"></i></div><small class="fx">' + esc(s.ocr) + '</small></aside>' +
          '<main><div class="p-t">' + esc(s.scanT) + '</div><div class="kv">' + s.rows.map(function (r) { return '<div class="kvr fx"><label>' + esc(r[0]) + '</label><span class="tx"></span></div>'; }).join('') + '</div><div class="mk-done fx">' + esc(s.done) + '</div></main></div>';
      },
      play: async function (st, s, id) {
        var sh = $('.sheet2', st), rows = $$('.kvr', st);
        await sleep(300, id); await upload(st, id); await sleep(300, id); sh.classList.add('flat'); await sleep(900, id);
        on($('small', st)); sh.classList.add('scan'); await sleep(1500, id); sh.classList.add('read');
        for (var k = 0; k < rows.length; k++) { on(rows[k]); await type($('.tx', rows[k]), s.rows[k][1], id, 40); await sleep(200, id); }
        on($('.mk-done', st)); await sleep(1000, id);
      } }
  ],
  /* ================= 4. ADVOKATLIK FIRMALARI (noutbuk) ================= */
  [
    /* Jamoa Workspace: a'zolar ulanadi, doskada vazifa «Tayyor»ga suriladi, «Reja»ga o'tiladi va vaqt chizig'i muddatgacha suriladi */
    { html: function (s) {
        var col = [2, 1, 0, 0], who = [0, 1, 2, 0];
        function card(k) { return '<div class="kcard k' + k + ' fx"><p>' + esc(s.tasks[k]) + '</p><span><b>' + esc(s.names[who[k]][0]) + '</b>' + esc(s.dates[k]) + '</span></div>'; }
        return '<div class="win ws"><aside><strong>' + esc(s.title) + '</strong>' + s.names.map(function (n) { return '<div class="mem fx"><b>' + esc(n[0]) + '</b>' + esc(n) + '<i></i></div>'; }).join('') + '</aside>' +
          '<main><div class="wtabs"><span class="sel">' + esc(s.tabs[0]) + '</span><span>' + esc(s.tabs[1]) + '</span></div><div class="views"><div class="rail">' +
          '<div class="kb">' + s.cols.map(function (c, ci) { return '<div class="kc"><h5>' + esc(c) + '</h5>' + [0, 1, 2, 3].filter(function (k) { return col[k] === ci; }).map(card).join('') + '</div>'; }).join('') + '</div>' +
          '<div class="gt"><div class="gin"><div class="gw">' + s.weeks.map(function (w) { return '<span>' + esc(w) + '</span>'; }).join('') + '</div>' +
          [[2, 30], [20, 42], [48, 16], [66, 26]].map(function (b, k) { return '<div class="gr"><label>' + esc(s.tasks[k]) + '</label><div class="gtrack"><i class="gbar k' + k + '" style="left:' + b[0] + '%" data-w="' + b[1] + '"></i>' + (k === 3 ? '<i class="gms"></i><span class="gdead fx">' + esc(s.dead) + '</span>' : '') + '</div></div>'; }).join('') +
          '<i class="gtoday"><em>' + esc(s.today) + '</em></i></div></div></div></div></main></div>';
      },
      play: async function (st, s, id) {
        var mem = $$('.mem', st), cards = $$('.kcard', st), tabs = $$('.wtabs span', st), rail = $('.rail', st);
        await each(mem, 300, id, function (m) { on(m); m.classList.add('live'); });
        await each(cards, 220, id); await sleep(400, id);
        var c = $('.kcard.k1', st), done = $$('.kc', st)[2];
        await point(st, c, id, true);
        var a = c.getBoundingClientRect(); done.appendChild(c); var b = c.getBoundingClientRect();
        c.style.transition = 'none'; c.style.transform = 'translate(' + (a.left - b.left) / devScale + 'px,' + (a.top - b.top) / devScale + 'px) rotate(-3deg)'; c.getBoundingClientRect();
        c.style.transition = 'transform .9s cubic-bezier(.3,.7,.2,1)'; c.style.transform = 'none'; c.classList.add('moved');
        var cu = cursorEl(st), sr = st.parentNode.getBoundingClientRect();
        if (cu) cu.style.transform = 'translate(' + ((b.left - sr.left) / devScale + 30) + 'px,' + ((b.top - sr.top + b.height / 2) / devScale) + 'px)';
        await sleep(1200, id);
        await point(st, tabs[1], id); tabs[0].classList.remove('sel'); tabs[1].classList.add('sel');
        rail.classList.add('plan'); await sleep(900, id);                                  // doska chapga ketadi, reja o'ngdan keladi
        var bs = $$('.gbar', st);
        for (var k = 0; k < bs.length; k++) { bs[k].style.width = bs[k].dataset.w + '%'; await sleep(380, id); }
        on($('.gtoday', st)); await sleep(700, id);
        $('.gin', st).classList.add('pan'); await sleep(1100, id);                        // vaqt chizig'i muddat tomonga suriladi
        on($('.gms', st)); on($('.gdead', st)); await sleep(1300, id);
      } },
    /* Jamoa xotirasi: savol yoziladi, qidiruv javonlar bo'ylab yuradi, har javondan topilgan material javobga qo'shiladi */
    { html: function (s) {
        return '<div class="win two mem2"><aside>' + s.mem.map(function (x) { return '<div class="shelf"><i></i><i></i><i></i><span>' + esc(x) + '</span></div>'; }).join('') + '</aside>' +
          '<main><div class="mk-search">' + ic('search') + '<span class="tx"></span></div><div class="found">' + s.found.map(function (x, k) { return '<div class="fd fx"><strong>' + ic('file') + esc(x) + '</strong><small>↳ ' + esc(s.mem[k]) + '</small></div>'; }).join('') + '</div><div class="mk-done fx">' + esc(s.ans) + '</div></main></div>';
      },
      play: async function (st, s, id) {
        var sh = $$('.shelf', st), fd = $$('.fd', st);
        await type($('.mk-search .tx', st), s.mq, id, 28); await sleep(300, id);
        for (var k = 0; k < sh.length; k++) { sh[k].classList.add('seek'); await sleep(750, id); sh[k].classList.remove('seek'); sh[k].classList.add('hit'); on(fd[k]); await sleep(350, id); }
        on($('.mk-done', st)); await sleep(1100, id);
      } },
    /* Rahbar nazorati: bot guruhiga vazifa holatlari birma-bir keladi, rahbar tasdiqlaydi, «Bugungi hisobot» bosiladi */
    { html: function (s) {
        return '<div class="mn-h"><b>' + ic('check') + '</b><div><strong>' + esc(s.bot) + '</strong><small>bot</small></div></div><div class="mn-body"><div class="mn-list">' +
          s.msgs.map(function (m) { return '<div class="mn-m"><strong>' + esc(m[0]) + '</strong><span>👤 ' + esc(m[1]) + '</span><span>⏰ ' + esc(s.due) + ': ' + esc(m[2]) + '</span><span class="mn-s">' + (m[3] === 'late' ? '🟡 ' : '✅ ') + esc(s.st[m[3]]) + '</span><span class="mn-ok">✅ ' + esc(s.ok) + '</span></div>'; }).join('') +
          '<div class="mn-m mn-rep">📊 ' + esc(s.rep) + '</div></div></div>' +
          '<div class="mn-kb">' + s.btns.map(function (x, k) { return '<span>' + ['📋 ', '📌 ', '📊 ', '📎 '][k] + esc(x) + '</span>'; }).join('') + '</div>';
      },
      play: async function (st, s, id) {
        var ms = $$('.mn-m', st), bt = $$('.mn-kb span', st);
        await sleep(400, id);
        for (var k = 0; k < ms.length - 1; k++) {
          on(ms[k]); await sleep(650, id); on($('.mn-s', ms[k])); await sleep(750, id); on($('.mn-ok', ms[k])); await sleep(800, id);
        }
        await point(st, bt[2], id); bt[2].classList.add('sel'); await sleep(350, id); on(ms[ms.length - 1]); await sleep(1500, id);
      } }
  ]
  ];

  /* ovozli yozuv sahnasi (har bir auditoriyada 4-sahna): yozuv → matn → xulosa va topshiriqlar → Telegram'ga xabar */
  var VOICE_ACT = {
    html: function (s) {
      var L = s.L;
      return '<div class="app-h">' + esc(s.t) + '<small class="va-st"><i></i><span>' + esc(L.rec) + '</span><b>00:00</b></small></div>' +
        '<div class="va"><div class="va-l">' + waveBars(30, 'va-wave') +
          '<div class="va-lines">' + s.lines.map(function (l) { return '<div class="va-ln fx"><span class="va-av k' + l[0] + '">' + esc(s.spk[l[0]].charAt(0)) + '</span><div><b>' + esc(s.spk[l[0]]) + '</b><p></p></div></div>'; }).join('') + '</div>' +
          '<div class="va-ctl"><span class="va-stop"></span></div></div>' +
        '<div class="va-r"><div class="va-empty">' + esc(L.wait) + '</div><div class="va-proc fx"><i class="sk-spin"></i>' + esc(L.proc) + '</div>' +
          '<div class="va-sum fx"><h5>' + esc(L.sumH) + '</h5><p>' + esc(s.sum) + '</p></div>' +
          '<div class="va-tk fx"><h5>' + esc(L.tasksH) + '</h5>' + s.tasks.map(function (x) { return '<div class="va-t"><i></i><span>' + esc(x[0]) + '</span><em>' + esc(x[1]) + '</em></div>'; }).join('') + '</div></div></div>' +
        '<div class="va-note">' + SHARE_IC[0] + '<div><b>' + esc(L.app) + '<small>' + esc(L.now) + '</small></b><span>' + esc(s.tg) + '</span></div></div>';
    },
    play: async function (st, s, id) {
      var tm = $('.va-st b', st), lab = $('.va-st span', st), va = $('.va', st), lines = $$('.va-ln', st), sec = 0;
      function t1() { sec++; tm.textContent = mmss(sec); }
      va.classList.add('live');
      for (var k = 0; k < lines.length; k++) {
        on(lines[k]); var p = $('p', lines[k]), w = s.lines[k][1].split(' ');
        for (var j = 0; j < w.length; j++) { p.textContent += (j ? ' ' : '') + w[j]; if (j % 2) t1(); await sleep(110, id); }
        t1(); await sleep(350, id);
      }
      await point(st, $('.va-stop', st), id); va.classList.remove('live'); va.classList.add('done'); $('.va-st', st).classList.add('ok'); lab.textContent = s.L.proc;
      on($('.va-proc', st)); await sleep(1300, id); off($('.va-proc', st));
      lab.textContent = '✓'; on($('.va-sum', st)); await sleep(600, id); on($('.va-tk', st));
      var ts = $$('.va-t', st); for (var r = 0; r < ts.length; r++) { await sleep(380, id); ts[r].classList.add('ok'); }
      await sleep(800, id); on($('.va-note', st)); await sleep(2600, id);
    }
  };
  function audSvc(i) { return dict['aud.items'][i][3].concat(dict['aud.vci'] ? [dict['aud.vci'][i]] : []); }
  function audActs(i) { return ACTS[i].concat(dict['aud.vc'] ? [VOICE_ACT] : []); }
  function audSc(i) { var sc = dict['aud.sc'][i]; return dict['aud.vc'] ? sc.concat([Object.assign({ L: dict['aud.vcl'] }, dict['aud.vc'][i])]) : sc; }

  function fitDevice() {
    var m = $('#audbody .aud-mock'), dev = m && $('.dev', m); if (!dev) return;
    var size = DEV_SIZE[DEVICE[audIdx]];
    devScale = Math.min(1, (m.clientWidth - 24) / size[0]);
    if (window.innerWidth > 860 && window.innerHeight >= 600) {          // bo'lim ekran balandligiga sig'ishi uchun qurilma kichrayadi
      devScale = Math.max(0.45, Math.min(devScale, (m.clientHeight - 40) / size[1]));   // maket bo'limning qat'iy balandligiga sig'adi
    }
    dev.style.transform = 'scale(' + devScale + ')';
    var wrap = dev.parentNode; wrap.style.width = size[0] * devScale + 'px'; wrap.style.height = size[1] * devScale + 'px';
  }
  function setAct(k) {
    $$('#audbody .aud-svc li').forEach(function (li, i) { li.classList.toggle('cur', i === k); li.classList.toggle('seen', i < k); });
    var sv = audSvc(audIdx), cap = $('#audbody .actcap'); if (cap) cap.textContent = (k + 1) + ' / ' + sv.length + ' · ' + sv[k][0];
  }
  async function playScene(from) {
    var id = ++runId, body = $('#audbody'), scr = body && $('.scr', body);
    if (!scr || hasVideo) return;
    var acts = audActs(audIdx), sc = audSc(audIdx), st = $('.act', scr);
    try {
      do {
        for (var k = from || 0; k < acts.length; k++) {
          from = 0; scr.classList.remove('lexon');
          setAct(k); st.className = 'act a' + audIdx + k; st.innerHTML = acts[k].html(sc[k]);
          var cu = cursorEl(st); if (cu) cu.classList.remove('on');
          await sleep(60, id); st.classList.add('show');
          await sleep(450, id); await acts[k].play(st, sc[k], id); await sleep(1500, id);
          st.classList.remove('show'); await sleep(380, id);
        }
      } while (!still.matches);
    } catch (e) { if (e) console.error('SCENE', e.stack); /* boshqa tugma bosildi yoki bo'lim ekrandan chiqdi */ }
  }
  function renderAudience() {
    var tabs = $('#aud'), body = $('#audbody'); if (!tabs) return;
    var items = dict['aud.items'], it = items[audIdx], dv = DEVICE[audIdx];
    tabs.innerHTML = '';
    items.forEach(function (x, i) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === audIdx)); b.textContent = x[0];
      b.addEventListener('click', function () { audIdx = i; renderAudience(); });
      tabs.appendChild(b);
    });
    hasVideo = false;
    body.innerHTML = '<div class="aud-text"><h3>' + esc(it[1]) + '</h3><p>' + esc(it[2]) + '</p><ul class="aud-svc">' +
      audSvc(audIdx).map(function (sv) { return '<li role="button" tabindex="0"><b>' + esc(sv[0]) + '</b><span>' + esc(sv[1]) + '</span></li>'; }).join('') +
      '</ul></div><div class="aud-mock"><div class="devwrap"><div class="dev ' + dv + '">' +
      (dv === 'phone' ? '<i class="isl"></i>' : '') + '<div class="scr">' + statusBar(dv) + '<div class="act"></div><i class="mk-cursor ' + (dv === 'phone' ? 'finger' : '') + '"></i></div>' + (dv === 'mac' ? '<i class="base"></i>' : '') +
      '</div></div><div class="actcap"></div>' +
      '<video class="aud-video" data-video="A' + (audIdx + 1) + '" data-card="1" data-auto="1" muted loop playsinline preload="none"></video></div>';
    var v = $('video', body);
    v.addEventListener('loadeddata', function () { hasVideo = true; runId++; v.parentNode.classList.add('has-video'); });
    $$('.aud-svc li', body).forEach(function (li, k) {          // va'da bosilsa, sahna o'shandan boshlanib keyingilariga o'tadi
      function go() { if (!hasVideo) playScene(k); }
      li.addEventListener('click', go);
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    watchVideos(body); fitDevice(); setAct(0);
    if (flowVisible || still.matches) playScene(); else runId++;
  }
  window.addEventListener('resize', fitDevice);
  if ('IntersectionObserver' in window && $('#audbody')) {
    new IntersectionObserver(function (es) { flowVisible = es[0].isIntersecting; if (flowVisible) playScene(); else runId++; }, { threshold: 0.15 }).observe($('#audbody'));
  } else flowVisible = true;

  /* ---------- AI chat sahifasi: namunaviy savollar ---------- */
  function renderAsks() {
    var box = $('#cpasks'); if (!box) return;
    box.innerHTML = dict['chat.asks'].map(function (x) { return '<div class="cp-ask"><small>' + esc(x[0]) + '</small><p>' + esc(x[1]) + '</p></div>'; }).join('');
  }

  /* ---------- Hujjat tahlili sahifasi: hisobotning to'rt bo'limi ---------- */
  var daIdx = 0;
  function renderAnalysis() {
    var tabs = $('#databs'), list = $('#dalist'), counts = $('#dacounts'); if (!tabs) return;
    var cats = dict['da.cats'], lv = dict['da.lv'];
    if (counts) counts.innerHTML = cats.map(function (c) { return '<div><b>' + c[1].length + '</b><span>' + esc(c[0]) + '</span></div>'; }).join('');
    tabs.innerHTML = '';
    cats.forEach(function (c, i) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(i === daIdx));
      b.innerHTML = '<span>' + esc(c[0]) + '</span><em>' + c[1].length + '</em>';
      b.addEventListener('click', function () { daIdx = i; renderAnalysis(); });
      tabs.appendChild(b);
    });
    list.innerHTML = cats[daIdx][1].map(function (x) {
      return '<article class="da-item ' + x[0] + '"><header><h3>' + esc(x[1]) + '</h3><span class="da-lv">' + esc(lv[x[0]]) + '</span></header>' +
        (x[2] ? '<blockquote>' + esc(x[2]) + '</blockquote>' : '') + '<p>' + esc(x[3]) + '</p>' +
        (x[4] ? '<p class="da-fix"><b>' + esc(dict['da.fix']) + ':</b> ' + esc(x[4]) + '</p>' : '') + '</article>';
    }).join('');
  }

  /* ---------- ichki sahifalar: lug'atdagi ro'yxatlardan yig'iladigan bloklar ---------- */
  var tabIdx = {};

  /* ---------- ko'nikmalar: "/" bilan chaqiriladigan ish usullari ---------- */
  var SK_SC = ['<svg viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="2.6"/><path d="M3 14c.6-2.8 2.6-4.2 5-4.2s4.4 1.4 5 4.2"/></svg>',
    '<svg viewBox="0 0 16 16"><circle cx="5.6" cy="6" r="2.2"/><circle cx="11" cy="6" r="2.2"/><path d="M1.5 13.5c.5-2.3 2-3.5 4.1-3.5s3.6 1.2 4.1 3.5M9.6 10.2c.4-.1.9-.2 1.4-.2 2 0 3.4 1.2 3.9 3.5"/></svg>',
    '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="12" rx="1"/><path d="M6 5h1M9 5h1M6 8h1M9 8h1M7 14v-3h2v3"/></svg>'];
  var SK_IC = '<svg class="sk-ic" viewBox="0 0 20 20"><path d="M4 3.5h8.5L16 7v9.5H4z"/><path d="M12.5 3.5V7H16M7 10.5h6M7 13.5h4"/></svg>';
  var SK_DOC = '<svg viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/></svg>';
  function skScope(i) { return '<span class="sk-sc">' + SK_SC[i] + '<span>' + esc(dict['sk.scopes'][i]) + '</span></span>'; }
  function skCard(it) { return '<div class="sk-card"><div class="sk-ct">' + SK_IC + '<span>' + esc(it[0]) + '</span></div><b>' + esc(it[1]) + '</b>' + skScope(it[2]) + '</div>'; }
  function renderSkills() {
    if (!dict['sk.lib']) return;
    $$('.sk-wall').forEach(function (w) {
      var L = dict['sk.lib'], rows = +w.dataset.rows || 1, html = '';
      for (var r = 0; r < rows; r++) {
        var part = L.filter(function (_, k) { return k % rows === r; }), inner = part.map(skCard).join('');
        html += '<div class="sk-row' + (r % 2 ? ' rev' : '') + '" style="--n:' + part.length + '"><div class="sk-track">' + inner + inner + '</div></div>';
      }
      w.innerHTML = html;
    });
    $$('.sk-demo').forEach(function (b) {
      var M = dict['sk.menu'], F = dict['sk.fl'];
      b.innerHTML = '<div class="sk-win">' +
        '<div class="sk-th"><div class="sk-empty">' + esc(dict['sk.empty']) + '</div>' +
          '<div class="sk-u sk-h"><div class="sk-chips"><span class="sk-chip"><b>/</b>' + esc(M[0][0]) + '</span><span class="sk-chip">' + SK_DOC + esc(F[0]) + '</span></div><p>' + esc(dict['sk.msg']) + '</p></div>' +
          '<div class="sk-run sk-h"><div class="sk-rh"><i class="sk-spin"></i><b class="sk-rt"></b><span>' + esc(M[0][0]) + '</span></div><ol>' + dict['sk.steps'].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></div>' +
          '<div class="sk-res sk-h">' + dict['sk.res'].map(function (x, k) { return '<div class="sk-r"><span class="sk-lv l' + k + '"><i></i>' + esc(dict['sk.lv'][k]) + '</span><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('') + '</div>' +
        '</div>' +
        '<div class="sk-box">' +
          '<div class="sk-menu s"><div class="sk-mh">' + esc(dict['sk.skills']) + '</div>' + M.map(function (x) { return '<div class="sk-mi" data-t="' + esc(x[0]) + '"><b>/</b><span>' + esc(x[0]) + '</span>' + skScope(x[1]) + '</div>'; }).join('') + '</div>' +
          '<div class="sk-menu f"><div class="sk-mh">' + esc(dict['sk.files']) + '</div>' + F.map(function (x) { return '<div class="sk-mi" data-t="' + esc(x) + '">' + SK_DOC + '<span>' + esc(x) + '</span></div>'; }).join('') + '</div>' +
          '<div class="sk-field"><span class="sk-chip s"><b>/</b>' + esc(M[0][0]) + '</span><span class="sk-chip f">' + SK_DOC + esc(F[0]) + '</span><span class="sk-ty"></span><span class="sk-ph">' + esc(dict['sk.ph']) + '</span></div>' +
          '<div class="sk-tools"><span class="sk-tb"><b>@</b>' + esc(dict['sk.ctx']) + '</span><span class="sk-tb"><b>/</b>' + esc(dict['sk.skills']) + '</span><span class="sk-pro">Platinum</span><i class="sk-send">→</i></div>' +
        '</div></div>';
    });
    $$('.sk-ed').forEach(function (b) {
      b.innerHTML = '<div class="sk-ew"><div class="cp-bar"><i></i><i></i><i></i><span>' + esc(dict['sk.ed.head']) + '</span></div><div class="sk-eb">' +
        '<label>' + esc(dict['sk.ed.name']) + '</label><div class="sk-in"><span class="sk-nv"></span></div>' +
        '<label>' + esc(dict['sk.ed.ins']) + '</label><ol class="sk-ins">' + dict['sk.ed.lines'].map(function () { return '<li><span></span></li>'; }).join('') + '</ol>' +
        '<label>' + esc(dict['sk.ed.scope']) + '</label><div class="sk-seg">' + dict['sk.scopes'].map(function (x, i) { return '<span>' + SK_SC[i] + esc(x) + '</span>'; }).join('') + '<i></i></div>' +
        '<div class="sk-ef"><span class="sk-toast">✓ ' + esc(dict['sk.ed.done']) + '</span><span class="pill sk-save">' + esc(dict['sk.ed.save']) + '</span></div>' +
        '</div></div>';
    });
  }
  function renderBlocks() {
    $$('[data-cards]').forEach(function (box) {             // [sarlavha, matn] kartalari; data-num bo'lsa raqamlanadi
      box.innerHTML = (dict[box.dataset.cards] || []).map(function (x, i) { return '<div>' + (box.dataset.num ? '<b class="cp-n big">' + (i + 1) + '</b>' : '') + '<h3>' + esc(x[0]) + '</h3><p>' + esc(x[1]) + '</p></div>'; }).join('');
    });
    $$('[data-asks]').forEach(function (box) {
      box.innerHTML = (dict[box.dataset.asks] || []).map(function (x) { return '<div class="cp-ask"><small>' + esc(x[0]) + '</small><p>' + esc(x[1]) + '</p></div>'; }).join('');
    });
    $$('[data-rows]').forEach(function (box) {              // maket qatorlari: har ustun alohida <span>
      box.innerHTML = (dict[box.dataset.rows] || []).map(function (x) {
        return '<div class="' + box.dataset.cls + (x[3] ? ' ' + x[3] : '') + '">' + x.slice(0, 3).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + (box.dataset.cls === 'at-p' ? '<em>✓ ' + esc(dict['at.lic']) + '</em>' : '') + '</div>';
      }).join('');
    });
    $$('[data-ik]').forEach(function (el) { var k = el.dataset.ik.split(':'), v = (dict[k[0]] || [])[+k[1]]; if (k.length > 2 && v) v = v[+k[2]]; el.textContent = v || ''; });
    $$('[data-strip]').forEach(function (el) { el.innerHTML = (dict[el.dataset.strip] || []).map(function (x) { return '<div><strong>' + esc(x[0]) + '</strong>' + (el.dataset.short ? '' : '<span>' + esc(x[1]) + '</span>') + '</div>'; }).join(''); });
    renderSteps();
    $$('[data-li]').forEach(function (el) { el.innerHTML = (dict[el.dataset.li] || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join(''); });
    $$('[data-spans]').forEach(function (el) { el.innerHTML = (dict[el.dataset.spans] || []).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join(''); });
    $$('[data-gantt]').forEach(function (el) {            // vaqt jadvali: [nom, boshlanish %, uzunlik %, holat]
      el.innerHTML = (dict[el.dataset.gantt] || []).map(function (x, i) { return '<div class="gz-r"><label>' + esc(x[0]) + '</label><div class="gz-t"><i class="gz-b ' + x[3] + '" style="left:' + x[1] + '%;width:' + x[2] + '%;--i:' + i + '"></i></div></div>'; }).join('') + '<i class="gz-today"><em>' + esc(dict['ws.today']) + '</em></i>';
    });
    $$('[data-feed]').forEach(function (el) {
      el.innerHTML = (dict[el.dataset.feed] || []).map(function (x, i) { return '<div class="nfd-i ' + x[3] + '" style="--i:' + i + '"><b>' + esc(x[0]) + '</b><p>' + esc(x[1]) + '</p><small>' + esc(x[2]) + '</small></div>'; }).join('');
    });
    $$('[data-tabs]').forEach(function (box) {
      var key = box.dataset.tabs, panels = $$('.tp', box.parentNode), cur = tabIdx[key] || 0;
      box.innerHTML = '';
      (dict[key] || []).forEach(function (name, i) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.setAttribute('aria-pressed', String(i === cur));
        b.addEventListener('click', function () { tabIdx[key] = i; tabIdx.touched = true; renderBlocks(); });
        box.appendChild(b);
      });
      panels.forEach(function (pn, i) { pn.hidden = i !== cur; });
    });
  }

  /* ---------- qadamlar: chapda uch qadam, o'ngda shu qadamning jonli maketi ---------- */
  var stpIdx = {};
  function mrow(a, b, cls, i) { return '<div class="mm-row ' + (cls || '') + '" style="--i:' + (i || 0) + '"><span>' + esc(a) + '</span>' + (b ? '<span class="mm-tag">' + esc(b) + '</span>' : '') + '</div>'; }
  function mlines(n) { var o = ''; for (var k = 0; k < n; k++) o += '<i class="mm-ln' + (k % 3 === 2 ? ' s' : '') + '" style="--i:' + k + '"></i>'; return o; }
  var VIS = {
    da: [
      function () { return '<div class="mm"><div class="mm-drop">' + ic('up') + esc(dict['aud.up']) + '</div>' + mrow(dict['da.file'], '✓ ' + dict['aud.upd'], 'ok', 2) + '<div class="mm-bar"><i></i></div></div>'; },
      function () { return '<div class="mm mm-scan"><div class="mm-h">' + esc(dict['da.file']) + '</div>' + mlines(8) + '<i class="mm-beam"></i></div>'; },
      function () { return '<div class="mm"><div class="mm-h">' + esc(dict['da.scoreT']) + ' · 62 / 100</div>' + dict['da.cats'].map(function (c, i) { return mrow(c[0], String(c[1].length), ['b-red', 'b-amb', 'b-amb', 'b-grn'][i], i + 1); }).join('') + '</div>'; }
    ],
    dr: [
      function () { var k = dict['dr.kinds']; return '<div class="mm"><div class="mm-chips">' + k.map(function (x, i) { return '<span class="' + (i === 1 ? 'sel' : '') + '">' + esc(x[0]) + '</span>'; }).join('') + '</div>' + mrow(dict['dr.tpl'], '', 'sel', 1) + mrow(k[1][1], '', '', 2) + mrow(k[0][1], '', '', 3) + '</div>'; },
      function () { return '<div class="mm"><div class="mm-drop">' + ic('up') + esc(dict['aud.up']) + '</div>' + mrow(dict['stp.own'], '✓ ' + dict['aud.upd'], 'ok', 2) + '<div class="mm-h sm">' + esc(dict['stp.found']) + '</div><div class="mm-chips pop">' + dict['dr.fields'].map(function (f, i) { return '<span style="--i:' + (i + 4) + '">' + esc(f[0]) + '</span>'; }).join('') + '</div></div>'; },
      function () { return '<div class="mm"><div class="mm-q">' + esc(dict['stp.prompt']) + '</div><div class="mm-h" style="text-align:center;letter-spacing:.1em">' + esc(dict['dr.docT']) + '</div>' + mlines(5) + '<div class="mm-tag" style="--i:8">✓ ' + esc(dict['dr.ready']) + '</div></div>'; }
    ],
    ws: [
      function () { return '<div class="mm"><div class="mm-h sm">Workspace</div><div class="mm-in"><span class="mm-type">' + esc(dict['ws.name']) + '</span></div><span class="mm-btn" style="--i:6">' + esc(dict['ws.steps'][0][0]) + '</span></div>'; },
      function () { var t = dict['ws.tasks']; return '<div class="mm"><div class="mm-h sm">' + esc(dict['stp.link']) + '</div><div class="mm-in mono">juristai.uz/w/…</div>' + [t[0][1], t[1][1], t[2][1]].map(function (n, i) { return mrow(n, '✓ ' + dict['stp.joined'], 'who', i + 2); }).join('') + '</div>'; },
      function () { var t = dict['ws.tasks'][1]; return '<div class="mm"><div class="mm-h">' + esc(t[0]) + '</div>' + mrow(t[1], '', 'who', 1) + mrow('⏰ ' + t[2], '', '', 2) + '<span class="mm-btn" style="--i:5">' + esc(dict['ws.steps'][2][0]) + '</span></div>'; }
    ],
    at: [
      function () { return '<div class="mm"><div class="mm-in muted">' + esc(dict['at.search']) + '</div><div class="mm-chips pop"><span class="sel" style="--i:2">' + esc(dict['at.area']) + '</span><span class="sel" style="--i:4">' + esc(dict['at.region']) + '</span></div></div>'; },
      function () { return '<div class="mm">' + dict['at.people'].map(function (p, i) { return mrow(p[0], '✓ ' + dict['at.lic'], 'who', i + 1); }).join('') + '</div>'; },
      function () { var p = dict['at.people'][0]; return '<div class="mm">' + mrow(p[0], p[1], 'who sel', 1) + '<span class="mm-btn" style="--i:3">' + esc(dict['at.steps'][2][0]) + '</span><div class="mm-tag" style="--i:7">✓ ' + esc(dict['stp.sent']) + '</div></div>'; }
    ]
  };
  function stpItems(box) {
    var key = box.dataset.stp, pre = box.dataset.pre;
    return dict[key] || [1, 2, 3].map(function (n) { return [dict[pre + n + 'h'], dict[pre + n + 'p']]; });
  }
  function renderSteps() {
    $$('[data-stp]').forEach(function (box) {
      var key = box.dataset.stp, items = stpItems(box), cur = stpIdx[key] || 0, vis = VIS[box.dataset.vis];
      box.classList.toggle('auto', !stpIdx['_' + key]);
      box.innerHTML = '<div class="stp-l">' + items.map(function (x, i) {
        return '<button type="button" class="stp-i' + (i === cur ? ' cur' : '') + '"><b>' + (i + 1) + '</b><span><strong>' + esc(x[0]) + '</strong><em>' + esc(x[1]) + '</em></span><i class="stp-bar"></i></button>';
      }).join('') + '</div><div class="stp-v">' + vis[cur]() + '</div>';
      $$('.stp-i', box).forEach(function (b, i) { b.addEventListener('click', function () { stpIdx[key] = i; stpIdx['_' + key] = true; renderSteps(); }); });
    });
  }
  setInterval(function () {                              // ekranda ko'rinib turgan qadamlar o'zi almashadi; bosilsa to'xtaydi
    if (still.matches || document.hidden) return;
    var moved = false;
    $$('[data-stp]').forEach(function (box) {
      var key = box.dataset.stp, r = box.getBoundingClientRect();
      if (stpIdx['_' + key] || r.bottom < 120 || r.top > window.innerHeight - 120) return;
      stpIdx[key] = ((stpIdx[key] || 0) + 1) % stpItems(box).length; moved = true;
    });
    if (moved) renderSteps();
  }, 4400);

  /* ---------- ichki sahifa maketlari: jonli namoyishlar ---------- */
  var demoTok = null;
  function wait(ms, t) { return new Promise(function (ok, no) { setTimeout(function () { t.on ? ok() : no(); }, ms); }); }
  async function typeInto(el, text, t, sp) { el.textContent = ''; el.classList.add('caret'); for (var k = 0; k < text.length; k++) { el.textContent += text[k]; await wait(sp || 34, t); } el.classList.remove('caret'); }
  async function chatDemo(t) {                           // savol yoziladi, javob so'zma-so'z keladi, manba chiqadi
    var box = $('#chatdemo'); if (!box) return;
    var q = $('.cp-q', box), a = $('.cp-a', box), src = $('.cp-src', box), qs = $('span', q), as = $('span', a);
    var Q = dict['chat.demo.q'], A = dict['chat.demo.a'];
    if (still.matches) return;
    while (t.on) {
      [q, a, src].forEach(function (e) { e.classList.add('dm-h'); }); qs.textContent = ''; as.textContent = '';
      await wait(500, t); q.classList.remove('dm-h'); await typeInto(qs, Q, t, 38);
      await wait(500, t); a.classList.remove('dm-h'); a.classList.add('dm-wait'); await wait(1100, t); a.classList.remove('dm-wait');
      var w = A.split(' '); for (var k = 0; k < w.length; k++) { as.textContent += (k ? ' ' : '') + w[k]; await wait(70, t); }
      await wait(400, t); src.classList.remove('dm-h'); await wait(5200, t);
    }
  }
  async function draftDemo(t) {                          // maydonlar to'ldiriladi, hujjat tayyor bo'ladi
    var box = $('#drdemo'); if (!box || still.matches) return;
    var vals = $$('.dr-f span:nth-child(2)', box), doc = $('.dr-doc', box), F = dict['dr.fields'];
    while (t.on) {
      doc.classList.add('dm-off'); vals.forEach(function (v) { v.textContent = ''; v.classList.remove('dm-set'); });
      await wait(600, t);
      for (var k = 0; k < vals.length; k++) { vals[k].classList.add('dm-set'); await typeInto(vals[k], F[k][1], t, 55); await wait(260, t); }
      doc.classList.remove('dm-off'); await wait(5600, t);
    }
  }
  async function attorneyDemo(t) {                       // filtrlar tanlanadi, ro'yxat chiqadi, bitta advokat tanlanadi
    var box = $('#atdemo'); if (!box || still.matches) return;
    var f = $$('.at-filters span', box), rows = $$('.at-p', box);
    while (t.on) {
      f.forEach(function (x) { x.classList.remove('dm-set'); }); rows.forEach(function (r) { r.classList.add('dm-h'); r.classList.remove('dm-sel'); });
      await wait(600, t); f[1].classList.add('dm-set'); await wait(700, t); f[2].classList.add('dm-set'); await wait(600, t);
      for (var k = 0; k < rows.length; k++) { rows[k].classList.remove('dm-h'); await wait(260, t); }
      await wait(900, t); rows[0].classList.add('dm-sel'); await wait(4200, t);
    }
  }
  async function wsDemo(t) {                             // ko'rinishlar navbat bilan almashadi; foydalanuvchi bossa to'xtaydi
    var box = $('#wsdemo'); if (!box || still.matches) return;
    while (t.on && !tabIdx.touched) {
      await wait(3800, t); if (tabIdx.touched) break;
      tabIdx['ws.views'] = ((tabIdx['ws.views'] || 0) + 1) % 3; renderBlocks();
    }
  }

  async function skillDemo(t, box) {                    // "/" bilan ko'nikma, "@" bilan hujjat tanlanadi, ko'nikma bosqichma-bosqich ishlaydi
    var ty = $('.sk-ty', box), ph = $('.sk-ph', box), m1 = $('.sk-menu.s', box), m2 = $('.sk-menu.f', box),
      cs = $('.sk-field .sk-chip.s', box), cf = $('.sk-field .sk-chip.f', box), emp = $('.sk-empty', box),
      u = $('.sk-u', box), run = $('.sk-run', box), res = $('.sk-res', box), rt = $('.sk-rt', box),
      steps = $$('.sk-run li', box), rows = $$('.sk-r', box), send = $('.sk-send', box);
    function shown(v) { [u, run, res].forEach(function (e) { e.classList.toggle('sk-h', !v); }); emp.classList.toggle('sk-h', v); }
    function filt(m, q) {
      var first = null;
      $$('.sk-mi', m).forEach(function (mi) { var ok = mi.dataset.t.toLowerCase().indexOf(q.toLowerCase()) > -1; mi.classList.toggle('x', !ok); if (ok && !first) first = mi; });
      $$('.sk-mi', m).forEach(function (mi) { mi.classList.toggle('on', mi === first); mi.classList.remove('hit'); });
    }
    async function pick(m, chip, key, q) {
      ty.textContent = key; m.classList.add('open'); filt(m, ''); await wait(800, t);
      for (var k = 0; k < q.length; k++) { ty.textContent += q[k]; filt(m, q.slice(0, k + 1)); await wait(130, t); }
      await wait(650, t); $('.sk-mi.on', m).classList.add('hit'); await wait(280, t);
      m.classList.remove('open'); ty.textContent = ''; chip.classList.add('on'); await wait(550, t);
    }
    if (still.matches) { shown(true); run.classList.add('done'); rt.textContent = dict['sk.runok']; steps.forEach(function (l) { l.classList.add('ok'); }); return; }
    while (t.on) {
      shown(false); run.classList.remove('done'); rt.textContent = dict['sk.run']; steps.forEach(function (l) { l.classList.remove('ok', 'cur'); }); rows.forEach(function (r) { r.classList.add('sk-h'); });
      ty.textContent = ''; ph.classList.remove('sk-h'); cs.classList.remove('on'); cf.classList.remove('on'); send.classList.remove('hit');
      await wait(1100, t);
      ph.classList.add('sk-h'); ty.classList.add('caret');
      await pick(m1, cs, '/', dict['sk.q1']);
      await pick(m2, cf, '@', dict['sk.q2']);
      var msg = dict['sk.msg']; for (var k = 0; k < msg.length; k++) { ty.textContent += msg[k]; await wait(36, t); }
      await wait(500, t); ty.classList.remove('caret'); send.classList.add('hit'); await wait(260, t);
      ty.textContent = ''; cs.classList.remove('on'); cf.classList.remove('on'); ph.classList.remove('sk-h'); send.classList.remove('hit');
      emp.classList.add('sk-h'); u.classList.remove('sk-h'); await wait(600, t);
      run.classList.remove('sk-h');
      for (var j = 0; j < steps.length; j++) { steps[j].classList.add('cur'); await wait(750, t); steps[j].classList.remove('cur'); steps[j].classList.add('ok'); }
      await wait(350, t); run.classList.add('done'); rt.textContent = dict['sk.runok']; await wait(350, t);
      res.classList.remove('sk-h'); for (var r = 0; r < rows.length; r++) { rows[r].classList.remove('sk-h'); await wait(320, t); }
      await wait(6000, t);
    }
  }
  async function skillEdit(t, box) {                    // ko'nikma yoziladi, kimga ochiqligi tanlanadi, saqlanadi
    var nv = $('.sk-nv', box), li = $$('.sk-ins li span', box), seg = $('.sk-seg', box), save = $('.sk-save', box), toast = $('.sk-toast', box), L = dict['sk.ed.lines'];
    if (still.matches) { nv.textContent = dict['sk.ed.nameV']; li.forEach(function (x, k) { x.textContent = L[k]; }); seg.style.setProperty('--x', 1); toast.classList.add('on'); return; }
    while (t.on) {
      nv.textContent = ''; li.forEach(function (x) { x.textContent = ''; }); seg.style.setProperty('--x', 0); toast.classList.remove('on'); save.classList.remove('hit');
      await wait(900, t); await typeInto(nv, dict['sk.ed.nameV'], t, 50); await wait(400, t);
      for (var k = 0; k < li.length; k++) { await typeInto(li[k], L[k], t, 22); await wait(220, t); }
      await wait(600, t); seg.style.setProperty('--x', 1); await wait(1100, t);
      save.classList.add('hit'); await wait(250, t); save.classList.remove('hit'); toast.classList.add('on'); await wait(5200, t);
    }
  }
  function countUp() {
    $$('[data-count]').forEach(function (el) {
      var to = +el.dataset.count, n = 0; if (still.matches) return;
      el.textContent = '0';
      var iv = setInterval(function () { n = Math.min(to, n + Math.ceil(to / 30)); el.textContent = n; if (n >= to) clearInterval(iv); }, 35);
    });
  }
  /* ---------- ovozli yozuv va Telegram: reklama bo'limlari (ko'nikmalar kabi jonli maket) ---------- */
  var VD_MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
  var TG_PLANE = '<svg viewBox="0 0 24 24"><path d="M21 4 3 11l6 2.5L11 20l3.5-4.5L19 18z"/><path d="M9 13.5 21 4"/></svg>';
  var BELL = '<svg viewBox="0 0 16 16"><path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 14a1.6 1.6 0 0 0 3 0"/></svg>';
  function waveBars(n, cls) { var h = ''; for (var k = 0; k < n; k++) h += '<i style="--d:' + (0.55 + ((k * 37) % 23) / 30).toFixed(2) + 's;--h:' + (25 + ((k * 53) % 70)) + '%"></i>'; return '<div class="' + cls + '">' + h + '</div>'; }
  function mmss(n) { return (n < 600 ? '0' : '') + Math.floor(n / 60) + ':' + (n % 60 < 10 ? '0' : '') + n % 60; }
  function renderPromos() {
    $$('.vd-demo').forEach(function (b) {
      var spk = dict['vd.spk'];
      b.innerHTML = '<div class="vd-win">' +
        '<div class="vd-top"><span class="vd-ic">' + VD_MIC + '</span><div class="vd-ttl"><b>' + esc(dict['vd.name']) + '</b><small>' + esc(spk.join(' · ')) + '</small></div>' +
          '<span class="vd-st"><i></i><em></em><span class="vd-tm">00:00</span></span></div>' +
        '<div class="vd-tabs">' + dict['vd.tabs'].map(function (x, k) { return '<span class="' + (k ? '' : 'on') + '">' + esc(x) + '</span>'; }).join('') + '<i class="vd-ind"></i></div>' +
        '<div class="vd-body">' +
          '<div class="vd-pane vd-tr">' + dict['vd.lines'].map(function (l) { return '<div class="vd-ln sk-h"><span class="vd-av k' + l[0] + '">' + esc(spk[l[0]].charAt(0)) + '</span><div><div class="vd-who"><b>' + esc(spk[l[0]]) + '</b><small>' + l[1] + '</small></div><p></p></div></div>'; }).join('') + '</div>' +
          '<div class="vd-proc sk-h"><div class="sk-run"><div class="sk-rh"><i class="sk-spin"></i><b>' + esc(dict['vd.proc']) + '</b></div><ol>' + dict['vd.steps'].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></div></div>' +
          '<div class="vd-pane vd-sm sk-h">' +
            '<div class="vd-sec sk-h"><h5>' + esc(dict['vd.sumH']) + '</h5><p>' + esc(dict['vd.sum']) + '</p></div>' +
            '<div class="vd-sec sk-h"><h5>' + esc(dict['vd.tasksH']) + '</h5>' + dict['vd.tasks'].map(function (x) { return '<div class="vd-task"><i></i><span>' + esc(x[0]) + '</span><em>' + esc(x[1]) + ' · ' + esc(x[2]) + '</em></div>'; }).join('') + '</div>' +
            '<div class="vd-sec sk-h"><h5>' + esc(dict['vd.nextH']) + '</h5><p>' + esc(dict['vd.next']) + '</p></div>' +
            '<div class="vd-doc sk-h"><div><small>' + esc(dict['vd.docH']) + '</small><b>' + esc(dict['vd.doc']) + '</b></div><span class="vd-btn">' + esc(dict['vd.docB']) + ' →</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="vd-bar">' + waveBars(46, 'vd-wave') + '<span class="vd-min">' + esc(dict['vd.min']) + '</span><span class="vd-ctl"><i class="vd-pa"></i><i class="vd-stop"></i></span></div>' +
      '</div>';
    });
    $$('.tgd-demo').forEach(function (b) {
      b.innerHTML = '<div class="tgd-win">' +
        '<div class="tgd-app">' +
          '<div class="tgd-ah"><b>JURISTAI</b><small>' + esc(dict['tgd.acc']) + '</small></div>' +
          '<div class="tgd-me"><span class="tgd-av">' + esc(dict['tgd.user'].split(' ').map(function (w) { return w.charAt(0); }).join('').slice(0, 2)) + '</span><div><b>' + esc(dict['tgd.user']) + '</b><small>' + esc(dict['tgd.plan']) + '</small></div></div>' +
          '<div class="tgd-card"><div class="tgd-ch"><span class="tgd-ti">' + TG_PLANE + '</span><div><b>' + esc(dict['tgd.card']) + '</b><small class="tgd-st"><i></i><span></span></small></div></div><span class="tgd-btn"></span></div>' +
          '<div class="tgd-hist"><h5>' + esc(dict['tgd.hist']) + '</h5><div class="tgd-hl"><div class="tgd-hi tgd-new"><b>' + esc(dict['tgd.hnew']) + '</b><span class="tgd-via">' + TG_PLANE + esc(dict['tgd.via']) + '</span></div>' +
            dict['tgd.h'].map(function (x) { return '<div class="tgd-hi"><b>' + esc(x) + '</b></div>'; }).join('') + '</div></div>' +
          '<i class="tgd-cur"></i>' +
        '</div></div>' +
        '<div class="tgd-ph"><i class="tgd-isl"></i><div class="tgd-scr">' + statusBar('phone') +
          '<div class="tgd-th"><span class="tgd-bav">J</span><div><b>' + esc(dict['tgd.bot']) + '</b><small>' + esc(dict['tgd.botS']) + '</small></div></div>' +
          '<div class="tgd-chat"><div class="tgd-flow">' +
            '<div class="tgd-m out sk-h">/start<em>✓✓</em></div>' +
            '<div class="tgd-m in ok sk-h"><span class="tgd-okc">✓</span>' + esc(dict['tgd.linked']) + '</div>' +
            '<div class="tgd-m out voice sk-h"><i class="tgd-pl"></i>' + waveBars(22, 'tgd-vw') + '<em>0:14</em></div>' +
            '<div class="tgd-m in sk-h"><small class="tgd-q">' + esc(dict['tgd.vtx']) + '</small><span class="t"></span><a class="sk-h">↳ ' + esc(dict['tgd.src']) + '</a></div>' +
            '<div class="tgd-m out file sk-h"><span class="tgd-pdf">PDF</span><b>' + esc(dict['tgd.file']) + '</b><em>✓✓</em></div>' +
            '<div class="tgd-m in sk-h">' + esc(dict['tgd.fans']) + '</div>' +
          '</div></div>' +
          '<div class="tgd-start">' + esc(dict['tgd.start']) + '</div>' +
          '<div class="tgd-note"><span class="tgd-ni">' + BELL + '</span><div><b>' + esc(dict['tgd.bot']) + '</b><span>' + esc(dict['tgd.note']) + '</span><a>' + esc(dict['tgd.open']) + ' →</a></div></div>' +
        '</div></div>';
    });
  }
  async function voiceDemo(t, box) {                   // yozuv → transkript → tahlil → xulosa, topshiriqlar, hujjat tavsiyasi
    var win = $('.vd-win', box); if (!win) return;
    var tm = $('.vd-tm', box), stt = $('.vd-st em', box), st = $('.vd-st', box), tabs = $$('.vd-tabs span', box), ind = $('.vd-ind', box),
      lines = $$('.vd-ln', box), tr = $('.vd-tr', box), sm = $('.vd-sm', box), proc = $('.vd-proc', box), run = $('.sk-run', proc), steps = $$('li', proc), rt = $('.sk-rh b', proc),
      secs = $$('.vd-sec', box), tasks = $$('.vd-task', box), doc = $('.vd-doc', box), btn = $('.vd-btn', box), stop = $('.vd-stop', box), L = dict['vd.lines'];
    function tab(k) { tabs.forEach(function (x, i) { x.classList.toggle('on', i === k); }); ind.style.transform = 'translateX(' + tabs[k].offsetLeft + 'px)'; ind.style.width = tabs[k].offsetWidth + 'px'; }
    function state(c, txt) { st.className = 'vd-st ' + c; stt.textContent = txt; }
    function done() {
      tab(1); state('s-ok', '✓ ' + dict['vd.ready']); tm.textContent = '00:31'; win.classList.remove('live');
      tr.classList.add('sk-h'); proc.classList.add('sk-h'); sm.classList.remove('sk-h'); secs.concat([doc]).forEach(function (e) { e.classList.remove('sk-h'); }); tasks.forEach(function (x) { x.classList.add('ok'); });
    }
    if (still.matches) { lines.forEach(function (l, k) { $('p', l).textContent = L[k][2]; }); done(); return; }
    var sec = 0;
    async function tick(to) { while (sec < to) { sec++; tm.textContent = mmss(sec); await wait(110, t); } }
    while (t.on) {
      sec = 0; tm.textContent = '00:00'; tab(0); state('s-rec', dict['vd.rec']); win.classList.add('live');
      tr.classList.remove('sk-h', 'dim'); sm.classList.add('sk-h'); proc.classList.add('sk-h'); run.classList.remove('done'); rt.textContent = dict['vd.proc'];
      steps.forEach(function (l) { l.classList.remove('ok', 'cur'); }); lines.forEach(function (l) { l.classList.add('sk-h'); $('p', l).textContent = ''; });
      secs.forEach(function (e) { e.classList.add('sk-h'); }); doc.classList.add('sk-h'); tasks.forEach(function (x) { x.classList.remove('ok'); }); btn.classList.remove('hit', 'ok'); btn.textContent = dict['vd.docB'] + ' →'; stop.classList.remove('hit');
      await wait(700, t);
      for (var k = 0; k < lines.length; k++) {
        await tick(parseInt(L[k][1].slice(3), 10));
        lines[k].classList.remove('sk-h'); var p = $('p', lines[k]), w = L[k][2].split(' ');
        for (var j = 0; j < w.length; j++) { p.textContent += (j ? ' ' : '') + w[j]; if (j % 3 === 2) { sec++; tm.textContent = mmss(sec); } await wait(95, t); }
      }
      await tick(31); await wait(500, t);
      stop.classList.add('hit'); await wait(250, t); win.classList.remove('live'); state('s-proc', dict['vd.proc']);
      tr.classList.add('dim'); proc.classList.remove('sk-h'); await wait(350, t);
      for (var s = 0; s < steps.length; s++) { steps[s].classList.add('cur'); await wait(650, t); steps[s].classList.remove('cur'); steps[s].classList.add('ok'); }
      run.classList.add('done'); rt.textContent = dict['vd.ready']; await wait(450, t);
      proc.classList.add('sk-h'); tr.classList.add('sk-h'); tab(1); sm.classList.remove('sk-h'); state('s-ok', '✓ ' + dict['vd.ready']);
      for (var q = 0; q < secs.length; q++) {
        secs[q].classList.remove('sk-h'); await wait(380, t);
        if (q === 1) for (var r = 0; r < tasks.length; r++) { tasks[r].classList.add('ok'); await wait(360, t); }
      }
      doc.classList.remove('sk-h'); await wait(900, t);
      btn.classList.add('hit'); await wait(220, t); btn.classList.remove('hit'); btn.classList.add('ok'); btn.textContent = '✓ ' + dict['vd.docOk'];
      await wait(5200, t);
    }
  }
  async function tgDemo(t, box) {                      // platformada «ulash» → botda Start → hisob ulandi → savol, hujjat, bildirishnoma
    var app = $('.tgd-app', box); if (!app) return;
    var cur = $('.tgd-cur', box), btn = $('.tgd-btn', box), card = $('.tgd-card', box), stS = $('.tgd-st span', box), newH = $('.tgd-new', box),
      start = $('.tgd-start', box), ms = $$('.tgd-m', box), ans = $('.t', ms[3]), src = $('a', ms[3]), note = $('.tgd-note', box), flow = $('.tgd-flow', box), chat = $('.tgd-chat', box);
    function linked(v) { card.classList.toggle('on', v); stS.textContent = v ? dict['tgd.on'] : dict['tgd.off']; btn.className = 'tgd-btn' + (v ? ' ghost' : ''); btn.innerHTML = esc(v ? dict['tgd.open'] : dict['tgd.btn']) + ' →'; }
    function scroll() { var over = flow.scrollHeight - chat.clientHeight; flow.style.transform = 'translateY(' + (over > 0 ? -over : 0) + 'px)'; }
    function show(m) { m.classList.remove('sk-h'); scroll(); }
    async function click(el) {
      var a = app.getBoundingClientRect(), b = el.getBoundingClientRect();
      cur.classList.add('on'); cur.style.transform = 'translate(' + (b.left - a.left + Math.min(b.width / 2, 90)) + 'px,' + (b.top - a.top + b.height / 2) + 'px)';
      await wait(850, t); cur.classList.add('tap'); el.classList.add('hit'); await wait(220, t); cur.classList.remove('tap'); el.classList.remove('hit');
    }
    if (still.matches) { linked(true); ms.forEach(function (m) { m.classList.remove('sk-h'); }); ans.textContent = dict['tgd.ans']; src.classList.remove('sk-h'); start.classList.add('gone'); newH.classList.add('on'); scroll(); return; }
    while (t.on) {
      linked(false); ms.forEach(function (m) { m.classList.add('sk-h'); }); ans.textContent = ''; src.classList.add('sk-h'); flow.style.transform = '';
      start.classList.remove('gone', 'hit'); newH.classList.remove('on'); note.classList.remove('on'); cur.classList.remove('on'); cur.style.transform = '';
      await wait(900, t);
      await click(btn); btn.classList.add('wait'); btn.innerHTML = '<i class="sk-spin"></i>' + esc(dict['tgd.wait']); cur.classList.remove('on');
      await wait(700, t); start.classList.add('hit'); await wait(260, t); start.classList.remove('hit'); start.classList.add('gone');
      show(ms[0]); await wait(650, t); show(ms[1]); await wait(500, t); linked(true); await wait(1300, t);
      show(ms[2]); await wait(900, t); show(ms[3]);
      var w = dict['tgd.ans'].split(' ');
      for (var k = 0; k < w.length; k++) { ans.textContent += (k ? ' ' : '') + w[k]; if (k % 4 === 0) scroll(); await wait(70, t); }
      src.classList.remove('sk-h'); scroll(); await wait(500, t); newH.classList.add('on'); await wait(1300, t);
      show(ms[4]); await wait(800, t); show(ms[5]); await wait(1500, t);
      note.classList.add('on'); await wait(5200, t);
    }
  }
  function startDemos() {
    if (demoTok) demoTok.on = false;
    var t = demoTok = { on: true };
    [chatDemo, draftDemo, attorneyDemo, wsDemo].forEach(function (fn) { fn(t).catch(function () {}); });
    $$('.sk-demo').forEach(function (b) { skillDemo(t, b).catch(function () {}); });
    $$('.sk-ed').forEach(function (b) { skillEdit(t, b).catch(function () {}); });
    $$('.vd-demo').forEach(function (b) { voiceDemo(t, b).catch(function () {}); });
    $$('.tgd-demo').forEach(function (b) { tgDemo(t, b).catch(function () {}); });
  }
  /* bo'lim ekranga kirganda .go qo'shiladi: infografikalar shunda jonlanadi */
  if ('IntersectionObserver' in window) {
    var avio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting && !e.target.classList.contains('go')) { e.target.classList.add('go'); if ($('[data-count]', e.target)) countUp(); } });
    }, { threshold: 0.3 });
    $$('.av').forEach(function (el) { avio.observe(el); });
  } else $$('.av').forEach(function (el) { el.classList.add('go'); });

  /* ---------- tariflar ---------- */
  function renderTiers() {                               // qatorlar (belgi, nom, narx, muddat, tavsif, ro'yxat, tugma) barcha tariflarda bir chiziqda
    var box = $('#tiers'); if (!box) return;
    box.innerHTML = '';
    dict['price.tiers'].forEach(function (t, i) {
      var free = i === 0, d = document.createElement('article'); d.className = 'tier' + (free ? ' free' : '');
      d.innerHTML = '<span class="soon"></span><h3></h3><div class="price"><span></span><small></small></div><div class="per"></div><p></p><ul></ul>';
      $('.soon', d).textContent = free ? dict['price.start'] : dict['price.soon'];
      $('h3', d).textContent = t[0];
      $('.price span', d).textContent = t[1];
      $('.price small', d).textContent = free ? '' : dict['price.cur'];
      $('.per', d).textContent = t[2];
      $('p', d).textContent = t[3];
      t[4].forEach(function (li) { var el = document.createElement('li'); el.textContent = li; $('ul', d).appendChild(el); });
      var a = document.createElement('a');
      a.className = free ? 'pill' : 'pill ghost';
      a.href = free ? LINKS.signup : LINKS.telegram;
      if (free) { a.innerHTML = '<span></span><i>→</i>'; $('span', a).textContent = dict['price.trial']; }
      else a.textContent = dict['price.notify'];
      d.appendChild(a); box.appendChild(d);
    });
  }

  /* ---------- telefon menyusi ---------- */
  var burger = $('#burger'), panel = $('#mnav');
  function menu(open) { if (!panel) return; panel.hidden = !open; burger.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open); }
  if (burger) {
    burger.addEventListener('click', function () { menu(panel.hidden); });
    panel.addEventListener('click', function (e) { if (e.target.closest('a')) menu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') menu(false); });
  }

  /* ---------- bo'limlar ekranga kirganda yumshoq paydo bo'ladi ---------- */
  function reveal() {
    var els = $$('.trust, .sec > *, .band-in > *, .cta > *');
    if (still.matches || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight) return;   // birinchi ekrandagilar joyida turadi
      el.classList.add('rv'); io.observe(el);
    });
  }

  /* ---------- ishga tushirish ---------- */
  setLang(pickLang());
  (function () {                                       // til almashganda o'sha joyga qaytadi
    var y = null; try { y = sessionStorage.getItem('restoreY'); sessionStorage.removeItem('restoreY'); } catch (e) {}
    if (y !== null) { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, +y); setTimeout(function () { document.documentElement.style.scrollBehavior = ''; }, 50); }
  })();
  (function () {                                       // footer: animatsiyani to'xtatish / yoqish
    var m = $('#motion'); if (!m) return;
    function lbl() { m.textContent = dict[userStill ? 'motion.on' : 'motion.off'] || ''; }
    lbl(); m.addEventListener('click', function () { userStill = !userStill; try { localStorage.setItem('still', userStill ? '1' : '0'); } catch (e) {} location.reload(); });
  })();
  watchVideos();
  reveal();
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () { navState(); pinScroll(); ticking = false; });
  }, { passive: true });
  window.addEventListener('resize', function () { navState(); fitStack(); pinScroll(); });
  navState(); pinScroll();

  /* ---------- fon bezagi: Master Admin dashboard'da tanlanadi (GET /api/landing-config).
     ?bg=0|1|2|3|5 faqat shu ochilgan sahifa uchun ko'rinish (master saqlashdan oldin solishtiradi). ---------- */
  (function () {
    var ok = { '0': 1, '1': 1, '2': 1, '3': 1, '5': 1 };
    function apply(v) { if (ok[v]) document.documentElement.dataset.bg = v; }
    var preview = null;
    try { preview = new URLSearchParams(location.search).get('bg'); } catch (e) {}
    if (preview && ok[preview]) { apply(preview); return; }
    apply('1');
    if (!window.fetch) return;
    fetch('/api/landing-config', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.bg != null) apply(String(d.bg)); })
      .catch(function () {});
  })();

  /* ---------- skroll to'xtaganda yaqin turgan bo'lim chegarasi ekran tepasiga tortiladi ---------- */
  var snapT;
  function snapNear() {
    if (window.innerWidth <= 860 || window.innerHeight < 600 || still.matches) return;
    var navH = nav.offsetHeight, lim = window.innerHeight * 0.2, els = $$('.hero, .pin, .sec, .band, .cta');
    for (var k = 0; k < els.length; k++) {
      if (els[k].offsetHeight > window.innerHeight + 4 && !els[k].classList.contains('pin')) continue;   // ekrandan baland bo'lim erkin skroll qilinadi
      if (els[k].classList.contains('first')) continue;
      var d = els[k].getBoundingClientRect().top - (k ? navH : 0);
      if (Math.abs(d) > 1 && Math.abs(d) <= lim) { window.scrollBy({ top: d, behavior: 'smooth' }); return; }
    }
  }
  window.addEventListener('scroll', function () { clearTimeout(snapT); snapT = setTimeout(snapNear, 170); }, { passive: true });
})();
