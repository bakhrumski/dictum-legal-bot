// JuristAI editor bundle (docs/design/hujjat-muharriri.md). Built once, vendored:
// window.JAIEditorKit = { Editor, extensions(), LiveDoc } - D2 adds the comment mark, D3 live co-editing
import { Editor, Mark, mergeAttributes } from '@tiptap/core';
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

window.JAIEditorKit = { Editor, extensions, LiveDoc, version: '3.31.4' };
