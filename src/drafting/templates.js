'use strict';

/**
 * Legal Document Drafting — Template Library
 *
 * Data-driven templates so the lawyer team can add/extend documents without
 * touching the rendering engine. Each template is:
 *
 *   {
 *     id:          unique slug
 *     name:        { uz, ru }  — display name
 *     category:    legal category slug (matches RAG categories)
 *     description: { uz, ru }
 *     lang:        primary body language ('uz' | 'ru')
 *     fields:      [ { key, label:{uz,ru}, type, placeholder:{uz,ru}, aiHint, required } ]
 *     body:        HTML string with {{key}} placeholders
 *   }
 *
 * Field types: 'text' | 'textarea' | 'date' | 'number' | 'select'
 *   - select fields carry an `options: [{value,label:{uz,ru}}]`
 *
 * `aiHint` is a short instruction passed to the LLM when the user clicks
 * "AI tavsiya" (AI suggest) on a field — describes what a good value looks like.
 *
 * To add a template: append an object to TEMPLATES. No other code changes needed.
 */

const TEMPLATES = [
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Da'vo arizasi (Statement of Claim) — Civil
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'davo-arizasi',
    name: { uz: "Da'vo arizasi", ru: 'Исковое заявление' },
    category: 'fuqarolik',
    lang: 'uz',
    description: {
      uz: "Fuqarolik ishi bo'yicha sudga beriladigan da'vo arizasi",
      ru: 'Исковое заявление в суд по гражданскому делу',
    },
    fields: [
      { key: 'court_name', label: { uz: 'Sud nomi', ru: 'Наименование суда' }, type: 'text', required: true,
        placeholder: { uz: "Toshkent shahar ... tumani fuqarolik ishlari bo'yicha sudi", ru: 'Ташкентский ... районный суд по гражданским делам' },
        aiHint: 'Provide the full official name of the competent civil court based on the parties\' location.' },
      { key: 'plaintiff_name', label: { uz: "Da'vogar (F.I.O.)", ru: 'Истец (Ф.И.О.)' }, type: 'text', required: true,
        placeholder: { uz: 'Familiya Ism Otasining ismi', ru: 'Фамилия Имя Отчество' } },
      { key: 'plaintiff_address', label: { uz: "Da'vogar manzili", ru: 'Адрес истца' }, type: 'text', required: true,
        placeholder: { uz: "To'liq yashash manzili, telefon", ru: 'Полный адрес проживания, телефон' } },
      { key: 'defendant_name', label: { uz: 'Javobgar (F.I.O. / tashkilot)', ru: 'Ответчик (Ф.И.О. / организация)' }, type: 'text', required: true,
        placeholder: { uz: 'Javobgarning to\'liq nomi', ru: 'Полное наименование ответчика' } },
      { key: 'defendant_address', label: { uz: 'Javobgar manzili', ru: 'Адрес ответчика' }, type: 'text', required: true,
        placeholder: { uz: "To'liq manzil", ru: 'Полный адрес' } },
      { key: 'claim_amount', label: { uz: "Da'vo summasi (so'm)", ru: 'Цена иска (сум)' }, type: 'text', required: false,
        placeholder: { uz: 'Masalan: 15 000 000', ru: 'Например: 15 000 000' } },
      { key: 'circumstances', label: { uz: 'Ish holatlari', ru: 'Обстоятельства дела' }, type: 'textarea', required: true,
        placeholder: { uz: 'Nima sodir bo\'lganini batafsil bayon qiling', ru: 'Подробно изложите, что произошло' },
        aiHint: 'Draft a clear, chronological statement of the facts of the dispute in formal legal Uzbek, suitable for a statement of claim.' },
      { key: 'legal_grounds', label: { uz: 'Huquqiy asoslar', ru: 'Правовые основания' }, type: 'textarea', required: true,
        placeholder: { uz: "Tegishli kodeks moddalari va qonunlar", ru: 'Соответствующие статьи кодексов и законов' },
        aiHint: 'List the relevant articles of the Civil Code of Uzbekistan and other laws that support the claim, with brief explanation. Cite exact article numbers.' },
      { key: 'demands', label: { uz: 'So\'rov (talablar)', ru: 'Просительная часть (требования)' }, type: 'textarea', required: true,
        placeholder: { uz: 'Suddan nimani so\'raysiz', ru: 'Что вы просите у суда' },
        aiHint: 'Draft the numbered demands (prayer for relief) the plaintiff asks the court to grant, in formal legal Uzbek.' },
      { key: 'date', label: { uz: 'Sana', ru: 'Дата' }, type: 'date', required: true,
        placeholder: { uz: '', ru: '' } },
    ],
    body: `
<h1 style="text-align:right;font-size:13px;font-weight:normal;margin:0 0 18px">{{court_name}}ga</h1>
<p style="text-align:right;margin:0 0 4px"><strong>Da'vogar:</strong> {{plaintiff_name}}</p>
<p style="text-align:right;margin:0 0 4px">{{plaintiff_address}}</p>
<p style="text-align:right;margin:0 0 4px"><strong>Javobgar:</strong> {{defendant_name}}</p>
<p style="text-align:right;margin:0 0 12px">{{defendant_address}}</p>
<p style="text-align:right;margin:0 0 24px"><strong>Da'vo summasi:</strong> {{claim_amount}} so'm</p>
<h2 style="text-align:center;font-size:15px;margin:0 0 20px">DA'VO ARIZASI</h2>
<p style="text-align:justify;margin:0 0 14px">{{circumstances}}</p>
<p style="text-align:justify;margin:0 0 14px">{{legal_grounds}}</p>
<p style="margin:0 0 8px"><strong>Yuqoridagilarga asoslanib, suddan SO'RAYMAN:</strong></p>
<p style="text-align:justify;margin:0 0 24px">{{demands}}</p>
<p style="margin:0 0 4px">Sana: {{date}}</p>
<p style="margin:0">Da'vogar imzosi: ______________ ({{plaintiff_name}})</p>
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Mehnat shartnomasi (Employment Contract) — Labor
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'mehnat-shartnomasi',
    name: { uz: 'Mehnat shartnomasi', ru: 'Трудовой договор' },
    category: 'mehnat',
    lang: 'uz',
    description: {
      uz: 'Ish beruvchi va xodim o\'rtasidagi mehnat shartnomasi',
      ru: 'Трудовой договор между работодателем и работником',
    },
    fields: [
      { key: 'city', label: { uz: 'Shahar', ru: 'Город' }, type: 'text', required: true, placeholder: { uz: 'Toshkent', ru: 'Ташкент' } },
      { key: 'date', label: { uz: 'Sana', ru: 'Дата' }, type: 'date', required: true, placeholder: { uz: '', ru: '' } },
      { key: 'employer_name', label: { uz: 'Ish beruvchi (tashkilot)', ru: 'Работодатель (организация)' }, type: 'text', required: true,
        placeholder: { uz: '"..." MChJ', ru: 'ООО "..."' } },
      { key: 'employer_rep', label: { uz: 'Ish beruvchi vakili (F.I.O., lavozim)', ru: 'Представитель работодателя (Ф.И.О., должность)' }, type: 'text', required: true,
        placeholder: { uz: 'direktor Familiya Ism', ru: 'директор Фамилия Имя' } },
      { key: 'employee_name', label: { uz: 'Xodim (F.I.O.)', ru: 'Работник (Ф.И.О.)' }, type: 'text', required: true,
        placeholder: { uz: 'Familiya Ism Otasining ismi', ru: 'Фамилия Имя Отчество' } },
      { key: 'employee_passport', label: { uz: 'Xodim passport ma\'lumotlari', ru: 'Паспортные данные работника' }, type: 'text', required: true,
        placeholder: { uz: 'AA 1234567, ... tomonidan berilgan', ru: 'AA 1234567, выдан ...' } },
      { key: 'position', label: { uz: 'Lavozim', ru: 'Должность' }, type: 'text', required: true, placeholder: { uz: 'Buxgalter', ru: 'Бухгалтер' } },
      { key: 'salary', label: { uz: 'Oylik ish haqi (so\'m)', ru: 'Месячная заработная плата (сум)' }, type: 'text', required: true,
        placeholder: { uz: '5 000 000', ru: '5 000 000' } },
      { key: 'start_date', label: { uz: 'Ishga kirish sanasi', ru: 'Дата начала работы' }, type: 'date', required: true, placeholder: { uz: '', ru: '' } },
      { key: 'term', label: { uz: 'Shartnoma muddati', ru: 'Срок договора' }, type: 'select', required: true,
        options: [
          { value: 'nomuddatli', label: { uz: 'Muddatsiz', ru: 'Бессрочный' } },
          { value: 'muddatli', label: { uz: 'Muddatli (1 yil)', ru: 'Срочный (1 год)' } },
        ] },
      { key: 'duties', label: { uz: 'Asosiy vazifalar', ru: 'Основные обязанности' }, type: 'textarea', required: false,
        placeholder: { uz: 'Xodimning asosiy mehnat vazifalari', ru: 'Основные трудовые обязанности работника' },
        aiHint: 'Draft a concise list of typical job duties for the given position, in formal Uzbek, consistent with the Labor Code of Uzbekistan.' },
    ],
    body: `
<h2 style="text-align:center;font-size:15px;margin:0 0 4px">MEHNAT SHARTNOMASI</h2>
<table style="width:100%;border:none;margin:0 0 20px"><tr>
  <td style="text-align:left;border:none">{{city}}</td>
  <td style="text-align:right;border:none">{{date}}</td>
</tr></table>
<p style="text-align:justify;margin:0 0 14px">Bir tomondan, {{employer_name}} nomidan {{employer_rep}} (keyingi o'rinlarda — "Ish beruvchi") va ikkinchi tomondan, {{employee_name}}, passport {{employee_passport}} (keyingi o'rinlarda — "Xodim"), quyidagilar haqida ushbu shartnomani tuzdilar:</p>
<p style="margin:0 0 6px"><strong>1. Shartnoma predmeti</strong></p>
<p style="text-align:justify;margin:0 0 12px">1.1. Xodim <strong>{{position}}</strong> lavozimiga qabul qilinadi. Ishga kirish sanasi: {{start_date}}. Shartnoma turi: {{term}}.</p>
<p style="text-align:justify;margin:0 0 12px">1.2. Xodimning vazifalari: {{duties}}</p>
<p style="margin:0 0 6px"><strong>2. Mehnatga haq to'lash</strong></p>
<p style="text-align:justify;margin:0 0 12px">2.1. Xodimga oylik ish haqi miqdori {{salary}} so'm etib belgilanadi. Ish haqi O'zbekiston Respublikasi Mehnat kodeksiga muvofiq to'lanadi.</p>
<p style="margin:0 0 6px"><strong>3. Yakuniy qoidalar</strong></p>
<p style="text-align:justify;margin:0 0 24px">3.1. Ushbu shartnoma tomonlar tomonidan imzolangan kundan kuchga kiradi va Mehnat kodeksi bilan tartibga solinadi. Shartnoma ikki nusxada tuzildi.</p>
<table style="width:100%;border:none;margin-top:30px"><tr>
  <td style="border:none;vertical-align:top"><strong>Ish beruvchi:</strong><br>{{employer_name}}<br>______________ ({{employer_rep}})</td>
  <td style="border:none;vertical-align:top"><strong>Xodim:</strong><br>{{employee_name}}<br>______________</td>
</tr></table>
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Договор оказания услуг (Services Agreement) — Russian, Business
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'dogovor-uslug',
    name: { uz: 'Xizmat ko\'rsatish shartnomasi', ru: 'Договор оказания услуг' },
    category: 'shartnoma',
    lang: 'ru',
    description: {
      uz: 'Pullik xizmat ko\'rsatish bo\'yicha shartnoma (rus tilida)',
      ru: 'Договор возмездного оказания услуг',
    },
    fields: [
      { key: 'city', label: { uz: 'Shahar', ru: 'Город' }, type: 'text', required: true, placeholder: { uz: 'Toshkent', ru: 'Ташкент' } },
      { key: 'date', label: { uz: 'Sana', ru: 'Дата' }, type: 'date', required: true, placeholder: { uz: '', ru: '' } },
      { key: 'customer', label: { uz: 'Buyurtmachi', ru: 'Заказчик' }, type: 'text', required: true, placeholder: { uz: '', ru: 'ООО "..." в лице ...' } },
      { key: 'contractor', label: { uz: 'Ijrochi', ru: 'Исполнитель' }, type: 'text', required: true, placeholder: { uz: '', ru: 'ИП / ООО "..." в лице ...' } },
      { key: 'services', label: { uz: 'Xizmatlar tavsifi', ru: 'Описание услуг' }, type: 'textarea', required: true,
        placeholder: { uz: '', ru: 'Перечень и характеристики оказываемых услуг' },
        aiHint: 'Draft a clear description of the services to be rendered, in formal Russian, suitable for a services agreement under Uzbek civil law.' },
      { key: 'price', label: { uz: 'Narx (so\'m)', ru: 'Стоимость (сум)' }, type: 'text', required: true, placeholder: { uz: '', ru: '10 000 000' } },
      { key: 'term', label: { uz: 'Muddat', ru: 'Срок оказания услуг' }, type: 'text', required: true, placeholder: { uz: '', ru: 'до 31.12.2026' } },
    ],
    body: `
<h2 style="text-align:center;font-size:15px;margin:0 0 4px">ДОГОВОР ОКАЗАНИЯ УСЛУГ</h2>
<table style="width:100%;border:none;margin:0 0 20px"><tr>
  <td style="text-align:left;border:none">г. {{city}}</td>
  <td style="text-align:right;border:none">{{date}}</td>
</tr></table>
<p style="text-align:justify;margin:0 0 14px">{{customer}}, именуемый в дальнейшем «Заказчик», с одной стороны, и {{contractor}}, именуемый в дальнейшем «Исполнитель», с другой стороны, заключили настоящий договор о нижеследующем:</p>
<p style="margin:0 0 6px"><strong>1. Предмет договора</strong></p>
<p style="text-align:justify;margin:0 0 12px">1.1. Исполнитель обязуется оказать следующие услуги: {{services}}</p>
<p style="text-align:justify;margin:0 0 12px">1.2. Срок оказания услуг: {{term}}.</p>
<p style="margin:0 0 6px"><strong>2. Стоимость и порядок расчётов</strong></p>
<p style="text-align:justify;margin:0 0 12px">2.1. Стоимость услуг составляет {{price}} сум. Оплата производится в порядке, установленном законодательством Республики Узбекистан.</p>
<p style="margin:0 0 6px"><strong>3. Заключительные положения</strong></p>
<p style="text-align:justify;margin:0 0 24px">3.1. Настоящий договор вступает в силу с момента подписания и регулируется Гражданским кодексом Республики Узбекистан. Договор составлен в двух экземплярах.</p>
<table style="width:100%;border:none;margin-top:30px"><tr>
  <td style="border:none;vertical-align:top"><strong>Заказчик:</strong><br>{{customer}}<br>______________</td>
  <td style="border:none;vertical-align:top"><strong>Исполнитель:</strong><br>{{contractor}}<br>______________</td>
</tr></table>
`,
  },
];

const BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/** Lightweight list for the picker (no body). */
function listTemplates() {
  return TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    lang: t.lang,
    description: t.description,
    fieldCount: t.fields.length,
  }));
}

/** Full template by id (includes fields + body). */
function getTemplate(id) {
  return BY_ID[id] || null;
}

/**
 * Render a template body by substituting {{key}} placeholders with values.
 * Missing values are replaced with a blank underline so the doc stays usable.
 */
function renderTemplate(template, values = {}) {
  return template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = values[key];
    if (v == null || String(v).trim() === '') return '__________';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  });
}

module.exports = { TEMPLATES, listTemplates, getTemplate, renderTemplate };
