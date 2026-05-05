function Composer({ value, setValue, onSend, placeholder }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current && ref.current.textContent !== value) ref.current.textContent = value || '';
  }, [value]);
  const isEmpty = !value || !value.trim();
  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="composer-input-wrap">
          {isEmpty && <div className="composer-ph">{placeholder}</div>}
          <div
            ref={ref}
            className="composer-input"
            contentEditable
            suppressContentEditableWarning
            onInput={e => setValue(e.currentTarget.textContent)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend && onSend();
              }
            }}
          />
        </div>
        <div className="composer-tools">
          <div className="tool-icons">
            <button className="tool" title="Fayl biriktirish"><Icon name="paperclip" size={14} /></button>
            <button className="tool" title="Hujjat yuklash"><Icon name="file-text" size={14} /></button>
            <button className="tool" title="Statyaga havola"><Icon name="scale" size={14} /></button>
          </div>
          <button className="btn btn-brass" onClick={onSend}>
            Yuborish <Icon name="arrow-up" size={12} light />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ who, children, citations }) {
  return (
    <div className={'bubble-row' + (who === 'me' ? ' me' : '')}>
      <div className="who">{who === 'me' ? 'Siz' : 'Dictum AI'}</div>
      <div className={'bubble ' + (who === 'me' ? 'user' : 'ai')}>{children}</div>
      {citations && citations.length > 0 && (
        <div style={{ display: 'flex', gap: 6, paddingLeft: 4, flexWrap: 'wrap' }}>
          {citations.map((c, i) => (
            <span className="cite" key={i}>{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatThread({ messages }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);
  return (
    <div className="thread" ref={ref}>
      {messages.map((m, i) => (
        <Bubble key={i} who={m.who} citations={m.citations}>
          {m.content}
        </Bubble>
      ))}
    </div>
  );
}

window.Composer = Composer;
window.Bubble = Bubble;
window.ChatThread = ChatThread;
