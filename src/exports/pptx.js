'use strict';

/**
 * A small PowerPoint (.pptx) writer (2026-10-28, roadmap stage 2 "Natijalar:
 * PowerPoint"). Office Open XML put together with jszip (already a
 * dependency) - no new package: pptxgenjs pulls the npm package "https",
 * which is not Node's module. No AI, no network.
 *
 *   buildPptx({ title, slides: [slide] }) -> Promise<Buffer>
 *
 * slide: { kind: 'cover', title, subtitle, note }
 *      | { title, kicker?, bullets?: [string | { text, sub }], table?: { head: [..], rows: [[..]] }, note? }
 *
 * 16:9, one blank layout; text is Arial (present on every machine that
 * opens the file; the brand face may not be). Design rules: white slides, no
 * coloured side stripes, a coloured background only light blue (the table
 * header). Long text is cut with "…", never overflows: a slide holds at most
 * 8 bullets of 220 characters, a table 9 rows x 6 columns of 120 characters.
 */

const JSZip = require('jszip');

const W = 12192000, H = 6858000; // EMU, 16:9
const C = { fg: '111214', muted: '66676B', cta: '3D6BF2', soft: 'E9EEFD', line: 'D9DAD6' };
const LIM = Object.freeze({ bullets: 8, bulletChars: 220, rows: 9, cols: 6, cellChars: 120, titleChars: 110 });

// characters XML 1.0 does not allow are dropped
const xml = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/gu, '')
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
const cut = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/gu, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function run(text, { sz = 1800, bold = false, color = C.fg } = {}) {
  return `<a:r><a:rPr lang="uz-Latn-UZ" sz="${sz}"${bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xml(text)}</a:t></a:r>`;
}

let shapeId = 1;
function textBox({ x, y, w, h, paras, anchor = 't' }) {
  const id = ++shapeId;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}
const para = (runs, { bullet = false, space = 0 } = {}) => `<a:p><a:pPr${bullet ? ' marL="285750" indent="-285750"' : ''}>${space ? `<a:spcBef><a:spcPts val="${space}"/></a:spcBef>` : ''}${bullet ? `<a:buClr><a:srgbClr val="${C.cta}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>` : '<a:buNone/>'}</a:pPr>${runs}</a:p>`;

function line({ x, y, w }) {
  const id = ++shapeId;
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="${C.line}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
}

function table({ x, y, w, head, rows }) {
  const id = ++shapeId;
  const cols = head.slice(0, LIM.cols);
  const colW = Math.floor(w / cols.length);
  const cell = (t, { header = false } = {}) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run(cut(t, LIM.cellChars), { sz: header ? 1200 : 1100, bold: header, color: header ? C.fg : C.fg })}</a:p></a:txBody>`
    + `<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720">`
    + ['lnL', 'lnR', 'lnT', 'lnB'].map(k => `<a:${k} w="6350"><a:solidFill><a:srgbClr val="${C.line}"/></a:solidFill></a:${k}>`).join('')
    + (header ? `<a:solidFill><a:srgbClr val="${C.soft}"/></a:solidFill>` : '<a:noFill/>') + '</a:tcPr></a:tc>';
  const body = rows.slice(0, LIM.rows).map(r => `<a:tr h="370840">${cols.map((_, i) => cell(r[i])).join('')}</a:tr>`).join('');
  const h = 370840 * (1 + Math.min(rows.length, LIM.rows));
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${colW * cols.length}" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">`
    + `<a:tbl><a:tblPr firstRow="1" bandRow="0"/><a:tblGrid>${cols.map(() => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>`
    + `<a:tr h="370840">${cols.map(c => cell(c, { header: true })).join('')}</a:tr>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

const M = 685800; // margin (0.75")
function slideXml(s, i, total, footer) {
  shapeId = 1;
  let shapes = '';
  if (s.kind === 'cover') {
    shapes += textBox({ x: M, y: 1600000, w: W - 2 * M, h: 380000, paras: para(run(cut(s.kicker || 'JuristAI', 80).toUpperCase(), { sz: 1200, bold: true, color: C.cta })) });
    shapes += textBox({ x: M, y: 2050000, w: W - 2 * M, h: 1500000, paras: para(run(cut(s.title, LIM.titleChars), { sz: 4000, bold: true })) });
    if (s.subtitle) shapes += textBox({ x: M, y: 3650000, w: W - 2 * M, h: 1300000, paras: para(run(cut(s.subtitle, 420), { sz: 1800, color: C.muted })) });
    if (s.note) shapes += textBox({ x: M, y: H - 1000000, w: W - 2 * M, h: 300000, paras: para(run(cut(s.note, 160), { sz: 1200, color: C.muted })) });
  } else {
    if (s.kicker) shapes += textBox({ x: M, y: 420000, w: W - 2 * M, h: 300000, paras: para(run(cut(s.kicker, 80).toUpperCase(), { sz: 1100, bold: true, color: C.cta })) });
    shapes += textBox({ x: M, y: 720000, w: W - 2 * M, h: 700000, paras: para(run(cut(s.title, LIM.titleChars), { sz: 2800, bold: true })) });
    shapes += line({ x: M, y: 1500000, w: W - 2 * M });
    let y = 1700000;
    if (s.table && s.table.head && s.table.head.length) {
      shapes += table({ x: M, y, w: W - 2 * M, head: s.table.head, rows: s.table.rows || [] });
      y += 370840 * (2 + Math.min((s.table.rows || []).length, LIM.rows));
    }
    const bullets = (s.bullets || []).slice(0, LIM.bullets);
    if (bullets.length) {
      const paras = bullets.map((b, k) => {
        const o = typeof b === 'string' ? { text: b } : b;
        return para(run(cut(o.text, LIM.bulletChars), { sz: 1600 }) + (o.sub ? run(`  ${cut(o.sub, 120)}`, { sz: 1200, color: C.muted }) : ''), { bullet: true, space: k ? 1100 : 0 });
      }).join('');
      shapes += textBox({ x: M, y, w: W - 2 * M, h: Math.max(600000, H - y - 900000), paras });
    }
    if (s.note) shapes += textBox({ x: M, y: H - 850000, w: W - 2 * M, h: 280000, paras: para(run(cut(s.note, 220), { sz: 1100, color: C.muted })) });
  }
  shapes += textBox({ x: M, y: H - 480000, w: W - 2 * M, h: 240000, paras: `<a:p><a:pPr algn="r"><a:buNone/></a:pPr>${run(`${cut(footer, 90)} · ${i + 1}/${total}`, { sz: 1000, color: C.muted })}</a:p>` });
  return `${HEAD}<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="JuristAI"><a:themeElements>`
  + `<a:clrScheme name="JuristAI"><a:dk1><a:srgbClr val="${C.fg}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2430"/></a:dk2><a:lt2><a:srgbClr val="F1F1EE"/></a:lt2>`
  + `<a:accent1><a:srgbClr val="${C.cta}"/></a:accent1><a:accent2><a:srgbClr val="2A4FC4"/></a:accent2><a:accent3><a:srgbClr val="1F9D63"/></a:accent3><a:accent4><a:srgbClr val="D9434A"/></a:accent4><a:accent5><a:srgbClr val="8E8F93"/></a:accent5><a:accent6><a:srgbClr val="${C.soft}"/></a:accent6>`
  + `<a:hlink><a:srgbClr val="${C.cta}"/></a:hlink><a:folHlink><a:srgbClr val="2A4FC4"/></a:folHlink></a:clrScheme>`
  + '<a:fontScheme name="JuristAI"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + '<a:fmtScheme name="JuristAI"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'
  + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
const MASTER = `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${EMPTY_TREE}</p:cSld>`
  + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
  + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';
const LAYOUT = `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const rels = list => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;

async function buildPptx({ title = 'JuristAI', slides = [], footer = 'JuristAI' } = {}) {
  const list = slides.length ? slides : [{ kind: 'cover', title }];
  const zip = new JSZip();
  const ct = 'application/vnd.openxmlformats-officedocument.presentationml';
  zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/ppt/presentation.xml" ContentType="${ct}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${ct}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${ct}.slideLayout+xml"/>`
    + `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`
    + list.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${ct}.slide+xml"/>`).join('')
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
  zip.file('_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>`
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
  const now = new Date().toISOString().replace(/\.\d+Z$/u, 'Z');
  zip.file('docProps/core.xml', `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(cut(title, 200))}</dc:title><dc:creator>JuristAI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>JuristAI</Application><Slides>${list.length}</Slides></Properties>`);
  zip.file('ppt/presentation.xml', `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${list.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${3 + i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...list.map((_, i) => [`rId${3 + i}`, 'slide', `slides/slide${i + 1}.xml`])]));
  zip.file('ppt/slideMasters/slideMaster1.xml', MASTER);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]));
  zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  zip.file('ppt/theme/theme1.xml', THEME);
  list.forEach((s, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(s, i, list.length, footer));
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]));
  });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildPptx, LIMITS: LIM };
