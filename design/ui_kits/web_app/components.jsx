// Lucide icon helper — uses CDN sprites, tinted via CSS filter
function Icon({ name, size = 16, light = false, style }) {
  return (
    <img
      src={`https://unpkg.com/lucide-static@0.460.0/icons/${name}.svg`}
      alt=""
      className={light ? 'lic-light' : 'lic'}
      style={{ width: size, height: size, ...style }}
    />
  );
}

function Sidebar({ active, onNavigate, user }) {
  const items = [
    { section: 'Ish maydoni' },
    { id: 'dashboard', label: 'Boshqaruv paneli', icon: 'layout-dashboard' },
    { id: 'chat', label: 'AI Suhbat', icon: 'message-square' },
    { id: 'editor', label: 'Hujjatlarim', icon: 'file-text' },
    { id: 'clients', label: 'Mijozlar', icon: 'users' },
    { section: 'Qonunchilik' },
    { id: 'mk', label: 'Mehnat kodeksi', icon: 'book-open' },
    { id: 'fk', label: 'Fuqarolik kodeksi', icon: 'book-open' },
    { id: 'qaror', label: 'Qarorlar', icon: 'gavel' },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="mark">J</div>
        <div className="wm">Jurist<em>AI</em></div>
      </div>
      {items.map((it, i) =>
        it.section ? (
          <div className="nav-section" key={i}>{it.section}</div>
        ) : (
          <div
            key={it.id}
            className={'nav-item' + (active === it.id ? ' active' : '')}
            onClick={() => onNavigate && onNavigate(it.id)}
          >
            <Icon name={it.icon} light={active === it.id} />
            <span>{it.label}</span>
          </div>
        )
      )}
      <div className="nav-foot">
        <div className="avatar">{user.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{user.name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{user.role}</div>
        </div>
        <Icon name="settings" size={14} />
      </div>
    </aside>
  );
}

function TopBar({ lang, setLang }) {
  return (
    <div className="topbar">
      <div className="search">
        <Icon name="search" size={14} />
        <input placeholder="Qonun, hujjat yoki mijoz qidirish…" />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>⌘K</span>
      </div>
      <div className="lang">
        {['UZ', 'RU', 'EN'].map(l => (
          <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l}</button>
        ))}
      </div>
      <button className="btn btn-secondary"><Icon name="bell" size={14} />Bildirishnomalar</button>
    </div>
  );
}

function Badge({ kind = 'neutral', dot, children }) {
  return (
    <span className={'badge b-' + kind}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

function DocCard({ name, meta, badge, badgeKind, date, onClick }) {
  return (
    <div className="doc" onClick={onClick}>
      <div className="doc-icon" />
      <div className="doc-name">{name}</div>
      <div className="doc-meta">{meta}</div>
      <div className="doc-foot">
        <Badge kind={badgeKind || 'success'}>{badge}</Badge>
        <span className="doc-meta">{date}</span>
      </div>
    </div>
  );
}

window.Icon = Icon;
window.Sidebar = Sidebar;
window.TopBar = TopBar;
window.Badge = Badge;
window.DocCard = DocCard;
