function Alert({ kind, ic, title, children, onClick }) {
  return (
    <div className={'alert a-' + kind} onClick={onClick}>
      <div className="ic">{ic}</div>
      <div>
        <div className="ttl">{title}</div>
        <div className="msg">{children}</div>
      </div>
    </div>
  );
}

function DocumentEditor() {
  return (
    <div className="editor-wrap">
      <div className="paper">
        <h1>Mehnat shartnomasi</h1>
        <div className="num">№ 2024-481 · 14 aprel, 2026</div>
        <p><strong>1.</strong> "Atlas Construction" MChJ (keyingi o'rinlarda — "Ish beruvchi"), STIR <span className="h-ai">300481294</span>, bir tomondan, va <strong>Akmal Karimov Olimovich</strong>, JShShIR <span className="h-warn">31407851200032</span>, ikkinchi tomondan, quyidagi shartnoma tuzdilar.</p>
        <p><strong>2.</strong> Ushbu shartnoma O'zbekiston Respublikasi Mehnat kodeksining 76-moddasiga muvofiq tuzilgan bo'lib, xodimga "Loyiha menejeri" lavozimini taklif etadi.</p>
        <p><strong>3.</strong> Ish haqi miqdori — oyiga 18,500,000 so'm, har oyning 5-sanasiga qadar to'lanadi.</p>
        <p><strong>4.</strong> Shartnoma muddati — <span className="h-danger">32.13.2026</span> sanasigacha.</p>
        <p><strong>5.</strong> Tomonlar shartnomani 30 kun oldin yozma xabar berib bekor qilishi mumkin.</p>
      </div>
      <div className="review">
        <div className="eyebrow" style={{ marginBottom: 4 }}>AI tahlil — 3 ta eslatma</div>
        <Alert kind="danger" ic="×" title="Sana noto'g'ri">
          4-bandda "32.13.2026" — bunday sana mavjud emas. To'g'rilash kerak.
        </Alert>
        <Alert kind="warn" ic="!" title="JShShIR uzunligi">
          14 raqamli kod ko'rsatilgan, lekin standart 14 emas. Tekshiring.
        </Alert>
        <Alert kind="ai" ic="i" title="Avtomatik to'ldirildi">
          STIR Atlas Construction MChJ ma'lumotlar bazasidan olindi.
        </Alert>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-brass" style={{ flex: 1 }}>Hammasini qabul qilish</button>
          <button className="btn btn-secondary"><Icon name="x" size={12} /></button>
        </div>
        <div className="card" style={{ padding: 14, marginTop: 8 }}>
          <div className="eyebrow">Manbalar</div>
          <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5, marginTop: 6 }}>
            MK 76-modda · MK 78-modda · Ish haqi to'lash to'g'risida 481-Qaror
          </div>
        </div>
      </div>
    </div>
  );
}

function ClientsTable() {
  const rows = [
    { i: 'AK', name: 'Akmal Karimov', meta: 'JShShIR · 31407851200032', email: 'akmal.k@atlas.uz', docs: '12 hujjat', last: '2 kun' },
    { i: 'NR', name: 'Atlas Construction MChJ', meta: 'STIR · 300481294', email: 'office@atlas.uz', docs: '34 hujjat', last: '12 soat' },
    { i: 'DM', name: 'Dilnoza Murodova', meta: 'Yakka tartibdagi tadbirkor', email: 'dilnoza.m@gmail.com', docs: '5 hujjat', last: '6 kun' },
    { i: 'SH', name: 'SilkRoad Logistics', meta: 'STIR · 305112847', email: 'legal@silkroad.uz', docs: '21 hujjat', last: '1 kun' },
    { i: 'BT', name: 'Bekzod Tursunov', meta: 'JShShIR · 32907920140018', email: 'b.tursunov@mail.ru', docs: '3 hujjat', last: '3 hafta' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h-section" style={{ marginBottom: 0 }}>Mijozlar</h2>
        <button className="btn btn-primary"><Icon name="plus" size={12} light />Yangi mijoz</button>
      </div>
      <div>
        {rows.map((r, i) => (
          <div className="client-row" key={i}>
            <div className="avatar" style={{ width: 36, height: 36 }}>{r.i}</div>
            <div>
              <div className="client-name">{r.name}</div>
              <div className="client-meta">{r.meta}</div>
            </div>
            <div className="client-meta">{r.email}</div>
            <div><Badge kind="neutral">{r.docs}</Badge></div>
            <div className="client-meta">{r.last} oldin</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.Alert = Alert;
window.DocumentEditor = DocumentEditor;
window.ClientsTable = ClientsTable;
