/* Natijani Workspace'ga saqlash (2026-10-22): jadvalli tahlil, Playbook va da'vo arizasi agenti natijasi
   jamoa Workspace'ida "generated" hujjat bo'lib saqlanadi — matn (Workspace AI o'qishi uchun) va JSON (asl natija).
   Server: GET /api/workspaces, POST /api/workspaces/:id/documents (src/workspace/routes.js, a'zo huquqi bilan). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, esc = J.esc;

  var S = {
    uz: { btn: 'Workspace’ga saqlash', pick: 'Qaysi Workspace’ga saqlaymiz?', title: 'Hujjat nomi', save: 'Saqlash', cancel: 'Bekor qilish',
      none: 'Faol Workspace yo‘q: Workspace har qanday pullik tarifda yoki taklif orqali ochiladi.', done: 'Workspace’ga saqlandi', open: 'Ochish' },
    ru: { btn: 'Сохранить в Workspace', pick: 'В какой Workspace сохранить?', title: 'Название документа', save: 'Сохранить', cancel: 'Отмена',
      none: 'Нет активного Workspace: он доступен на любом платном тарифе или по приглашению.', done: 'Сохранено в Workspace', open: 'Открыть' },
  };
  function s(k) { var d = S[J.lang] || S.uz; return d[k] !== undefined ? d[k] : S.uz[k]; }
  J.wsSaveText = s;

  /** opts: { title, text, json }. Asks which Workspace (only active ones) and saves one generated document. */
  J.saveToWorkspace = async function (opts) {
    var r = await J.api('/api/workspaces');
    var list = r.ok ? (r.data.workspaces || []).filter(function (w) { return w.is_active && w.role !== 'viewer'; }) : [];
    if (!list.length) { J.toast(s('none'), 6000); return false; }
    return new Promise(function (resolve) {
      var m = J.modal({ cls: 'sm', onClose: function () { resolve(false); }, html: '<h2>' + esc(s('btn')) + '</h2>' +
        '<div class="field" style="margin-top:14px"><label>' + esc(s('pick')) + '</label><select class="inp ws-pick">' +
        list.map(function (w) { return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>' + esc(s('title')) + '</label><input class="inp ws-title" maxlength="240"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button type="button" class="pill ghost" data-a="no">' + esc(s('cancel')) + '</button><button type="button" class="pill" data-a="ok">' + esc(s('save')) + '</button></div>' });
      $('.ws-title', m.body).value = String(opts.title || '').slice(0, 240);
      $('[data-a=no]', m.body).onclick = function () { m.close(); };
      $('[data-a=ok]', m.body).onclick = async function () {
        var id = $('.ws-pick', m.body).value, title = $('.ws-title', m.body).value.trim() || opts.title || 'JuristAI';
        this.disabled = true;
        var x = await J.api('/api/workspaces/' + encodeURIComponent(id) + '/documents', { method: 'POST', body: {
          title: title.slice(0, 240), kind: 'generated', contentText: String(opts.text || '').slice(0, 1900000), contentJson: opts.json || null } });
        this.disabled = false;
        if (!x.ok) { J.toast(J.errMsg(x.data), 6000); return; }
        m.el.remove(); resolve(true);
        J.toast(s('done'));
      };
    });
  };

  /* ================= FIRMA KUTUBXONASI (K1b) =================
     A Workspace's shared templates, playbooks and skills: GET /api/library (every
     active Workspace of this account), POST /api/workspaces/:id/library { from }
     to share one's own, PUT / DELETE to change or archive (owner and member). */
  var F = {
    uz: { share: 'Firmaga ulashish', pick: 'Qaysi firmaga (Workspace) ulashamiz?', ok: 'Ulashish', shared: 'Firmaga ulashildi', firm: 'Firma', none: 'Ulashish uchun faol Workspace yo‘q (owner yoki a’zo bo‘lishingiz kerak).', archQ: 'Firma kutubxonasidan olib tashlaysizmi? Versiyalari saqlanadi.', arch: 'Olib tashlash', by: 'o‘zgartirdi', ro: 'Faqat o‘qish (viewer)' },
    ru: { share: 'Поделиться с фирмой', pick: 'С какой фирмой (Workspace) поделиться?', ok: 'Поделиться', shared: 'Добавлено в библиотеку фирмы', firm: 'Фирма', none: 'Нет активного Workspace для этого (нужна роль owner или member).', archQ: 'Убрать из библиотеки фирмы? Версии сохранятся.', arch: 'Убрать', by: 'изменил(а)', ro: 'Только чтение (viewer)' },
    en: { share: 'Share with the firm', pick: 'Which firm (Workspace)?', ok: 'Share', shared: 'Shared with the firm', firm: 'Firm', none: 'No active Workspace you can write to (owner or member).', archQ: 'Remove from the firm library? Its versions are kept.', arch: 'Remove', by: 'changed by', ro: 'Read only (viewer)' },
  };
  function f(k) { var d = F[J.lang] || F.uz; return d[k] !== undefined ? d[k] : F.uz[k]; }
  var CACHE = null;
  J.firm = {
    text: f,
    /** All firm items (cached for the visit); force reloads. */
    load: async function (force) {
      if (CACHE && !force) return CACHE;
      var r = await J.api('/api/library', { allow401: true });
      CACHE = r.ok && r.data && Array.isArray(r.data.items) ? r.data.items : [];
      J.emit('firm');
      return CACHE;
    },
    items: function (kind) { return (CACHE || []).filter(function (x) { return !kind || x.kind === kind; }); },
    canWrite: function (item) { return item && item.role && item.role !== 'viewer'; },
    /** Active Workspaces this account may write to. */
    writable: async function () {
      var r = await J.api('/api/workspaces');
      return r.ok ? (r.data.workspaces || []).filter(function (w) { return w.is_active && w.role !== 'viewer'; }) : [];
    },
    /** Picks a Workspace (asked only when there are several) and runs fn(workspaceId). */
    pick: async function (fn) {
      var list = await J.firm.writable();
      if (!list.length) { J.toast(f('none'), 6000); return false; }
      if (list.length === 1) return fn(list[0].id);
      return new Promise(function (resolve) {
        var m = J.modal({ cls: 'sm', onClose: function () { resolve(false); }, html: '<h2>' + esc(f('share')) + '</h2>' +
          '<div class="field" style="margin-top:14px"><label>' + esc(f('pick')) + '</label><select class="inp fm-pick">' +
          list.map(function (w) { return '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>'; }).join('') + '</select></div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button type="button" class="pill" data-a="ok">' + esc(f('ok')) + '</button></div>' });
        $('[data-a=ok]', m.body).onclick = async function () { var id = $('.fm-pick', m.body).value; m.el.remove(); resolve(await fn(id)); };
      });
    },
    /** Shares one's own item { kind: template | playbook | skill, id }. */
    share: function (kind, id) {
      return J.firm.pick(async function (ws) {
        var r = await J.api('/api/workspaces/' + encodeURIComponent(ws) + '/library', { method: 'POST', body: { from: { kind: kind, id: id } } });
        if (!r.ok) { J.toast(J.errMsg(r.data), 6000); return false; }
        J.toast(f('shared')); await J.firm.load(true); return r.data;
      });
    },
    /** A new firm item { kind, name, data } in a picked Workspace. */
    create: function (kind, name, data) {
      return J.firm.pick(async function (ws) {
        var r = await J.api('/api/workspaces/' + encodeURIComponent(ws) + '/library', { method: 'POST', body: { kind: kind, name: name, data: data } });
        if (!r.ok) { J.toast(J.errMsg(r.data), 6000); return false; }
        await J.firm.load(true); return r.data;
      });
    },
    update: async function (item, name, data) {
      var r = await J.api('/api/workspaces/' + encodeURIComponent(item.workspaceId) + '/library/' + encodeURIComponent(item.id), { method: 'PUT', body: { name: name, data: data, version: item.version } });
      if (r.ok) await J.firm.load(true);
      return r;
    },
    archive: async function (item) {
      if (!(await J.confirm(f('archQ'), f('arch')))) return false;
      var r = await J.api('/api/workspaces/' + encodeURIComponent(item.workspaceId) + '/library/' + encodeURIComponent(item.id), { method: 'DELETE' });
      if (!r.ok) { J.toast(J.errMsg(r.data), 5000); return false; }
      await J.firm.load(true); return true;
    },
    /** "Firma · <Workspace>" tag for a tile. */
    tag: function (item) { return '<span class="tag">' + J.icon('team') + esc(f('firm')) + (item && item.workspaceName ? ' · ' + esc(item.workspaceName) : '') + '</span>'; },
  };

  /** The button every result page puts next to its other actions. */
  J.wsSaveButton = function () { return '<button class="pill sm ghost" data-a="wssave" type="button">' + J.icon('team') + esc(s('btn')) + '</button>'; };
})(window);
