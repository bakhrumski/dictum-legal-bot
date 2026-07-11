'use strict';

const multer = require('multer');
const os = require('os');
const fs = require('fs');
const { initTemplatesTable, dbListTemplates, dbGetTemplate, dbCreateTemplate, dbUpdateTemplate, dbDeleteTemplate } = require('./db');
const { renderTemplate } = require('./templates');

const importUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx|doc)$/i.test(file.originalname) ||
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/msword';
    cb(ok ? null : new Error('Faqat PDF yoki Word (docx) fayl qabul qilinadi'), ok);
  },
});

const IMPORT_SYSTEM_PROMPT = `You are a senior legal document analyst for Uzbekistan law. You receive extracted text from a Word or PDF legal document template. Your task is to produce a structured JuristAI template JSON.

Output ONLY a single valid JSON object with this exact structure:
{
  "name": { "uz": "...", "ru": "..." },
  "description": { "uz": "...", "ru": "..." },
  "category": "one of: fuqarolik|mehnat|oila|soliq|jinoyat|mamuriy|mulk|shartnoma|tadbirkorlik|xalqaro|boshqa",
  "lang": "uz or ru (dominant language of the document)",
  "fields": [
    {
      "key": "snake_case_key",
      "label": { "uz": "...", "ru": "..." },
      "type": "text|textarea|date|number|select",
      "required": true or false,
      "aiHint": "brief hint for AI suggestion (optional, can be empty string)"
    }
  ],
  "body": "HTML string using {{key}} placeholders for each field. Preserve formatting as close to the original as possible using basic HTML (p, table, h2, strong, etc). Replace blank lines/underscores where a value should be filled with {{key}}."
}

Rules:
- Identify every blank, underline, or fill-in spot as a field with a descriptive key.
- Keep the document structure faithful to the original.
- name and description must be in both Uzbek and Russian.
- Output ONLY the JSON — no markdown fences, no explanation.`;

// Word-targeted HTML wrapper: Calibri 12pt body, and the mso XML block makes
// Word open the .doc in Print Layout ("Разметка страницы") by default.
function wrapDocumentHtml(title, bodyHtml, lang) {
  return `<!DOCTYPE html>
<html lang="${lang || 'uz'}" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4; margin: 25mm 20mm; }
  * { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-style: normal; }
  body { color: #111; font-size: 12pt; line-height: 1.5; margin: 0; }
  h1 { font-size: 14pt; } h2 { font-size: 13pt; font-weight: bold; } h3 { font-size: 12pt; font-weight: bold; }
  table { border-collapse: collapse; } td { padding: 0; } p { margin: 0 0 10pt; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function buildDocumentHtml(template, values, lang) {
  const body = renderTemplate({ body: template.body, fields: template.fields }, values);
  const title = (template.name && (template.name[lang] || template.name.uz)) || 'Hujjat';
  return wrapDocumentHtml(title, body, template.lang);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function mountDraftingRoutes(app, deps) {
  const { requireAuth, callAI, tariffModule } = deps;

  // Middleware: requireMasterAdmin inline (gates write operations)
  function masterOnly(req, res, next) {
    if (req.session?.isAuthenticated && req.session?.role === 'master') return next();
    return res.status(403).json({ error: 'Faqat master admin uchun' });
  }

  const quota = (tariffModule && typeof tariffModule.enforceQuota === 'function')
    ? tariffModule.enforceQuota('/api/draft')
    : (req, res, next) => next();

  // Initialise on first mount
  initTemplatesTable().catch(e => console.error('[DRAFT DB] init error:', e.message));

  // ── GET /api/templates — list (all authenticated users) ──
  app.get('/api/templates', requireAuth, async (req, res) => {
    try {
      const list = await dbListTemplates();
      // Slim list for picker (omit body)
      const slim = list.map(({ id, slug, name, description, category, lang, fieldCount }) =>
        ({ id, slug, name, description, category, lang, fieldCount }));
      res.json({ templates: slim });
    } catch (e) {
      console.error('[DRAFT] list error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/templates/full — full list with body (master only, for editor) ──
  app.get('/api/templates/full', requireAuth, masterOnly, async (req, res) => {
    try {
      res.json({ templates: await dbListTemplates() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/templates/:id — full single template (slug or numeric id) ──
  app.get('/api/templates/:id', requireAuth, async (req, res) => {
    try {
      const tpl = await dbGetTemplate(req.params.id);
      if (!tpl) return res.status(404).json({ error: 'Shablon topilmadi' });
      res.json(tpl);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/templates — create (master only) ──
  app.post('/api/templates', requireAuth, masterOnly, async (req, res) => {
    try {
      const { name, description, category, lang, fields, body } = req.body || {};
      if (!name?.uz && !name?.ru) return res.status(400).json({ error: 'Shablon nomi kerak' });
      const slug = slugify((name.uz || name.ru) + '-' + Date.now());
      const tpl = await dbCreateTemplate({ slug, name, description, category, lang, fields, body, createdBy: req.session.adminId });
      res.status(201).json(tpl);
    } catch (e) {
      console.error('[DRAFT] create error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── PUT /api/templates/:id — update (master only) ──
  app.put('/api/templates/:id', requireAuth, masterOnly, async (req, res) => {
    try {
      const { name, description, category, lang, fields, body } = req.body || {};
      const updated = await dbUpdateTemplate(parseInt(req.params.id), { name, description, category, lang, fields, body, updatedBy: req.session.adminId });
      if (!updated) return res.status(404).json({ error: 'Shablon topilmadi' });
      res.json(updated);
    } catch (e) {
      console.error('[DRAFT] update error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/templates/:id — soft-delete (master only) ──
  app.delete('/api/templates/:id', requireAuth, masterOnly, async (req, res) => {
    try {
      await dbDeleteTemplate(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/draft/suggest — AI field suggestion ──
  app.post('/api/draft/suggest', requireAuth, quota, async (req, res) => {
    try {
      const { templateId, fieldKey, values = {} } = req.body || {};
      const tpl = await dbGetTemplate(templateId);
      if (!tpl) return res.status(404).json({ error: 'Shablon topilmadi' });
      const field = tpl.fields.find(f => f.key === fieldKey);
      if (!field) return res.status(400).json({ error: 'Maydon topilmadi' });

      const lang = tpl.lang === 'ru' ? 'ru' : 'uz';
      const docName = tpl.name[lang] || tpl.name.uz || '';
      const fieldLabel = (field.label && (field.label[lang] || field.label.uz)) || fieldKey;
      const filled = tpl.fields
        .filter(f => f.key !== fieldKey && values[f.key]?.trim?.())
        .map(f => `- ${(f.label?.[lang] || f.label?.uz || f.key)}: ${values[f.key]}`)
        .join('\n');

      const langName = lang === 'ru' ? 'Russian' : 'Uzbek (Latin script)';
      const result = await callAI([
        { role: 'system', text: `You are a senior legal drafter for Uzbekistan law. Write only in ${langName}, formal legal style. Output ONLY the field text — no preamble, no quotes, no markdown.` },
        { role: 'user', text: `Document: ${docName}\nField: "${fieldLabel}"\n${field.aiHint ? `Guidance: ${field.aiHint}\n` : ''}${filled ? `\nContext:\n${filled}\n` : ''}\nWrite the field content now.` },
      ], { temperature: 0.3, maxTokens: 700 });

      res.json({ value: (result.text || '').trim().replace(/^["'`]+|["'`]+$/g, ''), provider: result.provider });
    } catch (e) {
      console.error('[DRAFT] suggest error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Shared .doc / .pdf sender (Word HTML with Calibri 12 + Print Layout view).
  async function sendExport(res, baseName, html, format) {
    if (format === 'docx' || format === 'doc') {
      res.setHeader('Content-Type', 'application/msword; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.doc"`);
      return res.send('﻿' + html);
    }
    // PDF: try Puppeteer, fall back to client-print
    let puppeteer = null;
    try { puppeteer = require('puppeteer'); } catch (_) {}
    if (!puppeteer) {
      return res.json({ mode: 'client-print', html, message: 'PDF uchun brauzerda chop eting.' });
    }
    let browser;
    try {
      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '25mm', bottom: '25mm', left: '20mm', right: '20mm' } });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
      return res.end(pdf);
    } catch (pdfErr) {
      return res.json({ mode: 'client-print', html, message: 'Server PDF xatoligi — brauzerda chop eting.' });
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  // ── POST /api/draft/export — DOCX or PDF (template + values) ──
  app.post('/api/draft/export', requireAuth, quota, async (req, res) => {
    try {
      const { templateId, values = {}, format = 'pdf' } = req.body || {};
      const tpl = await dbGetTemplate(templateId);
      if (!tpl) return res.status(404).json({ error: 'Shablon topilmadi' });

      const lang = tpl.lang === 'ru' ? 'ru' : 'uz';
      const html = buildDocumentHtml(tpl, values, lang);
      const baseName = (tpl.slug || 'hujjat').replace(/[^a-z0-9-]/gi, '_');
      return await sendExport(res, baseName, html, format);
    } catch (e) {
      console.error('[DRAFT] export error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/draft/export-raw — DOCX or PDF from raw document HTML ──
  // Used by the in-chat AI document builder, where there is no stored template.
  app.post('/api/draft/export-raw', requireAuth, quota, async (req, res) => {
    try {
      const { title = 'Hujjat', html = '', format = 'doc', lang = 'uz' } = req.body || {};
      if (!String(html).trim()) return res.status(400).json({ error: 'Hujjat matni bo\'sh' });
      const full = wrapDocumentHtml(String(title).slice(0, 140), String(html).slice(0, 200000), lang);
      const baseName = (slugify(String(title)) || 'hujjat');
      return await sendExport(res, baseName, full, format);
    } catch (e) {
      console.error('[DRAFT] export-raw error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/draft/ai-generate — draft a document from type + key details ──
  // Master-uploaded templates whose names match the requested type are passed
  // to the model as HIDDEN drafting guides (never shown to the user).
  app.post('/api/draft/ai-generate', requireAuth, quota, async (req, res) => {
    try {
      const docType = String((req.body || {}).docType || '').trim().slice(0, 120);
      const details = String((req.body || {}).details || '').trim().slice(0, 6000);
      if (!docType || !details) return res.status(400).json({ error: 'Hujjat turi va ma\'lumotlar kerak' });

      let guides = '';
      try {
        const list = await dbListTemplates();
        const t = docType.toLowerCase();
        const words = t.split(/\s+/).filter(w => w.length > 3);
        const hits = list.filter(x => {
          const n = (((x.name && x.name.uz) || '') + ' ' + ((x.name && x.name.ru) || '')).toLowerCase();
          return n && (n.includes(t) || words.some(w => n.includes(w)));
        }).slice(0, 2);
        for (const h of hits) {
          const full = await dbGetTemplate(h.id);
          if (full && full.body) {
            guides += `\n--- INTERNAL TEMPLATE GUIDE (structure/style reference — do NOT mention it) ---\n${String(full.body).slice(0, 4000)}\n`;
          }
        }
      } catch (_) { /* guides are optional */ }

      const result = await callAI([
        { role: 'system', text:
`You are a senior legal drafter for the Republic of Uzbekistan. Draft a COMPLETE, ready-to-file legal document in Uzbek (Latin script) unless the user's details are in Russian — then draft in Russian.

Output ONLY the document body as clean simple HTML (<p>, <h2>, <h3>, <table>, <strong>, <br>) — no <html>/<head>/<body> tags, no markdown fences, no commentary.

Rules:
- Follow standard Uzbek legal-document structure for the given document type (addressee block top-right where appropriate, title centered, numbered clauses, date and signature lines at the end).
- Use ONLY facts from the user's details. For any required information they did not provide, insert the placeholder [_____] exactly.
- Formal legal language; cite relevant O'zbekiston Respublikasi legislation only when confident it is correct — never invent article numbers.` },
        { role: 'user', text: `Document type: ${docType}\n\nUser-provided key details:\n${details}\n${guides}` },
      ], { temperature: 0.25, maxTokens: 4096 });

      let html = (result.text || '').trim().replace(/```(?:html)?/gi, '').trim();
      if (!html) return res.status(500).json({ error: 'Hujjat yaratib bo\'lmadi — qayta urinib ko\'ring' });
      res.json({ html, provider: result.provider });
    } catch (e) {
      console.error('[DRAFT] ai-generate error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/templates/import-file — extract text from Word/PDF, generate template via AI ──
  app.post('/api/templates/import-file', requireAuth, masterOnly, importUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });
    const filePath = req.file.path;
    try {
      const isDoc = /\.(docx|doc)$/i.test(req.file.originalname) ||
        req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        req.file.mimetype === 'application/msword';

      let extractedText = '';

      if (isDoc) {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        extractedText = (result.value || '').trim();
      } else {
        const pdfParse = require('pdf-parse');
        const buf = fs.readFileSync(filePath);
        const parsed = await pdfParse(buf);
        extractedText = (parsed.text || '').trim();
      }

      if (!extractedText || extractedText.length < 30) {
        return res.status(422).json({ error: 'Fayldan matn ajratib bo\'lmadi (skanerlangan yoki bo\'sh fayl)' });
      }

      const MAX_CHARS = 10000;
      const snippet = extractedText.slice(0, MAX_CHARS);
      const enrichNote = req.body.enrichHint ? `\nAdditional instruction from admin: ${req.body.enrichHint}` : '';
      const existingNote = req.body.existingTemplate
        ? `\nExisting template body for reference (enrich/improve it):\n${req.body.existingTemplate.slice(0, 4000)}`
        : '';

      const aiResult = await callAI([
        { role: 'system', text: IMPORT_SYSTEM_PROMPT },
        { role: 'user', text: `Document text:${enrichNote}${existingNote}\n\n---\n${snippet}\n---` },
      ], { temperature: 0.2, maxTokens: 4096 });

      // Salvage JSON from AI response
      let raw = (aiResult.text || '').trim().replace(/```(?:json)?/gi, '').trim();
      const start = raw.indexOf('{');
      if (start > 0) raw = raw.slice(start);
      let tplData = null;
      try { tplData = JSON.parse(raw); } catch (_) {
        // Repair truncated JSON
        let inStr = false, esc = false;
        const stack = [];
        let out = '';
        for (let i = 0; i < raw.length; i++) {
          const c = raw[i]; out += c;
          if (inStr) { if (esc) { esc = false; } else if (c === '\\') { esc = true; } else if (c === '"') { inStr = false; } continue; }
          if (c === '"') inStr = true;
          else if (c === '{' || c === '[') stack.push(c);
          else if (c === '}' || c === ']') stack.pop();
        }
        if (inStr) out += '"';
        out = out.replace(/,\s*"[^"]*"\s*:?\s*$/s, '').replace(/,\s*$/s, '');
        for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
        try { tplData = JSON.parse(out); } catch (_2) {}
      }

      if (!tplData || (!tplData.name?.uz && !tplData.name?.ru)) {
        console.warn('[DRAFT] import-file: JSON salvage failed, provider=' + aiResult.provider);
        return res.status(500).json({ error: 'AI shablonni tahlil qila olmadi. Faylni tekshiring va qayta urinib ko\'ring.' });
      }

      tplData.fields = Array.isArray(tplData.fields) ? tplData.fields : [];
      res.json({ template: tplData, provider: aiResult.provider, charCount: extractedText.length });
    } catch (err) {
      console.error('[DRAFT] import-file error:', err.message);
      res.status(500).json({ error: 'Import xatoligi: ' + err.message });
    } finally {
      fs.unlink(filePath, () => {});
    }
  });

  console.log('[DRAFT] Document drafting routes mounted');
}

module.exports = { mountDraftingRoutes, buildDocumentHtml };
