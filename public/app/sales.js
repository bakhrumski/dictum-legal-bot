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
      task: 'Vazifa', openTask: 'Vazifa ochish', taskOpen: 'Ochilgan', taskMade: 'Vazifa Workspace’da ochildi', fbCount: 'Fikr',
      fb: 'Mijozlar fikri', fbLead: 'Mijoz botda «💬 Fikr bildirish» yoki /fikr bilan yuborgan xabarlar. Har biri pilot Workspace’da mijoz vazifasining kichik vazifasi. Teg qo‘ying; vazifa «Bajarildi» bo‘lgach, qisqa javob yozib tasdiqlang — bot mijozga bir marta yuboradi.',
      fbNone: 'Hali fikr yo‘q.', tag: 'Teg', tags: { xato: 'Xato', chalkash: 'Chalkash', yangi_imkoniyat: 'Yangi imkoniyat', narx: 'Narx', untagged: 'Tegsiz' }, voice: 'ovozli',
      reply: 'Javob', replyPh: 'Mijozga qisqa javob (600 belgigacha)…', send: 'Tasdiqlab yuborish', sendQ: 'Bu javob mijozga Telegram’da bir marta yuboriladi. Tasdiqlaysizmi?', notDone: 'Javob vazifa «Bajarildi» bo‘lgach yoziladi',
      rs: { sent: 'Yuborildi', opted_out: 'Mijoz javoblarni o‘chirgan', no_chat: 'Telegram ulanmagan', failed: 'Yuborilmadi' }, week: 'Shu hafta', wkFb: 'Fikr', wkCl: 'Mijoz',
      note: 'Mijoz kasbini botda o‘zi tanlaydi; noto‘g‘ri bo‘lsa, shu yerda tuzating. Yurist, buxgalter, HR va tadbirkorga pilot avtomatik ochiladi (jami 20, sizga 4 tagacha), qolganini master tasdiqlaydi. Siz huquq, tarif yoki chegirma bera olmaysiz.' },
    ru: { title: 'Мои клиенты', lead: 'Клиенты, пришедшие по вашей ссылке. Тексты вопросов и ответов не видны — это конфиденциально.', links: 'Ссылка', web: 'Сайт', tg: 'Telegram-бот', copy: 'Копировать',
      copied: 'Скопировано', demo: 'Ваш демо-аккаунт', noDemo: 'Демо-аккаунт ещё не открыт — попросите мастера.', name: 'Клиент', reg: 'Регистрация', pilot: 'Пилот', used: 'Использовано единиц', paid: 'Платный', none: 'Клиентов пока нет.',
      st: { pending: 'Ожидает', approved: 'В пилоте', declined: 'Отклонён', '': '—' }, until: 'до', yes: 'Да', no: '—', auto: 'авто',
      type: 'Кто', types: { lawyer: 'Юрист / адвокат', accountant: 'Бухгалтер', hr: 'HR / кадры', business: 'Предприниматель', user: 'Другое', '': '—' }, typeSaved: 'Сохранено', typeOpened: 'Сохранено — пилот открыт',
      task: 'Задача', openTask: 'Открыть задачу', taskOpen: 'Открыта', taskMade: 'Задача открыта в Workspace', fbCount: 'Отзывы',
      fb: 'Отзывы клиентов', fbLead: 'Сообщения, отправленные клиентом в боте через «💬 Fikr bildirish» или /fikr. Каждое — подзадача задачи клиента в пилотном Workspace. Поставьте тег; когда задача «Выполнена», напишите короткий ответ и подтвердите — бот отправит его клиенту один раз.',
      fbNone: 'Отзывов пока нет.', tag: 'Тег', tags: { xato: 'Ошибка', chalkash: 'Непонятно', yangi_imkoniyat: 'Новая возможность', narx: 'Цена', untagged: 'Без тега' }, voice: 'голос',
      reply: 'Ответ', replyPh: 'Короткий ответ клиенту (до 600 знаков)…', send: 'Подтвердить и отправить', sendQ: 'Ответ будет отправлен клиенту в Telegram один раз. Подтверждаете?', notDone: 'Ответ — после статуса «Выполнена»',
      rs: { sent: 'Отправлено', opted_out: 'Клиент отключил ответы', no_chat: 'Telegram не привязан', failed: 'Не отправлено' }, week: 'Эта неделя', wkFb: 'Отзывы', wkCl: 'Клиенты',
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
        (cl.length ? '<div class="sl-tbl"><table><thead><tr><th>' + esc(s('name')) + '</th><th>' + esc(s('type')) + '</th><th>' + esc(s('reg')) + '</th><th>' + esc(s('pilot')) + '</th><th>' + esc(s('used')) + '</th><th>' + esc(s('paid')) + '</th><th>' + esc(s('fbCount')) + '</th><th>' + esc(s('task')) + '</th></tr></thead><tbody>' +
          cl.map(function (c) {
            var st = s('st')[c.pilot_status || ''] || c.pilot_status;
            if (c.pilot_status === 'approved' && c.pilot_ends_at) st += ' · ' + J.fmtDate(c.pilot_ends_at) + ' ' + s('until');
            if (c.pilot_status === 'approved' && c.pilot_auto) st += ' · ' + s('auto');
            var ty = s('types'), sel = '<select class="sl-type" data-ty="' + esc(c.id) + '" aria-label="' + esc(s('type')) + '">' + (c.client_type ? '' : '<option value="">—</option>') +
              ['lawyer', 'accountant', 'hr', 'business', 'user'].map(function (k) { return '<option value="' + k + '"' + (c.client_type === k ? ' selected' : '') + '>' + esc(ty[k]) + '</option>'; }).join('') + '</select>';
            return '<tr><td>' + esc(c.full_name || '') + '</td><td>' + sel + '</td><td class="num">' + esc(J.fmtDate(c.registered_at)) + '</td><td>' + esc(st) + '</td><td class="num">' + esc(String(c.units_used || 0)) + '</td><td>' + esc(c.paid ? s('yes') : s('no')) + '</td><td class="num">' + esc(String(c.feedback || 0)) + '</td><td>' +
              (c.task_id ? '<a href="#/jamoa">' + esc(s('taskOpen')) + '</a>' : (c.pilot_status === 'approved' ? '<button class="pill ghost sm" type="button" data-task="' + esc(c.id) + '">' + esc(s('openTask')) + '</button>' : '—')) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty-state" style="margin-top:14px">' + esc(s('none')) + '</div>');
      $$('[data-task]', body).forEach(function (el) {
        el.onclick = async function () {
          el.disabled = true;
          var x = await J.api('/api/sales/clients/' + encodeURIComponent(el.dataset.task) + '/task', { method: 'POST', body: {} });
          el.disabled = false;
          if (!x.ok) { J.toast(J.errMsg(x.data), 6000); return; }
          J.toast(s('taskMade')); J.viewSales();
        };
      });
      var fbHost = document.createElement('div'); body.appendChild(fbHost); J.pilotFeedback(fbHost);
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

  /* Fikrlar (stage 3): the agent's own clients' feedback (a master: all) - tag, reply once the sub-task is done, the weekly view.
     Server: /api/sales/feedback* (src/sales/pilot-workspace.js). Also used on Boshqaruv → CustDev pilot. */
  J.pilotFeedback = function (host) {
    host.innerHTML = '<div class="card" style="margin-top:16px"><h4>' + esc(s('fb')) + '</h4><p class="muted" style="font-size:13px">' + esc(s('fbLead')) + '</p><div class="pf-wk"></div><div class="pf-l"><div class="skel" style="width:50%;margin:10px 0"></div></div></div>';
    J.api('/api/sales/feedback/weekly?days=7').then(function (r) {
      if (!r.ok || !(r.data.rows || []).length) return;
      var tg = s('tags');
      $('.pf-wk', host).innerHTML = '<div class="sl-tbl" style="margin:8px 0 14px"><table><thead><tr><th>' + esc(s('week')) + '</th><th>' + esc(s('wkFb')) + '</th><th>' + esc(s('wkCl')) + '</th></tr></thead><tbody>' +
        r.data.rows.map(function (x) { return '<tr><td>' + esc(tg[x.tag] || x.tag) + '</td><td class="num">' + esc(String(x.feedback)) + '</td><td class="num">' + esc(String(x.clients)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    });
    J.api('/api/sales/feedback').then(function (r) {
      var box = $('.pf-l', host);
      if (!r.ok) { box.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      var list = r.data.feedback || [], tg = s('tags');
      if (!list.length) { box.innerHTML = '<div class="empty-state">' + esc(s('fbNone')) + '</div>'; return; }
      box.innerHTML = list.map(function (f) {
        var tagSel = '<select class="pf-tag" data-tag="' + esc(f.id) + '" aria-label="' + esc(s('tag')) + '">' + (f.tag ? '' : '<option value="">' + esc(s('tag')) + '…</option>') +
          ['xato', 'chalkash', 'yangi_imkoniyat', 'narx'].map(function (k) { return '<option value="' + k + '"' + (f.tag === k ? ' selected' : '') + '>' + esc(tg[k]) + '</option>'; }).join('') + '</select>';
        var rep = f.reply_confirmed_at
          ? '<p class="muted" style="font-size:13px;margin:8px 0 0"><b>' + esc(s('reply')) + ':</b> ' + esc(f.reply_text || '') + ' · ' + esc((s('rs') || {})[f.reply_status] || '') + '</p>'
          : (f.task_status === 'done'
            ? '<div class="pf-rep" style="margin-top:8px">' + (f.reply_status === 'failed' ? '<p class="muted" style="font-size:12.5px;margin:0 0 6px">' + esc((s('rs') || {}).failed) + ' — ' + esc(f.reply_text || '') + '</p>' : '') + '<textarea maxlength="600" rows="2" placeholder="' + esc(s('replyPh')) + '" data-rt="' + esc(f.id) + '" style="width:100%">' + esc(f.reply_status === 'failed' ? (f.reply_text || '') : '') + '</textarea><button class="pill sm" type="button" data-send="' + esc(f.id) + '" style="margin-top:6px">' + esc(s('send')) + '</button></div>'
            : '<p class="muted" style="font-size:12.5px;margin:8px 0 0">' + esc(s('notDone')) + '</p>');
        return '<div class="pf-it" style="border-top:1px solid var(--line, rgba(0,0,0,.08));padding:12px 0">' +
          '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><small class="muted">' + esc(J.fmtDate(f.created_at)) + ' · ' + esc(f.full_name || '') + (f.source === 'voice' ? ' · 🎙 ' + esc(s('voice')) : '') + (f.agent_name ? ' · ' + esc(f.agent_name) : '') + '</small>' + tagSel + '</div>' +
          '<p style="margin:6px 0 0;white-space:pre-wrap">' + esc(f.text || '') + '</p>' + rep + '</div>';
      }).join('');
      $$('[data-tag]', box).forEach(function (el) {
        el.onchange = async function () {
          if (!el.value) return;
          el.disabled = true;
          var x = await J.api('/api/sales/feedback/' + encodeURIComponent(el.dataset.tag) + '/tag', { method: 'POST', body: { tag: el.value } });
          el.disabled = false;
          if (!x.ok) J.toast(J.errMsg(x.data), 6000); else J.pilotFeedback(host);
        };
      });
      $$('[data-send]', box).forEach(function (b) {
        b.onclick = async function () {
          var ta = $('[data-rt="' + b.dataset.send + '"]', box), text = (ta && ta.value || '').trim();
          if (!text) { if (ta) ta.focus(); return; }
          if (!(await J.confirm(s('sendQ'), s('send')))) return;
          b.disabled = true;
          var x = await J.api('/api/sales/feedback/' + encodeURIComponent(b.dataset.send) + '/reply', { method: 'POST', body: { text: text, confirmed: true } });
          b.disabled = false;
          if (!x.ok) { J.toast(J.errMsg(x.data), 6000); return; }
          J.toast((s('rs') || {})[x.data.status] || ''); J.pilotFeedback(host);
        };
      });
    });
  };

  J.route(/^\/mijozlarim$/, function () { J.viewSales(); });
})(window);
