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
['setStrikethrough', 'setForegroundColor', 'setBackgroundColor', 'setUnderline', 'setBold', 'setItalic', 'setLinkUrl'].forEach(m => {
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

// ---- review: highlight found quotes, notes section at the end, clear again ----
const named = [];
Object.assign(ctx.DocumentApp.ElementType, { PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM' });
Para.prototype.getType = function () { return this.kind === 'li' ? 'LIST_ITEM' : 'PARAGRAPH'; };
Para.prototype.asParagraph = function () { return this; };
Para.prototype.getText = function () { return this.s; };
Para.prototype.asText = function () { return new Txt(this); };
Object.assign(body, {
  getChild(i) { return this.kids[i]; },
  appendParagraph(t) { const p = new Para(t); this.kids.push(p); return p; },
  appendListItem(t) { const p = new Para(t, 'li'); this.kids.push(p); return p; },
  findText(pattern) {
    const re = new RegExp(pattern);
    for (const k of this.kids) { const m = re.exec(k.s); if (m) return { getElement: () => k, getStartOffset: () => m.index, getEndOffsetInclusive: () => m.index + m[0].length - 1 }; }
    return null;
  },
});
Object.assign(doc, {
  newRange() { const els = []; const b = { addElement(t, s, e) { els.push([t, s, e]); return b; }, build() { return { getRangeElements: () => els.map(([t, s, e]) => ({ getElement: () => ({ asText: () => t }), getStartOffset: () => s, getEndOffsetInclusive: () => e })) }; } }; return b; },
  addNamedRange(name, r) { const nr = { name, getRange: () => r, remove() { named.splice(named.indexOf(nr), 1); } }; named.push(nr); return nr; },
  getNamedRanges(name) { return named.filter(n => n.name === name); },
});
body.kids = [new Para('IJARA SHARTNOMASI'), new Para('2. Kechikkan har bir kun uchun 5% penya to‘lanadi.'), new Para('3. Yakun.')];
const res = ctx.jaiApplyReview([
  { quote: "Kechikkan har bir kun uchun 5% penya to'lanadi", problem: 'Penya yuqori.', basis: '[FK 326](https://lex.uz/docs/111189)', advice: 'Kamaytiring.', newText: '0,1% penya' },
  { quote: '', problem: 'Nizolar bandi yo‘q.', basis: '', advice: 'Qo‘shing.', newText: '' },
  { quote: 'bunday matn hujjatda yo‘q umuman', problem: 'X', basis: '', advice: '', newText: '' },
], true);
assert.strictEqual(JSON.stringify(Array.from(res, r => r.where)), JSON.stringify(['found', 'general', 'missing']));
assert.ok(res[0].edited, 'apostrophe variants still match; edit applied');
assert.ok(body.kids[1].s.includes('5% penya to‘lanadi 0,1% penya'), body.kids[1].s);
assert.ok(body.kids[1].fmt.some(f => f[0] === 'setBackgroundColor' && f[3] === '#FFF1A8'));
const title = body.kids.findIndex(k => k.s === 'JuristAI izohlari');
assert.ok(title > 2 && body.kids.slice(title + 1).length === 3 && body.kids[title + 1].kind === 'li');
assert.match(body.kids[title + 2].s, /^Yetishmayotgan shart: Nizolar/);
assert.match(body.kids[title + 3].s, /matnda aniq topilmadi/);
// a second review replaces the notes section, not stacks it
ctx.jaiApplyReview([{ quote: '', problem: 'Bir.', basis: '', advice: '', newText: '' }], false);
assert.strictEqual(body.kids.filter(k => k.s === 'JuristAI izohlari').length, 1);
assert.strictEqual(ctx.jaiClearReview(), 1);
assert.ok(!body.kids.some(k => k.s === 'JuristAI izohlari' || k.kind === 'li'));
assert.ok(body.kids[1].fmt.some(f => f[0] === 'setBackgroundColor' && f[3] === null), 'highlight cleared');
console.log('Code.gs mock: all passed');
