/**
 * JuristAI — Google Docs yon paneli (Apps Script).
 * @OnlyCurrentDoc
 *
 * O'rnatish: Google Docs → Kengaytmalar (Extensions) → Apps Script → shu fayl (Code.gs)
 * va Sidebar.html'ni qo'ying → Saqlash → hujjatni yangilang → menyuda "JuristAI".
 * Panelning o'zi JuristAI serveridan yuklanadi (JURISTAI_BASE), shuning uchun
 * yangilanishlar uchun bu fayllarni qayta qo'yish shart emas.
 */
var JURISTAI_BASE = 'https://juristai-staging.onrender.com';

function onOpen(e) {
  DocumentApp.getUi().createMenu('JuristAI').addItem('Panelni ochish', 'showSidebar').addToUi();
}
function onInstall(e) { onOpen(e); }

function showSidebar() {
  var t = HtmlService.createTemplateFromFile('Sidebar');
  t.base = JURISTAI_BASE;
  var html = t.evaluate().setTitle('JuristAI').setSandboxMode(HtmlService.SandboxMode.IFRAME);
  DocumentApp.getUi().showSidebar(html);
}

/* ---------- panel chaqiradigan funksiyalar (google.script.run) ---------- */

function jaiBodyText() {
  return DocumentApp.getActiveDocument().getBody().getText();
}

function pieces_(sel) {
  var out = [];
  sel.getRangeElements().forEach(function (re) {
    var el = re.getElement();
    if (!el.editAsText) return;
    var t = el.editAsText();
    var len = t.getText().length;
    var s = re.isPartial() ? re.getStartOffset() : 0;
    var e = re.isPartial() ? re.getEndOffsetInclusive() : len - 1;
    out.push({ re: re, el: el, text: t, start: s, end: e });
  });
  return out;
}

function jaiSelection() {
  var sel = DocumentApp.getActiveDocument().getSelection();
  if (!sel) return { text: '' };
  return { text: pieces_(sel).map(function (p) { return p.end >= p.start ? p.text.getText().substring(p.start, p.end + 1) : ''; }).join('\n') };
}

function norm_(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

/**
 * Tanlangan matnni almashtiradi. redline=true: eski matn qizil, ustidan chizilgan holda qoladi,
 * yangi matn undan keyin ko'k, tagiga chizilgan holda qo'yiladi (Google Docs'da Apps Script
 * "Taklif" rejimini bermaydi).
 */
function jaiReplace(expected, newText, redline) {
  var doc = DocumentApp.getActiveDocument();
  var sel = doc.getSelection();
  if (!sel) throw new Error("Tanlov yo'q. Bandni qayta belgilang.");
  if (norm_(jaiSelection().text) !== norm_(expected)) throw new Error("Tanlov o'zgargan. Bandni qayta belgilang va yana bosing.");
  var ps = pieces_(sel);
  if (!ps.length) throw new Error("Bu tanlovni almashtirib bo'lmaydi.");
  newText = String(newText || '');

  if (redline) {
    ps.forEach(function (p) {
      if (p.end < p.start) return;
      p.text.setStrikethrough(p.start, p.end, true);
      p.text.setForegroundColor(p.start, p.end, '#C0392B');
    });
    var last = ps[ps.length - 1];
    var at = Math.max(last.end + 1, 0);
    var ins = ' ' + newText;
    last.text.insertText(at, ins);
    last.text.setStrikethrough(at, at + ins.length - 1, false);
    last.text.setForegroundColor(at + 1, at + ins.length - 1, '#1F4FD8');
    last.text.setUnderline(at + 1, at + ins.length - 1, true);
    return true;
  }

  for (var i = ps.length - 1; i >= 0; i--) {
    var p = ps[i];
    if (i === 0) {
      if (p.end >= p.start) p.text.deleteText(p.start, p.end);
      p.text.insertText(p.start, newText);
    } else if (p.end >= p.start) {
      if (p.re.isPartial()) p.text.deleteText(p.start, p.end);
      else { try { p.el.removeFromParent(); } catch (e) { p.text.deleteText(p.start, p.end); } }
    }
  }
  return true;
}

function insertionIndex_(doc, body) {
  var el = null, c = doc.getCursor();
  if (c) el = c.getElement();
  else { var s = doc.getSelection(); if (s) { var r = s.getRangeElements(); el = r[r.length - 1].getElement(); } }
  if (!el) return body.getNumChildren();
  while (el.getParent() && el.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) el = el.getParent();
  if (!el.getParent()) return body.getNumChildren();
  return body.getChildIndex(el) + 1;
}

function writeRich_(el, text) {
  var re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, out = '', last = 0, m, bolds = [], links = [];
  while ((m = re.exec(text))) {
    out += text.slice(last, m.index);
    if (m[1] != null) { bolds.push([out.length, out.length + m[1].length - 1]); out += m[1]; }
    else { links.push([out.length, out.length + m[2].length - 1, m[3]]); out += m[2]; }
    last = re.lastIndex;
  }
  out += text.slice(last);
  out = out.replace(/\*\*/g, '').replace(/`/g, '');
  if (!out) out = ' ';
  el.setText(out);
  var t = el.editAsText();
  t.setBold(false); t.setItalic(false); t.setStrikethrough(false); t.setUnderline(false);
  try { t.setForegroundColor(null); t.setLinkUrl(null); } catch (e) {}
  bolds.forEach(function (b) { if (b[1] >= b[0] && b[1] < out.length) t.setBold(b[0], b[1], true); });
  links.forEach(function (l) { if (l[1] >= l[0] && l[1] < out.length) t.setLinkUrl(l[0], l[1], l[2]); });
}

/** Javobni kursordan (yoki tanlovdan) keyin qo'yadi: [{t:'h'|'p'|'li'|'oli', text}] */
function jaiInsertBlocks(blocks) {
  var doc = DocumentApp.getActiveDocument(), body = doc.getBody();
  var idx = insertionIndex_(doc, body);
  (blocks || []).slice(0, 400).forEach(function (b) {
    var el;
    if (b.t === 'li' || b.t === 'oli') {
      el = body.insertListItem(idx++, ' ');
      el.setGlyphType(b.t === 'oli' ? DocumentApp.GlyphType.NUMBER : DocumentApp.GlyphType.BULLET);
    } else {
      el = body.insertParagraph(idx++, ' ');
      el.setHeading(b.t === 'h' ? DocumentApp.ParagraphHeading.HEADING3 : DocumentApp.ParagraphHeading.NORMAL);
    }
    writeRich_(el, String(b.text || ''));
  });
  return true;
}

/* ---------- hujjatni ko'rib chiqish: belgilash va hujjat oxirida izohlar ---------- */

var REVIEW_TITLE = 'JuristAI izohlari';

function normQ_(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function needles_(quote) {
  var q = normQ_(quote), out = [];
  if (q.length < 4) return out;
  function cut(n) { if (q.length <= n) return q; var s = q.slice(0, n), sp = s.lastIndexOf(' '); return (sp > n * 0.6 ? s.slice(0, sp) : s).trim(); }
  if (q.length <= 240) out.push(q);
  [120, 70, 40].forEach(function (n) { var c = cut(n); if (c.length >= 12 && out.indexOf(c) < 0) out.push(c); });
  return out;
}
/** findText qidiruvi (RE2): bo'shliqlar va apostrof turlari farqiga chidamli */
function pattern_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[‘’'ʻʼ`]/g, "[‘’'ʻʼ`]")
    .replace(/[«»"“”]/g, '[«»"“”]')
    .replace(/\s+/g, '\\s+');
}

/** items: [{quote, problem, basis, advice, newText}] (panel JAIShared.parseReview). Qaytaradi [{where, edited}] */
function jaiApplyReview(items, edits) {
  var doc = DocumentApp.getActiveDocument(), body = doc.getBody();
  var out = [], notes = [];
  (items || []).slice(0, 60).forEach(function (it, i) {
    var q = normQ_(it.quote), ns = needles_(q), hit = null, full = false;
    for (var k = 0; k < ns.length && !hit; k++) {
      try { hit = body.findText(pattern_(ns[k])); } catch (e) { hit = null; }
      if (hit) full = ns[k] === q;
    }
    var res = { where: hit ? 'found' : (q ? 'missing' : 'general'), edited: false };
    if (hit) {
      var t = hit.getElement().asText(), s = hit.getStartOffset(), e = hit.getEndOffsetInclusive();
      t.setBackgroundColor(s, e, '#FFF1A8');
      try { doc.addNamedRange('jai-review', doc.newRange().addElement(t, s, e).build()); } catch (x) {}
      if (edits && it.newText && full) {
        t.setStrikethrough(s, e, true); t.setForegroundColor(s, e, '#C0392B');
        var ins = ' ' + it.newText;
        t.insertText(e + 1, ins);
        t.setStrikethrough(e + 1, e + ins.length, false);
        try { t.setBackgroundColor(e + 1, e + ins.length, null); } catch (x) {}
        t.setForegroundColor(e + 2, e + ins.length, '#1F4FD8');
        t.setUnderline(e + 2, e + ins.length, true);
        res.edited = true;
      }
    }
    var head = q ? '«' + (q.length > 140 ? q.slice(0, 140) + '…' : q) + '» — ' : '**Yetishmayotgan shart:** ';
    notes.push(head + (it.problem || '') + (it.basis ? ' **Asos:** ' + it.basis : '') + (it.advice ? ' **Tavsiya:** ' + it.advice : '') +
      (res.where === 'missing' ? ' (matnda aniq topilmadi)' : ''));
    out.push(res);
  });
  if (notes.length) {
    jaiClearNotes_(body);
    var h = body.appendParagraph(REVIEW_TITLE);
    h.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    notes.forEach(function (n) {
      var li = body.appendListItem(' ');
      li.setGlyphType(DocumentApp.GlyphType.NUMBER);
      writeRich_(li, String(n).replace(/\n+/g, ' '));
    });
  }
  return out;
}

function jaiClearNotes_(body) {
  var start = -1;
  for (var i = 0; i < body.getNumChildren(); i++) {
    var c = body.getChild(i);
    if (c.getType() === DocumentApp.ElementType.PARAGRAPH && c.asParagraph().getText() === REVIEW_TITLE) { start = i; break; }
  }
  if (start < 0) return 0;
  var removed = 0;
  for (var j = body.getNumChildren() - 1; j >= start; j--) {
    var el = body.getChild(j);
    if (j > start && el.getType() !== DocumentApp.ElementType.LIST_ITEM) continue;
    // hujjatning oxirgi paragrafini o'chirib bo'lmaydi: matni tozalanadi
    try { el.removeFromParent(); } catch (x) { try { el.editAsText().setText(''); } catch (y) {} }
    removed++;
  }
  return removed;
}

/** belgilashlar va "JuristAI izohlari" bo'limini olib tashlaydi */
function jaiClearReview() {
  var doc = DocumentApp.getActiveDocument(), body = doc.getBody(), n = 0;
  doc.getNamedRanges('jai-review').forEach(function (nr) {
    nr.getRange().getRangeElements().forEach(function (re) {
      var t = re.getElement().asText();
      try { t.setBackgroundColor(re.getStartOffset(), re.getEndOffsetInclusive(), null); } catch (x) {}
    });
    nr.remove(); n++;
  });
  jaiClearNotes_(body);
  return n;
}
