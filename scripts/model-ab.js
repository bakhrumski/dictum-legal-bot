'use strict';

/**
 * Model A/B comparison — runs a fixed set of legal questions through the REAL
 * pipeline (same RAG context, same prompt) on two models and prints a table.
 *
 * The quality signal is UNVERIFIED CITATIONS: article numbers the answer cites
 * that do not appear in the retrieved context. Lower is better; that is the
 * hallucination rate, measured rather than guessed.
 *
 * Usage (master session cookie required — copy it from DevTools → Application
 * → Cookies → connect.sid, or from a curl login):
 *
 *   BASE_URL=https://juristai-zd8j.onrender.com \
 *   COOKIE="connect.sid=s%3A..." \
 *   npm run model:ab
 *
 * Optional:  A=gpt-5.6-terra  B=gpt-5.6-luna  N=8
 */

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const COOKIE = process.env.COOKIE || '';
const A = process.env.A || 'gpt-5.6-terra';
const B = process.env.B || 'gpt-5.6-luna';
const N = process.env.N || '';

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

async function main() {
  if (!COOKIE) {
    console.error('COOKIE env var required (a master admin session cookie).');
    console.error('Example: COOKIE="connect.sid=s%3Aabc..." BASE_URL=https://... npm run model:ab');
    process.exit(2);
  }
  const url = `${BASE}/api/admin/model-ab?a=${encodeURIComponent(A)}&b=${encodeURIComponent(B)}${N ? `&n=${N}` : ''}`;
  console.log(`Comparing  A=${A}  vs  B=${B}\n${url}\n`);

  const resp = await fetch(url, { headers: { Cookie: COOKIE } });
  if (!resp.ok) {
    console.error(`Request failed: HTTP ${resp.status} — ${(await resp.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const d = await resp.json();

  console.log(pad('Question', 44) + pad('A unver.', 10) + pad('B unver.', 10) + pad('A $', 10) + pad('B $', 10));
  console.log('-'.repeat(84));
  for (const r of d.rows) {
    const a = r.a || {}, b = r.b || {};
    console.log(
      pad(r.question, 44) +
      pad(a.ok ? `${a.unverified}/${a.citedTotal}` : 'ERR', 10) +
      pad(b.ok ? `${b.unverified}/${b.citedTotal}` : 'ERR', 10) +
      pad(a.ok ? a.costUsd.toFixed(5) : '-', 10) +
      pad(b.ok ? b.costUsd.toFixed(5) : '-', 10)
    );
  }

  const t = d.totals;
  console.log('\n' + '='.repeat(84));
  console.log(pad('METRIC', 34) + padL(A, 22) + padL(B, 22));
  console.log('-'.repeat(84));
  const row = (label, va, vb) => console.log(pad(label, 34) + padL(va, 22) + padL(vb, 22));
  row('Succeeded', `${t.succeeded.a}/${d.questions}`, `${t.succeeded.b}/${d.questions}`);
  row('Unverified citations (lower=better)', t.unverifiedCitations.a, t.unverifiedCitations.b);
  row('Citations made (total)', t.citedTotal.a, t.citedTotal.b);
  row('Avg answer length (chars)', t.avgChars.a, t.avgChars.b);
  row('Avg latency (ms)', t.avgMs.a, t.avgMs.b);
  row('Total cost (USD)', '$' + t.costUsd.a.toFixed(5), '$' + t.costUsd.b.toFixed(5));
  if (t.costUsd.b > 0) {
    row('Cost ratio (A/B)', (t.costUsd.a / t.costUsd.b).toFixed(2) + 'x', '1.00x');
  }
  console.log('='.repeat(84));
  console.log('\nVERDICT: ' + d.verdict + '\n');
  console.log('Read a few answers yourself before deciding — citation count is the');
  console.log('objective half of quality; tone, structure and completeness are not.\n');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
