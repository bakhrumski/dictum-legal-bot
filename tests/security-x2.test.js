'use strict';

/**
 * X2 of the 2026-11-10 audit (docs/audit/2026-11-10-audit.md §2): S7 one
 * cross-site guard over every /api write, S6 a Content-Security-Policy on the
 * new app's pages, S11 uploaded Word / PDF files that unpack or run too large
 * are refused before a parser opens them.
 *
 *   node tests/security-x2.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('security fixes X2');
  const server = read('src', 'api', 'server.js');

  await test('S7: a write the browser says comes from elsewhere is refused; this site, a configured origin, the pane and header-less clients pass', () => {
    const { createCrossSiteGuard } = require('../src/auth/same-origin');
    const g = createCrossSiteGuard({ allow: req => req.path === '/api/addin/pair', extraOrigins: ['https://mobile.example'] });
    const run = (method, headers, p = '/api/x') => { let out = 'next'; g({ method, path: p, get: h => headers[h.toLowerCase()] }, { status(c) { out = c; return this; }, json() {} }, () => {}); return out; };
    const host = { host: 'juristai.uz' };
    assert.strictEqual(run('POST', { ...host, origin: 'https://juristai.uz' }), 'next');
    assert.strictEqual(run('POST', { ...host, origin: 'https://evil.example' }), 403);
    assert.strictEqual(run('POST', { ...host, origin: 'https://docs.juristai.uz' }), 403, 'a sibling subdomain is another origin');
    assert.strictEqual(run('DELETE', { ...host, origin: 'null' }), 403);
    assert.strictEqual(run('PUT', { ...host, referer: 'https://evil.example/page' }), 403);
    assert.strictEqual(run('PATCH', { ...host, referer: 'https://juristai.uz/app/' }), 'next');
    assert.strictEqual(run('POST', { ...host }), 'next', 'no Origin and no Referer: a server-side client (Telegram webhook, a script)');
    assert.strictEqual(run('POST', { ...host, origin: 'https://mobile.example' }), 'next');
    assert.strictEqual(run('POST', { ...host, origin: 'https://x.googleusercontent.com' }, '/api/addin/pair'), 'next');
    assert.strictEqual(run('GET', { ...host, origin: 'https://evil.example' }), 'next', 'reads are not its business');
    assert.ok(server.includes("req.path.startsWith('/api/') ? crossSiteGuard(req, res, next) : next()"));
    assert.ok(server.indexOf('crossSiteGuard(req, res, next)') < server.indexOf("app.use(express.json({ limit: '2mb' }))"), 'before any body is read');
  });

  await test('S6: the app\'s pages carry a policy - scripts from this site, the pages\' own inline scripts by hash, no object, no foreign frames', () => {
    const csp = require('../src/auth/app-csp');
    const html = read('public', 'app', 'index.html');
    const hashes = csp.inlineScriptHashes(html);
    assert.strictEqual(hashes.length, 1, 'the one boot script');
    assert.strictEqual(csp.inlineScriptHashes('<script type="application/ld+json">{}</script><script src="/a.js"></script>').length, 0);
    const p = csp.buildPolicy({ hashes, host: 'juristai.uz', supabaseUrl: 'https://abc.supabase.co/' });
    assert.ok(p.includes("default-src 'self'") && p.includes("object-src 'none'") && p.includes("base-uri 'self'") && p.includes("frame-ancestors 'self'"));
    assert.ok(new RegExp(`script-src 'self' ${hashes[0].replace(/[+/=]/g, '\\$&')} https://cdn\\.jsdelivr\\.net https://telegram\\.org;`).test(p));
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(p) && !/'unsafe-eval'/.test(p), 'no inline or eval scripts');
    assert.ok(p.includes("connect-src 'self' https://abc.supabase.co wss://juristai.uz wss://abc.supabase.co"));
    // the middleware: only the app's HTML pages, by mode
    const run = (env, p2, method = 'GET') => { const h = {}; csp.createAppCsp({ env })({ method, path: p2, secure: true, get: () => 'juristai.uz' }, { setHeader: (k, v) => { h[k] = v; } }, () => {}); return h; };
    assert.ok(run({}, '/')['Content-Security-Policy'] && run({}, '/kirish.html')['Content-Security-Policy']);
    assert.deepStrictEqual(run({}, '/app.js'), {}, 'not on scripts or styles');
    assert.deepStrictEqual(run({ APP_CSP: 'off' }, '/'), {});
    assert.ok(run({ APP_CSP: 'report' }, '/')['Content-Security-Policy-Report-Only']);
    assert.ok(server.includes("app.use('/app', require('../auth/app-csp').createAppCsp());"));
    assert.ok(server.indexOf("createAppCsp()") < server.indexOf("app.use(express.static('public'))"), 'before the static files');
  });

  await test('S6: the app has no inline event handlers for the policy to break', () => {
    const dir = path.join(__dirname, '..', 'public', 'app');
    for (const f of fs.readdirSync(dir).filter(x => /\.(js|html)$/.test(x) && !/-test\.html$/.test(x))) {
      assert.ok(!/\son(click|change|submit|input|load|error|keydown)\s*=\s*\\?["']/i.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
    }
  });

  await test('S11: a Word file that unpacks too large is refused before a parser opens it', async () => {
    const g = require('../src/ocr/upload-guard');
    const JSZip = require('jszip');
    const small = new JSZip(); small.file('word/document.xml', '<w:document/>');
    const ok = await small.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    assert.ok(g.zipDeclared(ok).entries >= 1 && g.zipDeclared(ok).bytes === '<w:document/>'.length); g.assertZipSafe(ok);
    const bomb = new JSZip(); bomb.file('word/document.xml', Buffer.alloc(160 * 1024 * 1024));
    const b = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    assert.ok(b.length < 1024 * 1024, 'under 1 MB on the wire');
    assert.throws(() => g.assertZipSafe(b), e => e.status === 413 && e.code === 'ARCHIVE_TOO_LARGE');
    await assert.rejects(require('../src/ocr/docx-text').docxText(b), e => e.code === 'ARCHIVE_TOO_LARGE');
    const many = new JSZip(); for (let i = 0; i < 5001; i++) many.file(`f${i}`, '');
    const m = await many.generateAsync({ type: 'nodebuffer' });
    assert.throws(() => g.assertZipSafe(m), e => e.status === 413, 'too many entries');
    g.assertZipSafe(Buffer.from('not a zip at all, just some text')); // not a ZIP: left to the parser's own error
    g.assertZipSafe(null);
  });

  await test('S11: a PDF over the page limit is refused, never read in part; every file-opening path uses the guard', async () => {
    const g = require('../src/ocr/upload-guard');
    const fake = path.join(__dirname, '..', 'tests', '.x2-fake-pdf.js');
    fs.writeFileSync(fake, 'module.exports = async (d, o) => ({ numpages: Number(process.env.X2_PAGES), text: "t", max: o.max });');
    try {
      process.env.X2_PAGES = '1500'; assert.strictEqual((await g.parsePdf(Buffer.from('x'), { a: 1 }, { lib: fake })).max, 1500, 'the parser is told the limit');
      process.env.X2_PAGES = '1501'; await assert.rejects(g.parsePdf(Buffer.from('x'), {}, { lib: fake }), e => e.status === 413 && e.code === 'PDF_TOO_LONG');
    } finally { fs.unlinkSync(fake); delete process.env.X2_PAGES; }
    const srcs = ['src/ocr/routes.js', 'src/ocr/scan-limits.js', 'src/workspace/extract-text.js', 'src/drafting/routes.js', 'src/api/server.js'].map(f => read(...f.split('/'))).join('\n');
    assert.ok(!/await pdfParse\(/.test(srcs) && !/require\('pdf-parse[^']*'\)\(/.test(srcs), 'no direct pdf-parse call left');
    assert.ok((srcs.match(/upload-guard'\)\.parsePdf\(/g) || []).length >= 6);
    for (const f of ['src/ocr/docx-text.js', 'src/editor/import.js', 'src/workspace/extract-text.js', 'src/drafting/routes.js']) assert.ok(read(...f.split('/')).includes('assertZipSafe('), f);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
