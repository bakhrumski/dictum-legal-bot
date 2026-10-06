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

// ── The cost of one OCR page (an estimate, with its source) ───────────────
// OCR runs on Gemini 2.5 Flash with thinking turned off and an output cap
// per page (src/ocr/routes.js), so its billed tokens are bounded by:
//   input:  one page or image as an image input. Source: the Vertex AI
//           Generative AI pricing page (fetched 2026-10-06): "PDFs are billed
//           as image input, with one PDF page equivalent to one image" and
//           "For an 1024x1024 image, it consumes 1290 tokens. Per image token
//           count varies by image resolution." No upper bound per page is
//           published there, so 4x that example is assumed (5 160 tokens),
//           plus the prompt (300 tokens);
//   output: the cap we send, 1 536 tokens per page (OCR_OUTPUT_TOKENS_PER_PAGE);
//           with thinking off no thinking tokens are billed;
//   price:  gemini-2.5-flash $0.30 / 1M input, $2.50 / 1M output "(response
//           and reasoning)" - same page, and src/ai/model-pricing.js;
//   retry:  x2 - one transient retry of the OCR stage is allowed.
// It covers the Gemini path only. A fallback to VoiceLab or OpenAI vision
// (OCR_FALLBACK=on, or no Gemini key) has no such bound: the cost model then
// marks OCR unknown (src/rag/tariff-pricing.js).
const OCR_OUTPUT_TOKENS_PER_PAGE = 1536;
const OCR_PAGE_ESTIMATE = Object.freeze({
  inputTokens: 4 * 1290 + 300,
  outputTokens: OCR_OUTPUT_TOKENS_PER_PAGE,
  inPerM: 0.30,
  outPerM: 2.50,
  attempts: 2,
  model: 'gemini-2.5-flash',
  source: 'Vertex AI Generative AI pricing page (cloud.google.com/vertex-ai/generative-ai/pricing), fetched 2026-10-06',
  status: 'estimated',
});
/** USD per OCR page, upper estimate (see above). */
function ocrPageUsd(e = OCR_PAGE_ESTIMATE) {
  return ((e.inputTokens * e.inPerM + e.outputTokens * e.outPerM) / 1e6) * e.attempts;
}

/** Is OCR cost covered by the estimate in this deployment? */
function ocrCostBasis(env = process.env) {
  const gemini = !!env.GEMINI_API_KEY;
  const fallback = String(env.OCR_FALLBACK || '').toLowerCase() === 'on';
  if (!gemini) return { status: 'unknown', reason: 'GEMINI_API_KEY is not set: OCR runs on VoiceLab / OpenAI vision, whose cost per page has no bound' };
  if (fallback) return { status: 'unknown', reason: 'OCR_FALLBACK=on: a fallback to VoiceLab / OpenAI vision has no cost bound per page' };
  return { status: 'estimated', usdPerPage: ocrPageUsd(), estimate: OCR_PAGE_ESTIMATE };
}

module.exports = {
  MAX_PDF_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_IMAGE_PIXELS, IMAGE_TYPES, TEXT_PDF_CHARS_PER_PAGE,
  OCR_OUTPUT_TOKENS_PER_PAGE, OCR_PAGE_ESTIMATE,
  pdfInfo, imageInfo, measureScan, ocrPageUsd, ocrCostBasis,
};
