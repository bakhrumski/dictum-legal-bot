'use strict';
// Google Docs add-in: addins/gdocs/Code.gs against a small DocumentApp stand-in (Apps Script does not run here).
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const code = fs.readFileSync(require('path').join(__dirname, '..', 'addins', 'gdocs', 'Code.gs'), 'utf8');
function Txt(p) { this.p = p; }
Object.assign(Txt.prototype, {
  getText() { return this.p.s; }, setText(t) { this.p.s = t; this.p.fmt = []; return this; },
  insertText(i, t) { assert.ok(i >= 0 && i <= this.p.s.length, 'insert offset ' + i); this.p.s = this.p.s.slice(0, i) + t + this.p.s.slice(i); return this; },
  deleteText(a, b) { assert.ok(a >= 0 && b < this.p.s.length && b >= a, `delete ${a}-${b} of ${this.p.s.length}`); this.p.s = this.p.s.slice(0, a) + this.p.s.slice(b + 1); return this; },
});
['setStrikethrough', 'setForegroundColor', 'setUnderline', 'setBold', 'setItalic', 'setLinkUrl'].forEach(m => {
  Txt.prototype[m] = function (...a) { if (a.length === 3) assert.ok(a[0] >= 0 && a[1] < this.p.s.length && a[1] >= a[0], `${m} ${a[0]}-${a[1]} of ${this.p.s.length}`); this.p.fmt.push([m, ...a]); return this; };
});
const BODY = { kids: [], getType: () => 'BODY_SECTION' };
function Para(s, kind) { this.s = s; this.kind = kind || 'p'; this.fmt = []; }
Object.assign(Para.prototype, {
  editAsText() { return new Txt(this); }, setText(t) { this.s = t; return this; },
  getParent() { return BODY.kids.includes(this) ? BODY : null; }, getType() { return 'PARAGRAPH'; },
  setHeading(h) { this.h = h; return this; }, setGlyphType(g) { this.g = g; return this; },
  removeFromParent() { BODY.kids.splice(BODY.kids.indexOf(this), 1); },
});
const body = Object.assign(BODY, {
  getText() { return this.kids.map(k => k.s).join('\n'); }, getNumChildren() { return this.kids.length; },
  getChildIndex(e) { return this.kids.indexOf(e); },
  insertParagraph(i, t) { const p = new Para(t); this.kids.splice(i, 0, p); return p; },
  insertListItem(i, t) { const p = new Para(t, 'li'); this.kids.splice(i, 0, p); return p; },
});
let selection = null, cursor = null;
const doc = { getBody: () => body, getSelection: () => selection, getCursor: () => cursor };
const ctx = { DocumentApp: { getActiveDocument: () => doc, ElementType: { BODY_SECTION: 'BODY_SECTION' }, GlyphType: { NUMBER: 'NUMBER', BULLET: 'BULLET' }, ParagraphHeading: { HEADING3: 'H3', NORMAL: 'N' }, getUi: () => ({}) }, HtmlService: {} };
vm.createContext(ctx); vm.runInContext(code, ctx);
function re(el, s, e) { return { getElement: () => el, isPartial: () => s != null, getStartOffset: () => s, getEndOffsetInclusive: () => e }; }

// partial selection inside one paragraph
body.kids = [new Para('1. Ijara haqi.'), new Para('2. Kechikkan har bir kun uchun 5% penya.'), new Para('3. Yakun.')];
const p2 = body.kids[1];
const i5 = p2.s.indexOf('5% penya'); selection = { getRangeElements: () => [re(p2, i5, i5 + 7)] };
assert.strictEqual(ctx.jaiSelection().text, '5% penya');
ctx.jaiReplace('5% penya', '0,1 foiz penya', false);
assert.strictEqual(p2.s, '2. Kechikkan har bir kun uchun 0,1 foiz penya.');

// whole paragraphs, plain replace: first rewritten, second removed
body.kids = [new Para('A'), new Para('B bandi'), new Para('C bandi'), new Para('D')];
selection = { getRangeElements: () => [re(body.kids[1]), re(body.kids[2])] };
assert.strictEqual(ctx.jaiSelection().text, 'B bandi\nC bandi');
ctx.jaiReplace('B bandi\nC bandi', 'Yangi band', false);
assert.deepStrictEqual(body.kids.map(k => k.s), ['A', 'Yangi band', 'D']);

// redline
body.kids = [new Para('Eski matn shu.')];
selection = { getRangeElements: () => [re(body.kids[0])] };
ctx.jaiReplace('Eski matn shu.', 'Yangi matn.', true);
assert.strictEqual(body.kids[0].s, 'Eski matn shu. Yangi matn.');
assert.ok(body.kids[0].fmt.some(f => f[0] === 'setStrikethrough' && f[3] === true));

// changed selection refuses
assert.throws(() => ctx.jaiReplace('boshqa matn', 'x', false), /o'zgargan/);

// insert after the cursor's paragraph, with bold and a link
body.kids = [new Para('A'), new Para('B'), new Para('C')];
selection = null; cursor = { getElement: () => body.kids[1] };
ctx.jaiInsertBlocks([{ t: 'h', text: 'Xulosa' }, { t: 'p', text: '**Muhim:** penya [FK 326](https://lex.uz/docs/111189#326) bo‘yicha.' }, { t: 'oli', text: '[Kodeks](https://lex.uz/docs/111189)' }]);
assert.deepStrictEqual(body.kids.map(k => k.s), ['A', 'B', 'Xulosa', 'Muhim: penya FK 326 bo‘yicha.', 'Kodeks', 'C']);
assert.ok(body.kids[3].fmt.some(f => f[0] === 'setBold' && f[1] === 0 && f[2] === 5));
assert.ok(body.kids[3].fmt.some(f => f[0] === 'setLinkUrl' && f[3] === 'https://lex.uz/docs/111189#326'));
assert.strictEqual(body.kids[4].g, 'NUMBER');

// no cursor, no selection: appended at the end
cursor = null; ctx.jaiInsertBlocks([{ t: 'p', text: 'oxiri' }]);
assert.strictEqual(body.kids[body.kids.length - 1].s, 'oxiri');
console.log('Code.gs mock: all passed');
