'use strict';

/**
 * What a scanned document may be before a paid OCR call is made
 * (2026-10-06), and what one OCR page is estimated to cost.
 *
 * Everything here runs on the server with no AI call: the PDF's pages are
 * counted with pdf-parse, an image's size is read from its header bytes.
 * A file that is encrypted, cannot be read, or is over a limit is refused
 * before any provider is called.
 */

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// An image is one page, and a bounded one: its pixels set the provider's
// input tokens (image tiles), so a 40-megapixel photo is not "one page".
const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_PIXELS = 16 * 1000 * 1000;
const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
// A PDF with at least this many characters of text per page is a text PDF:
// /api/analyze/extract reads it with no AI; it is not sent to OCR.
const TEXT_PDF_CHARS_PER_PAGE = 200;

/** Pages of a PDF, counted locally; { pages, textChars } or { error }. */
async function pdfInfo(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) return { error: 'not_a_pdf' };
  // an encrypted PDF names an /Encrypt dictionary in its trailer
  const tail = buf.subarray(Math.max(0, buf.length - 64 * 1024)).toString('latin1');
  if (/\/Encrypt\s/u.test(tail) || /\/Encrypt\s/u.test(head)) return { error: 'encrypted' };
  try {
    // a copy in its own memory: a small Node Buffer sits inside a shared
    // pool, and pdf.js reads the pool from its start ("bad XRef entry")
    const parsed = await require('pdf-parse/lib/pdf-parse.js')(new Uint8Array(buf));
    const pages = Number(parsed.numpages) || 0;
    if (!pages) return { error: 'no_pages' };
    return { pages, textChars: String(parsed.text || '').trim().length };
  } catch (e) {
    return { error: /encrypt|password/iu.test(String(e && e.message)) ? 'encrypted' : 'unreadable' };
  }
}

/** Width and height from the header of a PNG, JPEG or WebP; { width, height, type } or { error }. */
function imageInfo(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { type: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the size
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { error: 'unreadable' };
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return { type: 'image/webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { type: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'image/webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  return { error: 'unsupported_image' };
}

/**
 * Size a scan for a paid OCR call: { kind, pages, bytes, ... } or { error, message }.
 * planMaxPages: the most pages one document job may have on the plan.
 */
async function measureScan(buf, { mimetype = '', filename = '', planMaxPages = 10 } = {}) {
  const isPdf = mimetype === 'application/pdf' || /\.pdf$/iu.test(filename) || buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf) {
    if (buf.length > MAX_PDF_BYTES) return { error: 'too_large_bytes', message: `PDF hajmi ${Math.ceil(buf.length / 1048576)} MB — ko'pi bilan 20 MB.` };
    const info = await pdfInfo(buf);
    if (info.error === 'encrypted') return { error: 'encrypted', message: "PDF parol bilan himoyalangan (shifrlangan). Parolsiz nusxasini yuklang." };
    if (info.error) return { error: 'unreadable', message: "PDF sahifalarini sanab bo'lmadi: fayl shikastlangan yoki PDF emas. Limit sarflanmadi." };
    if (info.textChars >= TEXT_PDF_CHARS_PER_PAGE * info.pages) {
      return { error: 'text_pdf', message: "Bu PDF'da matn bor — u OCR'siz o'qiladi (/api/analyze/extract). Limit sarflanmadi.", pages: info.pages };
    }
    if (info.pages > planMaxPages) {
      return { error: 'too_many_pages', pages: info.pages, maxPages: planMaxPages,
        message: `Skan hujjat ${info.pages} sahifa — tarifingizda bitta hujjat ko'pi bilan ${planMaxPages} sahifa. Hujjat qisqartirilmaydi: uni qismlarga bo'lib yuklang. Limit sarflanmadi.` };
    }
    return { kind: 'pdf', pages: info.pages, bytes: buf.length };
  }
  if (buf.length > MAX_IMAGE_BYTES) return { error: 'too_large_bytes', message: `Rasm hajmi ${Math.ceil(buf.length / 1048576)} MB — ko'pi bilan 10 MB.` };
  const img = imageInfo(buf);
  if (img.error || !IMAGE_TYPES.includes(img.type)) return { error: 'unsupported_image', message: 'Faqat JPEG, PNG yoki WebP rasm qabul qilinadi. Limit sarflanmadi.' };
  if (img.width > MAX_IMAGE_SIDE || img.height > MAX_IMAGE_SIDE || img.width * img.height > MAX_IMAGE_PIXELS) {
    return { error: 'image_too_large', width: img.width, height: img.height,
      message: `Rasm ${img.width}×${img.height} piksel — ko'pi bilan ${MAX_IMAGE_SIDE} piksel tomon va ${MAX_IMAGE_PIXELS / 1e6} megapiksel. Kichikroq rasm yuklang. Limit sarflanmadi.` };
  }
  if (planMaxPages < 1) return { error: 'too_many_pages', pages: 1, maxPages: planMaxPages, message: 'Skan hujjat tarifingizga kirmaydi.' };
  return { kind: 'image', pages: 1, bytes: buf.length, width: img.width, height: img.height, mimetype: img.type };
}

// ── The OCR prompt (one place: the routes send it, the cost bound counts it)
const LANG_HINTS = Object.freeze({
  'uzb+rus':     'The document contains Uzbek (Latin script) and/or Russian (Cyrillic) text.',
  'uzb':         'The document is in Uzbek (Latin script).',
  'rus':         'The document is in Russian (Cyrillic script).',
  'eng':         'The document is in English.',
  'uzb+rus+eng': 'The document may be in Uzbek (Latin), Russian (Cyrillic), or English.',
});
const VISION_PROMPT = (langHint) =>
  `${langHint ? langHint + ' ' : ''}Extract all text from this document image exactly as it appears. ` +
  'Preserve the original text layout including line breaks and paragraph structure. ' +
  'Return ONLY the extracted text — no commentary, no labels, no markdown formatting.';
/** Tokens of the longest prompt, bounded by its UTF-8 bytes (a token is at least one byte). */
function promptTokenBound() {
  return Math.max(...Object.values(LANG_HINTS).map(h => Buffer.byteLength(VISION_PROMPT(h), 'utf8')));
}

// ── Which provider reads a scan (2026-10-06, review of #411) ─────────────
// Nothing is switched silently. An image goes, as before #411, first to
// VoiceLab's vision lane when that lane is on, else to Gemini; the owner
// picks Gemini for images with OCR_IMAGE_PROVIDER=gemini. A PDF goes to
// Gemini (VoiceLab and OpenAI Chat Completions take images, not PDFs).
// After a failure the other providers are tried, as before, unless
// OCR_FALLBACK=off. A truncated Gemini reading (MAX_TOKENS) is refused, not
// retried elsewhere.
const PROVIDERS = Object.freeze(['voicelab', 'gemini', 'openai']);
function ocrProviders({ kind = 'image', env = process.env, voicelabVision = null } = {}) {
  const vlOn = voicelabVision != null ? !!voicelabVision : require('../ai/voicelab').routes('vision');
  const has = { voicelab: vlOn, gemini: !!env.GEMINI_API_KEY, openai: !!env.GPT_API_KEY };
  const fallback = String(env.OCR_FALLBACK || '').toLowerCase() !== 'off';
  if (kind === 'pdf') return { primary: has.gemini ? 'gemini' : null, fallbacks: [], fallback };
  const want = String(env.OCR_IMAGE_PROVIDER || '').toLowerCase();
  const order = want === 'gemini' ? ['gemini', 'voicelab', 'openai'] : ['voicelab', 'gemini', 'openai'];
  const usable = order.filter(p => has[p]);
  return { primary: usable[0] || null, fallbacks: fallback ? usable.slice(1) : [], fallback };
}

// ── The cost of one OCR page ──────────────────────────────────────────────
// Only the Gemini path has a per-page budget; every part of it is listed
// with its basis. It is a CONSERVATIVE UPPER BUDGET (for the plans' worst
// case and the discount floors), not an expected cost: nothing here has been
// measured on a real reading yet (the pilot reads usageMetadata).
//   model / API: gemini-2.5-flash through the Gemini Developer API
//     (generativelanguage.googleapis.com v1beta generateContent, API key) -
//     not Vertex AI;
//   price: src/ai/model-pricing.js (the single price table), source
//     ai.google.dev/gemini-api/docs/pricing, paid tier, checked 2026-08-11.
//     It could not be re-read on 2026-10-06 (ai.google.dev is blocked from
//     this environment). Output is billed with thinking ("response and
//     reasoning" on the Vertex page, the only one readable here);
//   image input: no Developer API tokens-per-page figure could be read here.
//     The Vertex page says "For an 1024x1024 image, it consumes 1290 tokens.
//     Per image token count varies by image resolution." - used only as a
//     scale; the budget is 4x that (larger page images), an assumption;
//   prompt: bounded by its UTF-8 bytes (promptTokenBound), counted per page
//     (a one-page call is the worst case);
//   output: the cap we send, maxOutputTokens = 1 536 x pages; a reading that
//     reaches it is refused (OCR_TRUNCATED) but still billed;
//   thinking: thinkingConfig.thinkingBudget = 0 is sent (tests/scan-ocr.test.js
//     checks the request); budget 0 - NOT confirmed on a real response;
//   attempts: the usage ledger retries a transient error of stage 'ocr' once
//     (ESSENTIAL_STAGES), so 2 attempts, both counted as billed;
//   extra reserve factor: 1 (none beyond the above);
//   fallback (VoiceLab, OpenAI vision): NOT in this figure - unknown cost.
const OCR_OUTPUT_TOKENS_PER_PAGE = 1536;
const VERTEX_IMAGE_TOKENS_1024 = 1290;
function ocrPageBudget() {
  const p = require('../ai/model-pricing');
  const price = p.MODEL_PRICING['gemini-2.5-flash'];
  const src = p.PRICING_SOURCES.gemini_2026_08_11; // the source the price table names for gemini-2.5-flash
  const parts = {
    imageInputTokens: { tokens: 4 * VERTEX_IMAGE_TOKENS_1024, status: 'assumed_upper',
      basis: 'Vertex page: 1 290 tokens for a 1024x1024 image, varies by resolution; x4 headroom. No Developer API per-page figure read here.' },
    promptTokens: { tokens: promptTokenBound(), status: 'bound', basis: 'UTF-8 bytes of the longest OCR prompt (tokens <= bytes)' },
    outputTokens: { tokens: OCR_OUTPUT_TOKENS_PER_PAGE, status: 'cap_sent', basis: 'maxOutputTokens = 1 536 x pages; MAX_TOKENS is refused but billed' },
    thinkingTokens: { tokens: 0, status: 'assumed_zero_unverified', basis: 'thinkingBudget: 0 is sent; not confirmed on a real response' },
  };
  const inputTokens = parts.imageInputTokens.tokens + parts.promptTokens.tokens;
  const outputTokens = parts.outputTokens.tokens + parts.thinkingTokens.tokens;
  const attempts = 2;
  const reserveFactor = 1;
  const oneAttemptUsd = (inputTokens * price.in + outputTokens * price.out) / 1e6;
  return {
    kind: 'conservative_upper_budget', expected: null, expectedStatus: 'unmeasured',
    model: 'gemini-2.5-flash', api: 'Gemini Developer API (generativelanguage.googleapis.com v1beta, API key)',
    inPerM: price.in, outPerM: price.out, priceSource: src ? `${src.source}, checked ${src.checkedAt}` : 'src/ai/model-pricing.js',
    parts, inputTokens, outputTokens,
    attempts, attemptsBasis: "usage ledger: one transient retry for stage 'ocr'",
    reserveFactor,
    usdInputPerAttempt: inputTokens * price.in / 1e6, usdOutputPerAttempt: outputTokens * price.out / 1e6,
    usdPerAttempt: oneAttemptUsd, usdPerPage: oneAttemptUsd * attempts * reserveFactor,
  };
}
/** USD per OCR page on the Gemini path: the conservative upper budget (see above). */
function ocrPageUsd() { return ocrPageBudget().usdPerPage; }

// Cost status of each provider for one page: only Gemini has a budget.
const PROVIDER_COST = Object.freeze({
  gemini: 'estimated',
  voicelab: 'unknown', // aisha-halo: token prices are listed, image input tokens are not; credits may come back instead
  openai: 'unknown',   // image input tokens per page not bounded here
});
const PROVIDER_COST_REASON = Object.freeze({
  voicelab: 'VoiceLab vision: image input tokens per page are not published; credit billing may not convert to tokens',
  openai: 'OpenAI vision: image input tokens per page are not bounded here',
});

/**
 * Is OCR cost covered by the Gemini budget in this deployment? Only when
 * every provider a page can reach - primary and fallbacks, images and PDFs -
 * is Gemini. Any reachable provider of unknown cost makes OCR unknown: the
 * Gemini figure is never applied to it.
 */
function ocrCostBasis(env = process.env, { voicelabVision = null } = {}) {
  const img = ocrProviders({ kind: 'image', env, voicelabVision });
  const pdf = ocrProviders({ kind: 'pdf', env, voicelabVision });
  const reach = [...new Set([img.primary, ...img.fallbacks, pdf.primary, ...pdf.fallbacks].filter(Boolean))];
  const route = { image: [img.primary, ...img.fallbacks].filter(Boolean), pdf: [pdf.primary].filter(Boolean) };
  if (!pdf.primary) return { status: 'unknown', route, reason: 'GEMINI_API_KEY is not set: scanned PDFs cannot be read and images go to providers of unknown cost' };
  const unknown = reach.filter(p => PROVIDER_COST[p] !== 'estimated');
  if (unknown.length) return { status: 'unknown', route, providers: unknown,
    reason: `${unknown.map(p => PROVIDER_COST_REASON[p]).join('; ')} (set OCR_IMAGE_PROVIDER=gemini and OCR_FALLBACK=off for the Gemini-only route)` };
  return { status: 'estimated', route, usdPerPage: ocrPageUsd(), estimate: ocrPageBudget() };
}

module.exports = {
  MAX_PDF_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_IMAGE_PIXELS, IMAGE_TYPES, TEXT_PDF_CHARS_PER_PAGE,
  OCR_OUTPUT_TOKENS_PER_PAGE, LANG_HINTS, VISION_PROMPT, PROVIDERS, PROVIDER_COST,
  pdfInfo, imageInfo, measureScan, promptTokenBound, ocrProviders, ocrPageBudget, ocrPageUsd, ocrCostBasis,
};
