'use strict';

/**
 * Tests for public/css/tokens.css against the design prototypes.
 *
 * The redesign brief is explicit that no value may be rounded, tidied or
 * "improved" on the way out of the prototypes — a token that drifts by two
 * hundredths of an alpha channel is a visual regression nobody reviews,
 * because the diff looks deliberate. So the comparison is mechanical: every
 * custom property and every @keyframes body in the prototypes must appear in
 * tokens.css character-for-character.
 *
 *   node tests/design-tokens.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const tokens = read('public/css/tokens.css');
const DS = 'public/preview/_ds/juristai-design-system-dadff2d6-01b1-4a6a-87cf-c621c8a66f44/colors_and_type.css';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

// The prototypes keep their whole stylesheet in one <helmet><style> block.
function styleOf(file) {
  const s = read(file);
  const a = s.indexOf('<style>');
  return s.slice(a + '<style>'.length, s.indexOf('</style>', a));
}

/** Body of the first rule with this exact selector, brace-matched. */
function ruleBody(css, selector) {
  const i = css.indexOf(selector + ' {');
  if (i < 0) return null;
  const start = css.indexOf('{', i);
  let depth = 0, j = start;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) break;
  }
  return css.slice(start + 1, j);
}

function customProps(body) {
  const out = {};
  if (body == null) return out;
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body.replace(/\/\*[\s\S]*?\*\//g, '')))) {
    out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return out;
}

function keyframes(css) {
  const out = {};
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 0, j = m.index + m[0].length - 1;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    out[m[1]] = css.slice(m.index + m[0].length, j).replace(/\s+/g, ' ').trim();
  }
  return out;
}

const landing = styleOf('public/preview/landing.dc.html');
const login = styleOf('public/preview/login.dc.html');
const dashboard = styleOf('public/preview/dashboard.dc.html');
const ds = read(DS);

console.log('\ndesign tokens — values survive the move out of the prototypes\n');

for (const [selector, source, label] of [
  [':root', ds, 'design system scale'],
  ['[data-theme="dark"]', ds, 'design system dark mode'],
  ['#jai-root', landing, 'landing light'],
  ['#jai-root[data-theme="dark"]', landing, 'landing dark'],
  ['#lg-root', login, 'login (dark by default)'],
  ['#lg-root[data-theme="light"]', login, 'login light wash'],
  ['#db-root', dashboard, 'dashboard light'],
  ['#db-root[data-theme="dark"]', dashboard, 'dashboard dark'],
]) {
  test(`${label} — ${selector}`, () => {
    const want = customProps(ruleBody(source, selector));
    const got = customProps(ruleBody(tokens, selector));
    assert.ok(Object.keys(want).length > 0, `no custom properties found for ${selector} in the prototype`);
    for (const [prop, value] of Object.entries(want)) {
      assert.ok(prop in got, `${selector} is missing ${prop}`);
      assert.strictEqual(got[prop], value, `${selector} ${prop} drifted`);
    }
  });
}

console.log('\ndesign tokens — animations are copied, not re-authored\n');

// ANIMATIONS.md lists these as leftovers from earlier iterations; no prototype
// references them, so tokens.css deliberately drops them.
const RETIRED = new Set([
  'jai-breathe', 'jai-shock', 'jai-shockring', 'jai-dash',
  'jai-trailglow', 'jai-sc-a', 'jai-sc-b', 'jai-sc-c',
]);

test('every keyframe the prototypes use is present, byte for byte', () => {
  const got = keyframes(tokens);
  let checked = 0;
  for (const [file, css] of [['landing', landing], ['login', login], ['dashboard', dashboard]]) {
    for (const [name, body] of Object.entries(keyframes(css))) {
      if (RETIRED.has(name)) continue;
      checked++;
      assert.ok(name in got, `@keyframes ${name} (${file}) is missing from tokens.css`);
      assert.strictEqual(got[name], body, `@keyframes ${name} (${file}) drifted`);
    }
  }
  assert.ok(checked >= 35, `expected the full animation set, only found ${checked}`);
});

test('retired keyframes are not carried over as dead CSS', () => {
  const got = keyframes(tokens);
  for (const name of RETIRED) {
    assert.ok(!(name in got), `@keyframes ${name} is unused by every prototype`);
  }
});

console.log('\ndesign tokens — the stylesheet stands on its own\n');

test('self-hosted Roboto resolves from public/css/', () => {
  // colors_and_type.css pointed at ./fonts/ beside itself; tokens.css lives one
  // directory deeper than the repo's font folder.
  for (const weight of ['Roboto-Regular.ttf', 'Roboto-Bold.ttf']) {
    assert.ok(tokens.includes(`url("../fonts/${weight}")`), `@font-face for ${weight} is missing`);
    assert.ok(fs.existsSync(path.join(root, 'public', 'fonts', weight)), `public/fonts/${weight} does not exist`);
  }
});

test('the type utility classes came across', () => {
  for (const cls of ['.type-display', '.type-h1', '.type-h2', '.type-h3', '.type-h4',
    '.type-eyebrow', '.type-body', '.type-body-serif', '.type-small',
    '.type-micro', '.type-mono', '.type-citation']) {
    assert.ok(tokens.includes(cls + ' {'), `${cls} is missing`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
