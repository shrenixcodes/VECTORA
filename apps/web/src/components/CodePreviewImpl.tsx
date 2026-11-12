import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { HighlightStyle, type LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

// Syntax colours come from the design tokens, so the preview follows the theme.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--indigo)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--clay)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--warning)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--text)', fontWeight: '500' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--text)' },
  { tag: [t.propertyName, t.variableName], color: 'var(--text-secondary)' },
  { tag: [t.punctuation, t.bracket, t.operator], color: 'var(--text-muted)' },
  { tag: t.heading, fontWeight: '500' },
  { tag: t.invalid, color: 'var(--error)' },
]);

function languageFor(language: string | null, path: string): LanguageSupport | null {
  switch (language) {
    case 'typescript':
      return javascript({ typescript: true, jsx: /\.tsx$/.test(path) });
    case 'javascript':
      return javascript({ jsx: true });
    case 'python':
      return python();
    case 'java':
    case 'csharp':
      return java();
    case 'go':
      return go();
    case 'rust':
      return rust();
    case 'c':
    case 'cpp':
      return cpp();
    case 'json':
      return json();
    case 'markdown':
      return markdown();
    default:
      return null;
  }
}

const rangeMark = Decoration.line({ class: 'cm-vectora-range' });

export interface CodePreviewProps {
  content: string;
  language: string | null;
  path: string;
  /** Line number of the first line of `content` in the original file. */
  firstLine?: number;
  /** Lines (original numbering) to mark as the selected range. */
  highlight?: { start: number; end: number } | null;
  maxHeight?: number | string;
  scrollToLine?: number;
}

/** Read-only source preview. Source text is rendered as text only — never interpreted as markup. */
export function CodePreview({ content, language, path, firstLine = 1, highlight: range, maxHeight = 320, scrollToLine }: CodePreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const lang = languageFor(language, path);
    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({ 'aria-label': `Source of ${path}`, tabindex: '0' }),
      lineNumbers({ formatNumber: (n) => String(n + firstLine - 1) }),
      syntaxHighlighting(highlight),
      EditorView.theme({ '&': { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }, '.cm-scroller': { overflow: 'auto' } }),
    ];
    if (lang) extensions.push(lang);
    if (range) {
      extensions.push(
        EditorView.decorations.of((view) => {
          const b = new RangeSetBuilder<Decoration>();
          const from = Math.max(1, range.start - firstLine + 1);
          const to = Math.min(view.state.doc.lines, range.end - firstLine + 1);
          for (let l = from; l <= to; l++) b.add(view.state.doc.line(l).from, view.state.doc.line(l).from, rangeMark);
          return b.finish();
        }),
      );
    }
    const view = new EditorView({ state: EditorState.create({ doc: content, extensions }), parent: host.current });
    if (scrollToLine) {
      const l = Math.min(view.state.doc.lines, Math.max(1, scrollToLine - firstLine + 1));
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(l).from, { y: 'start', yMargin: 48 }) });
    }
    return () => view.destroy();
  }, [content, language, path, firstLine, range?.start, range?.end, maxHeight, scrollToLine]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={host} className="border border-line bg-elevated" data-testid="code-preview" />;
}
