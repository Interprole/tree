import type { ANode, Span } from './ast';
import { parse } from './parser';
import { applyChanges } from './edits';
import type { Edit, TextChange } from './edits';

/**
 * Layout of the bracket code: only whitespace between the elements of a node changes, the
 * elements themselves (labels, words, notes, comments) are copied verbatim.
 *
 *   [TP
 *       [DP the cat]
 *       [T'
 *           [T will]
 *           [VP sleep]]]
 *
 * A node that is shallow and short stays on one line; otherwise every daughter starts a new line,
 * indented one step deeper than its mother.
 */

const MAX_LINE = 64;
const INDENT = 4;

interface Item {
  span: Span;
  /** a daughter (node, word, #ref) as opposed to a property (features, ^, note, meaning) */
  daughter: boolean;
  node?: ANode;
  /** text the parser does not keep a span for (node glosses, comments) */
  raw?: boolean;
}

function items(src: string, n: ANode): Item[] {
  const known: Item[] = [];
  for (const c of n.children) {
    if (c.kind === 'node') known.push({ span: c.span, daughter: true, node: c });
    else if (c.kind === 'leaf') known.push({ span: c.fullSpan, daughter: true });
    else known.push({ span: c.span, daughter: true });
  }
  if (n.featureSpan) known.push({ span: n.featureSpan, daughter: false });
  if (n.triangleSpan) known.push({ span: n.triangleSpan, daughter: false });
  if (n.semSpan) known.push({ span: n.semSpan, daughter: false });
  for (const x of n.notes ?? []) known.push({ span: x.span, daughter: false });
  known.sort((a, b) => a.span.from - b.span.from);
  // anything else between the header and "]": glosses of the node, comments
  const out: Item[] = [];
  let pos = n.headerSpan.to;
  const end = n.span.to - 1;
  const gap = (from: number, to: number) => {
    const text = src.slice(from, to);
    const a = text.search(/\S/);
    if (a < 0) return;
    const b = text.length - (text.match(/\s*$/)?.[0].length ?? 0);
    out.push({ span: { from: from + a, to: from + b }, daughter: false, raw: true });
  };
  for (const it of known) {
    if (it.span.from > pos) gap(pos, it.span.from);
    out.push(it);
    pos = Math.max(pos, it.span.to);
  }
  if (end > pos) gap(pos, end);
  return out;
}

const hasComment = (src: string, it: Item) => it.raw && src.slice(it.span.from, it.span.to).includes('%');

function height(n: ANode): number {
  let h = 1;
  for (const c of n.children) if (c.kind === 'node') h = Math.max(h, 1 + height(c));
  return h;
}

/** separator between two consecutive elements on one line: none if they were glued together */
function sep(src: string, a: Item | null, b: Item, headerEnd: number): string {
  const from = a ? a.span.to : headerEnd;
  return /\s/.test(src.slice(from, b.span.from)) || (a === null && b.span.from > headerEnd) ? ' ' : '';
}

function header(src: string, n: ANode): string {
  return src.slice(n.span.from, n.headerSpan.to);
}

function oneLine(src: string, n: ANode): string | null {
  const its = items(src, n);
  let s = header(src, n);
  let prev: Item | null = null;
  for (const it of its) {
    if (hasComment(src, it)) return null;
    const text = it.node ? oneLine(src, it.node) : src.slice(it.span.from, it.span.to);
    if (text === null || text.includes('\n')) return null;
    s += sep(src, prev, it, n.headerSpan.to) + text;
    prev = it;
  }
  return s + ']';
}

/** The formatted text of a node whose "[" stands at column col. */
export function formatNode(src: string, n: ANode, col: number): string {
  const its = items(src, n);
  const flat = oneLine(src, n);
  const hasNodeKids = n.children.some((c) => c.kind === 'node');
  if (flat !== null && (!hasNodeKids || (height(n) <= 2 && col + flat.length <= MAX_LINE))) return flat;
  let s = header(src, n);
  let line = col + s.length;
  const indent = col + INDENT;
  let prev: Item | null = null;
  let breakNext = false;
  for (const it of its) {
    // a daughter on its own line; a comment that had a line of its own keeps it
    const ownLine = it.raw && /\n/.test(src.slice(prev ? prev.span.to : n.headerSpan.to, it.span.from));
    let at: number;
    if (breakNext || it.daughter || ownLine) {
      s += '\n' + ' '.repeat(indent);
      at = indent;
    } else {
      const sp = sep(src, prev, it, n.headerSpan.to);
      s += sp;
      at = line + sp.length;
    }
    const text = it.node ? formatNode(src, it.node, at) : src.slice(it.span.from, it.span.to);
    s += text;
    const nl = text.lastIndexOf('\n');
    line = nl < 0 ? at + text.length : text.length - nl - 1;
    breakNext = !!hasComment(src, it);
    prev = it;
  }
  return s + (breakNext ? '\n' + ' '.repeat(col) : '') + ']';
}

function columnOf(src: string, pos: number): number {
  const nl = src.lastIndexOf('\n', pos - 1);
  return pos - nl - 1;
}

function formatIn(src: string, n: ANode): string {
  return src.slice(0, n.span.from) + formatNode(src, n, columnOf(src, n.span.from)) + src.slice(n.span.to);
}

/** Format the whole tree (arrow lines and comments outside the tree stay as they are). */
export function formatDoc(src: string): string {
  const r = parse(src);
  if (!r.ok || !r.doc.root) return src;
  return formatIn(src, r.doc.root);
}

/* ------------------------------------------------------------ position mapping */

/** Positions survive a change of whitespace: count the other characters. */
function countBefore(s: string, pos: number): number {
  let k = 0;
  for (let i = 0; i < pos && i < s.length; i++) if (!/\s/.test(s[i])) k++;
  return k;
}

/** index of the character after the first k non-space characters (skipping whitespace when start) */
function indexAfter(s: string, k: number, start: boolean): number {
  let i = 0;
  let seen = 0;
  while (i < s.length && seen < k) {
    if (!/\s/.test(s[i])) seen++;
    i++;
  }
  if (start) while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/** A single change turning a into b (common prefix and suffix left alone). */
export function diffChange(a: string, b: string): TextChange | null {
  if (a === b) return null;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return { from: p, to: a.length - q, insert: b.slice(p, b.length - q) };
}

/**
 * Apply a structural canvas edit and tidy the code around it. anchor is a position in the edited
 * text inside the node to format (up = how many mothers higher to start). A mother written on one
 * line that should now take several lines is formatted as well.
 */
export function tidyEdit(src: string, edit: Edit, anchor: number, up = 0): Edit {
  if (edit.error || !edit.changes.length) return edit;
  const src1 = applyChanges(src, edit.changes);
  const r = parse(src1);
  if (!r.ok || !r.doc.root) return edit;
  const parent = new Map<ANode, ANode | null>();
  let deepest: ANode | null = null;
  const visit = (n: ANode, p: ANode | null) => {
    parent.set(n, p);
    if (anchor >= n.span.from && anchor < n.span.to) deepest = n;
    for (const c of n.children) if (c.kind === 'node') visit(c, n);
  };
  visit(r.doc.root, null);
  let target: ANode | null = deepest;
  if (!target) return edit;
  for (let i = 0; i < up && parent.get(target); i++) target = parent.get(target)!;
  // a mother written on one line that should now take several lines is laid out too (the
  // highest such one); mothers already written on several lines are left as the user wrote them
  for (let p = parent.get(target!); p; p = parent.get(p)) {
    const written = src1.slice(p.span.from, p.span.to);
    if (written.includes('\n')) break;
    if (formatNode(src1, p, columnOf(src1, p.span.from)) !== written) target = p;
  }
  const src2 = formatIn(src1, target!);
  const change = diffChange(src, src2);
  if (!change) return { changes: [] };
  const out: Edit = { changes: [change] };
  if (edit.select) {
    const from = indexAfter(src2, countBefore(src1, edit.select.from), true);
    const to = indexAfter(src2, countBefore(src1, edit.select.to), false);
    out.select = { from, to: Math.max(from, to) };
  }
  return out;
}
