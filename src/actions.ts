import { signal } from '@preact/signals';
import type { AArrow, ALeaf, ANode } from './core/ast';
import * as E from './core/edits';
import type { Edit } from './core/edits';
import type { DArrow, DNode } from './core/model';
import { t } from './i18n';
import { arrowSource, doc, editable, selection, showToast, source, tool, tree } from './state';

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
  if (s.kind === 'leaf') return addSister(n);
  applyEdit(E.addChild(s));
  selectNewNode(s.span.to - 1 + 2);
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
  applyEdit(E.toggleTriangle(source.value, doc.value!, s));
}

export function setColor(n: DNode | null, color: string | null, branch: boolean) {
  if (!guard(n)) return;
  const s = n.src!.kind === 'node' ? (n.src as ANode) : parentSrc(n);
  if (!s) return;
  if (color === null) {
    // clearing removes both node and branch colour
    applyEdit({ changes: [{ from: s.labelSpan.to, to: s.headerSpan.to, insert: E.modifiers({ id: s.id, head: s.head }) }] });
    return;
  }
  applyEdit(E.setColor(s, color, branch));
}

export function toggleHead(n: DNode | null = selectedNode()) {
  if (!guard(n)) return;
  if (n.src!.kind !== 'node') return;
  applyEdit(E.setHead(n.src as ANode, parentSrc(n), !(n.src as ANode).head));
}

/* ------------------------------------------------------------ arrows */

export function startArrow(n: DNode | null = selectedNode()) {
  if (!n) return;
  tool.value = 'arrow';
  arrowSource.value = n.key;
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
  const from = srcNodeOf(nodeByKey(arrowSource.value));
  const to = srcNodeOf(n);
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

/** Turn an automatic arrow into an explicit one (ids + arrow line). */
function materialise(a: DArrow, patch: Partial<AArrow>): boolean {
  const from = srcNodeOf(a.from);
  const to = srcNodeOf(a.to);
  if (!from || !to || !doc.value) return false;
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

export function deleteArrow(a: DArrow | null = selectedArrow()) {
  if (!a) return;
  if (a.auto || !a.src) {
    showToast(t('autoArrow'));
    return;
  }
  applyEdit(E.deleteArrow(source.value, a.src));
  selection.value = null;
}
