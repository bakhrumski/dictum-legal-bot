#!/usr/bin/env node
'use strict';

/**
 * Compares a rebuilt page against the design prototype it came from.
 *
 * The redesign handoff makes side-by-side review an acceptance criterion
 * (docs/design-handoff/STEP_BY_STEP.md): every page must match its prototype
 * at 1440x900 and 390x844, in both themes. Doing that by eye across a 6700px
 * page misses small drift, so this script measures the things that are cheap
 * to compare exactly — page height, section offsets, horizontal overflow,
 * console errors, failed requests — and writes screenshots for the rest.
 *
 *   node scripts/design-compare.js                 # landing
 *   node scripts/design-compare.js login /preview/login /login.html
 *   BASE=http://localhost:3000 node scripts/design-compare.js
 *
 * Needs the app running, and Chrome installed (playwright-core drives the
 * browser already on the machine rather than downloading its own).
 */

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  console.error('playwright-core is not installed — run: npm install');
  process.exit(1);
}

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || path.join(__dirname, '..', '.design-shots');
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(p => fs.existsSync(p));

const [name = 'landing', protoPath = '/preview/landing', newPath = '/'] = process.argv.slice(2);

const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];
const SECTIONS = ['features', 'how', 'pricing', 'faq'];

async function capture(browser, url, opts) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: 1,
    // Both pages honour prefers-reduced-motion, which parks every animation
    // on its final frame — without it two continuous animations sampled a
    // millisecond apart look like a difference.
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', r => problems.push('request failed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ': ' + r.url()); });

  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  if (opts.dark) {
    const btn = await page.$('[data-theme-toggle], button[title="Theme"], button[title="Rejimni almashtirish"]');
    if (btn) { await btn.click(); await page.waitForTimeout(700); }
    else problems.push('no theme toggle on the page');
  }

  await page.screenshot({
    path: path.join(OUT, `${name}-${opts.label}-${opts.dark ? 'dark' : 'light'}-${opts.side}.png`),
    fullPage: true,
  });

  const metrics = await page.evaluate((ids) => {
    const doc = document.documentElement;
    const out = {
      height: doc.scrollHeight,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      sections: {},
      overflowing: [],
    };
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) out.sections[id] = Math.round(el.getBoundingClientRect().top + window.scrollY);
    }
    if (doc.scrollWidth > doc.clientWidth + 1) {
      // Anything an ancestor clips is not what makes the page scroll.
      const clipped = el => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') return true;
        }
        return false;
      };
      document.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const right = r.right + window.scrollX;
        if (right <= doc.clientWidth + 1 || clipped(el)) return;
        out.overflowing.push(`${el.tagName}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''} right=${Math.round(right)}`);
      });
      out.overflowing = [...new Set(out.overflowing)].slice(0, 5);
    }
    return out;
  }, SECTIONS);

  await ctx.close();
  return { problems: [...new Set(problems)], metrics };
}

(async () => {
  if (!CHROME) {
    console.error('Chrome not found — set CHROME_PATH to its executable.');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  let drift = 0;

  for (const vp of VIEWPORTS) {
    for (const dark of [false, true]) {
      const a = await capture(browser, protoPath, { ...vp, dark, side: 'proto' });
      const b = await capture(browser, newPath, { ...vp, dark, side: 'new' });
      console.log(`\n=== ${vp.label} / ${dark ? 'dark' : 'light'} ===`);
      const dh = b.metrics.height - a.metrics.height;
      if (dh) drift++;
      console.log(`  height        ${a.metrics.height} -> ${b.metrics.height}  (${dh >= 0 ? '+' : ''}${dh}px)`);
      console.log(`  horizontal    proto ${a.metrics.scrollWidth > a.metrics.clientWidth ? 'SCROLLS' : 'clean'}` +
        `   new ${b.metrics.scrollWidth > b.metrics.clientWidth ? 'SCROLLS' : 'clean'}`);
      b.metrics.overflowing.forEach(o => console.log('      new overflows: ' + o));
      for (const id of SECTIONS) {
        const p = a.metrics.sections[id], n = b.metrics.sections[id];
        if (p == null && n == null) continue;
        const d = (n | 0) - (p | 0);
        if (d) drift++;
        console.log(`  #${id.padEnd(9)}   ${String(p).padStart(6)} -> ${String(n).padStart(6)}  (${d >= 0 ? '+' : ''}${d})`);
      }
      for (const [side, r] of [['proto', a], ['new', b]]) {
        r.problems.forEach(pb => console.log(`  [${side}] ${pb}`));
      }
    }
  }

  await browser.close();
  console.log(`\nscreenshots: ${OUT}`);
  console.log(drift ? `\n${drift} measurement(s) differ — check they are all intended.`
    : '\nEvery measurement matches the prototype.');
})().catch(e => { console.error(e); process.exit(1); });
