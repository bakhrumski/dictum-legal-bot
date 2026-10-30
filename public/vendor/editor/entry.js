// JuristAI editor bundle (docs/design/hujjat-muharriri.md, D1). Built once, vendored:
// window.JAIEditorKit = { Editor, extensions() }
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize, BackgroundColor } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Placeholder, CharacterCount } from '@tiptap/extensions';

function extensions({ placeholder = '' } = {}) {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }, codeBlock: false, code: false }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    TextStyle, Color, FontFamily, FontSize, BackgroundColor,
    Highlight.configure({ multicolor: true }),
    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    Placeholder.configure({ placeholder }),
    CharacterCount,
  ];
}

window.JAIEditorKit = { Editor, extensions, version: '3.31.4' };
