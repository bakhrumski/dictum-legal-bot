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
      ], { temperature: 0.15, maxTokens: 3000 });

      // Parse JSON — strip accidental markdown fences if present
      let raw = (result.text || '').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      // Find first { to last } (tolerant of leading/trailing garbage)
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);

      let analysis;
      try {
        analysis = JSON.parse(raw);
      } catch (_) {
        // Return raw text so client can still show something useful
        return res.json({ raw: result.text, parseError: true, provider: result.provider });
      }

      res.json({ analysis, provider: result.provider, truncated: text.trim().length > MAX_ANALYSIS_CHARS });
    } catch (e) {
      console.error('[ANALYZE] AI error:', e.message);
      res.status(500).json({ error: 'Tahlil xatoligi: ' + e.message });
    }
  });

  console.log('[ANALYZE] OCR & analyzer routes mounted');
}

module.exports = { mountAnalyzerRoutes };
