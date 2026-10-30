'use strict';

/**
 * A matter as a short PowerPoint deck or an Excel workbook (2026-10-28,
 * roadmap stage 2 "Natijalar: Excel (jadval), PowerPoint (ish bo'yicha
 * qisqa taqdimot)"). Built only from what the matter already holds - its
 * summary, notes, linked chats and the agent results it links - with no AI
 * call and no tariff unit: nothing new is claimed, so nothing new needs
 * checking. Every deck ends with what the results are and are not.
 *
 *   GET /api/matters/:id/export?format=pptx|xlsx   (mounted in routes.js)
 */

const XLSX = require('xlsx');
const { buildPptx } = require('../exports/pptx');

const WF = Object.freeze({ claim_draft: "Da'vo arizasi loyihasi", tabular_review: 'Jadvalli tahlil', playbook_review: 'Playbook tekshiruvi', planned: 'Agent topshirig‘i' });
const PB = Object.freeze({ mos: 'Mos', farq: 'Farq qiladi', yoq: "Band yo'q", noaniq: 'Noaniq' });
const KIND = Object.freeze({ chat: 'Chat', scan: 'Skan hujjat', agent_run: 'Agent natijasi', note: 'Yozuv' });
const day = d => { const x = d ? new Date(d) : null; return x && !Number.isNaN(x.getTime()) ? x.toISOString().slice(0, 10) : ''; };
const plain = s => String(s || '').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, '$1').replace(/\*\*|__|`|^#{1,6}\s+/gmu, '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();

/** The part of a legal answer under "Xulosa" (else its first sentences). */
function conclusion(answer) {
  const t = String(answer || '');
  const m = t.match(/\*\*\s*Xulosa\s*\*\*\s*\n+([\s\S]{0,1200})/iu) || t.match(/(?:^|\n)#+\s*Xulosa\s*\n+([\s\S]{0,1200})/iu);
  return plain(m ? m[1] : t).slice(0, 600);
}

/** The slides for one linked agent result. */
function runSlides(item, run) {
  const b = run.body || {};
  const title = item.title || WF[run.workflow] || 'Agent natijasi';
  if (run.workflow === 'tabular_review' && Array.isArray(b.rows)) {
    const cols = (b.columns || []).slice(0, 5);
    const rows = b.rows.filter(r => r.status === 'ok').map(r => [r.name, ...cols.map(c => { const x = r.cells && r.cells[c.id]; return x ? (x.notFound ? '—' : x.answer) : ''; })]);
    return [{ kicker: WF.tabular_review, title, table: { head: ['Hujjat', ...cols.map(c => c.label)], rows },
      note: `${b.rows.length} hujjat${rows.length > 9 ? ', jadvalda dastlabki 9 tasi; to‘liq jadval Excel faylida' : ''}. Iqtibos hujjatda borligi tekshirilgan, javob to‘g‘riligi emas.` }];
  }
  if (run.workflow === 'playbook_review' && Array.isArray(b.results)) {
    const c = b.counts || {};
    const order = { yoq: 0, farq: 1, noaniq: 2, mos: 3 };
    const issues = b.results.filter(x => x.status !== 'mos').sort((x, y) => order[x.status] - order[y.status])
      .map(x => ({ text: `${(x.rule && x.rule.title) || 'Qoida'} — ${PB[x.status] || x.status}`, sub: x.note || '' }));
    return [{ kicker: WF.playbook_review, title, bullets: issues.length ? issues : ['Hamma qoida bajarilgan'],
      note: `Mos: ${c.mos || 0} · Farq: ${c.farq || 0} · Yo‘q: ${c.yoq || 0} · Noaniq: ${c.noaniq || 0}. Playbook — firmaning qoidalari, qonun emas.` }];
  }
  if (run.workflow === 'claim_draft') {
    const basis = (b.basis || []).map(x => ({ text: `${x.act}${x.article ? `, ${x.article}-modda` : ''}`, sub: x.url ? 'lex.uz' : '' }));
    return [{ kicker: WF.claim_draft, title, bullets: basis.length ? basis : ['Huquqiy asos ko‘rsatilmagan'],
      note: (b.warnings || []).length ? `Ogohlantirishlar: ${b.warnings.length}. Loyiha yurist tekshiruvidan o‘tishi kerak.` : 'Loyiha yurist tekshiruvidan o‘tishi kerak.' }];
  }
  if (run.workflow === 'planned' && b.answer) {
    const src = (b.sources || []).slice(0, 4).map(x => `${x.act}${x.article ? `, ${x.article}-modda` : ''}`);
    const v = b.verification && b.verification.status;
    return [{ kicker: WF.planned, title, bullets: [conclusion(b.answer), ...src.map(x => ({ text: x, sub: 'manba' }))],
      note: v === 'verified' ? 'Server tekshiruvi: manbalar bilan tasdiqlangan.' : 'Server tekshiruvi: to‘liq tasdiqlanmagan — yurist ko‘rib chiqsin.' }];
  }
  return [];
}

function slidesOf(m, results) {
  const items = m.items || [];
  const notes = items.filter(i => i.kind === 'note');
  const count = k => items.filter(i => i.kind === k).length;
  const slides = [{ kind: 'cover', kicker: 'Ish bo‘yicha qisqa taqdimot', title: m.title, subtitle: m.summary || '',
    note: `${m.status === 'closed' ? 'Yopilgan' : 'Ochiq'} ish · ${day(m.updatedAt || m.createdAt)} · JuristAI` }];
  slides.push({ kicker: 'Umumiy', title: 'Ish tarkibi', table: { head: ['Element', 'Soni'], rows: [['Yozuvlar', String(count('note'))], ['Chatlar', String(count('chat'))], ['Skan hujjatlar', String(count('scan'))], ['Agent natijalari', String(count('agent_run'))]] } });
  for (let k = 0; k < Math.min(notes.length, 24); k += 8) {
    slides.push({ kicker: 'Yozuvlar', title: notes.length > 8 ? `Yozuvlar (${k + 1}–${Math.min(k + 8, notes.length)})` : 'Yozuvlar', bullets: notes.slice(k, k + 8).map(n => ({ text: n.note || n.title || '', sub: day(n.createdAt) })) });
  }
  for (const it of items.filter(i => i.kind === 'agent_run')) {
    const r = results[it.ref];
    if (r) slides.push(...runSlides(it, r));
  }
  const chats = items.filter(i => i.kind === 'chat' && i.available !== false);
  if (chats.length) slides.push({ kicker: 'Chatlar', title: 'Bog‘langan chatlar', bullets: chats.slice(0, 8).map(c => ({ text: c.title || 'Chat', sub: day(c.updatedAt || c.createdAt) })) });
  slides.push({ kicker: 'Eslatma', title: 'Bu taqdimot nima', bullets: [
    'Ishda saqlangan yozuvlar va natijalardan yig‘ilgan; yangi xulosa qo‘shilmagan.',
    'AI natijalari (jadval, playbook, loyiha, javob) — yurist tekshiruvi uchun material, yakuniy huquqiy xulosa emas.',
    'Iqtibos tekshiruvi so‘zlar manbada borligini ko‘rsatadi, xulosa to‘g‘riligini emas.'] });
  return slides;
}

async function matterPptx(m, results) {
  return buildPptx({ title: m.title, slides: slidesOf(m, results), footer: m.title });
}

const text = v => ({ t: 's', v: String(v == null ? '' : v).slice(0, 2000) });
function sheet(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa.map(r => r.map(text)));
  ws['!cols'] = widths.map(wch => ({ wch }));
  return ws;
}

/** One workbook: the matter, its items, its notes, and one sheet per table / playbook result. Every cell text, never a formula. */
function matterXlsx(m, results) {
  const wb = XLSX.utils.book_new();
  const items = m.items || [];
  XLSX.utils.book_append_sheet(wb, sheet([['Ish', m.title], ['Holat', m.status === 'closed' ? 'Yopilgan' : 'Ochiq'], ['Qisqacha', m.summary || ''], ['Yangilangan', day(m.updatedAt)], ['Elementlar', String(items.length)]], [16, 90]), 'Ish');
  XLSX.utils.book_append_sheet(wb, sheet([['Turi', 'Nomi', 'Sana', 'Holat'], ...items.map(i => [KIND[i.kind] || i.kind, i.kind === 'note' ? (i.note || '') : (i.title || ''), day(i.createdAt), i.kind === 'agent_run' ? (WF[i.workflow] || i.workflow || '') : (i.available === false ? 'mavjud emas' : '')])], [16, 70, 12, 22]), 'Elementlar');
  let n = 0;
  for (const it of items.filter(i => i.kind === 'agent_run')) {
    const r = results[it.ref];
    if (!r || n >= 20) continue;
    const b = r.body || {};
    if (r.workflow === 'tabular_review' && Array.isArray(b.rows)) {
      const cols = b.columns || [];
      XLSX.utils.book_append_sheet(wb, sheet([['Hujjat', ...cols.map(c => c.label)], ...b.rows.map(row => [row.name, ...cols.map(c => { const x = row.cells && row.cells[c.id]; return row.status !== 'ok' ? 'xato' : (x ? (x.notFound ? 'Topilmadi' : x.answer) : ''); })])], [32, ...cols.map(() => 30)]), `Jadval ${++n}`);
    } else if (r.workflow === 'playbook_review' && Array.isArray(b.results)) {
      XLSX.utils.book_append_sheet(wb, sheet([['Qoida', 'Holat', 'Izoh', 'Shartnomadan', 'Taklif'], ...b.results.map(x => [(x.rule && x.rule.title) || '', PB[x.status] || x.status, x.note || '', x.quote || '', x.suggestion || ''])], [28, 14, 40, 50, 50]), `Playbook ${++n}`);
    }
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

module.exports = { matterPptx, matterXlsx, slidesOf, conclusion };
