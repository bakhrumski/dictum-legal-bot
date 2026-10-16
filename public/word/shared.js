/* JuristAI — Word / Google Docs panellari va Word o'ng tugma menyusi uchun umumiy qism:
   so'rov matnlari (prompt), javobni ajratish va hujjatdan iqtibos qidirish. */
(function (root) {
  'use strict';
  var S = {};
  S.TOKEN_KEY = 'juristai-word-token';

  /* ---------- tahrir taklifi: javobdagi yangi matn belgilar orasida ---------- */
  S.EDIT_FORMAT = "\n\nJavobni quyidagi tartibda bering:\n1) Qisqa izoh: nima o‘zgardi va nega, tegishli qonun normasi va manbasi bilan.\n2) Bandning yangi matni — faqat quyidagi belgilar orasida, boshqa hech narsa qo‘shmasdan:\n<<<YANGI_MATN\n(bandning to‘liq yangi matni)\nYANGI_MATN>>>";
  S.PRESETS = {
    fix: 'Bandni amaldagi qonunchilikka moslashtiring.',
    clear: "Bandni aniqroq va bir ma'noli yozing.",
    protect: 'Bandni mening tarafim manfaatini kuchliroq himoya qiladigan qilib yozing.',
    formal: 'Bandni rasmiy-huquqiy uslubda qayta yozing.',
    explain: 'Ushbu band huquqiy jihatdan nimani anglatadi, qanday xavflari bor va qaysi qonun normalari tegishli? Qisqa va aniq javob bering.'
  };
  S.splitProposal = function (reply) {
    var m = String(reply).match(/<<<\s*YANGI_MATN\s*\n?([\s\S]*?)\n?\s*YANGI_MATN\s*>>>/);
    if (m) return { text: m[1].trim(), rest: String(reply).replace(m[0], '').trim() };
    var f = String(reply).match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (f) return { text: f[1].trim(), rest: String(reply).replace(f[0], '').trim() };
    return null;
  };
  /** markdown'siz oddiy matn (Word izohi uchun): havolalar "nom (url)" bo'ladi */
  S.plainOf = function (s) {
    return String(s || '').replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^[ \t]*<<<\s*YANGI_MATN[ \t]*$|^[ \t]*YANGI_MATN\s*>>>[ \t]*$/gm, '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
      .replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  };

  /* ---------- hujjatni ko'rib chiqish: har bir muammo alohida, iqtibos bilan ---------- */
  S.REVIEW_PROMPT = 'Ushbu hujjatni to‘liq tahlil qiling: xavfli bandlar, yetishmayotgan shartlar va tavsiyalar.' +
    "\n\nHar bir topilgan muammoni alohida, aynan quyidagi shaklda yozing (har birini «### IZOH» sarlavhasi bilan boshlang):\n" +
    '### IZOH 1\n' +
    'IQTIBOS: hujjatdagi tegishli joydan 5–25 so‘zlik parcha — hujjatdagidek, bir harfini ham o‘zgartirmasdan\n' +
    'MUAMMO: nima noto‘g‘ri yoki xavfli\n' +
    'ASOS: tegishli qonun normasi va manbasi\n' +
    'TAVSIYA: nima qilish kerak\n' +
    'YANGI MATN: IQTIBOS o‘rniga qo‘yiladigan tuzatilgan matn (tuzatish kerak bo‘lmasa «—»)\n\n' +
    'Hujjatda umuman yo‘q (yetishmayotgan) shart uchun IQTIBOS va YANGI MATN o‘rniga «—» yozing. ' +
    'Oxirida «### XULOSA» sarlavhasi ostida 2–4 gaplik umumiy xulosa bering.';

  var KEYS = { 'IQTIBOS': 'quote', 'MUAMMO': 'problem', 'ASOS': 'basis', 'TAVSIYA': 'advice', 'YANGI MATN': 'newText' };
  function dash(s) { s = String(s || '').trim(); return /^[«"“]?\s*[—–-]?\s*[»"”]?$/.test(s) ? '' : s; }
  function unquote(s) { return String(s || '').trim().replace(/^[«"“„']+|[»"”'']+$/g, '').replace(/^\.{3}|…$|\.{3}$|^…/g, '').trim(); }
  /** {items:[{quote, problem, basis, advice, newText}], summary} */
  S.parseReview = function (reply) {
    var text = String(reply || '').replace(/<!--[\s\S]*?-->/g, '');
    var parts = text.split(/^[ \t]*#{2,4}[ \t]*\**[ \t]*(IZOH\b[^\n]*|XULOSA\b[^\n]*)$/im);
    var items = [], summary = '';
    for (var i = 1; i < parts.length; i += 2) {
      var head = parts[i].toUpperCase(), body = parts[i + 1] || '';
      if (head.indexOf('XULOSA') === 0) { summary = body.trim(); continue; }
      var it = { quote: '', problem: '', basis: '', advice: '', newText: '' }, cur = null;
      body.split('\n').forEach(function (line) {
        var m = line.match(/^\s*[-*]?\s*\**\s*(IQTIBOS|MUAMMO|ASOS|TAVSIYA|YANGI MATN)\s*\**\s*:\s*\**\s*(.*)$/i);
        if (m) { cur = KEYS[m[1].toUpperCase()]; it[cur] = m[2].trim(); }
        else if (cur && line.trim()) it[cur] += '\n' + line.trim();
      });
      it.quote = unquote(dash(it.quote)); it.newText = unquote(dash(it.newText));
      if (it.problem || it.advice) items.push(it);
    }
    return { items: items, summary: summary };
  };
  /** Word izohi matni */
  S.commentText = function (it) {
    return S.plainOf('JuristAI: ' + it.problem + (it.basis ? '\nAsos: ' + it.basis : '') + (it.advice ? '\nTavsiya: ' + it.advice : '')).slice(0, 2000);
  };
  /** iqtibosni hujjatdan topish uchun qidiruv satrlari: avval to'liq, keyin qisqaroq boshi */
  S.needles = function (quote) {
    var q = String(quote || '').replace(/\s+/g, ' ').trim();
    if (q.length < 4) return [];
    var out = [];
    function cut(n) { if (q.length <= n) return q; var s = q.slice(0, n); var sp = s.lastIndexOf(' '); return (sp > n * 0.6 ? s.slice(0, sp) : s).trim(); }
    if (q.length <= 240) out.push(q);
    [120, 70, 40].forEach(function (n) { var c = cut(n); if (c.length >= 12 && out.indexOf(c) < 0) out.push(c); });
    return out;
  };
  /** Word qidiruvida "^" maxsus belgi */
  S.wordSearchText = function (s) { return String(s).replace(/\^/g, '^^'); };

  root.JAIShared = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : globalThis);
