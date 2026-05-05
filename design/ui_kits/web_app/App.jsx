function App() {
  const [view, setView] = React.useState('dashboard');
  const [lang, setLang] = React.useState('UZ');
  const [draft, setDraft] = React.useState('');
  const [messages, setMessages] = React.useState([
    {
      who: 'ai',
      content: (
        <span>
          Salom, Aziza. Men Dictum — qonunlar bo'yicha yordamchingiz. Mehnat kodeksi, Fuqarolik kodeksi va so'nggi qarorlar bo'yicha savollarga javob beraman. Hujjat yuklang yoki savol bering.
        </span>
      ),
    },
  ]);

  const send = (textOverride) => {
    const text = (textOverride || draft).trim();
    if (!text) return;
    setMessages(m => [...m, { who: 'me', content: text }]);
    setDraft('');
    setTimeout(() => {
      setMessages(m => [
        ...m,
        {
          who: 'ai',
          content: (
            <span>
              Mehnat shartnomasi tomonlarning o'zaro kelishuvi bilan istalgan vaqtda bekor qilinishi mumkin <span className="cite">MK·99</span>. Ish beruvchi bir tomonlama bekor qilsa, kamida <strong>2 oy</strong> oldin yozma xabar berishi shart <span className="cite">MK·100</span>. Xodimning tashabbusi bilan — 2 hafta <span className="cite">MK·101</span>. Qoralama tayyorlashimni istaysizmi?
            </span>
          ),
          citations: ['MK·99 — Bekor qilish asoslari', 'MK·100 — Ogohlantirish muddati', 'MK·101 — Xodim tashabbusi'],
        },
      ]);
    }, 700);
  };

  const askAndGo = (q) => {
    setView('chat');
    setTimeout(() => send(q), 100);
  };

  return (
    <div className="app">
      <Sidebar
        active={view}
        onNavigate={setView}
        user={{ initials: 'AT', name: 'Aziza Tursunova', role: 'Yuridik maslahatchi' }}
      />
      <div className="main">
        <TopBar lang={lang} setLang={setLang} />
        <div className="content" style={view === 'chat' ? { padding: 0, display: 'flex', flexDirection: 'column' } : {}}>
          {view === 'dashboard' && <Dashboard onNavigate={setView} onAsk={askAndGo} />}
          {view === 'chat' && (
            <div className="chat" style={{ padding: '16px 28px' }}>
              <ChatThread messages={messages} />
              <Composer
                value={draft}
                setValue={setDraft}
                onSend={() => send()}
                placeholder="Qonun haqida savol bering yoki hujjat yuklang…"
              />
            </div>
          )}
          {view === 'editor' && <DocumentEditor />}
          {view === 'clients' && <ClientsTable />}
          {(view === 'mk' || view === 'fk' || view === 'qaror') && (
            <div style={{ textAlign: 'center', padding: 80, color: 'var(--fg-3)' }}>
              <Icon name="book-open" size={32} />
              <div style={{ marginTop: 16, fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--ink-900)' }}>
                Statute browser
              </div>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                Demoda mavjud emas — UI kit ko'rsatuv uchun
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
