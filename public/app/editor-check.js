/* Muharrir, D5: Tekshiruv paneli (docs/design/hujjat-muharriri.md §6; egasi 2026-10-30).
   A — AI'siz qoidalar (public/js/doc-check.js): bepul, darhol, matn o'zgarganda o'zi qayta tekshiradi; har bir topilgan joy
   ko'rsatiladi, aniq tuzatish bo'lsa — "Tuzatish" bir bosishda (formatlash saqlanadi, ↶ bilan qaytadi).
   B — AI imlo (src/editor/spell.js): chat birligi, narx avval ko'rsatiladi; takliflar o'zgargan so'zlar bilan chiqadi,
   faqat "Qabul qilish"dan keyin kiritiladi (birinchisidan oldin versiya saqlanadi). Raqam, sana, ism, qo'shtirnoq ichi
   o'zgartirilgan taklifni server o'zi tashlaydi. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { btn: 'Tekshiruv', title: 'Tekshiruv', rules: 'Texnik xatolar', free: 'bepul', clean: 'Texnik xato topilmadi.', show: 'Ko‘rsatish', fix: 'Tuzatish', fixAll: 'Hammasini tuzatish ({n})',
      fixed: 'Tuzatildi', changed: 'Matn o‘zgargan — qayta tekshirildi.', noFix: 'Buni avtomatik tuzatib bo‘lmaydi — qo‘lda tekshiring.', readonly: 'Tuzatishni faqat tahrirlovchi kirita oladi.',
      k: { mixed_script: 'So‘z ichida lotin va kirill harf', alphabet_mix: 'Eski va yangi alifbo aralash', numbering: 'Raqamlash uzilgan', amount_words: 'Summa raqamda va so‘zda farq qiladi',
        term_case: 'Ta’riflangan atama boshqacha yozilgan', date_format: 'Sana har xil yozilgan', unpaired: 'Qo‘shtirnoq yoki qavs juftsiz', repeat_word: 'So‘z takrorlangan',
        double_space: 'Ortiqcha bo‘sh joy', space_punct: 'Tinish belgisidan oldin bo‘sh joy' },
      m: { mixed_script: '«{w}» ichida ikki yozuv harfi bor (tashqi ko‘rinishi bir xil, lekin qidiruvda topilmaydi).', alphabet_mix: 'Hujjatning ko‘pi {to} yozuvda: «{w}» shunga moslanadi.',
        numbering: '{prev} dan keyin {n} keldi ({want} bo‘lishi kerak). Tuzatish keyingi bandlarni ham ketma-ket qiladi.', amount_words: 'Raqamda {d}, so‘zda {s}.',
        term_case: 'Atama «{t}» deb ta’riflangan.', date_format: 'Hujjatdagi sanalarning ko‘pi {f} ko‘rinishida.', unpaired: '«{c}» belgisining jufti yo‘q.', repeat_word: '«{w}» ikki marta ketma-ket.',
        double_space: 'Ikki yoki undan ortiq bo‘sh joy.', space_punct: '«{p}» oldidagi bo‘sh joy ortiqcha.' },
      old: 'eski lotin', neu: 'yangi lotin', fmt: { dot: 'kk.oo.yyyy', iso: 'yyyy-oo-kk', long: '«2026 yil 30 sentyabr»' },
      ai: 'AI imlo tekshiruvi', aiIntro: 'Imlo, grammatika va tinish belgilari. Raqam, sana, ism va qo‘shtirnoq ichi hech qachon o‘zgartirilmaydi. Takliflarni o‘zingiz qabul qilasiz.',
      price: 'Narxini ko‘rish', cost: '{c} belgi — {u} chat birligi. Qoladi: {r}.', costUnl: '{c} belgi — {u} chat birligi.', run: 'Tekshirish', running: 'Imlo tekshirilmoqda…',
      tooBig: 'Bir martada {m} belgigacha tekshiriladi.', none: 'Imlo xatosi topilmadi.', accept: 'Qabul qilish', reject: 'Rad etish', acceptAll: 'Hammasini qabul qilish ({n})',
      gone: 'Bu xatoboshi o‘zgargan — taklif endi mos emas.', dropped: '{n} ta taklif tashlandi: raqam, sana, ism yoki qo‘shtirnoq ichini o‘zgartirgan.', failed: '{n} ta xatboshi tekshirilmadi (AI javob bermadi).',
      verLabel: 'Imlo tuzatishidan oldin', done: 'Qabul qilindi' },
    ru: { btn: 'Проверка', title: 'Проверка', rules: 'Технические ошибки', free: 'бесплатно', clean: 'Технических ошибок нет.', show: 'Показать', fix: 'Исправить', fixAll: 'Исправить все ({n})',
      fixed: 'Исправлено', changed: 'Текст изменился — проверено заново.', noFix: 'Автоматически не исправить — проверьте вручную.', readonly: 'Исправлять может только редактор.',
      k: { mixed_script: 'Латиница и кириллица в одном слове', alphabet_mix: 'Старый и новый алфавит вперемешку', numbering: 'Нумерация нарушена', amount_words: 'Сумма цифрами и прописью не совпадает',
        term_case: 'Определённый термин написан иначе', date_format: 'Даты в разном формате', unpaired: 'Непарная кавычка или скобка', repeat_word: 'Повтор слова',
        double_space: 'Лишний пробел', space_punct: 'Пробел перед знаком препинания' },
      m: { mixed_script: 'В «{w}» буквы двух алфавитов (выглядят одинаково, но поиск их не найдёт).', alphabet_mix: 'Большая часть документа — {to}: «{w}» приводится к нему.',
        numbering: 'После {prev} идёт {n} (должно быть {want}). Исправление перенумерует и следующие пункты.', amount_words: 'Цифрами {d}, прописью {s}.',
        term_case: 'Термин определён как «{t}».', date_format: 'Большинство дат в формате {f}.', unpaired: 'У «{c}» нет пары.', repeat_word: '«{w}» дважды подряд.',
        double_space: 'Два и более пробела.', space_punct: 'Пробел перед «{p}» лишний.' },
      old: 'старая латиница', neu: 'новая латиница', fmt: { dot: 'дд.мм.гггг', iso: 'гггг-мм-дд', long: '«2026 yil 30 sentyabr»' },
      ai: 'ИИ-проверка орфографии', aiIntro: 'Орфография, грамматика и пунктуация. Числа, даты, имена и текст в кавычках не меняются никогда. Предложения принимаете вы.',
      price: 'Узнать стоимость', cost: '{c} знаков — {u} ед. чата. Останется: {r}.', costUnl: '{c} знаков — {u} ед. чата.', run: 'Проверить', running: 'Идёт проверка…',
      tooBig: 'За раз проверяется до {m} знаков.', none: 'Ошибок не найдено.', accept: 'Принять', reject: 'Отклонить', acceptAll: 'Принять все ({n})',
      gone: 'Абзац изменился — предложение больше не подходит.', dropped: 'Отброшено предложений: {n} (меняли числа, даты, имена или текст в кавычках).', failed: 'Не проверено абзацев: {n} (ИИ не ответил).',
      verLabel: 'До исправления орфографии', done: 'Принято' },
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (typeof x === 'string' && v) Object.keys(v).forEach(function (n) { x = x.split('{' + n + '}').join(v[n]); }); return x; }
  J.editorCheckLabel = function () { return s('btn'); };
  var SAFE_ALL = { double_space: 1, space_punct: 1, mixed_script: 1, alphabet_mix: 1, repeat_word: 1, date_format: 1, term_case: 1 };

  /** The document's text blocks with a char -> position map (a hard break counts as one '\n'). */
  function blocksOf(ed) {
    var out = [];
    ed.state.doc.descendants(function (node, pos) {
      if (!node.isTextblock) return true;
      var text = '', map = [];
      node.forEach(function (child, off) {
        var at = pos + 1 + off;
        if (child.isText) { for (var i = 0; i < child.text.length; i++) { text += child.text[i]; map.push(at + i); } }
        else { text += '\n'; map.push(at); }
      });
      map.push(pos + 1 + node.content.size);
      out.push({ text: text.replace(/ /g, ' '), raw: text, map: map, pos: pos });
      return false;
    });
    return out;
  }
  function posOf(b, off) { return b.map[Math.min(off, b.map.length - 1)]; }

  J.editorCheck = function (v, ed, o) {
    var side = J.h('<aside class="ed-side ed-chk" hidden></aside>');
    $('.ed-main', v).appendChild(side);
    var issues = [], blocks = [], spell = null, quote = null, busy = false, versioned = false, timer = null, doneSpell = {};

    function head() { return '<div class="ed-sh"><b>' + esc(s('title')) + '</b><button type="button" class="ed-x" data-a="close" aria-label="×">×</button></div>'; }
    function msg(x) {
      var p = x.params || {}, M = s('m');
      return (M[x.kind] || '').replace('{w}', x.found).replace('{to}', p.to === 'old' ? s('old') : s('neu')).replace('{prev}', p.prev).replace('{n}', p.n).replace('{want}', p.want)
        .replace('{d}', J.fmtNum ? J.fmtNum(p.digits) : p.digits).replace('{s}', J.fmtNum ? J.fmtNum(p.words) : p.words).replace('{t}', p.term).replace('{f}', (s('fmt') || {})[p.main] || p.main)
        .replace('{c}', p.c).replace('{p}', p.p);
    }
    function snippet(x) {
      var t = blocks[x.block] ? blocks[x.block].text : '', a = Math.max(0, x.from - 28), b = Math.min(t.length, x.to + 28);
      var vis = function (z) { return esc(z).replace(/ {2,}/g, function (m) { return m.split('').map(function () { return '·'; }).join(''); }); };
      return (a > 0 ? '…' : '') + vis(t.slice(a, x.from)) + '<mark class="ed-chk-hit">' + (vis(t.slice(x.from, x.to)) || '·') + '</mark>' + vis(t.slice(x.to, b)) + (b < t.length ? '…' : '');
    }
    function show(x) {
      var b = blocks[x.block]; if (!b) return;
      if (G.matchMedia && G.matchMedia('(max-width: 1099px)').matches) side.hidden = true;
      ed.chain().focus().setTextSelection({ from: posOf(b, x.from), to: posOf(b, Math.max(x.to, x.from + 1)) }).run();
      var dom = ed.view.domAtPos(posOf(b, x.from)), el = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    /** Apply edits made on `snap` (block texts at check time); refused when a block changed since. */
    function apply(edits, snap) {
      var now = blocksOf(ed);
      if (edits.some(function (e) { return !now[e.block] || now[e.block].text !== snap[e.block]; })) { J.toast(s('changed')); run(); return false; }
      var list = edits.slice().sort(function (a, b) { return b.block - a.block || b.from - a.from; });
      var tr = ed.state.tr;
      list.forEach(function (e) {
        var b = now[e.block], from = posOf(b, e.from), to = posOf(b, e.to);
        if (e.text) tr.insertText(e.text, from, to); else tr.delete(from, to);
      });
      if (!tr.docChanged) return false;
      ed.view.dispatch(tr); o.changed();
      return true;
    }
    async function keepVersion(label) {
      if (versioned) return; versioned = true;
      await o.flush();
      await J.api('/api/editor/docs/' + encodeURIComponent(o.id) + '/versions', { method: 'POST', body: { label: label } });
    }

    function run() {
      blocks = blocksOf(ed);
      issues = G.JAIDocCheck ? G.JAIDocCheck.run(blocks.map(function (b) { return b.text; })) : [];
      var n = $('.ed-chkn', v); if (n) n.textContent = s('btn') + (issues.length ? ' (' + issues.length + ')' : '');
      if (!side.hidden) draw();
    }
    function draw() {
      var snap = blocks.map(function (b) { return b.text; });
      var groups = {}; issues.forEach(function (x) { (groups[x.kind] = groups[x.kind] || []).push(x); });
      var html = head() + '<div class="ed-ai-h">' + esc(s('rules')) + ' · ' + esc(s('free')) + '</div>';
      if (!issues.length) html += '<p class="muted ed-ai-p">' + esc(s('clean')) + '</p>';
      if (!o.canWrite && issues.length) html += '<p class="muted ed-ai-p">' + esc(s('readonly')) + '</p>';
      html += '<div class="ed-chk-g"></div>';
      if (o.canWrite) html += '<div class="ed-ai-h">' + esc(s('ai')) + '</div><div class="ed-chk-ai"></div>';
      side.innerHTML = html;
      $('[data-a=close]', side).onclick = function () { side.hidden = true; };
      var host = $('.ed-chk-g', side);
      (G.JAIDocCheck ? G.JAIDocCheck.KINDS : []).forEach(function (kind) {
        var list = groups[kind]; if (!list) return;
        var fixable = list.filter(function (x) { return x.edits.length; });
        var g = J.h('<div class="ed-chk-grp"><div class="ed-chk-gh"><b></b><span class="muted"></span>' +
          (o.canWrite && SAFE_ALL[kind] && fixable.length > 1 ? '<button type="button" class="link" data-a="all">' + esc(s('fixAll', { n: fixable.length })) + '</button>' : '') + '</div></div>');
        $('b', g).textContent = s('k')[kind] || kind; $('.muted', g).textContent = '(' + list.length + ')';
        var ab = $('[data-a=all]', g);
        if (ab) ab.onclick = async function () {
          var all = []; fixable.forEach(function (x) { all = all.concat(x.edits); });
          if (apply(all, snap)) { J.toast(s('fixed')); run(); }
        };
        list.slice(0, 50).forEach(function (x) {
          var c = J.h('<div class="ed-card ed-chk-c"><p class="ed-chk-s"></p><p class="ed-chk-m"></p><div class="ed-ca"><button type="button" class="link" data-a="show">' + esc(s('show')) + '</button>' +
            (o.canWrite && x.edits.length ? '<button type="button" class="link" data-a="fix">' + esc(s('fix')) + (x.edits.length === 1 && x.edits[0].text ? ' → «' + esc(x.edits[0].text.slice(0, 40)) + '»' : '') + '</button>' : '') + '</div></div>');
          $('.ed-chk-s', c).innerHTML = snippet(x);
          $('.ed-chk-m', c).textContent = msg(x) + (x.edits.length ? '' : ' ' + s('noFix'));
          $('[data-a=show]', c).onclick = function () { show(x); };
          var fb = $('[data-a=fix]', c);
          if (fb) fb.onclick = function () { if (apply(x.edits, snap)) { J.toast(s('fixed')); run(); } };
          g.appendChild(c);
        });
        host.appendChild(g);
      });
      if (o.canWrite) drawSpell();
    }

    /* ---------- B: AI imlo ---------- */
    var base = '/api/editor/docs/' + encodeURIComponent(o.id) + '/spell';
    function drawSpell() {
      var box = $('.ed-chk-ai', side); if (!box) return;
      if (busy) { box.innerHTML = '<div class="card ed-ai-run"><span class="spin"></span><span>' + esc(s('running')) + '</span></div>'; return; }
      if (!spell) {
        box.innerHTML = '<p class="ed-ai-p">' + esc(s('aiIntro')) + '</p><div class="ed-ai-q">' + (quote ? '' : '<button class="pill sm" type="button" data-a="q">' + esc(s('price')) + '</button>') + '</div>';
        if (quote) drawQuote(box); else $('[data-a=q]', box).onclick = getQuote;
        return;
      }
      var left = spell.paragraphs.filter(function (p) { return !doneSpell[p.i]; });
      box.innerHTML = (spell.dropped && (spell.dropped.protected + spell.dropped.length) ? '<p class="muted ed-ai-by"></p>' : '') + (spell.failed ? '<p class="muted ed-ai-by ed-chk-fail"></p>' : '') +
        (left.length > 1 ? '<div class="ed-ai-q"><button class="pill sm" type="button" data-a="acc-all">' + esc(s('acceptAll', { n: left.length })) + '</button></div>' : '') +
        (spell.paragraphs.length ? '' : '<p class="muted ed-ai-p">' + esc(s('none')) + '</p>') + '<div class="ed-chk-sp"></div>' +
        '<div class="ed-ai-q"><button class="pill sm ghost" type="button" data-a="again">' + esc(s('price')) + '</button></div>';
      var dp = $('.ed-ai-by', box); if (dp && !dp.classList.contains('ed-chk-fail')) dp.textContent = s('dropped', { n: spell.dropped.protected + spell.dropped.length });
      var fl = $('.ed-chk-fail', box); if (fl) fl.textContent = s('failed', { n: spell.failed });
      $('[data-a=again]', box).onclick = function () { spell = null; quote = null; getQuote(); };
      var list = $('.ed-chk-sp', box);
      spell.paragraphs.forEach(function (p) {
        var c = J.h('<div class="ed-card ed-chk-c' + (doneSpell[p.i] ? ' ed-ai-done' : '') + '"><p class="ed-chk-d"></p><div class="ed-ca"></div></div>');
        var t = p.text, html = '', at = 0;
        p.changes.forEach(function (ch) {
          html += esc(t.slice(at, ch.from)) + (ch.to > ch.from ? '<s class="ed-chk-old">' + esc(t.slice(ch.from, ch.to)) + '</s>' : '') + (ch.text ? '<span class="ed-chk-new">' + esc(ch.text) + '</span>' : '');
          at = ch.to;
        });
        $('.ed-chk-d', c).innerHTML = html + esc(t.slice(at));
        var ca = $('.ed-ca', c);
        if (doneSpell[p.i]) ca.innerHTML = '<span class="muted">' + esc(doneSpell[p.i] === 'acc' ? s('done') : s('reject')) + '</span>';
        else {
          ca.innerHTML = '<button type="button" class="link" data-a="acc">' + esc(s('accept')) + '</button><button type="button" class="link" data-a="rej">' + esc(s('reject')) + '</button>';
          $('[data-a=acc]', c).onclick = async function () { if (await acceptSpell([p])) drawSpell(); };
          $('[data-a=rej]', c).onclick = function () { doneSpell[p.i] = 'rej'; drawSpell(); };
        }
        list.appendChild(c);
      });
      var aa = $('[data-a=acc-all]', box); if (aa) aa.onclick = async function () { await acceptSpell(left); drawSpell(); };
    }
    /** A paragraph's changes go in where its text still stands exactly as it was checked; else it is named as changed. */
    async function acceptSpell(list) {
      await keepVersion(s('verLabel'));
      var now = blocksOf(ed), edits = [], snap = now.map(function (b) { return b.text; }), any = false;
      list.forEach(function (p) {
        var k = -1; for (var i = 0; i < now.length; i++) if (now[i].text === p.text && !edits.some(function (e) { return e.block === i; })) { k = i; break; }
        if (k < 0) { doneSpell[p.i] = 'rej'; J.toast(s('gone')); return; }
        p.changes.forEach(function (ch) { edits.push({ block: k, from: ch.from, to: ch.to, text: ch.text }); });
        doneSpell[p.i] = 'acc'; any = true;
      });
      if (any && edits.length) apply(edits, snap);
      run();
      return any;
    }
    async function getQuote() {
      var box = $('.ed-chk-ai', side); if (box) box.innerHTML = '<span class="spin"></span>';
      await o.flush();
      var r = await J.api(base + '/quote', { method: 'POST', body: {} });
      if (!r.ok) { if (box) { box.innerHTML = '<p class="err"></p>'; $('p', box).textContent = J.errMsg(r.data); } return; }
      quote = r.data; drawSpell();
    }
    function drawQuote(box) {
      var q = $('.ed-ai-q', box);
      if (quote.fits === false) { q.innerHTML = '<div class="note warn"></div>'; $('.note', q).textContent = s('tooBig', { m: J.fmtNum ? J.fmtNum(quote.maxChars) : quote.maxChars }); return; }
      q.innerHTML = '<div class="card ed-ai-cost"><p></p><button class="pill sm" type="button" data-a="run">' + esc(s('run')) + ' →</button></div>';
      var c = J.fmtNum ? J.fmtNum(quote.chars) : quote.chars;
      $('p', q).textContent = quote.unlimited || quote.remaining == null ? s('costUnl', { c: c, u: quote.units }) : s('cost', { c: c, u: quote.units, r: quote.remainingAfter });
      $('[data-a=run]', q).onclick = runSpell;
    }
    async function runSpell() {
      if (busy) return; busy = true; drawSpell();
      await o.flush();
      var r = await J.api(base, { method: 'POST', body: { confirmed: true } });
      busy = false; quote = null;
      J.refreshTariff && J.refreshTariff();
      if (!r.ok) { if (!(J.handleLimit && J.handleLimit(r.data))) J.toast(J.errMsg(r.data), 6000); drawSpell(); return; }
      spell = r.data; doneSpell = {}; drawSpell();
    }

    ed.on('update', function () { clearTimeout(timer); timer = setTimeout(run, 700); });
    setTimeout(run, 0);
    return {
      el: side,
      open: function () { side.hidden = false; run(); },
      hide: function () { side.hidden = true; },
    };
  };
})(window);
