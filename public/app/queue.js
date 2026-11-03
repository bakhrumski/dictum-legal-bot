/* Navbat (2026-11-03, owner: the old dashboard is the master's only, so the human queue moves here).
   A lawyer or student sees the requests assigned to them - Telegram questions, files, voice notes,
   lawyer-review requests - opens one, hears / sees its file and writes the answer; the master sees
   every request, assigns it, approves a written answer (sent to the client in Telegram) or sends it
   back with a reason, or answers it directly. Nothing new on the server: the same routes the old
   dashboard used (GET /api/requests[/:id], /api/stats, /api/files/:id/raw|download, /api/admins,
   POST /api/student-response, approve-response, reject-response, master-response, assign-*, unassign-*);
   each checks the role itself, and a non-master sees only their own requests, client name hidden. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: {
      nav: 'Navbat', title: 'Murojaatlar navbati',
      leadStaff: 'Sizga biriktirilgan murojaatlar: savol, fayl yoki ovozli xabar. Javobingiz master tasdiqlagach mijozga Telegram’da yuboriladi.',
      leadMaster: 'Botga kelgan barcha murojaatlar. Biriktiring, yozilgan javobni tasdiqlang yoki o‘zingiz javob bering.',
      f: { open: 'Ochiq', review: 'Tasdiq kutmoqda', rejected: 'Qayta yozish', unassigned: 'Biriktirilmagan', answered_today: 'Bugun javob berilgan', all: 'Barchasi' },
      search: 'Matn yoki mijoz bo‘yicha qidirish…', none: 'Bu ro‘yxatda murojaat yo‘q.', more: 'Yana ko‘rsatish',
      st: { pending: 'Yangi', assigned: 'Biriktirilgan', student_responded: 'Tasdiq kutmoqda', lawyer_approved: 'Tasdiq kutmoqda', answered: 'Javob berilgan', ai_answered: 'AI javob bergan', rejected: 'Qayta yozish kerak' },
      urg: { critical: 'Juda shoshilinch', high: 'Shoshilinch', medium: '', low: '' },
      type: { voice: 'Ovozli xabar', audio: 'Audio', photo: 'Rasm', video: 'Video', video_note: 'Video', document: 'Hujjat' },
      back: 'Navbat', question: 'Murojaat', noText: 'Matn yo‘q — faylni oching.', file: 'Fayl', open: 'Ochish', save: 'Yuklab olish',
      aiAnswer: 'Mijozga yuborilgan javob', studentAns: 'Yozilgan javob', reason: 'Rad etish sababi',
      yours: 'Javobingiz', yoursPh: 'Mijozga javob: qisqa, aniq, kerak bo‘lsa modda bilan…', submit: 'Tasdiqqa yuborish', submitted: 'Javob masterga tasdiqqa yuborildi',
      waitMaster: 'Javobingiz master tasdig‘ini kutmoqda.', done: 'Bu murojaatga javob berilgan.',
      assign: 'Biriktirish', lawyer: 'Yurist', student: 'Talaba', add: 'Qo‘shish', assigned: 'Biriktirildi', unassigned: 'Olib tashlandi', nobody: 'Hali hech kim biriktirilmagan.',
      review: 'Javobni baholang', fb: { correct: 'To‘g‘ri', partially_correct: 'Qisman to‘g‘ri', incorrect: 'Noto‘g‘ri' }, fixed: 'Tuzatilgan javob (mijozga shu yuboriladi)',
      approve: 'Tasdiqlab yuborish', approveQ: 'Javob mijozga Telegram’da darhol yuboriladi. Tasdiqlaysizmi?', approved: 'Javob mijozga yuborildi',
      reject: 'Qayta yozishga qaytarish', rejectPh: 'Nimani tuzatish kerak?', rejected: 'Javob qayta yozishga qaytarildi', pickFb: 'Avval javobni baholang.',
      direct: 'O‘zim javob beraman', directPh: 'Mijozga javob…', send: 'Mijozga yuborish', sendQ: 'Javob mijozga Telegram’da darhol yuboriladi. Yuborilsinmi?', sent: 'Javob mijozga yuborildi',
      empty: 'Javob matni bo‘sh.', homeCard: 'Navbatda javob kutayotgan murojaatlar', homeOpen: 'Navbatni ochish',
    },
    ru: {
      nav: 'Очередь', title: 'Очередь обращений',
      leadStaff: 'Обращения, назначенные вам: вопрос, файл или голосовое сообщение. Ответ уходит клиенту в Telegram после подтверждения мастером.',
      leadMaster: 'Все обращения в бот. Назначайте, подтверждайте написанные ответы или отвечайте сами.',
      f: { open: 'Открытые', review: 'Ждут подтверждения', rejected: 'На доработке', unassigned: 'Не назначены', answered_today: 'Отвечены сегодня', all: 'Все' },
      search: 'Поиск по тексту или клиенту…', none: 'В этом списке обращений нет.', more: 'Показать ещё',
      st: { pending: 'Новое', assigned: 'Назначено', student_responded: 'Ждёт подтверждения', lawyer_approved: 'Ждёт подтверждения', answered: 'Отвечено', ai_answered: 'Ответил ИИ', rejected: 'На доработке' },
      urg: { critical: 'Очень срочно', high: 'Срочно', medium: '', low: '' },
      type: { voice: 'Голосовое', audio: 'Аудио', photo: 'Фото', video: 'Видео', video_note: 'Видео', document: 'Документ' },
      back: 'Очередь', question: 'Обращение', noText: 'Текста нет — откройте файл.', file: 'Файл', open: 'Открыть', save: 'Скачать',
      aiAnswer: 'Ответ, отправленный клиенту', studentAns: 'Написанный ответ', reason: 'Причина возврата',
      yours: 'Ваш ответ', yoursPh: 'Ответ клиенту: коротко, точно, при необходимости со статьёй…', submit: 'Отправить на подтверждение', submitted: 'Ответ отправлен мастеру на подтверждение',
      waitMaster: 'Ваш ответ ждёт подтверждения мастера.', done: 'На это обращение уже ответили.',
      assign: 'Назначение', lawyer: 'Юрист', student: 'Студент', add: 'Добавить', assigned: 'Назначено', unassigned: 'Снято', nobody: 'Пока никто не назначен.',
      review: 'Оцените ответ', fb: { correct: 'Верно', partially_correct: 'Частично верно', incorrect: 'Неверно' }, fixed: 'Исправленный ответ (уйдёт клиенту)',
      approve: 'Подтвердить и отправить', approveQ: 'Ответ сразу уйдёт клиенту в Telegram. Подтвердить?', approved: 'Ответ отправлен клиенту',
      reject: 'Вернуть на доработку', rejectPh: 'Что исправить?', rejected: 'Ответ возвращён на доработку', pickFb: 'Сначала оцените ответ.',
      direct: 'Отвечу сам', directPh: 'Ответ клиенту…', send: 'Отправить клиенту', sendQ: 'Ответ сразу уйдёт клиенту в Telegram. Отправить?', sent: 'Ответ отправлен клиенту',
      empty: 'Текст ответа пуст.', homeCard: 'Обращения в очереди ждут ответа', homeOpen: 'Открыть очередь',
    },
  };
  function s(k) { var d = S[J.lang] || S.uz; return d[k] !== undefined ? d[k] : S.uz[k]; }
  if (G.JAI_I18N) ['uz', 'ru', 'en'].forEach(function (l) { var d = G.JAI_I18N[l] = G.JAI_I18N[l] || {}; if (d['nav.queue'] === undefined) d['nav.queue'] = l === 'ru' ? S.ru.nav : (l === 'en' ? 'Queue' : S.uz.nav); });

  var isMaster = function () { return J.isMaster && J.isMaster(); };
  var OPEN = ['pending', 'assigned', 'rejected'];
  var REVIEW = ['student_responded', 'lawyer_approved'];

  /* ---------- the count on the nav item and the home card ---------- */
  J.queueCount = null;
  function needsMe(st) {
    if (!st) return 0;
    var n = function (k) { return parseInt(st[k], 10) || 0; };
    // the master's work: new requests and answers waiting for approval; a lawyer's / student's: new and sent back
    return isMaster() ? n('pending') + n('awaiting_review') : n('pending') + n('rejected');
  }
  function refreshCount() {
    if (!J.isStaff || !J.isStaff()) return;
    J.api('/api/stats', { allow401: true }).then(function (r) {
      if (!r.ok) return;
      J.queueCount = needsMe(r.data);
      var a = $('#nav a[data-r="#/navbat"]');
      if (a) {
        var b = $('.q-badge', a);
        if (!J.queueCount) { if (b) b.remove(); return; }
        if (!b) { b = document.createElement('span'); b.className = 'q-badge'; a.appendChild(b); }
        b.textContent = J.queueCount > 99 ? '99+' : String(J.queueCount);
      }
    });
  }
  var lastCount = 0;
  J.on('route', function () { if (Date.now() - lastCount > 60000) { lastCount = Date.now(); refreshCount(); } else if (J.queueCount) refreshCount(); });

  /* ---------- the home page: a staff account sees its queue first ---------- */
  var homeView = J.viewHome;
  J.viewHome = function () {
    homeView.apply(this, arguments);
    if (!J.isStaff || !J.isStaff()) return;
    J.api('/api/stats', { allow401: true }).then(function (r) {
      if (!r.ok || (location.hash && location.hash !== '#/' && location.hash !== '#')) return;
      var n = needsMe(r.data);
      if (!n) return;
      var host = $('#view .home') || $('#view .wrap');
      if (!host || $('.q-home', host)) return;
      var card = J.h('<a class="card q-home" href="#/navbat"><span class="q-home-n">' + esc(String(n)) + '</span><span class="q-home-t">' + esc(s('homeCard')) + '</span><span class="pill sm">' + esc(s('homeOpen')) + '</span></a>');
      host.insertBefore(card, host.firstChild);
    });
  };

  /* ---------- list ---------- */
  var FILTERS = function () { return isMaster() ? ['open', 'review', 'unassigned', 'answered_today', 'all'] : ['open', 'rejected', 'review', 'all']; };
  function query(f) {
    if (f === 'unassigned') return 'status=open&assigned=unassigned';
    if (f === 'rejected') return 'status=rejected';
    if (f === 'all') return '';
    return 'status=' + f;
  }
  function ago(d) {
    var t = new Date(d).getTime(); if (!t) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return Math.max(1, m) + (J.lang === 'ru' ? ' мин' : ' daq');
    if (m < 60 * 24) return Math.round(m / 60) + (J.lang === 'ru' ? ' ч' : ' soat');
    return J.fmtDate(d);
  }
  function statusTag(r) {
    // own class names: ".new" is the sidebar's "Yangi suhbat" button
    var cls = OPEN.indexOf(r.status) > -1 ? (r.status === 'rejected' ? 'q-st q-st-warn' : 'q-st q-st-new') : (REVIEW.indexOf(r.status) > -1 ? 'q-st q-st-rev' : 'q-st q-st-done');
    return '<span class="' + cls + '">' + esc(s('st')[r.status] || r.status) + '</span>';
  }

  var state = { f: 'open', q: '', page: 1 };
  J.viewQueue = function () {
    if (!J.isStaff || !J.isStaff()) { J.go('#/'); return; }
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap"><div class="vh"><div><h2>' + esc(s('title')) + '</h2><p>' + esc(isMaster() ? s('leadMaster') : s('leadStaff')) + '</p></div></div>' +
      '<div class="q-bar"><div class="q-chips"></div><input class="inp q-search" type="search" maxlength="200"></div><div class="q-list"><div class="skel" style="width:60%;margin:14px 0"></div></div></div>');
    if (FILTERS().indexOf(state.f) < 0) state.f = 'open';
    var srch = $('.q-search', v); srch.placeholder = s('search'); srch.value = state.q;
    var t; srch.oninput = function () { clearTimeout(t); t = setTimeout(function () { state.q = srch.value.trim(); state.page = 1; load(); }, 350); };
    function chips(stats) {
      var c = { open: stats && (+stats.pending || 0) + (+stats.awaiting_review || 0), review: stats && stats.awaiting_review, unassigned: stats && stats.unassigned, rejected: stats && stats.rejected, answered_today: stats && stats.answered_today };
      $('.q-chips', v).innerHTML = FILTERS().map(function (f) {
        var n = c[f]; return '<button class="chip' + (state.f === f ? ' on' : '') + '" type="button" data-f="' + f + '">' + esc(s('f')[f]) + (n ? ' <b>' + esc(String(n)) + '</b>' : '') + '</button>';
      }).join('');
      $$('[data-f]', v).forEach(function (b) { b.onclick = function () { state.f = b.dataset.f; state.page = 1; chips(stats); load(); }; });
    }
    chips(null);
    J.api('/api/stats').then(function (r) { if (r.ok) { chips(r.data); J.queueCount = needsMe(r.data); } });
    var list = $('.q-list', v), items = [];
    async function load(append) {
      var qs = query(state.f), url = '/api/requests?limit=30&page=' + state.page + (qs ? '&' + qs : '') + (state.q ? '&search=' + encodeURIComponent(state.q) : '') + (state.f === 'all' || state.f === 'answered_today' ? '&sort=newest' : '');
      if (!append) list.innerHTML = '<div class="skel" style="width:60%;margin:14px 0"></div>';
      var r = await J.api(url);
      if (!r.ok) { list.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      items = append ? items.concat(r.data.items || []) : (r.data.items || []);
      var pg = r.data.pagination || {};
      list.innerHTML = items.length ? items.map(function (x) {
        var urg = (s('urg')[x.urgency] || '');
        var kind = x.file_id ? (s('type')[x.request_type] || s('file')) : '';
        var text = String(x.request_text || '').replace(/\s+/g, ' ').slice(0, 220);
        return '<a class="q-row" href="#/navbat/' + esc(String(x.id)) + '"><div class="q-row-h"><b>#' + esc(String(x.id)) + '</b><span>' + esc(x.first_name || '') + '</span>' + statusTag(x) +
          (urg ? '<span class="q-urg">' + esc(urg) + '</span>' : '') + '<span class="q-ago">' + esc(ago(x.created_at)) + '</span></div>' +
          '<div class="q-row-t">' + (kind ? '<span class="q-kind">' + J.icon(x.request_type === 'voice' || x.request_type === 'audio' ? 'mic' : 'clip') + esc(kind) + '</span>' : '') + esc(text || (kind ? '' : '—')) + '</div>' +
          (x.category ? '<div class="q-row-c">' + esc(x.category) + (isMaster() && x.assigned_lawyer_name ? ' · ' + esc(x.assigned_lawyer_name) : '') + '</div>' : '') + '</a>';
      }).join('') + (pg.page < pg.pages ? '<button class="pill ghost q-more" type="button">' + esc(s('more')) + '</button>' : '') : '<div class="empty-state">' + esc(s('none')) + '</div>';
      var more = $('.q-more', list); if (more) more.onclick = function () { state.page++; load(true); };
    }
    load();
  };

  /* ---------- one request ---------- */
  function fileBlock(r) {
    if (!r.file_id) return '';
    var raw = '/api/files/' + encodeURIComponent(r.file_id) + '/raw', dl = '/api/files/' + encodeURIComponent(r.file_id) + '/download';
    var media = '';
    if (r.request_type === 'voice' || r.request_type === 'audio') media = '<audio controls preload="none" src="' + esc(raw) + '"></audio>';
    else if (r.request_type === 'photo') media = '<img class="q-img" alt="" loading="lazy" src="' + esc(raw) + '">';
    else if (r.request_type === 'video' || r.request_type === 'video_note') media = '<video controls preload="none" src="' + esc(raw) + '"></video>';
    var openable = r.request_type === 'document' && /\.(pdf|png|jpe?g|webp)$/i.test(r.file_name || '');
    return '<div class="card q-file"><div class="kicker">' + esc(s('file')) + (r.file_name ? ' · ' + esc(r.file_name) : '') + '</div>' + media +
      '<div class="q-file-b">' + (openable ? '<a class="pill ghost sm" target="_blank" rel="noopener" href="' + esc(raw) + '">' + esc(s('open')) + '</a>' : '') +
      '<a class="pill ghost sm" href="' + esc(dl) + '">' + J.icon('up') + esc(s('save')) + '</a></div></div>';
  }
  function splitRejected(text) {
    var i = String(text || '').lastIndexOf('--- REJECTED ---');
    if (i < 0) return { answer: String(text || ''), reason: '' };
    var reason = String(text).slice(i).replace('--- REJECTED ---', '').replace(/^\s*Reason:\s*/i, '').trim();
    // an answer sent back twice carries both markers; the newest reason counts, the answer is before the first
    var first = String(text).indexOf('--- REJECTED ---');
    return { answer: String(text).slice(0, first).trim(), reason: reason };
  }

  J.viewQueueItem = async function (id) {
    if (!J.isStaff || !J.isStaff()) { J.go('#/'); return; }
    J.setTitle('#' + id);
    var v = J.mount('<div class="wrap narrow"><a class="muted q-back" href="#/navbat">← ' + esc(s('back')) + '</a><div class="q-item"><div class="skel" style="width:60%;margin:14px 0"></div></div></div>');
    var box = $('.q-item', v);
    var r = await J.api('/api/requests/' + encodeURIComponent(id));
    if (!r.ok) { box.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
    var x = r.data, master = isMaster();
    var rej = splitRejected(x.student_response);
    var urg = s('urg')[x.urgency] || '';
    var html = '<div class="q-head"><h2>#' + esc(String(x.id)) + ' · ' + esc(x.first_name || '') + '</h2><div class="q-meta">' + statusTag(x) + (urg ? '<span class="q-urg">' + esc(urg) + '</span>' : '') +
      (x.category ? '<span class="tag">' + esc(x.category) + '</span>' : '') + '<span class="tag">' + esc(J.fmtDate(x.created_at)) + (Date.now() - new Date(x.created_at).getTime() < 864e5 ? ' · ' + esc(ago(x.created_at)) : '') + '</span></div></div>' +
      '<div class="card"><div class="kicker">' + esc(s('question')) + '</div><div class="q-text"></div></div>' + fileBlock(x);
    if (x.response_text && (x.status === 'answered' || x.status === 'ai_answered')) html += '<div class="card"><div class="kicker">' + esc(s('aiAnswer')) + (x.responded_by ? ' · ' + esc(x.responded_by) : '') + '</div><div class="q-text q-ans"></div></div>';
    if (master) html += '<div class="card q-assign"><div class="kicker">' + esc(s('assign')) + '</div><div class="q-who"></div><div class="q-add"></div></div>';
    html += '<div class="q-act"></div>';
    box.innerHTML = html;
    $('.q-text', box).textContent = x.request_text || s('noText');
    var ans = $('.q-ans', box); if (ans) ans.textContent = x.response_text;

    /* assignment (master) */
    if (master) {
      var people = [];
      var drawWho = function () {
        var who = [];
        if (x.assigned_to) who.push({ id: x.assigned_to, name: x.assigned_lawyer_name || ('#' + x.assigned_to), kind: 'lawyer' });
        (x.assigned_students || []).forEach(function (p) { who.push({ id: p.id, name: p.full_name, kind: 'student' }); });
        $('.q-who', box).innerHTML = who.length ? who.map(function (w) { return '<span class="chip">' + esc(w.name) + ' <small class="muted">' + esc(s(w.kind)) + '</small><button type="button" class="q-x" data-un="' + esc(w.kind) + ':' + esc(String(w.id)) + '" aria-label="×">×</button></span>'; }).join(' ') : '<p class="muted" style="font-size:13px">' + esc(s('nobody')) + '</p>';
        $$('[data-un]', box).forEach(function (b) {
          b.onclick = async function () {
            var p = b.dataset.un.split(':'), lawyer = p[0] === 'lawyer';
            var u = await J.api(lawyer ? '/api/unassign-request' : '/api/unassign-student', { method: 'POST', body: lawyer ? { requestId: x.id } : { requestId: x.id, studentId: +p[1] } });
            if (!u.ok) { J.toast(J.errMsg(u.data)); return; }
            J.toast(s('unassigned')); J.viewQueueItem(id);
          };
        });
      };
      drawWho();
      J.api('/api/admins').then(function (a) {
        if (!a.ok) return;
        people = (a.data || []).filter(function (p) { return p.role === 'lawyer' || p.role === 'student'; });
        if (!people.length) return;
        $('.q-add', box).innerHTML = '<select class="inp q-pick"><option value="">' + esc(s('assign')) + '…</option>' + people.map(function (p) { return '<option value="' + esc(p.role + ':' + p.id) + '">' + esc((p.full_name || p.username) + ' — ' + s(p.role)) + (p.is_active ? ' ●' : '') + '</option>'; }).join('') + '</select><button class="pill sm" type="button" data-a="as">' + esc(s('add')) + '</button>';
        $('[data-a=as]', box).onclick = async function () {
          var val = $('.q-pick', box).value; if (!val) return;
          var p = val.split(':'), lawyer = p[0] === 'lawyer';
          var u = await J.api(lawyer ? '/api/assign-request' : '/api/assign-student', { method: 'POST', body: lawyer ? { requestId: x.id, lawyerId: +p[1] } : { requestId: x.id, studentId: +p[1] } });
          if (!u.ok) { J.toast(J.errMsg(u.data)); return; }
          J.toast(s('assigned')); J.viewQueueItem(id);
        };
      });
    }

    /* actions */
    var act = $('.q-act', box);
    if (!master) {
      if (OPEN.indexOf(x.status) > -1) {
        act.innerHTML = (rej.reason ? '<div class="card q-note"><div class="kicker">' + esc(s('reason')) + '</div><div class="q-text q-reason"></div></div>' : '') +
          '<div class="card"><div class="kicker">' + esc(s('yours')) + '</div><textarea class="inp q-ta" rows="8" maxlength="8000"></textarea><div class="q-btns"><button class="pill" type="button" data-a="sub">' + esc(s('submit')) + '</button></div></div>';
        if (rej.reason) $('.q-reason', act).textContent = rej.reason;
        var ta = $('.q-ta', act); ta.placeholder = s('yoursPh'); ta.value = rej.answer;
        $('[data-a=sub]', act).onclick = async function () {
          var text = ta.value.trim(); if (!text) { J.toast(s('empty')); ta.focus(); return; }
          this.disabled = true;
          var u = await J.api('/api/student-response', { method: 'POST', body: { requestId: x.id, responseText: text } });
          this.disabled = false;
          if (!u.ok) { J.toast(J.errMsg(u.data), 6000); return; }
          J.toast(s('submitted')); refreshCount(); J.viewQueueItem(id);
        };
      } else if (REVIEW.indexOf(x.status) > -1) {
        act.innerHTML = '<div class="card"><div class="kicker">' + esc(s('studentAns')) + '</div><div class="q-text q-sa"></div><p class="muted" style="font-size:13px;margin-top:10px">' + esc(s('waitMaster')) + '</p></div>';
        $('.q-sa', act).textContent = rej.answer;
      } else {
        act.innerHTML = '<p class="muted" style="font-size:13px">' + esc(s('done')) + '</p>';
      }
      return;
    }
    // master: an answer waiting for approval
    if (REVIEW.indexOf(x.status) > -1) {
      act.innerHTML = '<div class="card"><div class="kicker">' + esc(s('review')) + (x.responded_by ? ' · ' + esc(x.responded_by) : '') + '</div><div class="q-text q-sa"></div>' +
        '<div class="q-fb">' + ['correct', 'partially_correct', 'incorrect'].map(function (k) { return '<button class="chip" type="button" data-fb="' + k + '">' + esc(s('fb')[k]) + '</button>'; }).join('') + '</div>' +
        '<div class="q-fix" hidden><label class="kicker">' + esc(s('fixed')) + '</label><textarea class="inp q-ta" rows="8" maxlength="8000"></textarea></div>' +
        '<div class="q-btns"><button class="pill" type="button" data-a="ok">' + esc(s('approve')) + '</button><button class="pill ghost" type="button" data-a="no">' + esc(s('reject')) + '</button></div></div>';
      $('.q-sa', act).textContent = rej.answer;
      var fb = '', fix = $('.q-fix', act), fta = $('.q-ta', act);
      fta.value = rej.answer;
      $$('[data-fb]', act).forEach(function (b) {
        b.onclick = function () { fb = b.dataset.fb; $$('[data-fb]', act).forEach(function (c) { c.classList.toggle('on', c === b); }); fix.hidden = fb === 'correct'; };
      });
      $('[data-a=ok]', act).onclick = async function () {
        if (!fb) { J.toast(s('pickFb')); return; }
        var fixed = fta.value.trim();
        if (fb !== 'correct' && !fixed) { J.toast(s('empty')); fta.focus(); return; }
        if (!(await J.confirm(s('approveQ'), s('approve')))) return;
        this.disabled = true;
        var u = await J.api('/api/approve-response', { method: 'POST', body: { requestId: x.id, feedbackType: fb, correctedAnswer: fb === 'correct' ? '' : fixed } });
        this.disabled = false;
        // the answer may be saved even when Telegram refused it: show what the server now holds
        if (!u.ok) { J.toast(J.errMsg(u.data), 6000); J.viewQueueItem(id); return; }
        J.toast(s('approved')); refreshCount(); J.viewQueueItem(id);
      };
      $('[data-a=no]', act).onclick = function () {
        var m = J.modal({ cls: 'sm', html: '<h2>' + esc(s('reject')) + '</h2><textarea class="inp" rows="4" maxlength="1000" style="margin-top:12px"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="pill ghost" type="button" data-a="c">' + esc(J.t('cancel')) + '</button><button class="pill" type="button" data-a="r">' + esc(s('reject')) + '</button></div>' });
        var rt = $('textarea', m.body); rt.placeholder = s('rejectPh'); rt.focus();
        $('[data-a=c]', m.body).onclick = function () { m.close(); };
        $('[data-a=r]', m.body).onclick = async function () {
          var reason = rt.value.trim(); if (!reason) { rt.focus(); return; }
          var u = await J.api('/api/reject-response', { method: 'POST', body: { requestId: x.id, reason: reason } });
          if (!u.ok) { J.toast(J.errMsg(u.data)); return; }
          m.close(); J.toast(s('rejected')); J.viewQueueItem(id);
        };
      };
      return;
    }
    // master: answer directly while the request is not answered
    if (x.status !== 'answered') {
      act.innerHTML = (rej.reason ? '<div class="card q-note"><div class="kicker">' + esc(s('reason')) + '</div><div class="q-text q-reason"></div></div>' : '') +
        '<div class="card"><div class="kicker">' + esc(s('direct')) + '</div><textarea class="inp q-ta" rows="8" maxlength="8000"></textarea><div class="q-btns"><button class="pill" type="button" data-a="send">' + esc(s('send')) + '</button></div></div>';
      if (rej.reason) $('.q-reason', act).textContent = rej.reason;
      var mta = $('.q-ta', act); mta.placeholder = s('directPh');
      $('[data-a=send]', act).onclick = async function () {
        var text = mta.value.trim(); if (!text) { J.toast(s('empty')); mta.focus(); return; }
        if (!(await J.confirm(s('sendQ'), s('send')))) return;
        this.disabled = true;
        var u = await J.api('/api/master-response', { method: 'POST', body: { requestId: x.id, responseText: text } });
        this.disabled = false;
        if (!u.ok) { J.toast(J.errMsg(u.data), 6000); J.viewQueueItem(id); return; }
        J.toast(s('sent')); refreshCount(); J.viewQueueItem(id);
      };
    }
  };

  J.route(/^\/navbat$/, function () { J.viewQueue(); });
  J.route(/^\/navbat\/(\d+)$/, function (id) { J.viewQueueItem(id); });
})(window);
