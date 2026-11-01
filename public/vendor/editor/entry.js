// JuristAI editor bundle (docs/design/hujjat-muharriri.md, D1). Built once, vendored:
// window.JAIEditorKit = { Editor, extensions() } - D2 adds the comment mark
import { Editor, Mark, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize, BackgroundColor } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Placeholder, CharacterCount } from '@tiptap/extensions';

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

function extensions({ placeholder = '' } = {}) {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }, codeBlock: false, code: false }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    TextStyle, Color, FontFamily, FontSize, BackgroundColor,
    Highlight.configure({ multicolor: true }),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    Placeholder.configure({ placeholder }),
    CharacterCount,
    Comment,
  ];
}

window.JAIEditorKit = { Editor, extensions, version: '3.31.4' };
