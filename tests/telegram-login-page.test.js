'use strict';

/**
 * Telegram one-step sign-in (2026-11-05): "Bot domain invalid" on the login
 * page. Telegram signs only for the domain set in BotFather; the page now moves
 * to APP_URL's origin first (only between www. and the bare domain, or off
 * onrender.com), and a Telegram window that closed or failed sends the next tap
 * the code way (the bot's 6-digit code), which needs no domain.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { telegramLoginOptions, loginOrigin } = require('../src/auth/telegram-login');

const on = { TELEGRAM_LOGIN_ENABLED: 'true', REG_BOT_TOKEN: '123456:abc_DEF' };
assert.deepStrictEqual(telegramLoginOptions({ ...on, APP_URL: 'https://juristai.uz/' }), { botId: '123456', origin: 'https://juristai.uz' });
assert.strictEqual(telegramLoginOptions({ ...on }).origin, null, 'no APP_URL: no move');
assert.strictEqual(loginOrigin({ APP_URL: 'http://juristai.uz' }), null, 'only https');
assert.strictEqual(loginOrigin({ APP_URL: 'not a url' }), null);
assert.strictEqual(telegramLoginOptions({ REG_BOT_TOKEN: '1:a' }), null, 'off unless enabled');
assert.ok(!JSON.stringify(telegramLoginOptions({ ...on, APP_URL: 'https://juristai.uz' })).includes('abc_DEF'), 'never the token');

const page = fs.readFileSync(path.join(__dirname, '../public/app/kirish.js'), 'utf8');
const fn = /function sameSite\(origin\) \{[\s\S]*?\n  \}/.exec(page)[0];
const sameSiteAt = (host) => new Function('location', `${fn}; return sameSite;`)({ hostname: host });
assert.strictEqual(sameSiteAt('www.juristai.uz')('https://juristai.uz'), true, 'www -> bare');
assert.strictEqual(sameSiteAt('juristai-staging.onrender.com')('https://juristai.uz'), true, 'onrender -> domain');
assert.strictEqual(sameSiteAt('juristai.uz')('https://evil.example'), false, 'never a foreign host');
assert.strictEqual(sameSiteAt('localhost')('https://juristai.uz'), false, 'local stays');
assert.ok(page.includes("sessionStorage.setItem('jai-tg-widget', 'fail')") && page.includes("tgLogin && !widgetFailed() ? telegramOneStep : telegram"));

console.log('telegram login page: right domain first, a failed Telegram window falls back to the code');
