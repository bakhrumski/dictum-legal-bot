/* JuristAI — har bir til uchun alohida sahifa yasaydi (SEO).
   Ishlatish (loyiha papkasida):  node tools/build-i18n.js
   - Asosiy (o'zbekcha) sahifalarni faqat ildizdagi *.html fayllarda tahrirlang.
   - Skript ularga matnni oldindan yozib qo'yadi va ru/ hamda en/ papkalarini qaytadan yasaydi.
   - ru/ va en/ ichidagi fayllarni qo'lda tahrirlamang: keyingi ishga tushirishda ustidan yoziladi. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const SITE = 'https://juristai.uz';   // asosiy domen (canonical, hreflang, sitemap uchun)
const NOINDEX = true;                 // ishga tushirishda false qiling: qidiruv tizimlari indekslay boshlaydi
const LANGS = ['uz', 'ru', 'en'];
const LOCALE = { uz: 'uz_UZ', ru: 'ru_RU', en: 'en_US' };
const PAGES = {                       // fayl: [sarlavha kaliti, tavsif kaliti]
  'index.html': ['meta.home.t', 'meta.home.d'],
  'ai-chat.html': ['chat.kicker', 'chat.sub'],
  'hujjat-tahlili.html': ['da.kicker', 'da.sub'],
  'hujjat-tayyorlash.html': ['dr.kicker', 'dr.sub'],
  'workspace.html': ['ws.kicker', 'ws.sub'],
  'advokatlar.html': ['at.kicker', 'at.sub'],
  'tariflar.html': ['nav.pricing', 'price.sub']
};
const FAQ = { 'index.html': ['faq', 7], 'tariflar.html': ['pfaq', 5] };

const ROOT = path.resolve(__dirname, '../public');   // landing sahifalari repodagi public/ ichida
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8'), ctx);
const I18N = ctx.window.I18N;

const escT = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = s => escT(s).replace(/"/g, '&quot;');
const url = (l, f) => SITE + '/' + (l === 'uz' ? '' : l + '/') + (f === 'index.html' ? '' : f);

function render(src, l, file) {
  const d = I18N[l];
  let s = src;
  // matnli elementlar: data-i18n (matn) va data-i18n-html (belgilash bilan)
  s = s.replace(/(<(\w+)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, inner, close) => d[key] === undefined ? m : open + escT(d[key]) + close);
  s = s.replace(/(<(\w+)\b[^>]*?\sdata-i18n-html="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, inner, close) => d[key] === undefined ? m : open + d[key] + close);
  // <html>: til va umumiy fayllar yo'li
  s = s.replace(/<html[^>]*>/, '<html lang="' + l + '"' + (l === 'uz' ? '' : ' data-root="../"') + '>');
  const [tk, dk] = PAGES[file];
  const title = file === 'index.html' ? d[tk] : d[tk] + ' — JuristAI';
  const desc = d[dk] || '';
  s = s.replace(/<title>[\s\S]*?<\/title>/, '<title>' + escT(title) + '</title>');
  if (/<meta name="description"/.test(s)) s = s.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escA(desc) + '">');
  else s = s.replace('</title>', '</title>\n<meta name="description" content="' + escA(desc) + '">');
  s = s.replace(/<meta name="robots" content="[^"]*">\n?/, '');
  // SEO bloki
  let seo = (NOINDEX ? '<meta name="robots" content="noindex">\n' : '') +
    '<link rel="canonical" href="' + url(l, file) + '">\n' +
    LANGS.map(x => '<link rel="alternate" hreflang="' + x + '" href="' + url(x, file) + '">').join('\n') + '\n' +
    '<link rel="alternate" hreflang="x-default" href="' + url('uz', file) + '">\n' +
    '<meta property="og:type" content="website">\n<meta property="og:site_name" content="JuristAI">\n' +
    '<meta property="og:locale" content="' + LOCALE[l] + '">\n' +
    LANGS.filter(x => x !== l).map(x => '<meta property="og:locale:alternate" content="' + LOCALE[x] + '">').join('\n') + '\n' +
    '<meta property="og:url" content="' + url(l, file) + '">\n' +
    '<meta property="og:title" content="' + escA(title) + '">\n<meta property="og:description" content="' + escA(desc) + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">';
  const ld = [];
  if (file === 'index.html') ld.push({ '@context': 'https://schema.org', '@type': 'Organization', name: 'JuristAI', url: SITE + '/',
    sameAs: ['https://www.instagram.com/bakhrom_abdimuminov/', 'https://www.linkedin.com/in/bakhrom-abdimuminov-0a479218a/'] });
  if (FAQ[file]) { const [p, n] = FAQ[file]; const q = []; for (let i = 1; i <= n; i++) if (d[p + '.q' + i]) q.push({ '@type': 'Question', name: d[p + '.q' + i], acceptedAnswer: { '@type': 'Answer', text: d[p + '.a' + i] } });
    ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: l, mainEntity: q }); }
  ld.forEach(o => { seo += '\n<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>'; });
  s = s.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, '<!--seo-->\n' + seo + '\n<!--/seo-->');
  if (l !== 'uz') s = s.replace(/(\s(?:href|src|poster)=")(css|js|img|videos)\//g, '$1../$2/');
  return s;
}

const files = Object.keys(PAGES);
LANGS.forEach(l => { if (l !== 'uz') fs.mkdirSync(path.join(ROOT, l), { recursive: true }); });
files.forEach(f => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  LANGS.forEach(l => fs.writeFileSync(path.join(ROOT, l === 'uz' ? '' : l, f), render(src, l, f)));
});
// sitemap.xml va robots.txt
const sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  files.map(f => LANGS.map(l => '  <url>\n    <loc>' + url(l, f) + '</loc>\n' + LANGS.map(x => '    <xhtml:link rel="alternate" hreflang="' + x + '" href="' + url(x, f) + '"/>').join('\n') + '\n  </url>').join('\n')).join('\n') + '\n</urlset>\n';
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sm);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE + '/sitemap.xml\n');
console.log('Tayyor: ' + files.length + ' sahifa x ' + LANGS.length + ' til' + (NOINDEX ? ' (noindex hali yoqilgan)' : ''));
