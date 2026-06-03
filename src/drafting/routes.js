'use strict';

/**
 * Legal Document Drafting — API routes
 *
 * Mounts on the Express app:
 *   GET  /api/templates           — list available templates (picker)
 *   GET  /api/templates/:id       — full template (fields + body)
 *   POST /api/draft/suggest       — AI suggests a value for one field
 *   POST /api/draft/export        — export filled document as DOCX or PDF
 *
 * Auth: session cookie (requireAuth). Export/suggest count against the user's
 * tariff quota so drafting is a real paid feature, consistent with /api/legal-chat.
 */

const { listTemplates, getTemplate, renderTemplate } = require('./templates');

/**
 * Wrap rendered body HTML in a print-ready A4 document shell.
 * Used for both DOCX (Word opens HTML) and PDF (Puppeteer prints HTML).
 */
function buildDocumentHtml(template, values, lang) {
  const body = renderTemplate(template, values);
  const title = (template.name && (template.name[lang] || template.name.uz)) || 'Hujjat';
  return `<!DOCTYPE html>
<html lang="${template.lang || 'uz'}">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 25mm 20mm; }
  * { font-family: "Times New Roman", Georgia, serif; font-style: normal; }
  body { color: #111; font-size: 13px; line-height: 1.55; margin: 0; }
  h1 { font-size: 14px; }
  h2 { font-size: 15px; font-weight: bold; }
  table { border-collapse: collapse; }
  td { padding: 0; }
  p { margin: 0 0 10px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function mountDraftingRoutes(app, deps) {
  const { requireAuth, callAI, tariffModule } = deps;

  // Quota middleware — reuse the same enforcement as legal-chat when available.
  const quota = (tariffModule && typeof tariffModule.enforceQuota === 'function')
    ? tariffModule.enforceQuota('/api/draft')
    : (req, res, next) => next();

  // ── List templates ──
  app.get('/api/templates', requireAuth, (req, res) => {
    res.json({ templates: listTemplates() });
  });

  // ── Single template (fields + body) ──
  app.get('/api/templates/:id', requireAuth, (req, res) => {
    const tpl = getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Shablon topilmadi' });
    res.json(tpl);
  });

  // ── AI suggestion for a single field ──
  app.post('/api/draft/suggest', requireAuth, quota, async (req, res) => {
    try {
      const { templateId, fieldKey, values = {} } = req.body || {};
      const tpl = getTemplate(templateId);
      if (!tpl) return res.status(404).json({ error: 'Shablon topilmadi' });
      const field = tpl.fields.find((f) => f.key === fieldKey);
      if (!field) return res.status(400).json({ error: 'Maydon topilmadi' });

      const lang = tpl.lang === 'ru' ? 'ru' : 'uz';
      const docName = tpl.name[lang] || tpl.name.uz;
      const fieldLabel = field.label[lang] || field.label.uz;

      // Build context from already-filled fields so the suggestion is coherent.
      const filled = tpl.fields
        .filter((f) => f.key !== fieldKey && values[f.key] && String(values[f.key]).trim())
        .map((f) => `- ${f.label[lang] || f.label.uz}: ${values[f.key]}`)
        .join('\n');

      const langName = lang === 'ru' ? 'Russian' : 'Uzbek (Latin script)';
      const systemPrompt =
        `You are a senior legal drafter for documents under the law of the Republic of Uzbekistan. ` +
        `You write only in ${langName}, in correct formal legal style. ` +
        `Output ONLY the text for the requested field — no preamble, no quotes, no markdown, no explanations. ` +
        `If legal articles are relevant, cite exact article numbers.`;
      const userPrompt =
        `Document type: ${docName}\n` +
        `Field to draft: "${fieldLabel}"\n` +
        (field.aiHint ? `Guidance: ${field.aiHint}\n` : '') +
        (filled ? `\nAlready provided details:\n${filled}\n` : '') +
        `\nWrite the content for the "${fieldLabel}" field now.`;

      const result = await callAI(
        [
          { role: 'system', text: systemPrompt },
          { role: 'user', text: userPrompt },
        ],
        { temperature: 0.3, maxTokens: 700 }
      );

      let text = (result.text || '').trim();
      // Strip wrapping quotes/backticks if the model added them.
      text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
      res.json({ value: text, provider: result.provider });
    } catch (err) {
      console.error('[DRAFT] suggest error:', err.message);
      res.status(500).json({ error: 'AI tavsiya xatoligi: ' + err.message });
    }
  });

  // ── Export filled document ──
  app.post('/api/draft/export', requireAuth, quota, async (req, res) => {
    try {
      const { templateId, values = {}, format = 'pdf' } = req.body || {};
      const tpl = getTemplate(templateId);
      if (!tpl) return res.status(404).json({ error: 'Shablon topilmadi' });

      const lang = tpl.lang === 'ru' ? 'ru' : 'uz';
      const html = buildDocumentHtml(tpl, values, lang);
      const baseName = (tpl.id || 'hujjat').replace(/[^a-z0-9-]/gi, '_');

      // ── DOCX (HTML that Word opens natively — no heavy dependency) ──
      if (format === 'docx' || format === 'doc') {
        res.setHeader('Content-Type', 'application/msword; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${baseName}.doc"`);
        return res.send('﻿' + html);
      }

      // ── PDF (server-side via Puppeteer, with graceful fallback) ──
      let puppeteer = null;
      try {
        puppeteer = require('puppeteer');
      } catch (_) {
        puppeteer = null;
      }

      if (!puppeteer) {
        // Fallback: tell the client to render the print dialog itself.
        return res.status(200).json({
          mode: 'client-print',
          html,
          message: 'Server PDF mavjud emas — brauzerda chop etish orqali PDF saqlang.',
        });
      }

      let browser;
      try {
        browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '25mm', bottom: '25mm', left: '20mm', right: '20mm' },
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
        return res.end(pdf);
      } catch (pdfErr) {
        console.error('[DRAFT] puppeteer PDF failed, falling back to client print:', pdfErr.message);
        return res.status(200).json({
          mode: 'client-print',
          html,
          message: 'Server PDF yaratib bo\'lmadi — brauzerda chop etish orqali saqlang.',
        });
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    } catch (err) {
      console.error('[DRAFT] export error:', err.message);
      res.status(500).json({ error: 'Eksport xatoligi: ' + err.message });
    }
  });

  console.log('[DRAFT] Document drafting routes mounted');
}

module.exports = { mountDraftingRoutes, buildDocumentHtml };
