/* ============================================================
   Demo fixtures for the redesigned application shell.

   TODO: connect to API. Every array below is placeholder content carried
   over from the design prototype so the sections can be built and reviewed
   before the endpoints they belong to are wired up. This file is meant to
   be deleted whole once each section reads live data — nothing else should
   grow to depend on its shape.
   ============================================================ */
window.DB_DATA = {

  /* -- Asosiy -------------------------------------------------
     TODO: connect to API — the queue counters. Each becomes a filter,
     and the bars are scaled against the largest of the four. */
  stateBits: [
    { n: 7, label: "SLA'dan oshgan", view: 'overdue', tone: 'var(--danger)' },
    { n: 12, label: 'tayinlanmagan', view: 'unassigned', tone: 'var(--warn)' },
    { n: 9, label: 'yurist qaroriga', view: 'review', tone: 'var(--brand)' },
    { n: 34, label: 'bugun yakunlandi', view: 'priority', tone: 'var(--ok)' }
  ],

  /* TODO: connect to API — service health. */
  health: [
    { label: 'Telegram agent', value: 'Ishlayapti', color: 'var(--ok)' },
    { label: 'Huquqiy korpus', value: 'Sinxron', color: 'var(--ok)' },
    { label: 'Jamoa navbati', value: 'Yuklangan', color: 'var(--warn)' }
  ],

  views: [
    ['priority', 'Muhim'], ['overdue', "SLA o'tgan"], ['unassigned', 'Tayinlanmagan'],
    ['review', 'Tekshiruv'], ['paid', 'Pullik xizmatlar'], ['attorney', "Advokat so'ralgan"]
  ],

  summary: {
    priority: '',
    overdue: "SLA muddati o'tgan murojaatlar",
    unassigned: 'Egasi belgilanmagan murojaatlar',
    review: 'Yurist qarori kutilayotgan javoblar',
    paid: "Pullik hujjat so'rovlari",
    attorney: "Advokat so'ralgan murojaatlar"
  },

  /* TODO: connect to API — the queue itself. The prototype shows the same
     five rows under every filter; a real endpoint would return the rows the
     selected view asks for. */
  rows: [
    { title: "Ish beruvchi ish haqini uch oydan beri to'lamayapti, qanday chora ko'rsam bo'ladi?", category: 'Mehnat va bandlik · Ish haqi', channel: 'Telegram', assignee: 'Sardor N.', person: 'Dilnoza M.', username: '@dilnoza_m', age: '5 soat', time: '09:12', urgency: 'high', status: 'Tekshiruvda' },
    { title: 'Uy-joyni sotib olishda notarial shartnoma majburiymi?', category: 'Fuqarolik qonunchiligi · Mulk', channel: 'Platforma', assignee: 'Tayinlanmagan', person: 'Sarvar T.', username: '@sarvar_t', age: '2 soat', time: '12:40', urgency: 'medium', status: 'Navbatda' },
    { title: "Nikohdan ajralishda bola bilan ko'rishish tartibi qanday belgilanadi?", category: 'Oila qonunchiligi', channel: 'Telegram', assignee: 'Nilufar R.', person: 'Baxrom A.', username: '@bakhrom', age: '26 daqiqa', time: '14:18', urgency: 'high', status: 'Yurist javobi' },
    { title: "Yakka tartibdagi tadbirkor uchun soliq stavkasi 2026 yilda o'zgardimi?", category: 'Soliq', channel: 'Platforma', assignee: 'Tayinlanmagan', person: 'Kamola S.', username: '@kamola', age: '1 kun', time: 'Kecha 17:02', urgency: 'low', status: 'Yakunlandi' },
    { title: 'Shartnomani bir tomonlama bekor qilish uchun asos yetarlimi?', category: 'Fuqarolik qonunchiligi · Shartnoma', channel: 'Telegram', assignee: 'Sardor N.', person: 'Jasur X.', username: 'Telegram foydalanuvchisi', age: '3 soat', time: '11:26', urgency: 'medium', status: 'Pullik hujjat' }
  ],

  urgency: { high: 'var(--danger)', medium: 'var(--warn)', low: 'var(--ok)' },

  statusStyle: {
    'Tekshiruvda': ['var(--warn)', 'rgba(217,119,6,.10)', 'rgba(217,119,6,.30)'],
    'Navbatda': ['var(--muted)', 'transparent', 'var(--line)'],
    'Yurist javobi': ['var(--brand)', 'var(--brand-soft)', 'var(--brand-border)'],
    'Yakunlandi': ['var(--ok)', 'rgba(15,157,110,.10)', 'rgba(15,157,110,.28)'],
    'Pullik hujjat': ['var(--warn)', 'rgba(217,119,6,.10)', 'rgba(217,119,6,.30)']
  },

  /* -- Workspace ----------------------------------------------
     TODO: connect to API — the workspace's members and matters. The graph
     lays these out, so ids matter: every matter's owner field must name a
     member, and the layout groups matters under the member who owns them. */
  wsMembers: [
    { id: 'u1', name: 'Bakhrom Abdimuminov', init: 'BA', role: 'Egasi · Platinum', owner: true },
    { id: 'u2', name: 'Sardor Nazarov', init: 'SN', role: 'Katta yurist' },
    { id: 'u3', name: 'Nilufar Rasulova', init: 'NR', role: 'Yurist' }
  ],

  matters: [
    { id: 'm1', title: 'Mehnat shartnomasi xulosasi', due: 'Rejada · 31.08.2026', tag: 'Muhim bosqich', docs: 3, tone: 'ok', owner: 'u1', start: 0, span: 4, state: 'Ishda' },
    { id: 'm2', title: "Da'vo arizasi loyihasi", due: 'Muddat · 04.09.2026', tag: "Ko'rikda", docs: 1, tone: 'soon', owner: 'u1', start: 3, span: 5, state: 'Tekshiruvda' },
    { id: 'm3', title: 'Notarial shartnoma javobi', due: 'Kechikdi · 28.08.2026', tag: 'SLA', docs: 2, tone: 'late', owner: 'u2', start: 0, span: 2, state: "SLA o'tgan" },
    { id: 'm4', title: 'YaTT soliq hisoboti', due: 'Rejada · 06.09.2026', tag: 'Tahlil', docs: 4, tone: 'ok', owner: 'u2', start: 5, span: 4, state: 'Ishda' },
    { id: 'm5', title: "Bola bilan ko'rishish tartibi", due: 'Muddat · 03.09.2026', tag: 'Ariza', docs: 1, tone: 'soon', owner: 'u3', start: 2, span: 3, state: 'Navbatda' }
  ],

  /* Card and avatar sizes the graph's layout and collision pass work in. */
  graphSizes: { CARD_W: 168, CARD_H: 158, NODE_W: 152, NODE_H: 98 },

  tone: { ok: 'var(--ok)', soon: 'var(--warn)', late: 'var(--danger)' },
  wsLegend: [['Muddatida', 'ok'], ['Muddat yaqin', 'soon'], ["Muddati o'tgan", 'late']],
  wsDays: ['01.09', '03.09', '05.09', '07.09', '09.09', '11.09'],
  wsViews: [
    { id: 'list', label: "Ro'yxat", icon: ['M8 6h13M8 12h13M8 18h13', 'M3 6h.01M3 12h.01M3 18h.01'] },
    { id: 'timeline', label: 'Vaqt jadvali', icon: ['M3 7h9M3 12h14M3 17h6'] },
    { id: 'graph', label: 'Grafik', icon: ['M5 5h5v5H5zM14 14h5v5h-5z', 'M10 7.5h4a2 2 0 0 1 2 2V14'] }
  ],

  /* TODO: connect to API — per-member open work and load. */
  wsTeam: [
    { name: 'Sardor Nazarov', init: 'SN', role: 'Katta yurist', load: 82, open: 9 },
    { name: 'Nilufar Rasulova', init: 'NR', role: 'Yurist', load: 64, open: 7 },
    { name: 'Jamshid Umarov', init: 'JU', role: 'Yurist', load: 41, open: 4 },
    { name: "Malika Yo'ldosheva", init: 'MY', role: 'Student', load: 23, open: 2 }
  ],

  /* TODO: connect to API — document drafts. */
  wsDrafts: [
    { name: 'Mehnat shartnomasi — loyiha', meta: 'AI tayyorladi · 3 daqiqa oldin', state: "Yurist ko'rigi kutilmoqda" },
    { name: "Da'vo arizasi (ish haqi)", meta: 'Sardor N. · 1 soat oldin', state: 'Tahrirda' },
    { name: 'Ijara shartnomasi tahlili', meta: 'AI tayyorladi · bugun 08:40', state: 'Tasdiqlangan' }
  ],

  /* TODO: connect to API — AI threads, and the token accounting shown with
     them. The scope field splits the team feed from a member's own history. */
  aiThreads: [
    { id: 't1', q: 'Ish haqi kechiktirilganda kompensatsiya qanday hisoblanadi?', scope: 'team', by: 'u2', matter: 'm1', cost: 1240, when: '09:24' },
    { id: 't2', q: "Notarial shartnoma majburiy bo'lgan holatlar ro'yxati", scope: 'team', by: 'u3', matter: 'm3', cost: 980, when: 'Kecha' },
    { id: 't3', q: "Da'vo arizasiga qanday dalillar ilova qilinadi?", scope: 'team', by: 'u1', matter: 'm2', cost: 1510, when: 'Kecha' },
    { id: 't4', q: 'YaTT uchun soliq hisobotini kim topshiradi?', scope: 'personal', by: 'u1', matter: null, cost: 620, when: '08:10' },
    { id: 't5', q: 'Mehnat shartnomasini bekor qilish tartibi', scope: 'personal', by: 'u1', matter: null, cost: 430, when: '31.08' }
  ],

  /* -- Chat ---------------------------------------------------
     TODO: connect to API — the group thread and the private thread. The
     me flag decides which side a message sits on and which accent it
     takes; group and private carry different ones by design. */
  chatModes: [
    { id: 'both', label: 'Ikkisi' },
    { id: 'group', label: 'Guruh' },
    { id: 'private', label: 'Shaxsiy' }
  ],

  groupMsgs: [
    { who: 'Nilufar R.', init: 'NR', time: '09:12', txt: "Ish haqi kechikishi bo'yicha yangi murojaat keldi — MK 333-modda asosida javob tayyorlayapman." },
    { who: 'Sardor N.', init: 'SN', time: '09:18', txt: "Kompensatsiya hisobini ilova qil, foydalanuvchi aniq summani so'ragan." },
    { who: 'Siz', init: 'SZ', time: '09:24', me: true, txt: "Korpusda 2026 yil tahriri bor, havolani qo'shdim." },
    { who: 'Nilufar R.', init: 'NR', time: '09:26', txt: 'Rahmat. Tekshiruvga yuboraman.' }
  ],

  privMsgs: [
    { time: '10:02', txt: "Notarial shartnoma bo'yicha murojaatni senga tayinladim." },
    { time: '10:05', me: true, txt: "Ko'rdim, bugun tushdan keyin javob beraman." },
    { time: '10:06', txt: 'SLA 4 soat — ulgurasanmi?' },
    { time: '10:07', me: true, txt: "Ha, korpusdan modda topildi. Loyihani tayyorlab qo'ydim." }
  ],
  /* -- AI ------------------------------------------------------
     TODO: connect to API. A personal thread is the member's own; a team
     thread is billed to the workspace and visible to everyone in it. */
  aiScopes: [
    { id: 'personal', label: 'Shaxsiy', short: 'Shaxsiy', sub: "Faqat siz ko'rasiz" },
    { id: 'team', label: 'juristAI jamoasi', short: 'Jamoa', sub: "Jamoa ko'radi · workspace hisobidan" }
  ],

  /* TODO: connect to API — the workspace's token allowance and usage. */
  wsBudget: { used: 18400, limit: 40000 },

  hdrDd: ['Navbat', 'Korpus', 'Jamoa', 'Hisobot'],

  starters: [
    { h: 'Mehnat shartnomasi', sub: 'Bekor qilish tartibi', icon: [['rect', { x: 4, y: 5, width: 16, height: 15, rx: 2 }], ['path', { d: 'M9 5V3h6v2M8 10h8M8 14h5' }]] },
    { h: 'Jarimani tekshirish', sub: 'Miqdor va asoslar', icon: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]] },
    { h: 'Shartnomani tahlil qilish', sub: 'Xavfli bandlarni topish', icon: [['path', { d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z' }], ['path', { d: 'M14 3v6h6M8 14h8M8 17h5' }]] },
    { h: 'Ariza tayyorlash', sub: 'Loyiha tuzish', icon: [['path', { d: 'M12 20h9' }], ['path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z' }]] }
  ],

  topics: [
    'Advokatura. Notariat. Adliya', 'Axborot', 'Bank', 'Davlat boshqaruvi', 'Ekologiya',
    'Fuqarolik qonunchiligi', 'Ijtimoiy himoya', 'Jinoyat qonunchiligi', 'Konstitutsiyaviy tuzum',
    "Ma'muriy javobgarlik", 'Mehnat va bandlik', 'Moliya va kredit', 'Mudofaa', 'Odil sudlov',
    'Oila qonunchiligi', 'Shaxsiy hujjatlar', "Sog'liqni saqlash", 'Soliq', "Ta'lim. Fan. Madaniyat",
    'Tadbirkorlik', 'Tashqi iqtisod. Bojxona', "Uy-joy qonunchiligi", 'Xalqaro huquq', "Yo'l-harakati qoidalari"
  ],

  /* -- Boshqaruv ----------------------------------------------
     TODO: connect to API — the counts are pending items per area. */
  mgmt: [
    { label: 'Qabul', sub: 'Advokat va student arizalari', count: 6, target: 'reg' },
    { label: 'Advokatlar', sub: 'Tekshiruv va katalog', count: 4, target: 'attorney' },
    { label: 'Pullik xizmatlar', sub: 'Hujjat buyurtmalari va narxlar', count: 2, target: 'paid' },
    { label: 'Telegram agent', sub: "24/7 suhbatlar va operator rejimi", count: 9, target: 'telegram' },
    { label: 'Sifat', sub: 'Javob xatolari va tekshiruv', target: 'quality' },
    { label: 'Korpus', sub: "Bo'shliqlar va yangi manbalar", target: 'corpus' },
    { label: 'Xavfsizlik', sub: 'Audit va muhim hodisalar', target: 'audit' },
    { label: 'Xarajat', sub: 'AI token va API sarfi', target: 'spend' }
  ],

  mgmtSections: [
    { id: 'reg', h: 'Qabul arizalari', badge: '6 kutilmoqda', kanban: ['Yangi', "Ko'rib chiqilmoqda", 'Yakunlangan'] },
    { id: 'attorney', h: 'Advokatlar katalogi', note: "Profil faqat litsenziya rasmiy reyestrdan tekshirilgandan keyin e'lon qilinadi." },
    { id: 'paid', h: 'Pullik hujjat xizmatlari', note: "Telegram agent narx o'ylab topmaydi. Faqat shu katalogda saqlangan narxlar ishlatiladi va har bir buyurtma yurist tasdig'ini kutadi." },
    { id: 'telegram', h: 'Telegram agent suhbatlari', note: "Avtomatik rejim huquqiy savollarni platforma orqali javoblaydi. Murakkab holatda suhbatni operator rejimiga o'tkazib, keyin yana agentga qaytarish mumkin." },
    { id: 'quality', h: 'Javob xatolari', badge: '3 kutilmoqda', note: "Foydalanuvchilar javobning noto'g'ri qismini belgilab yuborgan xabarlar. Har biri grammatik yoki mazmun xatosi sifatida belgilangan; taklif bo'lsa, u ham ko'rsatiladi." },
    { id: 'corpus', h: 'Korpus qamrovi', note: "Foydalanuvchi savollari bo'yicha korpusdan yetarlicha qonun topilmagan holatlar. Bu ro'yxat qaysi sohalar va savollarni lex.uz dan boyitish kerakligini ko'rsatadi. (Hech qanday matn yaratilmaydi — faqat o'lchov.)", control: { label: 'Davr:', options: ['7 kun', '30 kun', '90 kun'], selected: 1 } },
    { id: 'audit', h: 'Audit jurnali', note: "Kim qachon qaysi mijoz ma'lumotiga kirgani va kirish (login/2FA) hodisalari. Maxfiylik nazorati uchun — har bir murojaat ko'rish, fayl ochish va korpus o'zgarishi qayd etiladi." },
    { id: 'spend', h: 'API xarajatlari', note: 'Barcha AI so’rovlari (chat, yuridik xulosa, tushuntirish, OCR) bo’yicha real token va xarajat hisoboti. Faqat Master Admin ko’radi.', control: { label: 'Oy:', options: ['2026-06', '2026-07', '2026-08'], selected: 2 } }
  ],
  /* -- AI drawer ----------------------------------------------
     TODO: connect to API. These are the canned answers the drawer's quick
     actions return. "Hujjat loyihasi" is per-matter and returns an editable
     draft rather than a chat reply, which is why it widens the drawer. */
  quick: [
    {
      id: 'sum', label: 'Xulosa tayyorla', q: "Shu masala bo'yicha qisqa xulosa tayyorlang.",
      a: "Masala bo'yicha uchta asosiy nuqta:\n1. Shartnoma shakli yozma bo'lishi shart.\n2. Sinov muddati 3 oydan oshmasligi kerak.\n3. Bekor qilishda 2 oy oldin yozma ogohlantirish talab etiladi.",
      cite: 'Mehnat kodeksi 76, 84, 161-moddalar'
    },
    {
      id: 'risk', label: 'Xavfli bandlarni top', q: 'Hujjatdagi xavfli bandlarni toping.',
      a: "Ikkita band e'tibor talab qiladi:\n· 4.2-band — javobgarlik chegarasi qonun talabidan past.\n· 7.1-band — bir tomonlama bekor qilish muddati ko'rsatilmagan.",
      cite: 'FK 354-modda · MK 161-modda'
    },
    {
      id: 'due', label: 'Muddat va jarimalar', q: "Muddatlar va mumkin bo'lgan jarimalarni hisoblang.",
      a: 'Hisobot muddati — 06.09.2026. Kechikkan har bir kun uchun 0.1 BHM, lekin umumiy summa 5 BHM dan oshmaydi.',
      cite: 'MJtK 175-modda'
    },
    { id: 'draft', label: 'Hujjat loyihasi', q: 'Hujjat loyihasini tuzing.', perMatter: true }
  ],

  drafts: {
    m1: {
      title: 'Mehnat shartnomasi — loyiha v1', cite: 'MK 72, 76, 84, 161-moddalar asosida',
      body: "MEHNAT SHARTNOMASI\n\nToshkent shahri\t\t\t05.09.2026\n\n1. TOMONLAR\n1.1. Ish beruvchi: «JuristAI» MChJ, direktor B. Abdimuminov nomidan.\n1.2. Xodim: F.I.Sh., pasport seriyasi va raqami.\n\n2. SHARTNOMA PREDMETI\n2.1. Xodim lavozimga qabul qilinadi va ichki mehnat tartibiga rioya qiladi.\n2.2. Ish joyi: Toshkent sh., ish beruvchi manzili.\n\n3. MEHNAT SHARTLARI\n3.1. Ish vaqti: haftasiga 40 soat, 5 kunlik ish haftasi.\n3.2. Sinov muddati 3 oydan oshmaydi.\n3.3. Yillik ta'til — kamida 15 ish kuni.\n\n4. MEHNAT HAQI\n4.1. Lavozim maoshi oyiga ____ so'm, oyiga ikki marta to'lanadi.\n4.2. Kechiktirilgan har bir kun uchun kompensatsiya to'lanadi.\n\n5. SHARTNOMANI BEKOR QILISH\n5.1. Tomonlar kelishuviga binoan yoki qonunda nazarda tutilgan asoslarda.\n5.2. Xodim 2 oy oldin yozma ogohlantiradi."
    },
    m2: {
      title: "Da'vo arizasi — loyiha v1", cite: 'FPK 189, 190-moddalar asosida',
      body: "DA'VO ARIZASI\n\nToshkent shahar fuqarolik ishlari bo'yicha sudiga\n\nDa'vogar: F.I.Sh., manzil, telefon.\nJavobgar: F.I.Sh. / tashkilot nomi, manzil.\nDa'vo qiymati: ____ so'm.\n\n1. HOLATLAR\n1.1. Tomonlar o'rtasida ____ sanada shartnoma tuzilgan.\n1.2. Javobgar shartnomaning ____ bandidagi majburiyatini bajarmadi.\n\n2. HUQUQIY ASOS\n2.1. Majburiyat lozim darajada bajarilishi shart.\n2.2. Bajarmaslik natijasida yetkazilgan zarar qoplanishi lozim.\n\n3. DALILLAR\n3.1. Shartnoma nusxasi.\n3.2. To'lov hujjatlari.\n3.3. Yozishmalar.\n\n4. SO'RALADI\n4.1. Javobgardan ____ so'm asosiy qarzni undirish.\n4.2. Davlat boji xarajatlarini javobgar zimmasiga yuklash."
    },
    m3: {
      title: 'Notarial shartnomaga javob — loyiha v1', cite: 'FK 110, 116-moddalar asosida',
      body: "JAVOB XATI\n\nKimga: notarius / qarshi tomon\nKimdan: F.I.Sh.\nSana: 05.09.2026\n\n1. Sizning ____ sanadagi murojaatingiz ko'rib chiqildi.\n2. Bitimning notarial tasdiqlanishi qonunda nazarda tutilgan hollarda majburiydir.\n3. Taqdim etilgan hujjatlar bo'yicha quyidagi e'tirozlar bildiriladi:\n   3.1. ____\n   3.2. ____\n4. Javob muddati: xat olingan kundan boshlab 10 kun."
    },
    m4: {
      title: 'YaTT soliq hisoboti — tushuntirish xati', cite: 'Soliq kodeksi 83, 88-moddalar asosida',
      body: "TUSHUNTIRISH XATI\n\nDavlat soliq inspeksiyasiga\n\nSoliq to'lovchi: YaTT F.I.Sh., STIR ____\nHisobot davri: 2026-yil III chorak\n\n1. Hisobot ____ sanada taqdim etildi.\n2. Quyidagi ko'rsatkichlar bo'yicha aniqlik kiritiladi:\n   2.1. Tushum summasi — ____ so'm.\n   2.2. Chegirmalar — ____ so'm.\n3. Kechikish sababi: ____\n4. Ilova: hisobot nusxasi, to'lov topshiriqnomalari."
    },
    m5: {
      title: "Bola bilan ko'rishish tartibi — ariza loyihasi", cite: 'Oila kodeksi 76, 78-moddalar asosida',
      body: "ARIZA\n\nToshkent shahar ____ tuman sudiga\n\nArizachi: F.I.Sh., manzil.\nQarshi tomon: F.I.Sh., manzil.\n\n1. Tomonlar nikohi ____ sanada bekor qilingan.\n2. Voyaga yetmagan farzand ____ bilan yashaydi.\n3. Alohida yashovchi ota-ona farzand bilan muloqot qilish huquqiga ega.\n\nSO'RALADI:\n4.1. Ko'rishish tartibini belgilash: har hafta shanba va yakshanba, 10:00–18:00.\n4.2. Ta'til davrida kamida 14 kun birga bo'lish imkonini berish."
    }
  }
};
