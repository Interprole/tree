import type { AArrow, AChild, ADoc, ALeaf, ANode, ARef } from './ast';
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

type Mods = Pick<ANode, 'id' | 'head' | 'color' | 'branchColor' | 'pronounce'>;

export function modifiers(n: Mods): string {
  const voice = n.id && n.pronounce !== undefined ? (n.pronounce ? '!' : '?') : '';
  return (n.id ? '#' + n.id : '') + voice + (n.head ? '*' : '') + (n.color ? '@' + n.color : '') + (n.branchColor ? '@@' + n.branchColor : '');
}

function setModifiers(n: ANode, patch: Partial<Mods>): TextChange {
  const next = { id: n.id, head: n.head, color: n.color, branchColor: n.branchColor, pronounce: n.pronounce, ...patch };
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

export function addChild(n: ANode | ALeaf, label = 'X'): Edit {
  if (n.kind === 'leaf') {
    // a terminal gets a daughter: it becomes a node labelled with its text
    const ins = `[${n.text} [${label}]]`;
    const at = n.span.from + n.text.length + 3;
    return { changes: [{ from: n.span.from, to: n.span.to, insert: ins }], select: { from: at, to: at + label.length } };
  }
  const at = n.span.to - 1;
  const ins = ` [${label}]`;
  return { changes: [{ from: at, to: at, insert: ins }], select: { from: at + 2, to: at + 2 + label.length } };
}

/** Insert a reference to another constituent (a new position of the same element). */
export function addCopy(doc: ADoc, target: ANode, place: { kind: 'daughter'; of: ANode } | { kind: 'sister'; of: ANode | ALeaf }): Edit {
  const { id, change } = ensureId(doc, target);
  const at = place.kind === 'daughter' ? place.of.span.to - 1 : place.of.kind === 'leaf' ? place.of.fullSpan.to : place.of.span.to;
  const changes: TextChange[] = [{ from: at, to: at, insert: ` #${id}` }];
  if (change) changes.push(change);
  return { changes };
}

/** Replace (or add) the feature stack. */
export function setFeatures(n: ANode, features: string): Edit {
  const body = features.trim();
  if (n.featureSpan) return { changes: [{ from: n.featureSpan.from, to: n.featureSpan.to, insert: body ? `{${body}}` : '' }] };
  if (!body) return { changes: [] };
  return { changes: [{ from: n.headerSpan.to, to: n.headerSpan.to, insert: `{${body}}` }] };
}

/** Replace (or add) the meaning $…$. */
export function setMeaning(n: ANode, formula: string): Edit {
  const body = formula.trim().replace(/\$/g, '\\$');
  if (n.semSpan) return { changes: [{ from: n.semSpan.from, to: n.semSpan.to, insert: body ? `$${body}$` : '' }] };
  if (!body) return { changes: [] };
  const at = n.span.to - 1;
  return { changes: [{ from: at, to: at, insert: ` $${body}$` }] };
}

/** Pronounce / silence one position of a chain (the defining node or a #ref). */
export function setPronounce(occurrence: { node: ANode } | { ref: ARef }, value: boolean | undefined): Edit {
  if ('node' in occurrence) return { changes: [setModifiers(occurrence.node, { pronounce: value })] };
  const r = occurrence.ref;
  const id = r.id;
  return { changes: [{ from: r.span.from, to: r.span.to, insert: `#${id}${value === undefined ? '' : value ? '!' : '?'}` }] };
}

/** Bundle two sister heads [X a] [Y b] into [X.Y a b] (Distributed Morphology). */
export function bundle(src: string, x: ANode, y: ANode): Edit {
  const [first, second] = x.span.from < y.span.from ? [x, y] : [y, x];
  const content = (n: ANode) => src.slice(n.headerSpan.to, n.span.to - 1).trim();
  const label = `${first.label}.${second.label}`;
  const body = [content(first), content(second)].filter(Boolean).join(' ');
  const merged = `[${label}${E_mods(first)}${body ? ' ' + body : ''}]`;
  return {
    changes: [
      { from: first.span.from, to: first.span.to, insert: merged },
      removeRange(src, second.span.from, second.span.to),
    ],
  };
}

function E_mods(n: ANode): string {
  return modifiers({ id: n.id, head: n.head, color: n.color, branchColor: n.branchColor, pronounce: n.pronounce });
}

/** Re-bracket the daughters of a node: flat, right-branching or left-branching. */
export function restructure(src: string, n: ANode, shape: 'flat' | 'right' | 'left'): Edit {
  const kids = n.children;
  if (!kids.length) return { changes: [] };
  const spanOf = (c: AChild) => (c.kind === 'leaf' ? c.fullSpan : c.span);
  const plainLabel = n.label;
  // flatten: intermediate nodes that repeat the mother's label (or have none) and carry nothing else
  const isIntermediate = (c: AChild): c is ANode =>
    c.kind === 'node' && (c.label === plainLabel || c.label === '') && !c.id && !c.features && !c.sem && !c.triangle && !c.color && !c.branchColor && c.children.length > 0;
  const items: string[] = [];
  const collect = (list: AChild[]) => {
    for (const c of list) {
      if (isIntermediate(c)) collect(c.children);
      else {
        const sp = spanOf(c);
        items.push(src.slice(sp.from, sp.to));
      }
    }
  };
  collect(kids);
  const lab = plainLabel || '';
  const wrap = (inner: string) => `[${lab} ${inner}]`;
  const right = (xs: string[]): string => (xs.length <= 2 ? xs.join(' ') : `${xs[0]} ${wrap(right(xs.slice(1)))}`);
  const left = (xs: string[]): string => (xs.length <= 2 ? xs.join(' ') : `${wrap(left(xs.slice(0, -1)))} ${xs[xs.length - 1]}`);
  const body = shape === 'flat' ? items.join(' ') : shape === 'right' ? right(items) : left(items);
  const from = spanOf(kids[0]).from;
  const to = spanOf(kids[kids.length - 1]).to;
  return { changes: [{ from, to, insert: body }] };
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


/** Draw a constituent as a triangle (the structure stays in the code), or undo it. */
export function toggleTriangle(src: string, n: ANode): Edit {
  if (n.triangle && n.triangleSpan) {
    const s = n.triangleSpan;
    const to = src[s.to] === ' ' ? s.to + 1 : s.to;
    return { changes: [{ from: s.from, to, insert: '' }] };
  }
  const at = n.featureSpan && n.featureSpan.from === n.headerSpan.to ? n.featureSpan.to : n.headerSpan.to;
  const next = src[at];
  const emptyHeader = n.headerSpan.from === n.headerSpan.to && at === n.headerSpan.to;
  const ins = emptyHeader ? (next === ' ' ? '^' : '^ ') : next === ' ' ? ' ^' : ' ^ ';
  return { changes: [{ from: at, to: at, insert: ins }] };
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
  const end = (id: string, occ?: number) => `#${id}${occ ? '/' + occ : ''}`;
  const parts = [`${end(a.from, a.fromOcc)} ${op} ${end(a.to, a.toOcc)}`];
  if (a.hidden) parts.push('hide');
  if (a.line !== 'solid') parts.push(a.line);
  if (a.route !== 'under') parts.push(a.route);
  if (a.color) parts.push('@' + a.color);
  if (a.label) parts.push(`"${a.label.replace(/(["\\])/g, '\\$1')}"`);
  if (a.bend && (Math.round(a.bend[0]) !== 0 || Math.round(a.bend[1]) !== 0)) parts.push(`bend=${Math.round(a.bend[0])},${Math.round(a.bend[1])}`);
  return parts.join(' ');
}

export interface Endpoint {
  node: ANode;
  /** position in a chain (1 = highest) */
  occ?: number;
}

/** Add an arrow between two nodes (or chain positions), giving them ids where needed. */
export function addArrow(src: string, doc: ADoc, from: Endpoint, to: Endpoint, extra: Partial<AArrow> = {}): Edit {
  const reserved = new Set<string>();
  const a = ensureId(doc, from.node, reserved);
  const b = from.node === to.node ? a : ensureId(doc, to.node, reserved);
  const changes: TextChange[] = [];
  if (a.change) changes.push(a.change);
  if (b.change && b !== a) changes.push(b.change);
  const line = arrowLine({ from: a.id, to: b.id, fromOcc: from.occ, toOcc: to.occ, head: 'end', line: 'solid', route: 'under', ...extra });
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
