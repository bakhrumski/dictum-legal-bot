/* Kirish va ro'yxatdan o'tish — bitta oqim, minimal qadam.
   Telegram (asosiy, 1 qadam): /api/auth/options → {telegram:{botId}} bo'lsa, Telegram.Login.auth oynasi ochiladi,
     foydalanuvchi Telegram ilovasida tasdiqlaydi → POST /api/auth/telegram (server imzoni tekshiradi, hisob bor bo'lsa kiritadi, yo'q bo'lsa ochadi).
   Telegram (zaxira, kod orqali): POST /api/reg-session → t.me/<bot>?start=reg_<token> → bot 6 raqamli kod yuboradi → POST /api/register/telegram-otp.
   Hisob bor bo'lsa server shu oqimda kiritadi, yo'q bo'lsa yaratadi (src/auth/telegram-auth-routes.js).
   Google: /auth/google?mode=register (GOOGLE_AUTH_ENABLED=true bo'lganda; /api/auth/options).
   Muvaffaqiyatdan so'ng: /app/ (yoki xavfsiz ?redirect=). Kod hech qachon API javobida kelmaydi. */
(function () {
  'use strict';
  var T = {
    uz: { title: 'JuristAI’ga xush kelibsiz', sub: 'Telegram yoki Google bilan bir bosishda kiring. Yangi bo‘lsangiz, hisob avtomatik ochiladi.', busy: 'Kirilmoqda…', tgcancel: 'Telegram oynasi yopildi. Qayta urinib ko‘ring.', bycode: 'Telegram kodi orqali kirish', agree: 'Davom etib, Oferta va Maxfiylik siyosatiga rozilik bildirasiz.', tgfail: 'Telegram orqali kirib bo‘lmadi. Kod orqali urinib ko‘ring.', tg: 'Telegram orqali davom etish', google: 'Google orqali davom etish', gsoon: 'Google — tez orada',
      or: 'yoki', pw: 'Login va parol bilan kirish', user: 'Login', pass: 'Parol', enter: 'Kirish', back: 'Orqaga',
      s1: 'Telegram ochildi — botda «Start» ni bosing.', s2: 'Bot sizga 6 raqamli kod yuboradi.', s3: 'Kodni shu yerga kiriting.', wait: 'Kod kutilmoqda…', sent: 'Kod yuborildi. 6 raqamni kiriting (5 daqiqa amal qiladi).', expired: 'Muddat tugadi. Qayta urinib ko‘ring.', reopen: 'Telegramni qayta ochish', verify: 'Tasdiqlash',
      need6: '6 raqamli kodni to‘liq kiriting.', used: 'Bu qurilmada yoki Telegram hisobda Sinov allaqachon ishlatilgan. Kirish uchun mavjud hisobingizdan foydalaning.', err: 'Xatolik yuz berdi', net: 'Tarmoq xatosi',
      twofa: 'Telegramga yuborilgan tasdiqlash kodini kiriting.', secure: 'Xavfsizlik uchun kod faqat siz ochgan Telegram chatiga yuboriladi.',
      offer: 'Oferta', privacy: 'Maxfiylik', terms: 'Shartlar', 'side.t': 'Savol bering. Javobni manbasi bilan oling.', b: ['Har bir javob lex.uz moddasi bilan', 'Ma’lumotlar O‘zbekistondagi serverlarda, shifrlangan', 'O‘zbek, rus va ingliz tillarida'],
      gerr: { google_disabled: 'Google orqali kirish hozircha yoqilmagan.', google_failed: 'Google orqali kirib bo‘lmadi. Qayta urinib ko‘ring.', google_cancelled: 'Google orqali kirish bekor qilindi.', sinov_used: 'Bu qurilmada Sinov allaqachon ishlatilgan.', google_account_not_found: 'Bu Google hisobiga bog‘langan akkaunt topilmadi.' } },
    ru: { title: 'Добро пожаловать в JuristAI', sub: 'Войдите через Telegram или Google в одно касание. Если вы новый пользователь, аккаунт откроется автоматически.', busy: 'Входим…', tgcancel: 'Окно Telegram закрыто. Попробуйте снова.', bycode: 'Войти по коду из Telegram', agree: 'Продолжая, вы соглашаетесь с Офертой и Политикой конфиденциальности.', tgfail: 'Не удалось войти через Telegram. Попробуйте по коду.', tg: 'Продолжить через Telegram', google: 'Продолжить через Google', gsoon: 'Google — скоро',
      or: 'или', pw: 'Войти по логину и паролю', user: 'Логин', pass: 'Пароль', enter: 'Войти', back: 'Назад',
      s1: 'Telegram открыт — нажмите «Start» в боте.', s2: 'Бот пришлёт 6-значный код.', s3: 'Введите код здесь.', wait: 'Ожидаем код…', sent: 'Код отправлен. Введите 6 цифр (действует 5 минут).', expired: 'Время истекло. Попробуйте снова.', reopen: 'Открыть Telegram снова', verify: 'Подтвердить',
      need6: 'Введите 6-значный код полностью.', used: 'Пробный доступ уже использован на этом устройстве или в этом Telegram-аккаунте. Войдите в существующий аккаунт.', err: 'Произошла ошибка', net: 'Ошибка сети',
      twofa: 'Введите код подтверждения, отправленный в Telegram.', secure: 'Для безопасности код приходит только в тот чат Telegram, который вы открыли.',
      offer: 'Оферта', privacy: 'Конфиденциальность', terms: 'Условия', 'side.t': 'Задайте вопрос. Получите ответ с источником.', b: ['Каждый ответ со статьёй lex.uz', 'Данные на серверах в Узбекистане, зашифрованы', 'На узбекском, русском и английском'],
      gerr: { google_disabled: 'Вход через Google пока не включён.', google_failed: 'Не удалось войти через Google. Попробуйте снова.', google_cancelled: 'Вход через Google отменён.', sinov_used: 'Пробный доступ уже использован на этом устройстве.', google_account_not_found: 'Аккаунт с этим Google не найден.' } },
    en: { title: 'Welcome to JuristAI', sub: 'Continue with Telegram or Google in one tap. New here? Your account is created automatically.', busy: 'Signing in…', tgcancel: 'The Telegram window was closed. Please try again.', bycode: 'Sign in with a Telegram code', agree: 'By continuing you accept the Offer and the Privacy Policy.', tgfail: 'Telegram sign-in failed. Try with a code instead.', tg: 'Continue with Telegram', google: 'Continue with Google', gsoon: 'Google — coming soon',
      or: 'or', pw: 'Sign in with login and password', user: 'Login', pass: 'Password', enter: 'Sign in', back: 'Back',
      s1: 'Telegram opened — press “Start” in the bot.', s2: 'The bot sends you a 6-digit code.', s3: 'Enter the code here.', wait: 'Waiting for the code…', sent: 'Code sent. Enter the 6 digits (valid for 5 minutes).', expired: 'Time is up. Please try again.', reopen: 'Open Telegram again', verify: 'Verify',
      need6: 'Enter the full 6-digit code.', used: 'The trial was already used on this device or Telegram account. Sign in to your existing account.', err: 'Something went wrong', net: 'Network error',
      twofa: 'Enter the confirmation code sent to Telegram.', secure: 'For security, the code goes only to the Telegram chat you opened.',
      offer: 'Offer', privacy: 'Privacy', terms: 'Terms', 'side.t': 'Ask a question. Get an answer with its source.', b: ['Every answer cites a lex.uz article', 'Data on servers in Uzbekistan, encrypted', 'In Uzbek, Russian and English'],
      gerr: { google_disabled: 'Google sign-in is not enabled yet.', google_failed: 'Google sign-in failed. Please try again.', google_cancelled: 'Google sign-in was cancelled.', sinov_used: 'The trial was already used on this device.', google_account_not_found: 'No account is linked to this Google account.' } }
  };
  var lang = 'uz'; try { lang = localStorage.getItem('lang') || (navigator.language || 'uz').slice(0, 2); } catch (e) {}
  if (!T[lang]) lang = 'uz';
  var L = T[lang];
  document.documentElement.lang = lang;
  try { document.documentElement.setAttribute('data-theme', localStorage.getItem('jai-theme') || 'light'); } catch (e) {}
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var form = $('#form');
  var TG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 4.3 18.8 19c-.2 1-.8 1.3-1.7.8l-4.6-3.4-2.2 2.1c-.2.2-.5.5-1 .5l.3-4.8 8.7-7.9c.4-.3-.1-.5-.6-.2L6.9 12.9 2.3 11.5c-1-.3-1-1 .2-1.5L20.6 3c.8-.3 1.6.2 1.3 1.3Z"/></svg>';
  var GG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8Z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1-3.8 1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.3-.4-2s.2-1.3.4-2V7.2H2.1a11 11 0 0 0 0 9.6Z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.1 7.2L5.7 10c.9-2.6 3.4-4.6 6.3-4.6Z"/></svg>';

  /* til, pastki havolalar, o'ng panel */
  $('#langs').innerHTML = ['uz', 'ru', 'en'].map(function (l) { return '<button type="button" data-l="' + l + '" class="' + (l === lang ? 'on' : '') + '">' + l.toUpperCase() + '</button>'; }).join('');
  Array.prototype.forEach.call(document.querySelectorAll('[data-l]'), function (b) { b.onclick = function () { try { localStorage.setItem('lang', b.dataset.l); } catch (e) {} location.reload(); }; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-k]'), function (el) { el.textContent = L[el.dataset.k]; });
  Array.prototype.forEach.call(document.querySelectorAll('.auth-r li'), function (li, i) { li.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg><span></span>'; li.lastChild.textContent = L.b[i]; });

  /* Kirgandan keyin qayerga: faqat shu saytdagi yo'l */
  var params = new URLSearchParams(location.search);
  (function () { var inv = params.get('invite'); if (inv) try { sessionStorage.setItem('juristai-workspace-invite', inv); } catch (e) {} })();
  function dest() {
    var r = params.get('redirect');
    if (r && r.charAt(0) === '/' && !/^\/[\/\\]/.test(r) && !/[\\\u0000-\u001f]/.test(r)) {
      try { var u = new URL(r, location.origin); if (u.origin === location.origin) return u.pathname + u.search + u.hash; } catch (e) {}
    }
    return '/app/';
  }
  async function post(url, body) {
    try {
      var res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      var d = {}; try { d = await res.json(); } catch (e) {}
      return { ok: res.ok, status: res.status, data: d };
    } catch (e) { return { ok: false, status: 0, data: { error: L.net } }; }
  }

  /* qurilma izi (Sinov suiiste'molining oldini olish) — eski login sahifasidagi kabi, ixtiyoriy */
  var fp = null;
  (function () {
    var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@4/dist/fp.min.js';
    s.onload = function () { try { window.FingerprintJS.load().then(function (x) { return x.get(); }).then(function (r) { fp = r.visitorId; }).catch(function () {}); } catch (e) {} };
    document.head.appendChild(s);
  })();

  /* ---------- 1-qadam: tanlash ---------- */
  var googleOn = false, tgLogin = null;
  function home(msg) {
    form.innerHTML = '<h1></h1><p class="sub"></p>' +
      '<button class="pill dark big" type="button" id="tgBtn">' + TG + '<span></span></button>' +
      '<button class="pill ghost big" type="button" id="gBtn">' + GG + '<span></span></button>' +
      '<p class="msg err" id="msg"></p><p class="agree"></p>' +
      '<div class="or"></div><div class="alt">' + (tgLogin ? '<button class="lnk" type="button" id="codeBtn"></button>' : '') + '<button class="lnk" type="button" id="pwBtn"></button></div>';
    $('h1', form).textContent = L.title; $('.sub', form).textContent = L.sub;
    $('#tgBtn span').textContent = L.tg; $('#gBtn span').textContent = googleOn ? L.google : L.gsoon;
    $('#gBtn').disabled = !googleOn; if (!googleOn) $('#gBtn').style.opacity = '.55';
    $('.or', form).textContent = L.or; $('#pwBtn').textContent = L.pw; $('.agree', form).textContent = L.agree;
    if ($('#codeBtn')) { $('#codeBtn').textContent = L.bycode; $('#codeBtn').onclick = telegram; }
    if (msg) $('#msg').textContent = msg;
    $('#tgBtn').onclick = tgLogin ? telegramOneStep : telegram;
    $('#gBtn').onclick = function () { if (fp) document.cookie = 'dfp=' + fp + '; path=/; SameSite=Lax; max-age=300'; location.href = '/auth/google?mode=register'; };
    $('#pwBtn').onclick = password;
  }

  /* ---------- Telegram: bir qadam (oauth.telegram.org oynasi, server imzoni tekshiradi) ---------- */
  function loadTgScript() {
    if (!tgLogin || tgLogin.mock || window.Telegram && window.Telegram.Login) return;
    var s = document.createElement('script'); s.src = 'https://telegram.org/js/telegram-widget.js?22'; s.async = true; document.head.appendChild(s);
  }
  function telegramOneStep() {
    var btn = $('#tgBtn'), m = $('#msg');
    function done(auth) {
      if (!auth) { m.textContent = L.tgcancel; return; }
      btn.disabled = true; btn.innerHTML = '<span class="spin" style="border-top-color:#fff"></span><span>' + L.busy + '</span>';
      post('/api/auth/telegram', { auth: auth, device_fingerprint: fp || null }).then(function (r) {
        if (r.ok && r.data.success) { location.href = dest(); return; }
        home(r.data.error === 'sinov_used' ? L.used : L.tgfail);
      });
    }
    m.textContent = '';
    if (tgLogin.mock) { setTimeout(function () { done({ id: 1, first_name: 'Sinov', auth_date: Math.floor(Date.now() / 1000), hash: 'mock' }); }, 600); return; }
    if (!window.Telegram || !window.Telegram.Login) { telegram(); return; }        // skript yuklanmagan bo'lsa — kod orqali
    window.Telegram.Login.auth({ bot_id: tgLogin.botId, request_access: 'write', lang: lang }, done);
  }

  /* ---------- Telegram: kod orqali (zaxira yo'l) ---------- */
  var token = null, poll = null, link = null;
  async function telegram() {
    var btn = $('#tgBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin" style="border-top-color:#fff"></span>';
    var r = await post('/api/reg-session');
    if (!r.ok || !r.data.token) { home(r.data.error || L.err); return; }
    token = r.data.token;
    link = 'https://t.me/' + (r.data.botUsername || 'juristAI_registration_bot') + '?start=reg_' + token;
    window.open(link, '_blank', 'noopener');
    codeStep();
    watch();
  }
  function codeStep() {
    form.innerHTML = '<h1></h1><p class="sub"></p><ol class="tg-steps"><li class="ok"><b>1</b><span></span></li><li id="st2"><b>2</b><span></span></li><li id="st3"><b>3</b><span></span></li></ol>' +
      '<div class="otp">' + [0, 1, 2, 3, 4, 5].map(function (i) { return '<input inputmode="numeric" autocomplete="one-time-code" maxlength="1" aria-label="' + (i + 1) + '">'; }).join('') + '</div>' +
      '<p class="msg" id="msg"></p><button class="pill big" type="button" id="vBtn"></button>' +
      '<div style="display:flex;justify-content:space-between;margin-top:16px"><button class="lnk" id="back"></button><a class="lnk" id="reopen" target="_blank" rel="noopener"></a></div>' +
      '<p class="muted" style="font-size:12.5px;margin-top:22px"></p>';
    $('h1', form).textContent = 'Telegram'; $('.sub', form).textContent = L.sub;
    var lis = form.querySelectorAll('.tg-steps span'); lis[0].textContent = L.s1; lis[1].textContent = L.s2; lis[2].textContent = L.s3;
    $('#msg').textContent = L.wait; $('#vBtn').textContent = L.verify; $('#back').textContent = L.back; $('#reopen').textContent = L.reopen; $('#reopen').href = link;
    form.lastElementChild.textContent = L.secure;
    $('#back').onclick = function () { clearInterval(poll); home(); };
    var boxes = Array.prototype.slice.call(form.querySelectorAll('.otp input'));
    boxes.forEach(function (b, i) {
      b.addEventListener('input', function () {
        var v = b.value.replace(/\D/g, '');
        if (v.length > 1) { v.split('').slice(0, 6 - i).forEach(function (c, k) { boxes[i + k].value = c; }); (boxes[Math.min(5, i + v.length)] || b).focus(); }
        else { b.value = v; if (v && boxes[i + 1]) boxes[i + 1].focus(); }
        if (code().length === 6) verify();
      });
      b.addEventListener('keydown', function (e) { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); if (e.key === 'Enter') verify(); });
      b.addEventListener('paste', function (e) { var p = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (p) { e.preventDefault(); p.split('').forEach(function (c, k) { boxes[k].value = c; }); if (p.length === 6) verify(); } });
    });
    function code() { return boxes.map(function (b) { return b.value; }).join(''); }
    $('#vBtn').onclick = verify;
    var busy = false;
    async function verify() {
      if (busy) return;
      var c = code(), m = $('#msg'); m.classList.remove('err');
      if (!/^\d{6}$/.test(c)) { m.textContent = L.need6; m.classList.add('err'); return; }
      busy = true; $('#vBtn').innerHTML = '<span class="spin" style="border-top-color:#fff"></span>';
      var r = await post('/api/register/telegram-otp', { token: token, otp_code: c, device_fingerprint: fp || null });
      if (r.ok) { clearInterval(poll); location.href = dest(); return; }
      busy = false; $('#vBtn').textContent = L.verify;
      m.textContent = r.data.error === 'sinov_used' ? L.used : (r.data.error || L.err); m.classList.add('err');
      if (r.data.code === 'wrong_code') { boxes.forEach(function (b) { b.value = ''; }); boxes[0].focus(); }
    }
  }
  function watch() {
    clearInterval(poll); var n = 0;
    poll = setInterval(async function () {
      n++;
      try {
        var res = await fetch('/api/telegram-auth/status/register/' + token, { credentials: 'same-origin' }); var d = await res.json();
        if (d.codeSent) {
          clearInterval(poll); var m = $('#msg'); if (m) m.textContent = L.sent;
          var s2 = $('#st2'), s3 = $('#st3'); if (s2) s2.classList.add('ok'); if (s3) s3.classList.add('ok');
          var f = form.querySelector('.otp input'); if (f) f.focus();
        } else if (d.expired || n > 120) { clearInterval(poll); var m2 = $('#msg'); if (m2) { m2.textContent = L.expired; m2.classList.add('err'); } }
      } catch (e) {}
    }, 1500);
  }

  /* ---------- login va parol (mavjud hisoblar, xodimlar 2FA) ---------- */
  function password() {
    form.innerHTML = '<h1></h1><form class="pw" style="margin-top:22px"><div class="field"><label></label><input class="inp" name="u" autocomplete="username" required></div><div class="field"><label></label><input class="inp" name="p" type="password" autocomplete="current-password" required></div>' +
      '<p class="msg err" id="msg"></p><button class="pill big"></button></form><button class="lnk" id="back" style="margin-top:16px"></button>';
    $('h1', form).textContent = L.pw;
    var labs = form.querySelectorAll('label'); labs[0].textContent = L.user; labs[1].textContent = L.pass;
    $('.pw .pill', form).textContent = L.enter; $('#back').textContent = L.back; $('#back').onclick = function () { home(); };
    $('.pw', form).onsubmit = async function (e) {
      e.preventDefault();
      var r = await post('/api/login', { username: this.u.value.trim(), password: this.p.value });
      if (r.ok && r.data.twofa) return twofa(r.data.token);
      if (r.ok && r.data.success) { location.href = dest(); return; }
      $('#msg').textContent = r.data.error || r.data.message || L.err;
    };
  }
  function twofa(tok) {
    form.innerHTML = '<h1>2FA</h1><p class="sub"></p><form class="pw"><div class="field"><input class="inp" name="c" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div><p class="msg err" id="msg"></p><button class="pill big"></button></form>';
    $('.sub', form).textContent = L.twofa; $('.pw .pill', form).textContent = L.verify;
    $('.pw', form).onsubmit = async function (e) {
      e.preventDefault();
      var r = await post('/api/login/2fa', { token: tok, code: this.c.value.trim() });
      if (r.ok && r.data.success) { location.href = dest(); return; }
      $('#msg').textContent = r.data.error || L.err;
    };
  }

  /* ---------- boshlash ---------- */
  var gerr = params.get('error');
  home(gerr && L.gerr[gerr] ? L.gerr[gerr] : '');
  fetch('/api/auth/options', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) { googleOn = !!(d && d.google); tgLogin = d && d.telegram && d.telegram.botId ? d.telegram : null; loadTgScript(); if (!token) home(gerr && L.gerr[gerr] ? L.gerr[gerr] : ''); }).catch(function () {});
  // allaqachon kirgan bo'lsa — to'g'ri ilovaga
  fetch('/api/user-info', { credentials: 'same-origin' }).then(function (r) { if (r.ok && !params.get('stay')) location.replace(dest()); }).catch(function () {});
})();
