'use strict';

/**
 * Answer layout (2026-10-24, owner): a legal answer has two sections, Tahlil
 * and Xulosa. A separate "Huquqiy asos" repeated what Tahlil and Xulosa said
 * (the 2026-10-24 Telegram answer on a contractor's advance cited art. 642
 * three times). Tahlil opens with the deciding norm (name, number, article,
 * the "> «...»" quote) and applies it; Xulosa answers in 1-2 sentences
 * without repeating Tahlil. Every prompt that writes a legal answer says so:
 * web chat and Telegram (buildTopicPrompt), the general search prompt, the
 * Gemini fallback, advanced RAG. Source checks only - no AI.
 *
 *   node tests/answer-layout.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('no answer prompt asks for a "Huquqiy asos" section any more', () => {
  const server = read('src/api/server.js');
  assert.ok(!/^\*\*Huquqiy asos\*\* —/mu.test(server), 'server.js prompts');
  assert.ok(!/^\*\*Huquqiy asos\*\*$/mu.test(read('src/rag/system-prompt.js')), 'advanced RAG prompt');
  assert.ok(!/uch qismda/u.test(read('src/prompts/universal-legal-research-playbook.md')), 'playbook');
});

test('chat / Telegram, the search prompt and the Gemini fallback: Tahlil opens with the norm, Xulosa does not repeat it', () => {
  const server = read('src/api/server.js');
  assert.strictEqual((server.match(/JAVOB FORMATI \(2 bo'lim/gu) || []).length, 3);
  assert.match(server, /\*\*Tahlil\*\* — Savolni hal qiluvchi normadan boshlang/u);
  assert.match(server, /har bir normani BIR MARTA keltiring/u);
  assert.match(server, /\*\*Xulosa\*\* — 1-2 gap: savolga to'g'ridan-to'g'ri javob va eng muhim keyingi qadam\. Tahlildagi dalillar, moddalar va iqtiboslarni TAKRORLAMANG\./u);
});

test('the law quote now sits in Tahlil; the cross-check keeps the sections without adding one', () => {
  const s = require('../src/rag/answer-structure');
  assert.match(s.promptRules('uz'), /^- Tahlilda, hal qiluvchi normani keltirgan joyda/u);
  assert.match(s.promptRules('ru'), /^- В анализе, там где названа решающая норма/u);
  assert.match(read('src/rag/legal-answer-cross-check.js'), /javobning bo'limlarini \(Tahlil \/ Xulosa; eski javobda Huquqiy asos ham bo'lishi mumkin\) yangi bo'lim qo'shmasdan/u);
});

test('the analysis scope is still found in a two-section answer', () => {
  const { extractAnalysisSection } = require('../src/rag/citation-utils');
  const answer = "**Tahlil**\nFuqarolik kodeksi, 642-modda ikkinchi qism: buyurtmachi voz kechishga haqli.\n\n**Xulosa**\nAvansni qaytarishni talab qiling.";
  assert.strictEqual(extractAnalysisSection(answer), 'Fuqarolik kodeksi, 642-modda ikkinchi qism: buyurtmachi voz kechishga haqli.');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
