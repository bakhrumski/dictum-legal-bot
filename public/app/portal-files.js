/* Mijoz portali P3 (2026-11-10, docs/design/mijoz-portali.md §P3): hujjat so'rovi va mijozning fayllari.
   Yurist: ish sahifasidagi "Mijoz portali" kartasida — so'rov ochadi (nomi, muddati), kelgan faylni yuklab oladi yoki
   "Nima qilaylik?" bilan odatdagi hujjat eshigiga beradi (matnli fayl Hujjatlarimga tushadi; skaner OCR narxini avval
   ko'rsatadi va yuristning limitidan hisoblanadi), so'rovni "qabul qilindi" deb belgilaydi.
   Mijoz: #/portal/<id> da so'rov yonidagi tugma bilan fayl yuklaydi (yoki botga yuboradi). Fayl serverda shifrlanadi;
   hech narsa uni o'qimaydi: AI yo'q, OCR yo'q, limit yo'q. Server: src/matters/portal-files.js. */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, $$ = J.$$, esc = J.esc;
  var S = {
    uz: { hL: 'Mijozdan hujjat so‘rash', leadL: 'Mijoz faylni saytda yoki botga yuborib yuklaydi. Fayl shifrlangan holda saqlanadi; uni hech narsa o‘qimaydi, toki o‘zingiz xizmat tanlamaguningizcha.',
      ph: 'Qaysi hujjat kerak: masalan, Pasport nusxasi', ask: 'So‘rash', due: 'Muddati', until: '{d} gacha', none: 'Hali so‘rov yo‘q.', noFile: 'Fayl kelmagan.',
      done: 'Qabul qilindi', markDone: 'Qabul qilindi', reopen: 'Qayta ochish', rm: 'Olib tashlash', rmQ: 'So‘rov olib tashlanadi. Unga kelgan fayllar ishda qoladi.', rmFQ: 'Fayl butunlay o‘chiriladi.',
      dl: 'Yuklab olish', act: 'Nima qilaylik?', loose: 'So‘rovsiz yuborilgan fayllar', by: '{n} · {d}', tg: ' · Telegram', reading: 'Fayl o‘qilmoqda…',
      hC: 'Yurist so‘ragan hujjatlar', leadC: 'Faylni shu yerda yuklang yoki Telegram botga yuboring — bot qaysi so‘rovga ekanini so‘raydi. Fayl shifrlangan holda saqlanadi.',
      up: 'Fayl yuklash', upFree: 'Yuristga boshqa fayl yuborish', mine: 'Siz yuborgan fayllar', sent: 'Fayl yuristga yuborildi', sending: 'Yuklanmoqda…', big: 'Fayl {mb} MB dan oshmasin', del: 'O‘chirish' },
    ru: { hL: 'Запросить документ у клиента', leadL: 'Клиент загружает файл на сайте или отправляет его боту. Файл хранится в зашифрованном виде; его ничто не читает, пока вы сами не выберете услугу.',
      ph: 'Какой документ нужен: например, копия паспорта', ask: 'Запросить', due: 'Срок', until: 'до {d}', none: 'Запросов пока нет.', noFile: 'Файл не пришёл.',
      done: 'Принято', markDone: 'Принято', reopen: 'Открыть снова', rm: 'Убрать', rmQ: 'Запрос будет убран. Присланные по нему файлы останутся в деле.', rmFQ: 'Файл будет удалён навсегда.',
      dl: 'Скачать', act: 'Что сделать?', loose: 'Файлы без запроса', by: '{n} · {d}', tg: ' · Telegram', reading: 'Файл читается…',
      hC: 'Документы, которые просит юрист', leadC: 'Загрузите файл здесь или отправьте его в Telegram-бот — бот спросит, для какого он запроса. Файл хранится в зашифрованном виде.',
      up: 'Загрузить файл', upFree: 'Отправить юристу другой файл', mine: 'Ваши файлы', sent: 'Файл отправлен юристу', sending: 'Загрузка…', big: 'Файл не больше {mb} МБ', del: 'Удалить' },
    en: { hL: 'Ask the client for a document', leadL: 'The client uploads a file on the site or sends it to the bot. The file is stored encrypted; nothing reads it until you choose a service yourself.',
      ph: 'Which document: e.g. a copy of the passport', ask: 'Ask', due: 'Due', until: 'until {d}', none: 'No requests yet.', noFile: 'No file yet.',
      done: 'Received', markDone: 'Received', reopen: 'Reopen', rm: 'Remove', rmQ: 'The request will be removed. Files sent to it stay in the matter.', rmFQ: 'The file will be deleted for good.',
      dl: 'Download', act: 'What shall we do?', loose: 'Files sent without a request', by: '{n} · {d}', tg: ' · Telegram', reading: 'Reading the file…',
      hC: 'Documents your lawyer asked for', leadC: 'Upload the file here or send it to the Telegram bot — the bot asks which request it is for. The file is stored encrypted.',
      up: 'Upload a file', upFree: 'Send the lawyer another file', mine: 'Files you sent', sent: 'The file was sent to your lawyer', sending: 'Uploading…', big: 'The file must be under {mb} MB', del: 'Delete' }
  };
  function s(k, v) { var d = S[J.lang] || S.uz, x = d[k] !== undefined ? d[k] : S.uz[k]; if (v) Object.keys(v).forEach(function (n) { x = x.replace('{' + n + '}', v[n]); }); return x; }
  // what the ordinary document door reads (chat.js readFile): text PDF / Word, or a scan / photo with its OCR price shown first
  var DOOR = /\.(pdf|docx|png|jpe?g|webp|heic)$/i;
  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  /** host: an element; o: { matterId, side: 'lawyer' | 'client', canWrite } */
  J.portalFiles = function (host, o) {
    var L = o.side === 'lawyer';
    var url = L ? '/api/matters/' + encodeURIComponent(o.matterId) + '/portal' : '/api/portal/' + encodeURIComponent(o.matterId);
    var D = null;

    function fileRow(f) {
      var can = L ? o.canWrite : (f.mine && D.canUpload);
      return '<div class="pt-row pf-file"><span class="pt-ic">' + J.icon('doc') + '</span><span class="pt-rt"><span data-fn="' + esc(f.id) + '" data-noalpha></span><small class="muted" data-fb="' + esc(f.id) + '"></small></span>' +
        (L && J.docActionsModal && DOOR.test(f.name) ? '<button type="button" class="pill sm" data-fa="' + esc(f.id) + '">' + esc(s('act')) + '</button>' : '') +
        '<button type="button" class="pill sm ghost" data-fd="' + esc(f.id) + '">' + esc(s('dl')) + '</button>' +
        (can ? '<button type="button" class="ib" data-fx="' + esc(f.id) + '" title="' + esc(s('del')) + '" aria-label="' + esc(s('del')) + '">' + J.icon('trash') + '</button>' : '') + '</div>';
    }
    function draw() {
      var open = L ? o.canWrite : D.canUpload, all = [];
      var reqs = D.requests.map(function (q) {
        q.files.forEach(function (f) { all.push(f); });
        return '<div class="pf-req' + (q.status === 'done' ? ' done' : '') + '"><div class="pt-row"><span class="pt-rt"><b data-qt="' + esc(q.id) + '"></b>' +
          (q.dueOn ? ' <small class="muted num">' + esc(s('until', { d: J.fmtDate(q.dueOn) })) + '</small>' : '') + (q.status === 'done' ? ' <span class="tag pf-done">' + esc(s('done')) + '</span>' : '') + '</span>' +
          (L && o.canWrite ? '<button type="button" class="pill sm ghost" data-qs="' + esc(q.id) + '" data-to="' + (q.status === 'done' ? 'open' : 'done') + '">' + esc(s(q.status === 'done' ? 'reopen' : 'markDone')) + '</button>' +
            '<button type="button" class="ib" data-qx="' + esc(q.id) + '" title="' + esc(s('rm')) + '" aria-label="' + esc(s('rm')) + '">' + J.icon('x') + '</button>' : '') +
          (!L && open && q.status === 'open' ? '<button type="button" class="pill sm" data-up="' + esc(q.id) + '">' + esc(s('up')) + '</button>' : '') + '</div>' +
          (q.files.length ? q.files.map(fileRow).join('') : (L ? '<p class="muted pt-empty">' + esc(s('noFile')) + '</p>' : '')) + '</div>';
      }).join('');
      D.files.forEach(function (f) { all.push(f); });
      host.innerHTML = '<b>' + esc(s(L ? 'hL' : 'hC')) + '</b><p class="muted pt-tl">' + esc(s(L ? 'leadL' : 'leadC')) + '</p>' +
        (reqs || (L ? '<p class="muted pt-empty">' + esc(s('none')) + '</p>' : '')) +
        (D.files.length ? '<div class="pf-req"><small class="muted">' + esc(s(L ? 'loose' : 'mine')) + '</small>' + D.files.map(fileRow).join('') + '</div>' : '') +
        (L && o.canWrite ? '<div class="pt-form"><input class="inp pt-dlt pf-title" maxlength="240" placeholder="' + esc(s('ph')) + '"><input class="inp pt-dld pf-due" type="date" aria-label="' + esc(s('due')) + '"><button class="pill sm" type="button" data-a="pfask">' + esc(s('ask')) + '</button></div>' : '') +
        (!L && open ? '<div style="margin-top:10px"><button type="button" class="pill sm ghost" data-up="">' + esc(s('upFree')) + '</button></div>' : '') +
        '<input type="file" class="pf-input" hidden accept=".' + D.limits.types.join(',.') + '">';
      // a person's words go in as text, never markup
      D.requests.forEach(function (q) { $('[data-qt="' + q.id + '"]', host).textContent = q.title; });
      all.forEach(function (f) {
        $('[data-fn="' + f.id + '"]', host).textContent = f.name;
        $('[data-fb="' + f.id + '"]', host).textContent = (L ? s('by', { n: f.by, d: J.fmtDate(f.at) }) : J.fmtDate(f.at)) + ' · ' + size(f.bytes) + (f.source === 'telegram' ? s('tg') : '');
      });
      bind(all);
    }
    async function blobOf(f) {
      var r = await J.api(url + '/files/' + encodeURIComponent(f.id) + '/content', { raw: true });
      if (!r.ok) { J.toast(J.t('err.http', { code: r.status }), 5000); return null; }
      return r.res.blob();
    }
    function bind(all) {
      var byId = function (id) { return all.filter(function (f) { return f.id === id; })[0]; };
      $$('[data-fd]', host).forEach(function (b) {
        b.onclick = async function () {
          var f = byId(b.dataset.fd), blob = await blobOf(f); if (!blob) return;
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        };
      });
      // the ordinary document door: a text file lands in the lawyer's own Hujjatlarim; a scan shows its OCR price first
      $$('[data-fa]', host).forEach(function (b) {
        b.onclick = async function () {
          var f = byId(b.dataset.fa); b.disabled = true; J.toast(s('reading'));
          try {
            var blob = await blobOf(f); if (!blob) return;
            var read = await J.readFile(new File([blob], f.name, { type: f.mime }), J.scanConfirm);
            J.docActionsModal(read);
          } catch (e) { if (e && e.message !== 'cancel') J.toast(f.name + ': ' + e.message, 6000); } finally { b.disabled = false; }
        };
      });
      $$('[data-fx]', host).forEach(function (b) {
        b.onclick = async function () {
          if (!(await J.confirm(s('rmFQ'), s('del')))) return;
          var q = await J.api(url + '/files/' + encodeURIComponent(b.dataset.fx), { method: 'DELETE' });
          if (!q.ok) J.toast(J.errMsg(q.data), 5000);
          load();
        };
      });
      $$('[data-qs]', host).forEach(function (b) {
        b.onclick = async function () {
          var q = await J.api(url + '/requests/' + encodeURIComponent(b.dataset.qs), { method: 'PATCH', body: { status: b.dataset.to } });
          if (!q.ok) J.toast(J.errMsg(q.data), 5000);
          load();
        };
      });
      $$('[data-qx]', host).forEach(function (b) {
        b.onclick = async function () {
          if (!(await J.confirm(s('rmQ'), s('rm')))) return;
          var q = await J.api(url + '/requests/' + encodeURIComponent(b.dataset.qx), { method: 'DELETE' });
          if (!q.ok) J.toast(J.errMsg(q.data), 5000);
          load();
        };
      });
      var ask = $('[data-a=pfask]', host);
      if (ask) {
        var send = async function () {
          var t = $('.pf-title', host);
          if (t.value.trim().length < 2) { t.focus(); return; }
          ask.disabled = true;
          var q = await J.api(url + '/requests', { method: 'POST', body: { title: t.value.trim(), dueOn: $('.pf-due', host).value || null } });
          ask.disabled = false;
          if (!q.ok) { J.toast(J.errMsg(q.data), 5000); return; }
          load();
        };
        ask.onclick = send;
        $('.pf-title', host).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
      }
      var input = $('.pf-input', host), forReq = '';
      $$('[data-up]', host).forEach(function (b) { b.onclick = function () { forReq = b.dataset.up; input.value = ''; input.click(); }; });
      input.onchange = async function () {
        var file = input.files && input.files[0]; if (!file) return;
        if (file.size > D.limits.fileMb * 1048576) { J.toast(s('big', { mb: D.limits.fileMb }), 5000); return; }
        var fd = new FormData(); if (forReq) fd.append('requestId', forReq); fd.append('file', file);
        J.toast(s('sending'));
        var q = await J.api(url + '/files', { method: 'POST', body: fd });
        if (!q.ok) { J.toast(J.errMsg(q.data), 6000); return; }
        J.toast(s('sent')); load();
      };
    }
    async function load() {
      var r = await J.api(url + (L ? '/requests' : '/files'));
      if (!document.body.contains(host)) return;
      if (!r.ok) { host.innerHTML = ''; host.hidden = true; return; }
      D = r.data;
      // a client with nothing asked and nothing sent on a closed matter sees no empty card
      if (!L && !D.canUpload && !D.requests.length && !D.files.length) { host.hidden = true; return; }
      host.hidden = false; draw();
    }
    load();
    return { reload: load };
  };
})(window);
