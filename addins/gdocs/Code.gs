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
