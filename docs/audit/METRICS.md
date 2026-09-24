# Metrikalar

## Boshlang'ich holat (`main`, 2026-09-24, Node 22.22.2, konteyner)

| Metrika | Qiymat |
|---------|--------|
| `npm test` | o'tadi (58 + 5), 0.33 s |
| `npm run test:workspace` | 21/21, 0.42 s |
| `npm run test:all` | o'tadi, 2.7 s |
| `tests/*.test.js` fayllari | 32 |
| `npm audit` | 20 zaiflik: 2 critical, 9 high, 8 moderate, 1 low |
| `src/api/server.js` | 10 480 qator |
| `public/dashboard.html` | 17 954 qator |
| Marshrut handlerlari (`src/**`) | ~268 |
| Runtime DDL (CREATE/ALTER) | ~250 |
| CI (PR'da testlar) | yo'q |
| RAG eval | 30 savol, production pipeline'ni o'lchamaydi — ishonchli raqam yo'q |

## Audit PR'lari bo'yicha oldin/keyin

| PR | Test | `main`da | PR'da |
|----|------|----------|-------|
| #326 | `route-authz-contract` | 0/7 | 7/7 |
| #322 | `master-bootstrap` | modul yo'q (yangi) | o'tadi |
| #321 | `telegram-webhook-auth` | modul yo'q (yangi) | o'tadi |
| #320 | `tariff-draft-metering` | 0/5 | 5/5 |
| #319 | `tariff-week-start` | 0/5 | 5/5 |
| #325 | `rag-verified-qa-embedding` | 1/2 | 2/2 |
| #324 | `rag-freshness` | 0/6 | 6/6 |
| #323 | `health-endpoint` | 0/3 | 3/3 |
| #330 | `tariff-expiry-refund` | 2/11 | 11/11 |
| #331 | `tariff-fair-use-weights` | 1/5 | 5/5 |
| #332 | `tariff-ocr-workspace` | 2/10 | 10/10 |
| #333 | `telegram-stars-invoice` | 4/6 | 6/6 |
| #328 | brauzer: murojaat modali XSS payload | 9 ishladi | 0 |

## O'lchash uchun kerak

Retrieval va javob sifatini o'lchash uchun faqat o'qish huquqli
`DATABASE_URL`, korpusga mos embedding kaliti va yurist tekshirgan gold set
kerak (`findings/rag.md`, "Access needed"). Ular berilmaguncha RAG raqamlari
kiritilmaydi.
