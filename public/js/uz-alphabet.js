/* O'zbek lotin alifbosi: eski (oʻ, gʻ, sh, ch) va yangi (ö, ğ, ş, ç) yozuv o'rtasida o'tkazish.
   OʻRQ-1184 (21.10.2026, «Lotin yozuviga asoslangan oʻzbek alifbosini joriy etish toʻgʻrisida»gi Qonunga
   o'zgartirish): Oʻ → Ö, Gʻ → Ğ, Sh → Ş, Ch → Ç.

   JuristAI ichida matn eski yozuvda qoladi, chunki lex.uz manbalari shunday va iqtiboslar so'zma-so'z
   tekshiriladi. Yangi yozuvda yozilgan savol kirishda eski yozuvga o'giriladi (toOld); ko'rsatishda
   matn odam tanlagan yozuvga o'tadi (toNew). Taqqoslash uchun fold() ikkalasini bir xil qiladi.

   Tegilmaydi: havolalar (http..., www..., email), `kod`, ichki katta harfli so'zlar (MChJ, JuristAI,
   PowerPoint), rasmiy akt kodlari (OʻRQ-1184), kirill matn (unda o'zgaradigan harf yo'q), ajratuvchi
   apostrofli s'h / c'h (Is'hoq), ko'rinmas U+200C bilan ajratilgan namuna ("Eski: oʻ").
   Brauzerda (document bor bo'lsa) sahifani ham o'giradi: JAIAlphabet.start(). */
(function (root) {
  'use strict';
  var A = {};
  var AP = "ʻ‘'`ʼ’"; // o' / g' da uchraydigan belgilar
  var PROTECT = /https?:\/\/[^\s)\]>"']+|www\.[^\s)\]>"']+|[\w.+-]+@[\w-]+\.[\w.-]+|`[^`\n]*`/g;
  var MIXED = /^[A-ZÀ-Þ]?[a-zß-ÿ]+[A-ZÀ-Þ]|[a-z][A-Z]|^[A-Z]{1,3}Ch[A-Z]?$/; // MChJ, JuristAI, PowerPoint
  var EXCEPT = { MChJ: 1, XChJ: 1, OAJ: 1 };

  // official act and standard codes keep their registered form (OʻRQ-1184, OʻzDSt)
  var CODE = new RegExp('^O[' + "ʻ‘'`ʼ’" + '](?:RQ|zR|zDSt)$');
  function word(w) {
    if (EXCEPT[w] || MIXED.test(w) || CODE.test(w)) return w;
    return w
      .replace(new RegExp('([OoGg])[' + AP + '](?=\\p{L})', 'gu'), function (m, c) { return { O: 'Ö', o: 'ö', G: 'Ğ', g: 'ğ' }[c]; })
      .replace(new RegExp('(^|[^' + AP + '])([SsCc])([Hh])', 'gu'), function (m, pre, a, h) {
        var up = a === a.toUpperCase();
        return pre + (a.toLowerCase() === 's' ? (up ? 'Ş' : 'ş') : (up ? 'Ç' : 'ç'));
      });
  }
  function plain(t) { return t.replace(/[\p{L}ʻ‘'`ʼ’]+/gu, word); }

  /** eski yozuv → yangi yozuv (havolalar va kod tegilmaydi) */
  A.toNew = function (text) {
    var s = String(text == null ? '' : text);
    if (!/[OoGg][ʻ‘'`ʼ’]|[SsCc][Hh]/.test(s)) return s;
    var out = '', last = 0, m;
    PROTECT.lastIndex = 0;
    while ((m = PROTECT.exec(s))) { out += plain(s.slice(last, m.index)) + m[0]; last = m.index + m[0].length; }
    return out + plain(s.slice(last));
  };

  /** yangi yozuv → eski yozuv (qidiruv va iqtibos tekshiruvi eski yozuvda) */
  A.toOld = function (text) {
    var s = String(text == null ? '' : text);
    if (!/[ÖöĞğŞşÇç]/.test(s)) return s;
    return s.replace(/Ö/g, 'Oʻ').replace(/ö/g, 'oʻ').replace(/Ğ/g, 'Gʻ').replace(/ğ/g, 'gʻ')
      .replace(/Ş(?=\p{Lu})/gu, 'SH').replace(/Ş/g, 'Sh').replace(/ş/g, 'sh')
      .replace(/Ç(?=\p{Lu})/gu, 'CH').replace(/Ç/g, 'Ch').replace(/ç/g, 'ch');
  };

  /** taqqoslash uchun: ikkala yozuv bir xil (kichik harf, apostrofsiz) */
  A.fold = function (text) {
    return String(text == null ? '' : text).toLocaleLowerCase('uz').replace(/[ʻ‘'`ʼ’]/g, '')
      .replace(/ö/g, 'o').replace(/ğ/g, 'g').replace(/ş/g, 'sh').replace(/ç/g, 'ch');
  };

  /* ---------- brauzer: sahifadagi matnni tanlangan yozuvda ko'rsatish ---------- */
  var KEY = 'jai-alphabet';
  A.choice = function () { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  /** 'new' (standart) | 'old' */
  A.mode = function () { return A.choice() === 'old' ? 'old' : 'new'; };
  A.set = function (v, opts) {
    try { localStorage.setItem(KEY, v === 'old' ? 'old' : 'new'); } catch (e) { /* xotira yo'q bo'lsa ham ishlaydi */ }
    if (!(opts && opts.noReload) && typeof location !== 'undefined') location.reload();
  };
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  function skip(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP[n.nodeName] || n.isContentEditable || (n.hasAttribute && n.hasAttribute('data-noalpha'))) return true;
    }
    return false;
  }
  function convertNode(node) {
    if (node.nodeType === 3) {
      if (node.parentNode && !skip(node.parentNode)) { var v = A.toNew(node.nodeValue); if (v !== node.nodeValue) node.nodeValue = v; }
      return;
    }
    if (node.nodeType !== 1 || skip(node)) return;
    ['placeholder', 'title', 'aria-label'].forEach(function (a) {
      var x = node.getAttribute(a); if (x) { var y = A.toNew(x); if (y !== x) node.setAttribute(a, y); }
    });
    var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    var t; while ((t = w.nextNode())) { if (t.parentNode && !skip(t.parentNode)) { var nv = A.toNew(t.nodeValue); if (nv !== t.nodeValue) t.nodeValue = nv; } }
    if (node.querySelectorAll) Array.prototype.forEach.call(node.querySelectorAll('[placeholder],[title],[aria-label]'), function (el) {
      if (skip(el)) return;
      ['placeholder', 'title', 'aria-label'].forEach(function (a) { var x = el.getAttribute(a); if (x) { var y = A.toNew(x); if (y !== x) el.setAttribute(a, y); } });
    });
  }
  /** sahifani kuzatadi: yangi chiqqan matn ham yangi yozuvda (o'tkazish takrorlansa ham o'zgarmaydi) */
  A.start = function () {
    if (typeof document === 'undefined' || A.mode() !== 'new' || A._observer) return;
    var run = function () {
      convertNode(document.body);
      if (document.title) document.title = A.toNew(document.title);
      A._observer = new MutationObserver(function (list) {
        list.forEach(function (m) {
          if (m.type === 'characterData') convertNode(m.target);
          else Array.prototype.forEach.call(m.addedNodes, convertNode);
        });
      });
      A._observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    if (document.body) run(); else document.addEventListener('DOMContentLoaded', run);
  };
  /** nusxa olinganda ham ko'rgan yozuvingiz */
  A.forCopy = function (text) { return A.mode() === 'new' ? A.toNew(text) : String(text == null ? '' : text); };

  /* nusxa tugmalari (clipboard.writeText) ham ko'ringan yozuvni oladi */
  function wrapClipboard() {
    try {
      var c = navigator.clipboard;
      if (!c || !c.writeText || c.__jaiAlpha) return;
      var orig = c.writeText.bind(c);
      c.writeText = function (t) { return orig(A.forCopy(t)); };
      c.__jaiAlpha = true;
    } catch (e) { /* eski brauzer */ }
  }

  /* birinchi marta: "matnlar yangi alifboda; eskisini xohlaysizmi?" (javobsiz qolsa yangi qoladi) */
  A.offer = function () {
    if (typeof document === 'undefined' || A.choice() || document.getElementById('jai-alpha-offer')) return;
    var ru = /^ru/.test(document.documentElement.lang || '');
    var bar = document.createElement('div');
    bar.id = 'jai-alpha-offer';
    bar.setAttribute('role', 'status');
    bar.setAttribute('data-noalpha', '');
    var narrow = (typeof innerWidth === 'number' ? innerWidth : 1024) < 520;
    bar.style.cssText = 'position:fixed;left:50%;bottom:' + (narrow ? '8px' : '16px') + ';transform:translateX(-50%);z-index:9999;width:max-content;max-width:min(560px,calc(100vw - 16px));box-sizing:border-box;' +
      'background:#E9EEFD;color:#111214;border-radius:12px;padding:' + (narrow ? '8px 10px' : '12px 14px') + ';font-family:inherit;font-size:' + (narrow ? '12.5px' : '14px') + ';line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.12);display:flex;gap:8px;align-items:center;flex-wrap:' + (narrow ? 'nowrap' : 'wrap');
    var msg = document.createElement('span');
    msg.style.cssText = narrow ? 'flex:1 1 auto;min-width:0' : 'flex:1 1 220px';
    msg.textContent = narrow ? (ru ? 'Новый алфавит: Ö Ğ Ş Ç' : 'Yangi alifbo: Ö Ğ Ş Ç') : (ru ? 'Узбекский текст теперь в новом алфавите: Ö, Ğ, Ş, Ç (ЗРУ-1184).' : 'Matnlar endi yangi alifboda: Ö, Ğ, Ş, Ç (OʻRQ-1184).');
    var old = document.createElement('button');
    old.type = 'button';
    old.textContent = narrow ? (ru ? 'Старый' : 'Eski alifbo') : (ru ? 'Старый (oʻ, gʻ, sh, ch)' : 'Eski alifbo (oʻ, gʻ, sh, ch)');
    old.style.cssText = 'border:1px solid #3D6BF2;background:#fff;color:#3D6BF2;border-radius:99px;padding:' + (narrow ? '5px 10px' : '6px 12px') + ';font:inherit;font-size:' + (narrow ? '12.5px' : '13px') + ';cursor:pointer;white-space:nowrap;flex:none';
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', ru ? 'Закрыть' : 'Yopish');
    x.textContent = '×';
    x.style.cssText = 'border:0;background:none;font-size:20px;line-height:1;color:#66676B;cursor:pointer;padding:0 4px';
    old.onclick = function () { A.save('old'); };
    x.onclick = function () { A.save('new', { noReload: true }); bar.remove(); };
    bar.appendChild(msg); bar.appendChild(old); bar.appendChild(x);
    document.body.appendChild(bar);
  };
  /** the choice: this browser, and the account when signed in (src/adaptive: manual.alphabet) */
  A.save = function (v, opts) {
    var done = function () { A.set(v, opts); };
    if (A.onSave) { Promise.resolve(A.onSave(v)).then(done, done); } else done();
  };

  root.JAIAlphabet = A;
  if (typeof module !== 'undefined' && module.exports) module.exports = A;
  if (typeof document !== 'undefined') {
    A.start();
    wrapClipboard();
    var later = function () { setTimeout(A.offer, 1200); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later); else later();
  }
})(typeof window !== 'undefined' ? window : globalThis);
