'use strict';

/**
 * Legal glossary for speech-to-text (2026-10-28, owner: a voice command
 * "Pudratchi bilan nizo" was heard as "Qudratxo'ja bilan nizo").
 *
 * Neither speech engine here takes a vocabulary list (VoiceLab STT, Gemini
 * Transcribe: language and mode only), so the glossary works AFTER the
 * transcript: a word that is not a known term but shares most of a term's
 * stem is offered as a suggestion ("Qudratxo'ja" -> "Pudratchi?"). Nothing
 * is replaced by itself - a real name ("Qudratxo'ja aka") must stay as said,
 * so the person picks. No AI, no network.
 *
 *   suggest(text, { extra, fixes })  -> [{ from, to, personal? }]  at most 3
 *   apply(text, suggestions)          -> the text with those words replaced
 *   learnPairs(heard, final)          -> [{ from, to }] words the person changed
 *
 * `extra` adds words of the person's own (a client's name, a firm's term):
 * never flagged, and a mis-heard form of one is suggested. `fixes` are the
 * person's own corrections ({ heard: term }, src/voice/user-glossary.js):
 * a word heard that way again is suggested first, as theirs.
 */

// Uzbek (Latin) legal words as they are said; each also covers its suffixed
// forms ("pudratchi" -> "pudratchiga", "pudratchidan").
const TERMS = Object.freeze([
  'pudrat', 'pudratchi', 'buyurtmachi', 'ijara', 'ijarachi', 'ijaraga beruvchi', 'lizing', 'oldi-sotdi', 'sotuvchi', 'xaridor',
  'yetkazib beruvchi', 'yetkazib berish', 'hadya', 'ayirboshlash', 'ssuda', 'qarz', 'qarzdor', 'kreditor', 'debitor', 'garov',
  'garovga qo\'yuvchi', 'ipoteka', 'kafolat', 'kafil', 'kafillik', 'neustoyka', 'penya', 'jarima', 'foiz', 'zarar', 'ziyon',
  'kompensatsiya', 'ma\'naviy zarar', 'shartnoma', 'kelishuv', 'qo\'shimcha kelishuv', 'nizo', 'da\'vo', 'da\'vogar', 'javobgar',
  'uchinchi shaxs', 'talabnoma', 'pretenziya', 'sud', 'iqtisodiy sud', 'fuqarolik sudi', 'ma\'muriy sud', 'apellyatsiya',
  'kassatsiya', 'nazorat', 'hal qiluv qarori', 'ajrim', 'qaror', 'ijro', 'ijro varaqasi', 'sud ijrochisi', 'notarius',
  'ishonchnoma', 'vakil', 'vakolat', 'advokat', 'yurist', 'bayonnoma', 'dalolatnoma', 'hisob-faktura', 'ustav', 'ta\'sischi',
  'ishtirokchi', 'ulush', 'aksiya', 'aksiyador', 'dividend', 'direktor', 'kuzatuv kengashi', 'umumiy yig\'ilish', 'tadbirkor',
  'yakka tartibdagi tadbirkor', 'bankrotlik', 'tugatish', 'qayta tashkil etish', 'soliq', 'bojxona', 'litsenziya',
  'ruxsatnoma', 'kadastr', 'ko\'chmas mulk', 'yer uchastkasi', 'meros', 'merosxo\'r', 'vasiyat', 'vasiyatnoma', 'nikoh',
  'ajralish', 'aliment', 'vasiy', 'homiy', 'mehnat', 'xodim', 'ish beruvchi', 'mehnat shartnomasi', 'ishdan bo\'shatish',
  'ish haqi', 'mehnat ta\'tili', 'avans', 'to\'lov', 'to\'lov topshiriqnomasi', 'muddat', 'da\'vo muddati', 'majburiyat',
  'javobgarlik', 'huquq', 'mulk', 'mulkdor', 'egalik', 'foydalanish', 'tasarruf', 'sug\'urta', 'sug\'urtalovchi', 'omonat',
  'komissiya', 'topshiriq', 'vositachilik', 'franchayzing', 'maxfiylik', 'fors-major', 'arbitraj', 'hakamlik', 'mediatsiya',
  'ekspertiza', 'dalil', 'guvoh', 'ariza', 'shikoyat', 'murojaat', 'prokuratura', 'tergov', 'jinoyat', 'huquqbuzarlik',
  'ma\'muriy javobgarlik', 'iste\'molchi', 'kafolat muddati', 'nuqson', 'qaytarish', 'undirish', 'bekor qilish',
  'MChJ', 'AJ', 'QQS',
]);

// suffixes of a said word ("pudratchiga" -> "pudratchi"), longest first
const SUFFIXES = ['larning', 'laridan', 'lariga', 'larini', 'larda', 'lardan', 'lar', 'ning', 'dagi', 'dan', 'gacha', 'ga', 'ka', 'qa', 'da', 'ni', 'ning', 'i', 'si'];

const norm = s => String(s || '').toLocaleLowerCase('uz').replace(/[ʻʼ‘’`´']/gu, "'");
const bare = s => norm(s).replace(/'/gu, '');

function stem(w) {
  const x = bare(w);
  for (const suf of SUFFIXES) if (x.length - suf.length >= 4 && x.endsWith(suf)) return x.slice(0, -suf.length);
  return x;
}

/** the longest run of letters the two strings share: { len, at } (at: where it ends in `a`) */
function commonRunAt(a, b) {
  let best = 0, at = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let last = 0;
    for (let j = 1; j <= b.length; j++) {
      const cur = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? last + 1 : 0;
      if (prev[j] > best) { best = prev[j]; at = i; }
      last = cur;
    }
  }
  return { len: best, at };
}
const commonRun = (a, b) => commonRunAt(a, b).len;

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// single words of the glossary (multi-word terms count by each long word)
function wordsOf(list) {
  const out = new Set();
  for (const t of list) for (const w of String(t).split(/[\s-]+/u)) if (bare(w).length >= 4) out.add(w);
  return [...out];
}
const BASE_WORDS = wordsOf(TERMS);

/**
 * Words of `text` that look like a mis-heard glossary term. A word that is a
 * term (or a suffixed form of one) is never flagged.
 */
/** the said word is a term or a form of it: it starts with the term (less its last two letters: "qaytarish" -> "qaytarilmadi") */
function isFormOf(said, w) {
  const a = bare(said), b = bare(w);
  return a.startsWith(b.length > 6 ? b.slice(0, b.length - 2) : b) && a.length - b.length <= 8;
}

function suggest(text, { extra = [], fixes = {} } = {}) {
  const words = wordsOf(extra).concat(BASE_WORDS);
  const own = new Map(Object.entries(fixes || {}).map(([h, t]) => [bare(h), t]));
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(/[A-Za-zʻʼ‘’'`´А-Яа-яЁёЎўҚқҒғҲҳ-]{4,}/gu)) {
    const said = m[0].replace(/^-+|-+$/gu, '');
    // the person's own correction of this very word comes first
    const mine = own.get(bare(said));
    if (mine && bare(mine) !== bare(said) && !seen.has(bare(said))) {
      seen.add(bare(said));
      out.push({ from: said, to: /^[A-ZА-ЯЁЎҚҒҲ]/u.test(said) ? mine.charAt(0).toUpperCase() + mine.slice(1) : mine, personal: true });
      if (out.length >= 3) break;
      continue;
    }
    const s = stem(said);
    if (s.length < 5 || seen.has(s) || words.some(w => isFormOf(said, w))) continue;
    let best = null;
    for (const w of words) {
      const ws = stem(w);
      if (Math.abs(ws.length - s.length) > 4) continue;
      const dist = distance(bare(said), bare(w));
      // one letter off a long word: a slip ("Qurulish" for "Qurilish")
      const slip = dist <= 1 && bare(w).length >= 6;
      const r = commonRunAt(s, ws), run = r.len;
      // most of the term's stem is in the said word, and the two are close overall;
      // a short shared ENDING is a suffix ("-ilish"), not the same word
      const endsOnly = run < 6 && r.at === s.length && ws.endsWith(s.slice(r.at - run, r.at));
      if (!slip && (run < 5 || run / ws.length < 0.55 || endsOnly)) continue;
      if (dist > Math.max(2, Math.ceil(Math.max(said.length, w.length) * 0.55))) continue;
      const score = run * 3 - dist - Math.abs(bare(w).length - bare(said).length);
      if (!best || score > best.score) best = { w, score };
    }
    if (best) {
      seen.add(s);
      const cap = /^[A-ZА-ЯЁЎҚҒҲ]/u.test(said);
      out.push({ from: said, to: cap ? best.w.charAt(0).toUpperCase() + best.w.slice(1) : best.w });
      if (out.length >= 3) break;
    }
  }
  return out;
}

/**
 * The words the person changed between the heard text and what they ran or
 * sent: only when both have the same number of words (a rewrite says nothing
 * about one word), only words of 4+ letters, at most 3.
 */
function learnPairs(heardText, finalText) {
  const a = String(heardText || '').trim().split(/\s+/u), b = String(finalText || '').trim().split(/\s+/u);
  if (!a[0] || a.length !== b.length) return [];
  const clip = w => w.replace(/^[«"“(]+|[»"”).,:;!?]+$/gu, '');
  const out = [];
  for (let i = 0; i < a.length && out.length < 3; i++) {
    const x = clip(a[i]), y = clip(b[i]);
    if (x.length >= 4 && y.length >= 4 && bare(x) !== bare(y) && /\p{L}/u.test(y)) out.push({ from: x, to: y });
  }
  return out.length <= 3 && out.length < a.length ? out : [];
}

function apply(text, suggestions = []) {
  let out = String(text || '');
  for (const s of suggestions) out = out.split(s.from).join(s.to);
  return out;
}

module.exports = { suggest, apply, learnPairs, TERMS, stem, bare };
