'use strict';

/**
 * OCR & AI Document Analyzer — API routes
 *
 * POST /api/analyze/extract  — PDF text extraction (server-side, pdf-parse)
 *                              Returns { text, pageCount, scanned }
 *                              scanned=true when < 80 chars extracted (image PDF)
 *
 * POST /api/analyze           — AI analysis of supplied text
 *                              Returns structured JSON:
 *                              { docType, language, summary, overallScore,
 *                                riskItems, missingClauses, complianceIssues, strengths }
 *
 * Image OCR is intentionally done client-side via Tesseract.js CDN — no
 * server dependency needed and the language data is cached in the browser.
 */

const multer = require('multer');
const os = require('os');
const fs = require('fs');

const analyzeUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' ||
      (file.originalname || '').match(/\.pdf$/i);
    cb(ok ? null : new Error('Faqat PDF fayl qabul qilinadi'), ok);
  },
});

// How many characters to feed to the AI (keeps token cost predictable)
const MAX_ANALYSIS_CHARS = 9000;

/**
 * Best-effort extraction of a JSON object from a raw LLM response.
 * Handles markdown code fences, leading/trailing prose, and — crucially —
 * responses that were truncated mid-object (the model hit the token cap before
 * closing its strings/brackets). Returns the parsed object or null.
 */
function salvageJson(rawText) {
  if (!rawText) return null;
  let s = String(rawText).trim();

  // Strip markdown code fences anywhere (```json ... ``` or bare ```)
  s = s.replace(/```(?:json)?/gi, '').trim();

  // Narrow to the first '{' onward — drop any leading prose
  const start = s.indexOf('{');
  if (start === -1) return null;
  s = s.slice(start);

  // 1) Fast path: maybe it's already valid once trimmed to the last '}'
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace !== -1) {
    try { return JSON.parse(s.slice(0, lastBrace + 1)); } catch (_) { /* fall through */ }
  }

  // 2) Repair a truncated object: walk the string tracking structure, then
  //    close any string still open and balance the remaining brackets.
  let inStr = false, esc = false;
  const stack = [];
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += c;
    if (inStr) {
      if (esc) { esc = false; }
      else if (c === '\\') { esc = true; }
      else if (c === '"') { inStr = false; }
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }

  // Drop a dangling ",  key": fragment or trailing comma at the very end.
  if (inStr) out += '"';
  out = out.replace(/,\s*"[^"]*"\s*:?\s*$/s, '').replace(/,\s*$/s, '');

  // Close whatever brackets are still open, innermost first.
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === '{' ? '}' : ']';
  }

  try { return JSON.parse(out); } catch (_) { return null; }
}

const SYSTEM_PROMPT = `You are a senior legal analyst specialising exclusively in the law of the Republic of Uzbekistan. You speak Uzbek and Russian fluently. You will receive the text of a legal document and must return ONLY a single valid JSON object — no markdown, no code fences, no explanation, no text before or after the JSON.

JSON structure (follow exactly):
{
  "docType": "document type in the document's own language",
  "language": "uz | ru | mixed",
  "summary": "2-3 sentence factual summary in the same language as the document",
  "overallScore": integer 0-100 (100 = perfect compliance and completeness),
  "riskItems": [
    {
      "level": "high | medium | low",
      "clause": "short clause name",
      "excerpt": "verbatim excerpt ≤ 150 chars that contains the risk",
      "issue": "what is legally problematic",
      "suggestion": "how to fix it, cite relevant Uzbek law article if applicable"
    }
  ],
  "missingClauses": [
    {
      "clause": "clause name",
      "importance": "high | medium",
      "description": "why this clause is required or strongly recommended under Uzbek law"
    }
  ],
  "complianceIssues": [
    {
      "article": "e.g. Mehnat kodeksi 80-modda or ГК РУз ст.354",
      "issue": "short description of the non-compliance",
      "suggestion": "corrective action"
    }
  ],
  "strengths": ["positive aspect 1", "positive aspect 2"]
}

Rules:
- riskItems, missingClauses, complianceIssues and strengths may be empty arrays [] but must be present.
- overallScore must reflect both risk level and completeness: penalise high-risk items heavily.
- All text fields must be in the same language as the document (uz or ru). For mixed documents use the dominant language.
- Cite exact article numbers where you know them. Do not invent citations.
- Return ONLY the JSON object. Any extra text will break the parser.`;

function mountAnalyzerRoutes(app, deps) {
  const { requireAuth, callAI, tariffModule } = deps;

  const quota = (tariffModule && typeof tariffModule.enforceQuota === 'function')
    ? tariffModule.enforceQuota('/api/analyze')
    : (req, res, next) => next();

  // ── PDF text extraction ──
  app.post('/api/analyze/extract', requireAuth, analyzeUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });
    let filePath = req.file.path;
    try {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filePath);
      const parsed = await pdfParse(buf);
      const text = (parsed.text || '').trim();
      const scanned = text.length < 80;
      res.json({
        text: scanned ? '' : text,
        pageCount: parsed.numpages || 1,
        scanned,
        charCount: text.length,
      });
    } catch (e) {
      console.error('[ANALYZE] PDF extract error:', e.message);
      res.status(500).json({ error: 'PDF o\'qib bo\'lmadi: ' + e.message });
    } finally {
      fs.unlink(filePath, () => {});
    }
  });

  // ── AI analysis ──
  app.post('/api/analyze', requireAuth, quota, async (req, res) => {
    try {
      const { text, langHint } = req.body || {};
      if (!text || !text.trim()) return res.status(400).json({ error: 'Matn kerak' });

      const truncated = text.trim().slice(0, MAX_ANALYSIS_CHARS);
      const langNote = langHint === 'ru' ? '\n(Document language: Russian)' : langHint === 'uz' ? '\n(Document language: Uzbek)' : '';

      const result = await callAI([
        { role: 'system', text: SYSTEM_PROMPT },
        { role: 'user', text: `Analyze this legal document:${langNote}\n\n---\n${truncated}\n---` },
      ], { temperature: 0.15, maxTokens: 4096 });

      // Robustly extract the JSON object — tolerant of code fences, leading
      // prose and (most commonly) responses truncated mid-object.
      let analysis = salvageJson(result.text);

      // If salvage produced an object but it's missing the core fields, treat
      // it as a parse failure so the client shows the raw text instead.
      if (analysis && typeof analysis === 'object' && !analysis.summary && !analysis.docType) {
        analysis = null;
      }

      if (!analysis) {
        console.warn('[ANALYZE] JSON salvage failed; returning raw. provider=' + result.provider);
        return res.json({ raw: result.text, parseError: true, provider: result.provider });
      }

      // Guarantee the array fields exist so the client never crashes on them.
      analysis.riskItems = Array.isArray(analysis.riskItems) ? analysis.riskItems : [];
      analysis.missingClauses = Array.isArray(analysis.missingClauses) ? analysis.missingClauses : [];
      analysis.complianceIssues = Array.isArray(analysis.complianceIssues) ? analysis.complianceIssues : [];
      analysis.strengths = Array.isArray(analysis.strengths) ? analysis.strengths : [];

      res.json({ analysis, provider: result.provider, truncated: text.trim().length > MAX_ANALYSIS_CHARS });
    } catch (e) {
      console.error('[ANALYZE] AI error:', e.message);
      res.status(500).json({ error: 'Tahlil xatoligi: ' + e.message });
    }
  });

  console.log('[ANALYZE] OCR & analyzer routes mounted');
}

module.exports = { mountAnalyzerRoutes };
