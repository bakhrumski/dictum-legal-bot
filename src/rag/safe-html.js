'use strict';

/**
 * Document HTML written by the model (legal opinion, AI drafts) keeps its
 * layout and loses everything that can run code (2026-10-20 security review:
 * the new app rendered it with a two-regex filter, so an unquoted
 * `onerror=`, `<svg onload>`, `<iframe srcdoc>` or a `javascript:` link from
 * a crafted contract would run on juristai.uz in the user's session).
 * The same allowlist as the old dashboard's sanitizeDocHtml and the new
 * app's J.cleanHtml: the browser cleans again, this is the server's layer.
 */

const cheerio = require('cheerio');

const SAFE_TAGS = new Set(['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'i', 'em', 'u', 's', 'sup', 'sub', 'small',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'a']);
const DROP_WITH_CONTENT = /^(script|style|template|iframe|frame|frameset|object|embed|noscript|textarea|select|button|input|form|link|meta|base|svg|math|audio|video|source|img|canvas|title|head)$/;
const SAFE_STYLE = /^(text-align|font-weight|font-style|text-decoration|text-indent|line-height|margin(-top|-bottom|-left|-right)?|padding(-top|-bottom|-left|-right)?|width|border(-collapse)?|vertical-align)\s*:\s*[-#%.,\w\s]*$/i;
const SAFE_HREF = /^(https?:\/\/|\/(?![\/\\])|#)/i;

function keepAttr(tag, name, value) {
  if (name === 'class' || name === 'colspan' || name === 'rowspan' || name === 'align') return /^[-\w\s]*$/.test(value) ? value : null;
  if (name === 'data-label' || name === 'data-hint' || name === 'data-key' || name === 'data-k') return value;
  if (name === 'style') {
    const ok = String(value).split(';').map(x => x.trim()).filter(x => x && SAFE_STYLE.test(x));
    return ok.length ? ok.join('; ') : null;
  }
  if (name === 'href' && tag === 'a') return SAFE_HREF.test(String(value).trim()) ? value : null;
  return null;
}

function sanitizeDocHtml(html) {
  if (html == null || html === '') return '';
  const $ = cheerio.load(`<div id="__jai_root">${String(html)}</div>`, { decodeEntities: false });
  const clean = (node) => {
    for (const child of (node.children || []).slice()) {
      if (child.type === 'tag' || child.type === 'script' || child.type === 'style') {
        const tag = String(child.name || '').toLowerCase();
        if (DROP_WITH_CONTENT.test(tag) || child.type !== 'tag') { $(child).remove(); continue; }
        clean(child);
        if (!SAFE_TAGS.has(tag)) { $(child).replaceWith($(child).contents()); continue; }
        const attrs = Object.assign({}, child.attribs || {});
        for (const [name, value] of Object.entries(attrs)) {
          const kept = keepAttr(tag, name.toLowerCase(), value);
          if (kept == null) $(child).removeAttr(name); else $(child).attr(name, kept);
        }
        if (tag === 'a') { $(child).attr('target', '_blank'); $(child).attr('rel', 'noopener'); }
      } else if (child.type !== 'text') {
        // comments, directives, CDATA
        $(child).remove();
      }
    }
  };
  clean($('#__jai_root')[0]);
  return $('#__jai_root').html() || '';
}

module.exports = { sanitizeDocHtml };
