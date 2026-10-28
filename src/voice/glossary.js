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
 *   suggest(text, { extra })  -> [{ from, to }]  at most 3
 *   apply(text, suggestions)  -> the text with those words replaced
 *
 * `extra` adds words of the person's own (e.g. their matter titles).
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

/** the longest run of letters the two strings share */
function commonRun(a, b) {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let last = 0;
    for (let j = 1; j <= b.length; j++) {
      const cur = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? last + 1 : 0;
      if (prev[j] > best) best = prev[j];
      last = cur;
    }
  }
  return best;
}

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

function suggest(text, { extra = [] } = {}) {
  const words = BASE_WORDS.concat(wordsOf(extra));
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(/[A-Za-zʻʼ‘’'`´А-Яа-яЁёЎўҚқҒғҲҳ-]{5,}/gu)) {
    const said = m[0].replace(/^-+|-+$/gu, '');
    const s = stem(said);
    if (s.length < 5 || seen.has(s) || words.some(w => isFormOf(said, w))) continue;
    let best = null;
    for (const w of words) {
      const ws = stem(w);
      if (Math.abs(ws.length - s.length) > 4) continue;
      const run = commonRun(s, ws);
      // most of the term's stem is in the said word, and the two are close overall
      if (run < 5 || run / ws.length < 0.55) continue;
      const dist = distance(bare(said), bare(w));
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

function apply(text, suggestions = []) {
  let out = String(text || '');
  for (const s of suggestions) out = out.split(s.from).join(s.to);
  return out;
}

module.exports = { suggest, apply, TERMS, stem };
