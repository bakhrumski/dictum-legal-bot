// JuristAI editor bundle (docs/design/hujjat-muharriri.md). Built once, vendored:
// window.JAIEditorKit = { Editor, extensions(), LiveDoc } - D2 adds the comment mark, D3 live co-editing,
// U5a (docs/design/ux-audit-2026-11.md) sub / superscript, line spacing, indent, page break and the
// page's own highlights (the place a card points to, find results) as decorations - never in the text
import { Editor, Mark, Node, Extension, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize, BackgroundColor } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// D2: a comment's anchor - the commented words carry <span data-comment="<id>">; overlapping comments allowed
const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { id: { default: null, parseHTML: el => el.getAttribute('data-comment'), renderHTML: a => (a.id ? { 'data-comment': a.id } : {}) } };
  },
  parseHTML() { return [{ tag: 'span[data-comment]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { class: 'ed-cm' }), 0]; },
});

// U5a: line spacing and left indent of a paragraph or heading, as the inline style Word and our sanitizer know
const LINE_HEIGHTS = ['1', '1.15', '1.5', '2'];
const INDENT_CM = 1.25, INDENT_MAX = 8;
const BLOCKS = ['paragraph', 'heading'];
const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{ types: BLOCKS, attributes: {
      lineHeight: {
        default: null,
        parseHTML: el => { const v = String(el.style.lineHeight || '').trim(); return LINE_HEIGHTS.includes(v) ? v : null; },
        renderHTML: a => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
      },
      indent: {
        default: 0,
        parseHTML: el => { const m = /^(\d+(?:\.\d+)?)cm$/.exec(String(el.style.marginLeft || '').trim()); return m ? Math.min(INDENT_MAX, Math.round(parseFloat(m[1]) / INDENT_CM)) : 0; },
        renderHTML: a => (a.indent ? { style: `margin-left: ${+(a.indent * INDENT_CM).toFixed(2)}cm` } : {}),
      },
    } }];
  },
  addCommands() {
    // every paragraph / heading the selection touches
    const each = fn => () => ({ tr, state, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!BLOCKS.includes(node.type.name)) return true;
        const next = fn(node.attrs);
        if (next) { if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next }); changed = true; }
        return false;
      });
      return changed;
    };
    return {
      setLineHeight: v => each(() => ({ lineHeight: LINE_HEIGHTS.includes(String(v)) ? String(v) : null }))(),
      indent: each(a => (a.indent < INDENT_MAX ? { indent: a.indent + 1 } : null)),
      outdent: each(a => (a.indent > 0 ? { indent: a.indent - 1 } : null)),
      unsetParagraphFormat: each(a => (a.lineHeight || a.indent ? { lineHeight: null, indent: 0 } : null)),
    };
  },
});

// U5a: a page break - <hr data-page-break>; Word gets <w:br w:type="page"/> (src/drafting/html-to-docx.js)
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'hr[data-page-break]', priority: 60 }]; },
  renderHTML() { return ['hr', { 'data-page-break': '1', class: 'ed-pb' }]; },
  addCommands() {
    // at the start of the selection - selected words are never replaced by the break; the text after it
    // starts the next page; at the very end a new empty paragraph follows so there is a line to write on
    return {
      setPageBreak: () => ({ chain, state }) => {
        const at = state.selection.from, atEnd = state.selection.$from.parentOffset === state.selection.$from.parent.content.size && at >= state.doc.content.size - 1;
        return chain().setTextSelection(at).insertContent(atEnd ? [{ type: this.name }, { type: 'paragraph' }] : { type: this.name }).run();
      },
    };
  },
  addKeyboardShortcuts() { return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }; },
});

// U5a: the page's own highlights - find results and the place an AI / check card points to (light blue).
// Decorations only: they are never saved, never shared with co-editors, and follow the text as it changes.
const spotsKey = new PluginKey('jaiSpots');
const Spots = Extension.create({
  name: 'jaiSpots',
  addProseMirrorPlugins() {
    const map = (r, m) => { if (!r) return null; const a = m.map(r.from, 1), b = m.map(r.to, -1); return b > a ? { from: a, to: b } : null; };
    return [new Plugin({
      key: spotsKey,
      state: {
        init: () => ({ find: [], cur: -1, spot: null }),
        apply(tr, v) {
          let n = v;
          if (tr.docChanged) n = { find: v.find.map(r => map(r, tr.mapping)).filter(Boolean), cur: v.cur, spot: map(v.spot, tr.mapping) };
          const meta = tr.getMeta(spotsKey);
          return meta ? { ...n, ...meta } : n;
        },
      },
      props: {
        decorations(state) {
          const v = spotsKey.getState(state), size = state.doc.content.size, list = [];
          const ok = r => r && r.from >= 0 && r.to <= size && r.to > r.from;
          v.find.forEach((r, i) => { if (ok(r)) list.push(Decoration.inline(r.from, r.to, { class: i === v.cur ? 'ed-find on' : 'ed-find' })); });
          if (ok(v.spot)) list.push(Decoration.inline(v.spot.from, v.spot.to, { class: 'ed-spot' }));
          return list.length ? DecorationSet.create(state.doc, list) : DecorationSet.empty;
        },
      },
    })];
  },
  addCommands() {
    return {
      setFindRanges: (find, cur) => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(spotsKey, { find: find || [], cur: cur == null ? -1 : cur }).setMeta('addToHistory', false); return true; },
      setSpot: r => ({ tr, dispatch }) => { if (dispatch) tr.setMeta(spotsKey, { spot: r || null }).setMeta('addToHistory', false); return true; },
    };
  },
});

/** live: { doc, awareness, user: { name, color } } turns on co-editing (its own undo replaces the plain one). */
function extensions({ placeholder = '', live = null } = {}) {
  const list = [
    StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }, codeBlock: false, code: false, undoRedo: live ? false : undefined }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    TextStyle, Color, FontFamily, FontSize, BackgroundColor,
    Highlight.configure({ multicolor: true }),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    Placeholder.configure({ placeholder }),
    CharacterCount,
    Comment,
    Subscript, Superscript, ParagraphFormat, PageBreak, Spots,
  ];
  if (live) {
    list.push(Collaboration.configure({ document: live.doc }));
    list.push(CollaborationCaret.configure({ provider: { awareness: live.awareness }, user: live.user }));
  }
  return list;
}

// D3: one document's live connection to our server (src/editor/live.js). Binary frames are the Yjs
// protocol (0 = sync, 1 = awareness); text frames are JSON control messages from the server
// ({ type: 'init' | 'seed' | 'reload' | 'comments' | 'members' | 'closed' }).
const MSG_SYNC = 0, MSG_AWARENESS = 1;
class LiveDoc {
  constructor(url, { onControl = () => {}, onStatus = () => {} } = {}) {
    this.url = url; this.onControl = onControl; this.onStatus = onStatus;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.synced = false; this.closed = false; this.ws = null; this.retry = 0;
    this._onUpdate = (update, origin) => {
      if (origin === this) return;
      const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC); syncProtocol.writeUpdate(e, update); this.send(encoding.toUint8Array(e));
    };
    this._onAwareness = ({ added, updated, removed }) => {
      const changed = added.concat(updated, removed);
      const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_AWARENESS);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)); this.send(encoding.toUint8Array(e));
    };
    this.doc.on('update', this._onUpdate);
    this.awareness.on('update', this._onAwareness);
    this.connect();
  }
  connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.url); ws.binaryType = 'arraybuffer'; this.ws = ws;
    this.onStatus('connecting');
    ws.onopen = () => {
      this.retry = 0; this.onStatus('open');
      const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC); syncProtocol.writeSyncStep1(e, this.doc); this.send(encoding.toUint8Array(e));
      if (this.awareness.getLocalState() !== null) this._onAwareness({ added: [this.doc.clientID], updated: [], removed: [] });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') { let m = null; try { m = JSON.parse(ev.data); } catch (_) { /* not ours */ } if (m) this.onControl(m); return; }
      const d = decoding.createDecoder(new Uint8Array(ev.data));
      const type = decoding.readVarUint(d);
      if (type === MSG_SYNC) {
        const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC);
        const kind = syncProtocol.readSyncMessage(d, e, this.doc, this);
        if (encoding.length(e) > 1) this.send(encoding.toUint8Array(e));
        if (kind === syncProtocol.messageYjsSyncStep2 && !this.synced) { this.synced = true; this.onControl({ type: 'synced' }); }
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), this);
      }
    };
    ws.onclose = (ev) => {
      this.ws = null; this.synced = false; this.onStatus('closed', ev.code);
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(this.awareness.getStates().keys()).filter(k => k !== this.doc.clientID), this);
      // 4000-4099: the server asked us to stop (reload / no access); the page decides what to do
      if (ev.code >= 4000 && ev.code < 4100) { this.onControl({ type: 'closed', code: ev.code }); return; }
      if (!this.closed) setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** this.retry++));
    };
  }
  send(buf) { if (this.ws && this.ws.readyState === 1) this.ws.send(buf); }
  destroy() {
    this.closed = true;
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.doc.off('update', this._onUpdate); this.awareness.off('update', this._onAwareness);
    if (this.ws) this.ws.close(1000);
    this.doc.destroy();
  }
}

window.JAIEditorKit = { Editor, extensions, LiveDoc, version: '3.31.4', build: 4, LINE_HEIGHTS };
