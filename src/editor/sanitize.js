'use strict';

/**
 * The document editor's HTML (D1, docs/design/hujjat-muharriri.md): only what
 * the editor itself writes is kept - paragraphs, headings, lists, tables,
 * quotes, rules, line breaks, bold / italic / underline / strike / sup / sub,
 * links (http, https, mailto), and inline colour, background, font family,
 * font size and alignment. Everything else (scripts, event attributes, images,
 * iframes, unknown styles) is dropped, its text kept. Used on every save,
 * import and export, so a stored document never holds markup the editor did
 * not make.
 */

const cheerio = require('cheerio');

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'colgroup', 'col']);
const INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sup', 'sub', 'span', 'mark', 'a', 'br']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'meta', 'link', 'img', 'video', 'audio', 'canvas', 'form', 'input', 'button', 'select', 'textarea']);
const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', h5: 'h4', h6: 'h4', div: 'p', section: 'p', article: 'p' };

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/iu;
const FONT = /^[\p{L}\p{N} ,'"-]{1,80}$/u;
const SIZE = /^\d{1,2}(\.\d)?(px|pt)$/u;

/** The inline style the editor writes, kept property by property; anything else dropped. */
function cleanStyle(style, tag) {
  const out = [];
  for (const part of String(style || '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim().replace(/\s*!important$/u, '');
    if ((k === 'color' || k === 'background-color') && COLOR.test(v)) out.push(`${k}: ${v}`);
    // attribute values are written as they are (decodeEntities off), so no double quote may reach one
    else if (k === 'font-family' && FONT.test(v)) out.push(`${k}: ${v.replace(/"/gu, "'")}`);
    else if (k === 'font-size' && SIZE.test(v)) out.push(`${k}: ${v}`);
    else if (k === 'text-align' && /^(left|center|right|justify)$/u.test(v) && BLOCK.has(tag)) out.push(`${k}: ${v}`);
  }
  return out.join('; ');
}

function cleanHtml(html, { maxChars = 2000000 } = {}) {
  const src = String(html || '').slice(0, maxChars);
  // decodeEntities off: letters stay letters (not &#x...;) and escaped text stays escaped - never turned into markup
  const $ = cheerio.load(`<div id="__r">${src}</div>`, { decodeEntities: false });
  const root = $('#__r');
  root.find('*').each((_, el) => {
    // a <script> / <style> is its own node type in the parser, not 'tag'
    if (el.type !== 'tag' && el.type !== 'script' && el.type !== 'style') return;
    let name = el.name.toLowerCase();
    if (DROP.has(name)) { $(el).remove(); return; }
    if (RENAME[name]) { el.name = RENAME[name]; name = el.name; }
    if (!BLOCK.has(name) && !INLINE.has(name)) { $(el).replaceWith($(el).contents()); return; }
    const keep = {};
    const style = cleanStyle(el.attribs && el.attribs.style, name);
    if (style) keep.style = style;
    if (name === 'a') {
      const href = String((el.attribs && el.attribs.href) || '').trim();
      if (/^(https?:\/\/|mailto:)[^\s"'<>`]+$/iu.test(href)) { keep.href = href; keep.rel = 'noopener noreferrer'; keep.target = '_blank'; }
    }
    if ((name === 'td' || name === 'th') && el.attribs) {
      for (const a of ['colspan', 'rowspan']) if (/^\d{1,2}$/u.test(String(el.attribs[a] || ''))) keep[a] = el.attribs[a];
    }
    if (name === 'mark' && el.attribs && COLOR.test(String(el.attribs['data-color'] || ''))) keep['data-color'] = el.attribs['data-color'];
    if (name === 'ol' && el.attribs && /^\d{1,4}$/u.test(String(el.attribs.start || ''))) keep.start = el.attribs.start;
    el.attribs = keep;
  });
  return root.html() || '';
}

/** Plain text of a document's HTML (its size, checks and AI input). */
function textOf(html) {
  const $ = cheerio.load(`<div id="__r">${String(html || '')}</div>`);
  $('#__r').find('p, h1, h2, h3, h4, li, tr, blockquote, br').each((_, el) => { $(el).append('\n'); });
  return $('#__r').text().replace(/ /gu, ' ').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
}

const esc = s => String(s).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/** Plain text (a library document, a text PDF) -> paragraphs; page and table marks of our readers removed. */
function textToHtml(text) {
  const lines = String(text || '').replace(/\r\n?/gu, '\n')
    .replace(/^\s*=== PAGE \d+ ===\s*$/gmu, '')
    .replace(/\[Sahifa \d+\]/gu, '')
    .split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(esc).join('<br>')}</p>`); para = []; } };
  for (const l of lines) {
    const t = l.replace(/[⟦⟧⟨⟩]/gu, '').trim();
    if (!t) { flush(); continue; }
    para.push(t);
    if (/[.;:!?»"]$/u.test(t)) flush();
  }
  flush();
  return out.join('') || '<p></p>';
}

module.exports = { cleanHtml, cleanStyle, textOf, textToHtml };
