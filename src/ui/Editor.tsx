import { useEffect, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';
import { Annotation, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo as cmRedo, undo as cmUndo } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import type { StringStream } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import type { CompletionContext } from '@codemirror/autocomplete';
import { setDiagnostics } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { formatCode, setEditorBridge } from '../actions';
import { MACROS } from '../core/richtext';
import { t } from '../i18n';
import { activeTree, error, parsed, selection, source, tree } from '../state';

/* ------------------------------------------------------------ highlighting */

interface St {
  depth: number;
  expectLabel: boolean;
  inLabel: boolean;
  feat: number;
  gloss: boolean;
  arrowLine: boolean;
}

const bracketLang = StreamLanguage.define<St>({
  name: 'brackets',
  startState: () => ({ depth: 0, expectLabel: false, inLabel: false, feat: 0, gloss: false, arrowLine: false }),
  copyState: (s) => ({ ...s }),
  token(stream: StringStream, s: St): string | null {
    if (stream.sol()) {
      s.arrowLine = false;
      if (s.depth === 0 && stream.match(/^\s*#/, false)) s.arrowLine = true;
    }
    if (stream.eatSpace()) {
      s.inLabel = false;
      return null;
    }
    const ch = stream.peek()!;
    if (ch === '%') {
      stream.skipToEnd();
      return 'comment';
    }
    if (ch === '\\') {
      stream.next();
      if (!stream.match(/^[A-Za-z]+/)) stream.next();
      return 'escape';
    }
    if (s.arrowLine) {
      if (stream.match(/^#[\p{L}\p{N}_\-.:]+(\/\d+)?/u)) return 'link';
      if (stream.match(/^(<->|<-|->|--|<=>|=>|<=)/)) return 'operator';
      if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
      if (stream.match(/^@#?[A-Za-z0-9]+/)) return 'color';
      if (stream.match(/^\S+/)) return 'keyword';
    }
    if (s.feat > 0) {
      if (ch === '{') {
        s.feat++;
        stream.next();
        return 'brace';
      }
      if (ch === '}') {
        s.feat--;
        stream.next();
        return 'brace';
      }
      if (ch === ',') {
        stream.next();
        return 'punctuation';
      }
      stream.match(/^[^{},\\%]+/);
      return 'attributeName';
    }
    if (ch === '[') {
      stream.next();
      s.depth++;
      s.expectLabel = true;
      s.gloss = false;
      return 'squareBracket';
    }
    if (ch === ']') {
      stream.next();
      s.depth = Math.max(0, s.depth - 1);
      s.expectLabel = false;
      s.gloss = false;
      return 'squareBracket';
    }
    if (ch === '{' ) {
      stream.next();
      s.feat = 1;
      s.expectLabel = false;
      return 'brace';
    }
    if (ch === '|') {
      stream.next();
      s.gloss = true;
      s.expectLabel = false;
      return 'separator';
    }
    if (s.expectLabel || s.inLabel) {
      s.expectLabel = false;
      s.inLabel = true;
      if (stream.match(/^#[\p{L}\p{N}_\-.:]+[!?]?/u)) return 'link';
      if (stream.match(/^@@?#?[A-Za-z0-9]+/)) return 'color';
      if (ch === '*') {
        stream.next();
        return 'operator';
      }
      if (stream.match(/^[_^](\{[^}]*\}|[\p{L}\p{N}]+)/u)) return 'special';
      stream.match(/^[^\s[\]{}|#*@%\\_^]+/) || stream.next();
      return 'typeName';
    }
    if (ch === '$') {
      stream.next();
      while (!stream.eol() && stream.peek() !== '$') stream.next();
      if (stream.peek() === '$') stream.next();
      return 'meaning';
    }
    if (s.gloss) {
      stream.match(/^[^[\]|{\\%]+/) || stream.next();
      return 'string';
    }
    if (ch === '#') {
      stream.match(/^#[\p{L}\p{N}_\-.:]*[!?]?/u);
      return 'link';
    }
    if (ch === '^') {
      stream.next();
      if (stream.match(/^\{[^}]*\}/) || stream.match(/^[\p{L}\p{N}]+/u)) return 'special';
      return 'operator';
    }
    if (ch === '_') {
      stream.next();
      stream.match(/^\{[^}]*\}/) || stream.match(/^[\p{L}\p{N}]+/u);
      return 'special';
    }
    if (ch === '<' && stream.match(/^<[^<>[\]]*>/)) return 'deleted';
    stream.match(/^[^\s[\]{}|#%\\_^<]+/) || stream.next();
    return 'content';
  },
  tokenTable: {
    squareBracket: tags.squareBracket,
    brace: tags.brace,
    typeName: tags.typeName,
    link: tags.link,
    color: tags.color,
    operator: tags.operator,
    special: tags.special(tags.string),
    attributeName: tags.attributeName,
    separator: tags.separator,
    string: tags.string,
    escape: tags.escape,
    content: tags.content,
    comment: tags.comment,
    keyword: tags.keyword,
    punctuation: tags.punctuation,
    deleted: tags.deleted,
    meaning: tags.monospace,
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.squareBracket, color: 'var(--cm-bracket)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--cm-label)', fontWeight: '600' },
  { tag: tags.content, color: 'var(--cm-text)' },
  { tag: tags.link, color: 'var(--cm-id)', fontWeight: '600' },
  { tag: tags.color, color: 'var(--cm-color)' },
  { tag: tags.operator, color: 'var(--cm-op)', fontWeight: '700' },
  { tag: tags.special(tags.string), color: 'var(--cm-script)' },
  { tag: tags.attributeName, color: 'var(--cm-feature)' },
  { tag: [tags.separator, tags.brace, tags.punctuation], color: 'var(--cm-op)' },
  { tag: tags.string, color: 'var(--cm-gloss)', fontStyle: 'italic' },
  { tag: tags.escape, color: 'var(--cm-escape)' },
  { tag: tags.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--cm-keyword)' },
  { tag: tags.deleted, color: 'var(--cm-comment)' },
  { tag: tags.monospace, color: 'var(--cm-meaning)' },
]);

function macroCompletions(ctx: CompletionContext) {
  const word = ctx.matchBefore(/\\[A-Za-z]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: Object.entries(MACROS).filter(([k]) => /^[A-Za-z]/.test(k)).map(([k, v]) => ({ label: '\\' + k, detail: v, type: 'constant' })),
    validFor: /^\\[A-Za-z]*$/,
  };
}

const External = Annotation.define<boolean>();

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--editor-bg)', color: 'var(--cm-text)' },
  '.cm-scroller': { fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--caret)', padding: '10px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--caret)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--editor-sel) !important' },
  '.cm-matchingBracket': { backgroundColor: 'var(--editor-match)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px', backgroundColor: 'var(--danger-bg)' },
});

/** Deepest node whose source span contains pos. */
function nodeAt(pos: number): string | null {
  const tr = tree.value;
  if (!tr) return null;
  let best: { key: string; size: number } | null = null;
  for (const n of tr.nodes) {
    const s = n.src;
    if (!s) continue;
    const span = s.kind === 'leaf' ? s.fullSpan : s.span;
    if (pos >= span.from && pos <= span.to) {
      const size = span.to - span.from;
      if (!best || size <= best.size) best = { key: n.key, size };
    }
  }
  return best?.key ?? null;
}

export function Editor() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let view: EditorView;
    const extensions = [
      lineNumbers(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [macroCompletions], icons: false }),
      bracketLang,
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      placeholder(t('emptyDoc')),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab, { key: 'Shift-Alt-f', run: () => (formatCode(), true) }]),
      editorTheme,
      EditorView.contentAttributes.of({ 'aria-label': 'Tree source in bracket notation', spellcheck: 'false' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) {
          source.value = u.state.doc.toString();
        }
        if (u.selectionSet && u.transactions.some((tr) => tr.isUserEvent('select') || tr.isUserEvent('input'))) {
          const key = nodeAt(u.state.selection.main.head);
          if (key && view.hasFocus) selection.value = { kind: 'node', key };
        }
      }),
    ];
    const make = (doc: string) => EditorState.create({ doc, extensions });
    view = new EditorView({ parent: host.current!, state: make(source.value) });
    // every code of the canvas keeps its own editor state (and undo history); linked copies share one
    const states = new Map<string, EditorState>();
    let shownSrc = activeTree.peek().srcId;
    const stopSync = effect(() => {
      const src = activeTree.value.srcId;
      const s = source.value;
      if (src !== shownSrc) {
        states.set(shownSrc, view.state);
        shownSrc = src;
        const saved = states.get(src);
        view.setState(saved && saved.doc.toString() === s ? saved : make(s));
        return;
      }
      // external changes (examples, links, my trees) → editor
      if (s !== view.state.doc.toString()) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s }, annotations: External.of(true) });
      }
    });
    // diagnostics
    const stopDiag = effect(() => {
      void parsed.value;
      const e = error.value;
      const len = view.state.doc.length;
      const diags = e
        ? [
            { from: Math.min(e.from, len), to: Math.min(Math.max(e.to, e.from + 1), len), severity: 'error' as const, message: e.message },
            ...(e.related ? [{ from: Math.min(e.related.from, len), to: Math.min(e.related.to, len), severity: 'info' as const, message: e.message }] : []),
          ]
        : [];
      // wait until the doc matches the parsed text
      queueMicrotask(() => view.dispatch(setDiagnostics(view.state, diags.filter((d) => d.to <= view.state.doc.length))));
    });
    setEditorBridge({
      apply(edit) {
        const len = view.state.doc.length;
        const changes = edit.changes.map((c) => ({ from: Math.min(c.from, len), to: Math.min(c.to, len), insert: c.insert }));
        const tr = view.state.update({ changes, userEvent: 'input.canvas', scrollIntoView: false });
        let sel: EditorSelection | undefined;
        if (edit.select) {
          const L = tr.newDoc.length;
          sel = EditorSelection.single(Math.min(edit.select.from, L), Math.min(edit.select.to, L));
        }
        view.dispatch(sel ? { changes, selection: sel, userEvent: 'input.canvas' } : { changes, userEvent: 'input.canvas' });
      },
      applySilent(changes) {
        const len = view.state.doc.length;
        view.dispatch({
          changes: changes.map((c) => ({ from: Math.min(c.from, len), to: Math.min(c.to, len), insert: c.insert })),
          annotations: Transaction.addToHistory.of(false),
        });
      },
      undo: () => cmUndo(view),
      redo: () => cmRedo(view),
      select(from, to, focus) {
        const L = view.state.doc.length;
        view.dispatch({ selection: EditorSelection.single(Math.min(from, L), Math.min(to, L)), scrollIntoView: true });
        if (focus) view.focus();
      },
    });
    return () => {
      stopSync();
      stopDiag();
      setEditorBridge(null);
      view.destroy();
    };
  }, []);
  return <div class="editor" ref={host} />;
}
