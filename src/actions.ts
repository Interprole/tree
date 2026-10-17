import { signal } from '@preact/signals';
import type { AArrow, ALabel, ALeaf, ANode, ARef, PosMods } from './core/ast';
import { POS_NOTE } from './core/build';
import { parse, walkAst } from './core/parser';
import * as E from './core/edits';
import type { Edit } from './core/edits';
import { diffChange, formatDoc, tidyEdit } from './core/format';
import { standalonePiece, withoutBranch } from './core/standalone';
import { askOverride } from './ask';
import { cubicAt, insertVia } from './core/arrows';
import type { ArrowGeom } from './core/arrows';
import type { DArrow, DNode } from './core/model';
import { t } from './i18n';
import { activateTree, activeTree, addTree, arrowSource, otherScenes, build, doc, duplicateTree, editable, pick, requestLabelFocus, scene, selection, showToast, source, sources, tool, tree, trees } from './state';
import { stripLinks } from './core/links';

/** Bridge to the code editor, so that canvas edits go through its undo history. */
export interface EditorBridge {
  apply(edit: Edit): void;
  /** a change that is not an undo step of its own (it follows from another one: linked branches) */
  applySilent(changes: E.TextChange[]): void;
  undo(): void;
  redo(): void;
  select(from: number, to: number, focus?: boolean): void;
}

let bridge: EditorBridge | null = null;
export function setEditorBridge(b: EditorBridge | null) {
  bridge = b;
}
export const getEditorBridge = () => bridge;

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

/**
 * The expression (words, a morpheme) of a node: [NP student]. Changes its word, adds one, or
 * removes it (empty).
 */
export function setExpression(n: DNode | null, text: string) {
  if (!guard(n) || n.src!.kind !== 'node') return;
  const s = n.src as ANode;
  const leaf = s.children.find((c): c is ALeaf => c.kind === 'leaf');
  const t = text.trim();
  if (leaf) {
    applyEdit(t ? E.renameLeaf(leaf, t) : E.deleteElement(source.value, doc.value!, leaf));
    return;
  }
  if (!t) return;
  const at = s.featureSpan && s.featureSpan.from >= s.headerSpan.to ? s.featureSpan.to : s.headerSpan.to;
  applyEdit({ changes: [{ from: at, to: at, insert: ' ' + E.escapeText(t) }] });
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
  /** the same branch standing on its own (for another tree): copies of what is outside written out */
  standalone?: { text: string; ids: string[]; arrows: string[] };
}

export const clip = signal<TreeClip | null>(null);

/** The text that goes to the system clipboard. */
export const clipText = (c: TreeClip) => [c.text, ...c.arrows].join('\n');

/** Copy a node with everything below it (the root: the whole tree with its arrows). */
/** a link group name not used anywhere on the canvas */
function freshLink(): string {
  const all = [source.value, ...Object.values(sources.value)].join('\n');
  for (;;) {
    const g = Math.random().toString(36).slice(2, 6);
    if (!all.includes(`;link=${g}`)) return g;
  }
}

/**
 * Copy a node with everything below it (the root: the whole tree with its arrows). linked: the
 * copy will be a linked branch (the original becomes one too); otherwise a branch of its own.
 */
export function copyNode(n: DNode | null = selectedNode(), linked = false, keepLinks = false): TreeClip | null {
  if (!n?.src) {
    if (n) showToast(t('syntheticNode'));
    return null;
  }
  const s = n.src;
  if (linked && s.kind !== 'node') {
    showToast('A word cannot be a linked branch: select a node.');
    return null;
  }
  if (linked && s.kind === 'node' && !s.opts?.link) {
    // the original becomes a linked branch; the copy is taken from the code with its marker
    if (!guard(n)) return null;
    applyEdit(E.setOption(s, 'link', freshLink()));
    const again = tree.value?.nodes.find((x) => x.key === n.key) ?? null;
    return copyNode(again, true);
  }
  const span = s.kind === 'leaf' ? s.fullSpan : s.span;
  const ids: string[] = [];
  if (s.kind === 'node') walkAst(s, (x) => void (x.id && ids.push(x.id)));
  const src = source.value;
  // the arrows among its positions and the styles of single positions come along
  const arrows = [
    ...(doc.value?.arrows ?? []).filter((a) => ids.includes(a.from) && ids.includes(a.to)).map((a) => src.slice(a.span.from, a.span.to)),
    ...(doc.value?.posStyles ?? []).filter((p) => ids.includes(p.id)).map((p) => src.slice(p.span.from, p.span.to)),
  ];
  const text = src.slice(span.from, span.to);
  const keep = linked || keepLinks;
  const alone = doc.value && s.kind === 'node' ? standalonePiece(src, doc.value, span) : null;
  clip.value = {
    text: keep ? text : stripLinks(text),
    ids,
    arrows,
    standalone: alone ? { text: keep ? alone.text : stripLinks(alone.text), ids: alone.ids, arrows: alone.lines } : undefined,
  };
  return clip.value;
}

/** The branch is of its own again (its other copies stay linked among themselves). */
export function unlinkBranch(n: DNode | null = selectedNode()) {
  const s = n?.src;
  if (!n || s?.kind !== 'node' || !s.opts?.link || !guard(n)) return;
  applyEdit(E.setOption(s, 'link', null));
}

/** The linked branch a node is in (its root), if any. */
export function linkedBranchOf(n: DNode | null): { group: string; root: DNode } | null {
  let cur: DNode | undefined = n ?? undefined;
  while (cur) {
    const s = cur.src;
    if (s?.kind === 'node' && s.opts?.link && !cur.copyOf) return { group: s.opts.link, root: cur };
    cur = cur.parents[0];
  }
  return null;
}

/** A linked copy of a whole tree next to it on the canvas: its root becomes a linked branch. */
export function duplicateTreeLinked(id: string) {
  const e = trees.value.find((x) => x.id === id);
  if (!e) return;
  const text = e.id === activeTree.value.id ? source.value : sources.value[e.srcId] ?? '';
  const r = parse(text);
  if (!r.ok || !r.doc.root) {
    showToast('Fix the error in the code first.');
    return;
  }
  let g = r.doc.root.opts?.link;
  let next = text;
  if (!g) {
    g = freshLink();
    next = E.applyChanges(text, E.setOption(r.doc.root, 'link', g).changes);
    if (e.id === activeTree.value.id) applyEdit({ changes: [{ from: 0, to: text.length, insert: next }] });
    else sources.value = { ...sources.value, [e.srcId]: next };
  }
  duplicateTree(id, false, next);
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
      return { text: t.slice(0, end), ids: [...r.doc.ids.keys()], arrows: [...r.doc.arrows, ...r.doc.posStyles].map((a) => t.slice(a.span.from, a.span.to)) };
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
export function paste(c: TreeClip | null = clip.value, target: DNode | null = selectedNode(), mode: 'daughter' | 'sister' = 'daughter', at?: { x: number; y: number }) {
  if (!c) {
    showToast('Nothing copied yet: select a node and press Ctrl+C.');
    return;
  }
  const d = doc.value;
  const groups = [...c.text.matchAll(/;link=([^;\s[\]@#]+)/g)].map((m) => m[1]);
  if (groups.length) {
    // a linked branch cannot contain a copy of itself
    for (let cur: DNode | undefined = target ?? undefined; cur; cur = cur.parents[0]) {
      const g = cur.src?.kind === 'node' ? cur.src.opts?.link : undefined;
      if (g && groups.includes(g)) {
        showToast('A linked branch cannot be pasted inside a copy of itself.');
        return;
      }
    }
    // the branch as it is now (it may have changed since it was copied)
    const root = /^\[[^\s[\]]*;link=([^;\s[\]@#]+)/.exec(c.text)?.[1];
    if (root) {
      const now = currentBranch(root);
      if (now) c = { ...c, text: now };
    }
  }
  // copies of constituents this tree does not have: the branch as it stands on its own
  if (c.standalone) {
    const known = new Set([...c.ids, ...(d ? [...d.ids.keys()] : [])]);
    const pointed = [...c.text.matchAll(/(?<!\\)#([\p{L}\p{N}_\-.:]+)/gu)].map((m) => m[1]).filter((id) => !/^[0-9a-f]{3,6}$/i.test(id) || known.has(id));
    if (pointed.some((id) => !known.has(id))) c = { ...c, text: c.standalone.text, ids: c.standalone.ids, arrows: c.standalone.arrows };
  }
  const used = new Set<string>(d ? [...d.ids.keys()] : []);
  const ren = new Map<string, string>();
  for (const id of c.ids) {
    if (!used.has(id)) continue;
    let k = 2;
    while (used.has(id + k)) k++;
    ren.set(id, id + k);
    used.add(id + k);
  }
  const rename = (x: string) => E.renameIds(x, ren);
  const text = rename(c.text);
  const arrows = c.arrows.map(rename);
  const s = target?.src;
  if (!d?.root || !target || (mode === 'sister' && s?.kind === 'node' && s === d.root)) {
    // a new tree on the canvas
    if (!text.startsWith('[')) {
      showToast('Select a node to paste words into it.');
      return;
    }
    // the tree being edited has no nodes: the branch becomes this tree
    if (!d?.root && !at && editable.value) {
      const src = source.value;
      applyEdit({ changes: [{ from: 0, to: src.length, insert: [text, ...arrows, src.trim()].filter(Boolean).join('\n') }] });
      return;
    }
    addTree([text, ...arrows].join('\n'), at);
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

/** The code of a linked branch as it is now, from any tree of the canvas. */
function currentBranch(group: string): string | null {
  for (const text of [source.value, ...Object.values(sources.value)]) {
    const r = parse(text);
    if (!r.ok || !r.doc.root) continue;
    let found: string | null = null;
    walkAst(r.doc.root, (x) => {
      if (!found && x.opts?.link === group) found = text.slice(x.span.from, x.span.to);
    });
    if (found) return found;
  }
  return null;
}

/**
 * Move a branch by its root (drag and drop): as the last daughter of a node or as its next sister;
 * copy: a copy of its own goes there instead.
 */
export function moveNode(n: DNode, target: DNode, mode: 'daughter' | 'sister', copy = false) {
  if (!editable.value) {
    showToast(t('editDisabled'));
    return;
  }
  if (copy) {
    const c = copyNode(n);
    if (c) paste(c, target, mode);
    return;
  }
  const d = doc.value;
  // a lower position of a chain moves as its #ref
  const ref = positionRef(n);
  const s = n.src;
  const span = ref ? ref.span : s?.kind === 'leaf' ? s.fullSpan : s?.kind === 'node' ? s.span : null;
  if (!d || !span || !target.src || (!ref && s === d.root)) {
    showToast(!span ? t('syntheticNode') : 'The root stays where it is: move a branch below it.');
    return;
  }
  const ts = target.src.kind === 'leaf' || mode === 'sister' ? target.src : (target.src as ANode);
  const tSpan = ts.kind === 'leaf' ? ts.fullSpan : ts.span;
  if (tSpan.from >= span.from && tSpan.to <= span.to) {
    showToast('A branch cannot go inside itself.');
    return;
  }
  if (mode === 'sister' && ts.kind === 'node' && ts === d.root) {
    showToast('The root cannot have sisters.');
    return;
  }
  const at = mode === 'daughter' && ts.kind === 'node' ? tSpan.to - 1 : tSpan.to;
  const src = source.value;
  const edit = E.moveElement(src, span, at);
  const isNode = src[span.from] === '[';
  // positions in the text after the move: the piece starts after the inserted space
  const anchor = E.mapPos(at, [edit.changes[0]]) + 1;
  if (isNode) edit.select = { from: anchor + 1, to: anchor + 1 };
  const out = applyTidy(edit, anchor, isNode ? 1 : 0);
  selectNewNode(out.select?.from, false);
}

/**
 * Move (or copy) a branch into another tree of the canvas: into an empty tree as its tree, or as
 * the last daughter / the next sister of one of its nodes (targetKey, a node of that tree).
 */
export function moveToTree(n: DNode, treeId: string, targetKey: string | null, mode: 'daughter' | 'sister', copy = false) {
  if (!editable.value) {
    showToast(t('editDisabled'));
    return;
  }
  const entry = trees.value.find((e) => e.id === treeId);
  if (!entry || entry.id === activeTree.value.id) return;
  const prevClip = clip.value;
  const c0 = copyNode(n, false, !copy);
  clip.value = prevClip;
  if (!c0) return;
  // in another tree the branch stands on its own
  const c = c0.standalone ? { ...c0, text: c0.standalone.text, ids: c0.standalone.ids, arrows: c0.standalone.arrows } : c0;
  const text = sources.value[entry.srcId] ?? '';
  const r = parse(text);
  if (!r.ok) {
    showToast(`Fix the code of ${entry.name} first.`);
    return;
  }
  // ids taken in the other tree get new names
  const used = new Set(r.doc.ids.keys());
  const ren = new Map<string, string>();
  for (const id of c.ids) {
    if (!used.has(id)) continue;
    let k = 2;
    while (used.has(id + k)) k++;
    ren.set(id, id + k);
    used.add(id + k);
  }
  const rename = (x: string) => E.renameIds(x, ren);
  const piece = rename(c.text);
  const lines = c.arrows.map(rename);
  let next: string;
  const target = targetKey ? otherTargetSrc(treeId, targetKey) : null;
  if (!r.doc.root || !target) {
    if (r.doc.root) {
      showToast(`Drop it on a node of ${entry.name}: as its daughter, or with Shift as its sister.`);
      return;
    }
    next = [piece, ...lines, text.trim()].filter(Boolean).join('\n');
  } else {
    const ts = mode === 'sister' || target.kind === 'leaf' ? target : target;
    if (mode === 'sister' && ts.kind === 'node' && ts === r.doc.root) {
      showToast('The root cannot have sisters.');
      return;
    }
    const tSpan = ts.kind === 'leaf' ? ts.fullSpan : ts.span;
    const at = mode === 'daughter' && ts.kind === 'node' ? tSpan.to - 1 : tSpan.to;
    const changes: E.TextChange[] = [{ from: at, to: at, insert: ' ' + piece }];
    if (lines.length) {
      const end = text.replace(/\s+$/, '').length;
      changes.push({ from: end, to: text.length, insert: '\n' + lines.join('\n') + '\n' });
    }
    const out = tidyEdit(text, { changes }, at + 1, piece.startsWith('[') ? 1 : 0);
    next = E.applyChanges(text, out.changes);
  }
  sources.value = { ...sources.value, [entry.srcId]: next };
  if (copy) return;
  // what stays behind: a silent copy of what left becomes it; arrows to what left go
  const ref = positionRef(n);
  const d = doc.value!;
  const src = source.value;
  const s = n.src!;
  const after = ref ? E.applyChanges(src, [{ from: ref.span.from, to: ref.span.to, insert: '' }]) : withoutBranch(src, d, s.kind === 'leaf' ? s.fullSpan : s.span);
  const ch = diffChange(src, after);
  if (ch) applyEdit({ changes: [ch] });
  selection.value = null;
}

/** the source element of a node of another tree (positions in that tree's code) */
function otherTargetSrc(treeId: string, key: string): ANode | ALeaf | null {
  const o = otherScenes.value.find((x) => x.entry.id === treeId);
  const h = o?.scene?.hits.find((x) => x.key === key);
  return h?.node.src ?? null;
}

/** Paste the copied branch into an empty tree of the canvas: it becomes that tree. */
export function pasteIntoTree(treeId: string) {
  if (treeId !== activeTree.value.id) activateTree(treeId);
  queueMicrotask(() => paste(clip.value, null));
}

/** A tree without nodes gets its first node, X, ready to be named. */
export function addRootNode(treeId: string) {
  if (treeId !== activeTree.value.id) activateTree(treeId);
  queueMicrotask(() => {
    const src = source.value;
    const r = parse(src);
    if (r.ok && r.doc.root) return;
    const ins = src.trim() ? '[X]\n' : '[X]';
    applyEdit({ changes: [{ from: 0, to: src.trim() ? 0 : src.length, insert: ins }], select: { from: 1, to: 2 } });
    selectNewNode(1);
  });
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

/**
 * The #ref of the lower position of a chain a node belongs to (the node itself, or anything inside
 * that copy or trace): styling there applies to this position only.
 */
export function positionRef(n: DNode | null): ARef | null {
  const inst = instanceOf(n);
  return inst ? chainRef(inst) : null;
}

/* ------------------------------------------------------------ one copy, or all copies */

/** Edits of a position of a chain go to this copy only, or to the constituent (all its copies). */
export const copyScope = signal<'this' | 'all'>('this');

/** The position of a chain a node is, or is inside of (a copy or a trace and what it contains). */
export function instanceOf(n: DNode | null): DNode | null {
  if (build.value.chains === 'multidominance') return null;
  let cur: DNode | undefined = n ?? undefined;
  while (cur && !cur.chainRef && (cur.copyOf || cur.synthetic)) cur = cur.parents[0];
  return cur?.chainRef ? cur : null;
}

/** #id/occ of the position a node is (the node itself must be the position) */
export function positionAt(n: DNode | null): { id: string; occ: number } | null {
  return n?.chainRef && build.value.chains !== 'multidominance' ? n.chainRef : null;
}

/** what a position has on its own (its line #id/occ: …) */
export function posStyle(pos: { id: string; occ: number } | null) {
  return pos ? doc.value?.posStyles.find((p) => p.id === pos.id && p.occ === pos.occ) ?? null : null;
}

/** Give one position of a chain something of its own (undefined: back to what all copies share). */
export function setPos(inst: DNode, patch: Partial<PosMods>) {
  if (!editable.value || !doc.value || !inst.chainRef) return;
  const { id, occ } = inst.chainRef;
  const edit = E.setPosStyle(source.value, doc.value, id, occ, patch);
  // the same written in the #ref itself (#wh^@red) gives way to the line
  const ref = chainRef(inst);
  if (ref) {
    const strip: { triangle?: boolean; color?: null } = {};
    if ('triangle' in patch && ref.triangle) strip.triangle = false;
    if ('color' in patch && ref.color) strip.color = null;
    let r = ref;
    if ('sem' in patch && ref.sem !== undefined) r = { ...r, sem: undefined };
    if ('text' in patch && ref.text !== undefined) r = { ...r, text: undefined };
    if (Object.keys(strip).length || r !== ref) {
      const next = E.setRefStyle(r, strip).changes[0];
      edit.changes.push({ ...next, from: ref.span.from, to: ref.span.to });
    }
  }
  applyEdit(edit);
}

/** this copy, when the scope says so and the node is (in) a position */
function thisCopy(n: DNode | null, whole: boolean): DNode | null {
  if (copyScope.value !== 'this') return null;
  return whole ? instanceOf(n) : positionAt(n) ? n : null;
}

export function toggleTriangle(n: DNode | null = selectedNode()) {
  const inst = thisCopy(n, true);
  if (inst) {
    // this copy the other way round; the same as all copies: nothing of its own
    const shared = !!doc.value?.ids.get(inst.chainRef!.id)?.triangle;
    const next = !inst.triangle;
    setPos(inst, { triangle: next === shared ? undefined : next });
    return;
  }
  if (!guard(n)) return;
  let s = n.src!;
  if (s.kind === 'leaf') {
    const p = parentSrc(n);
    if (!p) return;
    s = p;
  }
  applyEdit(E.toggleTriangle(source.value, s));
  void allCopies(n, 'triangle');
}

/**
 * A setting for all copies changed: copies with their own value of it are asked about (replace
 * them, or keep them).
 */
async function allCopies(n: DNode | null, key: keyof PosMods) {
  const inst = instanceOf(n);
  const id = inst?.chainRef?.id ?? n?.id;
  const d = doc.value;
  if (!id || !d) return;
  const own = d.posStyles.filter((p) => p.id === id && p.mods[key] !== undefined);
  const inline = (key === 'triangle' || key === 'color') && d.root ? refsOf(id).filter((r) => r[key] !== undefined) : [];
  const count = own.length + inline.length;
  if (!count) return;
  const what = { triangle: 'triangle', color: 'colour', features: 'features', sem: 'meaning', notes: 'notes', edge: 'edge colour', width: 'edge width', len: 'edge length' }[key as string] ?? String(key);
  const yes = await askOverride(`copies:${id}:${key}`, `${count} cop${count === 1 ? 'y' : 'ies'} of #${id} ha${count === 1 ? 's' : 've'} ${count === 1 ? 'its' : 'their'} own ${what}. Replace with the setting for all copies?`);
  if (!yes) return;
  const d2 = doc.value!;
  const src = source.value;
  let next = src;
  for (const p of [...d2.posStyles].filter((x) => x.id === id && x.mods[key] !== undefined).reverse()) {
    next = E.applyChanges(next, E.setPosStyle(next, parse(next).ok ? (parse(next) as { ok: true; doc: typeof d2 }).doc : d2, id, p.occ, { [key]: undefined }).changes);
  }
  const r = parse(next);
  if (r.ok && (key === 'triangle' || key === 'color') && r.doc.root) {
    const changes: E.TextChange[] = [];
    walkAst(r.doc.root, (x) => {
      for (const c of x.children) if (c.kind === 'ref' && c.id === id && c[key] !== undefined) changes.push(...E.setRefStyle(c, key === 'triangle' ? { triangle: false } : { color: null }).changes);
    });
    next = E.applyChanges(next, changes);
  }
  if (next !== src) applyEdit({ changes: [{ from: 0, to: src.length, insert: next }] });
}

function refsOf(id: string): ARef[] {
  const out: ARef[] = [];
  const root = doc.value?.root;
  if (root) walkAst(root, (x) => x.children.forEach((c) => c.kind === 'ref' && c.id === id && out.push(c)));
  return out;
}

/** the source node a canvas node stands for (terminals and synthetic nodes: their mother) */
function nodeSrc(n: DNode): ANode | null {
  return n.src?.kind === 'node' ? n.src : parentSrc(n);
}

export function setFeatures(n: DNode | null, text: string) {
  const inst = thisCopy(n, false);
  if (inst) return setPos(inst, { features: text.split(',').map((x) => x.trim()).filter(Boolean) });
  void allCopies(n, 'features');
  if (!guard(n)) return;
  const s = nodeSrc(n);
  if (s) applyEdit(E.setFeatures(s, text));
}

export function setMeaning(n: DNode | null, text: string) {
  const inst = thisCopy(n, false);
  if (inst) return setPos(inst, { sem: text.trim() || undefined });
  void allCopies(n, 'sem');
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
  const inst = (key === 'edge' || key === 'width' || key === 'len') && thisCopy(n, false);
  if (inst) return setPos(inst, { [key]: value ?? undefined });
  if (key === 'edge' || key === 'width' || key === 'len') void allCopies(n, key);
  if (!guard(n)) return;
  const s = nodeSrc(n);
  if (s) applyEdit(E.setOption(s, key, value));
}

export function setNotes(n: DNode | null, notes: E.LabelSpec[]) {
  const inst = thisCopy(n, false);
  if (inst) return setPos(inst, { notes: notes.filter((x) => x.text.trim()).map((x) => ({ ...x, span: { from: 0, to: 0 } })) });
  void allCopies(n, 'notes');
  if (!guard(n)) return;
  const s = nodeSrc(n);
  if (s) applyEdit(E.setNotes(source.value, s, notes));
}

/** a note of one position of a chain: its line's notes and which one */
function posNotes(n: DNode, index: number): { list: ALabel[]; i: number } | null {
  const lbl = n.notes?.find((x) => x.index === index);
  if (!lbl?.pos) return null;
  const list = posStyle(lbl.pos)?.mods.notes ?? [];
  return { list, i: index - POS_NOTE };
}

/** Drag a note or an arrow label to a new offset. */
export function moveLabel(kind: 'note' | 'arrow', owner: string | number, index: number, off: [number, number]) {
  if (!editable.value) return;
  if (kind === 'note') {
    const n = nodeByKey(owner as string);
    const own = n && posNotes(n, index);
    if (own) {
      setPos(n!, { notes: own.list.map((x, i) => (i === own.i ? { ...x, off } : x)) });
      return;
    }
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
    const own = n && posNotes(n, index);
    if (own) {
      setPos(n!, { notes: own.list.flatMap((l, i) => (i !== own.i ? [l] : text === null || !text.trim() ? [] : [{ ...l, text }])) });
      return;
    }
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
    const own = n && posNotes(n, index);
    if (own) return own.list[own.i]?.text;
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
  // this copy only: the whole copy (or trace) gets the colour
  const inst = thisCopy(n, true);
  if (inst) {
    // the default colour on this copy, although the constituent has one: @none
    const def = doc.value?.ids.get(inst.chainRef!.id);
    return setPos(inst, { color: color ?? (def?.color || def?.branchColor ? 'none' : undefined) });
  }
  void allCopies(n, 'color');
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
  // a new arrow is just an arrow; making it movement is a choice of its own
  applyEdit(E.addArrow(source.value, doc.value!, from, to, { plain: true }));
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
  return insertVia(g, g.arrow.via?.length ? cubicAt(g, 0.5) : g.handle);
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
