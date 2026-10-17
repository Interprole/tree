import { signal } from '@preact/signals';
import type { AArrow, ALeaf, ANode, ARef } from './core/ast';
import { parse, walkAst } from './core/parser';
import * as E from './core/edits';
import type { Edit } from './core/edits';
import { formatDoc, tidyEdit } from './core/format';
import { cubicAt, insertVia } from './core/arrows';
import type { ArrowGeom } from './core/arrows';
import type { DArrow, DNode } from './core/model';
import { t } from './i18n';
import { addTree, arrowSource, build, doc, editable, pick, requestLabelFocus, scene, selection, showToast, source, tool, tree } from './state';

/** Bridge to the code editor, so that canvas edits go through its undo history. */
export interface EditorBridge {
  apply(edit: Edit): void;
  undo(): void;
  redo(): void;
  select(from: number, to: number, focus?: boolean): void;
}

let bridge: EditorBridge | null = null;
export function setEditorBridge(b: EditorBridge | null) {
  bridge = b;
}

export function applyEdit(edit: Edit) {
  if (!edit.changes.length) return;
  if (bridge) bridge.apply(edit);
  else source.value = E.applyChanges(source.value, edit.changes);
}

export function undo() {
  bridge?.undo();
}
export function redo() {
  bridge?.redo();
}

export function revealInCode(from: number, to: number) {
  bridge?.select(from, to, false);
}

/* ------------------------------------------------------------ lookup */

export function nodeByKey(key: string | null | undefined): DNode | null {
  if (!key) return null;
  return tree.value?.nodes.find((n) => n.key === key) ?? null;
}

export function selectedNode(): DNode | null {
  const s = selection.value;
  return s?.kind === 'node' ? nodeByKey(s.key) : null;
}

/** The source node an operation should act on (terminals act on themselves where possible). */
export function srcOf(n: DNode | null): ANode | ALeaf | null {
  if (!n || !n.src) return null;
  return n.src;
}

/** nearest source node (for ids / arrows): a terminal or synthetic node maps to its mother */
export function srcNodeOf(n: DNode | null): ANode | null {
  let cur: DNode | undefined = n ?? undefined;
  while (cur) {
    if (cur.src?.kind === 'node') return cur.src;
    cur = cur.parents[0];
  }
  return null;
}

function parentSrc(n: DNode): ANode | null {
  const p = n.parents[0];
  return p ? srcNodeOf(p) : null;
}

function guard(n: DNode | null): n is DNode {
  if (!n) return false;
  if (!editable.value) {
    showToast(t('editDisabled'));
    return false;
  }
  if (!n.src) {
    showToast(t('syntheticNode'));
    return false;
  }
  return true;
}

/* ------------------------------------------------------------ node operations */

export function renameNode(n: DNode, text: string) {
  if (!guard(n)) return;
  const s = n.src!;
  applyEdit(s.kind === 'leaf' ? E.renameLeaf(s, text.trim() ? text : '∅') : E.renameNode(source.value, s, text));
}

/** Apply a structural edit and lay the code out around it (line breaks and indentation). */
function applyTidy(edit: Edit, anchor: number, up: number): Edit {
  const out = tidyEdit(source.value, edit, anchor, up);
  applyEdit(out);
  return out;
}

export function addChild(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  const e = E.addChild(n.src!);
  selectNewNode(applyTidy(e, e.select!.from, 1).select?.from);
}

export function addSister(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  const s = n.src!;
  if (s.kind === 'node' && s === doc.value?.root) {
    showToast('The root cannot have sisters — add a daughter or a mother instead.');
    return;
  }
  const e = E.addSister(s);
  selectNewNode(applyTidy(e, e.select!.from, 1).select?.from);
}

/** Put a new node above this one: X → [Y X]. */
export function addMother(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  const e = E.addMother(n.src!);
  selectNewNode(applyTidy(e, e.select!.from, 1).select?.from);
}

/** Lay out the whole code: line breaks and indentation. */
export function formatCode() {
  const src = source.value;
  const next = formatDoc(src);
  if (next !== src) applyEdit({ changes: [{ from: 0, to: src.length, insert: next }] });
}

/** after an insertion, select the node whose label starts at pos and let the user type its label */
function selectNewNode(pos: number | undefined, focus = true) {
  if (pos === undefined) return;
  queueMicrotask(() => {
    const n = tree.value?.nodes.find((x) => x.src?.kind === 'node' && x.src.labelSpan.from === pos);
    if (!n) return;
    selection.value = { kind: 'node', key: n.key };
    if (focus) requestLabelFocus(n.key);
  });
}

/* ------------------------------------------------------------ copy and paste */

/** A copied piece of a tree: its code, the ids defined in it and the arrows among them. */
export interface TreeClip {
  text: string;
  ids: string[];
  arrows: string[];
}

export const clip = signal<TreeClip | null>(null);

/** The text that goes to the system clipboard. */
export const clipText = (c: TreeClip) => [c.text, ...c.arrows].join('\n');

/** Copy a node with everything below it (the root: the whole tree with its arrows). */
export function copyNode(n: DNode | null = selectedNode()): TreeClip | null {
  if (!n?.src) {
    if (n) showToast(t('syntheticNode'));
    return null;
  }
  const s = n.src;
  const span = s.kind === 'leaf' ? s.fullSpan : s.span;
  const ids: string[] = [];
  if (s.kind === 'node') walkAst(s, (x) => void (x.id && ids.push(x.id)));
  const src = source.value;
  const arrows = (doc.value?.arrows ?? []).filter((a) => ids.includes(a.from) && ids.includes(a.to)).map((a) => src.slice(a.span.from, a.span.to));
  clip.value = { text: src.slice(span.from, span.to), ids, arrows };
  return clip.value;
}

/** What the system clipboard holds, as a piece of a tree (ours with its ids, or bracket code from elsewhere). */
export function clipFromText(text: string): TreeClip | null {
  const t = text.trim();
  if (clip.value && clipText(clip.value).trim() === t) return clip.value;
  if (!t) return null;
  if (t.startsWith('[')) {
    // a whole tree with its arrows, or a piece
    const r = parse(t);
    if (r.ok && r.doc.root) {
      const end = r.doc.root.span.to;
      return { text: t.slice(0, end), ids: [...r.doc.ids.keys()], arrows: r.doc.arrows.map((a) => t.slice(a.span.from, a.span.to)) };
    }
    return { text: t, ids: [], arrows: [] };
  }
  // plain words (one line): a terminal
  return /\n/.test(t) || t.length > 200 ? null : { text: E.escapeText(t), ids: [], arrows: [] };
}

/**
 * Paste a copy: as the last daughter or as the next sister of a node, or (no node) as a new tree
 * on the canvas. Ids defined in the piece get new names where they are taken, so the copy is a
 * constituent of its own, not one more position of the original.
 */
export function paste(c: TreeClip | null = clip.value, target: DNode | null = selectedNode(), mode: 'daughter' | 'sister' = 'daughter') {
  if (!c) {
    showToast('Nothing copied yet: select a node and press Ctrl+C.');
    return;
  }
  const d = doc.value;
  const used = new Set<string>(d ? [...d.ids.keys()] : []);
  const ren = new Map<string, string>();
  for (const id of c.ids) {
    if (!used.has(id)) continue;
    let k = 2;
    while (used.has(id + k)) k++;
    ren.set(id, id + k);
    used.add(id + k);
  }
  const rename = (x: string) => (ren.size ? x.replace(/(?<!\\)#([\p{L}\p{N}_\-.:]+)/gu, (m, id: string) => (ren.has(id) ? '#' + ren.get(id) : m)) : x);
  const text = rename(c.text);
  const arrows = c.arrows.map(rename);
  const s = target?.src;
  if (!d?.root || !target || (mode === 'sister' && s?.kind === 'node' && s === d.root)) {
    // a new tree on the canvas
    if (!text.startsWith('[')) {
      showToast('Select a node to paste words into it.');
      return;
    }
    addTree([text, ...arrows].join('\n'));
    return;
  }
  if (!guard(target)) return;
  const src = source.value;
  const changes: E.TextChange[] = [];
  let anchor: number;
  let up = text.startsWith('[') ? 1 : 0;
  let labelAt: number | undefined;
  if (mode === 'daughter' && s!.kind === 'leaf') {
    // a terminal gets a daughter: it becomes a node labelled with its text
    changes.push({ from: s!.span.from, to: s!.span.to, insert: `[${s!.text} ${text}]` });
    anchor = s!.span.from;
    up = 1;
    if (text.startsWith('[')) labelAt = s!.span.from + s!.text.length + 3;
  } else {
    const at = mode === 'daughter' ? (s as ANode).span.to - 1 : s!.kind === 'leaf' ? s!.fullSpan.to : s!.span.to;
    changes.push({ from: at, to: at, insert: ' ' + text });
    anchor = at + 1;
    if (text.startsWith('[')) labelAt = at + 2;
  }
  if (arrows.length) {
    const end = src.replace(/\s+$/, '').length;
    changes.push({ from: end, to: src.length, insert: '\n' + arrows.join('\n') + '\n' });
  }
  const edit: E.Edit = { changes, select: labelAt !== undefined ? { from: labelAt, to: labelAt } : undefined };
  const out = applyTidy(edit, anchor, up);
  selectNewNode(out.select?.from, false);
}

/** Copy and delete. */
export function cutNode(n: DNode | null = selectedNode()) {
  if (!copyNode(n)) return;
  deleteNode(n);
}

/** A copy right after the node. */
export function duplicateNode(n: DNode | null = selectedNode()) {
  const c = copyNode(n);
  // the root: a copy of the whole tree next to it on the canvas
  if (c) paste(c, n?.parents.length ? n : null, 'sister');
}

export function deleteNode(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  const d = doc.value!;
  // the parent becomes selected
  const parentKey = n.parents[0]?.key ?? null;
  const e = E.deleteElement(source.value, d, n.src!);
  if (e.changes.length && !(n.src!.kind === 'node' && n.src === d.root)) applyTidy(e, E.mapPos(e.changes[0].from, e.changes), 0);
  else applyEdit(e);
  selection.value = parentKey ? { kind: 'node', key: parentKey } : null;
}

export function toggleTriangle(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  let s = n.src!;
  if (s.kind === 'leaf') {
    const p = parentSrc(n);
    if (!p) return;
    s = p;
  }
  applyEdit(E.toggleTriangle(source.value, s));
}

/** the source node a canvas node stands for (terminals and synthetic nodes: their mother) */
function nodeSrc(n: DNode): ANode | null {
  return n.src?.kind === 'node' ? n.src : parentSrc(n);
}

export function setFeatures(n: DNode | null, text: string) {
  if (!guard(n)) return;
  const s = nodeSrc(n);
  if (s) applyEdit(E.setFeatures(s, text));
}

export function setMeaning(n: DNode | null, text: string) {
  if (!guard(n)) return;
  const s = nodeSrc(n);
  if (s) applyEdit(E.setMeaning(s, text));
}

/** Write a computed meaning into the code. */
export function keepComputedMeaning(n: DNode | null = selectedNode()) {
  if (!n?.sem?.computed || !n.sem.source) return;
  setMeaning(n, n.sem.source);
}

/** The source position (defining node or #ref) of one position of a chain. */
function chainPosition(n: DNode): { node: ANode } | { ref: ARef } | null {
  const id = n.chainRef?.id ?? n.id;
  if (!id) return null;
  let p: DNode | undefined = n.parents[0];
  while (p && !(p.src?.kind === 'node' && !p.synthetic)) p = p.parents[0];
  const mother = p?.src as ANode | undefined;
  if (!mother) return null;
  for (const c of mother.children) {
    if (c.kind === 'ref' && c.id === id) return { ref: c };
    if (c.kind === 'node' && c.id === id) return { node: c };
  }
  return null;
}

/** Pronounce or silence one position of a chain. */
export function togglePronounce(n: DNode | null = selectedNode()) {
  if (!n || !editable.value) return;
  const pos = chainPosition(n);
  if (!pos) {
    showToast('Select a position of a chain (a node with #id).');
    return;
  }
  const overt = !n.copy && !n.trace;
  applyEdit(E.setPronounce(pos, !overt));
}

/** The #ref of a lower position of a chain (null for the defining node or outside chains). */
export function chainRef(n: DNode | null): ARef | null {
  const pos = n && chainPosition(n);
  return pos && 'ref' in pos ? pos.ref : null;
}

/** Pronounce one position of a chain with other words (e.g. a pronoun copy), or with the same words again (null). */
export function setPronounceAs(n: DNode | null, text: string | null) {
  if (!n || !editable.value) return;
  const r = chainRef(n);
  if (!r) {
    showToast('Only a lower position of a chain (#id) can be pronounced with other words.');
    return;
  }
  applyEdit(E.setRefText(r, text));
}

/** Click-to-pick: add an existing constituent again as a daughter or sister (a new chain position). */
export function startPick(kind: 'daughter' | 'sister', n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  pick.value = { kind, key: n.key };
}

export function completePick(target: DNode) {
  const p = pick.value;
  pick.value = null;
  const place = nodeByKey(p?.key);
  if (!p || !place || !guard(place)) return;
  const t = target.chainRef ? doc.value?.ids.get(target.chainRef.id) : nodeSrc(target);
  if (!t) return;
  const placeSrc = p.kind === 'daughter' ? nodeSrc(place) : place.src!;
  if (!placeSrc) return;
  // a node cannot dominate itself
  const inside = (outer: ANode, inner: { span: { from: number; to: number } }) => inner.span.from >= outer.span.from && inner.span.to <= outer.span.to;
  const mother = p.kind === 'daughter' ? (placeSrc as ANode) : parentSrc(place);
  if (mother && inside(t, mother)) {
    showToast('A constituent cannot be re-merged inside itself.');
    return;
  }
  const e = E.addCopy(doc.value!, t, p.kind === 'daughter' ? { kind: 'daughter', of: placeSrc as ANode } : { kind: 'sister', of: placeSrc });
  applyTidy(e, E.mapPos(e.changes[0].from, e.changes) + 1, 0);
}

export function restructure(n: DNode | null, shape: 'right' | 'left') {
  if (!guard(n) || n.src!.kind !== 'node') return;
  const edit = E.restructure(source.value, n.src as ANode, shape);
  if (edit.error) {
    showToast(edit.error);
    return;
  }
  applyTidy(edit, (n.src as ANode).labelSpan.from, 0);
}

/** Edge colour / width / length, spread of daughters, meaning colour of a node. */
export function setOption(n: DNode | null, key: 'edge' | 'width' | 'len' | 'spread' | 'sem', value: string | null) {
  if (!guard(n)) return;
  const s = nodeSrc(n);
  if (s) applyEdit(E.setOption(s, key, value));
}

export function setNotes(n: DNode | null, notes: E.LabelSpec[]) {
  if (!guard(n)) return;
  const s = nodeSrc(n);
  if (s) applyEdit(E.setNotes(source.value, s, notes));
}

/** Drag a note or an arrow label to a new offset. */
export function moveLabel(kind: 'note' | 'arrow', owner: string | number, index: number, off: [number, number]) {
  if (!editable.value) return;
  if (kind === 'note') {
    const n = nodeByKey(owner as string);
    const s = n && nodeSrc(n);
    const note = s?.notes?.[index];
    if (note) applyEdit(E.setNoteOffset(note, off));
    return;
  }
  const a = tree.value?.arrows[owner as number];
  if (!a?.src) return;
  const labels = a.src.labels.map((l, i) => (i === index ? { ...l, off } : l));
  applyEdit(E.updateArrow(a.src, { labels }));
}

/** Rename (text) or delete (null) one note of a node or one label of an arrow. */
export function editLabel(kind: 'note' | 'arrow', owner: string | number, index: number, text: string | null) {
  if (!editable.value) return;
  const apply = <T extends { text: string }>(list: T[]) =>
    list.flatMap((l, i) => (i !== index ? [l] : text === null || !text.trim() ? [] : [{ ...l, text }]));
  if (kind === 'note') {
    const n = nodeByKey(owner as string);
    const s = n && nodeSrc(n);
    if (s?.notes) applyEdit(E.setNotes(source.value, s, apply(s.notes)));
    return;
  }
  const a = tree.value?.arrows[owner as number];
  if (a?.src) applyEdit(E.updateArrow(a.src, { labels: apply(a.src.labels) }));
}

/** The source text of a note or an arrow label. */
export function labelText(kind: 'note' | 'arrow', owner: string | number, index: number): string | undefined {
  if (kind === 'note') {
    const n = nodeByKey(owner as string);
    return (n && nodeSrc(n))?.notes?.[index]?.text;
  }
  return tree.value?.arrows[owner as number]?.src?.labels[index]?.text;
}

export function reverseArrow(a: DArrow | null = selectedArrow()) {
  if (!a) return;
  if (a.auto || !a.src) {
    // an automatic chain arrow becomes an explicit one, pointing the other way
    if (a.chain) {
      const def = doc.value?.ids.get(a.chain.id);
      if (def) applyEdit(E.addArrow(source.value, doc.value!, { node: def, occ: a.chain.to }, { node: def, occ: a.chain.from }));
    }
    return;
  }
  applyEdit(E.reverseArrow(a.src));
}

export function setColor(n: DNode | null, color: string | null, branch: boolean) {
  if (!guard(n)) return;
  const s = n.src!.kind === 'node' ? (n.src as ANode) : parentSrc(n);
  if (!s) return;
  if (color === null) {
    // clearing removes both node and branch colour
    applyEdit({ changes: [{ from: s.labelSpan.to, to: s.headerSpan.to, insert: E.modifiers({ id: s.id, pronounce: s.pronounce, opts: s.opts }) }] });
    return;
  }
  applyEdit(E.setColor(s, color, branch));
}

/* ------------------------------------------------------------ arrows */

export function startArrow(n: DNode | null = selectedNode()) {
  if (!n) return;
  tool.value = 'arrow';
  arrowSource.value = n.key;
}

/** Arrow endpoint for a canvas node: a node, or one position of a chain (#id/n). */
function endpointOf(n: DNode | null): E.Endpoint | null {
  let cur: DNode | undefined = n ?? undefined;
  while (cur && !(cur.src?.kind === 'node' && !cur.synthetic) && !cur.chainRef) cur = cur.parents[0];
  if (!cur) return null;
  if (cur.chainRef) {
    const def = doc.value?.ids.get(cur.chainRef.id);
    return def ? { node: def, occ: cur.chainRef.occ } : null;
  }
  return { node: cur.src as ANode };
}

export function arrowClick(n: DNode) {
  if (!editable.value) {
    showToast(t('editDisabled'));
    return;
  }
  if (!arrowSource.value) {
    arrowSource.value = n.key;
    return;
  }
  const from = endpointOf(nodeByKey(arrowSource.value));
  const to = endpointOf(n);
  arrowSource.value = null;
  tool.value = 'select';
  if (!from || !to) return;
  applyEdit(E.addArrow(source.value, doc.value!, from, to));
  queueMicrotask(() => {
    const arrows = tree.value?.arrows ?? [];
    const i = arrows.findIndex((a) => a.src && a.index === (doc.value?.arrows.length ?? 0) - 1);
    if (i >= 0) selection.value = { kind: 'arrow', index: i };
  });
}

export function selectedArrow(): DArrow | null {
  const s = selection.value;
  if (s?.kind !== 'arrow') return null;
  return tree.value?.arrows[s.index] ?? null;
}

/** Turn an automatic arrow into an explicit line (so that it can be restyled or hidden). */
function materialise(a: DArrow, patch: Partial<AArrow>): boolean {
  if (!doc.value) return false;
  let from: E.Endpoint | null;
  let to: E.Endpoint | null;
  if (a.chain) {
    const def = doc.value.ids.get(a.chain.id);
    if (!def) return false;
    from = { node: def, occ: a.chain.from };
    to = { node: def, occ: a.chain.to };
  } else {
    from = endpointOf(a.from);
    to = endpointOf(a.to);
  }
  if (!from || !to) return false;
  applyEdit(E.addArrow(source.value, doc.value, from, to, { route: a.route, line: a.line, head: a.head, fromAt: a.fromAt, toAt: a.toAt, ...patch }));
  return true;
}

export function updateArrow(a: DArrow, patch: Partial<AArrow>) {
  if (!editable.value) {
    showToast(t('editDisabled'));
    return;
  }
  if (a.auto || !a.src) {
    materialise(a, patch);
    return;
  }
  applyEdit(E.updateArrow(a.src, patch));
}

/** An explicit line that restyles a link of a chain: without it the automatic arrow would come back. */
function isChainLink(a: AArrow): boolean {
  const b = build.value;
  return a.from === a.to && !!a.fromOcc && !!a.toOcc && Math.abs(a.fromOcc - a.toOcc) === 1 && b.chains !== 'multidominance' && b.chainArrows;
}

/** Delete an arrow; an arrow between two positions of a chain is hidden with a "hide" line. */
export function deleteArrow(a: DArrow | null = selectedArrow()) {
  if (!a) return;
  if (a.auto || !a.src) materialise(a, { hidden: true });
  else if (isChainLink(a.src)) {
    const { from, to, fromOcc, toOcc } = a.src;
    applyEdit({ changes: [{ from: a.src.span.from, to: a.src.span.to, insert: E.arrowLine({ from, to, fromOcc, toOcc, hidden: true, head: 'end', line: 'solid', route: 'under', labels: [] }) }] });
  } else applyEdit(E.deleteArrow(source.value, a.src));
  selection.value = null;
}

/** Geometry of an arrow as drawn (picture coordinates). */
export function arrowGeom(index: number): ArrowGeom | null {
  return scene.value?.arrows[index]?.geom ?? null;
}

/** One more bend point: the handle of an arrow without any, or a point in the middle of the arrow. */
export function addViaAtMiddle(g: ArrowGeom): [number, number][] {
  if (!g.arrow.via?.length) return [[Math.round(g.handle[0] - g.mid[0]), Math.round(g.handle[1] - g.mid[1])]];
  return insertVia(g, cubicAt(g, 0.5));
}

/** Explicit arrow lines that start or end at a node (by its #id): e.g. its head movement, drawn or not. */
export function arrowLinesOf(n: DNode | null): AArrow[] {
  const s = n && srcNodeOf(n);
  const id = n?.chainRef?.id ?? s?.id;
  if (!id) return [];
  return (doc.value?.arrows ?? []).filter((a) => a.from === id || a.to === id);
}

/** Show or hide an arrow line; a hidden arrow between heads keeps its head movement. */
export function setArrowLineHidden(a: AArrow, hidden: boolean) {
  if (!editable.value) {
    showToast(t('editDisabled'));
    return;
  }
  applyEdit(E.updateArrow(a, { hidden: hidden || undefined }));
}

export function deleteArrowLine(a: AArrow) {
  if (!editable.value) return;
  applyEdit(E.deleteArrow(source.value, a));
}

/** Set the bend points of an arrow (relative to the middle of its ends); [] = automatic shape. */
export function setVia(a: DArrow, via: [number, number][]) {
  updateArrow(a, { via: via.length ? via.map(([x, y]) => [Math.round(x), Math.round(y)]) : undefined, bend: undefined });
}
