/* JuristAI — Platforma hisobini Telegram'ga ulash taklifi.
   Backend (mavjud): GET /api/free-access/telegram-link → {code, botUsername, deepLink}
                    GET /api/free-access/telegram-status → {telegramLinked, ...}
   Foydalanuvchi o'zi ulaydi: havola botni ochadi (start=ulink_<code>), bot hisobni bog'laydi. */
(function (w) {
  'use strict';
  var J = w.JAI, t = J.t, esc = J.esc, $ = J.$;
  var HIDE = 'jai-tg-hide';
  J.tg = { linked: null, bot: J.bots.legal, polling: false };

  J.tg.check = async function () {
    var r = await J.api('/api/free-access/telegram-status', { allow401: true });
    J.tg.linked = r.ok ? !!(r.data && r.data.telegramLinked) : null;
    return J.tg.linked;
  };

  /* Havolani olish → botni yangi oynada ochish → ulanishini kutish */
  J.tg.link = async function (onDone) {
    var win = w.open('', '_blank');           // popup bloklanmasligi uchun bosish paytida ochiladi
    var r = await J.api('/api/free-access/telegram-link');
    if (!r.ok || !r.data || !r.data.deepLink) { if (win) win.close(); J.toast(t('tg.err')); return; }
    if (r.data.botUsername) J.tg.bot = r.data.botUsername;
    if (win) win.location.href = r.data.deepLink; else w.location.href = r.data.deepLink;
    J.tg.wait(onDone);
  };
  J.tg.wait = function (onDone) {
    if (J.tg.polling) return; J.tg.polling = true;
    document.dispatchEvent(new Event('jai-tg'));
    var n = 0;
    (function tick() {
      setTimeout(async function () {
        n++;
        var ok = await J.tg.check();
        if (ok) { J.tg.polling = false; J.toast(t('tg.done')); document.dispatchEvent(new Event('jai-tg')); if (onDone) onDone(); return; }
        if (n < 72) tick(); else { J.tg.polling = false; document.dispatchEvent(new Event('jai-tg')); }   // ~3 daqiqa
      }, 2500);
    })();
  };

  function feats() {
    return '<ul class="tg-f">' + t('tg.feats').map(function (x) { return '<li>' + J.icon('check') + '<span>' + esc(x) + '</span></li>'; }).join('') + '</ul>';
  }
  function actions(compact) {
    if (J.tg.linked) return '<a class="pill ghost" href="https://t.me/' + esc(J.tg.bot || J.bots.legal) + '" target="_blank" rel="noopener">' + esc(t('tg.open')) + '<i>→</i></a>';
    if (J.tg.polling) return '<button class="pill ghost" disabled><span class="spin"></span> ' + esc(t('tg.waiting')) + '</button>';
    return '<button class="pill" data-a="tg-link">' + esc(t('tg.btn')) + '<i>→</i></button>' + (compact ? '<button class="pill ghost" data-a="tg-more">' + esc(t('tg.more')) + '</button>' : '');
  }
  function bind(el, rerender) {
    var b = $('[data-a=tg-link]', el); if (b) b.onclick = function () { J.tg.link(rerender); };
    var m = $('[data-a=tg-more]', el); if (m) m.onclick = J.tg.info;
  }

  /* Batafsil oyna */
  J.tg.info = function () {
    var md = J.modal({ cls: 'sm', html: '' });
    function draw() {
      md.body.innerHTML = '<div class="tg-ic">' + J.icon('tg') + '</div><h3 style="font-size:22px;margin:14px 0 6px">' + esc(t('tg.title')) + '</h3><p class="muted" style="font-size:14px">' + esc(t('tg.d')) + '</p>' + feats() +
        '<ol class="tg-steps">' + t('tg.steps').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' +
        '<div class="tg-act">' + (J.tg.linked ? '<span class="tg-ok">' + J.icon('check') + esc(t('tg.linked')) + '</span>' : '') + actions(false) + '</div>';
      bind(md.body, draw);
    }
    draw();
    var h = function () { if (document.body.contains(md.el)) draw(); else document.removeEventListener('jai-tg', h); };
    document.addEventListener('jai-tg', h);
  };

  /* Bosh sahifadagi taklif (yopsa bo'ladi); ulangan bo'lsa ko'rinmaydi */
  J.tg.banner = async function (host) {
    try { if (localStorage.getItem(HIDE)) return; } catch (e) {}
    if (J.tg.linked === null) await J.tg.check();
    if (J.tg.linked !== false || !document.body.contains(host)) return;
    var el = J.h('<div class="tg-ban"><span class="tg-ic">' + J.icon('tg') + '</span><div class="tg-tx"><b></b><small></small></div><div class="tg-act"></div><button class="ib tg-x" aria-label="' + esc(t('close')) + '">' + J.icon('x') + '</button></div>');
    $('b', el).textContent = t('tg.title'); $('small', el).textContent = t('tg.short');
    function draw() { if (J.tg.linked) { el.remove(); return; } $('.tg-act', el).innerHTML = actions(true); bind(el, draw); }
    draw();
    $('.tg-x', el).onclick = function () { try { localStorage.setItem(HIDE, '1'); } catch (e) {} el.remove(); };
    document.addEventListener('jai-tg', function () { if (document.body.contains(el)) draw(); });
    host.appendChild(el);
  };

  /* Hisob sahifasidagi karta */
  J.tg.card = async function (host) {
    var el = J.h('<div class="card tg-card"><div class="tg-head"><span class="tg-ic">' + J.icon('tg') + '</span><div><h4 style="margin:0"></h4><small class="muted tg-st"></small></div></div><p class="muted" style="font-size:14px;margin-top:10px"></p><div class="tg-fw"></div><div class="tg-act"></div></div>');
    $('h4', el).textContent = t('tg.title'); $('p', el).textContent = t('tg.d');
    host.appendChild(el);
    async function draw() {
      $('.tg-st', el).innerHTML = J.tg.linked ? '<span class="tg-ok">' + J.icon('check') + esc(t('tg.linked')) + '</span>' : esc(J.tg.linked === false ? t('tg.notlinked') : '…');
      $('.tg-fw', el).innerHTML = feats();
      $('.tg-act', el).innerHTML = J.tg.linked === null ? '' : actions(false);
      bind(el, draw);
    }
    draw();
    if (J.tg.linked === null) { await J.tg.check(); draw(); }
    document.addEventListener('jai-tg', function () { if (document.body.contains(el)) draw(); });
  };
})(window);
