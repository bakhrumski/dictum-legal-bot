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

// ── A PDF is read in chunks of pages, each page marked (2026-10-07) ───────
// One call reads at most OCR_PDF_CHUNK_PAGES pages (a sub-PDF cut on the
// server), with an output cap of 1 536 tokens per page of the chunk. The
// reply must mark every page; a chunk that is cut (MAX_TOKENS) or misses a
// page is read again in halves, down to one page; one page that is still cut
// gets one more reading at OCR_SINGLE_PAGE_CAP. Anything still cut, empty or
// missing fails the whole document: nothing partial is stored or analysed.
const OCR_PDF_CHUNK_PAGES = 5;
const OCR_SINGLE_PAGE_CAP = 4096; // the per-call cap OCR had before #411
const EMPTY_PAGE = '[[EMPTY PAGE]]';
const PAGED_PROMPT = (langHint, pages) => VISION_PROMPT(langHint) +
  ` This PDF has ${pages} page${pages === 1 ? '' : 's'}. Start every page with its own line "=== PAGE n ===" (n = 1 to ${pages}, in order).` +
  ` If a page has no text, write ${EMPTY_PAGE} under its line.`;
const MARKER = /^[ \t]*={2,}[ \t]*PAGE[ \t]+(\d+)[ \t]*={2,}[ \t]*$/gimu;
/**
 * Split a paged reply into its pages: { pages: [text|''], missing: [n] }.
 * A page counts as read when its marker is there and it has text or the
 * empty-page sign; a missing marker, a page with nothing under it, a
 * repeated or out-of-range number is "missing".
 */
function parsePagedText(text, pages) {
  const out = Array(pages).fill(null);
  const marks = [...String(text || '').matchAll(MARKER)];
  for (let i = 0; i < marks.length; i++) {
    const n = Number(marks[i][1]);
    const body = String(text).slice(marks[i].index + marks[i][0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim();
    if (n < 1 || n > pages || out[n - 1] !== null) return { pages: out.map(x => x || ''), missing: Array.from({ length: pages }, (_, k) => k + 1), invalid: true };
    out[n - 1] = body === EMPTY_PAGE ? '' : (body || null);
  }
  const missing = out.map((x, k) => (x === null ? k + 1 : null)).filter(Boolean);
  return { pages: out.map(x => x || ''), missing };
}

/** Tokens of the longest prompt, bounded by its UTF-8 bytes (a token is at least one byte). */
function promptTokenBound() {
  return Math.max(...Object.values(LANG_HINTS).flatMap(h => [
    Buffer.byteLength(VISION_PROMPT(h), 'utf8'),
    Buffer.byteLength(PAGED_PROMPT(h, OCR_PDF_CHUNK_PAGES), 'utf8'),
  ]));
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

// ── The cost of one OCR page: a PLANNING ESTIMATE ─────────────────────────
// $0.010959 a page is the planning figure for the plans' worst case and the
// discount floors. It is not a measured cost and not a hard maximum: its
// image-token figure is an assumption, and some calls (re-readings, a
// fallback) are outside it. The pilot measures the real figure
// (usageMetadata of each call, one ledger row per call).
//   model / API: gemini-2.5-flash through the Gemini Developer API
//     (generativelanguage.googleapis.com v1beta generateContent, API key) -
//     not Vertex AI;
//   price: src/ai/model-pricing.js (the single price table), source
//     ai.google.dev/gemini-api/docs/pricing, paid tier, checked 2026-08-11;
//     not re-read on 2026-10-06/07 (ai.google.dev is blocked from here);
//   input, a PDF page: 5 160 tokens - a planning assumption, not a proven
//     bound. The only readable source (Vertex pricing page) says a PDF page
//     is billed as one image and "For an 1024x1024 image, it consumes 1290
//     tokens. Per image token count varies by image resolution." - x4 as
//     headroom for page renderings larger than 1024x1024;
//   input, a separate image: grows with its pixels. Assumed in proportion
//     to that example, 1 290 x max(1, pixels / 1024^2) tokens (19 683 at the
//     16 MP limit); also an assumption (imageInputTokens below);
//   prompt: sent once per call. Its UTF-8 bytes bound its tokens: 305 for an
//     image, 463 for a PDF chunk (paged prompt). A 5-page chunk is ~93 per
//     page; the planning allowance is 305 per page, which covers chunks and
//     images; a 1-page PDF call is 462 (+157 tokens, +$0.00005);
//   output: maxOutputTokens = 1 536 x the pages of the call, shared by them;
//   thinking: thinkingBudget = 0 is sent; planned 0, not confirmed on a real
//     reply (Gemini bills thinking as output, outside candidatesTokenCount);
//   retry: the ledger retries a transient error of a call once; the retry
//     re-sends the whole chunk, so x2 applies to every page of it;
//   NOT included: re-readings after a cut or missing page (halves, then
//     one 4 096-token reading of one page - each its own ledger row, their
//     frequency is unmeasured), and any VoiceLab / OpenAI vision call
//     (unknown cost).
const OCR_OUTPUT_TOKENS_PER_PAGE = 1536;
const VERTEX_IMAGE_TOKENS_1024 = 1290;
const PDF_PAGE_INPUT_TOKENS = 4 * VERTEX_IMAGE_TOKENS_1024;
const PROMPT_ALLOWANCE_PER_PAGE = 305;
/** Planning assumption for a separate image's input tokens (not a bound). */
function imageInputTokens(width, height) {
  return Math.ceil(VERTEX_IMAGE_TOKENS_1024 * Math.max(1, (width * height) / (1024 * 1024)));
}
function promptBytes() {
  const hints = Object.values(LANG_HINTS);
  return {
    image: Math.max(...hints.map(h => Buffer.byteLength(VISION_PROMPT(h), 'utf8'))),
    pdfChunk: Math.max(...hints.map(h => Buffer.byteLength(PAGED_PROMPT(h, OCR_PDF_CHUNK_PAGES), 'utf8'))),
    pdfOnePage: Math.max(...hints.map(h => Buffer.byteLength(PAGED_PROMPT(h, 1), 'utf8'))),
  };
}
function ocrPageBudget() {
  const p = require('../ai/model-pricing');
  const price = p.MODEL_PRICING['gemini-2.5-flash'];
  const src = p.PRICING_SOURCES.gemini_2026_08_11; // the source the price table names for gemini-2.5-flash
  const pb = promptBytes();
  const parts = {
    pdfPageInputTokens: { tokens: PDF_PAGE_INPUT_TOKENS, status: 'planning_assumption',
      basis: 'Vertex page: a PDF page is billed as one image; 1 290 tokens for a 1024x1024 image, varies by resolution; x4 headroom. Not a proven bound; no Developer API per-page figure read here.' },
    promptTokens: { tokens: PROMPT_ALLOWANCE_PER_PAGE, status: 'planning_allowance',
      basis: `sent once per call, bounded by UTF-8 bytes: image ${pb.image}, PDF chunk ${pb.pdfChunk} (~${Math.ceil(pb.pdfChunk / OCR_PDF_CHUNK_PAGES)} a page in ${OCR_PDF_CHUNK_PAGES}-page chunks), 1-page PDF call ${pb.pdfOnePage}` },
    outputTokens: { tokens: OCR_OUTPUT_TOKENS_PER_PAGE, status: 'cap_sent', basis: 'maxOutputTokens = 1 536 x pages of the call; a reading that reaches it is refused (billed)' },
    thinkingTokens: { tokens: 0, status: 'planned_zero_unverified', basis: 'thinkingBudget: 0 is sent; not confirmed on a real reply' },
  };
  const inputTokens = parts.pdfPageInputTokens.tokens + parts.promptTokens.tokens;
  const outputTokens = parts.outputTokens.tokens + parts.thinkingTokens.tokens;
  const attempts = 2;
  const reserveFactor = 1;
  const perAttempt = (inTok) => (inTok * price.in + outputTokens * price.out) / 1e6;
  const maxImageTokens = imageInputTokens(MAX_IMAGE_SIDE, Math.floor(MAX_IMAGE_PIXELS / MAX_IMAGE_SIDE));
  return {
    kind: 'planning_estimate', expected: null, expectedStatus: 'unmeasured', hardMaximum: false,
    model: 'gemini-2.5-flash', api: 'Gemini Developer API (generativelanguage.googleapis.com v1beta, API key)',
    inPerM: price.in, outPerM: price.out, priceSource: src ? `${src.source}, checked ${src.checkedAt}` : 'src/ai/model-pricing.js',
    parts, inputTokens, outputTokens,
    attempts, attemptsBasis: "usage ledger: one transient retry of a call (stage 'ocr'); it re-sends the whole chunk",
    reserveFactor,
    notIncluded: ['re-readings after a cut or missing page (halves, then one 4 096-token page reading)', 'VoiceLab / OpenAI vision (unknown cost)'],
    promptBytes: pb,
    usdInputPerAttempt: inputTokens * price.in / 1e6, usdOutputPerAttempt: outputTokens * price.out / 1e6,
    usdPerAttempt: perAttempt(inputTokens), usdPerPage: perAttempt(inputTokens) * attempts * reserveFactor,
    image: {
      inputTokensAtLimit: maxImageTokens, status: 'planning_assumption',
      basis: '1 290 x max(1, pixels / 1024^2), at the 16 MP limit; proportional to the Vertex example, not a published figure',
      usdAtLimit: perAttempt(maxImageTokens + PROMPT_ALLOWANCE_PER_PAGE) * attempts * reserveFactor,
    },
  };
}
/** USD per OCR page on the Gemini path: the planning estimate (see above). */
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
  OCR_OUTPUT_TOKENS_PER_PAGE, OCR_PDF_CHUNK_PAGES, OCR_SINGLE_PAGE_CAP, EMPTY_PAGE, LANG_HINTS, VISION_PROMPT, PAGED_PROMPT, PROVIDERS, PROVIDER_COST,
  pdfInfo, imageInfo, measureScan, parsePagedText, promptTokenBound, imageInputTokens, ocrProviders, ocrPageBudget, ocrPageUsd, ocrCostBasis,
};
