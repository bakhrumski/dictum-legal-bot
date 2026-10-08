'use strict';

/**
 * A minimal DOCX package from body XML, for tests (synthetic text only).
 * cell(text, { span, vmerge: 'restart' | 'continue' }), row(cells, { header }),
 * table(rows), p(text).
 */
const JSZip = require('jszip');

const esc = s => String(s).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const p = text => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
function cell(text, { span = 1, vmerge = null } = {}) {
  const pr = `${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${vmerge === 'restart' ? '<w:vMerge w:val="restart"/>' : vmerge === 'continue' ? '<w:vMerge/>' : ''}`;
  const paras = String(text).split('\n').map(p).join('') || '<w:p/>';
  return `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}${paras}</w:tc>`;
}
const row = (cells, { header = false } = {}) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`;
const table = rows => `<w:tbl><w:tblPr/>${rows.join('')}</w:tbl>`;

async function docx(bodyXml) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { docx, p, cell, row, table };
