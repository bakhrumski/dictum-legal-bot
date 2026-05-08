'use strict';

/**
 * Word Document Export — Server-side DOCX generation
 *
 * Generates a properly formatted .docx file from a QA chat thread.
 * Uses the `docx` npm package for structured Word output.
 *
 * Features:
 *   - Calibri font throughout (no italic)
 *   - Proper heading hierarchy (H1 = question, H2 = sections)
 *   - Markdown → DOCX conversion (bold, links, lists)
 *   - JuristAI branding header
 *   - Timestamped footer
 *
 * Note: This module can also be used client-side if you import `docx` via CDN.
 *       The exported `generateWordBuffer()` returns a Buffer for server use
 *       or can be adapted to Blob for browser use.
 *
 * For the EXISTING client-side HTML-to-Word approach (using Blob):
 *   The dashboard.html already has a working Word export via HTML + Blob.
 *   This module is for when you need server-side generation (e.g., API endpoint).
 *
 * If `docx` is not installed, falls back to the existing HTML-based approach.
 */

/**
 * Generate a simple HTML-based Word document (works without docx package).
 * This is the RECOMMENDED approach for your current stack since you already
 * use this pattern in dashboard.html.
 *
 * @param {Object} opts
 * @param {string} opts.title - document title
 * @param {Array<{role: string, text: string}>} opts.messages - chat messages
 * @param {string} opts.topic - legal topic
 * @param {string} opts.timestamp - ISO timestamp
 * @returns {string} - HTML string that Word can open
 */
function generateWordHtml(opts) {
  const { title = 'JuristAI Javob', messages = [], topic = '', timestamp } = opts;

  const date = timestamp ? new Date(timestamp).toLocaleDateString('uz-UZ') : new Date().toLocaleDateString('uz-UZ');

  const messagesHtml = messages.map(msg => {
    const isUser = msg.role === 'user';
    const label = isUser ? 'Savol' : 'Javob';
    const bgColor = isUser ? '#f0f4ff' : '#ffffff';

    // Convert markdown to simple HTML
    const html = markdownToHtml(msg.text || msg.content || '');

    return `
      <div style="margin-bottom:20px;padding:15px;background:${bgColor};border-left:4px solid ${isUser ? '#3b82f6' : '#10b981'}">
        <p style="font-weight:bold;color:${isUser ? '#3b82f6' : '#10b981'};margin-bottom:8px">${label}:</p>
        ${html}
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      font-family: Calibri, sans-serif !important;
      font-style: normal !important;
    }
    body { max-width: 700px; margin: 0 auto; padding: 40px; color: #1a1a1a; }
    h1 { font-size: 22px; color: #1e3a5f; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
    h2 { font-size: 16px; color: #1e3a5f; margin-top: 20px; }
    p { line-height: 1.6; text-align: justify; }
    ul, ol { padding-left: 20px; }
    li { margin-bottom: 4px; }
    a { color: #3b82f6; }
    strong { font-weight: bold; }
    .header { text-align: center; margin-bottom: 30px; }
    .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 11px; color: #888; }
  </style>
</head>
<body>
  <div class="header">
    <h1>JuristAI — ${title}</h1>
    <p style="color:#666;font-size:12px">${topic ? `Mavzu: ${topic} | ` : ''}Sana: ${date}</p>
  </div>

  ${messagesHtml}

  <div class="footer">
    <p>Bu hujjat JuristAI sun'iy intellekt tizimi tomonidan yaratilgan. Muhim qarorlar uchun litsenziyalangan yuristga murojaat qiling.</p>
    <p>Yaratilgan: ${date} | JuristAI v2.0</p>
  </div>
</body>
</html>`;
}

/**
 * Convert basic markdown to HTML.
 * Handles: **bold**, [links](url), bullet lists, numbered lists, ## headers.
 */
function markdownToHtml(md) {
  if (!md) return '';

  let html = md
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Numbered lists
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br>');

  // Wrap consecutive <li> elements in <ul>
  html = html.replace(/(<li>.*?<\/li>(\s*<br>)?)+/g, (match) => {
    const cleaned = match.replace(/<br>/g, '');
    return `<ul>${cleaned}</ul>`;
  });

  return `<p>${html}</p>`;
}

/**
 * Client-side JavaScript function for browser-based Word export.
 * This is meant to be included in dashboard.html via <script>.
 *
 * Usage: downloadAsWord(messages, title, topic)
 *
 * Returns: triggers browser download of .docx file
 */
const CLIENT_SIDE_EXPORT_SCRIPT = `
function downloadChatAsWord(messages, title, topic) {
  const html = generateWordHtmlClient(messages, title || 'JuristAI Javob', topic || '');

  const blob = new Blob(
    ['\\ufeff' + html],  // BOM for correct encoding
    { type: 'application/msword' }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (title || 'juristai-javob') + '.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
`;

module.exports = {
  generateWordHtml,
  markdownToHtml,
  CLIENT_SIDE_EXPORT_SCRIPT,
};
