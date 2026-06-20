'use strict';

/**
 * Answer Verification Layer
 *
 * Screens EVERY legal document an AI answer cites — even documents that were
 * never ingested into our corpus — against the lex.uz "Hujjat kuchini
 * yo'qotgan" (document repealed) status.
 *
 * Why this exists:
 *   The corpus freshness checker (check-freshness.js) only covers documents
 *   already in our database. But the worst failure mode is the LLM citing a
 *   document from its TRAINING MEMORY that we never ingested (e.g. PQ-3126,
 *   repealed 20.01.2026). For those, no DB filter ever runs.
 *
 * Screening tiers applied to each cited document:
 *   1. In corpus + is_active = TRUE   → ok (grounded, in force)
 *   2. In corpus + is_active = FALSE  → EXPIRED (warn)
 *   3. Not in corpus, but a lex.uz URL → live-fetch, check banner
 *   4. Not in corpus, bare PF/PQ/VM #  → UNVERIFIED (warn — we cannot confirm
 *                                        it is in force; it may be repealed)
 *
 * If any cited document is expired or unverified, a clear Uzbek notice is
 * appended to the answer so the user is never silently given a stale citation.
 */

const log = require('../utils/logger').createLogger('VERIFY');

const LIVE_FETCH_ENABLED = process.env.ANSWER_VERIFICATION_LIVE_FETCH !== 'false';
const LIVE_FETCH_TIMEOUT_MS = parseInt(process.env.ANSWER_VERIFICATION_TIMEOUT_MS || '6000', 10);
const LIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// ─────────────────────────────────────────────────────────────────────────────
// Reference extraction
// ─────────────────────────────────────────────────────────────────────────────

// Decree / law number prefixes, Latin + Cyrillic. Repealable document types.
//   PF / ПФ  = Prezident farmoni
//   PQ / ПҚ  = Prezident qarori
//   VM / ВМ  = Vazirlar Mahkamasi qarori
//   O'RQ/ЎРҚ = O'zR Qonuni
//   QR / ҚР  = Qonun
// Unicode-aware boundaries (?<![\p{L}\p{N}]) / (?![\p{L}\p{N}]) — JS \b is
// ASCII-only even under /u, so a plain \b never fires before Cyrillic "ПҚ".
const DECREE_NUMBER_RE =
  /(?<![\p{L}\p{N}])(PF|PQ|VM|O['`’]?RQ|QR|ПФ|ПҚ|ВМ|ЎРҚ|ҚР)\s*[-–—]?\s*(\d{1,5})(?:\s*[-–—]?\s*(?:son|сон))?(?![\p{L}\p{N}])/giu;

const LEX_URL_RE = /https?:\/\/(?:www\.)?lex\.uz\/[^\s)\]"'<>]+/gi;

const CYRILLIC_TO_LATIN_PREFIX = {
  'ПФ': 'PF', 'ПҚ': 'PQ', 'ВМ': 'VM', 'ЎРҚ': 'ORQ', 'ҚР': 'QR',
};

/**
 * Normalize a decree number reference to a canonical comparable key,
 * e.g. "ПҚ-3126-сон" → "PQ-3126", "PQ 3126 son" → "PQ-3126".
 */
function normalizeDecreeNumber(prefix, digits) {
  let p = (prefix || '').toUpperCase().replace(/['`’]/g, '');
  p = CYRILLIC_TO_LATIN_PREFIX[p] || p;
  return `${p}-${digits}`;
}

/**
 * Normalize an arbitrary corpus document_number string for comparison.
 * Returns a canonical "PREFIX-DIGITS" key if it parses, else the trimmed
 * uppercased original.
 */
function normalizeCorpusNumber(raw) {
  if (!raw) return '';
  DECREE_NUMBER_RE.lastIndex = 0;
  const m = DECREE_NUMBER_RE.exec(String(raw));
  if (m) return normalizeDecreeNumber(m[1], m[2]);
  return String(raw).trim().toUpperCase();
}

function normalizeUrl(url) {
  if (!url) return '';
  return String(url).trim().replace(/[).,;]+$/, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * Extract all document references (decree/law numbers + lex.uz URLs) from text.
 * @returns {Array<{kind:'number'|'url', key:string, raw:string}>}
 */
function extractDocReferences(text = '') {
  const refs = [];
  const seen = new Set();

  let m;
  DECREE_NUMBER_RE.lastIndex = 0;
  while ((m = DECREE_NUMBER_RE.exec(text)) !== null) {
    const key = normalizeDecreeNumber(m[1], m[2]);
    if (seen.has(`n:${key}`)) continue;
    seen.add(`n:${key}`);
    refs.push({ kind: 'number', key, raw: m[0] });
  }

  LEX_URL_RE.lastIndex = 0;
  while ((m = LEX_URL_RE.exec(text)) !== null) {
    const key = normalizeUrl(m[0]);
    if (seen.has(`u:${key}`)) continue;
    seen.add(`u:${key}`);
    refs.push({ kind: 'url', key, raw: m[0] });
  }

  return refs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpus document index (cached)
// ─────────────────────────────────────────────────────────────────────────────

let _corpusIndexCache = null;
let _corpusIndexAt = 0;
const CORPUS_INDEX_TTL_MS = 5 * 60 * 1000;

/**
 * Build a lookup of every distinct corpus document by normalized number and URL.
 * Includes inactive documents so we can detect "cited but repealed".
 */
async function buildCorpusDocIndex(pool) {
  const now = Date.now();
  if (_corpusIndexCache && now - _corpusIndexAt < CORPUS_INDEX_TTL_MS) {
    return _corpusIndexCache;
  }

  const byNumber = new Map();
  const byUrl = new Map();

  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (doc_id)
        doc_id, law_name, document_number, source_url, is_active, status_label
      FROM legal_chunks
      WHERE is_valid = TRUE
      ORDER BY doc_id, id
    `);

    for (const row of result.rows) {
      const entry = {
        doc_id: row.doc_id,
        law_name: row.law_name,
        is_active: row.is_active !== false,
        status_label: row.status_label || null,
        source_url: row.source_url || null,
      };
      const numKey = normalizeCorpusNumber(row.document_number);
      if (numKey) byNumber.set(numKey, entry);
      const urlKey = normalizeUrl(row.source_url);
      if (urlKey) byUrl.set(urlKey, entry);
    }
  } catch (err) {
    log.warn('corpus index build failed', { err: err.message });
  }

  _corpusIndexCache = { byNumber, byUrl };
  _corpusIndexAt = now;
  return _corpusIndexCache;
}

/** Clear the cache (used by check-freshness / ingest after corpus changes). */
function invalidateCorpusIndex() {
  _corpusIndexCache = null;
  _corpusIndexAt = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live lex.uz banner check (for URLs not in corpus)
// ─────────────────────────────────────────────────────────────────────────────

const _liveCache = new Map(); // url → { ts, is_active, status_label }

async function liveCheckUrl(url) {
  const key = normalizeUrl(url);
  const cached = _liveCache.get(key);
  if (cached && Date.now() - cached.ts < LIVE_CACHE_TTL_MS) return cached;

  // Lazy-require to avoid pulling cheerio/undici unless we actually live-check.
  const { fetchLexDocument } = require('./fetch-lex');

  const result = await Promise.race([
    fetchLexDocument(url),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('live-check timeout')), LIVE_FETCH_TIMEOUT_MS)
    ),
  ]);

  const entry = {
    ts: Date.now(),
    is_active: result.is_active !== false,
    status_label: result.status_label || null,
  };
  _liveCache.set(key, entry);
  return entry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main verification entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Screen every document cited in `answerText`.
 *
 * @param {string} answerText
 * @param {object} opts
 * @param {object} opts.pool          - pg pool (required for corpus lookup)
 * @param {boolean} opts.liveFetch    - override LIVE_FETCH_ENABLED
 * @returns {Promise<{
 *   references: Array,
 *   expired: Array, unverified: Array,
 *   hasIssues: boolean
 * }>}
 */
async function verifyAnswer(answerText, opts = {}) {
  const { pool, liveFetch = LIVE_FETCH_ENABLED } = opts;
  const references = extractDocReferences(answerText || '');

  const result = { references: [], expired: [], unverified: [], hasIssues: false };
  if (references.length === 0) return result;

  const index = pool ? await buildCorpusDocIndex(pool) : { byNumber: new Map(), byUrl: new Map() };

  for (const ref of references) {
    const lookup = ref.kind === 'url' ? index.byUrl.get(ref.key) : index.byNumber.get(ref.key);

    if (lookup) {
      // Tiers 1 & 2: in corpus
      if (lookup.is_active) {
        result.references.push({ ...ref, status: 'active_in_corpus', law_name: lookup.law_name });
      } else {
        const item = { ...ref, status: 'expired_in_corpus', law_name: lookup.law_name, status_label: lookup.status_label };
        result.references.push(item);
        result.expired.push(item);
      }
      continue;
    }

    // Not in corpus.
    if (ref.kind === 'url' && liveFetch) {
      // Tier 3: live banner check
      try {
        const live = await liveCheckUrl(ref.raw);
        if (live.is_active) {
          result.references.push({ ...ref, status: 'active_live' });
        } else {
          const item = { ...ref, status: 'expired_live', status_label: live.status_label };
          result.references.push(item);
          result.expired.push(item);
        }
      } catch (err) {
        log.warn('live check failed, marking unverified', { url: ref.raw, err: err.message });
        const item = { ...ref, status: 'unverified', reason: 'live_check_failed' };
        result.references.push(item);
        result.unverified.push(item);
      }
    } else {
      // Tier 4: bare number (or URL with live-fetch disabled) not in corpus.
      // We cannot confirm it is in force → flag as unverified.
      const item = { ...ref, status: 'unverified', reason: ref.kind === 'number' ? 'not_in_corpus' : 'live_fetch_disabled' };
      result.references.push(item);
      result.unverified.push(item);
    }
  }

  result.hasIssues = result.expired.length > 0 || result.unverified.length > 0;
  if (result.hasIssues) {
    log.info('answer verification flagged citations', {
      expired: result.expired.map(e => e.raw),
      unverified: result.unverified.map(u => u.raw),
    });
  }
  return result;
}

/**
 * Append an Uzbek warning block to the answer if verification found problems.
 * Non-destructive: the original answer is preserved, the notice is appended.
 */
function applyVerificationNotice(answerText, verification) {
  if (!verification || !verification.hasIssues) return answerText;

  const lines = ['\n\n---', "⚠️ **Hujjat holati ogohlantirishi**"];

  if (verification.expired.length > 0) {
    const list = verification.expired.map(e => {
      const label = e.status_label ? ` — ${e.status_label}` : " — kuchini yo'qotgan";
      return `\`${e.raw}\`${label}`;
    }).join('; ');
    lines.push(`- Quyidagi hujjat(lar) **KUCHINI YO'QOTGAN**: ${list}. Ularga tayanmang.`);
  }

  if (verification.unverified.length > 0) {
    const list = verification.unverified.map(u => `\`${u.raw}\``).join(', ');
    lines.push(`- Quyidagi hujjat(lar) ma'lumotlar bazamizda **tasdiqlanmagan**: ${list}. ` +
      `Ularning amaldagi holatini lex.uz dan tekshiring — eskirgan yoki o'zgartirilgan bo'lishi mumkin.`);
  }

  return answerText + lines.join('\n');
}

/**
 * Convenience: verify + append in one call. Never throws — on any error the
 * original answer is returned unchanged.
 */
async function screenAnswer(answerText, opts = {}) {
  try {
    const verification = await verifyAnswer(answerText, opts);
    return {
      text: applyVerificationNotice(answerText, verification),
      verification,
    };
  } catch (err) {
    log.warn('screenAnswer failed, returning original', { err: err.message });
    return { text: answerText, verification: { references: [], expired: [], unverified: [], hasIssues: false } };
  }
}

module.exports = {
  extractDocReferences,
  normalizeDecreeNumber,
  normalizeCorpusNumber,
  buildCorpusDocIndex,
  invalidateCorpusIndex,
  verifyAnswer,
  applyVerificationNotice,
  screenAnswer,
};
