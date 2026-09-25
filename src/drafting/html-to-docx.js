'use strict';

/**
 * Document HTML (drafts, opinions, templates) -> a real .docx (OOXML).
 *
 * The "Word" export used to be HTML saved as .doc with application/msword
 * (Astra audit D4): Word opens it in compatibility mode, other editors
 * often do not, and our own importer rejects .doc. This writes a proper
 * WordprocessingML package with jszip, keeping what legal documents use:
 * headings, paragraphs with alignment, bold/italic/underline/strike,
 * superscript (prim articles), line breaks, bullet and numbered lists
 * (numbering restarts per list), tables with borders and column spans,
 * block quotes and horizontal rules. Anything else degrades to its text.
 */

const cheerio = require('cheerio');
const JSZip = require('jszip');

const A4 = { w: 11906, h: 16838 };
const MARGIN = { top: 1417, bottom: 1417, left: 1134, right: 1134 }; // 25 mm / 20 mm

function xml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

function alignOf($el) {
  const style = String($el.attr('style') || '');
  const m = /text-align\s*:\s*(left|right|center|justify)/i.exec(style);
  const a = (m ? m[1] : $el.attr('align') || '').toLowerCase();
  return { center: 'center', right: 'right', justify: 'both', left: 'left' }[a] || null;
}

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table',
  'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'blockquote', 'hr', 'pre', 'section', 'article', 'header', 'footer']);

function createConverter() {
  const numbering = []; // { numId, abstractId }
  let nextNumId = 1;

  function newList(ordered) {
    const numId = nextNumId++;
    numbering.push({ numId, abstractId: ordered ? 2 : 1 });
    return numId;
  }

  /** Inline content of an element -> <w:r> runs. */
  function runs($, nodes, fmt = {}) {
    let out = '';
    nodes.each((_, node) => {
      if (node.type === 'text') {
        const text = node.data.replace(/\s+/g, ' ');
        if (!text) return;
        out += run(text, fmt);
        return;
      }
      if (node.type !== 'tag') return;
      const name = node.name.toLowerCase();
      const $n = $(node);
      if (name === 'br') { out += '<w:r><w:br/></w:r>'; return; }
      if (name === 'script' || name === 'style') return;
      const f = Object.assign({}, fmt);
      if (name === 'b' || name === 'strong' || name === 'th') f.b = true;
      if (name === 'i' || name === 'em') f.i = true;
      if (name === 'u') f.u = true;
      if (name === 's' || name === 'strike' || name === 'del') f.strike = true;
      if (name === 'sup') f.vert = 'superscript';
      if (name === 'sub') f.vert = 'subscript';
      const style = String($n.attr('style') || '');
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) f.b = true;
      if (/font-style\s*:\s*italic/i.test(style)) f.i = true;
      if (/text-decoration[^;]*underline/i.test(style)) f.u = true;
      out += runs($, $n.contents(), f);
    });
    return out;
  }

  function run(text, fmt) {
    let rPr = '';
    if (fmt.b) rPr += '<w:b/><w:bCs/>';
    if (fmt.i) rPr += '<w:i/><w:iCs/>';
    if (fmt.u) rPr += '<w:u w:val="single"/>';
    if (fmt.strike) rPr += '<w:strike/>';
    if (fmt.vert) rPr += `<w:vertAlign w:val="${fmt.vert}"/>`;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  }

  function paragraph(inner, { style, jc, num, ind, borderBottom } = {}) {
    let pPr = '';
    if (style) pPr += `<w:pStyle w:val="${style}"/>`;
    if (num) pPr += `<w:numPr><w:ilvl w:val="${num.lvl}"/><w:numId w:val="${num.id}"/></w:numPr>`;
    if (borderBottom) pPr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>';
    if (ind) pPr += `<w:ind w:left="${ind}"/>`;
    if (jc) pPr += `<w:jc w:val="${jc}"/>`;
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
  }

  /** Does this element hold block children (so it is a container, not a paragraph)? */
  function hasBlockChild($, $el) {
    let found = false;
    $el.children().each((_, c) => { if (BLOCK.has(c.name.toLowerCase())) found = true; });
    return found;
  }

  /** Block content -> paragraphs and tables. */
  function blocks($, nodes, ctx = {}) {
    let out = '';
    let inline = [];
    const flush = () => {
      if (!inline.length) return;
      const r = runs($, $(inline));
      if (r.replace(/<[^>]+>/g, '').trim() || /<w:br\/>/.test(r)) out += paragraph(r, { jc: ctx.jc, ind: ctx.ind });
      inline = [];
    };
    nodes.each((_, node) => {
      if (node.type === 'text' || (node.type === 'tag' && !BLOCK.has(node.name.toLowerCase()))) {
        inline.push(node);
        return;
      }
      if (node.type !== 'tag') return;
      flush();
      const name = node.name.toLowerCase();
      const $n = $(node);
      const jc = alignOf($n) || ctx.jc;
      if (/^h[1-6]$/.test(name)) {
        const level = Math.min(Number(name[1]), 3);
        out += paragraph(runs($, $n.contents()), { style: `Heading${level}`, jc });
      } else if (name === 'ul' || name === 'ol') {
        const id = newList(name === 'ol');
        const lvl = Math.min(ctx.listLevel || 0, 8);
        $n.children('li').each((__, li) => {
          const $li = $(li);
          const own = $li.contents().filter((___, c) => !(c.type === 'tag' && ['ul', 'ol'].includes(c.name.toLowerCase())));
          out += paragraph(runs($, own), { num: { id, lvl }, jc: alignOf($li) || jc });
          $li.children('ul,ol').each((___, sub) => { out += blocks($, $(sub), Object.assign({}, ctx, { listLevel: lvl + 1 })); });
        });
      } else if (name === 'table') {
        out += table($, $n);
      } else if (name === 'hr') {
        out += paragraph('', { borderBottom: true });
      } else if (name === 'blockquote') {
        out += blocks($, $n.contents(), Object.assign({}, ctx, { jc, ind: (ctx.ind || 0) + 567 }));
      } else if (hasBlockChild($, $n) || ['section', 'article', 'header', 'footer', 'thead', 'tbody', 'tfoot'].includes(name)) {
        out += blocks($, $n.contents(), Object.assign({}, ctx, { jc }));
      } else {
        const r = runs($, $n.contents());
        out += paragraph(r, { jc, ind: ctx.ind });
      }
    });
    flush();
    return out;
  }

  function table($, $table) {
    const rows = $table.find('tr').filter((_, tr) => $(tr).closest('table')[0] === $table[0]);
    let cols = 0;
    rows.each((_, tr) => {
      let n = 0;
      $(tr).children('td,th').each((__, td) => { n += Math.max(1, Number($(td).attr('colspan')) || 1); });
      cols = Math.max(cols, n);
    });
    if (!cols) return '';
    const usable = A4.w - MARGIN.left - MARGIN.right;
    const colW = Math.floor(usable / cols);
    let out = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'
      + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('')
      + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>'
      + `<w:tblGrid>${`<w:gridCol w:w="${colW}"/>`.repeat(cols)}</w:tblGrid>`;
    rows.each((_, tr) => {
      out += '<w:tr>';
      $(tr).children('td,th').each((__, td) => {
        const $td = $(td);
        const span = Math.max(1, Number($td.attr('colspan')) || 1);
        let inner = blocks($, $td.contents(), { jc: alignOf($td) });
        if ($td[0].name.toLowerCase() === 'th') inner = inner.replace(/<w:r>(<w:rPr>)?/g, (m, p) => (p ? '<w:r><w:rPr><w:b/>' : '<w:r><w:rPr><w:b/></w:rPr>'));
        if (!inner) inner = '<w:p/>';
        out += `<w:tc><w:tcPr><w:tcW w:w="${colW * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
      });
      out += '</w:tr>';
    });
    return out + '</w:tbl><w:p/>';
  }

  return { blocks, numbering };
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function stylesXml(langTag) {
  const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${langTag}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading(1, 28)}${heading(2, 26)}${heading(3, 24)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
</w:styles>`;
}

function numberingXml(nums) {
  const lvls = (ordered) => Array.from({ length: 9 }, (_, i) => ordered
    ? `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman'][i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
    : `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${['•', '◦', '▪'][i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${NS}>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum>
${nums.map(n => `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="${n.abstractId}"/>${n.abstractId === 2 ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`).join('')}
</w:numbering>`;
}

/**
 * @param {string} bodyHtml  document body (not a full page)
 * @param {{title?: string, lang?: string}} opts
 * @returns {Promise<Buffer>} .docx bytes
 */
async function htmlToDocx(bodyHtml, { title = 'Hujjat', lang = 'uz' } = {}) {
  const $ = cheerio.load(`<div id="__root">${String(bodyHtml || '')}</div>`, { decodeEntities: true });
  const conv = createConverter();
  let body = conv.blocks($, $('#__root').contents());
  if (!body) body = '<w:p/>';
  const langTag = lang === 'ru' ? 'ru-RU' : 'uz-Latn-UZ';
  const sect = `<w:sectPr><w:pgSz w:w="${A4.w}" w:h="${A4.h}"/><w:pgMar w:top="${MARGIN.top}" w:right="${MARGIN.right}" w:bottom="${MARGIN.bottom}" w:left="${MARGIN.left}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`);
  zip.file('word/document.xml', document);
  zip.file('word/styles.xml', stylesXml(langTag));
  zip.file('word/numbering.xml', numberingXml(conv.numbering));
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>JuristAI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { htmlToDocx, DOCX_MIME: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
