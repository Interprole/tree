import type { AArrow, ADoc, ALeaf, ANode } from './ast';
import { walkAst } from './parser';

/**
 * Canvas operations expressed as minimal edits of the source text. The text stays the single
 * source of truth: undo/redo, sharing and the code editor all work on it.
 */

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface Edit {
  changes: TextChange[];
  /** range to select afterwards, in the coordinates of the new text */
  select?: { from: number; to: number };
}

/** Apply changes (any order, non-overlapping) to a string. */
export function applyChanges(src: string, changes: TextChange[]): string {
  const sorted = [...changes].sort((a, b) => b.from - a.from);
  let out = src;
  for (const c of sorted) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

/** Map a position in the old text to the new text. */
export function mapPos(pos: number, changes: TextChange[]): number {
  let delta = 0;
  for (const c of changes) if (c.to <= pos) delta += c.insert.length - (c.to - c.from);
  return pos + delta;
}

const LABEL_SPECIAL = /([[\]{}|#*@%\\"])/g;

/** Escape a label typed on the canvas so that it parses back to itself (markup _ ^ ' is kept). */
export function escapeLabel(s: string): string {
  return s.trim().replace(LABEL_SPECIAL, '\\$1').replace(/\s+/g, '~');
}

export function escapeText(s: string): string {
  let t = s.trim().replace(/([[\]{}|%\\"])/g, '\\$1').replace(/(^|\s)#/g, '$1\\#');
  if (t.startsWith('^')) t = '\\' + t;
  return t;
}

export function modifiers(n: Pick<ANode, 'id' | 'head' | 'color' | 'branchColor'>): string {
  return (n.id ? '#' + n.id : '') + (n.head ? '*' : '') + (n.color ? '@' + n.color : '') + (n.branchColor ? '@@' + n.branchColor : '');
}

function setModifiers(n: ANode, patch: Partial<Pick<ANode, 'id' | 'head' | 'color' | 'branchColor'>>): TextChange {
  const next = { id: n.id, head: n.head, color: n.color, branchColor: n.branchColor, ...patch };
  const ins = modifiers(next);
  // a node without a header token: the header starts right after "["; an empty label followed
  // directly by a child needs a separating space
  const needsSpace = n.labelSpan.to === n.headerSpan.to && n.headerSpan.from === n.headerSpan.to && ins !== '';
  return { from: n.labelSpan.to, to: n.headerSpan.to, insert: ins + (needsSpace ? ' ' : '') };
}

export function renameNode(src: string, n: ANode, label: string): Edit {
  const ins = escapeLabel(label);
  const next = src[n.labelSpan.to];
  const needsSpace = n.headerSpan.from === n.headerSpan.to && ins !== '' && next !== ' ' && next !== '\n' && next !== ']';
  const change = { from: n.labelSpan.from, to: n.labelSpan.to, insert: ins + (needsSpace ? ' ' : '') };
  return { changes: [change], select: { from: n.labelSpan.from, to: n.labelSpan.from + ins.length } };
}

export function renameLeaf(l: ALeaf, text: string): Edit {
  const ins = escapeText(text);
  return { changes: [{ from: l.span.from, to: l.span.to, insert: ins }], select: { from: l.span.from, to: l.span.from + ins.length } };
}

export function addChild(n: ANode, label = 'X'): Edit {
  const at = n.span.to - 1;
  const ins = ` [${label}]`;
  return { changes: [{ from: at, to: at, insert: ins }], select: { from: at + 2, to: at + 2 + label.length } };
}

export function addSister(n: ANode | ALeaf, label = 'X'): Edit {
  const at = n.kind === 'leaf' ? n.fullSpan.to : n.span.to;
  const ins = ` [${label}]`;
  return { changes: [{ from: at, to: at, insert: ins }], select: { from: at + 2, to: at + 2 + label.length } };
}

/** Remove a range together with the whitespace before it (keeps the text tidy). */
function removeRange(src: string, from: number, to: number): TextChange {
  let f = from;
  while (f > 0 && (src[f - 1] === ' ' || src[f - 1] === '\t')) f--;
  // removing the whole remainder of a line: also eat the line break
  if (src[f - 1] === '\n' && (src[to] === '\n' || to >= src.length)) f--;
  return { from: f, to, insert: '' };
}

export function deleteElement(src: string, doc: ADoc, target: ANode | ALeaf): Edit {
  const changes: TextChange[] = [];
  const span = target.kind === 'leaf' ? target.fullSpan : target.span;
  if (target.kind === 'node' && target === doc.root) return { changes: [{ from: span.from, to: span.to, insert: '' }] };
  changes.push(removeRange(src, span.from, span.to));
  if (target.kind === 'node') {
    // ids defined inside the removed subtree: drop their references and arrows
    const ids = new Set<string>();
    walkAst(target, (n) => n.id && ids.add(n.id));
    if (ids.size && doc.root) {
      walkAst(doc.root, (n) => {
        if (n.span.from >= span.from && n.span.to <= span.to) return;
        for (const c of n.children) if (c.kind === 'ref' && ids.has(c.id)) changes.push(removeRange(src, c.span.from, c.span.to));
      });
      for (const a of doc.arrows) if (ids.has(a.from) || ids.has(a.to)) changes.push(removeRange(src, a.span.from, a.span.to));
    }
  }
  return { changes: dedupe(changes) };
}

function dedupe(changes: TextChange[]): TextChange[] {
  // drop changes nested in others
  return changes.filter((c, i) => !changes.some((o, j) => j !== i && o.from <= c.from && o.to >= c.to && (o.from !== c.from || o.to !== c.to || j < i)));
}

function leafTexts(n: ANode, doc: ADoc, seen = new Set<ANode>()): string[] {
  if (seen.has(n)) return [];
  seen.add(n);
  const out: string[] = [];
  for (const c of n.children) {
    if (c.kind === 'leaf') out.push(c.text);
    else if (c.kind === 'node') out.push(...leafTexts(c, doc, seen));
    else {
      const t = doc.ids.get(c.id);
      if (t) out.push(...leafTexts(t, doc, seen));
    }
  }
  return out;
}

/** Collapse a constituent into a triangle over its yield, or undo a triangle. */
export function toggleTriangle(src: string, doc: ADoc, n: ANode): Edit {
  if (n.triangle && n.triangleSpan) {
    const s = n.triangleSpan;
    return { changes: [{ from: s.from, to: s.to, insert: '' }] };
  }
  const words = leafTexts(n, doc).join(' ');
  const feats = n.featureSpan ? ' ' + src.slice(n.featureSpan.from, n.featureSpan.to) : '';
  const gloss = n.children.flatMap((c) => (c.kind === 'leaf' ? c.gloss : []));
  const g = gloss.length && n.children.filter((c) => c.kind === 'leaf').length === 1 ? gloss.map((x) => ' | ' + x).join('') : '';
  const sep = n.headerSpan.from === n.headerSpan.to ? '' : ' ';
  return { changes: [{ from: n.headerSpan.to, to: n.span.to - 1, insert: `${feats}${sep}^${words || '…'}${g}` }] };
}

export function setColor(n: ANode, color: string | null, branch: boolean): Edit {
  return { changes: [setModifiers(n, branch ? { branchColor: color ?? undefined, color: undefined } : { color: color ?? undefined })] };
}

/** Mark n as the projecting daughter (removes the mark from its sisters). */
export function setHead(n: ANode, parent: ANode | null, on: boolean): Edit {
  const changes: TextChange[] = [setModifiers(n, { head: on })];
  if (on && parent) for (const c of parent.children) if (c.kind === 'node' && c !== n && c.head) changes.push(setModifiers(c, { head: false }));
  return { changes };
}

export function freshId(doc: ADoc, label: string): string {
  const base = label.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 6) || 'n';
  let id = base;
  for (let k = 2; doc.ids.has(id); k++) id = base + k;
  return id;
}

/** Make sure a node has an id; returns the id and the change needed (if any). */
export function ensureId(doc: ADoc, n: ANode, reserved: Set<string> = new Set()): { id: string; change?: TextChange } {
  if (n.id) return { id: n.id };
  let id = freshId(doc, n.label.replace(/[_^{}\\'"].*$/, ''));
  for (let k = 2; reserved.has(id) || doc.ids.has(id); k++) id = freshId(doc, n.label) + k;
  reserved.add(id);
  return { id, change: setModifiers(n, { id }) };
}

export function arrowLine(a: Omit<AArrow, 'span'>): string {
  const op = a.head === 'both' ? '<->' : a.head === 'start' ? '<-' : a.head === 'none' ? '--' : '->';
  const parts = [`#${a.from} ${op} #${a.to}`];
  if (a.line !== 'solid') parts.push(a.line);
  if (a.route !== 'under') parts.push(a.route);
  if (a.color) parts.push('@' + a.color);
  if (a.label) parts.push(`"${a.label.replace(/(["\\])/g, '\\$1')}"`);
  if (a.bend && (Math.round(a.bend[0]) !== 0 || Math.round(a.bend[1]) !== 0)) parts.push(`bend=${Math.round(a.bend[0])},${Math.round(a.bend[1])}`);
  return parts.join(' ');
}

/** Add an arrow between two nodes, giving them ids where needed. */
export function addArrow(src: string, doc: ADoc, from: ANode, to: ANode, extra: Partial<AArrow> = {}): Edit {
  const reserved = new Set<string>();
  const a = ensureId(doc, from, reserved);
  const b = from === to ? a : ensureId(doc, to, reserved);
  const changes: TextChange[] = [];
  if (a.change) changes.push(a.change);
  if (b.change && b !== a) changes.push(b.change);
  const line = arrowLine({ from: a.id, to: b.id, head: 'end', line: 'solid', route: 'under', ...extra });
  const trimmedEnd = src.replace(/\s+$/, '').length;
  changes.push({ from: trimmedEnd, to: src.length, insert: '\n' + line + '\n' });
  return { changes };
}

export function updateArrow(a: AArrow, patch: Partial<AArrow>): Edit {
  const next = { ...a, ...patch };
  return { changes: [{ from: a.span.from, to: a.span.to, insert: arrowLine(next) }] };
}

export function deleteArrow(src: string, a: AArrow): Edit {
  let to = a.span.to;
  // also drop a trailing comment on the same line
  while (to < src.length && src[to] !== '\n') to++;
  return { changes: [removeRange(src, a.span.from, to)] };
}
