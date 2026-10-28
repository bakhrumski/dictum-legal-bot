/* Moslashish (2026-10-28, PR A2, docs/design/adaptiv-akkaunt.md): JuristAI siz haqingizda nimani
   bilishini ochiq ko'rsatadi - o'zgartirish, o'chirish, to'xtatish va tozalash shu yerda.
   Server: GET/PUT /api/adaptive/profile, POST .../pause, .../clear, GET /api/adaptive/signals (src/adaptive/routes.js). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;

  var S = {
    uz: {
      title: 'Moslashish', lead: 'JuristAI siz ko‘p ishlatgan sohalar, aktlar va xizmatlarni eslab qoladi, shunda javoblar va sahifalar sizga moslashadi. Savol, javob va hujjat matni saqlanmaydi — faqat qisqa kodlar.',
      on: 'Moslashish yoqiq', off: 'Moslashish to‘xtatilgan', pause: 'To‘xtatish', resume: 'Yoqish', pausedNote: 'To‘xtatilgan: yangi signal yozilmaydi va profil ishlatilmaydi.',
      know: 'JuristAI siz haqingizda nima biladi', areas: 'Ko‘p so‘raydigan sohalaringiz', acts: 'Ko‘p keltirilgan aktlar', none: 'Hali yetarli ma’lumot yo‘q.',
      script: 'Alifbo', latn: 'Lotin', cyrl: 'Kirill', auto: 'Avtomatik', services: 'Ko‘p ishlatadigan xizmatlar', hide: 'Olib tashlash', hidden: 'Olib tashlangan', restore: 'Qaytarish',
      prefs: 'Sizning sozlamalaringiz', length: 'Javob uzunligi', len: { qisqa: 'Qisqa', orta: 'O‘rtacha', batafsil: 'Batafsil' },
      sides: 'Sizning tarafingiz', sidesLead: 'Faqat siz tanlaysiz — JuristAI tarafni o‘zi taxmin qilmaydi.', area: 'Soha', role: 'Taraf', add: 'Qo‘shish', saved: 'Saqlandi',
      signals: 'Yig‘ilgan signallar', signalsLead: 'Har savol yoki xizmatdan qolgan qisqa kodlar. {d} kundan keyin o‘zi o‘chadi.', total: 'Jami: {n}', when: 'Qachon', kind: 'Turi', value: 'Qiymati', ch: 'Qayerdan',
      clear: 'Hammasini tozalash', clearQ: 'Barcha signallar, profil va sozlamalaringiz o‘chirilsinmi? Qaytarib bo‘lmaydi.', cleared: 'Tozalandi', open: 'Ochish', card: 'JuristAI sizga qanday moslashayotganini ko‘ring va boshqaring',
      kinds: { area: 'Soha', act: 'Akt', script: 'Alifbo', lang: 'Til', service: 'Xizmat', playbook: 'Playbook' },
      svc: { chat: 'Chat', telegram: 'Telegram', tabular_review: 'Jadvalli tahlil', playbook_review: 'Playbook', claim_draft: 'Da’vo loyihasi', planned: 'Agent topshirig‘i' },
      roles: { xaridor: 'Xaridor', sotuvchi: 'Sotuvchi', ijarachi: 'Ijarachi', ijaraga_beruvchi: 'Ijaraga beruvchi', ish_beruvchi: 'Ish beruvchi', xodim: 'Xodim', pudratchi: 'Pudratchi', buyurtmachi: 'Buyurtmachi', qarz_beruvchi: 'Qarz beruvchi', qarz_oluvchi: 'Qarz oluvchi', tadbirkor: 'Tadbirkor', jismoniy_shaxs: 'Jismoniy shaxs', boshqa: 'Boshqa' }
    },
    ru: {
      title: 'Адаптация', lead: 'JuristAI запоминает области права, акты и сервисы, которыми вы пользуетесь чаще, чтобы ответы и страницы подстраивались под вас. Тексты вопросов, ответов и документов не сохраняются — только короткие коды.',
      on: 'Адаптация включена', off: 'Адаптация остановлена', pause: 'Остановить', resume: 'Включить', pausedNote: 'Остановлено: новые сигналы не записываются, профиль не используется.',
      know: 'Что JuristAI знает о вас', areas: 'Частые области', acts: 'Часто цитируемые акты', none: 'Пока недостаточно данных.',
      script: 'Алфавит', latn: 'Латиница', cyrl: 'Кириллица', auto: 'Автоматически', services: 'Частые сервисы', hide: 'Убрать', hidden: 'Убрано', restore: 'Вернуть',
      prefs: 'Ваши настройки', length: 'Длина ответа', len: { qisqa: 'Коротко', orta: 'Средне', batafsil: 'Подробно' },
      sides: 'Ваша сторона', sidesLead: 'Выбираете только вы — JuristAI не угадывает сторону.', area: 'Область', role: 'Сторона', add: 'Добавить', saved: 'Сохранено',
      signals: 'Собранные сигналы', signalsLead: 'Короткие коды от каждого вопроса или сервиса. Удаляются сами через {d} дней.', total: 'Всего: {n}', when: 'Когда', kind: 'Тип', value: 'Значение', ch: 'Откуда',
      clear: 'Очистить всё', clearQ: 'Удалить все сигналы, профиль и настройки? Отменить нельзя.', cleared: 'Очищено', open: 'Открыть', card: 'Посмотрите и управляйте тем, как JuristAI подстраивается под вас',
      kinds: { area: 'Область', act: 'Акт', script: 'Алфавит', lang: 'Язык', service: 'Сервис', playbook: 'Playbook' },
      svc: { chat: 'Чат', telegram: 'Telegram', tabular_review: 'Табличный анализ', playbook_review: 'Playbook', claim_draft: 'Проект иска', planned: 'Задача агента' },
      roles: { xaridor: 'Покупатель', sotuvchi: 'Продавец', ijarachi: 'Арендатор', ijaraga_beruvchi: 'Арендодатель', ish_beruvchi: 'Работодатель', xodim: 'Работник', pudratchi: 'Подрядчик', buyurtmachi: 'Заказчик', qarz_beruvchi: 'Займодавец', qarz_oluvchi: 'Заёмщик', tadbirkor: 'Предприниматель', jismoniy_shaxs: 'Физическое лицо', boshqa: 'Другое' }
    }
  };
  function s(k, vars) {
    var d = S[J.lang] || S.uz, v = d[k] !== undefined ? d[k] : S.uz[k];
    if (vars && typeof v === 'string') Object.keys(vars).forEach(function (x) { v = v.replace('{' + x + '}', vars[x]); });
    return v;
  }
  J.adaptiveText = s;

  J.viewAdaptive = function () {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('lead')) + '</p></div></div><div class="ad-body"><div class="skel" style="width:60%;margin:14px 0"></div></div></div>');
    var body = $('.ad-body', v), P = null, labels = {};
    var pct = function (w) { return Math.round((w || 0) * 100) + '%'; };
    var areaName = function (c) { return (labels.areas && labels.areas[c]) || c; };

    async function load() {
      var r = await J.api('/api/adaptive/profile');
      if (!r.ok) { body.innerHTML = '<p class="err">' + esc(J.errMsg(r.data)) + '</p>'; return; }
      P = r.data; labels = P.labels || {};
      draw();
      signals();
    }
    async function save(manual) {
      var r = await J.api('/api/adaptive/profile', { method: 'PUT', body: { manual: manual } });
      if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
      P = r.data; labels = P.labels || labels; draw(); J.toast(s('saved'));
    }
    function manual() { return JSON.parse(JSON.stringify(P.manual || {})); }

    function draw() {
      var prof = P.profile || {}, m = P.manual || {}, hid = m.hidden || { areas: [], acts: [] };
      var areas = prof.areas || [], acts = prof.acts || [], svcs = prof.services || [];
      var row = function (key, label, sub, isHidden) {
        return '<li class="ad-it' + (isHidden ? ' off' : '') + '"><span class="ad-n">' + esc(label) + '</span><small class="muted">' + esc(sub) + '</small>' +
          '<button type="button" class="ad-x" data-h="' + esc(key) + '">' + esc(isHidden ? s('restore') : s('hide')) + '</button></li>';
      };
      body.innerHTML =
        '<div class="card ad-state"><div><b>' + esc(P.paused ? s('off') : s('on')) + '</b>' + (P.paused ? '<p class="muted">' + esc(s('pausedNote')) + '</p>' : '') + '</div>' +
          '<button class="pill sm ' + (P.paused ? '' : 'ghost') + '" data-a="pause" type="button">' + esc(P.paused ? s('resume') : s('pause')) + '</button></div>' +
        '<div class="card"><h4>' + esc(s('know')) + '</h4>' +
          '<p class="ad-h">' + esc(s('areas')) + '</p>' + (areas.length ? '<ul class="ad-list">' + areas.map(function (a) { return row('area:' + a.code, areaName(a.code), pct(a.weight), (hid.areas || []).indexOf(a.code) > -1); }).join('') + '</ul>' : '<p class="muted">' + esc(s('none')) + '</p>') +
          '<p class="ad-h">' + esc(s('acts')) + '</p>' + (acts.length ? '<ul class="ad-list">' + acts.map(function (a) { return row('act:' + a.docId, a.title || a.docId, 'lex.uz · ' + pct(a.weight), (hid.acts || []).indexOf(a.docId) > -1); }).join('') + '</ul>' : '<p class="muted">' + esc(s('none')) + '</p>') +
          '<p class="ad-h">' + esc(s('services')) + '</p>' + (svcs.length ? '<p class="ad-svcs">' + svcs.map(function (x) { return '<span class="chip static">' + esc((s('svc')[x.code]) || x.code) + ' · ' + pct(x.weight) + '</span>'; }).join('') + '</p>' : '<p class="muted">' + esc(s('none')) + '</p>') +
        '</div>' +
        '<div class="card"><h4>' + esc(s('prefs')) + '</h4><div class="ad-grid">' +
          '<label class="field"><span>' + esc(s('length')) + '</span><select class="inp" data-m="answerLength"><option value="">' + esc(s('auto')) + '</option>' + (labels.lengths || []).map(function (k) { return '<option value="' + k + '"' + (m.answerLength === k ? ' selected' : '') + '>' + esc(s('len')[k] || k) + '</option>'; }).join('') + '</select></label>' +
          '<label class="field"><span>' + esc(s('script')) + '</span><select class="inp" data-m="script"><option value="">' + esc(s('auto')) + (prof.script ? ' (' + esc(s(prof.script)) + ')' : '') + '</option><option value="latn"' + (m.script === 'latn' ? ' selected' : '') + '>' + esc(s('latn')) + '</option><option value="cyrl"' + (m.script === 'cyrl' ? ' selected' : '') + '>' + esc(s('cyrl')) + '</option></select></label></div>' +
          '<p class="ad-h">' + esc(s('sides')) + '</p><p class="muted" style="font-size:13px;margin-bottom:8px">' + esc(s('sidesLead')) + '</p>' +
          '<ul class="ad-list">' + (m.partyRoles || []).map(function (r, i) { return '<li class="ad-it"><span class="ad-n">' + esc(areaName(r.area)) + '</span><small class="muted">' + esc(s('roles')[r.role] || r.role) + '</small><button type="button" class="ad-x" data-r="' + i + '">' + esc(s('hide')) + '</button></li>'; }).join('') + '</ul>' +
          '<div class="ad-add"><select class="inp ad-area"><option value="">' + esc(s('area')) + '</option>' + Object.keys(labels.areas || {}).map(function (k) { return '<option value="' + esc(k) + '">' + esc(labels.areas[k]) + '</option>'; }).join('') + '</select>' +
          '<select class="inp ad-role"><option value="">' + esc(s('role')) + '</option>' + (labels.roles || []).map(function (k) { return '<option value="' + k + '">' + esc(s('roles')[k] || k) + '</option>'; }).join('') + '</select>' +
          '<button class="pill sm" data-a="side" type="button">' + esc(s('add')) + '</button></div></div>' +
        '<div class="card"><h4>' + esc(s('signals')) + '</h4><p class="muted" style="font-size:13px">' + esc(s('signalsLead', { d: 180 })) + '</p><div class="ad-sig"><div class="skel" style="width:50%"></div></div></div>' +
        '<div style="margin-top:14px"><button class="pill sm ghost" data-a="clear" type="button">' + J.icon('trash') + esc(s('clear')) + '</button></div>';

      $('[data-a=pause]', body).onclick = async function () {
        var r = await J.api('/api/adaptive/profile/pause', { method: 'POST', body: { paused: !P.paused } });
        if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
        P = r.data; draw(); signals();
      };
      $$('[data-h]', body).forEach(function (b) {
        b.onclick = function () {
          var k = b.dataset.h.split(':'), mm = manual(); mm.hidden = mm.hidden || { areas: [], acts: [] };
          var list = mm.hidden[k[0] === 'area' ? 'areas' : 'acts'] = mm.hidden[k[0] === 'area' ? 'areas' : 'acts'] || [];
          var at = list.indexOf(k[1]); if (at > -1) list.splice(at, 1); else list.push(k[1]);
          save(mm);
        };
      });
      $$('[data-m]', body).forEach(function (sel) { sel.onchange = function () { var mm = manual(); if (sel.value) mm[sel.dataset.m] = sel.value; else delete mm[sel.dataset.m]; save(mm); }; });
      $$('[data-r]', body).forEach(function (b) { b.onclick = function () { var mm = manual(); mm.partyRoles.splice(+b.dataset.r, 1); save(mm); }; });
      $('[data-a=side]', body).onclick = function () {
        var a = $('.ad-area', body).value, r = $('.ad-role', body).value;
        if (!a || !r) return;
        var mm = manual(); mm.partyRoles = (mm.partyRoles || []).filter(function (x) { return x.area !== a; }).concat([{ area: a, role: r }]);
        save(mm);
      };
      $('[data-a=clear]', body).onclick = async function () {
        if (!(await J.confirm(s('clearQ'), s('clear')))) return;
        var r = await J.api('/api/adaptive/profile/clear', { method: 'POST', body: {} });
        if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
        P = r.data; draw(); signals(); J.toast(s('cleared'));
      };
    }

    async function signals() {
      var box = $('.ad-sig', body); if (!box) return;
      var r = await J.api('/api/adaptive/signals?limit=30');
      if (!r.ok) { box.innerHTML = '<p class="err">' + esc(J.errMsg(r.data)) + '</p>'; return; }
      var rows = r.data.rows || [];
      var lead = $('.ad-sig', body).previousElementSibling; if (lead) lead.textContent = s('signalsLead', { d: r.data.keepDays || 180 });
      var val = function (x) {
        if (x.kind === 'area') return areaName(x.value);
        if (x.kind === 'act') return (x.label || '') + ' (lex.uz ' + x.value + ')';
        if (x.kind === 'service') return s('svc')[x.value] || x.value;
        if (x.kind === 'script') return s(x.value);
        return x.value;
      };
      box.innerHTML = '<p class="muted" style="font-size:13px;margin:4px 0 8px">' + esc(s('total', { n: r.data.total })) + '</p>' + (rows.length
        ? '<div class="ad-tbl"><table><thead><tr><th>' + esc(s('when')) + '</th><th>' + esc(s('kind')) + '</th><th>' + esc(s('value')) + '</th><th>' + esc(s('ch')) + '</th></tr></thead><tbody>' +
          rows.map(function (x) { return '<tr><td class="num">' + esc(new Date(x.created_at).toLocaleDateString('uz-UZ')) + '</td><td>' + esc(s('kinds')[x.kind] || x.kind) + '</td><td>' + esc(val(x)) + '</td><td>' + esc(x.channel) + '</td></tr>'; }).join('') + '</tbody></table></div>'
        : '<p class="muted">' + esc(s('none')) + '</p>');
    }

    load();
  };

  J.route(/^\/moslashish$/, function () { J.viewAdaptive(); });
})(window);
