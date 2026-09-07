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
  }
};
