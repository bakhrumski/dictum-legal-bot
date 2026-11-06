/* Mijoz portali P1b (2026-11-05, docs/design/mijoz-portali.md): sahifalar.
   Yurist: ish sahifasidagi "Mijoz portali" kartasi — bosqich, mijozlar, taklif havolasi (bir marta ko'rsatiladi),
   muddatlar ("mijoz ko'radi" belgisi bilan), mijozga izoh va Hujjatlarimdan hujjat (nusxa).
   Mijoz: #/portal (ishlari), #/portal/<id> (faqat yurist ko'rsatgani), #/portal/taklif/<token> (qo'shilish).
   AI yo'q, limit yo'q. Server: src/matters/portal.js. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var STAGES = ['received', 'in_progress', 'waiting_client', 'in_court', 'done'];
  var S = {
    uz: { nav: 'Yuristdagi ishlarim', card: 'Mijoz portali', lead: 'Mijoz faqat shu yerda belgilaganingizni ko‘radi: bosqich, belgilangan muddatlar, unga yozilgan izohlar va ulashilgan hujjatlar. Ichki yozuvlar, suhbatlar va jamoa ko‘rinmaydi.',
      stage: 'Bosqich', st: { received: 'Qabul qilindi', in_progress: 'Ishlanmoqda', waiting_client: 'Mijozdan kutilmoqda', in_court: 'Sudda / organda', done: 'Yakunlandi' },
      stC: { waiting_client: 'Sizdan kutilmoqda' }, clients: 'Mijozlar', noClients: 'Hali mijoz qo‘shilmagan.', invite: 'Mijozni taklif qilish', invites: 'Ochiq takliflar', revoke: 'Bekor qilish',
      linkH: 'Taklif havolasi', viaTg: 'Telegram orqali (mijoz ishni botda kuzatadi)', viaWeb: 'Sayt orqali', oneUse: 'Ikkalasi bitta taklif: qaysi biri birinchi ochilsa, o‘sha ishlaydi.', linkP: 'Havolani mijozga yuboring. U faqat bir marta ishlaydi, {d} gacha amal qiladi va boshqa ko‘rsatilmaydi.', copy: 'Nusxa olish', copied: 'Nusxalandi', remove: 'Chiqarish', removeQ: 'Mijoz bu ishni boshqa ko‘rmaydi. Davom etasizmi?',
      deadlines: 'Muddatlar', dlTitle: 'Nima qilinadi', dlAdd: 'Qo‘shish', visible: 'Mijoz ko‘radi', noDl: 'Muddat yo‘q.', items: 'Mijozga ko‘rsatilganlar', noItems: 'Hali hech narsa ko‘rsatilmagan.',
      notePh: 'Mijozga izoh: masalan, qaysi hujjatni olib kelish kerak', sendNote: 'Izohni ko‘rsatish', addDoc: 'Hujjatlarimdan hujjat', note: 'Izoh', doc: 'Hujjat', del: 'Olib tashlash',
      closedInv: 'Yopilgan ishga mijoz taklif qilinmaydi.', ro: 'Siz bu ishni faqat o‘qiysiz.',
      myTitle: 'Yuristdagi ishlarim', myLead: 'Yuristingiz siz bilan ulashgan ishlar: bosqichi, muddatlari, izohlari va hujjatlari.', myNone: 'Hozircha siz bilan ulashilgan ish yo‘q. Yuristingiz taklif havolasini yuborsa, shu yerda ko‘rinadi.',
      lawyer: 'Yurist', history: 'Bosqichlar tarixi', fromLawyer: 'Yuristdan', docs: 'Hujjatlar', open: 'Ochish', leave: 'Bu ishdan chiqish', leaveQ: 'Bu ishni boshqa ko‘rmaysiz. Qayta qo‘shilish uchun yuristdan yangi havola kerak bo‘ladi.',
      closed: 'Ish yopilgan. U {d} gacha shu yerda ko‘rinadi.', back: 'Ishlarim',
      invH: 'Ishga taklif', invP: '{l} sizni «{t}» ishiga mijoz sifatida taklif qildi. Qo‘shilsangiz, yurist sizga ko‘rsatgan narsalarni ko‘rasiz: ish bosqichi, muddatlar, izohlar va hujjatlar.', join: 'Qo‘shilish', joined: 'Siz ishga qo‘shildingiz', already: 'Siz bu ishga allaqachon qo‘shilgansiz.', goMatter: 'Ishni ochish' },
    ru: { nav: 'Мои дела у юриста', card: 'Портал клиента', lead: 'Клиент видит только отмеченное здесь: этап, отмеченные сроки, заметки для него и переданные документы. Внутренние записи, чаты и команда не видны.',
      stage: 'Этап', st: { received: 'Принято', in_progress: 'В работе', waiting_client: 'Ждём клиента', in_court: 'В суде / органе', done: 'Завершено' },
      stC: { waiting_client: 'Ждём вас' }, clients: 'Клиенты', noClients: 'Клиент ещё не присоединился.', invite: 'Пригласить клиента', invites: 'Открытые приглашения', revoke: 'Отменить',
      linkH: 'Ссылка-приглашение', viaTg: 'Через Telegram (клиент следит за делом в боте)', viaWeb: 'Через сайт', oneUse: 'Это одно приглашение: сработает та ссылка, которую откроют первой.', linkP: 'Отправьте ссылку клиенту. Она работает один раз, действует до {d} и больше не будет показана.', copy: 'Копировать', copied: 'Скопировано', remove: 'Убрать', removeQ: 'Клиент больше не увидит это дело. Продолжить?',
      deadlines: 'Сроки', dlTitle: 'Что сделать', dlAdd: 'Добавить', visible: 'Видит клиент', noDl: 'Сроков нет.', items: 'Показано клиенту', noItems: 'Пока ничего не показано.',
      notePh: 'Заметка клиенту: например, какой документ принести', sendNote: 'Показать заметку', addDoc: 'Документ из «Моих документов»', note: 'Заметка', doc: 'Документ', del: 'Убрать',
      closedInv: 'В закрытое дело клиента не пригласить.', ro: 'Вы только читаете это дело.',
      myTitle: 'Мои дела у юриста', myLead: 'Дела, которыми с вами поделился юрист: этап, сроки, заметки и документы.', myNone: 'Пока с вами не поделились делом. Когда юрист пришлёт ссылку, оно появится здесь.',
      lawyer: 'Юрист', history: 'История этапов', fromLawyer: 'От юриста', docs: 'Документы', open: 'Открыть', leave: 'Выйти из дела', leaveQ: 'Вы больше не увидите это дело. Чтобы вернуться, нужна новая ссылка от юриста.',
      closed: 'Дело закрыто. Оно видно здесь до {d}.', back: 'Мои дела',
      invH: 'Приглашение в дело', invP: '{l} приглашает вас в дело «{t}» как клиента. Вы увидите то, что юрист вам покажет: этап, сроки, заметки и документы.', join: 'Присоединиться', joined: 'Вы присоединились к делу', already: 'Вы уже в этом деле.', goMatter: 'Открыть дело' },
    en: { nav: 'My matters with a lawyer', card: 'Client portal', lead: 'The client sees only what you mark here: the stage, marked deadlines, notes for them and shared documents. Internal notes, chats and the team stay hidden.',
      stage: 'Stage', st: { received: 'Received', in_progress: 'In progress', waiting_client: 'Waiting for the client', in_court: 'In court / with an authority', done: 'Done' },
      stC: { waiting_client: 'Waiting for you' }, clients: 'Clients', noClients: 'No client has joined yet.', invite: 'Invite the client', invites: 'Open invites', revoke: 'Revoke',
      linkH: 'Invite link', viaTg: 'Via Telegram (the client follows the matter in the bot)', viaWeb: 'Via the site', oneUse: 'Both are one invite: whichever is opened first works.', linkP: 'Send the link to the client. It works once, until {d}, and is not shown again.', copy: 'Copy', copied: 'Copied', remove: 'Remove', removeQ: 'The client will no longer see this matter. Continue?',
      deadlines: 'Deadlines', dlTitle: 'What to do', dlAdd: 'Add', visible: 'Client sees it', noDl: 'No deadlines.', items: 'Shown to the client', noItems: 'Nothing shown yet.',
      notePh: 'A note for the client, e.g. which document to bring', sendNote: 'Show the note', addDoc: 'A document from My documents', note: 'Note', doc: 'Document', del: 'Remove',
      closedInv: 'A closed matter takes no new client.', ro: 'You only read this matter.',
      myTitle: 'My matters with a lawyer', myLead: 'Matters your lawyer shared with you: stage, deadlines, notes and documents.', myNone: 'No matter has been shared with you yet. When your lawyer sends a link, it shows here.',
      lawyer: 'Lawyer', history: 'Stage history', fromLawyer: 'From your lawyer', docs: 'Documents', open: 'Open', leave: 'Leave this matter', leaveQ: 'You will no longer see this matter. To come back you need a new link from the lawyer.',
      closed: 'The matter is closed. It stays here until {d}.', back: 'My matters',
      invH: 'Invitation to a matter', invP: '{l} invites you to the matter «{t}» as the client. You will see what the lawyer shows you: the stage, deadlines, notes and documents.', join: 'Join', joined: 'You joined the matter', already: 'You are already in this matter.', goMatter: 'Open the matter' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (typeof x === 'string' && v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  function stageName(st, client) { var c = client && s('stC')[st]; return c || s('st')[st] || st; }
  if (G.JAI_I18N) ['uz', 'ru', 'en'].forEach(function (l) { var d = G.JAI_I18N[l] = G.JAI_I18N[l] || {}; if (d['nav.portal'] === undefined) d['nav.portal'] = (S[l] || S.uz).nav; });
  var api = function (p, o) { return J.api(p, o); };
  var base = function (id) { return '/api/matters/' + encodeURIComponent(id) + '/portal'; };
  var addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // the nav item shows only for an account that is the client of some matter
  var asked = false;
  J.on('route', function () {
    if (asked) return; asked = true;
    api('/api/portal', { allow401: true }).then(function (r) { if (r.ok && (r.data.matters || []).length) { J.portalClient = true; if (J.redrawNav) J.redrawNav(); } });
  });

  function stageRow(cur, client) {
    var i = STAGES.indexOf(cur);
    return '<ol class="pt-stages">' + STAGES.map(function (st, k) {
      return '<li class="' + (k < i ? 'past' : (k === i ? 'cur' : '')) + '"><span class="pt-dot"></span><span>' + esc(stageName(st, client)) + '</span></li>';
    }).join('') + '</ol>';
  }
  function textModal(title, text) {
    var m = J.modal({ html: '<h2></h2><div class="pt-doc" data-noalpha></div><div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="pill sm ghost" type="button" data-a="cp">' + J.icon('copy') + esc(s('copy')) + '</button></div>' });
    $('h2', m.body).textContent = title;
    $('.pt-doc', m.body).textContent = String(text || '').replace(/=== PAGE (\d+) ===/g, '— $1 —');
    $('[data-a=cp]', m.body).onclick = function () { navigator.clipboard.writeText(text || '').then(function () { J.toast(s('copied')); }); };
  }

  /* ---------- the lawyer's card on the matter page ---------- */
  J.portalCard = function (host, M) {
    if (!host) return;
    async function load() {
      if (!document.body.contains(host)) return;
      var r = await api(base(M.id));
      if (!r.ok) { host.innerHTML = ''; return; } // portal off or not reachable: no card
      draw(r.data);
    }
    function draw(P) {
      var w = P.access === 'write', open = M.status === 'open';
      host.innerHTML = '<div class="card pt-card"><h4 style="margin:0">' + esc(s('card')) + '</h4><p class="muted" style="font-size:13px;margin:6px 0 12px">' + esc(s('lead')) + '</p>' +
        '<div class="field"><label>' + esc(s('stage')) + '</label>' + (w ? '<select class="inp pt-stage-sel">' + STAGES.map(function (st) { return '<option value="' + st + '"' + (st === P.stage ? ' selected' : '') + '>' + esc(stageName(st)) + '</option>'; }).join('') + '</select>' : '<div>' + esc(stageName(P.stage)) + '</div>') + '</div>' +
        '<div class="pt-sec"><b>' + esc(s('clients')) + '</b>' + (P.clients.length ? P.clients.map(function (c) {
          return '<div class="pt-row"><span class="pt-rt"></span><small class="muted">' + esc(J.fmtDate(c.joinedAt)) + '</small>' + (w ? '<button class="ib" type="button" data-rmc="' + esc(String(c.id)) + '" title="' + esc(s('remove')) + '">' + J.icon('x') + '</button>' : '') + '</div>';
        }).join('') : '<p class="muted pt-empty">' + esc(s('noClients')) + '</p>') +
        (P.invites.length ? '<small class="muted" style="display:block;margin-top:8px">' + esc(s('invites')) + '</small>' + P.invites.map(function (i) {
          return '<div class="pt-row"><span class="pt-rt muted">' + esc(i.note || '—') + '</span><small class="muted">' + esc(J.fmtDate(i.expiresAt)) + '</small>' + (w ? '<button class="pill sm ghost" type="button" data-rvi="' + esc(i.id) + '">' + esc(s('revoke')) + '</button>' : '') + '</div>';
        }).join('') : '') +
        (w ? '<div style="margin-top:10px"><button class="pill sm" type="button" data-a="ptinvite"' + (open ? '' : ' disabled title="' + esc(s('closedInv')) + '"') + '>' + J.icon('plus') + esc(s('invite')) + '</button></div>' : '') + '</div>' +
        '<div class="pt-sec"><b>' + esc(s('deadlines')) + '</b>' + (P.deadlines.length ? P.deadlines.map(function (d) {
          return '<div class="pt-row"><span class="num pt-date">' + esc(J.fmtDate(d.dueOn)) + '</span><span class="pt-rt" data-dl="' + esc(d.id) + '"></span>' +
            (w ? '<label class="pt-vis"><input type="checkbox" data-vis="' + esc(d.id) + '"' + (d.clientVisible ? ' checked' : '') + '> ' + esc(s('visible')) + '</label><button class="ib" type="button" data-rmd="' + esc(d.id) + '" title="' + esc(s('del')) + '">' + J.icon('x') + '</button>' : (d.clientVisible ? '<small class="muted">' + esc(s('visible')) + '</small>' : '')) + '</div>';
        }).join('') : '<p class="muted pt-empty">' + esc(s('noDl')) + '</p>') +
        (w ? '<div class="pt-form"><input class="inp pt-dlt" maxlength="160" placeholder="' + esc(s('dlTitle')) + '"><input class="inp pt-dld" type="date"><label class="pt-vis"><input type="checkbox" class="pt-dlv" checked> ' + esc(s('visible')) + '</label><button class="pill sm ghost" type="button" data-a="ptdl">' + esc(s('dlAdd')) + '</button></div>' : '') + '</div>' +
        '<div class="pt-sec"><b>' + esc(s('items')) + '</b>' + (P.items.length ? P.items.map(function (i) {
          return '<div class="pt-row"><span class="pt-ic">' + J.icon(i.kind === 'doc' ? 'doc' : 'pen') + '</span><span class="pt-rt" data-it="' + esc(i.id) + '"></span><small class="muted">' + esc((i.kind === 'doc' ? s('doc') + (i.pages ? ' · ' + i.pages + ' b.' : '') : s('note')) + ' · ' + J.fmtDate(i.createdAt)) + '</small>' + (w ? '<button class="ib" type="button" data-rmi="' + esc(i.id) + '" title="' + esc(s('del')) + '">' + J.icon('x') + '</button>' : '') + '</div>';
        }).join('') : '<p class="muted pt-empty">' + esc(s('noItems')) + '</p>') +
        (w ? '<div class="pt-note"><textarea class="inp" maxlength="8000" placeholder="' + esc(s('notePh')) + '"></textarea><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="pill sm" type="button" data-a="ptnote">' + esc(s('sendNote')) + '</button>' +
          (J.pickDocs ? '<button class="pill sm ghost" type="button" data-a="ptdoc">' + J.icon('folder') + esc(s('addDoc')) + '</button>' : '') + '</div></div>' : '<p class="muted" style="font-size:13px">' + esc(s('ro')) + '</p>') + '</div></div>';
      P.clients.forEach(function (c, k) { $$('.pt-sec', host)[0].querySelectorAll('.pt-row .pt-rt')[k].textContent = c.name; });
      P.deadlines.forEach(function (d) { var el = $('[data-dl="' + d.id + '"]', host); if (el) el.textContent = d.title; });
      P.items.forEach(function (i) { var el = $('[data-it="' + i.id + '"]', host); if (el) el.textContent = i.title; });
      if (!w) return;
      var sel = $('.pt-stage-sel', host);
      sel.onchange = async function () {
        sel.disabled = true;
        var q = await api(base(M.id) + '/stage', { method: 'PUT', body: { stage: sel.value } });
        sel.disabled = false;
        if (!q.ok) J.toast(J.errMsg(q.data), 5000); else J.toast(stageName(sel.value));
      };
      var ib = $('[data-a=ptinvite]', host);
      if (ib) ib.onclick = async function () {
        ib.disabled = true;
        var q = await api(base(M.id) + '/invites', { method: 'POST', body: {} });
        ib.disabled = false;
        if (!q.ok) { J.toast(J.errMsg(q.data), 6000); return; }
        // two forms of the same one-use link: Telegram first (the client joins and follows the matter in the bot), the site second
        var links = [q.data.botUrl ? { k: 'tg', label: s('viaTg'), url: q.data.botUrl } : null, { k: 'web', label: s('viaWeb'), url: location.origin + q.data.path }].filter(Boolean);
        var m = J.modal({ cls: 'sm', html: '<h2>' + esc(s('linkH')) + '</h2><p class="muted" style="font-size:13.5px"></p>' + links.map(function (l) {
          return '<div class="field" style="margin-top:10px"><label>' + esc(l.label) + '</label><div class="pt-linkrow"><input class="inp pt-link" readonly data-noalpha data-k="' + l.k + '"><button class="pill sm" type="button" data-cp="' + l.k + '">' + J.icon('copy') + esc(s('copy')) + '</button></div></div>';
        }).join('') + '<p class="muted" style="font-size:12.5px;margin-top:10px">' + esc(s('oneUse')) + '</p>' });
        $('p', m.body).textContent = s('linkP', { d: J.fmtDate(q.data.expiresAt) });
        links.forEach(function (l) {
          var inp = $('[data-k=' + l.k + ']', m.body); inp.value = l.url; inp.onfocus = function () { inp.select(); };
          $('[data-cp=' + l.k + ']', m.body).onclick = function () { navigator.clipboard.writeText(l.url).then(function () { J.toast(s('copied')); }, function () { inp.focus(); }); };
        });
        load();
      };
      $$('[data-rvi]', host).forEach(function (b) { b.onclick = async function () { var q = await api(base(M.id) + '/invites/' + encodeURIComponent(b.dataset.rvi), { method: 'DELETE' }); if (!q.ok) J.toast(J.errMsg(q.data)); load(); }; });
      $$('[data-rmc]', host).forEach(function (b) {
        b.onclick = async function () {
          if (!(await J.confirm(s('removeQ'), s('remove')))) return;
          var q = await api(base(M.id) + '/clients/' + encodeURIComponent(b.dataset.rmc), { method: 'DELETE' }); if (!q.ok) J.toast(J.errMsg(q.data)); load();
        };
      });
      $$('[data-vis]', host).forEach(function (c) {
        c.onchange = async function () { var q = await api(base(M.id) + '/deadlines/' + encodeURIComponent(c.dataset.vis), { method: 'PATCH', body: { clientVisible: c.checked } }); if (!q.ok) { J.toast(J.errMsg(q.data)); load(); } };
      });
      $$('[data-rmd]', host).forEach(function (b) { b.onclick = async function () { var q = await api(base(M.id) + '/deadlines/' + encodeURIComponent(b.dataset.rmd), { method: 'DELETE' }); if (!q.ok) J.toast(J.errMsg(q.data)); load(); }; });
      $$('[data-rmi]', host).forEach(function (b) { b.onclick = async function () { var q = await api(base(M.id) + '/items/' + encodeURIComponent(b.dataset.rmi), { method: 'DELETE' }); if (!q.ok) J.toast(J.errMsg(q.data)); load(); }; });
      $('[data-a=ptdl]', host).onclick = async function () {
        var t = $('.pt-dlt', host), d = $('.pt-dld', host);
        if (t.value.trim().length < 2) { t.focus(); return; }
        if (!d.value) { d.focus(); return; }
        var q = await api(base(M.id) + '/deadlines', { method: 'POST', body: { title: t.value.trim(), dueOn: d.value, clientVisible: $('.pt-dlv', host).checked } });
        if (!q.ok) { J.toast(J.errMsg(q.data), 5000); return; }
        load();
      };
      $('[data-a=ptnote]', host).onclick = async function () {
        var ta = $('.pt-note textarea', host);
        if (ta.value.trim().length < 2) { ta.focus(); return; }
        var q = await api(base(M.id) + '/items', { method: 'POST', body: { kind: 'note', text: ta.value.trim() } });
        if (!q.ok) { J.toast(J.errMsg(q.data), 5000); return; }
        load();
      };
      var db = $('[data-a=ptdoc]', host);
      if (db) db.onclick = function () {
        J.pickDocs({ max: 5 }).then(async function (picked) {
          for (var i = 0; i < picked.length; i++) {
            var q = await api(base(M.id) + '/items', { method: 'POST', body: { kind: 'doc', scanId: picked[i].scanId } });
            if (!q.ok) J.toast((picked[i].name || '') + ': ' + J.errMsg(q.data), 5000);
          }
          if (picked.length) load();
        });
      };
    }
    load();
  };

  /* ---------- the client's pages ---------- */
  J.viewPortal = async function () {
    J.setTitle(s('myTitle'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h1>' + esc(s('myTitle')) + '</h1><p class="muted">' + esc(s('myLead')) + '</p></div></div><div class="pt-list"><div class="skel"></div></div></div>');
    var r = await api('/api/portal');
    var box = $('.pt-list', v);
    if (!r.ok) { box.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
    var list = r.data.matters || [];
    box.innerHTML = list.length ? list.map(function (m) {
      return '<a class="mt-item go" href="#/portal/' + esc(m.id) + '"><span class="mt-ic">' + J.icon('folder') + '</span><div class="mt-it"><b data-t="' + esc(m.id) + '"></b><small>' + esc(stageName(m.stage, true) + ' · ' + s('lawyer') + ': ') + '<span data-l="' + esc(m.id) + '"></span> · ' + esc(J.fmtDate(m.stageAt)) + '</small></div></a>';
    }).join('') : '<div class="empty-state">' + esc(s('myNone')) + '</div>';
    list.forEach(function (m) { $('[data-t="' + m.id + '"]', box).textContent = m.title; $('[data-l="' + m.id + '"]', box).textContent = m.lawyerName; });
  };

  J.viewPortalMatter = async function (id) {
    J.setTitle(s('myTitle'));
    var v = J.mount('<div class="wrap narrow"><a class="mt-back" href="#/portal">' + J.icon('back') + esc(s('back')) + '</a><div class="pt-body"><div class="skel" style="width:60%;margin:20px 0"></div></div></div>');
    var body = $('.pt-body', v);
    var r = await api('/api/portal/' + encodeURIComponent(id));
    if (!r.ok) { body.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
    var P = r.data, notes = P.items.filter(function (i) { return i.kind === 'note'; }), docs = P.items.filter(function (i) { return i.kind === 'doc'; });
    J.setTitle(P.title);
    body.innerHTML = '<div class="vh"><div><h2 class="pt-title"></h2><p class="muted">' + esc(s('lawyer')) + ': <span class="pt-lawyer"></span></p></div></div>' +
      (P.status === 'closed' && P.closedAt ? '<p class="note-blue" style="font-size:13.5px">' + esc(s('closed', { d: J.fmtDate(addDays(P.closedAt, 30)) })) + '</p>' : '') +
      '<div class="card"><h4>' + esc(s('stage')) + '</h4>' + stageRow(P.stage, true) + '<small class="muted">' + esc(J.fmtDate(P.stageAt)) + '</small></div>' +
      (P.deadlines.length ? '<div class="card"><h4>' + esc(s('deadlines')) + '</h4>' + P.deadlines.map(function (d) { return '<div class="pt-row"><span class="num pt-date">' + esc(J.fmtDate(d.dueOn)) + '</span><span class="pt-rt" data-dl="' + esc(d.id) + '"></span></div>'; }).join('') + '</div>' : '') +
      (notes.length ? '<div class="card"><h4>' + esc(s('fromLawyer')) + '</h4>' + notes.map(function (n) { return '<div class="pt-msg"><p data-n="' + esc(n.id) + '"></p><small class="muted">' + esc(J.fmtDate(n.createdAt)) + '</small></div>'; }).join('') + '</div>' : '') +
      (docs.length ? '<div class="card"><h4>' + esc(s('docs')) + '</h4>' + docs.map(function (d) { return '<button type="button" class="mt-item go pt-docrow" data-doc="' + esc(d.id) + '"><span class="mt-ic">' + J.icon('doc') + '</span><div class="mt-it"><b data-noalpha></b><small>' + esc((d.pages ? d.pages + ' b. · ' : '') + J.fmtDate(d.createdAt)) + '</small></div></button>'; }).join('') + '</div>' : '') +
      (P.history.length > 1 ? '<details class="pt-hist"><summary>' + esc(s('history')) + '</summary><ul>' + P.history.map(function (h) { return '<li>' + esc(J.fmtDate(h.at) + ' — ' + stageName(h.stage, true)) + '</li>'; }).join('') + '</ul></details>' : '') +
      '<div style="margin-top:18px"><button class="pill sm ghost" type="button" data-a="leave">' + esc(s('leave')) + '</button></div>';
    $('.pt-title', body).textContent = P.title;
    $('.pt-lawyer', body).textContent = P.lawyerName;
    P.deadlines.forEach(function (d) { $('[data-dl="' + d.id + '"]', body).textContent = d.title; });
    notes.forEach(function (n) { $('[data-n="' + n.id + '"]', body).textContent = n.text; });
    docs.forEach(function (d) {
      var row = $('[data-doc="' + d.id + '"]', body); $('b', row).textContent = d.title;
      row.onclick = async function () {
        var q = await api('/api/portal/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(d.id));
        if (!q.ok) { J.toast(J.errMsg(q.data)); return; }
        textModal(d.title, q.data.text);
      };
    });
    $('[data-a=leave]', body).onclick = async function () {
      if (!(await J.confirm(s('leaveQ'), s('leave')))) return;
      var q = await api('/api/portal/' + encodeURIComponent(id) + '/leave', { method: 'POST', body: {} });
      if (!q.ok) { J.toast(J.errMsg(q.data)); return; }
      J.go('#/portal');
    };
  };

  J.viewPortalInvite = async function (token) {
    J.setTitle(s('invH'));
    var v = J.mount('<div class="wrap narrow"><div class="card pt-inv"><div class="skel"></div></div></div>');
    var box = $('.pt-inv', v);
    var r = await api('/api/portal/invite/' + encodeURIComponent(token));
    if (!r.ok) { box.innerHTML = '<h2>' + esc(s('invH')) + '</h2><p class="muted"></p>'; $('p', box).textContent = J.errMsg(r.data); return; }
    var d = r.data;
    if (d.alreadyClient && d.matterId) {
      box.innerHTML = '<h2>' + esc(s('invH')) + '</h2><p>' + esc(s('already')) + '</p><a class="pill" href="#/portal/' + esc(d.matterId) + '">' + esc(s('goMatter')) + '</a>';
      return;
    }
    box.innerHTML = '<h2>' + esc(s('invH')) + '</h2><p class="pt-invp"></p><button class="pill" type="button" data-a="join">' + esc(s('join')) + '</button>';
    $('.pt-invp', box).textContent = s('invP', { l: d.lawyerName, t: d.matterTitle });
    $('[data-a=join]', box).onclick = async function () {
      var b = this; b.disabled = true;
      var q = await api('/api/portal/invite/' + encodeURIComponent(token) + '/accept', { method: 'POST', body: {} });
      b.disabled = false;
      if (!q.ok) { J.toast(J.errMsg(q.data), 6000); return; }
      J.portalClient = true; if (J.redrawNav) J.redrawNav();
      J.toast(s('joined'));
      J.go('#/portal/' + q.data.matterId);
    };
  };

  J.route(/^\/portal$/, function () { J.viewPortal(); });
  J.route(/^\/portal\/taklif\/([A-Za-z0-9_-]{20,64})$/, function (tok) { J.viewPortalInvite(tok); });
  J.route(/^\/portal\/([0-9a-f-]{36})$/, function (id) { J.viewPortalMatter(id); });
})(window);
