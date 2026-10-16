'use strict';

/**
 * JuristAI for Microsoft Word (task pane add-in, public/word/).
 *
 * The task pane runs inside Word (desktop WebView, or an iframe on Word on the
 * web), where the site's session cookie is not reliably available. It signs in
 * with a device pairing instead of a password or a pop-up:
 *
 *   1. task pane  POST /api/addin/pair            -> { pairId (secret), code }
 *   2. the person opens /word/ulash.html?code=…   in their browser, signed in
 *      to JuristAI as usual, and confirms the code (POST /api/addin/pair/approve)
 *   3. task pane  GET  /api/addin/pair/:pairId    -> { status:'approved', token }
 *
 * The token ("jai_…", 90 days, stored as a SHA-256 hash in addin_tokens) is
 * sent as "Authorization: Bearer". It opens only BEARER_PATHS, as the account
 * that approved it, with that account's role and tariff limits; every other
 * route ignores it. Pairings live in memory for 10 minutes (a restart only
 * asks the person to connect again).
 */

const crypto = require('crypto');

const PAIR_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_DAYS = 90;
const MAX_PENDING = 5000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_LEN = 6;

// routes a task-pane token may call (method + exact path)
const BEARER_PATHS = new Set([
  'GET /api/user-info',
  'GET /api/tariff/me',
  'POST /api/legal-chat',
  'GET /api/addin/me',
  'POST /api/addin/logout',
]);

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

function newCode() {
  const bytes = crypto.randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
function newToken() { return 'jai_' + crypto.randomBytes(32).toString('base64url'); }

async function ensureTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS addin_tokens (
    id SERIAL PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    admin_id INTEGER NOT NULL,
    client TEXT NOT NULL DEFAULT 'word',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_addin_tokens_admin ON addin_tokens(admin_id)');
}

function createPairings({ now = () => Date.now() } = {}) {
  const byId = new Map(); // sha256(pairId) -> { code, expiresAt, adminId, token }

  function sweep() {
    const t = now();
    for (const [k, v] of byId) if (t > v.expiresAt) byId.delete(k);
  }
  function create() {
    sweep();
    if (byId.size >= MAX_PENDING) return null;
    const pairId = crypto.randomBytes(32).toString('hex');
    let code;
    do { code = newCode(); } while ([...byId.values()].some(v => v.code === code));
    byId.set(sha256(pairId), { code, expiresAt: now() + PAIR_TTL_MS, adminId: null, token: null });
    return { pairId, code, expiresIn: Math.round(PAIR_TTL_MS / 1000) };
  }
  function findByCode(code) {
    sweep();
    const c = normCode(code);
    if (c.length !== CODE_LEN) return null;
    for (const [k, v] of byId) if (v.code === c && !v.adminId) return { key: k, entry: v };
    return null;
  }
  /** status for the task pane; hands the token over once, then forgets the pairing */
  function poll(pairId) {
    const key = sha256(String(pairId || ''));
    const v = byId.get(key);
    if (!v || now() > v.expiresAt) { byId.delete(key); return { status: 'expired' }; }
    if (!v.token) return { status: 'pending', code: v.code };
    byId.delete(key);
    return { status: 'approved', token: v.token };
  }
  return { create, findByCode, poll, sweep, _size: () => byId.size };
}

async function issueToken(pool, adminId) {
  const token = newToken();
  await pool.query(
    `INSERT INTO addin_tokens (token_hash, admin_id, expires_at) VALUES ($1, $2, NOW() + ($3 || ' days')::interval)`,
    [sha256(token), adminId, String(TOKEN_TTL_DAYS)]
  );
  return token;
}

async function loadAccount(pool, tokenHash) {
  const sql = (active) => `SELECT t.id AS token_id, t.last_used_at, a.id, a.role, a.username, a.full_name
      FROM addin_tokens t JOIN admins a ON a.id = t.admin_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > NOW()${active ? ' AND COALESCE(a.is_active, TRUE) = TRUE' : ''}
     LIMIT 1`;
  try {
    return (await pool.query(sql(true), [tokenHash])).rows[0] || null;
  } catch (e) {
    if (!/is_active/i.test(e.message)) throw e;
    return (await pool.query(sql(false), [tokenHash])).rows[0] || null;
  }
}

/**
 * Before the session middleware: a request on BEARER_PATHS with a task-pane
 * token gets a plain session object for that account (express-session then
 * leaves it alone: no cookie, nothing stored). Anything else passes through.
 */
function createBearerAuth(pool, { cacheMs = 60 * 1000 } = {}) {
  const cache = new Map(); // hash -> { at, account }
  const bearerAuth = async function (req, res, next) {
    const h = req.headers && req.headers.authorization;
    if (!h || !/^Bearer jai_[A-Za-z0-9_-]{20,}$/.test(h)) return next();
    if (!BEARER_PATHS.has(req.method + ' ' + req.path)) return next();
    const hash = sha256(h.slice(7));
    try {
      let hit = cache.get(hash);
      if (!hit || Date.now() - hit.at > cacheMs) {
        hit = { at: Date.now(), account: await loadAccount(pool, hash) };
        cache.set(hash, hit);
        if (cache.size > 2000) cache.delete(cache.keys().next().value);
        if (hit.account) pool.query('UPDATE addin_tokens SET last_used_at = NOW() WHERE id = $1', [hit.account.token_id]).catch(() => {});
      }
      const a = hit.account;
      if (!a) return res.status(401).json({ error: 'addin_token_invalid', code: 'ADDIN_TOKEN_INVALID' });
      req.session = { isAuthenticated: true, role: a.role, adminId: a.id, username: a.username, fullName: a.full_name, addin: 'word' };
      req.addinTokenId = a.token_id;
      req.addinTokenHash = hash;
      res.locals.addinClient = 'word';
      return next();
    } catch (e) {
      console.error('[ADDIN] token check failed:', e.message);
      return res.status(503).json({ error: 'addin_unavailable' });
    }
  };
  bearerAuth.forget = (hash) => cache.delete(hash); // logout: no minute of grace
  return bearerAuth;
}

/**
 * X-Frame-Options would keep the task pane out of Word on the web; the
 * Google Docs sidebar (a googleusercontent.com page) loads the pane's
 * script and style from here, which Cross-Origin-Resource-Policy would block.
 */
function wordFrameHeaders(req, res, next) {
  if (req.path.startsWith('/word/') || req.path.startsWith('/gdocs/')) res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.path.startsWith('/word/')) {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.officeapps.live.com https://*.office.com https://*.office365.com https://*.office.net https://*.microsoft.com https://*.cloud.microsoft https://*.sharepoint.com https://*.live.com");
  }
  next();
}

// Google Docs sidebar (Apps Script HtmlService) runs on such an origin
const GOOGLE_SANDBOX_ORIGIN = /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/;

/** CORS for the Google Docs sidebar: only its own routes, never with cookies. */
function addinCorsAllowed(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin || !GOOGLE_SANDBOX_ORIGIN.test(origin)) return false;
  const method = req.method === 'OPTIONS' ? String(req.headers['access-control-request-method'] || '').toUpperCase() : req.method;
  const path = req.path;
  if (BEARER_PATHS.has(method + ' ' + path)) return true;
  if (method === 'POST' && path === '/api/addin/pair') return true;
  if (method === 'GET' && /^\/api\/addin\/pair\/[a-f0-9]{64}$/.test(path)) return true;
  return false;
}
const ADDIN_CORS = Object.freeze({ origin: true, credentials: false, methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type', 'Accept'], maxAge: 600 });

/** /gdocs/panel.js — the task pane's markup for the Google Docs sidebar (one source: public/word/taskpane.html). */
function panelScript(html, base = '') {
  const a = html.indexOf('<body>');
  const b = html.indexOf('<script src="/word/taskpane.js');
  // images by absolute URL: the sidebar page is not on this host
  const markup = html.slice(a + 6, b).trim().replace(/ src="\/(?!\/)/g, ` src="${String(base).replace(/\/+$/, '')}/`);
  return 'document.body.insertAdjacentHTML("afterbegin", ' + JSON.stringify(markup).replace(/<\//g, '<\\/') + ');\n';
}

function guidFor(base) {
  const h = sha256('juristai-word-addin|' + base);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function xmlEsc(s) { return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

/** The add-in manifest for the host it is downloaded from (staging and production differ). */
function manifestXml(base, { id, name = 'JuristAI' } = {}) {
  const b = xmlEsc(base.replace(/\/+$/, ''));
  const guid = id || guidFor(base);
  const label = xmlEsc(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>${guid}</Id>
  <Version>1.0.1.0</Version>
  <ProviderName>JuristAI</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="${label}"/>
  <Description DefaultValue="O'zbekiston qonunchiligi asosida hujjat tahlili, savol-javob va tahrir takliflari (lex.uz manbalari bilan)."/>
  <IconUrl DefaultValue="${b}/word/assets/icon-32.png?v=2"/>
  <HighResolutionIconUrl DefaultValue="${b}/word/assets/icon-64.png?v=2"/>
  <SupportUrl DefaultValue="${b}/"/>
  <AppDomains>
    <AppDomain>${b}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Document"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="WordApi" MinVersion="1.1"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${b}/word/taskpane.html"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Document">
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <FunctionFile resid="Commands.Url"/>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="JuristAI.Group">
                <Label resid="Group.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16x16"/>
                  <bt:Image size="32" resid="Icon.32x32"/>
                  <bt:Image size="80" resid="Icon.80x80"/>
                </Icon>
                <Control xsi:type="Button" id="JuristAI.TaskpaneButton">
                  <Label resid="Button.Label"/>
                  <Supertip>
                    <Title resid="Button.Label"/>
                    <Description resid="Button.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>JuristAI.Taskpane</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16x16" DefaultValue="${b}/word/assets/icon-16.png?v=2"/>
        <bt:Image id="Icon.32x32" DefaultValue="${b}/word/assets/icon-32.png?v=2"/>
        <bt:Image id="Icon.80x80" DefaultValue="${b}/word/assets/icon-80.png?v=2"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="Commands.Url" DefaultValue="${b}/word/commands.html"/>
        <bt:Url id="Taskpane.Url" DefaultValue="${b}/word/taskpane.html"/>
        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="${b}/"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="JuristAI Word'da"/>
        <bt:String id="Group.Label" DefaultValue="${label}"/>
        <bt:String id="Button.Label" DefaultValue="${label}"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Bosh sahifadagi JuristAI tugmasini bosing va akkauntingizni ulang."/>
        <bt:String id="Button.Tooltip" DefaultValue="Hujjat tahlili, tanlangan band bo'yicha savol va tahrir takliflari."/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`;
}

function baseUrlOf(req) {
  const env = String(process.env.WORD_ADDIN_BASE_URL || '').trim();
  if (/^https:\/\//.test(env)) return env.replace(/\/+$/, '');
  return `https://${req.get('host')}`;
}

/** /word/manifest.xml — no session needed; mount before the session middleware. */
function mountManifest(app) {
  const path = require('path');
  const fs = require('fs');
  app.get('/gdocs/panel.js', (req, res) => {
    try {
      const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'word', 'taskpane.html'), 'utf8');
      res.set('Content-Type', 'application/javascript; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300');
      res.send(panelScript(html, baseUrlOf(req)));
    } catch (e) {
      res.status(500).type('application/javascript').send('/* panel unavailable */');
    }
  });
  app.get('/word/manifest.xml', (req, res) => {
    const base = baseUrlOf(req);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="juristai-word-manifest.xml"');
    res.set('Cache-Control', 'no-store');
    res.send(manifestXml(base, { id: process.env.WORD_ADDIN_ID || undefined, name: process.env.WORD_ADDIN_NAME || 'JuristAI' }));
  });
}

function mountRoutes(app, { pool, requireAuth, requireSameOrigin, logAudit = () => {}, rateLimit, pairings = createPairings() }) {
  const limit = (max) => (rateLimit ? rateLimit({ windowMs: 15 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false,
    message: { error: "Juda ko'p urinish — 15 daqiqadan so'ng qayta urinib ko'ring" } }) : (req, res, next) => next());
  const pairLimiter = limit(30);
  const approveLimiter = limit(15);

  // 1. task pane asks for a pairing
  app.post('/api/addin/pair', pairLimiter, (req, res) => {
    const p = pairings.create();
    if (!p) return res.status(503).json({ error: 'busy' });
    res.set('Cache-Control', 'no-store');
    res.json({ ...p, connectUrl: `${baseUrlOf(req)}/word/ulash.html?code=${p.code}` });
  });

  // 3. task pane polls until the person confirms
  app.get('/api/addin/pair/:pairId', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!/^[a-f0-9]{64}$/.test(req.params.pairId)) return res.status(400).json({ error: 'bad_pair' });
    res.json(pairings.poll(req.params.pairId));
  });

  // 2. the signed-in person confirms the code shown in Word
  app.post('/api/addin/pair/approve', requireAuth, requireSameOrigin, approveLimiter, async (req, res) => {
    const found = pairings.findByCode(req.body && req.body.code);
    if (!found) return res.status(404).json({ error: 'code_not_found', message: "Kod topilmadi yoki muddati o'tgan. Word'da yangi kod oling." });
    try {
      const token = await issueToken(pool, req.session.adminId);
      found.entry.adminId = req.session.adminId;
      found.entry.token = token;
      logAudit(req, 'addin.word.connect', 'addin_token', String(req.session.adminId));
      res.json({ ok: true });
    } catch (e) {
      console.error('[ADDIN] approve failed:', e.message);
      res.status(500).json({ error: 'approve_failed' });
    }
  });

  // the person's connected Word copies: how many, and disconnect them all
  app.get('/api/addin/connections', requireAuth, async (req, res) => {
    const r = await pool.query(`SELECT COUNT(*)::int AS n, MAX(last_used_at) AS last_used_at FROM addin_tokens
      WHERE admin_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`, [req.session.adminId]);
    res.json(r.rows[0] || { n: 0 });
  });
  app.post('/api/addin/connections/revoke-all', requireAuth, requireSameOrigin, async (req, res) => {
    const r = await pool.query('UPDATE addin_tokens SET revoked_at = NOW() WHERE admin_id = $1 AND revoked_at IS NULL', [req.session.adminId]);
    logAudit(req, 'addin.word.revoke_all', 'addin_token', String(req.session.adminId));
    res.json({ ok: true, revoked: r.rowCount || 0 });
  });

  // task pane (token): who am I / sign out
  app.get('/api/addin/me', requireAuth, (req, res) => {
    if (!req.addinTokenId) return res.status(401).json({ error: 'addin_token_required' });
    res.json({ adminId: req.session.adminId, username: req.session.username, fullName: req.session.fullName, role: req.session.role });
  });
  app.post('/api/addin/logout', requireAuth, async (req, res) => {
    if (!req.addinTokenId) return res.status(401).json({ error: 'addin_token_required' });
    await pool.query('UPDATE addin_tokens SET revoked_at = NOW() WHERE id = $1', [req.addinTokenId]);
    if (typeof app.locals.addinForget === 'function') app.locals.addinForget(req.addinTokenHash);
    res.json({ ok: true });
  });
}

module.exports = {
  BEARER_PATHS, PAIR_TTL_MS, TOKEN_TTL_DAYS, CODE_LEN,
  sha256, newCode, normCode, newToken, ensureTables, createPairings, issueToken, loadAccount,
  createBearerAuth, wordFrameHeaders, manifestXml, guidFor, mountManifest, mountRoutes,
  addinCorsAllowed, ADDIN_CORS, GOOGLE_SANDBOX_ORIGIN, panelScript,
};
