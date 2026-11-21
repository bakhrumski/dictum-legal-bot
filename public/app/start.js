/* U2 (docs/design/ux-audit-2026-11.md): birinchi kirish - bitta savol, qolgani keyin.
   - Tarif oynasi birinchi kirishda chiqmaydi: Sinov birinchi savolda serverning o'zida boshlanadi (tariff-ledger
     resolveEntitlement: muddati yo'q, bir martalik). Oyna faqat Sinov ishlatib bo'lingan / mavjud bo'lmaganda majburiy.
   - Hali hech narsasi yo'q odamning bosh sahifasi: "Nimadan boshlaysiz?" va uchta katta tugma; soha tanlash va
     vazifa kartalari birinchi ishdan keyin chiqadi.
   - Alifbo paneli birinchi ishdan keyin chiqadi va ilovada kontent ustida suzmaydi (sarlavha ostida, oddiy qator). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { q: 'Nimadan boshlaysiz?', sub: 'Bittasini tanlang — qolganini yo‘l-yo‘lakay ko‘rsatamiz.',
      ask: 'Savol berish', askD: 'Huquqiy savolingizni oddiy so‘z bilan yozing — javob lex.uz manbalari bilan.',
      check: 'Hujjatni tekshirish', checkD: 'Shartnoma yoki ariza yuklang — xavfli joylarini ko‘rsatamiz.',
      write: 'Hujjat yozish', writeD: 'Ariza, shartnoma, da’vo — namunadan to‘ldirib beramiz.',
      trial: 'Sinov', trialN: '{n} ta bepul savol · karta kerak emas', plans: 'Tariflar',
      askPh: 'Masalan: ish beruvchi oxirgi oylikni bermayapti, nima qilay?' },
    ru: { q: 'С чего начнёте?', sub: 'Выберите одно — остальное покажем по ходу.',
      ask: 'Задать вопрос', askD: 'Опишите вопрос простыми словами — ответ со ссылками на lex.uz.',
      check: 'Проверить документ', checkD: 'Загрузите договор или заявление — покажем рискованные места.',
      write: 'Составить документ', writeD: 'Заявление, договор, иск — заполним по образцу.',
      trial: 'Пробный', trialN: '{n} бесплатных вопросов · без карты', plans: 'Тарифы',
      askPh: 'Например: работодатель не выплатил последнюю зарплату, что делать?' },
    en: { q: 'Where would you like to start?', sub: 'Pick one — we will show the rest along the way.',
      ask: 'Ask a question', askD: 'Describe your legal question in plain words — answers cite lex.uz.',
      check: 'Check a document', checkD: 'Upload a contract or application — we point out the risky parts.',
      write: 'Write a document', writeD: 'Application, contract, claim — filled in from a template.',
      trial: 'Trial', trialN: '{n} free questions · no card needed', plans: 'Plans',
      askPh: 'For example: my employer has not paid my last salary, what can I do?' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  J.startText = s;

  /** No plan yet but the one-time Sinov is still there: nothing to choose - it starts with the first question. */
  J.trialWaiting = function () { var b = J.balance(); return !J.isStaff() && b.kind === 'none' && b.trialAvailable !== false; };

  /** The usage box for that person: what they get, not "no plan chosen". */
  J.trialUsageHtml = function () {
    var b = J.balance(), n = (b.trialQuotas && b.trialQuotas.chat) || 5;
    return '<div class="usage-h"><b>' + esc(s('trial')) + '</b><span class="num muted">0 / ' + n + '</span></div><div class="meter"><i style="width:0%"></i></div>' +
      '<small>' + esc(s('trialN', { n: n })) + '</small><button class="link usage-plans" type="button" data-a="plans">' + esc(s('plans')) + '</button>';
  };

  /* ---------- "Nimadan boshlaysiz?" ---------- */
  var ICON = { ask: 'chat', check: 'scan', write: 'pen' };
  /** host: where the three buttons go; cmp: the home composer (the question is written there). */
  J.startBlock = function (host, cmp) {
    host.innerHTML = '<div class="st-box"><h2 class="st-q">' + esc(s('q')) + '</h2><p class="st-sub muted">' + esc(s('sub')) + '</p><div class="st-grid">' +
      ['ask', 'check', 'write'].map(function (k) {
        return '<button type="button" class="st-card" data-st="' + k + '"><span class="st-ic">' + J.icon(ICON[k]) + '</span><b>' + esc(s(k)) + '</b><small>' + esc(s(k + 'D')) + '</small></button>';
      }).join('') + '</div></div>';
    $$('[data-st]', host).forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.st;
        if (k === 'check') return J.go('#/tahlil');
        if (k === 'write') return J.go('#/tayyorlash');
        // the question is asked right here: the box gets an example and the cursor
        if (cmp) {
          var ta = $('textarea', cmp.el || document) || $('.cmp textarea');
          if (ta) { ta.placeholder = s('askPh'); ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
          cmp.focus();
        }
      };
    });
  };

  /* ---------- alifbo paneli: birinchi ishdan keyin, kontent ustida emas ---------- */
  J.didWork = false;
  function alphaGate() {
    var A = G.JAIAlphabet; if (!A) return;
    A.offerGate = function () { return J.didWork === true; };
    // in the app the bar is a plain row under the top bar - it never covers the composer or a button
    A.offerHost = function () { var main = $('.main'), top = $('.main > .top'); return main && top ? { parent: main, after: top } : null; };
  }
  alphaGate();
  J.markWorked = function () {
    if (J.didWork) return;
    J.didWork = true;
    if (G.JAIAlphabet && G.JAIAlphabet.offer) G.JAIAlphabet.offer();
  };
  // a person with any chat has worked before
  J.on('sessions', function () { if ((J.S.sessions || []).length) J.markWorked(); });
})(window);
