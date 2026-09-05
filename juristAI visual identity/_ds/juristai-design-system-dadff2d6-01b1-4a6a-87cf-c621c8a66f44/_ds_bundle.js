/* @ds-bundle: {"format":3,"namespace":"JuristAIDesignSystem_dadff2","components":[],"sourceHashes":{"platform/components.jsx":"61cddea6e92f","platform/i18n.js":"6bc786ec323c","platform/layout.jsx":"bd5c9fa466fe","platform/pages/lawyer.jsx":"dd17d6d28d93","platform/pages/public.jsx":"72a5d1ceba9c","platform/pages/role-pages.jsx":"554cabfb3d29","platform/router.jsx":"f0f533af7930","platform/store.js":"4e4c3065eca0","platform/tweaks.jsx":"37d0dadeab11","ui_kits/web_app/App.jsx":"ff11a169e4e9","ui_kits/web_app/Chat.jsx":"60d6ac43372d","ui_kits/web_app/Dashboard.jsx":"9854d050e12a","ui_kits/web_app/Editor.jsx":"454ca33ae60a","ui_kits/web_app/PrintApp.jsx":"45bc277339ae","ui_kits/web_app/components.jsx":"c898e71ca9f8"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.JuristAIDesignSystem_dadff2 = window.JuristAIDesignSystem_dadff2 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// platform/components.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// JuristAI — shared icons (inline SVG, currentColor)

const Icon = ({
  name,
  size = 16
}) => {
  const paths = ICONS[name];
  if (!paths) return null;
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, paths);
};
const ICONS = {
  dashboard: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "7",
    height: "9",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "3",
    width: "7",
    height: "5",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "12",
    width: "7",
    height: "9",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "16",
    width: "7",
    height: "5",
    rx: "1.5"
  })),
  chat: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
  })),
  doc: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "14 2 14 8 20 8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "13",
    x2: "15",
    y2: "13"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "17",
    x2: "13",
    y2: "17"
  })),
  users: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "7",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M23 21v-2a4 4 0 0 0-3-3.87"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 3.13a4 4 0 0 1 0 7.75"
  })),
  template: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "18",
    height: "18",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 9h18M9 21V9"
  })),
  bookmark: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
  })),
  settings: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
  })),
  search: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "21",
    y1: "21",
    x2: "16.65",
    y2: "16.65"
  })),
  send: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "22",
    y1: "2",
    x2: "11",
    y2: "13"
  }), /*#__PURE__*/React.createElement("polygon", {
    points: "22 2 15 22 11 13 2 9 22 2"
  })),
  paperclip: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
  })),
  mic: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19 10v2a7 7 0 0 1-14 0v-2"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "19",
    x2: "12",
    y2: "23"
  })),
  plus: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "5",
    x2: "12",
    y2: "19"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "5",
    y1: "12",
    x2: "19",
    y2: "12"
  })),
  arrow: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "5",
    y1: "12",
    x2: "19",
    y2: "12"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "12 5 19 12 12 19"
  })),
  arrowL: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "19",
    y1: "12",
    x2: "5",
    y2: "12"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "12 19 5 12 12 5"
  })),
  check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
    points: "20 6 9 17 4 12"
  })),
  x: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "18",
    y1: "6",
    x2: "6",
    y2: "18"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "6",
    y1: "6",
    x2: "18",
    y2: "18"
  })),
  signout: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "16 17 21 12 16 7"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "21",
    y1: "12",
    x2: "9",
    y2: "12"
  })),
  upload: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "17 8 12 3 7 8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "3",
    x2: "12",
    y2: "15"
  })),
  star: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polygon", {
    points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
  })),
  refresh: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
    points: "23 4 23 10 17 10"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "1 20 1 14 7 14"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
  })),
  book: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
  })),
  graduate: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M22 10v6M2 10l10-5 10 5-10 5z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M6 12v5c3 3 9 3 12 0v-5"
  })),
  bag: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "3",
    y1: "6",
    x2: "21",
    y2: "6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 10a4 4 0 0 1-8 0"
  })),
  shield: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
  })),
  user: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "7",
    r: "4"
  })),
  building: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "2",
    width: "16",
    height: "20",
    rx: "2"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "6",
    x2: "9",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "15",
    y1: "6",
    x2: "15",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "9",
    y1: "10",
    x2: "9",
    y2: "10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "15",
    y1: "10",
    x2: "15",
    y2: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10 22v-4h4v4"
  })),
  edit: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 20h9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"
  })),
  trash: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
    points: "3 6 5 6 21 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
  })),
  bell: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13.73 21a2 2 0 0 1-3.46 0"
  })),
  globe: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "2",
    y1: "12",
    x2: "22",
    y2: "12"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
  })),
  zap: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polygon", {
    points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2"
  })),
  scale: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 3v18M5 7l7-2 7 2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 7l-3 6c0 1.5 1.5 3 3 3s3-1.5 3-3z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19 7l-3 6c0 1.5 1.5 3 3 3s3-1.5 3-3z"
  })),
  more: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "19",
    cy: "12",
    r: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "5",
    cy: "12",
    r: "1"
  })),
  sparkles: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19 17l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"
  })),
  filter: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polygon", {
    points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
  })),
  download: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "7 10 12 15 17 10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "15",
    x2: "12",
    y2: "3"
  })),
  eye: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }))
};
window.Icon = Icon;
window.ICONS = ICONS;

// ─── Button ─────────────────────────────────────────
function Button({
  variant = 'primary',
  size,
  block,
  children,
  ...rest
}) {
  const cls = ['btn', 'btn-' + variant, size && 'btn-' + size, block && 'btn-block', rest.className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({}, rest, {
    className: cls
  }), children);
}

// ─── Badge ──────────────────────────────────────────
function Badge({
  kind = 'neutral',
  children,
  dot
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: 'badge b-' + kind
  }, dot && /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), children);
}

// ─── Status badge from doc status ───────────────────
function StatusBadge({
  status
}) {
  const lang = window.__lang || 'UZ';
  const map = {
    draft: ['warn', t('common.draft')],
    approved: ['success', t('common.approved')],
    closed: ['neutral', t('common.closed')],
    review: ['info', t('common.review')]
  };
  const [k, label] = map[status] || ['neutral', status];
  return /*#__PURE__*/React.createElement(Badge, {
    kind: k,
    dot: true
  }, label);
}

// ─── Brand mark ─────────────────────────────────────
function Brand({
  size = 'md'
}) {
  const px = size === 'lg' ? 44 : 34;
  const fz = size === 'lg' ? 22 : 17;
  return /*#__PURE__*/React.createElement("div", {
    className: "brand",
    style: {
      padding: 0,
      border: 'none',
      margin: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mark",
    style: {
      width: px,
      height: px
    }
  }, "J"), /*#__PURE__*/React.createElement("div", {
    className: "wm",
    style: {
      fontSize: fz
    }
  }, "Jurist", /*#__PURE__*/React.createElement("em", null, "AI")));
}

// ─── Lang toggle ────────────────────────────────────
function LangToggle() {
  const [lang, setLangState] = React.useState(window.__lang || 'UZ');
  React.useEffect(() => STORE.on('lang', () => setLangState(window.__lang)), []);
  const set = l => {
    STORE.setLang(l);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "lang"
  }, /*#__PURE__*/React.createElement("button", {
    className: lang === 'UZ' ? 'on' : '',
    onClick: () => set('UZ')
  }, "UZ"), /*#__PURE__*/React.createElement("button", {
    className: lang === 'RU' ? 'on' : '',
    onClick: () => set('RU')
  }, "RU"));
}

// ─── Toast ──────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  let el = document.getElementById('__toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '__toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.remove();
  }, 2400);
}

// ─── Modal ──────────────────────────────────────────
function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  footer
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "modal-bg",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "modal-h"
  }, title && /*#__PURE__*/React.createElement("h3", null, title), sub && /*#__PURE__*/React.createElement("p", null, sub)), /*#__PURE__*/React.createElement("div", {
    className: "modal-body"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "modal-foot"
  }, footer)));
}

// ─── Markdown-ish renderer for AI text (with <cite id="..."/>) ─
function renderAI(text, citations) {
  // Replace <cite id="cN"/> with chip
  const parts = [];
  const re = /<cite id="([^"]+)"\/>/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    parts.push(renderInline(text.slice(last, m.index), 'k' + i++));
    const cit = (citations || []).find(c => c.id === m[1]);
    if (cit) parts.push(/*#__PURE__*/React.createElement("span", {
      key: 'c' + i++,
      className: "cite"
    }, cit.code, "\xB7", cit.n));
    last = m.index + m[0].length;
  }
  parts.push(renderInline(text.slice(last), 'k' + i++));
  return parts;
}
function renderInline(s, key) {
  // simple **bold**
  const arr = [];
  let i = 0;
  s.split(/(\*\*[^*]+\*\*)/g).forEach((seg, idx) => {
    if (/^\*\*/.test(seg)) arr.push(/*#__PURE__*/React.createElement("strong", {
      key: key + 'b' + idx
    }, seg.slice(2, -2)));else arr.push(/*#__PURE__*/React.createElement("span", {
      key: key + 's' + idx
    }, seg));
  });
  return arr;
}
window.Button = Button;
window.Badge = Badge;
window.StatusBadge = StatusBadge;
window.Brand = Brand;
window.LangToggle = LangToggle;
window.showToast = showToast;
window.Modal = Modal;
window.renderAI = renderAI;
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/components.jsx", error: String((e && e.message) || e) }); }

// platform/i18n.js
try { (() => {
// JuristAI Platform — i18n strings (UZ + RU)
// Usage: t('home.hero.title') or t('home.hero.title', {name: 'Aziza'})

const STRINGS = {
  UZ: {
    'common.signin': 'Kirish',
    'common.signup': 'Ro\'yxatdan o\'tish',
    'common.send': 'Yuborish',
    'common.cancel': 'Bekor qilish',
    'common.save': 'Saqlash',
    'common.delete': 'O\'chirish',
    'common.back': 'Orqaga',
    'common.next': 'Keyingi',
    'common.continue': 'Davom etish',
    'common.search': 'Qidirish',
    'common.email': 'Elektron pochta',
    'common.password': 'Parol',
    'common.name': 'Ism',
    'common.loading': 'Yuklanmoqda…',
    'common.empty': 'Hozircha hech narsa yo\'q',
    'common.error': 'Xatolik yuz berdi',
    'common.retry': 'Qayta urinish',
    'common.draft': 'Qoralama',
    'common.approved': 'Tasdiqlangan',
    'common.closed': 'Yopiq',
    'common.review': 'Ko\'rib chiqilmoqda',
    'land.eyebrow': 'O\'zbekiston yuristlari uchun AI',
    'land.hero.title': 'Qonun bilan ishlashning yangi usuli',
    'land.hero.sub': 'Mehnat, Fuqarolik va boshqa kodekslar bo\'yicha AI yordamchi. Hujjatlarni tahlil qiladi, qoralama yaratadi, manbalarni keltiradi.',
    'land.cta.start': 'Bepul boshlash',
    'land.cta.demo': 'Demo ko\'rish',
    'land.f1.t': 'Manbalardan iqtibos',
    'land.f1.b': 'Har bir javobda Mehnat va Fuqarolik kodeksining aniq moddalariga havola.',
    'land.f2.t': 'Hujjat tahrirlash',
    'land.f2.b': 'Shartnoma yuklang \u2014 AI xatolar va kritik bandlarni belgilaydi.',
    'land.f3.t': 'Mijozlar bazasi',
    'land.f3.b': 'Mijoz ma\'lumotlari avtomatik to\'ldiriladi. Bir marta kiriting \u2014 hamma joyda.',
    'land.audiences': 'Kim uchun?',
    'land.aud.lawyer': 'Yuristlar',
    'land.aud.lawyer.b': 'Tezroq tahlil, aniqroq iqtiboslar.',
    'land.aud.student': 'Talabalar',
    'land.aud.student.b': 'Imtihonga tayyorlanish, savol-javob.',
    'land.aud.citizen': 'Fuqarolar',
    'land.aud.citizen.b': 'Oddiy savollarga oddiy javoblar.',
    'land.aud.firm': 'Yuridik firmalar',
    'land.aud.firm.b': 'Master Admin orqali boshqarish.',
    'pricing.title': 'Tarif rejalari',
    'pricing.sub': '7 kun bepul. Istalgan vaqtda bekor qilish.',
    'pricing.free.n': 'Bepul',
    'pricing.free.p': '0 so\'m',
    'pricing.pro.n': 'Pro',
    'pricing.pro.p': '290,000 so\'m / oy',
    'pricing.firm.n': 'Firma',
    'pricing.firm.p': '1,200,000 so\'m / oy',
    'pricing.month': 'oy',
    'pricing.start': 'Boshlash',
    'pricing.contact': 'Bog\'lanish',
    'auth.welcome': 'JuristAI ga xush kelibsiz',
    'auth.signin.t': 'Hisobingizga kiring',
    'auth.signup.t': 'Yangi hisob yarating',
    'auth.reset.t': 'Parolni tiklash',
    'auth.reset.sub': 'Email manzilingizni kiriting \u2014 yo\'riqnoma yuboramiz.',
    'auth.no.acct': 'Hisobingiz yo\'qmi?',
    'auth.have.acct': 'Hisobingiz bormi?',
    'auth.forgot': 'Parolni unutdingizmi?',
    'auth.quick': 'Tezkor demo kirish',
    'auth.quick.sub': 'Parol kerak emas \u2014 bitta bosish bilan rolni tanlang',
    'auth.lawyer': 'Yurist sifatida',
    'auth.student': 'Talaba sifatida',
    'auth.citizen': 'Fuqaro sifatida',
    'auth.admin': 'Master Admin',
    'ob.welcome': 'Salom, {name}',
    'ob.lang.t': 'Qaysi tilda ishlaymiz?',
    'ob.role.t': 'Sizning rolingiz?',
    'ob.workspace.t': 'Ish maydoni nomi',
    'ob.workspace.ph': 'Mas. "Karimov & Sherikchilar"',
    'ob.done.t': 'Hammasi tayyor',
    'ob.done.b': 'Boshlash uchun pastdagi tugmani bosing.',
    'ob.start': 'Ishni boshlash',
    'nav.dashboard': 'Boshqaruv paneli',
    'nav.chat': 'AI Suhbat',
    'nav.editor': 'Hujjatlarim',
    'nav.clients': 'Mijozlar',
    'nav.templates': 'Andozalar',
    'nav.bookmarks': 'Saqlanganlar',
    'nav.settings': 'Sozlamalar',
    'nav.workspace': 'Ish maydoni',
    'nav.law': 'Qonunchilik',
    'nav.signout': 'Chiqish',
    'dash.greet': 'Xayrli kun, {name}',
    'dash.eyebrow': 'Xush kelibsiz',
    'dash.new.doc': 'Yangi hujjat',
    'dash.ask': 'AI ga savol',
    'dash.recent': 'Yaqindagi hujjatlar',
    'dash.frequent': 'Tez-tez murojaat qilinadigan moddalar',
    'dash.quick.q': 'Tezkor savollar',
    'dash.tasks': 'Bugungi vazifalar',
    'dash.see.all': 'Hammasini ko\'rish',
    'dash.s.analyzed': 'Bu hafta AI tahlil qildi',
    'dash.s.drafts': 'Faol qoralamalar',
    'dash.s.clients': 'Mijozlar',
    'dash.s.cited': 'Iqtiboslangan moddalar',
    'chat.ph': 'Qonun haqida savol bering yoki hujjat yuklang…',
    'chat.you': 'Siz',
    'chat.ai': 'JuristAI',
    'chat.new': 'Yangi suhbat',
    'chat.history': 'Suhbat tarixi',
    'chat.empty': 'Birinchi savolingizni bering',
    'chat.empty.sub': 'Mehnat, Fuqarolik kodeksi yoki istalgan qonun haqida so\'rang.',
    'doc.untitled': 'Nomsiz hujjat',
    'doc.review': 'AI tahlil',
    'doc.rerun': 'AI ni qayta ishga tushirish',
    'doc.accept.all': 'Hammasini qabul qilish',
    'doc.sources': 'Manbalar',
    'doc.empty': 'Hujjat tanlang',
    'doc.empty.sub': 'Chap tarafdan tanlang yoki yangi hujjat yarating.',
    'doc.new': 'Yangi hujjat',
    'cl.title': 'Mijozlar',
    'cl.new': 'Yangi mijoz',
    'cl.ph.search': 'Mijoz qidirish…',
    'cl.empty': 'Hali mijozlar qo\'shilmagan',
    'cl.empty.sub': 'Birinchi mijozingizni qo\'shing \u2014 ma\'lumotlar hujjatlarga avtomatik to\'ldiriladi.',
    'cl.docs': '{n} hujjat',
    'cl.kind.person': 'Jismoniy shaxs',
    'cl.kind.entity': 'Yuridik shaxs',
    'tpl.title': 'Hujjat andozalari',
    'tpl.sub': 'Andozani tanlang, mijozni tanlang, AI to\'ldirib beradi.',
    'tpl.use': 'Foydalanish',
    'tpl.fill.t': 'Ma\'lumotlarni to\'ldiring',
    'tpl.client': 'Mijozni tanlang',
    'tpl.no.client': 'Mijozsiz davom etish',
    'tpl.generate': 'AI bilan yaratish',
    'tpl.generating': 'Yaratilmoqda…',
    'bm.title': 'Saqlangan moddalar va so\'rovlar',
    'bm.empty': 'Hali saqlangan narsa yo\'q',
    'bm.empty.sub': 'Statyalarni o\'qiyotganda yulduzcha bosing \u2014 shu yerda paydo bo\'ladi.',
    'set.title': 'Sozlamalar',
    'set.profile': 'Profil',
    'set.lang': 'Til',
    'set.notif': 'Bildirishnomalar',
    'set.api': 'API kalitlari',
    'set.danger': 'Xavfli zona',
    'set.signout.all': 'Hamma qurilmalardan chiqish',
    'set.delete.acct': 'Hisobni o\'chirish',
    'cit.ask.t': 'Yuridik savolingiz nima?',
    'cit.ask.sub': 'Oddiy tilda yozing. Biz qonunchilik bo\'yicha javob beramiz.',
    'cit.ph': 'Mas. "Ishdan bo\'shatishganda kompensatsiya qancha?"',
    'cit.intake.t': 'Murojaat yuborish',
    'cit.intake.sub': 'Yurist tomonidan ko\'rib chiqilishi uchun ma\'lumotlarni to\'ldiring.',
    'cit.disclaimer': 'JuristAI javoblari ma\'lumot berish uchun mo\'ljallangan va yuridik maslahat o\'rnini bosmaydi.',
    'cit.welcome': 'Salom, {name}',
    'cit.h1': 'Yuridik savolingizni bering',
    'cit.sub': 'Oddiy tilda yozing — qonun moddalariga havola bilan javob beramiz.',
    'cit.quick': 'Mashhur savollar',
    'cit.escalate': 'Yetarli emasmi?',
    'cit.find.lawyer': 'Yurist topish',
    'std.welcome': 'Xayrli kun, {name}',
    'std.h1': 'Yuridik bilimlarni mustahkamlang',
    'std.title': 'O\'rganish rejimi',
    'std.saved': 'Saqlangan savollar',
    'std.exam': 'Imtihon mashqi',
    'std.flash': 'Karta o\'rganish',
    'stud.welcome': 'Xayrli kun, {name}',
    'stud.h1': 'Yuridik bilimlarni mustahkamlang',
    'stud.study': 'O\'rganish',
    'stud.study.sub': 'Mavzu bo\'yicha bilimlaringizni kengaytiring. Har bir kodeks ostida mavzular ro\'yxati.',
    'stud.practice': 'Mashq',
    'stud.practice.sub': 'Tasodifiy savol oling va javobingizni yozing. AI sizni baholaydi.',
    'stud.practice.start': 'Mashqni boshlash',
    'stud.saved': 'Saqlanganlar',
    'stud.check': 'Tekshirish',
    'stud.next': 'Keyingi',
    'adm.title': 'Master Admin',
    'adm.ingest': 'Hujjatlarni yuklash',
    'adm.rag': 'RAG bo\'laklarini tahrirlash',
    'adm.feedback': 'Foydalanuvchi fikr-mulohazalari',
    'adm.upload.cta': 'PDF yoki DOCX tashlang',
    'adm.upload.sub': 'OCR avtomatik ishlaydi. Tugaganidan keyin RAG bo\'limida tasdiqlang.',
    'adm.queue': 'Qayta ishlash navbati',
    'adm.overview': 'Umumiy ko\'rinish',
    'adm.sources': 'Manbalar',
    'adm.eval': 'Baholash',
    'adm.kpi.queries': 'So\'rovlar bu hafta',
    'adm.kpi.success': 'Aniqlik darajasi',
    'adm.kpi.flagged': 'Belgilangan javoblar',
    'adm.drop': 'Faylni shu yerga tashlang',
    'adm.browse': 'Faylni tanlash',
    'adm.tag.t': 'Manba ma\'lumotlari',
    'adm.code': 'Kodeks',
    'adm.lang': 'Til',
    'adm.version': 'Versiya sanasi',
    'adm.ingest.now': 'Indekslash',
    'tw.title': 'Sozlamalar',
    'tw.theme': 'Mavzu',
    'tw.light': 'Yorug\'',
    'tw.dark': 'Tungi',
    'tw.accent': 'Asosiy rang',
    'tw.density': 'Zichlik',
    'tw.comfortable': 'Keng',
    'tw.compact': 'Ixcham',
    'tw.font': 'Shrift',
    'tw.serif': 'Serif',
    'tw.sans': 'Sans',
    'role.lawyer': 'Yurist',
    'role.student': 'Talaba',
    'role.citizen': 'Fuqaro',
    'role.master': 'Master Admin'
  },
  RU: {
    'common.signin': 'Войти',
    'common.signup': 'Регистрация',
    'common.send': 'Отправить',
    'common.cancel': 'Отмена',
    'common.save': 'Сохранить',
    'common.delete': 'Удалить',
    'common.back': 'Назад',
    'common.next': 'Далее',
    'common.continue': 'Продолжить',
    'common.search': 'Поиск',
    'common.email': 'Электронная почта',
    'common.password': 'Пароль',
    'common.name': 'Имя',
    'common.loading': 'Загрузка…',
    'common.empty': 'Пока ничего нет',
    'common.error': 'Произошла ошибка',
    'common.retry': 'Повторить',
    'common.draft': 'Черновик',
    'common.approved': 'Утверждено',
    'common.closed': 'Закрыто',
    'common.review': 'На проверке',
    'land.eyebrow': 'AI для юристов Узбекистана',
    'land.hero.title': 'Новый способ работы с законом',
    'land.hero.sub': 'AI-помощник по Трудовому, Гражданскому и другим кодексам. Анализирует документы, создаёт черновики, цитирует источники.',
    'land.cta.start': 'Начать бесплатно',
    'land.cta.demo': 'Посмотреть демо',
    'land.f1.t': 'Цитаты из источников',
    'land.f1.b': 'Каждый ответ ссылается на конкретные статьи кодексов.',
    'land.f2.t': 'Редактирование документов',
    'land.f2.b': 'Загрузите договор — AI отметит ошибки и критические моменты.',
    'land.f3.t': 'База клиентов',
    'land.f3.b': 'Данные клиента подставляются автоматически. Введите один раз.',
    'land.audiences': 'Для кого?',
    'land.aud.lawyer': 'Юристы',
    'land.aud.lawyer.b': 'Быстрее, точнее цитаты.',
    'land.aud.student': 'Студенты',
    'land.aud.student.b': 'Подготовка к экзаменам, Q&A.',
    'land.aud.citizen': 'Граждане',
    'land.aud.citizen.b': 'Простые ответы на простые вопросы.',
    'land.aud.firm': 'Юрфирмы',
    'land.aud.firm.b': 'Управление через Master Admin.',
    'pricing.title': 'Тарифы',
    'pricing.sub': '7 дней бесплатно. Отмена в любой момент.',
    'pricing.free.n': 'Бесплатный',
    'pricing.free.p': '0 сум',
    'pricing.pro.n': 'Pro',
    'pricing.pro.p': '290 000 сум / мес',
    'pricing.firm.n': 'Фирма',
    'pricing.firm.p': '1 200 000 сум / мес',
    'pricing.month': 'мес',
    'pricing.start': 'Начать',
    'pricing.contact': 'Связаться',
    'auth.welcome': 'Добро пожаловать в JuristAI',
    'auth.signin.t': 'Войдите в аккаунт',
    'auth.signup.t': 'Создайте аккаунт',
    'auth.reset.t': 'Сброс пароля',
    'auth.reset.sub': 'Введите email — мы отправим инструкцию.',
    'auth.no.acct': 'Нет аккаунта?',
    'auth.have.acct': 'Есть аккаунт?',
    'auth.forgot': 'Забыли пароль?',
    'auth.quick': 'Быстрый демо-вход',
    'auth.quick.sub': 'Без пароля — выберите роль одним кликом',
    'auth.lawyer': 'Как юрист',
    'auth.student': 'Как студент',
    'auth.citizen': 'Как гражданин',
    'auth.admin': 'Master Admin',
    'ob.welcome': 'Привет, {name}',
    'ob.lang.t': 'На каком языке работаем?',
    'ob.role.t': 'Ваша роль?',
    'ob.workspace.t': 'Название рабочего пространства',
    'ob.workspace.ph': 'Напр. "Каримов и партнёры"',
    'ob.done.t': 'Всё готово',
    'ob.done.b': 'Нажмите кнопку ниже, чтобы начать.',
    'ob.start': 'Начать работу',
    'nav.dashboard': 'Панель',
    'nav.chat': 'AI Чат',
    'nav.editor': 'Документы',
    'nav.clients': 'Клиенты',
    'nav.templates': 'Шаблоны',
    'nav.bookmarks': 'Закладки',
    'nav.settings': 'Настройки',
    'nav.workspace': 'Рабочее пространство',
    'nav.law': 'Законодательство',
    'nav.signout': 'Выйти',
    'dash.greet': 'Добрый день, {name}',
    'dash.eyebrow': 'Добро пожаловать',
    'dash.new.doc': 'Новый документ',
    'dash.ask': 'Спросить AI',
    'dash.recent': 'Недавние документы',
    'dash.frequent': 'Часто используемые статьи',
    'dash.quick.q': 'Быстрые вопросы',
    'dash.tasks': 'Задачи на сегодня',
    'dash.see.all': 'Все',
    'dash.s.analyzed': 'AI проанализировал на этой неделе',
    'dash.s.drafts': 'Активные черновики',
    'dash.s.clients': 'Клиенты',
    'dash.s.cited': 'Процитированные статьи',
    'chat.ph': 'Спросите про закон или загрузите документ…',
    'chat.you': 'Вы',
    'chat.ai': 'JuristAI',
    'chat.new': 'Новый чат',
    'chat.history': 'История',
    'chat.empty': 'Задайте первый вопрос',
    'chat.empty.sub': 'Спросите про Трудовой, Гражданский кодекс или любой закон.',
    'doc.untitled': 'Без названия',
    'doc.review': 'AI разбор',
    'doc.rerun': 'Перезапустить AI',
    'doc.accept.all': 'Принять все',
    'doc.sources': 'Источники',
    'doc.empty': 'Выберите документ',
    'doc.empty.sub': 'Слева в списке или создайте новый.',
    'doc.new': 'Новый документ',
    'cl.title': 'Клиенты',
    'cl.new': 'Новый клиент',
    'cl.ph.search': 'Поиск клиента…',
    'cl.empty': 'Клиентов пока нет',
    'cl.empty.sub': 'Добавьте первого — данные подставятся в документы автоматически.',
    'cl.docs': '{n} документов',
    'cl.kind.person': 'Физ. лицо',
    'cl.kind.entity': 'Юр. лицо',
    'tpl.title': 'Шаблоны документов',
    'tpl.sub': 'Выберите шаблон и клиента, AI заполнит остальное.',
    'tpl.use': 'Использовать',
    'tpl.fill.t': 'Заполните данные',
    'tpl.client': 'Выберите клиента',
    'tpl.no.client': 'Без клиента',
    'tpl.generate': 'Создать с AI',
    'tpl.generating': 'Генерация…',
    'bm.title': 'Сохранённые статьи и запросы',
    'bm.empty': 'Пока ничего не сохранено',
    'bm.empty.sub': 'Нажимайте звёздочку при чтении статей — они появятся здесь.',
    'set.title': 'Настройки',
    'set.profile': 'Профиль',
    'set.lang': 'Язык',
    'set.notif': 'Уведомления',
    'set.api': 'API ключи',
    'set.danger': 'Опасная зона',
    'set.signout.all': 'Выйти со всех устройств',
    'set.delete.acct': 'Удалить аккаунт',
    'cit.ask.t': 'Какой у вас юридический вопрос?',
    'cit.ask.sub': 'Опишите простыми словами. Мы ответим со ссылкой на закон.',
    'cit.ph': 'Напр. "Какая компенсация при увольнении?"',
    'cit.intake.t': 'Подать обращение',
    'cit.intake.sub': 'Заполните данные для рассмотрения юристом.',
    'cit.disclaimer': 'Ответы JuristAI предоставляются для информации и не заменяют юридическую консультацию.',
    'cit.welcome': 'Привет, {name}',
    'cit.h1': 'Задайте свой юридический вопрос',
    'cit.sub': 'Простыми словами — мы ответим со ссылкой на закон.',
    'cit.quick': 'Популярные вопросы',
    'cit.escalate': 'Недостаточно?',
    'cit.find.lawyer': 'Найти юриста',
    'stud.welcome': 'Добрый день, {name}',
    'stud.h1': 'Закрепите юридические знания',
    'stud.study': 'Обучение',
    'stud.study.sub': 'Развивайте знания по темам. Под каждым кодексом — список тем.',
    'stud.practice': 'Практика',
    'stud.practice.sub': 'Случайный вопрос — напишите ответ, AI оценит.',
    'stud.practice.start': 'Начать практику',
    'stud.saved': 'Сохранённые',
    'stud.check': 'Проверить',
    'stud.next': 'Следующий',
    'std.title': 'Режим обучения',
    'std.saved': 'Сохранённые вопросы',
    'std.exam': 'Тренировка экзамена',
    'std.flash': 'Карточки',
    'adm.title': 'Master Admin',
    'adm.ingest': 'Загрузка документов',
    'adm.rag': 'Редактирование чанков RAG',
    'adm.feedback': 'Отзывы пользователей',
    'adm.upload.cta': 'Перетащите PDF или DOCX',
    'adm.upload.sub': 'OCR запустится автоматически. Подтвердите в разделе RAG.',
    'adm.queue': 'Очередь обработки',
    'adm.overview': 'Обзор',
    'adm.sources': 'Источники',
    'adm.eval': 'Оценка',
    'adm.kpi.queries': 'Запросы за неделю',
    'adm.kpi.success': 'Точность',
    'adm.kpi.flagged': 'Отмеченные ответы',
    'adm.drop': 'Перетащите файл сюда',
    'adm.browse': 'Выбрать файл',
    'adm.tag.t': 'Данные источника',
    'adm.code': 'Кодекс',
    'adm.lang': 'Язык',
    'adm.version': 'Дата версии',
    'adm.ingest.now': 'Индексировать',
    'tw.title': 'Настройки вида',
    'tw.theme': 'Тема',
    'tw.light': 'Светлая',
    'tw.dark': 'Тёмная',
    'tw.accent': 'Акцент',
    'tw.density': 'Плотность',
    'tw.comfortable': 'Свободно',
    'tw.compact': 'Компактно',
    'tw.font': 'Шрифт',
    'tw.serif': 'Serif',
    'tw.sans': 'Sans',
    'role.lawyer': 'Юрист',
    'role.student': 'Студент',
    'role.citizen': 'Гражданин',
    'role.master': 'Master Admin'
  }
};
window.STRINGS = STRINGS;
window.t = function (key, vars) {
  const lang = window.__lang || 'UZ';
  let s = STRINGS[lang] && STRINGS[lang][key] || STRINGS.UZ[key] || key;
  if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  return s;
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/i18n.js", error: String((e && e.message) || e) }); }

// platform/layout.jsx
try { (() => {
// JuristAI — App shell layouts

const NAV_BY_ROLE = {
  lawyer: [{
    section: 'nav.workspace',
    items: [{
      id: 'dashboard',
      icon: 'dashboard',
      label: 'nav.dashboard',
      to: '/app/dashboard'
    }, {
      id: 'chat',
      icon: 'chat',
      label: 'nav.chat',
      to: '/app/chat'
    }, {
      id: 'editor',
      icon: 'doc',
      label: 'nav.editor',
      to: '/app/editor'
    }, {
      id: 'clients',
      icon: 'users',
      label: 'nav.clients',
      to: '/app/clients'
    }, {
      id: 'templates',
      icon: 'template',
      label: 'nav.templates',
      to: '/app/templates'
    }, {
      id: 'bookmarks',
      icon: 'bookmark',
      label: 'nav.bookmarks',
      to: '/app/bookmarks'
    }]
  }, {
    section: 'nav.settings',
    items: [{
      id: 'settings',
      icon: 'settings',
      label: 'nav.settings',
      to: '/app/settings'
    }]
  }],
  student: [{
    section: 'nav.workspace',
    items: [{
      id: 'study',
      icon: 'graduate',
      label: 'std.title',
      to: '/study'
    }, {
      id: 'saved',
      icon: 'star',
      label: 'std.saved',
      to: '/study/saved'
    }, {
      id: 'chat',
      icon: 'chat',
      label: 'nav.chat',
      to: '/app/chat'
    }]
  }, {
    section: 'nav.settings',
    items: [{
      id: 'settings',
      icon: 'settings',
      label: 'nav.settings',
      to: '/app/settings'
    }]
  }],
  master: [{
    section: 'nav.workspace',
    items: [{
      id: 'ingest',
      icon: 'upload',
      label: 'adm.ingest',
      to: '/admin/ingest'
    }, {
      id: 'rag',
      icon: 'sparkles',
      label: 'adm.rag',
      to: '/admin/rag'
    }, {
      id: 'feedback',
      icon: 'bell',
      label: 'adm.feedback',
      to: '/admin/feedback'
    }]
  }, {
    section: 'nav.settings',
    items: [{
      id: 'settings',
      icon: 'settings',
      label: 'nav.settings',
      to: '/app/settings'
    }]
  }]
};
function Sidebar({
  active
}) {
  const session = STORE.getSession();
  if (!session) return null;
  const role = session.user.role;
  const sections = NAV_BY_ROLE[role] || NAV_BY_ROLE.lawyer;
  return /*#__PURE__*/React.createElement("aside", {
    className: "sidebar"
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => navigate(homeForRole(role)),
    style: {
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Brand, null)), sections.map((sec, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    className: "nav-section"
  }, t(sec.section)), sec.items.map(item => /*#__PURE__*/React.createElement("div", {
    key: item.id,
    className: 'nav-item ' + (active === item.id ? 'active' : ''),
    onClick: () => navigate(item.to)
  }, /*#__PURE__*/React.createElement("span", {
    className: "ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: item.icon,
    size: 16
  })), t(item.label))))), /*#__PURE__*/React.createElement("div", {
    className: "nav-foot",
    onClick: () => {
      STORE.clearSession();
      navigate('/');
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "avatar"
  }, (session.user.initials || session.user.name || '?').slice(0, 2).toUpperCase()), /*#__PURE__*/React.createElement("div", {
    className: "user-info"
  }, /*#__PURE__*/React.createElement("div", {
    className: "user-name"
  }, session.user.name), /*#__PURE__*/React.createElement("div", {
    className: "user-role"
  }, t('role.' + role))), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "signout",
    size: 14
  }))));
}
function TopBar() {
  return /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "search"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 14
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: t('common.search') + '…'
  }), /*#__PURE__*/React.createElement("span", {
    className: "kbd"
  }, "\u2318K")), /*#__PURE__*/React.createElement(LangToggle, null));
}
function MobileTab({
  active
}) {
  const session = STORE.getSession();
  if (!session) return null;
  const role = session.user.role;
  const items = (NAV_BY_ROLE[role] || NAV_BY_ROLE.lawyer)[0].items.slice(0, 4);
  return /*#__PURE__*/React.createElement("nav", {
    className: "mobile-tab"
  }, items.map(it => /*#__PURE__*/React.createElement("a", {
    key: it.id,
    className: active === it.id ? 'on' : '',
    onClick: () => navigate(it.to)
  }, /*#__PURE__*/React.createElement("span", {
    className: "ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: it.icon,
    size: 18
  })), t(it.label).split(' ')[0])));
}
function AppShell({
  active,
  children,
  noPad,
  fillContent
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: active
  }), /*#__PURE__*/React.createElement("div", {
    className: "main"
  }, /*#__PURE__*/React.createElement(TopBar, null), /*#__PURE__*/React.createElement("div", {
    className: "content",
    style: noPad || fillContent ? {
      padding: 0,
      display: 'flex',
      flexDirection: 'column'
    } : {}
  }, children)), /*#__PURE__*/React.createElement(MobileTab, {
    active: active
  }));
}
function PublicShell({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "pub"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pub-top"
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => navigate('/'),
    style: {
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Brand, null)), /*#__PURE__*/React.createElement("nav", {
    className: "pub-nav"
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => navigate('/pricing')
  }, t('pricing.title')), /*#__PURE__*/React.createElement("a", {
    onClick: () => navigate('/login')
  }, t('common.signin')), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => navigate('/signup')
  }, t('common.signup')), /*#__PURE__*/React.createElement(LangToggle, null))), children, /*#__PURE__*/React.createElement("footer", {
    className: "pub-foot"
  }, /*#__PURE__*/React.createElement("div", null, "\xA9 2026 JuristAI \xB7 O'zbekiston"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("a", null, "Maxfiylik"), /*#__PURE__*/React.createElement("a", null, "Shartlar"), /*#__PURE__*/React.createElement("a", null, "Aloqa"))));
}
window.AppShell = AppShell;
window.PublicShell = PublicShell;
window.NAV_BY_ROLE = NAV_BY_ROLE;
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/layout.jsx", error: String((e && e.message) || e) }); }

// platform/pages/lawyer.jsx
try { (() => {
// Lawyer pages — Dashboard (adaptive), Chat, Editor, Clients, Templates, Bookmarks, Settings

const STATUTE_TITLES = {
  'MK·99': 'Bekor qilish asoslari',
  'MK·100': 'Ogohlantirish muddati',
  'MK·76': 'Ish vaqti',
  'MK·154': 'Ish haqi to\'lash',
  'FK·354': 'Shartnoma majburiyati',
  'FK·573': 'Ijara shartnomasi'
};
function Dashboard() {
  const session = STORE.getSession();
  const docs = STORE.getColl('docs');
  const clients = STORE.getColl('clients');
  const behavior = STORE.getBehavior();
  const firstName = (session.user.name || '').split(' ')[0];

  // Adaptive ordering: most-opened statutes first
  const frequentStatutes = Object.entries(behavior.statuteOpens || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recentDocs = [...docs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "dashboard"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, t('dash.eyebrow')), /*#__PURE__*/React.createElement("h1", {
    className: "greet"
  }, t('dash.greet', {
    name: firstName
  })), /*#__PURE__*/React.createElement("div", {
    className: "stats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat featured"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, t('dash.s.analyzed')), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "47 hujjat"), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "\u2191 18% o'tgan haftaga nisbatan")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, t('dash.s.drafts')), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, docs.filter(d => d.status === 'draft').length), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "3 tasi bugun ko'rib chiqilishi kerak")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, t('dash.s.clients')), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, clients.length), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "2 ta yangi shu oy")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, t('dash.s.cited')), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, Object.keys(behavior.statuteOpens || {}).length), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "eng tez-tez: MK\xB799"))), /*#__PURE__*/React.createElement("div", {
    className: "dash-grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "h-section-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-section"
  }, t('dash.recent')), /*#__PURE__*/React.createElement("a", {
    className: "more",
    onClick: () => navigate('/app/editor')
  }, t('dash.see.all'), " \u2192")), /*#__PURE__*/React.createElement("div", {
    className: "dash-grid-3",
    style: {
      gridTemplateColumns: '1fr 1fr'
    }
  }, recentDocs.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.id,
    className: "doc",
    onClick: () => {
      STORE.bump('doc', d.id);
      navigate('/app/editor/' + d.id);
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "doc-icon"
  }), /*#__PURE__*/React.createElement("div", {
    className: "doc-name"
  }, d.name), /*#__PURE__*/React.createElement("div", {
    className: "doc-meta"
  }, d.type.toUpperCase()), /*#__PURE__*/React.createElement("div", {
    className: "doc-foot"
  }, /*#__PURE__*/React.createElement(StatusBadge, {
    status: d.status
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--fg-3)'
    }
  }, relTime(d.updatedAt))))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "h-section-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-section"
  }, t('dash.frequent')), /*#__PURE__*/React.createElement("a", {
    className: "more",
    onClick: () => navigate('/app/bookmarks')
  }, t('dash.see.all'), " \u2192")), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 8
    }
  }, frequentStatutes.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24,
      textAlign: 'center',
      color: 'var(--fg-3)',
      fontSize: 13
    }
  }, "Hali statistika yo'q"), frequentStatutes.map(([code, n]) => /*#__PURE__*/React.createElement("div", {
    key: code,
    className: "statute-row",
    onClick: () => {
      STORE.bump('statute', code);
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-num"
  }, code), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-tt"
  }, STATUTE_TITLES[code] || 'Modda'), /*#__PURE__*/React.createElement("div", {
    className: "statute-co"
  }, n, " marta murojaat")), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))))), /*#__PURE__*/React.createElement("div", {
    className: "dash-grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "h-section"
  }, t('dash.quick.q')), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, ['Mehnat shartnomasini qanday bekor qilish mumkin?', 'Ish haqi qachon to\'lanishi kerak?', 'Ijara shartnomasi shakli qanday?', 'NDA da nima bo\'lishi kerak?'].map(q => /*#__PURE__*/React.createElement("div", {
    key: q,
    onClick: () => navigate('/app/chat?q=' + encodeURIComponent(q)),
    style: {
      padding: '10px 12px',
      background: 'var(--bg-1)',
      borderRadius: 8,
      cursor: 'pointer',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      border: '1px solid var(--border-1)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 14
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, q), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 12
  }))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "h-section"
  }, t('dash.tasks')), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, [['09:00', 'Karimov bilan uchrashuv', 'warn'], ['11:30', 'Ijara qoralamasini yakunlash', 'info'], ['14:00', 'SilkRoad NDA imzolash', 'success'], ['16:30', 'Yangi mijoz: Bekzod T.', 'neutral']].map(([time, ttl, kind]) => /*#__PURE__*/React.createElement("div", {
    key: ttl,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: 8,
      background: 'var(--bg-1)',
      borderRadius: 8,
      border: '1px solid var(--border-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 12px/1 var(--font-mono)',
      color: 'var(--fg-3)',
      minWidth: 44
    }
  }, time), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 13
    }
  }, ttl), /*#__PURE__*/React.createElement(Badge, {
    kind: kind,
    dot: true
  }, "\xB7")))))));
}
function relTime(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'hozirgina';
  if (d < 3600) return Math.floor(d / 60) + ' daq';
  if (d < 86400) return Math.floor(d / 3600) + ' soat';
  return Math.floor(d / 86400) + ' kun';
}

// ─── Chat ─────────────────────────────────────────────────────
function ChatPage() {
  const route = useRoute();
  const chats = STORE.getColl('chats');
  const [activeId, setActiveId] = React.useState(chats[0]?.id || null);
  const [msgs, setMsgs] = React.useState(chats[0]?.messages || []);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const threadRef = React.useRef();
  React.useEffect(() => {
    const q = new URLSearchParams(route.hash.split('?')[1] || '').get('q');
    if (q) {
      setText(q);
    }
  }, []);
  React.useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [msgs, busy]);
  const selectChat = id => {
    const c = STORE.getColl('chats').find(x => x.id === id);
    if (c) {
      setActiveId(id);
      setMsgs(c.messages);
    }
  };
  const newChat = () => {
    const c = {
      id: 'ch_' + Date.now(),
      title: t('chat.new'),
      createdAt: Date.now(),
      messages: []
    };
    STORE.pushColl('chats', c);
    setActiveId(c.id);
    setMsgs([]);
  };
  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    let chats = STORE.getColl('chats');
    let chat = chats.find(c => c.id === activeId);
    if (!chat) {
      chat = {
        id: 'ch_' + Date.now(),
        title: q.slice(0, 36),
        createdAt: Date.now(),
        messages: []
      };
      STORE.pushColl('chats', chat);
      setActiveId(chat.id);
    }
    const userMsg = {
      who: 'me',
      content: q,
      at: Date.now()
    };
    chat.messages = [...chat.messages, userMsg];
    if (chat.messages.length === 1) chat.title = q.slice(0, 36);
    STORE.patchColl('chats', chat.id, chat);
    setMsgs([...chat.messages]);
    setBusy(true);
    const res = await STORE.askAI({
      mode: 'chat',
      prompt: q
    });
    const aiMsg = {
      who: 'ai',
      content: res.content,
      citations: res.citations,
      at: Date.now()
    };
    chat.messages = [...chat.messages, aiMsg];
    STORE.patchColl('chats', chat.id, chat);
    setMsgs([...chat.messages]);
    setBusy(false);
  };
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "chat",
    fillContent: true
  }, /*#__PURE__*/React.createElement("div", {
    className: "chat-layout"
  }, /*#__PURE__*/React.createElement("div", {
    className: "chat-side"
  }, /*#__PURE__*/React.createElement(Button, {
    block: true,
    size: "sm",
    onClick: newChat
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " ", t('chat.new')), /*#__PURE__*/React.createElement("h4", null, t('chat.history')), chats.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    className: 'chat-item ' + (c.id === activeId ? 'active' : ''),
    onClick: () => selectChat(c.id)
  }, /*#__PURE__*/React.createElement("div", null, c.title), /*#__PURE__*/React.createElement("div", {
    className: "when"
  }, relTime(c.createdAt))))), /*#__PURE__*/React.createElement("div", {
    className: "chat"
  }, msgs.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty-state"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chat",
    size: 26
  })), /*#__PURE__*/React.createElement("h3", null, t('chat.empty')), /*#__PURE__*/React.createElement("p", null, t('chat.empty.sub'))) : /*#__PURE__*/React.createElement("div", {
    className: "thread",
    ref: threadRef
  }, msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'bubble-row ' + (m.who === 'me' ? 'me' : 'ai')
  }, /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, m.who === 'me' ? t('chat.you') : t('chat.ai')), /*#__PURE__*/React.createElement("div", {
    className: 'bubble ' + (m.who === 'me' ? 'user' : 'ai')
  }, m.who === 'ai' ? renderAI(m.content, m.citations) : m.content, m.citations?.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "cite-list"
  }, m.citations.map(c => /*#__PURE__*/React.createElement("span", {
    key: c.id,
    className: "cite",
    title: c.label
  }, c.label)))))), busy && /*#__PURE__*/React.createElement("div", {
    className: "bubble-row ai"
  }, /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, t('chat.ai')), /*#__PURE__*/React.createElement("div", {
    className: "bubble ai"
  }, /*#__PURE__*/React.createElement("span", {
    className: "thinking"
  }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null))))), /*#__PURE__*/React.createElement("div", {
    className: "composer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "composer-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "composer-input-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "composer-input",
    contentEditable: true,
    "data-ph": t('chat.ph'),
    suppressContentEditableWarning: true,
    onInput: e => setText(e.currentTarget.textContent),
    onKeyDown: e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
        e.currentTarget.textContent = '';
      }
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "composer-tools"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tool-icons"
  }, /*#__PURE__*/React.createElement("button", {
    className: "tool",
    title: "Fayl biriktirish"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "paperclip",
    size: 14
  })), /*#__PURE__*/React.createElement("button", {
    className: "tool",
    title: "Mikrofon"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "mic",
    size: 14
  }))), /*#__PURE__*/React.createElement(Button, {
    onClick: send,
    disabled: busy || !text.trim()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "send",
    size: 13
  }), " ", t('common.send'))))))));
}

// ─── Editor ───────────────────────────────────────────────────
function EditorPage() {
  const route = useRoute();
  const docs = STORE.getColl('docs');
  const docId = route.parts[2] || docs[0]?.id;
  const [active, setActive] = React.useState(docId);
  const doc = docs.find(d => d.id === active) || docs[0];
  const [body, setBody] = React.useState(doc?.body || '');
  const [name, setName] = React.useState(doc?.name || '');
  const [issues, setIssues] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const paperRef = React.useRef();
  React.useEffect(() => {
    if (doc) {
      setBody(doc.body);
      setName(doc.name);
      STORE.bump('doc', doc.id);
    }
  }, [active]);
  const select = id => {
    saveCurrent();
    setActive(id);
  };
  const saveCurrent = () => {
    if (!doc) return;
    STORE.patchColl('docs', doc.id, {
      body: paperRef.current?.innerHTML || body,
      name,
      updatedAt: Date.now()
    });
  };
  const newDoc = () => {
    const d = {
      id: 'd_' + Date.now(),
      name: t('doc.untitled'),
      type: 'shartnoma',
      body: '<h1>' + t('doc.untitled') + '</h1><p>Bu yerga yozing…</p>',
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    STORE.pushColl('docs', d);
    setActive(d.id);
  };
  const runReview = async () => {
    setBusy(true);
    setIssues([]);
    await new Promise(r => setTimeout(r, 1200));
    setIssues([{
      kind: 'danger',
      ic: '!',
      ttl: '5-band: noaniq muddat',
      msg: 'Tugash sanasi ko\'rsatilmagan. MK·73 bo\'yicha aniq ko\'rsatilishi shart.'
    }, {
      kind: 'warn',
      ic: '?',
      ttl: 'Ish haqi formati',
      msg: 'Summa raqamlar va so\'z bilan yozilishi tavsiya etiladi.'
    }, {
      kind: 'ai',
      ic: '★',
      ttl: 'AI taklifi: Konfidentsiallik bandi',
      msg: 'NDA shartlari uchun standart band qo\'shishni tavsiya qilamiz.'
    }]);
    setBusy(false);
  };
  if (!doc) {
    return /*#__PURE__*/React.createElement(AppShell, {
      active: "editor"
    }, /*#__PURE__*/React.createElement("div", {
      className: "empty-state",
      style: {
        minHeight: 400
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "ic"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "doc",
      size: 26
    })), /*#__PURE__*/React.createElement("h3", null, t('doc.empty')), /*#__PURE__*/React.createElement("p", null, t('doc.empty.sub')), /*#__PURE__*/React.createElement(Button, {
      onClick: newDoc
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 14
    }), " ", t('doc.new'))));
  }
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "editor",
    fillContent: true
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 18,
      height: '100%',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "editor-layout"
  }, /*#__PURE__*/React.createElement("div", {
    className: "editor-list"
  }, /*#__PURE__*/React.createElement(Button, {
    block: true,
    size: "sm",
    onClick: newDoc
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " ", t('doc.new')), /*#__PURE__*/React.createElement("h4", null, "Hujjatlar"), docs.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.id,
    className: 'doc-tile ' + (d.id === active ? 'active' : ''),
    onClick: () => select(d.id)
  }, /*#__PURE__*/React.createElement("div", null, d.name), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, d.type.toUpperCase(), " \xB7 ", relTime(d.updatedAt))))), /*#__PURE__*/React.createElement("div", {
    className: "editor-stage"
  }, /*#__PURE__*/React.createElement("div", {
    className: "editor-bar"
  }, /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => setName(e.target.value),
    onBlur: saveCurrent
  }), /*#__PURE__*/React.createElement(StatusBadge, {
    status: doc.status
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    onClick: runReview,
    disabled: busy
  }, busy ? /*#__PURE__*/React.createElement("span", {
    className: "spinner"
  }) : /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 13
  }), " ", t('doc.rerun')), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: saveCurrent
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13
  }), " ", t('common.save'))), /*#__PURE__*/React.createElement("div", {
    className: "paper",
    ref: paperRef,
    contentEditable: true,
    suppressContentEditableWarning: true,
    onBlur: saveCurrent,
    dangerouslySetInnerHTML: {
      __html: body
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "review"
  }, /*#__PURE__*/React.createElement("div", {
    className: "review-h"
  }, /*#__PURE__*/React.createElement("span", null, t('doc.review')), issues.length > 0 && /*#__PURE__*/React.createElement(Badge, {
    kind: "brass",
    dot: true
  }, issues.length)), busy && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "skeleton",
    style: {
      height: 60
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "skeleton",
    style: {
      height: 60
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "skeleton",
    style: {
      height: 60
    }
  })), !busy && issues.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      background: 'var(--success-100)',
      borderColor: '#BFE0C8',
      color: '#2F6B43'
    }
  }, /*#__PURE__*/React.createElement("strong", null, "Tahlil tayyor."), " Hujjatda muammolar topilmadi. Yangidan ishga tushirish uchun yuqorida tugmani bosing."), !busy && issues.map((iss, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'alert a-' + iss.kind
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, iss.ic), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ttl"
  }, iss.ttl), /*#__PURE__*/React.createElement("div", {
    className: "msg"
  }, iss.msg)))), issues.length > 0 && /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    block: true,
    style: {
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13
  }), " ", t('doc.accept.all'))))));
}

// ─── Clients ──────────────────────────────────────────────────
function ClientsPage() {
  const [clients, setClients] = React.useState(STORE.getColl('clients'));
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    name: '',
    kind: 'person',
    jshshir: '',
    inn: '',
    email: '',
    phone: ''
  });
  const filtered = clients.filter(c => !search || (c.name || '').toLowerCase().includes(search.toLowerCase()));
  const addClient = () => {
    if (!form.name.trim()) return;
    const c = {
      id: 'c_' + Date.now(),
      ...form,
      docCount: 0,
      lastTouched: Date.now()
    };
    STORE.pushColl('clients', c);
    setClients(STORE.getColl('clients'));
    setOpen(false);
    setForm({
      name: '',
      kind: 'person',
      jshshir: '',
      inn: '',
      email: '',
      phone: ''
    });
    showToast('Mijoz qo\'shildi');
  };
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "clients"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-section-row"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, t('cl.title')), /*#__PURE__*/React.createElement("h1", {
    className: "greet",
    style: {
      marginBottom: 0
    }
  }, clients.length, " ", t('cl.title').toLowerCase())), /*#__PURE__*/React.createElement(Button, {
    onClick: () => setOpen(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " ", t('cl.new'))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      margin: '20px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "search",
    style: {
      maxWidth: 320,
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 14
  }), /*#__PURE__*/React.createElement("input", {
    value: search,
    onChange: e => setSearch(e.target.value),
    placeholder: t('cl.ph.search')
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "filter",
    size: 13
  }), " Filtr")), filtered.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty-state",
    style: {
      minHeight: 280,
      background: 'var(--bg-2)',
      border: '1px solid var(--border-1)',
      borderRadius: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 26
  })), /*#__PURE__*/React.createElement("h3", null, t('cl.empty')), /*#__PURE__*/React.createElement("p", null, t('cl.empty.sub')), /*#__PURE__*/React.createElement(Button, {
    onClick: () => setOpen(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " ", t('cl.new'))) : /*#__PURE__*/React.createElement("div", {
    className: "tbl-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbl-h"
  }, /*#__PURE__*/React.createElement("div", null), /*#__PURE__*/React.createElement("div", null, "Mijoz"), /*#__PURE__*/React.createElement("div", null, "STIR / JShShIR"), /*#__PURE__*/React.createElement("div", null, "Aloqa"), /*#__PURE__*/React.createElement("div", null, "Hujjatlar")), filtered.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    className: "client-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "avatar"
  }, (c.name || '?').slice(0, 2).toUpperCase()), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "client-name"
  }, c.name), /*#__PURE__*/React.createElement("div", {
    className: "client-meta"
  }, c.kind === 'person' ? t('cl.kind.person') : t('cl.kind.entity'))), /*#__PURE__*/React.createElement("div", {
    className: "client-meta type-mono",
    style: {
      fontFamily: 'var(--font-mono)'
    }
  }, c.inn || c.jshshir || '—'), /*#__PURE__*/React.createElement("div", {
    className: "client-meta"
  }, c.email, /*#__PURE__*/React.createElement("br", null), c.phone), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Badge, {
    kind: "neutral"
  }, t('cl.docs', {
    n: c.docCount
  })))))), /*#__PURE__*/React.createElement(Modal, {
    open: open,
    onClose: () => setOpen(false),
    title: t('cl.new'),
    sub: "Mijoz ma'lumotlarini kiriting",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: () => setOpen(false)
    }, t('common.cancel')), /*#__PURE__*/React.createElement(Button, {
      onClick: addClient
    }, t('common.save')))
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Tur"), /*#__PURE__*/React.createElement("div", {
    className: "tw-seg",
    style: {
      width: 'fit-content'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: form.kind === 'person' ? 'on' : '',
    onClick: () => setForm({
      ...form,
      kind: 'person'
    })
  }, t('cl.kind.person')), /*#__PURE__*/React.createElement("button", {
    className: form.kind === 'entity' ? 'on' : '',
    onClick: () => setForm({
      ...form,
      kind: 'entity'
    })
  }, t('cl.kind.entity')))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Ism / Nomi"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: form.name,
    onChange: e => setForm({
      ...form,
      name: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, form.kind === 'person' ? 'JShShIR' : 'STIR'), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: form.kind === 'person' ? form.jshshir : form.inn,
    onChange: e => setForm({
      ...form,
      [form.kind === 'person' ? 'jshshir' : 'inn']: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.email')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "email",
    value: form.email,
    onChange: e => setForm({
      ...form,
      email: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, "Telefon"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: form.phone,
    onChange: e => setForm({
      ...form,
      phone: e.target.value
    })
  }))));
}

// ─── Templates ────────────────────────────────────────────────
const TEMPLATES = [{
  id: 'shartnoma',
  name: 'Mehnat shartnomasi',
  desc: 'Standart mehnat shartnomasi, ish beruvchi va xodim o\'rtasida.',
  icon: 'doc',
  fields: 12,
  time: '5 daq'
}, {
  id: 'ijara',
  name: 'Ijara shartnomasi',
  desc: 'Ko\'chmas mulk yoki transport vositasi ijarasi.',
  icon: 'doc',
  fields: 9,
  time: '4 daq'
}, {
  id: 'nda',
  name: 'Maxfiylik shartnomasi (NDA)',
  desc: 'Ikki tomonlama maxfiylik majburiyati.',
  icon: 'doc',
  fields: 7,
  time: '3 daq'
}, {
  id: 'olib-sotish',
  name: 'Oldi-sotdi shartnomasi',
  desc: 'Tovar yoki xizmatni sotib olish/sotish.',
  icon: 'doc',
  fields: 10,
  time: '5 daq'
}, {
  id: 'vakolat',
  name: 'Ishonchnoma',
  desc: 'Boshqa shaxs nomidan vakolat berish.',
  icon: 'doc',
  fields: 6,
  time: '3 daq'
}, {
  id: 'ariza',
  name: 'Sud arizasi',
  desc: 'Fuqarolik nizolari bo\'yicha sudga ariza.',
  icon: 'doc',
  fields: 14,
  time: '8 daq'
}];
function TemplatesPage() {
  const [picked, setPicked] = React.useState(null);
  const [clientId, setClientId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const clients = STORE.getColl('clients');
  const generate = async () => {
    setBusy(true);
    await new Promise(r => setTimeout(r, 1500));
    const client = clients.find(c => c.id === clientId);
    const d = {
      id: 'd_' + Date.now(),
      name: picked.name + (client ? ' — ' + client.name : ''),
      type: picked.id,
      body: '<h1>' + picked.name + '</h1>' + (client ? '<p><strong>Mijoz:</strong> ' + client.name + ' (' + (client.inn || client.jshshir || '') + ')</p>' : '') + '<p>Sana: ' + new Date().toLocaleDateString('uz-UZ') + '</p>' + '<p>1. Tomonlar:<br/>1.1. Birinchi tomon — _________<br/>1.2. Ikkinchi tomon — ' + (client?.name || '_________') + '</p>' + '<p>2. Shartnoma predmeti…</p>' + '<p>3. Tomonlar majburiyatlari…</p>' + '<p>4. Imzolar:<br/>_________ / _________</p>',
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      clientId: client?.id
    };
    STORE.pushColl('docs', d);
    STORE.bump('template', picked.id);
    setBusy(false);
    setPicked(null);
    showToast('Qoralama yaratildi');
    navigate('/app/editor/' + d.id);
  };
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "templates"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, t('tpl.sub')), /*#__PURE__*/React.createElement("h1", {
    className: "greet"
  }, t('tpl.title')), /*#__PURE__*/React.createElement("div", {
    className: "tpl-grid",
    style: {
      marginTop: 24
    }
  }, TEMPLATES.map(tpl => /*#__PURE__*/React.createElement("div", {
    key: tpl.id,
    className: "tpl-card",
    onClick: () => setPicked(tpl)
  }, /*#__PURE__*/React.createElement("div", {
    className: "tpl-icon"
  }), /*#__PURE__*/React.createElement("div", {
    className: "tpl-name"
  }, tpl.name), /*#__PURE__*/React.createElement("div", {
    className: "tpl-desc"
  }, tpl.desc), /*#__PURE__*/React.createElement("div", {
    className: "tpl-meta"
  }, /*#__PURE__*/React.createElement("span", null, tpl.fields, " maydon"), /*#__PURE__*/React.createElement("span", null, "~", tpl.time)), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      marginTop: 8
    }
  }, t('tpl.use'), " \u2192")))), /*#__PURE__*/React.createElement(Modal, {
    open: !!picked,
    onClose: () => !busy && setPicked(null),
    title: picked?.name,
    sub: t('tpl.fill.t'),
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: () => setPicked(null),
      disabled: busy
    }, t('common.cancel')), /*#__PURE__*/React.createElement(Button, {
      onClick: generate,
      disabled: busy
    }, busy ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "spinner"
    }), " ", t('tpl.generating')) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 13
    }), " ", t('tpl.generate'))))
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('tpl.client')), /*#__PURE__*/React.createElement("select", {
    className: "input",
    value: clientId,
    onChange: e => setClientId(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u2014 ", t('tpl.no.client'), " \u2014"), clients.map(c => /*#__PURE__*/React.createElement("option", {
    key: c.id,
    value: c.id
  }, c.name))), /*#__PURE__*/React.createElement("div", {
    className: "hint"
  }, "Mijoz tanlasangiz, ma'lumotlari avtomatik to'ldiriladi."))));
}

// ─── Bookmarks ────────────────────────────────────────────────
function BookmarksPage() {
  const bms = STORE.getColl('bookmarks');
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "bookmarks"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, t('bm.title')), /*#__PURE__*/React.createElement("h1", {
    className: "greet"
  }, bms.length, " ", t('bm.title').toLowerCase()), bms.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty-state",
    style: {
      minHeight: 320,
      background: 'var(--bg-2)',
      border: '1px solid var(--border-1)',
      borderRadius: 12,
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bookmark",
    size: 26
  })), /*#__PURE__*/React.createElement("h3", null, t('bm.empty')), /*#__PURE__*/React.createElement("p", null, t('bm.empty.sub'))) : /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 8,
      marginTop: 24
    }
  }, bms.map(b => /*#__PURE__*/React.createElement("div", {
    key: b.id,
    className: "statute-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-num"
  }, b.payload.code, "\xB7", b.payload.n), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-tt"
  }, b.payload.title), /*#__PURE__*/React.createElement("div", {
    className: "statute-co"
  }, "Saqlangan: ", new Date(b.savedAt).toLocaleDateString())), /*#__PURE__*/React.createElement("button", {
    className: "tool",
    onClick: e => {
      e.stopPropagation();
      STORE.removeColl('bookmarks', b.id);
      window.location.reload();
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "star",
    size: 14
  }))))));
}

// ─── Settings ─────────────────────────────────────────────────
function SettingsPage() {
  const session = STORE.getSession();
  const [tab, setTab] = React.useState('profile');
  const [name, setName] = React.useState(session.user.name);
  const [email, setEmail] = React.useState(session.user.email);
  const [notif, setNotif] = React.useState({
    docs: true,
    clients: true,
    weekly: false
  });
  const save = () => {
    STORE.setSession({
      ...session,
      user: {
        ...session.user,
        name,
        email
      }
    });
    showToast('Saqlandi');
  };
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "settings"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, t('set.title')), /*#__PURE__*/React.createElement("h1", {
    className: "greet"
  }, t('set.title')), /*#__PURE__*/React.createElement("div", {
    className: "adm-tab",
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: tab === 'profile' ? 'on' : '',
    onClick: () => setTab('profile')
  }, t('set.profile')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'notif' ? 'on' : '',
    onClick: () => setTab('notif')
  }, t('set.notif')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'api' ? 'on' : '',
    onClick: () => setTab('api')
  }, t('set.api')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'danger' ? 'on' : '',
    onClick: () => setTab('danger')
  }, t('set.danger'))), tab === 'profile' && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      maxWidth: 560
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.name')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: name,
    onChange: e => setName(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.email')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: email,
    onChange: e => setEmail(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('set.lang')), /*#__PURE__*/React.createElement(LangToggle, null)), /*#__PURE__*/React.createElement(Button, {
    onClick: save
  }, t('common.save'))), tab === 'notif' && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      maxWidth: 560,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, [['docs', 'Hujjat statusi o\'zgarganida', 'Mijoz hujjati tasdiqlandi yoki rad etilganida'], ['clients', 'Yangi mijoz qo\'shilganida', 'Jamoa a\'zolari mijoz qo\'shganda'], ['weekly', 'Haftalik hisobot', 'Har dushanba ertalab']].map(([key, ttl, sub]) => /*#__PURE__*/React.createElement("label", {
    key: key,
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: notif[key],
    onChange: e => setNotif({
      ...notif,
      [key]: e.target.checked
    }),
    style: {
      marginTop: 4
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 14px/1.3 var(--font-sans)',
      color: 'var(--fg-1)'
    }
  }, ttl), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--fg-3)',
      marginTop: 2
    }
  }, sub))))), tab === 'api' && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      maxWidth: 720
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      font: '600 16px/1.3 var(--font-serif)',
      marginBottom: 6
    }
  }, "API kalitlari"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--fg-3)',
      marginBottom: 16
    }
  }, "O'z RAG tizimingizni ulash uchun JuristAI API ni ishlating."), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--bg-1)',
      border: '1px solid var(--border-1)',
      borderRadius: 10,
      padding: '12px 14px',
      font: '500 13px/1.4 var(--font-mono)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", null, "jai_live_\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022a91f"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, "Ko'rsatish")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, "Yangi kalit yaratish"))), tab === 'danger' && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      maxWidth: 560,
      borderColor: 'var(--danger-100)',
      background: '#FFF8F8'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      font: '600 16px/1.3 var(--font-serif)',
      color: 'var(--danger-700)',
      marginBottom: 6
    }
  }, t('set.danger')), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--fg-2)',
      marginBottom: 16
    }
  }, "Bu amallarni qaytarib bo'lmaydi. Ehtiyot bo'ling."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, t('set.signout.all')), /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "sm"
  }, t('set.delete.acct')))));
}
window.Dashboard = Dashboard;
window.ChatPage = ChatPage;
window.EditorPage = EditorPage;
window.ClientsPage = ClientsPage;
window.TemplatesPage = TemplatesPage;
window.BookmarksPage = BookmarksPage;
window.SettingsPage = SettingsPage;
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/pages/lawyer.jsx", error: String((e && e.message) || e) }); }

// platform/pages/public.jsx
try { (() => {
// Public pages: Landing, Pricing, Login, Signup, Reset, Onboarding

function Landing() {
  return /*#__PURE__*/React.createElement(PublicShell, null, /*#__PURE__*/React.createElement("section", {
    className: "hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hero-eyebrow"
  }, t('land.eyebrow')), /*#__PURE__*/React.createElement("h1", null, t('land.hero.title')), /*#__PURE__*/React.createElement("p", null, t('land.hero.sub')), /*#__PURE__*/React.createElement("div", {
    className: "hero-cta"
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    onClick: () => navigate('/signup')
  }, t('land.cta.start'), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 16
  })), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    variant: "secondary",
    onClick: () => navigate('/login')
  }, t('land.cta.demo')))), /*#__PURE__*/React.createElement("section", {
    className: "feature-grid"
  }, [['scale', 'land.f1.t', 'land.f1.b'], ['doc', 'land.f2.t', 'land.f2.b'], ['users', 'land.f3.t', 'land.f3.b']].map(([ic, ti, bo]) => /*#__PURE__*/React.createElement("div", {
    key: ti,
    className: "feat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "feat-ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 22
  })), /*#__PURE__*/React.createElement("h3", null, t(ti)), /*#__PURE__*/React.createElement("p", null, t(bo))))), /*#__PURE__*/React.createElement("section", {
    className: "audiences"
  }, /*#__PURE__*/React.createElement("div", {
    className: "aud-inner"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "aud-h"
  }, t('land.audiences')), /*#__PURE__*/React.createElement("div", {
    className: "aud-grid"
  }, [['scale', 'land.aud.lawyer', 'land.aud.lawyer.b'], ['graduate', 'land.aud.student', 'land.aud.student.b'], ['user', 'land.aud.citizen', 'land.aud.citizen.b'], ['building', 'land.aud.firm', 'land.aud.firm.b']].map(([ic, t1, t2]) => /*#__PURE__*/React.createElement("div", {
    key: t1,
    className: "aud-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 18
  })), /*#__PURE__*/React.createElement("h4", null, t(t1)), /*#__PURE__*/React.createElement("p", null, t(t2))))))), /*#__PURE__*/React.createElement("section", {
    className: "preview-band"
  }, /*#__PURE__*/React.createElement("h2", null, "Demoni ko'ring"), /*#__PURE__*/React.createElement("p", null, "Bir bosishda demo akkauntga kiring va platformani sinab ko'ring."), /*#__PURE__*/React.createElement("div", {
    className: "screenshot-frame"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'linear-gradient(135deg,#FBF8F2,#F5EFE3)',
      padding: '60px 40px',
      textAlign: 'center',
      color: 'var(--fg-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 22,
      color: 'var(--fg-1)',
      marginBottom: 18
    }
  }, "Boshqaruv paneli \xB7 AI Suhbat \xB7 Hujjat tahriri"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => navigate('/login')
  }, t('auth.quick'), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  }))))));
}
function Pricing() {
  return /*#__PURE__*/React.createElement(PublicShell, null, /*#__PURE__*/React.createElement("section", {
    className: "pricing"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pricing-h"
  }, /*#__PURE__*/React.createElement("h1", null, t('pricing.title')), /*#__PURE__*/React.createElement("p", null, t('pricing.sub'))), /*#__PURE__*/React.createElement("div", {
    className: "pricing-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "plan"
  }, /*#__PURE__*/React.createElement("div", {
    className: "plan-name"
  }, t('pricing.free.n')), /*#__PURE__*/React.createElement("div", {
    className: "plan-price"
  }, t('pricing.free.p')), /*#__PURE__*/React.createElement("div", {
    className: "plan-meta"
  }, "\u2014 oddiy fuqarolar uchun"), /*#__PURE__*/React.createElement("ul", null, /*#__PURE__*/React.createElement("li", null, "Cheksiz yuridik savollar"), /*#__PURE__*/React.createElement("li", null, "Manbalardan iqtibos"), /*#__PURE__*/React.createElement("li", null, "2 ta hujjat tahlili / oy"), /*#__PURE__*/React.createElement("li", null, "Telegram bot")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    block: true,
    onClick: () => navigate('/signup')
  }, t('pricing.start'))), /*#__PURE__*/React.createElement("div", {
    className: "plan featured"
  }, /*#__PURE__*/React.createElement("div", {
    className: "plan-name"
  }, t('pricing.pro.n')), /*#__PURE__*/React.createElement("div", {
    className: "plan-price"
  }, t('pricing.pro.p')), /*#__PURE__*/React.createElement("div", {
    className: "plan-meta"
  }, "yurist va talabalar uchun"), /*#__PURE__*/React.createElement("ul", null, /*#__PURE__*/React.createElement("li", null, "Cheksiz hujjat tahlili"), /*#__PURE__*/React.createElement("li", null, "AI bilan qoralama yaratish"), /*#__PURE__*/React.createElement("li", null, "Mijozlar bazasi (50 tagacha)"), /*#__PURE__*/React.createElement("li", null, "Andoza kutubxonasi"), /*#__PURE__*/React.createElement("li", null, "Eksport: PDF, DOCX")), /*#__PURE__*/React.createElement(Button, {
    block: true,
    onClick: () => navigate('/signup')
  }, t('pricing.start'))), /*#__PURE__*/React.createElement("div", {
    className: "plan"
  }, /*#__PURE__*/React.createElement("div", {
    className: "plan-name"
  }, t('pricing.firm.n')), /*#__PURE__*/React.createElement("div", {
    className: "plan-price"
  }, t('pricing.firm.p')), /*#__PURE__*/React.createElement("div", {
    className: "plan-meta"
  }, "yuridik firmalar uchun"), /*#__PURE__*/React.createElement("ul", null, /*#__PURE__*/React.createElement("li", null, "Pro + barcha imkoniyatlar"), /*#__PURE__*/React.createElement("li", null, "10 tagacha foydalanuvchi"), /*#__PURE__*/React.createElement("li", null, "Master Admin paneli"), /*#__PURE__*/React.createElement("li", null, "O'z bazangizni yuklash (RAG)"), /*#__PURE__*/React.createElement("li", null, "API kalitlari"), /*#__PURE__*/React.createElement("li", null, "Ustuvor qo'llab-quvvatlash")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    block: true,
    onClick: () => navigate('/signup')
  }, t('pricing.contact'))))));
}
function AuthArt() {
  return /*#__PURE__*/React.createElement("div", {
    className: "auth-art"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "seal"
  }, "\u2696"), /*#__PURE__*/React.createElement("h2", null, t('auth.welcome')), /*#__PURE__*/React.createElement("p", null, "O'zbekiston yuristlari uchun sun'iy intellekt asosidagi ish maydoni. Aniq iqtiboslar, tezkor qoralamalar, mijozlar bazasi.")), /*#__PURE__*/React.createElement("div", {
    className: "quote"
  }, "\"JuristAI bilan har bir savolga 30 soniyada javob topaman. Mijozga zudlik bilan yo'naltirish \u2014 bu bizning farqimiz.\"", /*#__PURE__*/React.createElement("div", {
    className: "quote-by"
  }, "\u2014 Aziza T., Yuridik maslahatchi")));
}
function Login() {
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [err, setErr] = React.useState('');
  const submit = e => {
    e?.preventDefault();
    if (!email) {
      setErr('Email kerak');
      return;
    }
    quickLogin('lawyer', email);
  };
  const quickLogin = (role, customEmail) => {
    const seedUser = {
      lawyer: {
        name: 'Aziza Tursunova',
        email: 'aziza@law.uz'
      },
      student: {
        name: 'Bobur Yusupov',
        email: 'bobur@uz'
      },
      citizen: {
        name: 'Mehmon foydalanuvchi',
        email: 'guest@uz'
      },
      master: {
        name: 'Master Admin',
        email: 'admin@juristai.uz'
      }
    }[role];
    const u = {
      id: 'u1',
      role,
      ...seedUser
    };
    if (customEmail && customEmail.trim()) u.email = customEmail;
    u.initials = u.name.split(' ').map(s => s[0]).join('').slice(0, 2);
    STORE.setSession({
      user: u,
      loggedInAt: Date.now()
    });
    navigate(homeForRole(role));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "pub",
    style: {
      minHeight: '100vh'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pub-top"
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => navigate('/'),
    style: {
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Brand, null)), /*#__PURE__*/React.createElement(LangToggle, null)), /*#__PURE__*/React.createElement("div", {
    className: "auth-shell"
  }, /*#__PURE__*/React.createElement(AuthArt, null), /*#__PURE__*/React.createElement("div", {
    className: "auth-form-wrap"
  }, /*#__PURE__*/React.createElement("form", {
    className: "auth-form",
    onSubmit: submit
  }, /*#__PURE__*/React.createElement("h1", null, t('auth.signin.t')), /*#__PURE__*/React.createElement("p", {
    className: "auth-sub"
  }, t('auth.welcome')), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.email')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "aziza@law.uz"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.password')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    value: pw,
    onChange: e => setPw(e.target.value),
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
  })), err && /*#__PURE__*/React.createElement("div", {
    className: "error"
  }, err), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    block: true,
    size: "lg",
    style: {
      marginTop: 4
    }
  }, t('common.signin'), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: 12,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("a", {
    style: {
      color: 'var(--fg-3)',
      cursor: 'pointer'
    },
    onClick: () => navigate('/reset')
  }, t('auth.forgot'))), /*#__PURE__*/React.createElement("div", {
    className: "auth-quick"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-eyebrow"
  }, t('auth.quick')), /*#__PURE__*/React.createElement("div", {
    className: "h-quick-sub"
  }, t('auth.quick.sub')), /*#__PURE__*/React.createElement("div", {
    className: "auth-quick-grid"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => quickLogin('lawyer')
  }, t('auth.lawyer')), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => quickLogin('student')
  }, t('auth.student')), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => quickLogin('citizen')
  }, t('auth.citizen')), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => quickLogin('master')
  }, t('auth.admin')))), /*#__PURE__*/React.createElement("div", {
    className: "auth-foot"
  }, t('auth.no.acct'), " ", /*#__PURE__*/React.createElement("a", {
    onClick: () => navigate('/signup')
  }, t('common.signup')))))));
}
function Signup() {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const submit = e => {
    e?.preventDefault();
    if (!name || !email) return;
    const u = {
      id: 'u_' + Date.now(),
      name,
      email,
      role: null,
      initials: name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()
    };
    STORE.setSession({
      user: u,
      loggedInAt: Date.now()
    });
    navigate('/onboarding');
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "pub",
    style: {
      minHeight: '100vh'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pub-top"
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => navigate('/'),
    style: {
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Brand, null)), /*#__PURE__*/React.createElement(LangToggle, null)), /*#__PURE__*/React.createElement("div", {
    className: "auth-shell"
  }, /*#__PURE__*/React.createElement(AuthArt, null), /*#__PURE__*/React.createElement("div", {
    className: "auth-form-wrap"
  }, /*#__PURE__*/React.createElement("form", {
    className: "auth-form",
    onSubmit: submit
  }, /*#__PURE__*/React.createElement("h1", null, t('auth.signup.t')), /*#__PURE__*/React.createElement("p", {
    className: "auth-sub"
  }, "7 kun bepul \xB7 kredit karta talab qilinmaydi"), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.name')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: name,
    onChange: e => setName(e.target.value),
    placeholder: "Ism Familiya"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.email')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "siz@kompaniya.uz"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.password')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    value: pw,
    onChange: e => setPw(e.target.value),
    placeholder: "kamida 8 belgi"
  }), /*#__PURE__*/React.createElement("div", {
    className: "hint"
  }, "Katta-kichik harf va raqamdan foydalaning")), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    block: true,
    size: "lg",
    style: {
      marginTop: 4
    }
  }, t('common.continue'), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    className: "auth-foot"
  }, t('auth.have.acct'), " ", /*#__PURE__*/React.createElement("a", {
    onClick: () => navigate('/login')
  }, t('common.signin')))))));
}
function Reset() {
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "pub",
    style: {
      minHeight: '100vh'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pub-top"
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => navigate('/'),
    style: {
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Brand, null)), /*#__PURE__*/React.createElement(LangToggle, null)), /*#__PURE__*/React.createElement("div", {
    className: "auth-shell"
  }, /*#__PURE__*/React.createElement(AuthArt, null), /*#__PURE__*/React.createElement("div", {
    className: "auth-form-wrap"
  }, /*#__PURE__*/React.createElement("form", {
    className: "auth-form",
    onSubmit: e => {
      e.preventDefault();
      setSent(true);
    }
  }, /*#__PURE__*/React.createElement("h1", null, t('auth.reset.t')), /*#__PURE__*/React.createElement("p", {
    className: "auth-sub"
  }, t('auth.reset.sub')), sent ? /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      background: 'var(--success-100)',
      borderColor: '#BFE0C8',
      color: '#2F6B43',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("strong", null, "Yuborildi."), " ", email, " manziliga yo'riqnoma jo'natildi. Kirish qutingizni tekshiring.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('common.email')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value)
  })), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    block: true,
    size: "lg"
  }, "Yo'riqnoma yuborish")), /*#__PURE__*/React.createElement("div", {
    className: "auth-foot"
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => navigate('/login')
  }, "\u2190 ", t('common.back')))))));
}

// ─── Onboarding ───────────────────────────────────────────────
function Onboarding() {
  const session = STORE.getSession();
  if (!session) {
    navigate('/login');
    return null;
  }
  const [step, setStep] = React.useState(0);
  const [lang, setLng] = React.useState(STORE.getLang());
  const [role, setRole] = React.useState('lawyer');
  const [ws, setWs] = React.useState('');
  const next = () => setStep(s => s + 1);
  const prev = () => setStep(s => Math.max(0, s - 1));
  const finish = () => {
    STORE.setLang(lang);
    const u = {
      ...session.user,
      role,
      workspace: ws || t('role.' + role) + ' workspace'
    };
    STORE.setSession({
      ...session,
      user: u
    });
    navigate(homeForRole(role));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "ob"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ob-top"
  }, /*#__PURE__*/React.createElement(Brand, null)), /*#__PURE__*/React.createElement("div", {
    className: "ob-stage"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ob-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ob-stepper"
  }, /*#__PURE__*/React.createElement("span", {
    className: step >= 0 ? 'on' : ''
  }), /*#__PURE__*/React.createElement("span", {
    className: step >= 1 ? 'on' : ''
  }), /*#__PURE__*/React.createElement("span", {
    className: step >= 2 ? 'on' : ''
  }), /*#__PURE__*/React.createElement("span", {
    className: step >= 3 ? 'on' : ''
  })), step === 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "ob-step"
  }, t('ob.welcome', {
    name: (session.user.name || '').split(' ')[0]
  })), /*#__PURE__*/React.createElement("h2", null, t('ob.lang.t')), /*#__PURE__*/React.createElement("p", {
    className: "ob-sub"
  }, "Istalgan vaqtda o'zgartirishingiz mumkin."), /*#__PURE__*/React.createElement("div", {
    className: "ob-options"
  }, /*#__PURE__*/React.createElement("div", {
    className: 'ob-option ' + (lang === 'UZ' ? 'on' : ''),
    onClick: () => setLng('UZ')
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, "UZ"), /*#__PURE__*/React.createElement("h4", null, "O'zbek"), /*#__PURE__*/React.createElement("p", null, "Lotin alifbosi")), /*#__PURE__*/React.createElement("div", {
    className: 'ob-option ' + (lang === 'RU' ? 'on' : ''),
    onClick: () => setLng('RU')
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, "RU"), /*#__PURE__*/React.createElement("h4", null, "\u0420\u0443\u0441\u0441\u043A\u0438\u0439"), /*#__PURE__*/React.createElement("p", null, "\u041A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0430"))), /*#__PURE__*/React.createElement(Button, {
    block: true,
    size: "lg",
    onClick: next
  }, t('common.continue'), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  }))), step === 1 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "ob-step"
  }, "2 / 4"), /*#__PURE__*/React.createElement("h2", null, t('ob.role.t')), /*#__PURE__*/React.createElement("p", {
    className: "ob-sub"
  }, "Sizga moslashtirilgan tajriba uchun tanlang."), /*#__PURE__*/React.createElement("div", {
    className: "ob-options"
  }, [['lawyer', 'scale', 'role.lawyer', 'Hujjatlar, mijozlar, qoralamalar'], ['student', 'graduate', 'role.student', 'O\'rganish va imtihon mashqi'], ['citizen', 'user', 'role.citizen', 'Oddiy yuridik savollar'], ['master', 'shield', 'role.master', 'RAG va boshqaruv']].map(([id, ic, ttl, desc]) => /*#__PURE__*/React.createElement("div", {
    key: id,
    className: 'ob-option ' + (role === id ? 'on' : ''),
    onClick: () => setRole(id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 16
  })), /*#__PURE__*/React.createElement("h4", null, t(ttl)), /*#__PURE__*/React.createElement("p", null, desc)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: prev
  }, "\u2190 ", t('common.back')), /*#__PURE__*/React.createElement(Button, {
    block: true,
    onClick: next
  }, t('common.continue'), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))), step === 2 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "ob-step"
  }, "3 / 4"), /*#__PURE__*/React.createElement("h2", null, t('ob.workspace.t')), /*#__PURE__*/React.createElement("p", {
    className: "ob-sub"
  }, "Bu siz va jamoangiz uchun ish maydoni nomi."), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: ws,
    onChange: e => setWs(e.target.value),
    placeholder: t('ob.workspace.ph')
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: prev
  }, "\u2190 ", t('common.back')), /*#__PURE__*/React.createElement(Button, {
    block: true,
    onClick: next
  }, t('common.continue'), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))), step === 3 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "ob-step"
  }, "4 / 4"), /*#__PURE__*/React.createElement("h2", null, t('ob.done.t')), /*#__PURE__*/React.createElement("p", {
    className: "ob-sub"
  }, t('ob.done.b')), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      background: 'var(--bg-1)',
      borderStyle: 'dashed',
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    style: {
      marginBottom: 4
    }
  }, "Til"), lang === 'UZ' ? 'O\'zbek' : 'Русский'), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    style: {
      marginBottom: 4
    }
  }, "Rol"), t('role.' + role)), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: '1 / -1'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    style: {
      marginBottom: 4
    }
  }, "Ish maydoni"), ws || '—'))), /*#__PURE__*/React.createElement(Button, {
    block: true,
    size: "lg",
    onClick: finish
  }, t('ob.start'), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  }))))));
}
window.Landing = Landing;
window.Pricing = Pricing;
window.Login = Login;
window.Signup = Signup;
window.Reset = Reset;
window.Onboarding = Onboarding;
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/pages/public.jsx", error: String((e && e.message) || e) }); }

// platform/pages/role-pages.jsx
try { (() => {
// Citizen, Student, Master Admin pages

// ─── Citizen Q&A ───────────────────────────────────────────────
function CitizenHome() {
  const session = STORE.getSession();
  const [q, setQ] = React.useState('');
  const [msgs, setMsgs] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const threadRef = React.useRef();
  React.useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [msgs, busy]);
  const send = async text => {
    const prompt = (text || q).trim();
    if (!prompt) return;
    setQ('');
    setMsgs(m => [...m, {
      who: 'me',
      content: prompt
    }]);
    setBusy(true);
    const res = await STORE.askAI({
      mode: 'citizen',
      prompt
    });
    setMsgs(m => [...m, {
      who: 'ai',
      content: res.content,
      citations: res.citations,
      escalate: true
    }]);
    setBusy(false);
  };
  const QUICK = ['Mehnat shartnomasini bekor qilish tartibi qanday?', 'Ish haqi kechikkanida nima qilishim kerak?', 'Ijara shartnomasi shakli qanday bo\'lishi kerak?', 'Iste\'molchi huquqi buzilganida qayerga murojaat qilaman?'];
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "citizen"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cit-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, t('cit.welcome', {
    name: (session.user.name || '').split(' ')[0]
  })), /*#__PURE__*/React.createElement("h1", null, t('cit.h1')), /*#__PURE__*/React.createElement("p", null, t('cit.sub')), msgs.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 620,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "cit-input"
  }, /*#__PURE__*/React.createElement("input", {
    value: q,
    onChange: e => setQ(e.target.value),
    onKeyDown: e => e.key === 'Enter' && send(),
    placeholder: t('cit.ph')
  }), /*#__PURE__*/React.createElement(Button, {
    onClick: () => send(),
    size: "lg",
    disabled: busy || !q.trim()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "send",
    size: 14
  }), " So'rash")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-eyebrow",
    style: {
      marginBottom: 12
    }
  }, t('cit.quick')), /*#__PURE__*/React.createElement("div", {
    className: "cit-quick"
  }, QUICK.map(x => /*#__PURE__*/React.createElement("div", {
    key: x,
    className: "cit-q",
    onClick: () => send(x)
  }, x)))))), msgs.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 720,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "thread",
    ref: threadRef,
    style: {
      background: 'var(--bg-2)',
      border: '1px solid var(--border-1)',
      borderRadius: 12,
      padding: 18,
      marginBottom: 14
    }
  }, msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'bubble-row ' + (m.who === 'me' ? 'me' : 'ai')
  }, /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, m.who === 'me' ? t('chat.you') : t('chat.ai')), /*#__PURE__*/React.createElement("div", {
    className: 'bubble ' + (m.who === 'me' ? 'user' : 'ai')
  }, m.who === 'ai' ? renderAI(m.content, m.citations) : m.content, m.citations?.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "cite-list"
  }, m.citations.map(c => /*#__PURE__*/React.createElement("span", {
    key: c.id,
    className: "cite"
  }, c.label))), m.escalate && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      paddingTop: 12,
      borderTop: '1px solid var(--border-1)',
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--fg-3)'
    }
  }, t('cit.escalate')), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, t('cit.find.lawyer'), " \u2192"))))), busy && /*#__PURE__*/React.createElement("div", {
    className: "bubble-row ai"
  }, /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, t('chat.ai')), /*#__PURE__*/React.createElement("div", {
    className: "bubble ai"
  }, /*#__PURE__*/React.createElement("span", {
    className: "thinking"
  }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null))))), /*#__PURE__*/React.createElement("div", {
    className: "cit-input"
  }, /*#__PURE__*/React.createElement("input", {
    value: q,
    onChange: e => setQ(e.target.value),
    onKeyDown: e => e.key === 'Enter' && send(),
    placeholder: t('cit.ph')
  }), /*#__PURE__*/React.createElement(Button, {
    onClick: () => send(),
    disabled: busy || !q.trim()
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "send",
    size: 14
  })))));
}

// ─── Student ──────────────────────────────────────────────────
function StudentHome() {
  const session = STORE.getSession();
  const [tab, setTab] = React.useState('study');
  const [savedQs] = React.useState([{
    id: 1,
    q: 'MK·99 — Mehnat shartnomasini bekor qilish asoslari',
    when: '2 kun',
    tag: 'mehnat'
  }, {
    id: 2,
    q: 'FK·354 — Shartnoma majburiyatlari',
    when: '4 kun',
    tag: 'fuqarolik'
  }, {
    id: 3,
    q: 'JK·169 — O\'g\'irlik jinoyati uchun javobgarlik',
    when: '1 hafta',
    tag: 'jinoyat'
  }]);
  const [practice, setPractice] = React.useState(null);
  const [answer, setAnswer] = React.useState('');
  const [revealed, setRevealed] = React.useState(false);
  const PRACTICE = [{
    q: 'Mehnat shartnomasi qachon yozma shaklda tuziladi?',
    a: 'O\'zbekiston MK·76 ga muvofiq mehnat shartnomasi har doim yozma shaklda tuziladi.',
    topic: 'Mehnat huquqi'
  }, {
    q: 'Voyaga yetmagan shaxs qaysi yoshdan boshlab mehnat shartnomasi tuza oladi?',
    a: '15 yoshdan boshlab, vasiylarining yozma roziligi bilan.',
    topic: 'Mehnat huquqi'
  }, {
    q: 'Fuqarolik shartnomasi nima?',
    a: 'FK·354 ga muvofiq, fuqarolik huquqlari va majburiyatlarini belgilash, o\'zgartirish yoki tugatish uchun ikki yoki bir necha shaxslarning kelishuvi.',
    topic: 'Fuqarolik huquqi'
  }];
  const startPractice = () => {
    setPractice(PRACTICE[Math.floor(Math.random() * PRACTICE.length)]);
    setAnswer('');
    setRevealed(false);
  };
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "student"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, t('stud.welcome', {
    name: (session.user.name || '').split(' ')[0]
  })), /*#__PURE__*/React.createElement("h1", {
    className: "greet"
  }, t('stud.h1')), /*#__PURE__*/React.createElement("div", {
    className: "adm-tab",
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: tab === 'study' ? 'on' : '',
    onClick: () => setTab('study')
  }, t('stud.study')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'practice' ? 'on' : '',
    onClick: () => setTab('practice')
  }, t('stud.practice')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'saved' ? 'on' : '',
    onClick: () => setTab('saved')
  }, t('stud.saved'))), tab === 'study' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--fg-2)',
      fontSize: 14,
      maxWidth: 600,
      marginBottom: 18
    }
  }, t('stud.study.sub')), /*#__PURE__*/React.createElement("div", {
    className: "dash-grid-3"
  }, [['Mehnat huquqi', 'MK', 'Mehnat shartnomalari, ish haqi, ish vaqti', 14], ['Fuqarolik huquqi', 'FK', 'Shartnomalar, mulk, meros', 22], ['Jinoyat huquqi', 'JK', 'Jinoyat tarkibi va javobgarlik', 18], ['Soliq huquqi', 'SK', 'Soliq turlari, deklaratsiya', 11], ['Konstitutsiyaviy huquq', 'KK', 'Asosiy huquq va erkinliklar', 9], ['Xalqaro huquq', 'XK', 'Xalqaro shartnomalar', 7]].map(([nm, code, desc, n]) => /*#__PURE__*/React.createElement("div", {
    key: code,
    className: "doc",
    onClick: () => navigate('/app/chat?q=' + encodeURIComponent(nm + ' haqida tushuntiring'))
  }, /*#__PURE__*/React.createElement("div", {
    className: "doc-icon",
    style: {
      background: 'var(--accent-100)',
      color: 'var(--accent)',
      fontFamily: 'var(--font-serif)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 14,
      fontWeight: 600
    }
  }, code), /*#__PURE__*/React.createElement("div", {
    className: "doc-name"
  }, nm), /*#__PURE__*/React.createElement("div", {
    className: "doc-meta"
  }, desc), /*#__PURE__*/React.createElement("div", {
    className: "doc-foot"
  }, /*#__PURE__*/React.createElement(Badge, {
    kind: "neutral"
  }, n, " mavzu"), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))))), tab === 'practice' && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      maxWidth: 720
    }
  }, !practice ? /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '40px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 14px/1.4 var(--font-serif)',
      color: 'var(--fg-2)',
      marginBottom: 18
    }
  }, t('stud.practice.sub')), /*#__PURE__*/React.createElement(Button, {
    onClick: startPractice,
    size: "lg"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 14
  }), " ", t('stud.practice.start'))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, practice.topic), /*#__PURE__*/React.createElement("h3", {
    style: {
      font: '500 18px/1.4 var(--font-serif)',
      color: 'var(--fg-1)',
      margin: '6px 0 16px'
    }
  }, practice.q), /*#__PURE__*/React.createElement("textarea", {
    className: "input",
    rows: 4,
    value: answer,
    onChange: e => setAnswer(e.target.value),
    placeholder: "Javobingizni yozing\u2026",
    style: {
      resize: 'vertical',
      minHeight: 100,
      fontFamily: 'var(--font-sans)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: () => setRevealed(true),
    disabled: !answer.trim() || revealed
  }, t('stud.check')), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: startPractice
  }, t('stud.next'), " \u2192")), revealed && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      background: 'var(--accent-100)',
      borderColor: 'rgba(184,138,75,0.3)',
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    style: {
      color: 'var(--accent)'
    }
  }, "To'g'ri javob"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '400 14px/1.6 var(--font-sans)',
      color: 'var(--fg-1)',
      marginTop: 6
    }
  }, practice.a)))), tab === 'saved' && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 8
    }
  }, savedQs.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.id,
    className: "statute-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-num"
  }, s.tag.slice(0, 1).toUpperCase()), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-tt"
  }, s.q), /*#__PURE__*/React.createElement("div", {
    className: "statute-co"
  }, s.when, " oldin saqlangan \xB7 ", s.tag)), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))));
}

// ─── Master Admin ─────────────────────────────────────────────
function MasterAdmin() {
  const [tab, setTab] = React.useState('overview');
  const fb = STORE.getColl('feedback');
  const sources = STORE.getColl('sources');
  const [drag, setDrag] = React.useState(false);
  const [files, setFiles] = React.useState([]);
  const [tagging, setTagging] = React.useState(null);
  const [code, setCode] = React.useState('MK');
  const [lang, setLng] = React.useState('UZ');
  const [version, setVersion] = React.useState(new Date().toISOString().slice(0, 10));
  const onDrop = e => {
    e.preventDefault();
    setDrag(false);
    const list = Array.from(e.dataTransfer.files).map(f => ({
      id: 'f_' + Date.now() + Math.random(),
      name: f.name,
      size: f.size,
      status: 'pending',
      uploadedAt: Date.now()
    }));
    setFiles(f => [...f, ...list]);
    if (list[0]) setTagging(list[0]);
  };
  const onPick = e => {
    const list = Array.from(e.target.files).map(f => ({
      id: 'f_' + Date.now() + Math.random(),
      name: f.name,
      size: f.size,
      status: 'pending',
      uploadedAt: Date.now()
    }));
    setFiles(f => [...f, ...list]);
    if (list[0]) setTagging(list[0]);
  };
  const ingest = () => {
    const src = {
      id: 's_' + Date.now(),
      name: tagging.name,
      code,
      lang,
      version,
      status: 'indexed',
      chunks: Math.floor(Math.random() * 800) + 200,
      addedAt: Date.now()
    };
    STORE.pushColl('sources', src);
    setFiles(fs => fs.map(f => f.id === tagging.id ? {
      ...f,
      status: 'indexed'
    } : f));
    setTagging(null);
    showToast('Manba indekslandi: ' + src.chunks + ' parcha');
  };
  return /*#__PURE__*/React.createElement(AppShell, {
    active: "admin"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, t('adm.title')), /*#__PURE__*/React.createElement("h1", {
    className: "greet"
  }, "RAG va sifat"), /*#__PURE__*/React.createElement("div", {
    className: "adm-tab",
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: tab === 'overview' ? 'on' : '',
    onClick: () => setTab('overview')
  }, t('adm.overview')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'ingest' ? 'on' : '',
    onClick: () => setTab('ingest')
  }, t('adm.ingest')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'sources' ? 'on' : '',
    onClick: () => setTab('sources')
  }, t('adm.sources')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'feedback' ? 'on' : '',
    onClick: () => setTab('feedback')
  }, t('adm.feedback')), /*#__PURE__*/React.createElement("button", {
    className: tab === 'eval' ? 'on' : '',
    onClick: () => setTab('eval')
  }, t('adm.eval'))), tab === 'overview' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "stats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat featured"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Indekslangan parchalar"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, sources.reduce((a, s) => a + (s.chunks || 0), 0).toLocaleString()), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, sources.length, " ta manbadan")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, t('adm.kpi.queries')), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "12,847"), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "\u2191 23% bu hafta")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, t('adm.kpi.success')), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "96.2%"), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "tasdiqlangan iqtibos")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, t('adm.kpi.flagged')), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, fb.filter(f => f.kind === 'down').length), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "ko'rib chiqish kerak"))), /*#__PURE__*/React.createElement("div", {
    className: "dash-grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "h-section"
  }, "Eng so'ralgan kodekslar"), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 8
    }
  }, [['MK', 'Mehnat kodeksi', 4823], ['FK', 'Fuqarolik kodeksi', 3104], ['JK', 'Jinoyat kodeksi', 1922], ['SK', 'Soliq kodeksi', 1488]].map(([c, n, q]) => /*#__PURE__*/React.createElement("div", {
    key: c,
    className: "statute-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-num"
  }, c), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-tt"
  }, n)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      color: 'var(--fg-3)'
    }
  }, q.toLocaleString()))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "h-section"
  }, "Oxirgi xatolar"), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 8
    }
  }, [['MK·99 noto\'g\'ri tarjima', 'Aziza T.', 'feedback'], ['FK·573 yangi tahrir', 'Master', 'version'], ['JK·169 iqtibos topilmadi', 'Bobur Y.', 'gap']].map(([msg, by, kind], i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "statute-row"
  }, /*#__PURE__*/React.createElement(Badge, {
    kind: kind === 'feedback' ? 'warn' : kind === 'version' ? 'info' : 'danger'
  }, kind), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-tt"
  }, msg), /*#__PURE__*/React.createElement("div", {
    className: "statute-co"
  }, by)))))))), tab === 'ingest' && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      maxWidth: 760
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      font: '600 18px/1.3 var(--font-serif)',
      marginBottom: 6
    }
  }, t('adm.ingest')), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--fg-3)',
      marginBottom: 18
    }
  }, "PDF, DOCX yoki TXT formatdagi yuridik hujjatlarni yuklang. Tizim ularni avtomatik parchalaydi va indekslaydi."), /*#__PURE__*/React.createElement("div", {
    className: 'drop ' + (drag ? 'over' : ''),
    onDragOver: e => {
      e.preventDefault();
      setDrag(true);
    },
    onDragLeave: () => setDrag(false),
    onDrop: onDrop
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 26
  })), /*#__PURE__*/React.createElement("h4", null, t('adm.drop')), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: 'var(--fg-3)',
      marginBottom: 12
    }
  }, "yoki"), /*#__PURE__*/React.createElement("label", null, /*#__PURE__*/React.createElement("input", {
    type: "file",
    hidden: true,
    multiple: true,
    accept: ".pdf,.docx,.txt",
    onChange: onPick
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => {}
  }, t('adm.browse'))))), files.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("h4", {
    style: {
      font: '600 13px/1 var(--font-sans)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--fg-3)',
      marginBottom: 10
    }
  }, "Fayllar (", files.length, ")"), files.map(f => /*#__PURE__*/React.createElement("div", {
    key: f.id,
    className: "statute-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-num"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "doc",
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-tt"
  }, f.name), /*#__PURE__*/React.createElement("div", {
    className: "statute-co"
  }, (f.size / 1024).toFixed(1), " KB")), /*#__PURE__*/React.createElement(Badge, {
    kind: f.status === 'indexed' ? 'success' : 'warn'
  }, f.status === 'indexed' ? 'Tayyor' : 'Belgilash kerak'))))), tab === 'sources' && /*#__PURE__*/React.createElement("div", {
    className: "tbl-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tbl-h",
    style: {
      gridTemplateColumns: '120px 1fr 100px 100px 140px 110px'
    }
  }, /*#__PURE__*/React.createElement("div", null, "Kod"), /*#__PURE__*/React.createElement("div", null, "Manba nomi"), /*#__PURE__*/React.createElement("div", null, "Til"), /*#__PURE__*/React.createElement("div", null, "Versiya"), /*#__PURE__*/React.createElement("div", null, "Parchalar"), /*#__PURE__*/React.createElement("div", null, "Status")), sources.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.id,
    className: "client-row",
    style: {
      gridTemplateColumns: '120px 1fr 100px 100px 140px 110px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "statute-num"
  }, s.code), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "client-name"
  }, s.name), /*#__PURE__*/React.createElement("div", {
    className: "client-meta"
  }, "qo'shilgan: ", new Date(s.addedAt).toLocaleDateString())), /*#__PURE__*/React.createElement("div", {
    className: "client-meta"
  }, s.lang), /*#__PURE__*/React.createElement("div", {
    className: "client-meta",
    style: {
      fontFamily: 'var(--font-mono)'
    }
  }, s.version), /*#__PURE__*/React.createElement("div", {
    className: "client-meta",
    style: {
      fontFamily: 'var(--font-mono)'
    }
  }, (s.chunks || 0).toLocaleString()), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Badge, {
    kind: "success",
    dot: true
  }, s.status)))), sources.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 60,
      textAlign: 'center',
      color: 'var(--fg-3)',
      fontSize: 14
    }
  }, "Hali manba yo'q. Ingest yorlig'iga o'ting.")), tab === 'feedback' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--fg-2)',
      fontSize: 14,
      marginBottom: 18
    }
  }, "Foydalanuvchilar javoblarni baholaydi. Pastki ovozlarni ko'rib chiqing va bilim bazasiga tuzatish kiriting."), fb.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty-state",
    style: {
      minHeight: 240,
      background: 'var(--bg-2)',
      border: '1px solid var(--border-1)',
      borderRadius: 12
    }
  }, /*#__PURE__*/React.createElement("h3", null, "Hozircha fikr yo'q"), /*#__PURE__*/React.createElement("p", null, "Foydalanuvchi ovoz berganida bu yerda ko'rinadi.")) : /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 8
    }
  }, fb.map(f => /*#__PURE__*/React.createElement("div", {
    key: f.id,
    style: {
      display: 'flex',
      gap: 12,
      padding: 12,
      borderBottom: '1px solid var(--border-1)'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    kind: f.kind === 'up' ? 'success' : 'danger'
  }, f.kind === 'up' ? '▲' : '▼'), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 13px/1.4 var(--font-sans)',
      color: 'var(--fg-1)'
    }
  }, f.note || '— izoh yo\'q —'), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--fg-3)',
      marginTop: 4
    }
  }, new Date(f.at).toLocaleString())), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, "Ko'rib chiqish"))))), tab === 'eval' && /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      maxWidth: 720
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      font: '600 16px/1.3 var(--font-serif)',
      marginBottom: 14
    }
  }, "Sifat baholash to'plami"), [['Iqtibos aniqligi', 0.962, 'success'], ['Javob to\'liqligi', 0.84, 'info'], ['Til tabiiyligi (UZ)', 0.91, 'success'], ['Til tabiiyligi (RU)', 0.78, 'warn'], ['Asossiz da\'volar (kam yaxshi)', 0.04, 'success']].map(([nm, val, kind]) => /*#__PURE__*/React.createElement("div", {
    key: nm,
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 13px/1.3 var(--font-sans)',
      color: 'var(--fg-1)'
    }
  }, nm), /*#__PURE__*/React.createElement("span", {
    style: {
      font: '600 13px/1 var(--font-mono)',
      color: 'var(--fg-1)'
    }
  }, (val * 100).toFixed(1), "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      background: 'var(--bg-1)',
      borderRadius: 3,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      width: val * 100 + '%',
      background: kind === 'success' ? 'var(--success-700)' : kind === 'warn' ? 'var(--warn-700)' : 'var(--info-700)'
    }
  })))), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 13
  }), " Baholashni qayta ishga tushirish")), /*#__PURE__*/React.createElement(Modal, {
    open: !!tagging,
    onClose: () => setTagging(null),
    title: t('adm.tag.t'),
    sub: tagging?.name,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: () => setTagging(null)
    }, t('common.cancel')), /*#__PURE__*/React.createElement(Button, {
      onClick: ingest
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 13
    }), " ", t('adm.ingest.now')))
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('adm.code')), /*#__PURE__*/React.createElement("select", {
    className: "input",
    value: code,
    onChange: e => setCode(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: "MK"
  }, "MK \u2014 Mehnat kodeksi"), /*#__PURE__*/React.createElement("option", {
    value: "FK"
  }, "FK \u2014 Fuqarolik kodeksi"), /*#__PURE__*/React.createElement("option", {
    value: "JK"
  }, "JK \u2014 Jinoyat kodeksi"), /*#__PURE__*/React.createElement("option", {
    value: "SK"
  }, "SK \u2014 Soliq kodeksi"), /*#__PURE__*/React.createElement("option", {
    value: "KK"
  }, "KK \u2014 Konstitutsiya"), /*#__PURE__*/React.createElement("option", {
    value: "OTHER"
  }, "Boshqa"))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('adm.lang')), /*#__PURE__*/React.createElement("div", {
    className: "tw-seg",
    style: {
      width: 'fit-content'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: lang === 'UZ' ? 'on' : '',
    onClick: () => setLng('UZ')
  }, "UZ"), /*#__PURE__*/React.createElement("button", {
    className: lang === 'RU' ? 'on' : '',
    onClick: () => setLng('RU')
  }, "RU"))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", {
    className: "label"
  }, t('adm.version')), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "date",
    value: version,
    onChange: e => setVersion(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    className: "hint"
  }, "Tahrir kuchga kirgan sana. Iqtiboslar bu sanaga ishora qiladi."))));
}
window.CitizenHome = CitizenHome;
window.StudentHome = StudentHome;
window.MasterAdmin = MasterAdmin;
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/pages/role-pages.jsx", error: String((e && e.message) || e) }); }

// platform/router.jsx
try { (() => {
// JuristAI Platform — hash router + role gates

function parseRoute() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, ...rest] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return {
    path,
    parts,
    hash: h
  };
}
function navigate(to) {
  location.hash = to;
}
function useRoute() {
  const [r, setR] = React.useState(parseRoute());
  React.useEffect(() => {
    const h = () => setR(parseRoute());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

// Role-aware redirect after login
function homeForRole(role) {
  return {
    lawyer: '/app/dashboard',
    student: '/study',
    citizen: '/ask',
    master: '/admin/ingest'
  }[role] || '/app/dashboard';
}
window.parseRoute = parseRoute;
window.navigate = navigate;
window.useRoute = useRoute;
window.homeForRole = homeForRole;
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/router.jsx", error: String((e && e.message) || e) }); }

// platform/store.js
try { (() => {
// JuristAI Platform — store.js (localStorage wrapper + seed + canned AI)

const NS = 'juristai.v1.';
function load(key, def) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw ? JSON.parse(raw) : def;
  } catch (e) {
    return def;
  }
}
function save(key, val) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(val));
  } catch (e) {}
}

// ── Session ────────────────────────────────────────────────
function getSession() {
  return load('session', null);
}
function setSession(s) {
  save('session', s);
  window.__session = s;
  emit('session');
}
function clearSession() {
  localStorage.removeItem(NS + 'session');
  window.__session = null;
  emit('session');
}

// ── Theme ──────────────────────────────────────────────────
const THEME_DEF = {
  mode: 'light',
  accent: 'navy',
  density: 'comfortable',
  font: 'serif'
};
function getTheme() {
  return Object.assign({}, THEME_DEF, load('theme', {}));
}
function setTheme(patch) {
  const t = Object.assign({}, getTheme(), patch);
  save('theme', t);
  applyTheme(t);
  emit('theme');
}
function applyTheme(t) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t.mode);
  root.setAttribute('data-accent', t.accent);
  root.setAttribute('data-density', t.density);
  root.setAttribute('data-font', t.font);
}

// ── Lang ───────────────────────────────────────────────────
function getLang() {
  return load('lang', 'UZ');
}
function setLang(l) {
  save('lang', l);
  window.__lang = l;
  emit('lang');
}

// ── Generic collection ─────────────────────────────────────
function getColl(key, def) {
  return load(key, def || []);
}
function setColl(key, val) {
  save(key, val);
  emit(key);
}
function pushColl(key, item) {
  const arr = getColl(key);
  arr.unshift(item);
  setColl(key, arr);
  return item;
}
function patchColl(key, id, patch) {
  const arr = getColl(key);
  const i = arr.findIndex(x => x.id === id);
  if (i >= 0) {
    arr[i] = Object.assign({}, arr[i], patch);
    setColl(key, arr);
  }
}
function removeColl(key, id) {
  setColl(key, getColl(key).filter(x => x.id !== id));
}

// ── Behavior tracking (adaptive dashboard) ─────────────────
function bump(kind, code) {
  const b = load('behavior', {
    statuteOpens: {},
    templateUses: {},
    lastViewed: []
  });
  if (kind === 'statute') b.statuteOpens[code] = (b.statuteOpens[code] || 0) + 1;
  if (kind === 'template') b.templateUses[code] = (b.templateUses[code] || 0) + 1;
  if (kind === 'doc') {
    b.lastViewed = [code, ...(b.lastViewed || []).filter(x => x !== code)].slice(0, 10);
  }
  save('behavior', b);
  emit('behavior');
}
function getBehavior() {
  return load('behavior', {
    statuteOpens: {},
    templateUses: {},
    lastViewed: []
  });
}

// ── Event bus ──────────────────────────────────────────────
const listeners = {};
function on(ev, fn) {
  (listeners[ev] = listeners[ev] || []).push(fn);
  return () => {
    listeners[ev] = (listeners[ev] || []).filter(f => f !== fn);
  };
}
function emit(ev) {
  (listeners[ev] || []).forEach(fn => {
    try {
      fn();
    } catch (e) {}
  });
}

// ── Canned AI ──────────────────────────────────────────────
const CANNED_RESPONSES = [{
  match: /(bekor|увол|расторг)/i,
  UZ: 'Mehnat shartnomasi tomonlarning o\'zaro kelishuvi bilan istalgan vaqtda bekor qilinishi mumkin <cite id="c1"/>. Ish beruvchi bir tomonlama bekor qilsa, kamida **2 oy** oldin yozma xabar berishi shart <cite id="c2"/>. Xodimning tashabbusi bilan — 2 hafta <cite id="c3"/>.',
  RU: 'Трудовой договор может быть расторгнут по соглашению сторон в любое время <cite id="c1"/>. При одностороннем расторжении работодателем — письменное уведомление **за 2 месяца** <cite id="c2"/>. По инициативе работника — за 2 недели <cite id="c3"/>.',
  citations: [{
    id: 'c1',
    label: 'MK·99 — Bekor qilish asoslari',
    code: 'MK',
    n: '99'
  }, {
    id: 'c2',
    label: 'MK·100 — Ogohlantirish muddati',
    code: 'MK',
    n: '100'
  }, {
    id: 'c3',
    label: 'MK·101 — Xodim tashabbusi',
    code: 'MK',
    n: '101'
  }]
}, {
  match: /(ish haq|зарплат|оплат)/i,
  UZ: 'Ish haqi har oyning **5-sanasiga qadar** to\'lanishi shart <cite id="c1"/>. Kechiktirilsa — har bir kun uchun 0.1% jarima <cite id="c2"/>.',
  RU: 'Зарплата выплачивается **до 5-го числа** каждого месяца <cite id="c1"/>. При задержке — пеня 0.1% за каждый день <cite id="c2"/>.',
  citations: [{
    id: 'c1',
    label: 'MK·154 — Ish haqi to\'lash',
    code: 'MK',
    n: '154'
  }, {
    id: 'c2',
    label: 'MK·158 — Kechikish uchun javobgarlik',
    code: 'MK',
    n: '158'
  }]
}, {
  match: /(ijara|аренд)/i,
  UZ: 'Ijara shartnomasi yozma shaklda tuziladi <cite id="c1"/>. Bir yildan ortiq muddatga tuzilsa — davlat ro\'yxatidan o\'tkazilishi shart <cite id="c2"/>.',
  RU: 'Договор аренды заключается в письменной форме <cite id="c1"/>. На срок более одного года — подлежит государственной регистрации <cite id="c2"/>.',
  citations: [{
    id: 'c1',
    label: 'FK·573 — Ijara shartnomasi shakli',
    code: 'FK',
    n: '573'
  }, {
    id: 'c2',
    label: 'FK·575 — Davlat ro\'yxati',
    code: 'FK',
    n: '575'
  }]
}, {
  match: /(nda|махфий|конфиденц)/i,
  UZ: 'NDA shartnomasida quyidagi majburiy bandlar bo\'lishi kerak: 1) Maxfiy ma\'lumotning aniq ta\'rifi, 2) Foydalanish doirasi, 3) Saqlash muddati (odatda 3-5 yil), 4) Buzilganligi uchun javobgarlik <cite id="c1"/>.',
  RU: 'NDA должно содержать: 1) определение конфиденциальной информации, 2) область использования, 3) срок (обычно 3-5 лет), 4) ответственность за нарушение <cite id="c1"/>.',
  citations: [{
    id: 'c1',
    label: 'FK·1098 — Tijorat siri',
    code: 'FK',
    n: '1098'
  }]
}];
const FALLBACK = {
  UZ: 'Bu masala bo\'yicha O\'zbekiston qonunchiligi quyidagi qoidalarni belgilaydi <cite id="c1"/>. Aniqroq javob uchun savolingizni kengaytiring yoki tegishli hujjatni yuklang.',
  RU: 'По данному вопросу законодательство Узбекистана устанавливает следующие правила <cite id="c1"/>. Уточните вопрос или загрузите документ для более точного ответа.',
  citations: [{
    id: 'c1',
    label: 'Umumiy qoidalar',
    code: 'MK',
    n: '—'
  }]
};
async function askAI({
  mode,
  prompt
}) {
  await new Promise(r => setTimeout(r, 600 + Math.random() * 600));
  const lang = getLang();
  const hit = CANNED_RESPONSES.find(c => c.match.test(prompt));
  const r = hit || FALLBACK;
  return {
    content: r[lang] || r.UZ,
    citations: r.citations
  };
}

// ── Seed data ──────────────────────────────────────────────
function seedIfEmpty() {
  if (load('seeded', false)) return;
  const clients = [{
    id: 'c1',
    name: 'Akmal Karimov',
    kind: 'person',
    jshshir: '31407851200032',
    email: 'akmal.k@atlas.uz',
    phone: '+998 90 123 45 67',
    notes: '',
    docCount: 12,
    lastTouched: Date.now() - 1000 * 60 * 60 * 48
  }, {
    id: 'c2',
    name: 'Atlas Construction MChJ',
    kind: 'entity',
    inn: '300481294',
    email: 'office@atlas.uz',
    phone: '+998 71 200 30 40',
    notes: 'Qurilish kompaniyasi',
    docCount: 34,
    lastTouched: Date.now() - 1000 * 60 * 60 * 12
  }, {
    id: 'c3',
    name: 'Dilnoza Murodova',
    kind: 'person',
    jshshir: '32507930140018',
    email: 'dilnoza.m@gmail.com',
    phone: '+998 99 555 88 22',
    notes: 'YaTT',
    docCount: 5,
    lastTouched: Date.now() - 1000 * 60 * 60 * 24 * 6
  }, {
    id: 'c4',
    name: 'SilkRoad Logistics',
    kind: 'entity',
    inn: '305112847',
    email: 'legal@silkroad.uz',
    phone: '+998 71 150 60 70',
    notes: 'Logistika',
    docCount: 21,
    lastTouched: Date.now() - 1000 * 60 * 60 * 24
  }, {
    id: 'c5',
    name: 'Bekzod Tursunov',
    kind: 'person',
    jshshir: '32907920140018',
    email: 'b.tursunov@mail.ru',
    phone: '+998 90 700 11 22',
    notes: '',
    docCount: 3,
    lastTouched: Date.now() - 1000 * 60 * 60 * 24 * 21
  }];
  save('clients', clients);
  const docs = [{
    id: 'd1',
    name: 'Mehnat shartnomasi № 481',
    type: 'shartnoma',
    body: '<h1>Mehnat shartnomasi</h1><p>1. "Atlas Construction" MChJ va Akmal Karimov o\'rtasida tuzilgan…</p>',
    status: 'approved',
    createdAt: Date.now() - 1000 * 60 * 60 * 48,
    updatedAt: Date.now() - 1000 * 60 * 60 * 2,
    clientId: 'c2'
  }, {
    id: 'd2',
    name: 'Ijara qoralamasi',
    type: 'ijara',
    body: '<h1>Ijara shartnomasi</h1><p>Qoralama…</p>',
    status: 'draft',
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    updatedAt: Date.now() - 1000 * 60 * 60 * 12,
    clientId: 'c4'
  }, {
    id: 'd3',
    name: 'NDA — SilkRoad',
    type: 'nda',
    body: '<h1>Maxfiylik shartnomasi</h1><p>Imzolangan.</p>',
    status: 'closed',
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24,
    clientId: 'c4'
  }, {
    id: 'd4',
    name: 'Ish haqi tartibi',
    type: 'qaror',
    body: '<h1>Buyruq</h1><p>Ko\'rib chiqilmoqda…</p>',
    status: 'review',
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
    clientId: 'c1'
  }];
  save('docs', docs);
  const chats = [{
    id: 'ch1',
    title: 'Bekor qilish savoli',
    createdAt: Date.now() - 1000 * 60 * 60 * 4,
    messages: [{
      who: 'me',
      content: 'Mehnat shartnomasini qanday bekor qilish mumkin?',
      at: Date.now() - 1000 * 60 * 60 * 4
    }, {
      who: 'ai',
      content: 'Mehnat shartnomasi tomonlarning o\'zaro kelishuvi bilan istalgan vaqtda bekor qilinishi mumkin <cite id="c1"/>. Ish beruvchi bir tomonlama bekor qilsa, kamida **2 oy** oldin yozma xabar berishi shart <cite id="c2"/>.',
      citations: [{
        id: 'c1',
        label: 'MK·99 — Bekor qilish asoslari',
        code: 'MK',
        n: '99'
      }, {
        id: 'c2',
        label: 'MK·100 — Ogohlantirish muddati',
        code: 'MK',
        n: '100'
      }],
      at: Date.now() - 1000 * 60 * 60 * 4 + 2000
    }]
  }];
  save('chats', chats);
  save('bookmarks', [{
    id: 'b1',
    type: 'statute',
    payload: {
      code: 'MK',
      n: '99',
      title: 'Bekor qilish asoslari'
    },
    savedAt: Date.now() - 1000 * 60 * 60 * 48
  }, {
    id: 'b2',
    type: 'statute',
    payload: {
      code: 'FK',
      n: '573',
      title: 'Ijara shartnomasi shakli'
    },
    savedAt: Date.now() - 1000 * 60 * 60 * 24 * 3
  }]);
  save('savedQs', []);
  save('behavior', {
    statuteOpens: {
      'MK·99': 7,
      'MK·76': 5,
      'FK·354': 3,
      'MK·100': 6,
      'MK·154': 2
    },
    templateUses: {
      'shartnoma': 12,
      'nda': 5,
      'ijara': 8
    },
    lastViewed: ['d1', 'd2']
  });
  save('seeded', true);
}
window.STORE = {
  load,
  save,
  getSession,
  setSession,
  clearSession,
  getTheme,
  setTheme,
  applyTheme,
  getLang,
  setLang,
  getColl,
  setColl,
  pushColl,
  patchColl,
  removeColl,
  bump,
  getBehavior,
  on,
  askAI,
  seedIfEmpty
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/store.js", error: String((e && e.message) || e) }); }

// platform/tweaks.jsx
try { (() => {
// Tweaks panel
function TweaksPanel() {
  const [open, setOpen] = React.useState(false);
  const [theme, setT] = React.useState(STORE.getTheme());
  React.useEffect(() => {
    const onActivate = e => {
      if (e.data?.type === '__activate_edit_mode') setOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onActivate);
    window.parent.postMessage({
      type: '__edit_mode_available'
    }, '*');
    return () => window.removeEventListener('message', onActivate);
  }, []);
  React.useEffect(() => STORE.on('theme', () => setT(STORE.getTheme())), []);
  const set = patch => STORE.setTheme(patch);
  const close = () => {
    setOpen(false);
    window.parent.postMessage({
      type: '__edit_mode_dismissed'
    }, '*');
  };
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "tw-panel"
  }, /*#__PURE__*/React.createElement("h4", null, t('tw.title'), " ", /*#__PURE__*/React.createElement("span", {
    className: "x",
    onClick: close
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "tw-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl"
  }, t('tw.theme')), /*#__PURE__*/React.createElement("div", {
    className: "tw-seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: theme.mode === 'light' ? 'on' : '',
    onClick: () => set({
      mode: 'light'
    })
  }, t('tw.light')), /*#__PURE__*/React.createElement("button", {
    className: theme.mode === 'dark' ? 'on' : '',
    onClick: () => set({
      mode: 'dark'
    })
  }, t('tw.dark')))), /*#__PURE__*/React.createElement("div", {
    className: "tw-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl"
  }, t('tw.accent')), /*#__PURE__*/React.createElement("div", {
    className: "tw-swatches"
  }, ['navy', 'brass', 'plum', 'winter'].map(a => /*#__PURE__*/React.createElement("div", {
    key: a,
    className: 'tw-sw ' + (theme.accent === a ? 'on' : ''),
    style: {
      background: a === 'navy' ? '#16365A' : a === 'brass' ? '#B08442' : a === 'plum' ? '#4A1F8C' : '#4F5C66'
    },
    onClick: () => set({
      accent: a
    })
  })))), /*#__PURE__*/React.createElement("div", {
    className: "tw-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl"
  }, t('tw.density')), /*#__PURE__*/React.createElement("div", {
    className: "tw-seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: theme.density === 'comfortable' ? 'on' : '',
    onClick: () => set({
      density: 'comfortable'
    })
  }, t('tw.comfortable')), /*#__PURE__*/React.createElement("button", {
    className: theme.density === 'compact' ? 'on' : '',
    onClick: () => set({
      density: 'compact'
    })
  }, t('tw.compact')))), /*#__PURE__*/React.createElement("div", {
    className: "tw-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl"
  }, t('tw.font')), /*#__PURE__*/React.createElement("div", {
    className: "tw-seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: theme.font === 'serif' ? 'on' : '',
    onClick: () => set({
      font: 'serif'
    })
  }, t('tw.serif')), /*#__PURE__*/React.createElement("button", {
    className: theme.font === 'sans' ? 'on' : '',
    onClick: () => set({
      font: 'sans'
    })
  }, t('tw.sans')))));
}
window.TweaksPanel = TweaksPanel;
})(); } catch (e) { __ds_ns.__errors.push({ path: "platform/tweaks.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web_app/App.jsx
try { (() => {
function App() {
  const [view, setView] = React.useState('dashboard');
  const [lang, setLang] = React.useState('UZ');
  const [draft, setDraft] = React.useState('');
  const [messages, setMessages] = React.useState([{
    who: 'ai',
    content: /*#__PURE__*/React.createElement("span", null, "Salom, Aziza. Men Dictum \u2014 qonunlar bo'yicha yordamchingiz. Mehnat kodeksi, Fuqarolik kodeksi va so'nggi qarorlar bo'yicha savollarga javob beraman. Hujjat yuklang yoki savol bering.")
  }]);
  const send = textOverride => {
    const text = (textOverride || draft).trim();
    if (!text) return;
    setMessages(m => [...m, {
      who: 'me',
      content: text
    }]);
    setDraft('');
    setTimeout(() => {
      setMessages(m => [...m, {
        who: 'ai',
        content: /*#__PURE__*/React.createElement("span", null, "Mehnat shartnomasi tomonlarning o'zaro kelishuvi bilan istalgan vaqtda bekor qilinishi mumkin ", /*#__PURE__*/React.createElement("span", {
          className: "cite"
        }, "MK\xB799"), ". Ish beruvchi bir tomonlama bekor qilsa, kamida ", /*#__PURE__*/React.createElement("strong", null, "2 oy"), " oldin yozma xabar berishi shart ", /*#__PURE__*/React.createElement("span", {
          className: "cite"
        }, "MK\xB7100"), ". Xodimning tashabbusi bilan \u2014 2 hafta ", /*#__PURE__*/React.createElement("span", {
          className: "cite"
        }, "MK\xB7101"), ". Qoralama tayyorlashimni istaysizmi?"),
        citations: ['MK·99 — Bekor qilish asoslari', 'MK·100 — Ogohlantirish muddati', 'MK·101 — Xodim tashabbusi']
      }]);
    }, 700);
  };
  const askAndGo = q => {
    setView('chat');
    setTimeout(() => send(q), 100);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: view,
    onNavigate: setView,
    user: {
      initials: 'AT',
      name: 'Aziza Tursunova',
      role: 'Yuridik maslahatchi'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "main"
  }, /*#__PURE__*/React.createElement(TopBar, {
    lang: lang,
    setLang: setLang
  }), /*#__PURE__*/React.createElement("div", {
    className: "content",
    style: view === 'chat' ? {
      padding: 0,
      display: 'flex',
      flexDirection: 'column'
    } : {}
  }, view === 'dashboard' && /*#__PURE__*/React.createElement(Dashboard, {
    onNavigate: setView,
    onAsk: askAndGo
  }), view === 'chat' && /*#__PURE__*/React.createElement("div", {
    className: "chat",
    style: {
      padding: '16px 28px'
    }
  }, /*#__PURE__*/React.createElement(ChatThread, {
    messages: messages
  }), /*#__PURE__*/React.createElement(Composer, {
    value: draft,
    setValue: setDraft,
    onSend: () => send(),
    placeholder: "Qonun haqida savol bering yoki hujjat yuklang\u2026"
  })), view === 'editor' && /*#__PURE__*/React.createElement(DocumentEditor, null), view === 'clients' && /*#__PURE__*/React.createElement(ClientsTable, null), (view === 'mk' || view === 'fk' || view === 'qaror') && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: 80,
      color: 'var(--fg-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "book-open",
    size: 32
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      fontFamily: 'var(--font-serif)',
      fontSize: 20,
      color: 'var(--ink-900)'
    }
  }, "Statute browser"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontSize: 13
    }
  }, "Demoda mavjud emas \u2014 UI kit ko'rsatuv uchun")))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web_app/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web_app/Chat.jsx
try { (() => {
function Composer({
  value,
  setValue,
  onSend,
  placeholder
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current && ref.current.textContent !== value) ref.current.textContent = value || '';
  }, [value]);
  const isEmpty = !value || !value.trim();
  return /*#__PURE__*/React.createElement("div", {
    className: "composer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "composer-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "composer-input-wrap"
  }, isEmpty && /*#__PURE__*/React.createElement("div", {
    className: "composer-ph"
  }, placeholder), /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: "composer-input",
    contentEditable: true,
    suppressContentEditableWarning: true,
    onInput: e => setValue(e.currentTarget.textContent),
    onKeyDown: e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend && onSend();
      }
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "composer-tools"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tool-icons"
  }, /*#__PURE__*/React.createElement("button", {
    className: "tool",
    title: "Fayl biriktirish"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "paperclip",
    size: 14
  })), /*#__PURE__*/React.createElement("button", {
    className: "tool",
    title: "Hujjat yuklash"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 14
  })), /*#__PURE__*/React.createElement("button", {
    className: "tool",
    title: "Statyaga havola"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "scale",
    size: 14
  }))), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-brass",
    onClick: onSend
  }, "Yuborish ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-up",
    size: 12,
    light: true
  })))));
}
function Bubble({
  who,
  children,
  citations
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: 'bubble-row' + (who === 'me' ? ' me' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, who === 'me' ? 'Siz' : 'Dictum AI'), /*#__PURE__*/React.createElement("div", {
    className: 'bubble ' + (who === 'me' ? 'user' : 'ai')
  }, children), citations && citations.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      paddingLeft: 4,
      flexWrap: 'wrap'
    }
  }, citations.map((c, i) => /*#__PURE__*/React.createElement("span", {
    className: "cite",
    key: i
  }, c))));
}
function ChatThread({
  messages
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);
  return /*#__PURE__*/React.createElement("div", {
    className: "thread",
    ref: ref
  }, messages.map((m, i) => /*#__PURE__*/React.createElement(Bubble, {
    key: i,
    who: m.who,
    citations: m.citations
  }, m.content)));
}
window.Composer = Composer;
window.Bubble = Bubble;
window.ChatThread = ChatThread;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web_app/Chat.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web_app/Dashboard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Dashboard({
  onNavigate,
  onAsk
}) {
  const recentDocs = [{
    name: 'Mehnat shartnomasi № 481',
    meta: 'DOCX · 4 sahifa',
    badge: 'Tasdiqlangan',
    kind: 'success',
    date: '2 soat'
  }, {
    name: 'Ijara qoralamasi',
    meta: 'DOCX · AI yaratdi',
    badge: 'Qoralama',
    kind: 'warn',
    date: '12 soat'
  }, {
    name: 'NDA — SilkRoad',
    meta: 'PDF · imzolangan',
    badge: 'Yopiq',
    kind: 'neutral',
    date: '1 kun'
  }, {
    name: 'Ish haqi tartibi',
    meta: 'DOCX · ko\'rib chiqilmoqda',
    badge: 'AI tahlil',
    kind: 'brass',
    date: '3 kun'
  }];
  const frequent = [{
    code: 'MK',
    n: '99',
    label: 'Shartnomani bekor qilish'
  }, {
    code: 'MK',
    n: '76',
    label: 'Shartnoma tuzish tartibi'
  }, {
    code: 'FK',
    n: '354',
    label: 'Yuridik shaxslar ro\'yxati'
  }, {
    code: 'MK',
    n: '100',
    label: 'Ogohlantirish muddati'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, "Xush kelibsiz"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: '600 28px/1.2 var(--font-serif)',
      color: 'var(--ink-900)'
    }
  }, "Xayrli kun, Aziza"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    onClick: () => onNavigate('editor')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-plus",
    size: 14
  }), "Yangi hujjat"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-brass",
    onClick: () => onNavigate('chat')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 14,
    light: true
  }), "AI ga savol"))), /*#__PURE__*/React.createElement("div", {
    className: "stats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat brass"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Bu hafta AI tahlil qildi"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "47 hujjat"), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "\u2191 18% o'tgan haftaga nisbatan")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Faol qoralamalar"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "8"), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "3 tasi bugun ko'rib chiqilishi kerak")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Mijozlar"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "142"), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "12 ta yangi shu oy")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-l"
  }, "Iqtiboslangan moddalar"), /*#__PURE__*/React.createElement("div", {
    className: "stat-v"
  }, "312"), /*#__PURE__*/React.createElement("div", {
    className: "stat-d"
  }, "MK \xB7 FK \xB7 Qarorlar"))), /*#__PURE__*/React.createElement("div", {
    className: "grid-2"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "h-section-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "h-section"
  }, "Yaqindagi hujjatlar"), /*#__PURE__*/React.createElement("span", {
    className: "more"
  }, "Hammasini ko'rish \u2192")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, recentDocs.map((d, i) => /*#__PURE__*/React.createElement(DocCard, _extends({
    key: i
  }, d, {
    badgeKind: d.kind,
    onClick: () => onNavigate('editor')
  })))), /*#__PURE__*/React.createElement("div", {
    className: "h-section",
    style: {
      marginTop: 28
    }
  }, "Tezkor savollar"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, ['Mehnat shartnomasini qanday bekor qilish mumkin?', 'Yakka tartibdagi tadbirkorni ro\'yxatdan o\'tkazish tartibi', 'NDA shartnomasi uchun majburiy bandlar nima?'].map((q, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    onClick: () => onAsk(q),
    style: {
      background: '#fff',
      border: '1px solid var(--border-1)',
      borderRadius: 10,
      padding: '12px 14px',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: 13,
      color: 'var(--fg-1)'
    }
  }, /*#__PURE__*/React.createElement("span", null, q), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 14
  }))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "h-section"
  }, "Tez-tez murojaat qilinadigan moddalar"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, frequent.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: '#fff',
      border: '1px solid var(--border-1)',
      borderRadius: 10,
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--navy-700)',
      color: '#fff',
      font: '700 11px/1 var(--font-mono)',
      padding: '4px 6px',
      borderRadius: 4,
      minWidth: 28,
      textAlign: 'center'
    }
  }, f.n), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 11px/1 var(--font-mono)',
      color: 'var(--navy-700)',
      textTransform: 'uppercase',
      letterSpacing: '.06em'
    }
  }, f.code), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 13,
      color: 'var(--ink-900)'
    }
  }, f.label), /*#__PURE__*/React.createElement(Icon, {
    name: "external-link",
    size: 14
  })))), /*#__PURE__*/React.createElement("div", {
    className: "h-section",
    style: {
      marginTop: 28
    }
  }, "Bugungi vazifalar"), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, [{
    l: 'Atlas MChJ — shartnomani qayta ko\'rib chiqish',
    t: '14:00'
  }, {
    l: 'SilkRoad NDA — imzolash',
    t: '16:30'
  }, {
    l: 'D. Murodovaga javob yozish',
    t: 'Bugun'
  }].map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 16,
      height: 16,
      border: '1.5px solid var(--ink-300)',
      borderRadius: 4
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 13
    }
  }, t.l), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 11px/1 var(--font-mono)',
      color: 'var(--fg-3)'
    }
  }, t.t))))))));
}
window.Dashboard = Dashboard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web_app/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web_app/Editor.jsx
try { (() => {
function Alert({
  kind,
  ic,
  title,
  children,
  onClick
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: 'alert a-' + kind,
    onClick: onClick
  }, /*#__PURE__*/React.createElement("div", {
    className: "ic"
  }, ic), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ttl"
  }, title), /*#__PURE__*/React.createElement("div", {
    className: "msg"
  }, children)));
}
function DocumentEditor() {
  return /*#__PURE__*/React.createElement("div", {
    className: "editor-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "paper"
  }, /*#__PURE__*/React.createElement("h1", null, "Mehnat shartnomasi"), /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, "\u2116 2024-481 \xB7 14 aprel, 2026"), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "1."), " \"Atlas Construction\" MChJ (keyingi o'rinlarda \u2014 \"Ish beruvchi\"), STIR ", /*#__PURE__*/React.createElement("span", {
    className: "h-ai"
  }, "300481294"), ", bir tomondan, va ", /*#__PURE__*/React.createElement("strong", null, "Akmal Karimov Olimovich"), ", JShShIR ", /*#__PURE__*/React.createElement("span", {
    className: "h-warn"
  }, "31407851200032"), ", ikkinchi tomondan, quyidagi shartnoma tuzdilar."), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "2."), " Ushbu shartnoma O'zbekiston Respublikasi Mehnat kodeksining 76-moddasiga muvofiq tuzilgan bo'lib, xodimga \"Loyiha menejeri\" lavozimini taklif etadi."), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "3."), " Ish haqi miqdori \u2014 oyiga 18,500,000 so'm, har oyning 5-sanasiga qadar to'lanadi."), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "4."), " Shartnoma muddati \u2014 ", /*#__PURE__*/React.createElement("span", {
    className: "h-danger"
  }, "32.13.2026"), " sanasigacha."), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "5."), " Tomonlar shartnomani 30 kun oldin yozma xabar berib bekor qilishi mumkin.")), /*#__PURE__*/React.createElement("div", {
    className: "review"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    style: {
      marginBottom: 4
    }
  }, "AI tahlil \u2014 3 ta eslatma"), /*#__PURE__*/React.createElement(Alert, {
    kind: "danger",
    ic: "\xD7",
    title: "Sana noto'g'ri"
  }, "4-bandda \"32.13.2026\" \u2014 bunday sana mavjud emas. To'g'rilash kerak."), /*#__PURE__*/React.createElement(Alert, {
    kind: "warn",
    ic: "!",
    title: "JShShIR uzunligi"
  }, "14 raqamli kod ko'rsatilgan, lekin standart 14 emas. Tekshiring."), /*#__PURE__*/React.createElement(Alert, {
    kind: "ai",
    ic: "i",
    title: "Avtomatik to'ldirildi"
  }, "STIR Atlas Construction MChJ ma'lumotlar bazasidan olindi."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-brass",
    style: {
      flex: 1
    }
  }, "Hammasini qabul qilish"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 12
  }))), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      padding: 14,
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, "Manbalar"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--fg-2)',
      lineHeight: 1.5,
      marginTop: 6
    }
  }, "MK 76-modda \xB7 MK 78-modda \xB7 Ish haqi to'lash to'g'risida 481-Qaror"))));
}
function ClientsTable() {
  const rows = [{
    i: 'AK',
    name: 'Akmal Karimov',
    meta: 'JShShIR · 31407851200032',
    email: 'akmal.k@atlas.uz',
    docs: '12 hujjat',
    last: '2 kun'
  }, {
    i: 'NR',
    name: 'Atlas Construction MChJ',
    meta: 'STIR · 300481294',
    email: 'office@atlas.uz',
    docs: '34 hujjat',
    last: '12 soat'
  }, {
    i: 'DM',
    name: 'Dilnoza Murodova',
    meta: 'Yakka tartibdagi tadbirkor',
    email: 'dilnoza.m@gmail.com',
    docs: '5 hujjat',
    last: '6 kun'
  }, {
    i: 'SH',
    name: 'SilkRoad Logistics',
    meta: 'STIR · 305112847',
    email: 'legal@silkroad.uz',
    docs: '21 hujjat',
    last: '1 kun'
  }, {
    i: 'BT',
    name: 'Bekzod Tursunov',
    meta: 'JShShIR · 32907920140018',
    email: 'b.tursunov@mail.ru',
    docs: '3 hujjat',
    last: '3 hafta'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "h-section",
    style: {
      marginBottom: 0
    }
  }, "Mijozlar"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 12,
    light: true
  }), "Yangi mijoz")), /*#__PURE__*/React.createElement("div", null, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    className: "client-row",
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    className: "avatar",
    style: {
      width: 36,
      height: 36
    }
  }, r.i), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "client-name"
  }, r.name), /*#__PURE__*/React.createElement("div", {
    className: "client-meta"
  }, r.meta)), /*#__PURE__*/React.createElement("div", {
    className: "client-meta"
  }, r.email), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Badge, {
    kind: "neutral"
  }, r.docs)), /*#__PURE__*/React.createElement("div", {
    className: "client-meta"
  }, r.last, " oldin")))));
}
window.Alert = Alert;
window.DocumentEditor = DocumentEditor;
window.ClientsTable = ClientsTable;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web_app/Editor.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web_app/PrintApp.jsx
try { (() => {
// Print version — renders all 4 main views stacked, each on its own page

function StaticAppShell({
  view,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "app print-page"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: view,
    onNavigate: () => {},
    user: {
      initials: 'AT',
      name: 'Aziza Tursunova',
      role: 'Yuridik maslahatchi'
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "main"
  }, /*#__PURE__*/React.createElement(TopBar, {
    lang: "UZ",
    setLang: () => {}
  }), /*#__PURE__*/React.createElement("div", {
    className: "content",
    style: view === 'chat' ? {
      padding: 0,
      display: 'flex',
      flexDirection: 'column'
    } : {}
  }, children)));
}
function ChatPrintView() {
  const messages = [{
    who: 'ai',
    content: /*#__PURE__*/React.createElement("span", null, "Salom, Aziza. Men JuristAI \u2014 qonunlar bo'yicha yordamchingiz. Mehnat kodeksi, Fuqarolik kodeksi va so'nggi qarorlar bo'yicha savollarga javob beraman. Hujjat yuklang yoki savol bering.")
  }, {
    who: 'me',
    content: 'Mehnat shartnomasini qanday bekor qilish mumkin?'
  }, {
    who: 'ai',
    content: /*#__PURE__*/React.createElement("span", null, "Mehnat shartnomasi tomonlarning o'zaro kelishuvi bilan istalgan vaqtda bekor qilinishi mumkin ", /*#__PURE__*/React.createElement("span", {
      className: "cite"
    }, "MK\xB799"), ". Ish beruvchi bir tomonlama bekor qilsa, kamida ", /*#__PURE__*/React.createElement("strong", null, "2 oy"), " oldin yozma xabar berishi shart ", /*#__PURE__*/React.createElement("span", {
      className: "cite"
    }, "MK\xB7100"), ". Xodimning tashabbusi bilan \u2014 2 hafta ", /*#__PURE__*/React.createElement("span", {
      className: "cite"
    }, "MK\xB7101"), ". Qoralama tayyorlashimni istaysizmi?"),
    citations: ['MK·99 — Bekor qilish asoslari', 'MK·100 — Ogohlantirish muddati', 'MK·101 — Xodim tashabbusi']
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "chat",
    style: {
      padding: '16px 28px'
    }
  }, /*#__PURE__*/React.createElement(ChatThread, {
    messages: messages
  }), /*#__PURE__*/React.createElement(Composer, {
    value: "",
    setValue: () => {},
    onSend: () => {},
    placeholder: "Qonun haqida savol bering yoki hujjat yuklang\u2026"
  }));
}
function PrintApp() {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(StaticAppShell, {
    view: "dashboard"
  }, /*#__PURE__*/React.createElement(Dashboard, {
    onNavigate: () => {},
    onAsk: () => {}
  })), /*#__PURE__*/React.createElement(StaticAppShell, {
    view: "chat"
  }, /*#__PURE__*/React.createElement(ChatPrintView, null)), /*#__PURE__*/React.createElement(StaticAppShell, {
    view: "editor"
  }, /*#__PURE__*/React.createElement(DocumentEditor, null)), /*#__PURE__*/React.createElement(StaticAppShell, {
    view: "clients"
  }, /*#__PURE__*/React.createElement(ClientsTable, null)));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(PrintApp, null));

// Auto-print after fonts + render settle
(async () => {
  try {
    await document.fonts.ready;
  } catch (e) {}
  setTimeout(() => window.print(), 800);
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web_app/PrintApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web_app/components.jsx
try { (() => {
// Lucide icon helper — uses CDN sprites, tinted via CSS filter
function Icon({
  name,
  size = 16,
  light = false,
  style
}) {
  return /*#__PURE__*/React.createElement("img", {
    src: `https://unpkg.com/lucide-static@0.460.0/icons/${name}.svg`,
    alt: "",
    className: light ? 'lic-light' : 'lic',
    style: {
      width: size,
      height: size,
      ...style
    }
  });
}
function Sidebar({
  active,
  onNavigate,
  user
}) {
  const items = [{
    section: 'Ish maydoni'
  }, {
    id: 'dashboard',
    label: 'Boshqaruv paneli',
    icon: 'layout-dashboard'
  }, {
    id: 'chat',
    label: 'AI Suhbat',
    icon: 'message-square'
  }, {
    id: 'editor',
    label: 'Hujjatlarim',
    icon: 'file-text'
  }, {
    id: 'clients',
    label: 'Mijozlar',
    icon: 'users'
  }, {
    section: 'Qonunchilik'
  }, {
    id: 'mk',
    label: 'Mehnat kodeksi',
    icon: 'book-open'
  }, {
    id: 'fk',
    label: 'Fuqarolik kodeksi',
    icon: 'book-open'
  }, {
    id: 'qaror',
    label: 'Qarorlar',
    icon: 'gavel'
  }];
  return /*#__PURE__*/React.createElement("aside", {
    className: "sidebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mark"
  }, "J"), /*#__PURE__*/React.createElement("div", {
    className: "wm"
  }, "Jurist", /*#__PURE__*/React.createElement("em", null, "AI"))), items.map((it, i) => it.section ? /*#__PURE__*/React.createElement("div", {
    className: "nav-section",
    key: i
  }, it.section) : /*#__PURE__*/React.createElement("div", {
    key: it.id,
    className: 'nav-item' + (active === it.id ? ' active' : ''),
    onClick: () => onNavigate && onNavigate(it.id)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: it.icon,
    light: active === it.id
  }), /*#__PURE__*/React.createElement("span", null, it.label))), /*#__PURE__*/React.createElement("div", {
    className: "nav-foot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "avatar"
  }, user.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, user.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--fg-3)'
    }
  }, user.role)), /*#__PURE__*/React.createElement(Icon, {
    name: "settings",
    size: 14
  })));
}
function TopBar({
  lang,
  setLang
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "search"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 14
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "Qonun, hujjat yoki mijoz qidirish\u2026"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--fg-3)'
    }
  }, "\u2318K")), /*#__PURE__*/React.createElement("div", {
    className: "lang"
  }, ['UZ', 'RU', 'EN'].map(l => /*#__PURE__*/React.createElement("button", {
    key: l,
    className: lang === l ? 'on' : '',
    onClick: () => setLang(l)
  }, l))), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 14
  }), "Bildirishnomalar"));
}
function Badge({
  kind = 'neutral',
  dot,
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: 'badge b-' + kind
  }, dot && /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), children);
}
function DocCard({
  name,
  meta,
  badge,
  badgeKind,
  date,
  onClick
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "doc",
    onClick: onClick
  }, /*#__PURE__*/React.createElement("div", {
    className: "doc-icon"
  }), /*#__PURE__*/React.createElement("div", {
    className: "doc-name"
  }, name), /*#__PURE__*/React.createElement("div", {
    className: "doc-meta"
  }, meta), /*#__PURE__*/React.createElement("div", {
    className: "doc-foot"
  }, /*#__PURE__*/React.createElement(Badge, {
    kind: badgeKind || 'success'
  }, badge), /*#__PURE__*/React.createElement("span", {
    className: "doc-meta"
  }, date)));
}
window.Icon = Icon;
window.Sidebar = Sidebar;
window.TopBar = TopBar;
window.Badge = Badge;
window.DocCard = DocCard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web_app/components.jsx", error: String((e && e.message) || e) }); }

})();
