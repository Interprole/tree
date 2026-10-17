import * as A from './actions';
import type { AArrow, ANode } from './core/ast';
import { buildTree, defaultBuildOptions } from './core/build';
import * as E from './core/edits';
import { diffChange } from './core/format';
import { stripLinks } from './core/links';
import type { DArrow, DNode } from './core/model';
import { analyseLabel } from './core/modes';
import { parse, walkAst } from './core/parser';
import { parseRich } from './core/richtext';
import { build, doc, editable, selection, showToast, source } from './state';

/**
 * Arrows and movement. A new arrow is just an arrow (plain). Making it movement writes the
 * movement into the tree: two constituents of the same category become positions of one chain
 * (copies); two heads of different categories, head movement (;to= on the moved head). The arrow
 * line then only styles the movement's arrow, or hides it (hide) / shows it (visible) against the
 * setting for that kind of arrows.
 */

const cat = (n: ANode) => analyseLabel(parseRich(n.label, { primes: true }));
const isHead = (n: ANode) => n.children.every((c) => c.kind === 'leaf') && cat(n).level === 0;

/** the arrow is drawn by itself for this kind of movement (the global switch) */
const arrowsOn = (a: DArrow) => (a.headMove || (!a.chain && !a.plain) ? build.value.headArrows : build.value.chainArrows);

export function isMovement(a: DArrow): boolean {
  return !a.plain && (!!a.chain || !!a.headMove || !!a.src);
}

/** no style of its own: only the two ends (and maybe hide / visible) */
function unstyled(a: AArrow): boolean {
  return a.line === 'solid' && a.route === 'under' && a.head === 'end' && !a.labels.length && !a.color && !a.via?.length && !(a.bend && (a.bend[0] || a.bend[1])) && !a.fromAt && !a.toAt;
}

/** other lines for the same movement (e.g. one that hides its arrow): one visible arrow stays */
function sameMovement(src: string, keep: AArrow, ends: Pick<AArrow, 'from' | 'to' | 'fromOcc' | 'toOcc'>): E.TextChange[] {
  const same = (x: AArrow) =>
    (x.from === ends.from && x.to === ends.to && x.fromOcc === ends.fromOcc && x.toOcc === ends.toOcc) ||
    (x.from === ends.to && x.to === ends.from && x.fromOcc === ends.toOcc && x.toOcc === ends.fromOcc);
  return (doc.value?.arrows ?? []).filter((x) => x !== keep && !x.plain && same(x)).map((x) => lineChange(src, x, null));
}

/** a single undo step from the current code to the given one */
function commit(next: string, select?: DNode | null) {
  const c = diffChange(source.value, next);
  if (c) A.applyEdit({ changes: [c] });
  if (select === null) selection.value = null;
}

function lineChange(src: string, a: AArrow, line: string | null): E.TextChange {
  if (line) return { from: a.span.from, to: a.span.to, insert: line };
  let to = a.span.to;
  while (to < src.length && src[to] !== '\n') to++;
  let from = a.span.from;
  if (src[from - 1] === '\n') from--;
  return { from, to, insert: '' };
}

/** the arrow line written for a movement: its style, and hide/visible against the global switch */
function movementLine(base: AArrow, ends: Pick<AArrow, 'from' | 'to' | 'fromOcc' | 'toOcc'>, on: boolean): string | null {
  const next: AArrow = { ...base, ...ends, plain: undefined, hidden: undefined, visible: on ? undefined : true };
  if (on && unstyled(next)) return null;
  return E.arrowLine(next);
}

/** Make a plain arrow movement. */
export function makeMovement(a: DArrow) {
  if (!editable.value || !a.src || !doc.value) return;
  const d = doc.value;
  const src = source.value;
  const s = a.src;
  const from = d.ids.get(s.from);
  const to = d.ids.get(s.to);
  if (!from || !to) return;
  // already positions of one chain: the movement is there, only its arrow is shown
  if (s.from === s.to && s.fromOcc && s.toOcc) {
    commit(E.applyChanges(src, [lineChange(src, s, movementLine(s, s, build.value.chainArrows)), ...sameMovement(src, s, s)]));
    return;
  }
  const ca = cat(from);
  const cb = cat(to);
  const heads = isHead(from) && isHead(to);
  if (heads && ca.cat !== cb.cat) return headMovement(a, from, to);
  if (ca.cat !== cb.cat || ca.level !== cb.level) {
    showToast(`Movement needs two constituents of one category: ${from.label || '(no label)'} and ${to.label || '(no label)'} differ. It stays just an arrow.`);
    return;
  }
  chainMovement(a, from, to);
}

function headMovement(a: DArrow, from: ANode, to: ANode) {
  const d = doc.value!;
  const src = source.value;
  const s = a.src!;
  const on = build.value.headArrows;
  const changes: E.TextChange[] = [];
  const reserved = new Set<string>();
  const tid = E.ensureId(d, to, reserved);
  if (tid.change) changes.push(tid.change);
  const fid = from.id ?? E.ensureId(d, from, reserved).id;
  if (from.opts?.to === tid.id) {
    // the head movement is there already: one visible arrow
    changes.push(lineChange(src, s, movementLine(s, { from: fid, to: tid.id }, on)), ...sameMovement(src, s, { from: fid, to: tid.id }));
  } else {
    changes.push({ from: from.labelSpan.to, to: from.headerSpan.to, insert: E.modifiers({ id: fid, color: from.color, branchColor: from.branchColor, pronounce: from.pronounce, opts: { ...(from.opts ?? {}), to: tid.id } }) + (from.headerSpan.from === from.headerSpan.to ? ' ' : '') });
    changes.push(lineChange(src, s, movementLine(s, { from: fid, to: tid.id }, on)));
  }
  commit(E.applyChanges(src, changes));
}

function depth(n: DNode): number {
  let k = 0;
  for (let c = n.parents[0]; c; c = c.parents[0]) k++;
  return k;
}

function chainMovement(a: DArrow, from: ANode, to: ANode) {
  const d = doc.value!;
  const src = source.value;
  const s = a.src!;
  // the higher one stays (it is written in the code), the lower one becomes a position of it
  const [upper, lower, upperIsTo] = depth(a.to) <= depth(a.from) ? [to, from, true] : [from, to, false];
  if ((lower.span.from <= upper.span.from && lower.span.to >= upper.span.to) || (upper.span.from <= lower.span.from && upper.span.to >= lower.span.to)) {
    showToast('One of them contains the other: that cannot be movement.');
    return;
  }
  // the lower one disappears into the chain: nothing else may point at it
  const lowerIds = new Set<string>();
  walkAst(lower, (n) => void (n.id && lowerIds.add(n.id)));
  const usedElsewhere = [...lowerIds].some((id) => d.arrows.some((x) => x !== s && (x.from === id || x.to === id)) || d.posStyles.some((p) => p.id === id));
  if (usedElsewhere || (d.root && refsTo(d.root, lowerIds, lower))) {
    showToast('The lower constituent is used elsewhere (an arrow or a chain points at it): remove that first.');
    return;
  }
  const changes: E.TextChange[] = [];
  const up = E.ensureId(d, upper);
  if (up.change) changes.push(up.change);
  // the same words: a silent copy; other words: pronounced with them
  const content = (n: ANode) => stripLinks(src.slice(n.headerSpan.to, n.span.to - 1)).replace(/\s+/g, ' ').trim();
  const same = upper.label === lower.label && content(upper) === content(lower);
  const words: string[] = [];
  walkAst(lower, (n) => n.children.forEach((c) => c.kind === 'leaf' && words.push(c.text)));
  const ref = same ? `#${up.id}` : words.length ? `#${up.id}"${words.join(' ').replace(/"/g, "''")}"` : `#${up.id}!`;
  changes.push({ from: lower.span.from, to: lower.span.to, insert: ref });
  const refAt = lower.span.from;
  // the arrow line goes, for now: written again below with the positions of the chain
  changes.push(lineChange(src, s, null));
  let next = E.applyChanges(src, changes);
  const refNew = E.mapPos(refAt, changes.filter((c) => c.to <= refAt)) ;
  // which positions of the chain the two are now
  const r = parse(next);
  if (!r.ok) {
    showToast(r.error.message);
    return;
  }
  const t = buildTree(r.doc, { ...defaultBuildOptions, chains: 'copies' });
  const inst = t?.nodes.filter((n) => n.chainRef?.id === up.id) ?? [];
  const upperInst = inst.find((n) => !n.copyOf);
  const lowerInst = inst.find((n) => {
    const p = n.parents[0]?.src;
    return n.copyOf && p?.kind === 'node' && p.span.from <= refNew && p.span.to >= refNew;
  });
  if (upperInst?.chainRef && lowerInst?.chainRef) {
    const ends = upperIsTo
      ? { from: up.id, to: up.id, fromOcc: lowerInst.chainRef.occ, toOcc: upperInst.chainRef.occ }
      : { from: up.id, to: up.id, fromOcc: upperInst.chainRef.occ, toOcc: lowerInst.chainRef.occ };
    const line = movementLine({ ...s }, ends, build.value.chainArrows);
    if (line) next = next.replace(/\s*$/, '') + '\n' + line + '\n';
  }
  commit(next, null);
}

function refsTo(root: ANode, ids: Set<string>, inside: ANode): boolean {
  let found = false;
  walkAst(root, (n) => {
    if (n.span.from >= inside.span.from && n.span.to <= inside.span.to) return;
    for (const c of n.children) if (c.kind === 'ref' && ids.has(c.id)) found = true;
  });
  return found;
}

/** Delete the arrow, keep the movement: hide (arrows of this kind on) or no line (off). */
export function hideMovementArrow(a: DArrow) {
  if (!editable.value || !doc.value) return;
  const src = source.value;
  const on = arrowsOn(a);
  if (a.src) {
    const next: AArrow = { ...a.src, hidden: on || undefined, visible: undefined };
    const line = !on && unstyled(next) && !next.hidden ? null : E.arrowLine(next);
    commit(E.applyChanges(src, [lineChange(src, a.src, line)]), null);
    return;
  }
  // an automatic arrow: a line that hides it
  if (!on) return;
  const ends = a.chain ? { from: a.chain.id, to: a.chain.id, fromOcc: a.chain.from, toOcc: a.chain.to } : a.headMove ? { from: a.headMove.from, to: a.headMove.to } : null;
  if (!ends) return;
  const line = E.arrowLine({ ...ends, head: 'end', line: 'solid', route: 'under', labels: [], hidden: true });
  const end = src.replace(/\s+$/, '').length;
  commit(src.slice(0, end) + '\n' + line + '\n', null);
}

/**
 * Undo a movement: the lower position of a chain becomes a constituent of its own again (a copy),
 * a head movement is no longer written on the head. keepArrow: a plain arrow stays between them.
 */
export function unmove(a: DArrow, keepArrow: boolean) {
  if (!editable.value || !doc.value) return;
  const d = doc.value;
  const src = source.value;
  const changes: E.TextChange[] = [];
  if (a.src) changes.push(lineChange(src, a.src, null));
  // head movement written on the head
  const hm = a.headMove ?? (a.src && !a.plain && !a.chain ? { from: a.src.from, to: a.src.to } : null);
  if (hm && !a.chain) {
    const head = d.ids.get(hm.from);
    if (head?.opts?.to === hm.to) changes.push(E.setOption(head, 'to', null).changes[0]);
    let next = E.applyChanges(src, changes);
    if (keepArrow) next = next.replace(/\s*$/, '') + '\n' + E.arrowLine({ from: hm.from, to: hm.to, head: a.head, line: a.line, route: a.route, labels: a.src?.labels ?? [], color: a.color, plain: true }) + '\n';
    commit(next, keepArrow ? undefined : null);
    return;
  }
  if (!a.chain) return;
  // the lower position of the chain: its #ref becomes a copy of the constituent
  const lowerInst = a.chain.from > a.chain.to ? a.from : a.to;
  const ref = A.chainRef(lowerInst);
  const def = d.ids.get(a.chain.id);
  if (!ref || !def) {
    showToast('This position is the constituent itself: undo the movement from its other position.');
    return;
  }
  // the copy: the constituent without its own id, with new names for the ids inside, or with the words of the position
  let text = stripLinks(src.slice(def.span.from, def.span.to)).replace(/(?<![@=])#[\p{L}\p{N}_\-.:]+[!?]?/u, '');
  const used = new Set(d.ids.keys());
  const inner: string[] = [];
  walkAst(def, (n) => void (n !== def && n.id && inner.push(n.id)));
  for (const id of inner) {
    let k = 2;
    while (used.has(id + k)) k++;
    used.add(id + k);
    text = text.replace(new RegExp(`(?<!\\\\)#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_\\-.:])`, 'gu'), `#${id + k}`);
  }
  if (ref.text !== undefined) text = `[${def.label} ${ref.text.split(/\s*\|\s*/)[0]}]`;
  let copyId = '';
  if (keepArrow) {
    let k = 2;
    while (used.has(a.chain.id + k)) k++;
    copyId = a.chain.id + k;
    text = text.replace(/^\[([^\s[\]]*)/, (_, h: string) => `[${h.replace(/^([^#;@]*)/, `$1#${copyId}`)}`);
  }
  changes.push({ from: ref.span.from, to: ref.span.to, insert: text });
  for (const p of d.posStyles) if (p.id === a.chain.id && p.occ === Math.max(a.chain.from, a.chain.to)) changes.push(lineChange(src, { ...(p as unknown as AArrow), span: p.span }, null));
  let next = E.applyChanges(src, changes);
  if (keepArrow) {
    const lowerIsFrom = a.chain.from > a.chain.to;
    const line = E.arrowLine({ from: lowerIsFrom ? copyId : a.chain.id, to: lowerIsFrom ? a.chain.id : copyId, head: a.head, line: a.line, route: a.route, labels: a.src?.labels ?? [], color: a.color, plain: true });
    next = next.replace(/\s*$/, '') + '\n' + line + '\n';
  }
  commit(next, keepArrow ? undefined : null);
}

/** Just an arrow again (plain), or movement. */
export function setArrowKind(a: DArrow, movement: boolean) {
  if (movement) return makeMovement(a);
  if (a.chain || a.headMove) return unmove(a, true);
  if (a.src) A.updateArrow(a, { plain: true, hidden: undefined, visible: undefined });
}

/** Delete an arrow: a plain one goes; a movement arrow goes with or without its movement. */
export function deleteArrow(a: DArrow, withMovement = false) {
  if (!isMovement(a)) {
    if (a.src) A.applyEdit(E.deleteArrow(source.value, a.src));
    selection.value = null;
    return;
  }
  if (withMovement) unmove(a, false);
  else hideMovementArrow(a);
}
