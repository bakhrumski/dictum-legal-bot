'use strict';

/**
 * Render public/logo-animation.html to a frame sequence, deterministically.
 *
 * Screen-recording a CSS animation gives you whatever frames the compositor
 * happened to produce — dropped frames, uneven spacing, and a first run that
 * may still be swapping fonts. Instead this drives the Web Animations API
 * directly: every animation on the page is paused, then `currentTime` is set
 * to an exact millisecond offset before each screenshot. Every frame lands
 * exactly where it should, and the result is reproducible.
 */

const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const HTML   = process.argv[2];
const OUTDIR = process.argv[3];
const W      = parseInt(process.env.W || '1920', 10);
const H      = parseInt(process.env.H || '1080', 10);
const FPS     = parseInt(process.env.FPS || '60', 10);
const HOLD_MS = parseInt(process.env.HOLD_MS || '2300', 10);  // matches index.html
const FADE_MS = parseInt(process.env.FADE_MS || '650', 10);
const TAIL_MS = parseInt(process.env.TAIL_MS || '250', 10);   // beat after the entrance
const SIZE    = process.env.SIZE || '720';
const TRANSPARENT = process.env.TRANSPARENT === '1';
// FADE=0 ends the clip ON the finished logo instead of fading it out. The tail
// then HOLDS the last frame rather than sitting on empty background, so an
// editor can freeze the end or cut straight out of it.
const FADE    = process.env.FADE !== '0';

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--font-render-hinting=none'],
  });

  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });

  const url = 'file://' + path.resolve(HTML)
    + `?size=${SIZE}&clean=1` + (TRANSPARENT ? '&bg=transparent' : '');
  await page.goto(url, { waitUntil: 'load' });

  // The wordmark must be in Source Serif before frame 0, or the capture opens
  // in the Georgia fallback and swaps mid-animation.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  // Restart cleanly, then freeze every animation so we can scrub it.
  await page.evaluate(() => {
    const s = document.getElementById('stage');
    s.classList.remove('playing', 'out');
    void s.offsetWidth;
    s.classList.add('playing');
  });
  await page.evaluate(() => {
    document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; });
  });

  const step = 1000 / FPS;
  let frame = 0;

  const shoot = async () => {
    await page.screenshot({
      path: path.join(OUTDIR, String(frame).padStart(5, '0') + '.png'),
      omitBackground: TRANSPARENT,
    });
    frame++;
  };

  // ── Phase 1: the entrance, scrubbed frame by frame ──────────────────────
  for (let t = 0; t < HOLD_MS; t += step) {
    await page.evaluate((ms) => {
      document.getAnimations().forEach(a => { a.currentTime = ms; });
    }, t);
    await shoot();
  }

  if (FADE) {
    // ── Phase 2: the closing fade ─────────────────────────────────────────
    // Adding .out starts a NEW animation, so re-pause and scrub that one while
    // holding the entrance animations at their final state.
    await page.evaluate((holdMs) => {
      const s = document.getElementById('stage');
      s.classList.add('out');
      document.getAnimations().forEach(a => {
        a.pause();
        if (a.animationName === 'io-fade') a.currentTime = 0;
        else a.currentTime = holdMs;
      });
    }, HOLD_MS);

    for (let t = 0; t < FADE_MS; t += step) {
      await page.evaluate((ms) => {
        document.getAnimations().forEach(a => {
          if (a.animationName === 'io-fade') a.currentTime = ms;
        });
      }, t);
      await shoot();
    }
  }

  // ── Phase 3: tail ───────────────────────────────────────────────────────
  // With the fade: empty background, so the sting can breathe.
  // Without it: hold the finished logo, which is the whole point of FADE=0.
  await page.evaluate((holdMs) => {
    document.getAnimations().forEach(a => {
      if (a.animationName === 'io-fade') a.currentTime = 10000;
      else a.currentTime = holdMs;
    });
  }, HOLD_MS);
  for (let t = 0; t < TAIL_MS; t += step) await shoot();

  await browser.close();
  console.log(`${frame} frames -> ${OUTDIR}  (${(frame / FPS).toFixed(2)}s @ ${FPS}fps, ${W}x${H})`);
})().catch(e => { console.error('RENDER FAILED:', e.message); process.exit(1); });
