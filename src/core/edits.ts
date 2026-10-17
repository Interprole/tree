import type { AArrow, AChild, ADoc, ALabel, ALeaf, ANode, APosStyle, ARef, LabelSide, PosMods } from './ast';
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
  /** the operation does not apply here */
  error?: string;
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

type Mods = Pick<ANode, 'id' | 'color' | 'branchColor' | 'pronounce' | 'opts'>;

const OPT_ORDER = ['to', 'edge', 'width', 'len', 'spread', 'sem', 'link'];

export function modifiers(n: Mods): string {
  const voice = n.id && n.pronounce !== undefined ? (n.pronounce ? '!' : '?') : '';
  const opts = Object.entries(n.opts ?? {})
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => OPT_ORDER.indexOf(a) - OPT_ORDER.indexOf(b))
    .map(([k, v]) => `;${k}=${v}`)
    .join('');
  return (n.id ? '#' + n.id : '') + voice + (n.color ? '@' + n.color : '') + (n.branchColor ? '@@' + n.branchColor : '') + opts;
}

function setModifiers(n: ANode, patch: Partial<Mods>): TextChange {
  const next = { id: n.id, color: n.color, branchColor: n.branchColor, pronounce: n.pronounce, opts: n.opts, ...patch };
  const ins = modifiers(next);
  // a node without a header token: the header starts right after "["; an empty label followed
  // directly by a child needs a separating space
  const needsSpace = n.labelSpan.to === n.headerSpan.to && n.headerSpan.from === n.headerSpan.to && ins !== '';
  return { from: n.labelSpan.to, to: n.headerSpan.to, insert: ins + (needsSpace ? ' ' : '') };
}

/** Set (or remove, with null) a node option: edge colour, edge width, length, spread, meaning colour. */
export function setOption(n: ANode, key: 'edge' | 'width' | 'len' | 'spread' | 'sem' | 'link' | 'to', value: string | null): Edit {
  const opts = { ...(n.opts ?? {}) };
  if (value === null || value === '') delete opts[key];
  else opts[key] = value;
  return { changes: [setModifiers(n, { opts })] };
}

/** A label of an arrow or a note: side"text"@dx,dy */
export function labelToken(l: { text: string; side?: string; off?: [number, number] }): string {
  const side = l.side && l.side !== 'auto' ? l.side : '';
  const off = l.off && (Math.round(l.off[0]) || Math.round(l.off[1])) ? `@${Math.round(l.off[0])},${Math.round(l.off[1])}` : '';
  return `${side}"${l.text.replace(/(["\\])/g, '\\$1')}"${off}`;
}

export interface LabelSpec {
  text: string;
  side: LabelSide;
  off?: [number, number];
}

/** Replace all notes of a node. */
export function setNotes(src: string, n: ANode, notes: LabelSpec[]): Edit {
  const changes: TextChange[] = (n.notes ?? []).map((x) => removeRange(src, x.span.from, x.span.to));
  const ins = notes.filter((x) => x.text.trim()).map((x) => ' &' + labelToken(x)).join('');
  const at = n.span.to - 1;
  if (ins) changes.push({ from: at, to: at, insert: ins });
  return { changes };
}

/** Move one note (drag on the canvas). */
export function setNoteOffset(note: ALabel, off: [number, number]): Edit {
  return { changes: [{ from: note.span.from, to: note.span.to, insert: '&' + labelToken({ ...note, off }) }] };
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
  return { changes: [{ from: r.span.from, to: r.span.to, insert: refToken({ ...r, pronounce: value }) }] };
}

/**
 * Change the branching of a node: flat, right-branching or left-branching. With three or more
 * daughters it re-brackets them; with two it rotates ([X [Y a b] c] ↔ [X a [Y b c]]).
 */
/**
 * Change the branching direction of a node with two daughters by swapping them:
 * right → left: [XP X [Z]] → [XP [Z] X];  left → right: [XP [Z] X] → [XP X [Z]].
 * The daughter with more structure decides the current direction; equal daughters are just swapped.
 */
export function restructure(src: string, n: ANode, shape: 'right' | 'left'): Edit {
  const kids = n.children;
  if (kids.length !== 2) return { changes: [], error: `Changing the branching needs exactly two daughters; [${n.label || '…'}] has ${kids.length}.` };
  const span = (c: AChild) => (c.kind === 'leaf' ? c.fullSpan : c.span);
  const weight = (c: AChild): number => (c.kind === 'node' ? 1 + c.children.reduce((s, k) => s + weight(k), 0) : 1);
  const [a, b] = kids;
  const wa = weight(a);
  const wb = weight(b);
  if (shape === 'left' && wa > wb) return { changes: [], error: 'Already left-branching: the bigger daughter is on the left.' };
  if (shape === 'right' && wb > wa) return { changes: [], error: 'Already right-branching: the bigger daughter is on the right.' };
  const sa = span(a);
  const sb = span(b);
  return {
    changes: [
      { from: sa.from, to: sa.to, insert: src.slice(sb.from, sb.to) },
      { from: sb.from, to: sb.to, insert: src.slice(sa.from, sa.to) },
    ],
  };
}

/** Give a node (or a terminal) a new mother: X → [Y X]. */
export function addMother(n: ANode | ALeaf, label = 'X'): Edit {
  const span = n.kind === 'leaf' ? n.fullSpan : n.span;
  return {
    changes: [
      { from: span.from, to: span.from, insert: `[${label} ` },
      { from: span.to, to: span.to, insert: ']' },
    ],
    select: { from: span.from + 1, to: span.from + 1 + label.length },
  };
}

/** The code of one position of a chain: #id, then ! / ?, ^, @colour, "words", $meaning$. */
export function refToken(r: Pick<ARef, 'id' | 'pronounce' | 'text' | 'sem' | 'triangle' | 'color'>): string {
  const flag = r.pronounce === undefined ? '' : r.pronounce ? '!' : '?';
  return `#${r.id}${flag}${r.triangle ? '^' : ''}${r.color ? '@' + r.color : ''}${r.text !== undefined ? `"${r.text}"` : ''}${r.sem !== undefined ? `$${r.sem}$` : ''}`;
}

/** Style one position of a chain only (e.g. a silent copy as a triangle, or in a colour). */
export function setRefStyle(r: ARef, patch: { triangle?: boolean; color?: string | null }): Edit {
  const next = { ...r, ...('triangle' in patch ? { triangle: patch.triangle || undefined } : {}), ...('color' in patch ? { color: patch.color ?? undefined } : {}) };
  return { changes: [{ from: r.span.from, to: r.span.to, insert: refToken(next) }] };
}

/** Words a position of a chain is pronounced with (#id"zij | she"); null = the same words. */
export function setRefText(r: ARef, text: string | null): Edit {
  const t = text?.trim().replace(/"/g, "''") || '';
  // other words make the position pronounced; "?" (silent) would contradict them
  const pronounce = t && r.pronounce === false ? undefined : r.pronounce;
  return { changes: [{ from: r.span.from, to: r.span.to, insert: refToken({ ...r, pronounce, text: t || undefined }) }] };
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
      for (const p of doc.posStyles) if (ids.has(p.id)) changes.push(removeRange(src, p.span.from, p.span.to));
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
  if (a.visible) parts.push('visible');
  if (a.plain) parts.push('plain');
  if (a.fromAt === 'node') parts.push('from=node');
  if (a.toAt === 'node') parts.push('to=node');
  if (a.line !== 'solid') parts.push(a.line);
  if (a.route !== 'under') parts.push(a.route);
  if (a.color) parts.push('@' + a.color);
  for (const l of a.labels ?? []) parts.push(labelToken(l));
  if (a.bend && (Math.round(a.bend[0]) !== 0 || Math.round(a.bend[1]) !== 0)) parts.push(`bend=${Math.round(a.bend[0])},${Math.round(a.bend[1])}`);
  if (a.via?.length) parts.push('via=' + a.via.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(';'));
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
  const line = arrowLine({ from: a.id, to: b.id, fromOcc: from.occ, toOcc: to.occ, head: 'end', line: 'solid', route: 'under', labels: [], ...extra });
  const trimmedEnd = src.replace(/\s+$/, '').length;
  changes.push({ from: trimmedEnd, to: src.length, insert: '\n' + line + '\n' });
  return { changes };
}

/** Point the arrow the other way. */
export function reverseArrow(a: AArrow): Edit {
  return updateArrow(a, { from: a.to, to: a.from, fromOcc: a.toOcc, toOcc: a.fromOcc });
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

/** The line of a position style: #wh/2: ^ @red edge=blue {uφ} &"focus" $x : e$ */
export function posStyleLine(id: string, occ: number, m: PosMods): string | null {
  const parts: string[] = [];
  if (m.pronounce !== undefined) parts.push(m.pronounce ? '!' : '?');
  if (m.triangle) parts.push('^');
  else if (m.triangle === false) parts.push('open');
  if (m.color) parts.push('@' + m.color);
  if (m.edge) parts.push('edge=' + m.edge);
  if (m.width) parts.push('width=' + m.width);
  if (m.len) parts.push('len=' + m.len);
  if (m.features?.length) parts.push(`{${m.features.join(', ')}}`);
  for (const n of m.notes ?? []) if (n.text.trim()) parts.push('&' + labelToken(n));
  if (m.text !== undefined) parts.push(`"${m.text.replace(/"/g, "''")}"`);
  if (m.sem !== undefined && m.sem.trim()) parts.push(`$${m.sem.trim().replace(/\$/g, '\\$')}$`);
  return parts.length ? `#${id}/${occ}: ${parts.join(' ')}` : null;
}

/** Change what one position of a chain has on its own (undefined in the patch: back to the shared value). */
export function setPosStyle(src: string, doc: ADoc, id: string, occ: number, patch: Partial<PosMods>): Edit {
  const cur: APosStyle | undefined = doc.posStyles.find((p) => p.id === id && p.occ === occ);
  const next: PosMods = { ...(cur?.mods ?? {}) };
  for (const [k, v] of Object.entries(patch) as [keyof PosMods, unknown][]) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  const line = posStyleLine(id, occ, next);
  if (cur) {
    if (line) return { changes: [{ from: cur.span.from, to: cur.span.to, insert: line }] };
    let to = cur.span.to;
    while (to < src.length && src[to] !== '\n') to++;
    return { changes: [removeRange(src, cur.span.from, to)] };
  }
  if (!line) return { changes: [] };
  const end = src.replace(/\s+$/, '').length;
  return { changes: [{ from: end, to: src.length, insert: '\n' + line + '\n' }] };
}

/** Move a piece of the code (a node, a word, a #ref) to another place: remove it, insert it at `at`. */
export function moveElement(src: string, span: { from: number; to: number }, at: number): Edit {
  const text = src.slice(span.from, span.to);
  return { changes: [removeRange(src, span.from, span.to), { from: at, to: at, insert: ' ' + text }] };
}

/**
 * New names for ids in a piece of code: every #id (definitions, references, arrow ends) and every
 * head movement written as ;to=id.
 */
export function renameIds(text: string, map: Map<string, string>): string {
  if (!map.size) return text;
  return text.replace(/(?<!\\)(#|;to=)([\p{L}\p{N}_\-.:]+)/gu, (m, pre: string, id: string) => (map.has(id) ? pre + map.get(id) : m));
}
