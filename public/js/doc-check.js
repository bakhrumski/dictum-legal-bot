/* Hujjat tekshiruvi, A qism (muharrir D5, docs/design/hujjat-muharriri.md §6; egasi 2026-10-30: "Platforma ichida
   texnik / imlo tuzatuvchi qurishimiz kerak"). AI'siz, bepul, darhol: matn bloklar (xatboshilar) ro'yxati sifatida
   kiradi, topilgan har bir joy { kind, block, from, to, found, edits } bo'lib chiqadi. edits — bir bosishda
   tuzatish uchun aniq almashtirishlar (blok, boshlanish, oxir, yangi matn); tuzatib bo'lmaydiganida bo'sh.
   Hech narsa taxmin qilinmaydi: aniqlab bo'lmasa — faqat belgilanadi.

   Turlar: mixed_script (so'z ichida lotin va kirill), alphabet_mix (eski va yangi lotin alifbosi aralash),
   double_space, space_punct (tinish belgisidan oldin bo'sh joy), unpaired (qo'shtirnoq / qavs juftsiz),
   numbering (1, 2, 4), repeat_word, date_format (sana bir xil yozilmagan), amount_words (summa raqamda va
   so'zda farq qiladi), term_case (ta'riflangan atama boshqacha yozilgan).
   Brauzerda window.JAIDocCheck, Node'da require('public/js/doc-check.js'). */
(function (root) {
  'use strict';
  var D = {};
  var AP = 'ʻ‘\'`ʼ’';
  var WORD = new RegExp('[\\p{L}\\p{M}' + AP + ']+', 'gu');
  var LAT = /[A-Za-z]/, CYR = /[Ѐ-ӿ]/;
  var Alpha = root.JAIAlphabet || (typeof require === 'function' ? (function () { try { return require('./uz-alphabet.js'); } catch (e) { return null; } })() : null);

  // letters that look the same in both scripts (only these can be swapped without guessing)
  var C2L = { 'А': 'A', 'а': 'a', 'В': 'B', 'Е': 'E', 'е': 'e', 'К': 'K', 'к': 'k', 'М': 'M', 'Н': 'H', 'О': 'O', 'о': 'o', 'Р': 'P', 'р': 'p',
    'С': 'C', 'с': 'c', 'Т': 'T', 'Х': 'X', 'х': 'x', 'у': 'y', 'У': 'Y', 'і': 'i', 'І': 'I', 'ј': 'j' };
  var L2C = {}; Object.keys(C2L).forEach(function (k) { if (!L2C[C2L[k]]) L2C[C2L[k]] = k; });

  function words(text) { var out = [], m; WORD.lastIndex = 0; while ((m = WORD.exec(text))) out.push({ w: m[0], at: m.index }); return out; }
  function issue(kind, block, from, to, text, edits, params) {
    return { kind: kind, block: block, from: from, to: to, found: text.slice(from, to), edits: edits || [], params: params || {} };
  }
  var edit = function (block, from, to, text) { return { block: block, from: from, to: to, text: text }; };

  /* ---------- 1. so'z ichida lotin va kirill ---------- */
  function mixedScript(blocks, out) {
    blocks.forEach(function (text, b) {
      words(text).forEach(function (t) {
        if (!(LAT.test(t.w) && CYR.test(t.w))) return;
        var nl = (t.w.match(/[A-Za-z]/g) || []).length, nc = (t.w.match(/[Ѐ-ӿ]/g) || []).length;
        var toLat = nl >= nc, map = toLat ? C2L : L2C, fixable = true;
        var fixed = t.w.replace(toLat ? /[Ѐ-ӿ]/g : /[A-Za-z]/g, function (c) { if (map[c]) return map[c]; fixable = false; return c; });
        out.push(issue('mixed_script', b, t.at, t.at + t.w.length, text, fixable ? [edit(b, t.at, t.at + t.w.length, fixed)] : [], { to: toLat ? 'lat' : 'cyr' }));
      });
    });
  }

  /* ---------- 2. eski va yangi lotin alifbosi aralash ---------- */
  var OLD_W = new RegExp('[OoGg][' + AP + '](?=\\p{L})', 'u'), NEW_W = /[ÖöĞğŞşÇç]/;
  function alphabetMix(blocks, out) {
    var olds = [], news = [];
    blocks.forEach(function (text, b) {
      words(text).forEach(function (t) {
        if (CYR.test(t.w)) return;
        if (NEW_W.test(t.w)) news.push({ b: b, t: t }); else if (OLD_W.test(t.w)) olds.push({ b: b, t: t });
      });
    });
    if (!olds.length || !news.length || !Alpha) return;
    var toOld = olds.length >= news.length, minority = toOld ? news : olds;
    minority.forEach(function (x) {
      var fixed = toOld ? Alpha.toOld(x.t.w) : Alpha.toNew(x.t.w);
      out.push(issue('alphabet_mix', x.b, x.t.at, x.t.at + x.t.w.length, blocks[x.b], fixed !== x.t.w ? [edit(x.b, x.t.at, x.t.at + x.t.w.length, fixed)] : [], { to: toOld ? 'old' : 'new' }));
    });
  }

  /* ---------- 3-4. bo'sh joylar ---------- */
  function spaces(blocks, out) {
    blocks.forEach(function (text, b) {
      var m, re = /(\S)( {2,}|  +| + )(?=\S)/g;
      while ((m = re.exec(text))) {
        var from = m.index + m[1].length;
        out.push(issue('double_space', b, from, from + m[2].length, text, [edit(b, from, from + m[2].length, ' ')]));
      }
      var p = /([\p{L}\p{N}»”)])( +)([,.;:!?])(?![.\d])/gu;
      while ((m = p.exec(text))) {
        var f = m.index + m[1].length;
        out.push(issue('space_punct', b, f, f + m[2].length + 1, text, [edit(b, f, f + m[2].length, '')], { p: m[3] }));
      }
    });
  }

  /* ---------- 5. juftsiz qo'shtirnoq va qavs ---------- */
  var PAIRS = { '«': '»', '(': ')', '“': '”', '[': ']' }, CLOSE = { '»': '«', ')': '(', '”': '“', ']': '[' };
  function unpaired(blocks, out) {
    blocks.forEach(function (text, b) {
      var stack = [];
      for (var i = 0; i < text.length; i++) {
        var c = text[i];
        if (PAIRS[c]) { stack.push({ c: c, at: i }); continue; }
        if (!CLOSE[c]) continue;
        // an enumerator: "1)", "a)", "2.1)" at the start or after a space / ; / :
        if (c === ')' && /(^|[\s;:,(])[\p{L}\d.]{1,4}$/u.test(text.slice(Math.max(0, i - 6), i)) && !stack.some(function (s) { return s.c === '('; })) continue;
        var open = CLOSE[c], k = stack.length - 1;
        while (k >= 0 && stack[k].c !== open) k--;
        if (k < 0) { out.push(issue('unpaired', b, i, i + 1, text, [], { c: c })); continue; }
        stack.splice(k, 1);
      }
      stack.forEach(function (s) { out.push(issue('unpaired', b, s.at, s.at + 1, text, [], { c: s.c })); });
      var q = []; for (var j = 0; j < text.length; j++) if (text[j] === '"') q.push(j);
      if (q.length % 2) out.push(issue('unpaired', b, q[q.length - 1], q[q.length - 1] + 1, text, [], { c: '"' }));
    });
  }

  /* ---------- 6. raqamlash uzilishi (xatboshi boshidagi "N." yoki "N)") ---------- */
  function numbering(blocks, out) {
    var run = [];
    var flush = function () {
      for (var i = 1; i < run.length; i++) {
        if (run[i].n === run[i - 1].n + 1) continue;
        // from the first break on, the run is renumbered in one fix
        var edits = [], want = run[i - 1].n + 1;
        for (var j = i; j < run.length; j++, want++) if (run[j].n !== want) edits.push(edit(run[j].b, run[j].at, run[j].at + String(run[j].n).length, String(want)));
        var x = run[i];
        out.push(issue('numbering', x.b, x.at, x.at + String(x.n).length, blocks[x.b], edits, { prev: run[i - 1].n, n: x.n, want: run[i - 1].n + 1 }));
        break;
      }
      run = [];
    };
    blocks.forEach(function (text, b) {
      var m = /^(\s*)(\d{1,3})([.)])\s/.exec(text);
      if (!m || /^\s*\d+\.\d/.test(text)) return;
      var n = parseInt(m[2], 10);
      if (n === 1 && run.length) flush();
      run.push({ b: b, n: n, at: m[1].length });
    });
    flush();
  }

  /* ---------- 7. so'z ketma-ket takrorlangan ---------- */
  function repeats(blocks, out) {
    blocks.forEach(function (text, b) {
      var ws = words(text);
      for (var i = 1; i < ws.length; i++) {
        var a = ws[i - 1], c = ws[i];
        if (c.w.length < 2 || a.w.toLowerCase() !== c.w.toLowerCase()) continue;
        if (!/^\s+$/.test(text.slice(a.at + a.w.length, c.at))) continue;
        out.push(issue('repeat_word', b, a.at, c.at + c.w.length, text, [edit(b, a.at + a.w.length, c.at + c.w.length, '')], { w: c.w }));
      }
    });
  }

  /* ---------- 8. sana formati ---------- */
  var MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
  var DATE_RES = {
    dot: /(^|[^\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d.])/g,
    iso: /(^|[^\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g,
    long: new RegExp('(^|[^\\d])(\\d{4})\\s*(?:-?\\s*yil|-y\\.)\\s+(\\d{1,2})[-\\s]+(' + MONTHS.join('|') + ')', 'gi'),
  };
  function dateOf(kind, m) {
    if (kind === 'dot') return { y: +m[4], mo: +m[3], d: +m[2] };
    if (kind === 'iso') return { y: +m[2], mo: +m[3], d: +m[4] };
    return { y: +m[2], mo: MONTHS.indexOf(m[4].toLowerCase()) + 1, d: +m[3] };
  }
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  function writeDate(kind, v) {
    if (kind === 'dot') return pad(v.d) + '.' + pad(v.mo) + '.' + v.y;
    if (kind === 'iso') return v.y + '-' + pad(v.mo) + '-' + pad(v.d);
    return v.y + ' yil ' + v.d + ' ' + MONTHS[v.mo - 1];
  }
  function dates(blocks, out) {
    var found = [];
    blocks.forEach(function (text, b) {
      Object.keys(DATE_RES).forEach(function (kind) {
        var re = DATE_RES[kind], m; re.lastIndex = 0;
        while ((m = re.exec(text))) {
          var v = dateOf(kind, m);
          if (v.mo < 1 || v.mo > 12 || v.d < 1 || v.d > 31) continue;
          var from = m.index + m[1].length, to = kind === 'long' ? from + m[0].length - m[1].length : from + m[0].length - m[1].length;
          found.push({ kind: kind, b: b, from: from, to: to, v: v });
        }
      });
    });
    var count = {}; found.forEach(function (f) { count[f.kind] = (count[f.kind] || 0) + 1; });
    var kinds = Object.keys(count); if (kinds.length < 2) return;
    var main = kinds.sort(function (a, c) { return count[c] - count[a]; })[0];
    found.filter(function (f) { return f.kind !== main; }).forEach(function (f) {
      // a long date keeps its own trailing words ("...sentyabrdagi"): only its date part is rewritten
      // "...dekabrdagi" -> "05.12.2026 yildagi": a suffix glued to the long form keeps a word to hold it
      var glued = main !== 'long' && /\p{L}/u.test(blocks[f.b].charAt(f.to));
      out.push(issue('date_format', f.b, f.from, f.to, blocks[f.b], [edit(f.b, f.from, f.to, writeDate(main, f.v) + (glued ? ' yil' : ''))], { main: main }));
    });
  }

  /* ---------- 9. summa raqamda va so'zda ---------- */
  var NUM = { bir: 1, ikki: 2, uch: 3, tort: 4, besh: 5, olti: 6, yetti: 7, sakkiz: 8, toqqiz: 9, on: 10, yigirma: 20, ottiz: 30, qirq: 40, ellik: 50,
    oltmish: 60, yetmish: 70, sakson: 80, toqson: 90 };
  var MULT = { yuz: 100, ming: 1e3, million: 1e6, milliard: 1e9 };
  var bare = function (w) { return String(w).toLowerCase().replace(new RegExp('[' + AP + ']', 'g'), '').replace(/ö/g, 'o').replace(/ğ/g, 'g').replace(/ş/g, 'sh').replace(/ç/g, 'ch'); };
  /** "besh million ikki yuz ming" -> 5200000; null when a word is not a number word (the rest after it is kept). */
  function parseWords(text) {
    var ws = words(text), total = 0, group = 0, n = 0, used = 0;
    for (var i = 0; i < ws.length; i++) {
      var w = bare(ws[i].w);
      if (NUM[w] != null) { group += NUM[w]; n++; used = ws[i].at + ws[i].w.length; continue; }
      if (w === 'yuz') { group = (group || 1) * 100; n++; used = ws[i].at + ws[i].w.length; continue; }
      if (MULT[w]) { total += (group || 1) * MULT[w]; group = 0; n++; used = ws[i].at + ws[i].w.length; continue; }
      break;
    }
    return n ? { value: total + group, end: used } : null;
  }
  var UNITS = ['', 'bir', 'ikki', 'uch', 'to‘rt', 'besh', 'olti', 'yetti', 'sakkiz', 'to‘qqiz'];
  var TENS = ['', 'o‘n', 'yigirma', 'o‘ttiz', 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', 'to‘qson'];
  function under1000(n) {
    var h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10, p = [];
    if (h) p.push((h > 1 ? UNITS[h] + ' ' : 'bir ') + 'yuz');
    if (t) p.push(TENS[t]);
    if (u) p.push(UNITS[u]);
    return p.join(' ');
  }
  /** 5200000 -> "besh million ikki yuz ming" (old Latin, as the documents are written). */
  D.uzWords = function (n) {
    n = Math.floor(Number(n)); if (!(n >= 0) || n >= 1e12) return '';
    if (n === 0) return 'nol';
    var parts = [], scales = [[1e9, 'milliard'], [1e6, 'million'], [1e3, 'ming']];
    scales.forEach(function (s) { var q = Math.floor(n / s[0]); if (q) { parts.push(under1000(q) + ' ' + s[1]); n -= q * s[0]; } });
    if (n) parts.push(under1000(n));
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  D.parseWords = parseWords;
  function amounts(blocks, out) {
    blocks.forEach(function (text, b) {
      var re = /(\d{1,3}(?:[  ]\d{3})+|\d{2,})\s*\(([^()]{3,160})\)/g, m;
      while ((m = re.exec(text))) {
        var digits = parseInt(m[1].replace(/[  ]/g, ''), 10), inner = m[2], p = parseWords(inner);
        if (!p || p.value === digits) continue;
        var innerAt = m.index + m[0].indexOf('(') + 1;
        var lead = inner.length - inner.replace(/^\s+/, '').length;
        var good = D.uzWords(digits);
        out.push(issue('amount_words', b, m.index, m.index + m[0].length, text,
          good ? [edit(b, innerAt + lead, innerAt + p.end, good)] : [], { digits: digits, words: p.value }));
      }
    });
  }

  /* ---------- 10. ta'riflangan atama ---------- */
  var DEF = new RegExp('(?:keyingi\\s+o[' + AP + ']rinlarda|bundan\\s+(?:buyon|keyin)|keyingi\\s+matnda|далее(?:\\s+по\\s+тексту)?)\\s*[-–—:]?\\s*[«"“]([^»"”]{2,40})[»"”]', 'giu');
  function terms(blocks, out) {
    var defs = [];
    blocks.forEach(function (text, b) { var m; DEF.lastIndex = 0; while ((m = DEF.exec(text))) defs.push({ term: m[1].trim(), b: b, at: m.index + m[0].indexOf(m[1]) }); });
    defs.forEach(function (d) {
      var t = d.term;
      if (!/^\p{Lu}/u.test(t)) return;
      var esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('(^|[^\\p{L}])(' + esc + ')', 'giu');
      blocks.forEach(function (text, b) {
        var m; re.lastIndex = 0;
        while ((m = re.exec(text))) {
          var at = m.index + m[1].length, w = m[2];
          if (b === d.b && at === d.at) continue;
          if (w === t) continue;
          out.push(issue('term_case', b, at, at + w.length, text, [edit(b, at, at + w.length, t)], { term: t }));
        }
      });
    });
  }

  D.KINDS = ['mixed_script', 'alphabet_mix', 'numbering', 'amount_words', 'term_case', 'date_format', 'unpaired', 'repeat_word', 'double_space', 'space_punct'];

  /** blocks: the document's paragraphs as plain text. Issues sorted by kind (the list order), then place. */
  D.run = function (blocks) {
    var out = [];
    blocks = (blocks || []).map(function (t) { return String(t == null ? '' : t); });
    mixedScript(blocks, out); alphabetMix(blocks, out); spaces(blocks, out); unpaired(blocks, out);
    numbering(blocks, out); repeats(blocks, out); dates(blocks, out); amounts(blocks, out); terms(blocks, out);
    out.forEach(function (x, i) { x.id = x.kind + ':' + x.block + ':' + x.from + ':' + i; });
    return out.sort(function (a, c) { return D.KINDS.indexOf(a.kind) - D.KINDS.indexOf(c.kind) || a.block - c.block || a.from - c.from; });
  };

  /* ---------- AI imlo takliflari uchun (B qism): so'zlar bo'yicha farq va himoyalangan so'zlar ---------- */
  function tokens(s) { var out = [], re = /\s+|[^\s]+/g, m; while ((m = re.exec(s))) out.push({ t: m[0], at: m.index }); return out; }
  /** Word-level changes from a to b: [{ from, to, text }] on a's offsets (LCS over words and spaces). */
  D.diffWords = function (a, b) {
    var A = tokens(a), B = tokens(b), n = A.length, m = B.length;
    if (n * m > 400000) return [{ from: 0, to: a.length, text: b }];
    var L = []; for (var i = 0; i <= n; i++) { L.push(new Int32Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = A[i].t === B[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = [], cur = null; i = 0; j = 0;
    var pos = function (k) { return k < n ? A[k].at : a.length; };
    while (i < n || j < m) {
      if (i < n && j < m && A[i].t === B[j].t) { if (cur) { out.push(cur); cur = null; } i++; j++; continue; }
      if (!cur) cur = { from: pos(i), to: pos(i), text: '' };
      if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { cur.text += B[j].t; j++; } else { i++; cur.to = pos(i); }
    }
    if (cur) out.push(cur);
    return out;
  };
  /** Words an AI spelling fix may never change: anything with a digit, a capital (names, acts) or inside «quotes». */
  D.protectedWords = function (s) {
    var q = String(s).replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, function (x) { return ' ' + x.replace(/\s+/g, '_') + ' '; });
    return q.split(/\s+/).map(function (w) { return w.replace(/^[^\p{L}\p{N}«"“]+|[^\p{L}\p{N}»"”]+$/gu, ''); })
      .filter(function (w) { return w && (/\d/.test(w) || /\p{Lu}/u.test(w) || /^[«"“]/.test(w)); });
  };
  /** Does the fix keep every protected word (same count, same form)? */
  D.keepsProtected = function (a, b) {
    var pa = D.protectedWords(a).sort(), pb = D.protectedWords(b).sort();
    if (pa.length !== pb.length) return false;
    for (var i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false;
    return true;
  };

  root.JAIDocCheck = D;
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
