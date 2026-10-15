import { signal } from '@preact/signals';
import type { AArrow, ALeaf, ANode, ARef } from './core/ast';
import * as E from './core/edits';
import type { Edit } from './core/edits';
import type { DArrow, DNode } from './core/model';
import { t } from './i18n';
import { arrowSource, doc, editable, pick, selection, showToast, source, tool, tree } from './state';

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
  applyEdit(s.kind === 'leaf' ? E.renameLeaf(s, text) : E.renameNode(source.value, s, text));
}

export function addChild(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  const s = n.src!;
  applyEdit(E.addChild(s));
  selectNewNode(s.kind === 'leaf' ? s.span.from + s.text.length + 3 : s.span.to - 1 + 2);
}

export function addSister(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  const s = n.src!;
  if (s.kind === 'node' && s === doc.value?.root) {
    showToast('The root cannot have sisters — add a daughter instead.');
    return;
  }
  const at = s.kind === 'leaf' ? s.fullSpan.to : s.span.to;
  applyEdit(E.addSister(s));
  selectNewNode(at + 2);
}

/** after an insertion, select the node whose label starts at pos */
function selectNewNode(pos: number) {
  queueMicrotask(() => {
    const n = tree.value?.nodes.find((x) => x.src?.kind === 'node' && x.src.labelSpan.from === pos);
    if (n) selection.value = { kind: 'node', key: n.key };
    pendingRename.value = n?.key ?? null;
  });
}

/** a freshly added node that should open the rename box */
export const pendingRename = signal<string | null>(null);

export function deleteNode(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  const d = doc.value!;
  // the parent becomes selected
  const parentKey = n.parents[0]?.key ?? null;
  applyEdit(E.deleteElement(source.value, d, n.src!));
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
  applyEdit(E.addCopy(doc.value!, t, p.kind === 'daughter' ? { kind: 'daughter', of: placeSrc as ANode } : { kind: 'sister', of: placeSrc }));
}

export function restructure(n: DNode | null, shape: 'right' | 'left') {
  if (!guard(n) || n.src!.kind !== 'node') return;
  const edit = E.restructure(source.value, n.src as ANode, shape);
  if (edit.error) {
    showToast(edit.error);
    return;
  }
  applyEdit(edit);
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
  applyEdit(E.addArrow(source.value, doc.value, from, to, { route: a.route, line: a.line, head: a.head, ...patch }));
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

/** Delete an arrow; an automatic chain arrow is hidden with a "hide" line. */
export function deleteArrow(a: DArrow | null = selectedArrow()) {
  if (!a) return;
  if (a.auto || !a.src) materialise(a, { hidden: true });
  else applyEdit(E.deleteArrow(source.value, a.src));
  selection.value = null;
}
