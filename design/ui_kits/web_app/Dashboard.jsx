function Dashboard({ onNavigate, onAsk }) {
  const recentDocs = [
    { name: 'Mehnat shartnomasi № 481', meta: 'DOCX · 4 sahifa', badge: 'Tasdiqlangan', kind: 'success', date: '2 soat' },
    { name: 'Ijara qoralamasi', meta: 'DOCX · AI yaratdi', badge: 'Qoralama', kind: 'warn', date: '12 soat' },
    { name: 'NDA — SilkRoad', meta: 'PDF · imzolangan', badge: 'Yopiq', kind: 'neutral', date: '1 kun' },
    { name: 'Ish haqi tartibi', meta: 'DOCX · ko\'rib chiqilmoqda', badge: 'AI tahlil', kind: 'brass', date: '3 kun' },
  ];
  const frequent = [
    { code: 'MK', n: '99', label: 'Shartnomani bekor qilish' },
    { code: 'MK', n: '76', label: 'Shartnoma tuzish tartibi' },
    { code: 'FK', n: '354', label: 'Yuridik shaxslar ro\'yxati' },
    { code: 'MK', n: '100', label: 'Ogohlantirish muddati' },
  ];
  return (
    <div>
      <div className="eyebrow">Xush kelibsiz</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <h1 style={{ font: '600 28px/1.2 var(--font-serif)', color: 'var(--ink-900)' }}>
          Xayrli kun, Aziza
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => onNavigate('editor')}><Icon name="file-plus" size={14} />Yangi hujjat</button>
          <button className="btn btn-brass" onClick={() => onNavigate('chat')}><Icon name="sparkles" size={14} light />AI ga savol</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat brass">
          <div className="stat-l">Bu hafta AI tahlil qildi</div>
          <div className="stat-v">47 hujjat</div>
          <div className="stat-d">↑ 18% o'tgan haftaga nisbatan</div>
        </div>
        <div className="stat">
          <div className="stat-l">Faol qoralamalar</div>
          <div className="stat-v">8</div>
          <div className="stat-d">3 tasi bugun ko'rib chiqilishi kerak</div>
        </div>
        <div className="stat">
          <div className="stat-l">Mijozlar</div>
          <div className="stat-v">142</div>
          <div className="stat-d">12 ta yangi shu oy</div>
        </div>
        <div className="stat">
          <div className="stat-l">Iqtiboslangan moddalar</div>
          <div className="stat-v">312</div>
          <div className="stat-d">MK · FK · Qarorlar</div>
        </div>
      </div>

      <div className="grid-2">
        <div>
          <div className="h-section-row">
            <span className="h-section">Yaqindagi hujjatlar</span>
            <span className="more">Hammasini ko'rish →</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {recentDocs.map((d, i) => (
              <DocCard key={i} {...d} badgeKind={d.kind} onClick={() => onNavigate('editor')} />
            ))}
          </div>

          <div className="h-section" style={{ marginTop: 28 }}>Tezkor savollar</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              'Mehnat shartnomasini qanday bekor qilish mumkin?',
              'Yakka tartibdagi tadbirkorni ro\'yxatdan o\'tkazish tartibi',
              'NDA shartnomasi uchun majburiy bandlar nima?',
            ].map((q, i) => (
              <div
                key={i}
                onClick={() => onAsk(q)}
                style={{ background: '#fff', border: '1px solid var(--border-1)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: 'var(--fg-1)' }}
              >
                <span>{q}</span>
                <Icon name="arrow-right" size={14} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="h-section">Tez-tez murojaat qilinadigan moddalar</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {frequent.map((f, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid var(--border-1)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <div style={{ background: 'var(--navy-700)', color: '#fff', font: '700 11px/1 var(--font-mono)', padding: '4px 6px', borderRadius: 4, minWidth: 28, textAlign: 'center' }}>{f.n}</div>
                <div style={{ font: '600 11px/1 var(--font-mono)', color: 'var(--navy-700)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{f.code}</div>
                <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-900)' }}>{f.label}</div>
                <Icon name="external-link" size={14} />
              </div>
            ))}
          </div>

          <div className="h-section" style={{ marginTop: 28 }}>Bugungi vazifalar</div>
          <div className="card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { l: 'Atlas MChJ — shartnomani qayta ko\'rib chiqish', t: '14:00' },
                { l: 'SilkRoad NDA — imzolash', t: '16:30' },
                { l: 'D. Murodovaga javob yozish', t: 'Bugun' },
              ].map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 16, height: 16, border: '1.5px solid var(--ink-300)', borderRadius: 4 }} />
                  <div style={{ flex: 1, fontSize: 13 }}>{t.l}</div>
                  <div style={{ font: '500 11px/1 var(--font-mono)', color: 'var(--fg-3)' }}>{t.t}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Dashboard = Dashboard;
