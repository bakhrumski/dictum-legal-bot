'use strict';

/**
 * U5b (docs/design/ux-audit-2026-11.md; the owner's answer 4: one chat unit a
 * question, kept with the document and in Suhbatlar): "Shu joy haqida
 * so'rash" in the editor. The ordinary chat chain answers (POST
 * /api/legal-chat, streamed, the document as documentText, the place in the
 * question); a cost confirmation is shown, never skipped; the answer becomes
 * a comment on the place or plain paragraphs under it in one tap; the chat is
 * saved to Suhbatlar (topic "editor:<id>") and goes on next time. The server
 * is unchanged. Frontend only.
 *
 *   node tests/editor-ask.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('editor: ask about this place (U5b)');
const ask = read('public', 'app', 'editor-ask.js');
const ed = read('public', 'app', 'editor.js');

test('the ordinary chain: /api/legal-chat streamed, the document as documentText, the place in the question', () => {
  assert.ok(ask.includes("fetch('/api/legal-chat', { method: 'POST', credentials: 'same-origin'"));
  assert.ok(ask.includes('documentText: docText || null'));
  assert.ok(ask.includes("var msg = place ? s('q', { quote: place.quote.slice(0, 1500), q: q }) : q;"));
  assert.ok(ask.includes('stream: true'));
  assert.ok(!/\/api\/legal-chat[^']*\?/.test(ask), 'no special mode of the answer pipeline');
});

test('the price: a cost confirmation is shown and only its { service: units } is sent; never the click event', () => {
  assert.ok(ask.includes("if (res.status === 409 && d.code === 'DOC_COST_CONFIRM')"));
  assert.ok(ask.includes("$('[data-a=send]', side).onclick = function () { send(); };"));
  assert.ok(ask.includes('confirmedJob: isJob(confirmedJob) ? confirmedJob : null'));
  assert.ok(/function isJob\(x\) \{ return !!x && Object\.prototype\.toString\.call\(x\) === '\[object Object\]'/.test(ask));
  assert.ok(ask.includes("if (J.handleLimit && J.handleLimit(d))"), 'a spent limit opens the plans as in the chat');
});

test('one tap: a comment on the place (marked by an editor), or plain paragraphs under it; headings stay out', () => {
  assert.ok(ed.includes('addFrom: async function (range, quote, body)'));
  assert.ok(ed.includes("if (can.canMark && range) { ed.chain().setTextSelection(range).setMark('comment', { id: r.data.id }).run(); changed(); }"));
  assert.ok(ask.includes("return { type: 'paragraph', content: [{ type: 'text', text: l }] };"), 'never markup from the answer');
  assert.ok(ask.includes('(Tahlil|Xulosa|Анализ|Вывод|Analysis|Conclusion)'));
  assert.ok(ask.includes("(o.canWrite ? '<button type=\"button\" class=\"pill sm ghost\" data-a=\"ins\">"), 'only an editor puts text in');
  assert.ok(read('public', 'app', 'editor-ai.js').includes('J.editorFindQuote = function (ed, words) { return locate(ed, words); };'));
});

test('kept: in Suhbatlar with the document\'s topic; the same chat goes on; the question shown as written', () => {
  assert.ok(ask.includes("topic: 'editor:' + o.id"));
  assert.ok(ask.includes("if (!r.ok || (r.data.topic && r.data.topic !== 'editor:' + o.id))"), 'a chat of another document is never taken');
  assert.ok(/function shownOf\(m\)/.test(ask));
});

test('wiring: the top button, one side panel at a time, an AI card opens it on its place; script order', () => {
  assert.ok(ed.includes('<button class="pill sm ghost" type="button" data-a="ask">'));
  assert.ok(ed.includes('panels = [AI || null, CHK, KB, ASK].filter(Boolean)'));
  assert.ok(read('public', 'app', 'editor-ai.js').includes('if (J.editorAskAt) J.editorAskAt(r.excerpt);'));
  assert.ok(/<script src="\/app\/editor-ask\.js\?v=\d+"><\/script>[\s\S]*<script src="\/app\/editor\.js/.test(read('public', 'app', 'index.html')));
  assert.ok(read('public', 'app', 'app.css').includes('.ea-ctx{background:var(--accent-soft)'), 'the place on light blue');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
