/* Ishlar (Matter, 2026-10-28, yo'l xaritasi PR-C; docs/design/matter-va-agent-runs.md 2.4):
   bitta huquqiy ish va unga bog'langan chatlar, hujjatlar, agent natijalari, yozuvlar.
   Server: /api/matters (src/matters/routes.js), /api/agent/runs/:id (src/agents/runs/routes.js).
   Bu yerda: #/ishlar ro'yxati, #/ishlar/:id sahifasi, "Ishga qo'shish" oynasi (J.addToMatter)
   va navbatda qolgan agent ishini kutish (J.followRun). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;

  var S = {
    uz: {
      title: 'Ishlar', lead: 'Bitta huquqiy ish bo‘yicha chatlar, hujjatlar, agent natijalari va yozuvlar bir joyda.',
      new: 'Yangi ish', search: 'Ishlarni qidirish', open: 'Ochiq', closed: 'Yopilgan', all: 'Hammasi',
      empty: 'Hali ish yo‘q. Ish oching va unga chat, jadval, playbook yoki da’vo loyihasini qo‘shing.', emptyF: 'Bu filtrda ish yo‘q.',
      items: '{n} ta element', ws: 'Workspace', ro: 'Faqat o‘qish',
      name: 'Ish nomi', namePh: 'Masalan: Pudratchi bilan nizo', summary: 'Qisqa tavsif (ixtiyoriy)', summaryPh: 'Tomonlar, vaziyat, muhim sanalar',
      wsPick: 'Workspace (ixtiyoriy)', wsNone: 'Shaxsiy ish', create: 'Ochish', cancel: 'Bekor qilish', save: 'Saqlash',
      limit: 'Tarifni ko‘rish', back: 'Ishlar',
      edit: 'Tahrirlash', close: 'Yopish', reopen: 'Qayta ochish', del: 'O‘chirish', delQ: 'Ish o‘chirilsinmi? Unga bog‘langan chat va hujjatlar o‘chmaydi, faqat bog‘lanish yo‘qoladi.',
      note: 'Yozuv qo‘shish', notePh: 'Masalan: sud majlisi 12-noyabr, soat 10:00', addNote: 'Qo‘shish',
      start: 'Shu ish uchun boshlash', startChat: 'Savol berish', startTable: 'Jadvalli tahlil', startPb: 'Playbook', startClaim: 'Da’vo loyihasi',
      startHint: 'Natija ostidagi «Ishga qo‘shish» tugmasi shu ishni tanlaydi.',
      noItems: 'Ishda hali hech narsa yo‘q.', gone: 'mavjud emas', remove: 'Ishdan olib tashlash', removeQ: 'Element ishdan olib tashlansinmi? Manbaning o‘zi o‘chmaydi.',
      kind: { chat: 'Chat', scan: 'Skanerlangan hujjat', agent_run: 'Agent natijasi', note: 'Yozuv' },
      wf: { claim_draft: 'Da’vo arizasi loyihasi', tabular_review: 'Jadvalli tahlil', playbook_review: 'Playbook tekshiruvi', planned: 'Agent topshirig‘i' },
      st: { queued: 'navbatda', running: 'ishlanmoqda', done: 'tayyor', failed: 'xato', cancelled: 'bekor qilindi', budget: 'limit tugadi', needs_input: 'ma’lumot kerak', awaiting_approval: 'tasdiq kutilmoqda' },
      pages: '{n} bet', status: 'Holat',
      add: 'Ishga qo‘shish', pick: 'Qaysi ishga qo‘shamiz?', newHere: '+ Yangi ish', itemTitle: 'Element nomi', added: 'Ishga qo‘shildi', openM: 'Ochish',
      exists: 'Bu ishda allaqachon bor', waitChat: 'Suhbat hali saqlanmadi, bir soniyadan keyin qayta bosing.',
      waiting: 'Ish navbatda turibdi, natija tayyor bo‘lishini kutyapmiz…', runGone: 'Agent ishining natijasi topilmadi.',
      rows: '{n} ta hujjat', results: '{n} ta qoida', counts: 'Mos {mos} · farq {farq} · yo‘q {yoq} · noaniq {noaniq}', basis: 'Asos',
      noResult: 'Natija saqlanmagan (muddati o‘tgan yoki ish tugamagan).',
      agent: 'Agent topshirig‘i', agentBeta: 'sinov · faqat master', agentPh: 'Masalan: shartnoma va yozuvlar asosida pudratchidan avansni qaytarish yo‘lini tahlil qil',
      plan: 'Reja tuzish', planH: 'Agent rejasi', planHint: 'Hali hech narsa band qilinmadi. Tasdiqlasangiz, narx band qilinadi va qadamlar bajariladi; javob manbalar bilan tekshirilmasa, birlik qaytariladi.',
      price: 'Narx: {p}', free: 'bepul', chatU: '{n} ta savol birligi', approve: 'Tasdiqlash va boshlash', fallback: 'Model rejasi qabul qilinmadi — standart reja taklif qilindi.',
      running: 'Bajarilmoqda…', answer: 'Javob', vf: { verified: 'Manbalar bilan tekshirildi', partial: 'Ayrim da’volar manbada tasdiqlanmadi va olib tashlandi', unverified: 'Tekshiruvchi ishlamadi — javobni manba bilan qo‘lda tekshiring', no_claims: 'Raqam yoki muddat da’volari yo‘q; iqtiboslar manbada tekshirildi' },
      sources: 'Manbalar',
      askH: 'Agent savol beryapti', askPh: 'Javobingiz', askSend: 'Javob berish va davom etish', askNote: 'Javobdan keyin narx qayta band qilinadi va ish davom etadi.',
      cmdPh: 'Buyruq: «ishlarim», «yangi ish och: …», «… ishiga yozuv: …»', cmdRun: 'Bajarish', cmdMic: 'Ovozli buyruq', cmdListen: 'Gapiring… (to‘xtatish uchun bosing)', cmdBusy: 'Matnga aylantirilmoqda…', heardCheck: 'Matnni tekshiring, kerak bo‘lsa tuzating va «Bajarish»ni bosing.',
      cmdHelp: 'Ovoz yoki matn bilan: «ishlarim» · «yangi ish och: Pudratchi bilan nizo» · «pudrat ishiga yozuv: sud 12-noyabr» · «pudrat ishini ko‘rsat» · «pudrat ishini yop». Xuddi shu buyruqlar Telegram botida ham ishlaydi (akkaunt ulangan bo‘lsa).',
      yes: 'Ha', micDenied: 'Mikrofonga ruxsat berilmadi.',
    },
    ru: {
      title: 'Дела', lead: 'Чаты, документы, результаты агентов и заметки по одному делу в одном месте.',
      new: 'Новое дело', search: 'Поиск по делам', open: 'Открытые', closed: 'Закрытые', all: 'Все',
      empty: 'Дел пока нет. Откройте дело и добавьте в него чат, таблицу, playbook или проект иска.', emptyF: 'В этом фильтре дел нет.',
      items: 'Элементов: {n}', ws: 'Workspace', ro: 'Только чтение',
      name: 'Название дела', namePh: 'Например: спор с подрядчиком', summary: 'Краткое описание (необязательно)', summaryPh: 'Стороны, ситуация, важные даты',
      wsPick: 'Workspace (необязательно)', wsNone: 'Личное дело', create: 'Открыть', cancel: 'Отмена', save: 'Сохранить',
      limit: 'Посмотреть тарифы', back: 'Дела',
      edit: 'Изменить', close: 'Закрыть', reopen: 'Открыть снова', del: 'Удалить', delQ: 'Удалить дело? Связанные чаты и документы не удаляются, исчезает только связь.',
      note: 'Добавить заметку', notePh: 'Например: заседание 12 ноября, 10:00', addNote: 'Добавить',
      start: 'Начать для этого дела', startChat: 'Задать вопрос', startTable: 'Табличный анализ', startPb: 'Playbook', startClaim: 'Проект иска',
      startHint: 'Кнопка «Добавить в дело» под результатом выберет это дело.',
      noItems: 'В деле пока ничего нет.', gone: 'недоступно', remove: 'Убрать из дела', removeQ: 'Убрать элемент из дела? Сам источник не удаляется.',
      kind: { chat: 'Чат', scan: 'Скан документа', agent_run: 'Результат агента', note: 'Заметка' },
      wf: { claim_draft: 'Проект искового заявления', tabular_review: 'Табличный анализ', playbook_review: 'Проверка по playbook', planned: 'Задача агента' },
      st: { queued: 'в очереди', running: 'выполняется', done: 'готово', failed: 'ошибка', cancelled: 'отменено', budget: 'лимит исчерпан', needs_input: 'нужны данные', awaiting_approval: 'ждёт подтверждения' },
      pages: '{n} стр.', status: 'Статус',
      add: 'Добавить в дело', pick: 'В какое дело добавить?', newHere: '+ Новое дело', itemTitle: 'Название элемента', added: 'Добавлено в дело', openM: 'Открыть',
      exists: 'Уже есть в этом деле', waitChat: 'Диалог ещё не сохранён, нажмите ещё раз через секунду.',
      waiting: 'Задача в очереди, ждём результат…', runGone: 'Результат агента не найден.',
      rows: 'Документов: {n}', results: 'Правил: {n}', counts: 'Соотв. {mos} · расх. {farq} · нет {yoq} · неясно {noaniq}', basis: 'Основание',
      noResult: 'Результат не сохранён (срок истёк или задача не завершена).',
      agent: 'Задача для агента', agentBeta: 'тест · только master', agentPh: 'Например: по договору и заметкам проанализируй, как вернуть аванс у подрядчика',
      plan: 'Составить план', planH: 'План агента', planHint: 'Пока ничего не списано. После подтверждения цена резервируется и шаги выполняются; если ответ не прошёл проверку по источникам, единица возвращается.',
      price: 'Цена: {p}', free: 'бесплатно', chatU: 'вопросов: {n}', approve: 'Подтвердить и начать', fallback: 'План модели не принят — предложен стандартный план.',
      running: 'Выполняется…', answer: 'Ответ', vf: { verified: 'Проверено по источникам', partial: 'Часть утверждений не подтвердилась и удалена', unverified: 'Проверка не сработала — сверьте ответ с источником вручную', no_claims: 'Утверждений с цифрами и сроками нет; цитаты сверены с источником' },
      sources: 'Источники',
      askH: 'Агент задаёт вопрос', askPh: 'Ваш ответ', askSend: 'Ответить и продолжить', askNote: 'После ответа цена резервируется снова и работа продолжается.',
      cmdPh: 'Команда: «мои дела», «новое дело: …», «заметка в дело …: …»', cmdRun: 'Выполнить', cmdMic: 'Голосовая команда', cmdListen: 'Говорите… (нажмите, чтобы остановить)', cmdBusy: 'Распознаём…', heardCheck: 'Проверьте текст, исправьте при необходимости и нажмите «Выполнить».',
      cmdHelp: 'Голосом или текстом: «мои дела» · «новое дело: Спор с подрядчиком» · «заметка в дело подряд: суд 12 ноября» · «покажи дело подряд» · «закрой дело подряд». Те же команды работают в Telegram-боте (если аккаунт привязан).',
      yes: 'Да', micDenied: 'Нет доступа к микрофону.',
    },
    en: {
      title: 'Matters', lead: 'Chats, documents, agent results and notes for one legal matter in one place.',
      new: 'New matter', search: 'Search matters', open: 'Open', closed: 'Closed', all: 'All',
      empty: 'No matters yet. Open one and add a chat, a table review, a playbook check or a claim draft to it.', emptyF: 'No matters in this filter.',
      items: '{n} items', ws: 'Workspace', ro: 'Read only',
      name: 'Matter name', namePh: 'E.g. dispute with the contractor', summary: 'Short description (optional)', summaryPh: 'Parties, situation, key dates',
      wsPick: 'Workspace (optional)', wsNone: 'Personal matter', create: 'Open', cancel: 'Cancel', save: 'Save',
      limit: 'See plans', back: 'Matters',
      edit: 'Edit', close: 'Close', reopen: 'Reopen', del: 'Delete', delQ: 'Delete the matter? Linked chats and documents stay; only the links go.',
      note: 'Add a note', notePh: 'E.g. hearing on 12 November, 10:00', addNote: 'Add',
      start: 'Start for this matter', startChat: 'Ask a question', startTable: 'Table review', startPb: 'Playbook', startClaim: 'Claim draft',
      startHint: 'The “Add to matter” button under a result picks this matter.',
      noItems: 'Nothing in this matter yet.', gone: 'unavailable', remove: 'Remove from matter', removeQ: 'Remove the item from the matter? The source itself stays.',
      kind: { chat: 'Chat', scan: 'Scanned document', agent_run: 'Agent result', note: 'Note' },
      wf: { claim_draft: 'Statement of claim draft', tabular_review: 'Table review', playbook_review: 'Playbook check', planned: 'Agent task' },
      st: { queued: 'queued', running: 'running', done: 'ready', failed: 'failed', cancelled: 'cancelled', budget: 'limit reached', needs_input: 'needs input', awaiting_approval: 'awaiting approval' },
      pages: '{n} pages', status: 'Status',
      add: 'Add to matter', pick: 'Which matter?', newHere: '+ New matter', itemTitle: 'Item name', added: 'Added to the matter', openM: 'Open',
      exists: 'Already in this matter', waitChat: 'The chat is not saved yet, press again in a second.',
      waiting: 'The job is queued, waiting for the result…', runGone: 'The agent result was not found.',
      rows: '{n} documents', results: '{n} rules', counts: 'Match {mos} · differs {farq} · missing {yoq} · unclear {noaniq}', basis: 'Basis',
      noResult: 'No result kept (expired, or the job did not finish).',
      agent: 'Task for the agent', agentBeta: 'trial · master only', agentPh: 'E.g. from the contract and the notes, analyse how to get the advance back from the contractor',
      plan: 'Make a plan', planH: 'Agent plan', planHint: 'Nothing is reserved yet. On approval the price is reserved and the steps run; if the answer does not pass the source check, the unit is returned.',
      price: 'Price: {p}', free: 'free', chatU: '{n} question units', approve: 'Approve and start', fallback: 'The model’s plan was not accepted — a standard plan is offered.',
      running: 'Running…', answer: 'Answer', vf: { verified: 'Checked against the sources', partial: 'Some claims were not confirmed by the sources and were removed', unverified: 'The checker did not run — check the answer against the source by hand', no_claims: 'No figure or deadline claims; quotes checked in the source' },
      sources: 'Sources',
      askH: 'The agent asks', askPh: 'Your answer', askSend: 'Answer and continue', askNote: 'After the answer the price is reserved again and the work continues.',
      cmdPh: 'Command (Uzbek or Russian): «ishlarim», «yangi ish och: …»', cmdRun: 'Run', cmdMic: 'Voice command', cmdListen: 'Speak… (press to stop)', cmdBusy: 'Transcribing…', heardCheck: 'Check the text, fix it if needed and press «Run».',
      cmdHelp: 'By voice or text, in Uzbek or Russian: «ishlarim» / «мои дела» · «yangi ish och: …» / «новое дело: …» · «… ishiga yozuv: …» · «… ishini yop». The same commands work in the Telegram bot (with a linked account).',
      yes: 'Yes', micDenied: 'Microphone access was refused.',
    },
  };
  function s(k, vars) {
    var d = S[J.lang] || S.uz, v = d[k] !== undefined ? d[k] : S.uz[k];
    if (vars && typeof v === 'string') Object.keys(vars).forEach(function (x) { v = v.replace('{' + x + '}', vars[x]); });
    return v;
  }
  var KIND_ICON = { chat: 'chat', scan: 'doc', agent_run: 'spark', note: 'pen' };
  var FINAL = ['done', 'failed', 'cancelled', 'budget', 'needs_input'];

  // the matter the person is working in: "Ishga qo'shish" picks it first
  function current() { try { return sessionStorage.getItem('jai-matter') || ''; } catch (e) { return ''; } }
  function setCurrent(id) { try { if (id) sessionStorage.setItem('jai-matter', id); else sessionStorage.removeItem('jai-matter'); } catch (e) { /* bo'lmasa ham ishlaydi */ } }

  /* ---------- navbatdagi agent ishini kutish ---------- */
  /** A route answered 202 { runId }: wait for the run and give its reply in J.api's shape. */
  J.followRun = async function (runId, onWait) {
    if (onWait) onWait(s('waiting'));
    var deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await J.sleep(2000);
      var r = await J.api('/api/agent/runs/' + encodeURIComponent(runId));
      if (r.status === 404) return { ok: false, status: 404, data: { message: s('runGone') } };
      if (r.ok && FINAL.indexOf(r.data.status) > -1 && r.data.result) {
        var code = r.data.result.httpStatus || 200, body = r.data.result.body || {};
        body.runId = runId;
        return { ok: code < 300, status: code, data: body };
      }
    }
    return { ok: false, status: 504, data: { message: s('waiting') } };
  };
  /** J.api for an agent route: a 202 is followed to the end. */
  J.agentApi = async function (path, opts, onWait) {
    var r = await J.api(path, opts);
    if (r.status === 202 && r.data && r.data.runId) r = await J.followRun(r.data.runId, onWait);
    return r;
  };

  /* ---------- "Ishga qo'shish" ---------- */
  J.matterButton = function () { return '<button class="pill sm ghost" data-a="mtadd" type="button">' + J.icon('folder') + esc(s('add')) + '</button>'; };
  J.matterText = s;

  async function writableMatters() {
    var r = await J.api('/api/matters');
    if (!r.ok) return { error: r.data };
    return { list: (r.data.matters || []).filter(function (m) { return m.status === 'open' && m.access === 'write'; }) };
  }

  /** opts: { kind: 'chat'|'scan'|'agent_run', ref, title }. Picks an open matter (or makes one) and links the item. */
  J.addToMatter = async function (opts) {
    var got = await writableMatters();
    if (got.error) { J.toast(J.errMsg(got.error), 5000); return false; }
    var list = got.list, cur = current();
    return new Promise(function (resolve) {
      var m = J.modal({ cls: 'sm', onClose: function () { resolve(false); }, html: '<h2>' + esc(s('add')) + '</h2>' +
        '<div class="field" style="margin-top:14px"><label>' + esc(s('pick')) + '</label><select class="inp mt-pick">' +
        list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.title) + '</option>'; }).join('') +
        '<option value="__new"' + (list.length ? '' : ' selected') + '>' + esc(s('newHere')) + '</option></select></div>' +
        '<div class="field mt-newf"' + (list.length ? ' hidden' : '') + '><label>' + esc(s('name')) + '</label><input class="inp mt-name" maxlength="160" placeholder="' + esc(s('namePh')) + '"></div>' +
        '<div class="field"><label>' + esc(s('itemTitle')) + '</label><input class="inp mt-title" maxlength="240"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button type="button" class="pill ghost" data-a="no">' + esc(s('cancel')) + '</button><button type="button" class="pill" data-a="ok">' + esc(s('add')) + '</button></div>' });
      J.selects(m.body);
      var pick = $('.mt-pick', m.body), newf = $('.mt-newf', m.body);
      $('.mt-title', m.body).value = String(opts.title || '').slice(0, 240);
      pick.addEventListener('change', function () { newf.hidden = pick.value !== '__new'; });
      $('[data-a=no]', m.body).onclick = function () { m.close(); };
      $('[data-a=ok]', m.body).onclick = async function () {
        var btn = this, id = pick.value;
        btn.disabled = true;
        if (id === '__new') {
          var name = $('.mt-name', m.body).value.trim();
          var c = await J.api('/api/matters', { method: 'POST', body: { title: name } });
          if (!c.ok) { btn.disabled = false; J.toast(J.errMsg(c.data), 6000); return; }
          id = c.data.id;
        }
        var x = await J.api('/api/matters/' + encodeURIComponent(id) + '/items', { method: 'POST', body: { kind: opts.kind, ref: opts.ref, title: $('.mt-title', m.body).value.trim() } });
        btn.disabled = false;
        if (!x.ok && x.status !== 409) { J.toast(J.errMsg(x.data), 6000); return; }
        m.el.remove(); resolve(true);
        setCurrent(id);
        J.toast(x.status === 409 ? s('exists') : s('added'));
      };
    });
  };
  /** Wires the button a result page drew with J.matterButton(). */
  J.wireMatterButton = function (root, get) {
    var b = $('[data-a=mtadd]', root);
    if (b) b.onclick = function () { var o = get(); if (o) J.addToMatter(o); };
  };

  /* ---------- #/ishlar ---------- */
  function statusTag(m) {
    return m.status === 'closed' ? '<span class="mt-tag">' + esc(s('closed')) + '</span>' : '';
  }
  async function newMatterModal(onDone) {
    var ws = await J.api('/api/workspaces');
    var wsl = ws.ok ? (ws.data.workspaces || []).filter(function (w) { return w.is_active && w.role !== 'viewer'; }) : [];
    var m = J.modal({ cls: 'sm', html: '<h2>' + esc(s('new')) + '</h2>' +
      '<div class="field" style="margin-top:14px"><label>' + esc(s('name')) + '</label><input class="inp mt-name" maxlength="160" placeholder="' + esc(s('namePh')) + '"></div>' +
      '<div class="field"><label>' + esc(s('summary')) + '</label><textarea class="inp mt-sum" maxlength="4000" placeholder="' + esc(s('summaryPh')) + '"></textarea></div>' +
      (wsl.length ? '<div class="field"><label>' + esc(s('wsPick')) + '</label><select class="inp mt-ws"><option value="">' + esc(s('wsNone')) + '</option>' + wsl.map(function (w) { return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>'; }).join('') + '</select></div>' : '') +
      '<div class="mt-err"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button type="button" class="pill ghost" data-a="no">' + esc(s('cancel')) + '</button><button type="button" class="pill" data-a="ok">' + esc(s('create')) + '</button></div>' });
    J.selects(m.body);
    $('.mt-name', m.body).focus();
    $('[data-a=no]', m.body).onclick = function () { m.close(); };
    $('[data-a=ok]', m.body).onclick = async function () {
      var btn = this; btn.disabled = true;
      var wsEl = $('.mt-ws', m.body);
      var r = await J.api('/api/matters', { method: 'POST', body: { title: $('.mt-name', m.body).value.trim(), summary: $('.mt-sum', m.body).value.trim(), workspaceId: wsEl && wsEl.value ? wsEl.value : null } });
      btn.disabled = false;
      if (!r.ok) {
        $('.mt-err', m.body).innerHTML = '<div class="note-blue">' + esc(J.errMsg(r.data)) + (r.status === 402 ? ' <a href="/tariff.html">' + esc(s('limit')) + ' →</a>' : '') + '</div>';
        return;
      }
      m.close(); onDone(r.data);
    };
  }

  /* ---------- ovozli yoki matnli buyruq (src/matters/commands.js, POST /api/matters/command) ---------- */
  function cmdBar() {
    return '<div class="mt-cmd"><div class="mt-cmd-row"><input class="inp mt-cmd-in" maxlength="300" placeholder="' + esc(s('cmdPh')) + '">' +
      '<button class="ib mt-mic" type="button" title="' + esc(s('cmdMic')) + '" hidden>' + J.icon('mic') + '</button>' +
      '<button class="pill sm" data-a="cmd" type="button">' + esc(s('cmdRun')) + '</button></div>' +
      '<p class="mt-cmd-st muted"></p><p class="mt-cmd-help muted">' + esc(s('cmdHelp')) + '</p></div>';
  }
  /** Wires a command bar; `matterId` is the matter on screen (the default for "yozuv qo'sh: …"). */
  function wireCmd(root, matterId, after) {
    var input = $('.mt-cmd-in', root), st = $('.mt-cmd-st', root), mic = $('.mt-mic', root), go = $('[data-a=cmd]', root);
    var awaitingTitle = false;
    async function run(text, extra) {
      if (!extra && !String(text || '').trim()) { input.focus(); return; }
      // "yangi ish och" came with no name: the next words are the name (unless they are a command)
      if (!extra && awaitingTitle && !/^(?:yangi ish|ish och|ishlar|новое дело|мои дела)/i.test(String(text).trim())) text = (J.lang === 'ru' ? 'новое дело: ' : 'yangi ish och: ') + String(text).trim();
      awaitingTitle = false;
      go.disabled = true; st.textContent = '';
      var r = await J.api('/api/matters/command', { method: 'POST', body: extra || { text: text, lastMatterId: matterId || current() || null, lang: J.lang === 'ru' ? 'ru' : 'uz' } });
      go.disabled = false;
      if (!r.ok) { st.textContent = J.errMsg(r.data); return; }
      var d = r.data;
      if (d.confirm) {
        st.innerHTML = '';
        var box = J.h('<span class="mt-cmd-confirm"><span></span> <button class="pill sm" type="button" data-c="y">' + esc(s('yes')) + '</button> <button class="pill sm ghost" type="button" data-c="n">' + esc(s('cancel')) + '</button></span>');
        $('span', box).textContent = d.reply;
        st.appendChild(box);
        $('[data-c=y]', box).onclick = function () { run(null, { confirm: d.confirm.token, lang: J.lang === 'ru' ? 'ru' : 'uz' }); };
        $('[data-c=n]', box).onclick = function () { J.api('/api/matters/command', { method: 'POST', body: { cancel: d.confirm.token } }); st.textContent = ''; };
        return;
      }
      input.value = '';
      if (d.needsTitle) { awaitingTitle = true; st.textContent = d.reply; input.focus(); return; }
      if (d.matterId) setCurrent(d.matterId);
      // a command that redraws the page says what it did in a toast (the bar is drawn again)
      if ((d.action === 'matter_created' || d.action === 'matter_shown') && d.matterId) { J.toast(d.reply, 5000); J.go('#/ishlar/' + d.matterId); return; }
      if (after && /^matter_(noted|closed|reopened)$/.test(d.action)) { J.toast(d.reply, 5000); after(d); return; }
      st.textContent = d.reply || '';
    }
    /** the dictated text waits in the box; a glossary suggestion is one click away */
    function heardCheck(sugg) {
      st.innerHTML = '';
      var box = J.h('<span class="mt-heard"><span class="mt-heard-t"></span></span>');
      $('.mt-heard-t', box).textContent = s('heardCheck');
      sugg.forEach(function (x) {
        var b = J.h('<button type="button" class="chip mt-sugg"></button>');
        b.textContent = x.from + ' → ' + x.to;
        b.onclick = function () { input.value = input.value.split(x.from).join(x.to); b.remove(); input.focus(); };
        box.appendChild(b);
      });
      st.appendChild(box);
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* eski brauzer */ }
    }
    go.onclick = function () { run(input.value); };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(input.value); } });
    // the microphone: the same dictation as the chat (POST /api/voice/dictate); the text waits in the box to be checked
    if (!G.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    if (J.dictationOk === undefined) J.dictationOk = J.api('/api/voice/balance').then(function (x) { return !!(x.ok && x.data && x.data.dictation); });
    J.dictationOk.then(function (ok) { mic.hidden = !ok; });
    var rec = null, stopAt = null, meter = null;
    mic.onclick = async function () {
      if (rec && rec.state === 'recording') { rec.stop(); return; }
      var stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { J.toast(s('micDenied')); return; }
      var chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = async function () {
        clearTimeout(stopAt); stream.getTracks().forEach(function (tr) { tr.stop(); });
        if (meter) { meter.stop(); meter = null; }
        mic.classList.remove('on'); mic.disabled = true; st.textContent = s('cmdBusy');
        var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), fd = new FormData();
        fd.append('file', blob, 'command.' + (/ogg/.test(blob.type) ? 'ogg' : /mp4|aac/.test(blob.type) ? 'm4a' : 'webm'));
        fd.append('lang', J.lang === 'ru' ? 'ru' : 'uz');
        var r = await J.api('/api/voice/dictate', { method: 'POST', body: fd });
        mic.disabled = false;
        if (!r.ok) { st.textContent = J.errMsg(r.data); return; }
        // the heard text is checked before it runs (2026-10-28: "Pudratchi" was heard as "Qudratxo'ja")
        input.value = r.data.text || '';
        heardCheck(r.data.suggestions || []);
      };
      rec.start();
      mic.classList.add('on'); st.textContent = '';
      meter = J.micMeter(stream, st, { label: s('cmdListen') });
      stopAt = setTimeout(function () { if (rec && rec.state === 'recording') rec.stop(); }, 30000);
    };
  }

  J.viewMatters = function () {
    J.setTitle(s('title'));
    var filter = 'open';
    var v = J.mount('<div class="wrap narrow"><div class="vh"><div><h2>' + esc(s('title')) + '</h2><p>' + esc(s('lead')) + '</p></div><button class="pill" data-a="new" type="button">' + J.icon('plus') + esc(s('new')) + '</button></div>' +
      cmdBar() +
      '<div class="mt-bar"><div class="search">' + J.icon('search') + '<input class="inp" placeholder="' + esc(s('search')) + '"></div>' +
      '<div class="seg">' + ['open', 'closed', 'all'].map(function (f) { return '<button type="button" data-f="' + f + '" class="' + (f === filter ? 'on' : '') + '">' + esc(s(f)) + '</button>'; }).join('') + '</div></div>' +
      '<div class="rows mt-list"><div class="skel" style="width:70%;margin:14px 0"></div><div class="skel" style="width:50%"></div></div></div>');
    var all = [];
    function draw() {
      var q = ($('input', v).value || '').toLowerCase();
      var list = all.filter(function (m) { return (filter === 'all' || m.status === filter) && (!q || (m.title + ' ' + (m.summary || '')).toLowerCase().indexOf(q) > -1); });
      $('.mt-list', v).innerHTML = list.length ? list.map(function (m) {
        return '<a class="row mt-row" href="#/ishlar/' + esc(m.id) + '">' + J.icon('folder') +
          '<span><b class="mt-ttl">' + esc(m.title) + '</b>' + (m.summary ? '<small class="mt-sum1">' + esc(m.summary) + '</small>' : '') + '</span>' +
          '<span class="mt-meta">' + statusTag(m) + (m.workspaceId ? '<span class="mt-tag">' + esc(s('ws')) + '</span>' : '') + (m.access === 'read' ? '<span class="mt-tag">' + esc(s('ro')) + '</span>' : '') +
          '<small>' + esc(s('items', { n: m.items || 0 })) + ' · ' + esc(J.fmtDate(m.updatedAt)) + '</small></span></a>';
      }).join('') : '<div class="empty-state">' + esc(all.length ? s('emptyF') : s('empty')) + '</div>';
    }
    async function load() {
      var r = await J.api('/api/matters');
      if (!document.body.contains(v)) return;
      if (!r.ok) { $('.mt-list', v).innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      all = r.data.matters || []; draw();
    }
    $('input', v).oninput = draw;
    $$('[data-f]', v).forEach(function (b) { b.onclick = function () { filter = b.dataset.f; $$('[data-f]', v).forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
    wireCmd(v, null, function () { load(); });
    $('[data-a=new]', v).onclick = function () { newMatterModal(function (m) { setCurrent(m.id); J.go('#/ishlar/' + m.id); }); };
    load();
  };

  /* ---------- #/ishlar/:id ---------- */
  function runSummary(run) {
    var res = run.result && run.result.body;
    if (!res) return '<p class="muted">' + esc(s('noResult')) + '</p>';
    if (run.workflow === 'claim_draft' && res.draftHtml) {
      return (res.basis && res.basis.length ? '<h4>' + esc(s('basis')) + '</h4><ul class="mt-basis">' + res.basis.map(function (b) { return '<li><b>' + esc(b.act) + (b.article ? ', ' + esc(b.article) + '-modda' : '') + '</b>' + (b.url ? ' <a href="' + esc(b.url) + '" target="_blank" rel="noopener">lex.uz ↗</a>' : '') + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="ag-doc doc-prev mt-doc"></div>';
    }
    if (run.workflow === 'tabular_review' && res.rows) {
      var cols = res.columns || [];
      return '<p class="muted" style="margin-bottom:10px">' + esc(s('rows', { n: res.rows.length })) + '</p><div class="tb-wrap"><table class="tb-grid"><thead><tr><th></th>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        res.rows.map(function (r) { return '<tr><th scope="row"><b>' + esc(r.name) + '</b></th>' + cols.map(function (c) { var x = r.cells && r.cells[c.id]; return '<td>' + esc(x ? (x.notFound ? '—' : x.answer) : '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    }
    if (run.workflow === 'planned' && res.answer) {
      var vf = res.verification || {};
      return '<div class="md">' + J.md(res.answer, { answer: true }).html + '</div>' +
        (vf.status ? '<p class="mt-vf">' + esc((s('vf')[vf.status] || vf.status)) + '</p>' : '') +
        ((res.sources || []).length ? '<h4 style="margin-top:14px">' + esc(s('sources')) + '</h4><ul class="mt-basis">' + res.sources.map(function (x) { return '<li>' + esc(x.act) + (x.article ? ', ' + esc(x.article) + '-modda' : '') + (x.url ? ' <a href="' + esc(x.url) + '" target="_blank" rel="noopener">lex.uz ↗</a>' : '') + '</li>'; }).join('') + '</ul>' : '');
    }
    if (run.workflow === 'playbook_review' && res.results) {
      var c = res.counts || {};
      return '<p class="muted" style="margin-bottom:10px">' + esc(s('counts', { mos: c.mos || 0, farq: c.farq || 0, yoq: c.yoq || 0, noaniq: c.noaniq || 0 })) + '</p><ul class="mt-basis">' +
        res.results.map(function (x) { return '<li><b>' + esc((x.rule && x.rule.title) || x.id) + '</b> — ' + esc(x.status) + (x.note ? '<br><small class="muted">' + esc(x.note) + '</small>' : '') + '</li>'; }).join('') + '</ul>';
    }
    return '<p class="muted">' + esc(res.message || s('noResult')) + '</p>';
  }
  async function openRun(item, onChange) {
    var r = await J.api('/api/agent/runs/' + encodeURIComponent(item.ref));
    if (!r.ok) { J.toast(r.status === 404 ? s('runGone') : J.errMsg(r.data), 5000); return; }
    var run = r.data;
    var asking = run.status === 'needs_input' && run.result && run.result.body && run.result.body.question;
    var m = J.modal({ html: '<div class="kicker">' + esc(s('wf')[run.workflow] || run.workflow) + ' · ' + esc(J.fmtDate(run.finishedAt || run.createdAt)) + '</div><h2 style="margin:6px 0 14px">' + esc(item.title) + '</h2>' +
      '<div class="mt-run">' + (asking ? askHtml(run.result.body.question) : runSummary(run)) + '</div>' });
    var doc = $('.mt-doc', m.body);
    if (doc) doc.innerHTML = run.result.body.draftHtml; // sanitized on the server (src/rag/safe-html.js)
    if (asking) wireAsk(m.body, run.id, onChange);
  }
  function askHtml(q) {
    return '<div class="mt-ask"><b>' + esc(s('askH')) + '</b><p class="mt-ask-q"></p><textarea class="inp mt-ask-a" maxlength="2000" placeholder="' + esc(s('askPh')) + '"></textarea>' +
      '<p class="muted" style="font-size:12.5px;margin-top:6px">' + esc(s('askNote')) + '</p><div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="pill sm" type="button" data-a="ask">' + esc(s('askSend')) + '</button></div></div>';
  }
  /** The run asked (ask_user): the answer is sent, the run followed in the same window to its result. */
  function wireAsk(root, runId, onChange) {
    var run0 = null;
    J.api('/api/agent/runs/' + encodeURIComponent(runId)).then(function (r) { run0 = r.ok ? r.data : null; if (run0 && run0.result) $('.mt-ask-q', root).textContent = run0.result.body.question || ''; });
    $('[data-a=ask]', root).onclick = async function () {
      var btn = this, ta = $('.mt-ask-a', root), text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      btn.disabled = true;
      var r = await J.api('/api/agent/runs/' + encodeURIComponent(runId) + '/input', { method: 'POST', body: { answer: text } });
      if (!r.ok) { btn.disabled = false; J.toast(J.errMsg(r.data), 6000); return; }
      var box = $('.mt-run', root);
      box.innerHTML = '<div style="display:flex;gap:10px;align-items:center"><span class="spin"></span>' + esc(s('running')) + '</div>';
      for (var i = 0; i < 800; i++) {
        await J.sleep(1500);
        if (!document.body.contains(box)) return;
        var x = await J.api('/api/agent/runs/' + encodeURIComponent(runId));
        if (!x.ok) return;
        if (['done', 'failed', 'cancelled', 'budget', 'needs_input'].indexOf(x.data.status) > -1) {
          box.innerHTML = x.data.status === 'needs_input' && x.data.result && x.data.result.body.question ? askHtml(x.data.result.body.question) : runSummary(x.data);
          if (x.data.status === 'needs_input') wireAsk(root, runId, onChange);
          if (onChange) onChange();
          return;
        }
      }
    };
  }

  J.viewMatter = function (id) {
    J.setTitle(s('title'));
    var v = J.mount('<div class="wrap narrow"><a class="mt-back" href="#/ishlar">' + J.icon('back') + esc(s('back')) + '</a><div class="mt-body"><div class="skel" style="width:60%;margin:20px 0"></div></div></div>');
    var body = $('.mt-body', v), M = null;

    function itemRow(i) {
      var sub = s('kind')[i.kind] || i.kind;
      if (i.kind === 'agent_run' && i.workflow) {
        var wfName = s('wf')[i.workflow] || i.workflow;
        sub = (i.title === wfName || i.title === S.uz.wf[i.workflow] ? '' : wfName + ' · ') + (s('st')[i.status] || i.status || '');
      }
      if (i.kind === 'scan' && i.pages) sub += ' · ' + s('pages', { n: i.pages });
      if (i.available === false) sub += ' · ' + s('gone');
      var clickable = i.available !== false && (i.kind === 'chat' || i.kind === 'agent_run');
      return '<div class="mt-item' + (clickable ? ' go' : '') + (i.available === false ? ' gone' : '') + '" data-i="' + esc(i.id) + '">' +
        '<span class="mt-ic">' + J.icon(KIND_ICON[i.kind] || 'doc') + '</span>' +
        '<div class="mt-it">' + (i.kind === 'note' ? '<p class="mt-note"></p>' : '<b>' + esc(i.title) + '</b>') + '<small>' + esc(sub) + ' · ' + esc(J.fmtDate(i.createdAt)) + '</small></div>' +
        (M.access === 'write' ? '<button class="ib" data-rm="' + esc(i.id) + '" title="' + esc(s('remove')) + '" type="button">' + J.icon('x') + '</button>' : '') + '</div>';
    }

    function priceText(price) {
      var parts = Object.keys(price || {}).filter(function (k) { return price[k] > 0; }).map(function (k) { return k === 'chat' ? s('chatU', { n: price[k] }) : k + ': ' + price[k]; });
      return s('price', { p: parts.length ? parts.join(', ') : s('free') });
    }
    function argText(n) {
      var a = n.args || {};
      return a.query || a.question || '';
    }
    // the planner (PR-D): plan -> the person approves the steps and the price -> the run -> its answer
    async function agentPlan(btn) {
      var box = $('.mt-plan', body), ta = $('.mt-task', body), task = ta.value.trim();
      if (task.length < 10) { ta.focus(); return; }
      btn.disabled = true;
      box.innerHTML = '<div style="display:flex;gap:10px;align-items:center;margin-top:12px"><span class="spin"></span>' + esc(s('running')) + '</div>';
      var r = await J.api('/api/agent/plan', { method: 'POST', body: { task: task, matterId: M.id } });
      btn.disabled = false;
      if (!r.ok) { box.innerHTML = '<div class="note-blue" style="margin-top:12px">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      var d = r.data;
      box.innerHTML = '<div class="mt-plan-b"><b>' + esc(s('planH')) + '</b>' + (d.source === 'fallback' ? '<p class="muted" style="font-size:13px">' + esc(s('fallback')) + '</p>' : '') +
        '<ol class="ag-steps mt-steps">' + d.plan.nodes.map(function (n) { return '<li data-n="' + esc(n.id) + '"><span class="ag-dot"></span><span style="flex:1">' + esc(n.label) + (argText(n) ? '<small class="muted"> — ' + esc(argText(n)) + '</small>' : '') + '</span><small class="muted mt-ms"></small></li>'; }).join('') + '</ol>' +
        '<p class="note-blue" style="margin-top:12px;font-size:13.5px">' + esc(priceText(d.price)) + '. ' + esc(s('planHint')) + '</p>' +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="pill sm" data-a="approve" type="button">' + esc(s('approve')) + '</button><button class="pill sm ghost" data-a="cancelplan" type="button">' + esc(s('cancel')) + '</button></div></div>';
      $('[data-a=cancelplan]', box).onclick = async function () { await J.api('/api/agent/runs/' + encodeURIComponent(d.runId) + '/cancel', { method: 'POST' }); load(); };
      $('[data-a=approve]', box).onclick = async function () {
        var ab = this; ab.disabled = true;
        var a = await J.api('/api/agent/runs/' + encodeURIComponent(d.runId) + '/approve', { method: 'POST' });
        if (!a.ok) { ab.disabled = false; J.toast(J.errMsg(a.data), 6000); return; }
        $$('button', box).forEach(function (b) { b.remove(); });
        follow(d.runId, box);
      };
    }
    async function follow(runId, box) {
      var FINALS = ['done', 'failed', 'cancelled', 'budget', 'needs_input'];
      for (var i = 0; i < 800; i++) {
        await J.sleep(1500);
        if (!document.body.contains(box)) return;
        var r = await J.api('/api/agent/runs/' + encodeURIComponent(runId));
        if (!r.ok) return;
        (r.data.steps || []).forEach(function (st) {
          var li = $('[data-n="' + st.id + '"]', box); if (!li) return;
          li.className = st.status === 'ok' ? 'done' : (st.status === 'running' ? 'cur' : 'bad');
          var ms = $('.mt-ms', li); if (ms && st.ms != null) ms.textContent = (st.ms / 1000).toFixed(1) + ' s';
        });
        var next = $('.mt-steps li:not(.done):not(.bad)', box); if (next && r.data.status === 'running') next.className = 'cur';
        if (FINALS.indexOf(r.data.status) > -1) {
          await load();
          var it = (M.items || []).filter(function (x) { return x.ref === runId; })[0];
          openRun(it || { ref: runId, title: s('agent') }, load);
          return;
        }
      }
    }

    function draw() {
      J.setTitle(M.title);
      var w = M.access === 'write', own = M.own;
      body.innerHTML = '<div class="vh mt-head"><div><h2></h2>' +
        '<div class="mt-meta">' + statusTag(M) + (M.workspaceId ? '<span class="mt-tag">' + esc(s('ws')) + '</span>' : '') + (w ? '' : '<span class="mt-tag">' + esc(s('ro')) + '</span>') + '<small>' + esc(s('items', { n: M.items.length })) + '</small></div>' +
        '<p class="mt-summary"></p></div>' +
        (w ? '<div class="mt-acts"><button class="pill sm ghost" data-a="edit" type="button">' + J.icon('pen') + esc(s('edit')) + '</button>' +
          '<button class="pill sm ghost" data-a="toggle" type="button">' + esc(M.status === 'open' ? s('close') : s('reopen')) + '</button>' +
          (own ? '<button class="pill sm ghost" data-a="del" type="button">' + J.icon('trash') + esc(s('del')) + '</button>' : '') + '</div>' : '') + '</div>' +
        (w && M.status === 'open' ? '<div class="card mt-start"><h4>' + esc(s('start')) + '</h4><div class="mt-starts">' +
          '<a class="chip" href="#/c/new" data-go="chat">' + J.icon('chat') + esc(s('startChat')) + '</a>' +
          '<a class="chip" href="#/jadval">' + J.icon('layers') + esc(s('startTable')) + '</a>' +
          '<a class="chip" href="#/playbook">' + J.icon('book') + esc(s('startPb')) + '</a>' +
          '<a class="chip" href="#/agent/dava">' + J.icon('scale') + esc(s('startClaim')) + '</a></div>' +
          '<p class="muted" style="font-size:13px;margin-top:10px">' + esc(s('startHint')) + '</p></div>' : '') +
        (w && M.status === 'open' && J.isMaster && J.isMaster() ? '<div class="card mt-agent"><h4>' + esc(s('agent')) + ' <span class="mt-tag">' + esc(s('agentBeta')) + '</span></h4>' +
          '<textarea class="inp mt-task" maxlength="2000" placeholder="' + esc(s('agentPh')) + '"></textarea>' +
          '<div class="mt-agent-b"><button class="pill sm" data-a="plan" type="button">' + J.icon('spark') + esc(s('plan')) + '</button></div><div class="mt-plan"></div></div>' : '') +
        (w ? cmdBar() : '') +
        (w ? '<div class="mt-noteform"><textarea class="inp" maxlength="8000" placeholder="' + esc(s('notePh')) + '"></textarea><button class="pill sm" data-a="note" type="button">' + J.icon('plus') + esc(s('addNote')) + '</button></div>' : '') +
        '<div class="mt-items">' + (M.items.length ? M.items.map(itemRow).join('') : '<div class="empty-state">' + esc(s('noItems')) + '</div>') + '</div>';
      $('.mt-head h2', body).textContent = M.title;
      $('.mt-summary', body).textContent = M.summary || '';
      M.items.forEach(function (i) { if (i.kind === 'note') { var p = $('[data-i="' + i.id + '"] .mt-note', body); if (p) p.textContent = i.note; } });
      setCurrent(M.status === 'open' && w ? M.id : '');

      var chatGo = $('[data-go=chat]', body);
      if (chatGo) chatGo.onclick = function (e) { e.preventDefault(); J.newChat(); };
      $$('.mt-item.go', body).forEach(function (row) {
        row.onclick = function (e) {
          if (e.target.closest('[data-rm]')) return;
          var it = M.items.filter(function (x) { return x.id === row.dataset.i; })[0];
          if (it.kind === 'chat') J.go('#/c/' + it.ref);
          else if (it.kind === 'agent_run') openRun(it, load);
        };
      });
      $$('[data-rm]', body).forEach(function (b) {
        b.onclick = async function () {
          if (!(await J.confirm(s('removeQ'), s('remove')))) return;
          var r = await J.api('/api/matters/' + encodeURIComponent(M.id) + '/items/' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' });
          if (!r.ok && r.status !== 204) { J.toast(J.errMsg(r.data)); return; }
          load();
        };
      });
      var nb = $('[data-a=note]', body);
      if (nb) nb.onclick = async function () {
        var ta = $('.mt-noteform textarea', body), text = ta.value.trim();
        if (!text) { ta.focus(); return; }
        nb.disabled = true;
        var r = await J.api('/api/matters/' + encodeURIComponent(M.id) + '/items', { method: 'POST', body: { kind: 'note', note: text } });
        nb.disabled = false;
        if (!r.ok) { J.toast(J.errMsg(r.data)); return; }
        load();
      };
      if ($('.mt-cmd', body)) wireCmd(body, M.id, function (d) { if (d.matterId === M.id) load(); });
      var pb = $('[data-a=plan]', body);
      if (pb) pb.onclick = function () { agentPlan(pb); };
      var eb = $('[data-a=edit]', body);
      if (eb) eb.onclick = function () {
        var m = J.modal({ cls: 'sm', html: '<h2>' + esc(s('edit')) + '</h2><div class="field" style="margin-top:14px"><label>' + esc(s('name')) + '</label><input class="inp mt-name" maxlength="160"></div>' +
          '<div class="field"><label>' + esc(s('summary')) + '</label><textarea class="inp mt-sum" maxlength="4000"></textarea></div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button type="button" class="pill ghost" data-a="no">' + esc(s('cancel')) + '</button><button type="button" class="pill" data-a="ok">' + esc(s('save')) + '</button></div>' });
        $('.mt-name', m.body).value = M.title; $('.mt-sum', m.body).value = M.summary || '';
        $('[data-a=no]', m.body).onclick = function () { m.close(); };
        $('[data-a=ok]', m.body).onclick = async function () {
          var r = await J.api('/api/matters/' + encodeURIComponent(M.id), { method: 'PATCH', body: { title: $('.mt-name', m.body).value.trim(), summary: $('.mt-sum', m.body).value } });
          if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return; }
          m.close(); load();
        };
      };
      var tb = $('[data-a=toggle]', body);
      if (tb) tb.onclick = async function () {
        var r = await J.api('/api/matters/' + encodeURIComponent(M.id), { method: 'PATCH', body: { status: M.status === 'open' ? 'closed' : 'open' } });
        if (!r.ok) { J.toast(J.errMsg(r.data), 6000); return; }
        load();
      };
      var db = $('[data-a=del]', body);
      if (db) db.onclick = async function () {
        if (!(await J.confirm(s('delQ'), s('del')))) return;
        var r = await J.api('/api/matters/' + encodeURIComponent(M.id), { method: 'DELETE' });
        if (!r.ok && r.status !== 204) { J.toast(J.errMsg(r.data)); return; }
        setCurrent(''); J.go('#/ishlar');
      };
    }

    async function load() {
      var r = await J.api('/api/matters/' + encodeURIComponent(id));
      if (!document.body.contains(v)) return;
      if (!r.ok) { body.innerHTML = '<div class="empty-state">' + esc(J.errMsg(r.data)) + '</div>'; return; }
      M = r.data; draw();
    }
    load();
  };

  J.route(/^\/ishlar$/, function () { J.viewMatters(); });
  J.route(/^\/ishlar\/([0-9a-f-]{36})$/, function (id) { J.viewMatter(id); });
})(window);
