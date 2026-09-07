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
  ]
};
