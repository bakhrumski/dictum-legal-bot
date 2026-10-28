/* Mijozlarim (2026-10-28, CustDev pilot): shogird-yurist agent o'z offer linki va o'z mijozlarini ko'radi —
   ism, ro'yxatdan o'tgan sana, pilot holati, ishlatilgan birliklar. Savol va javob matnlari ko'rinmaydi.
   Agent huquq, tarif yoki chegirma bermaydi: pilotni master tasdiqlaydi. Server: GET /api/sales/me (src/sales/routes.js). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { title: 'Mijozlarim', lead: 'Offer linkingiz orqali kelgan mijozlar. Savol va javob matnlari mijoz maxfiyligi uchun ko‘rinmaydi.', links: 'Offer link', web: 'Sayt', tg: 'Telegram bot', copy: 'Nusxa',
      copied: 'Nusxa olindi', demo: 'Demo akkauntingiz', noDemo: 'Demo akkaunt hali ochilmagan — masterdan so‘rang.', name: 'Mijoz', reg: 'Ro‘yxatdan o‘tgan', pilot: 'Pilot', used: 'Ishlatilgan birlik', paid: 'Pullik', none: 'Hali mijoz yo‘q.',
      st: { pending: 'Kutilmoqda', approved: 'Pilotda', declined: 'Rad etilgan', '': '—' }, until: 'gacha', yes: 'Ha', no: '—', auto: 'avto',
      type: 'Kim', types: { lawyer: 'Yurist / advokat', accountant: 'Buxgalter', hr: 'HR / kadrlar', business: 'Tadbirkor', user: 'Boshqa', '': '—' }, typeSaved: 'Saqlandi', typeOpened: 'Saqlandi — pilot ochildi',
      note: 'Mijoz kasbini botda o‘zi tanlaydi; noto‘g‘ri bo‘lsa, shu yerda tuzating. Yurist, buxgalter, HR va tadbirkorga pilot avtomatik ochiladi (jami 20, sizga 4 tagacha), qolganini master tasdiqlaydi. Siz huquq, tarif yoki chegirma bera olmaysiz.' },
    ru: { title: 'Мои клиенты', lead: 'Клиенты, пришедшие по вашей ссылке. Тексты вопросов и ответов не видны — это конфиденциально.', links: 'Ссылка', web: 'Сайт', tg: 'Telegram-бот', copy: 'Копировать',
      copied: 'Скопировано', demo: 'Ваш демо-аккаунт', noDemo: 'Демо-аккаунт ещё не открыт — попросите мастера.', name: 'Клиент', reg: 'Регистрация', pilot: 'Пилот', used: 'Использовано единиц', paid: 'Платный', none: 'Клиентов пока нет.',
      st: { pending: 'Ожидает', approved: 'В пилоте', declined: 'Отклонён', '': '—' }, until: 'до', yes: 'Да', no: '—', auto: 'авто',
      type: 'Кто', types: { lawyer: 'Юрист / адвокат', accountant: 'Бухгалтер', hr: 'HR / кадры', business: 'Предприниматель', user: 'Другое', '': '—' }, typeSaved: 'Сохранено', typeOpened: 'Сохранено — пилот открыт',
      note: 'Клиент сам выбирает профессию в боте; если неверно — исправьте здесь. Юристу, бухгалтеру, HR и предпринимателю пилот открывается автоматически (всего 20, вам до 4), остальных подтверждает мастер. Вы не можете давать права, тарифы или скидки.' }
  };
  function s(k) { var d = S[J.lang] || S.uz; return d[k] !== undefined ? d[k] : S.uz[k]; }
  if (G.JAI_I18N) ['uz', 'ru', 'en'].forEach(function (l) { var d = G.JAI_I18N[l] = G.JAI_I18N[l] || {}; if (d['nav.myClients'] === undefined) d['nav.myClients'] = l === 'ru' ? 'Мои клиенты' : (l === 'en' ? 'My clients' : 'Mijozlarim'); });

  // the nav item shows only for a staff account the server knows as an agent
  var asked = false;
  J.on('route', function () {
    if (asked || !J.isStaff || !J.isStaff()) return;
    asked = true;
    J.api('/api/sales/me', { allow401: true }).then(function (r) { if (r.ok) { J.salesAgent = true; if (J.redrawNav) J.redrawNav(); } });
  });

  J.viewSales = function () {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('lead')) + '</p></div></div><div class="sl-b"><div class="skel" style="width:60%;margin:14px 0"></div></div></div>');
    var body = $('.sl-b', v);
    J.api('/api/sales/me').then(function (r) {
      if (!r.ok) { body.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      var d = r.data, cl = d.clients || [];
      var link = function (k, url) { return '<div class="sl-link"><small class="muted">' + esc(s(k)) + '</small><code data-noalpha>' + esc(url) + '</code><button class="pill ghost sm" type="button" data-cp="' + esc(url) + '">' + esc(s('copy')) + '</button></div>'; };
      body.innerHTML = '<div class="card"><h4>' + esc(s('links')) + '</h4>' + link('web', d.links.web) + link('tg', d.links.telegram) +
        '<p class="muted" style="font-size:13px;margin-top:10px">' + esc(d.demo ? s('demo') + ': @' + d.demo.login : s('noDemo')) + '</p><p class="muted" style="font-size:12.5px">' + esc(s('note')) + '</p></div>' +
        (cl.length ? '<div class="sl-tbl"><table><thead><tr><th>' + esc(s('name')) + '</th><th>' + esc(s('type')) + '</th><th>' + esc(s('reg')) + '</th><th>' + esc(s('pilot')) + '</th><th>' + esc(s('used')) + '</th><th>' + esc(s('paid')) + '</th></tr></thead><tbody>' +
          cl.map(function (c) {
            var st = s('st')[c.pilot_status || ''] || c.pilot_status;
            if (c.pilot_status === 'approved' && c.pilot_ends_at) st += ' · ' + J.fmtDate(c.pilot_ends_at) + ' ' + s('until');
            if (c.pilot_status === 'approved' && c.pilot_auto) st += ' · ' + s('auto');
            var ty = s('types'), sel = '<select class="sl-type" data-ty="' + esc(c.id) + '" aria-label="' + esc(s('type')) + '">' + (c.client_type ? '' : '<option value="">—</option>') +
              ['lawyer', 'accountant', 'hr', 'business', 'user'].map(function (k) { return '<option value="' + k + '"' + (c.client_type === k ? ' selected' : '') + '>' + esc(ty[k]) + '</option>'; }).join('') + '</select>';
            return '<tr><td>' + esc(c.full_name || '') + '</td><td>' + sel + '</td><td class="num">' + esc(J.fmtDate(c.registered_at)) + '</td><td>' + esc(st) + '</td><td class="num">' + esc(String(c.units_used || 0)) + '</td><td>' + esc(c.paid ? s('yes') : s('no')) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty-state" style="margin-top:14px">' + esc(s('none')) + '</div>');
      $$('[data-ty]', body).forEach(function (el) {
        el.onchange = async function () {
          if (!el.value) return;
          el.disabled = true;
          var x = await J.api('/api/sales/clients/' + encodeURIComponent(el.dataset.ty) + '/type', { method: 'POST', body: { type: el.value } });
          el.disabled = false;
          if (!x.ok) { J.toast(J.errMsg(x.data), 6000); return; }
          J.toast(x.data.pilot && x.data.pilot.approved && x.data.pilot.reason === 'auto' ? s('typeOpened') : s('typeSaved'));
          if (x.data.pilot && x.data.pilot.reason === 'auto') J.viewSales();
        };
      });
      $$('[data-cp]', body).forEach(function (b) { b.onclick = function () { navigator.clipboard.writeText(b.dataset.cp).then(function () { J.toast(s('copied')); }); }; });
    });
  };

  J.route(/^\/mijozlarim$/, function () { J.viewSales(); });
})(window);
