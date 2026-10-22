/* Natijani Workspace'ga saqlash (2026-10-22): jadvalli tahlil, Playbook va da'vo arizasi agenti natijasi
   jamoa Workspace'ida "generated" hujjat bo'lib saqlanadi — matn (Workspace AI o'qishi uchun) va JSON (asl natija).
   Server: GET /api/workspaces, POST /api/workspaces/:id/documents (src/workspace/routes.js, a'zo huquqi bilan). */
(function (G) {
  'use strict';
  var J = G.JAI, $ = J.$, esc = J.esc;

  var S = {
    uz: { btn: 'Workspace’ga saqlash', pick: 'Qaysi Workspace’ga saqlaymiz?', title: 'Hujjat nomi', save: 'Saqlash', cancel: 'Bekor qilish',
      none: 'Faol Workspace yo‘q: Workspace Platinum tarifida yoki taklif orqali ochiladi.', done: 'Workspace’ga saqlandi', open: 'Ochish' },
    ru: { btn: 'Сохранить в Workspace', pick: 'В какой Workspace сохранить?', title: 'Название документа', save: 'Сохранить', cancel: 'Отмена',
      none: 'Нет активного Workspace: он доступен на тарифе Platinum или по приглашению.', done: 'Сохранено в Workspace', open: 'Открыть' },
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

  /** The button every result page puts next to its other actions. */
  J.wsSaveButton = function () { return '<button class="pill sm ghost" data-a="wssave" type="button">' + J.icon('team') + esc(s('btn')) + '</button>'; };
})(window);
