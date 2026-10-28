# Agent baholash to'plami (PR-G, 2026-10-28)

Yo'l xaritasi: `docs/roadmap/legora-darajasi.md`, 1-bosqich, PR-G.

Reja tuzuvchi agentning (`planned` run) javoblari qanchalik to'g'ri ekanini
raqam bilan ko'rsatish uchun yaratilgan. Legora bu raqamni ko'rsatmaydi, biz
ko'rsata olamiz. Ammo bu raqam faqat **yurist ko'rib chiqqan** holatlar uchun
ma'noga ega.

## Tarkibi

| Fayl | Nima |
|---|---|
| `docs/quality/agent-eval/cases.json` | 24 ta sintetik holat: topshiriq, kutilgan aktlar, aytilishi shart (`mustSay`) va aytilmasligi kerak (`mustNotSay`) gaplar, agent savol berishi kerakmi (`askUser`), savolga javob (`answer`), `reviewed` |
| `scripts/lib/agent-eval-score.js` | Baholovchi. AI'siz, tarmoqsiz ishlaydi |
| `scripts/agent-eval.js` | Runner. Standart rejimi dry: tarmoq yo'q |
| `tests/agent-eval.test.js` | Fayl, baholovchi va runner'ni stub server bilan tekshiradi. CI'da `test:all` ichida ishlaydi |

## Tekshiruvlar (har holat uchun)

- **`delivered`:** run `done` holatida tugadi va javob bor.
- **`asked`:** agent faqat holat kutganda savol berdi (`ask_user`).
- **`acts`:** kutilgan har bir akt manbalar orasida bor. Akt sarlavhadagi so'zlar yoki lex.uz hujjat id'si bo'yicha topiladi.
- **`structure`:** javobda **Tahlil** va **Xulosa** bor.
- **`must_say` / `must_not_say`:** kutilgan gaplar javobda bor, taqiqlanganlari yo'q. Bu yerda `a|b` "a yoki b" degani.
- **`verification`:** server tekshiruvi. `verified` yoki `no_claims` → o'tdi, `partial` → ogohlantirish, `unverified` yoki tekshiruv yo'q → xato.

Akt yoki gap topilgani faqat **so'zlar bor** ekanini bildiradi. Javob
huquqiy jihatdan to'g'ri yoki noto'g'riligini faqat yurist aytadi.

## Yurist ko'rib chiqishi (keyingi qadam)

Barcha 24 holat hozir `"reviewed": false`. Yurist har bir holat uchun:
1. topshiriqni tekshiradi, kerak bo'lsa aniqlashtiradi;
2. kutilgan aktlarni tasdiqlaydi yoki o'zgartiradi, moddalarni qo'shadi
   (moddalar hozircha qo'yilmagan, taxmin qilinmadi);
3. `mustSay` / `mustNotSay` ni to'ldiradi: masalan, muddatlar, organ,
   istisno;
4. holatni `"reviewed": true, "reviewer": "<ism>", "reviewedAt": "<sana>"`
   deb belgilaydi.

Hisobotda ko'rib chiqilgan va ko'rib chiqilmagan holatlar alohida
sanaladi. Ko'rib chiqilmaganlari faqat texnik signal beradi.

## Ishga tushirish

**Dry rejim** (tarmoq yo'q). Holatlar faylini tekshiradi, run sha'ni va
maksimal narxni chiqaradi:

```bash
node scripts/agent-eval.js                 # hamma holat
node scripts/agent-eval.js --only A01,A05  # tanlangan holatlar
```

**Jonli rejim.** Ishlab turgan serverning o'z API'si orqali master sessiyasi
bilan ishlaydi. Har bir AI chaqiruvini server o'zi o'lchaydi, cheklaydi va
yozadi (har run $1 / 15 daqiqa / 60 chaqiruv). Shart: egasi dry rejim
chiqargan sha'ni tasdiqlaydi. Sha holatlar, bazaviy URL va holatlar sonini
qamraydi.

```bash
AGENT_EVAL_LIVE=yes AGENT_EVAL_COOKIE='<master sessiya cookie>' \
  node scripts/agent-eval.js --live --base https://juristai.uz --approve <runSha> --out <repo tashqarisidagi papka>
```

Hisobot (`agent-eval-<sana>.json` va `.md`) javoblar va manbalarni o'z
ichiga oladi. U repodan tashqarida saqlanadi.

## Narx

Har bir holat ko'pi bilan ikki run oladi (savol bo'lsa qolgan qadamlar
yana ishlaydi). Dry rejim chiqaradigan `maxUsd` = holatlar × 2 × `AGENT_RUN_MAX_COST_USD`
($1). Bu yuqori chegara, kutilgan narx emas. Haqiqiy narx serverdagi
"AI so'rovlar" panelida ko'rinadi (har run o'z `request_id`si bilan).
Master hisobidan ishlaganda tarif birligi yechilmaydi, faqat AI narxi
ketadi.
