'use strict';
// 2026-11-06 (owner's screenshot): a Russian document analysis read "Это значит, что п. Для вас ..." -
// the split took "п." for a sentence's end, "7.3 ..." became a claim of its own, was withheld and
// "п." was left behind. A point after an abbreviation or a single letter does not end a sentence.
const assert = require('assert');
const { sentences, removeSentences } = require('../src/rag/legal-claim-guard');
const text = 'Это значит, что п. 7.3 ограничивает ответственность 10% суммы. Для вас это означает лимит. По п. 3.4) оплата через 5 дней. Ст. 333 ГК применима. Muddat odatda bir yil. Keyingi gap.';
const s = sentences(text);
assert.deepStrictEqual(s, ['Это значит, что п. 7.3 ограничивает ответственность 10% суммы.', 'Для вас это означает лимит.', 'По п. 3.4) оплата через 5 дней.', 'Ст. 333 ГК применима.', 'Muddat odatda bir yil.', 'Keyingi gap.']);
const out = removeSentences(text, [s[0], s[2]]);
assert.ok(!/п\.\s*(Для|Ст)/u.test(out) && !/что п\./u.test(out), out);
assert.ok(out.startsWith('Для вас это означает лимит.'), out);
console.log('claim guard: an abbreviation or an initial does not end a sentence');

// the same screenshot: an Uzbek request quoting one Russian word was answered in Russian
const { lexLangForText } = require('../src/rag/legal-opinion');
assert.strictEqual(lexLangForText('Şu hujjatni tahlil qilib ber. Men "Исполнитель" yuristiman.'), 'uz');
assert.strictEqual(lexLangForText('Men «Исполнитель» tomondaman'), 'uz');
assert.strictEqual(lexLangForText('Проанализируй договор'), 'ru');
assert.strictEqual(lexLangForText('Договор с ООО Unitel'), 'ru');
assert.strictEqual(lexLangForText('Ishchi ҳақида'), 'uz');
console.log('answer language: a quoted Russian word does not make an Uzbek request Russian');
