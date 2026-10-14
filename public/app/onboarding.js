/* Tariflar oynasi va to'lov qadami.
   - Yangi foydalanuvchi (tarif yo'q): oyna majburiy, orqada dashboard xira va faol emas.
   - Sinov tugaganda yoki limit tugaganda: oyna yopiladigan holda chiqadi.
   - To'lov: usullar va QR joyi tayyor. Onlayn to'lov ulanmaguncha so'rov /api/tariff/interest orqali yuboriladi,
     tarifni administrator faollashtiradi (POST /api/admin/tariff/grant); oyna /api/tariff/me ni kuzatib, o'zi yangilanadi.
   - Haqiqiy to'lov ulanganda: JAI.pay.provider = async function (plan, method) { ... } ni qo'shing (pastga qarang). */
(function (G) {
  'use strict';
  var J = G.JAI, t = J.t, esc = J.esc;
  var ORDER = ['sinov', 'silver', 'gold', 'platinum'];
  var CONTACT = 'https://t.me/juristAI_registration_bot';
  var METHODS = [
    { id: 'click', name: 'Click', sub: 'click.uz', ic: 'C' },
    { id: 'payme', name: 'Payme', sub: 'payme.uz', ic: 'P' },
    { id: 'paynet', name: 'Paynet', sub: 'paynet.uz', ic: 'Pn' },
    { id: 'qr', name: null, sub: null, ic: 'QR' }
  ];
  J.pay = J.pay || { provider: null };
  var current = null;   // ochiq oyna

  function feats(k, p) {
    var q = p.quotas || {}, f = [];
    if (q.chat) f.push(t('pl.f.chat', { n: J.fmtNum(q.chat) }));
    if (q.analysis) f.push(t('pl.f.analysis', { n: q.analysis }));
    if (q.opinion) f.push(t('pl.f.opinion', { n: q.opinion }));
    if (q.draft) f.push(t('pl.f.draft', { n: q.draft }));
    if (J.VOICE_MIN && J.VOICE_MIN[k]) f.push(t('pl.f.voice', { n: J.VOICE_MIN[k] }));   // ovozli yozuv: daqiqalar STT sinovidan keyin aniqlanadi
    if (p.workspace && p.workspace.create) f.push(t('pl.f.ws.create'));
    else if (p.workspace && p.workspace.join) f.push(t('pl.f.ws.join'));
    if (k === 'sinov') { f.push(t('pl.f.src')); f.push(t('pl.f.once')); }
    return f;
  }
  function planCard(k, p, opts) {
    var b = J.balance(), cur = J.planKey() === k && (b.kind === 'paid' || b.kind === 'trial');
    var free = k === 'sinov';
    var trialOk = free && (b.kind === 'none' ? b.trialAvailable !== false : false);
    var label = cur ? t('pl.cur') : (free ? t('pl.start') : t('pl.soon'));
    var btn = free
      ? (cur ? '' : '<span class="pill' + (trialOk ? '' : ' ghost') + '"' + (trialOk ? '' : ' aria-disabled="true"') + '>' + esc(trialOk ? t('pl.trial') : t('pl.trial.used')) + (trialOk ? '<i>→</i>' : '') + '</span>')
      : '<span class="pill ghost">' + esc(t('pl.buy')) + '</span>';
    return '<button type="button" class="plan' + (free ? ' free' : '') + (cur ? ' cur' : '') + '" data-plan="' + k + '"' + (free && !trialOk ? ' data-off="1"' : '') + '>' +
      '<span class="soon">' + esc(label) + '</span><h3>' + esc(p.label || k) + '</h3>' +
      '<span class="price">' + (free ? esc(t('pl.free')) : '<span class="num">' + J.fmtNum(p.priceUzs) + '</span><small>' + esc(t('pl.cur.som')) + '</small>') + '</span>' +
      '<span class="per">' + esc(free ? t('pl.once') : t('pl.days', { d: p.durationDays || p.periodDays || 30 })) + '</span>' +
      '<p>' + esc(t('pl.d.' + k)) + '</p><ul>' + feats(k, p).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' + btn + '</button>';
  }
  function methodsRow() {
    return '<div class="pay-ms"><span>' + esc(t('pl.methods')) + '</span>' + METHODS.map(function (m) {
      return '<span class="pm"><span class="ic">' + m.ic + '</span>' + esc(m.name || t('pay.qr')) + '</span>';
    }).join('') + '</div><p class="muted" style="font-size:12.5px;margin-top:10px">' + esc(t('pl.unit')) + '</p>';
  }

  /** opts: {forced:boolean, ended:boolean, message?:string} */
  J.openPlans = async function (opts) {
    opts = opts || {};
    if (current) current.close();
    if (!J.S.plans) { var p = await J.api('/api/tariff/plans', { allow401: true }); if (p.ok) { J.S.plans = p.data.plans; J.S.paymentsEnabled = !!p.data.paymentsEnabled; } }
    if (!J.S.plans) { J.toast(J.t('err.generic')); return; }
    if (opts.forced) document.body.classList.add('locked');
    var m = current = J.modal({ closable: !opts.forced, onClose: function () { current = null; if (!J.needsPlan()) document.body.classList.remove('locked'); } });
    showPlans(m, opts);
  };

  function showPlans(m, opts) {
    var plans = J.S.plans;
    m.body.innerHTML = '<div class="kicker">JuristAI</div><h2 style="margin-top:8px">' + esc(t('pl.title')) + '</h2>' +
      '<p class="sub">' + esc(opts.message || (opts.ended ? t('pl.sub.ended') : t('pl.sub'))) + '</p>' +
      '<div class="plans">' + ORDER.filter(function (k) { return plans[k]; }).map(function (k) { return planCard(k, plans[k], opts); }).join('') + '</div>' + methodsRow();
    J.$$('.plan', m.body).forEach(function (el) {
      el.onclick = function () {
        var k = el.dataset.plan;
        if (k === 'sinov') { if (el.dataset.off || el.classList.contains('cur')) return; startTrial(m, el); }
        else showPay(m, k, opts);
      };
    });
  }

  async function startTrial(m, el) {
    var pill = J.$('.pill', el); pill.innerHTML = '<span class="spin"></span>';
    var r = await J.api('/api/tariff/select', { method: 'POST', body: { plan: 'sinov' } });
    if (!r.ok) { pill.textContent = t('pl.trial.used'); pill.classList.add('ghost'); el.dataset.off = '1'; J.toast(J.errMsg(r.data)); return; }
    await J.refreshTariff();
    document.body.classList.remove('locked');
    m.close(); J.toast(t('trial.ok'));
  }

  function showPay(m, k, opts) {
    var p = J.S.plans[k], sel = 'click';
    m.body.innerHTML = '<button class="chip" data-a="back" style="margin-bottom:16px">' + J.icon('back') + esc(t('pay.back')) + '</button>' +
      '<h2>' + esc(t('pay.title')) + '</h2>' +
      '<div class="pay">' +
        '<div><div class="pay-sum">' +
          '<div class="ln"><span class="muted">' + esc(t('pay.plan')) + '</span><b style="font-weight:500">' + esc(p.label) + '</b></div>' +
          '<div class="ln"><span class="muted">' + esc(t('pay.period')) + '</span><span>' + esc(t('pl.days', { d: p.durationDays || p.periodDays || 30 })) + '</span></div>' +
          '<div class="ln"><span class="muted">' + esc(t('pay.total')) + '</span><span class="tot num">' + J.fmtNum(p.priceUzs) + ' ' + esc(t('pl.cur.som')) + '</span></div>' +
        '</div><ul class="muted" style="font-size:13.5px;margin:14px 0 0;padding-left:18px">' + feats(k, p).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
        '<div><div class="kicker" style="margin-bottom:10px">' + esc(t('pay.method')) + '</div><div class="methods">' + METHODS.map(function (x) {
          return '<button type="button" class="method' + (x.id === sel ? ' sel' : '') + '" data-m="' + x.id + '"><span class="ic" style="background:var(--fg);color:var(--bg)">' + x.ic + '</span><span><b>' + esc(x.name || t('pay.qr')) + '</b><small>' + esc(x.sub || t('pay.qr.d')) + '</small></span></button>';
        }).join('') + '</div><div class="qr" hidden><div class="qr-box">' + esc(t('pay.qr.box')) + '</div><p>' + esc(t('pay.qr.d')) + '</p></div></div>' +
      '</div>' +
      '<div class="pay-f"><small>' + esc(J.S.paymentsEnabled && J.pay.provider ? '' : t('pay.note')) + '</small><button class="pill" data-a="go">' + esc(t('pay.go')) + '<i>→</i></button></div>';
    J.$('[data-a=back]', m.body).onclick = function () { showPlans(m, opts); };
    J.$$('.method', m.body).forEach(function (b) {
      b.onclick = function () {
        sel = b.dataset.m; J.$$('.method', m.body).forEach(function (x) { x.classList.toggle('sel', x === b); });
        J.$('.qr', m.body).hidden = sel !== 'qr';
      };
    });
    J.$('[data-a=go]', m.body).onclick = async function () {
      var go = this; go.disabled = true;
      if (J.S.paymentsEnabled && typeof J.pay.provider === 'function') {
        try { await J.pay.provider(k, sel); } catch (e) { J.toast(J.t('err.generic')); }   // to'lov sahifasiga o'tadi yoki QR ko'rsatadi
        go.disabled = false; return;
      }
      var r = await J.api('/api/tariff/interest', { method: 'POST', body: { plan: k, method: sel } });
      if (!r.ok) { go.disabled = false; J.toast(J.errMsg(r.data)); return; }
      showSent(m, k, opts);
    };
  }

  function showSent(m, k, opts) {
    var b = J.balance(), trialOk = b.kind === 'none' && b.trialAvailable !== false;
    m.el.querySelector('.modal').classList.add('sm');
    m.body.innerHTML = '<div class="done-ic">' + J.icon('check') + '</div><h2>' + esc(t('pay.sent')) + '</h2><p class="sub">' + esc(t('pay.sent.d')) + '</p>' +
      '<p class="muted" style="display:flex;align-items:center;gap:8px;margin-top:16px;font-size:13.5px"><span class="spin"></span>' + esc(t('pay.wait')) + '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:20px"><a class="pill" href="' + CONTACT + '" target="_blank" rel="noopener">' + esc(t('pay.tg')) + '</a>' +
      (trialOk ? '<button class="pill ghost" data-a="trial">' + esc(t('pl.trial')) + '</button>' : '') +
      '<button class="pill ghost" data-a="back">' + esc(t('pay.back')) + '</button></div>';
    J.$('[data-a=back]', m.body).onclick = function () { stop(); m.el.querySelector('.modal').classList.remove('sm'); showPlans(m, opts); };
    var tb = J.$('[data-a=trial]', m.body); if (tb) tb.onclick = function () { stop(); var fake = J.h('<div><span class="pill"></span></div>'); startTrial(m, fake); };
    var iv = setInterval(async function () {
      if (!document.body.contains(m.el)) return stop();
      var r = await J.api('/api/tariff/me'); if (!r.ok) return;
      J.S.tariff = r.data; var bb = r.data.balance || {};
      if (bb.kind === 'paid') { stop(); J.emit('tariff'); showDone(m); }
    }, 15000);
    function stop() { clearInterval(iv); }
  }

  function showDone(m) {
    var b = J.balance();
    m.body.innerHTML = '<div class="done-ic">' + J.icon('check') + '</div><h2>' + esc(t('pay.done')) + '</h2><p class="sub">' + esc(t('pay.done.d', { p: J.planLabel(b.plan), d: J.fmtDate(b.endsAt) })) + '</p>' +
      '<div style="margin-top:20px"><button class="pill" data-a="ok">' + esc(t('pay.open')) + '<i>→</i></button></div>';
    J.$('[data-a=ok]', m.body).onclick = function () { document.body.classList.remove('locked'); m.close(); };
  }

  /** Server limit javobi (429/402) kelganda: tegishli oynani ochadi. */
  J.handleLimit = function (data) {
    data = data || {};
    if (data.code === 'CHANNEL_REQUIRED' || data.code === 'SURVEY_REQUIRED') { J.openGate(data); return true; }
    if (data.code === 'QUOTA_EXCEEDED' || data.code === 'PLAN_REQUIRED' || data.code === 'NOT_IN_PLAN' || data.upgradeUrl) {
      J.refreshTariff();
      J.openPlans({ ended: data.plan === 'sinov', message: data.message });
      return true;
    }
    return false;
  };

  /** Bepul foydalanish sharti: kanalga obuna yoki so'rovnoma. */
  J.openGate = async function () {
    var r = await J.api('/api/free-access/status'); var st = r.ok ? r.data : {};
    var survey = st.state === 'survey_required';
    var m = J.modal({ cls: 'sm', html: '<h2>' + esc(t('limit.title')) + '</h2><p class="sub">' + esc(survey ? t('gate.survey') : t('gate.channel')) + '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:20px">' +
      (survey ? '<a class="pill" href="/dashboard.html#ai">' + esc(t('gate.survey.btn')) + '</a>'
              : '<a class="pill" target="_blank" rel="noopener" href="' + esc(st.channelUrl || CONTACT) + '">' + esc(t('gate.open')) + '</a><button class="pill ghost" data-a="chk">' + esc(t('gate.check')) + '</button>') +
      '</div>' });
    var c = J.$('[data-a=chk]', m.body);
    if (c) c.onclick = async function () { var s = await J.api('/api/free-access/status'); if (s.ok && s.data.state !== 'channel_required') { m.close(); J.toast('✓'); } else J.toast(t('gate.channel')); };
  };
})(window);
