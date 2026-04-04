require('dotenv').config();

// ── Polyfill File for Node 18 (undici/fetch needs it) ──
if (typeof globalThis.File === 'undefined') {
  const { Blob } = require('buffer');
  globalThis.File = class File extends Blob {
    constructor(chunks, name, opts) {
      super(chunks, opts);
      this.name = name;
      this.lastModified = (opts && opts.lastModified) || Date.now();
    }
  };
  console.log('[POLYFILL] File class injected for Node', process.version);
}

// Start the Telegram bot first (creates the polling instance)
const { bot } = require('./src/bot/bot');

// Start the dashboard server (shares the bot instance)
require('./src/api/server');
