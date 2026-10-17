import type { ADoc, ANode } from './ast';
import { applyChanges } from './edits';
import type { TextChange } from './edits';
import { formatNode } from './format';
import { parse, walkAst } from './parser';

/**
 * Linked branches: [VP;link=a …] in several places (in one tree or in several trees on the
 * canvas) are one branch. Whatever changes inside one of them is repeated in the others; what is
 * around them (sisters, mothers, where the branch stands) is free. Ids defined inside a branch are
 * matched by their order, so every copy keeps its own names.
 */

const ID_REF = /(?<!\\)#([\p{L}\p{N}_\-.:]+)/gu;

export interface LinkInstance {
  group: string;
  node: ANode;
}

/** The linked branches of a document (outermost first). */
export function linkInstances(doc: ADoc): LinkInstance[] {
  const out: LinkInstance[] = [];
  if (doc.root) walkAst(doc.root, (n) => n.opts?.link && out.push({ group: n.opts.link, node: n }));
  return out;
}

/** Ids defined inside a branch (not its root: that belongs to where the branch stands), in document order. */
export function idsIn(node: ANode): string[] {
  return defsIn(node).map((d) => d.id);
}

function defsIn(node: ANode): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  walkAst(node, (n) => void (n !== node && n.id && out.push({ id: n.id, label: n.label })));
  return out;
}

/**
 * The text of a branch without what belongs to its place: the root's own #id and its ! / ?
 * (a branch can be re-merged in one place and not in another).
 */
function body(src: string, node: ANode): string {
  const mods = src.slice(node.labelSpan.to, node.headerSpan.to).replace(/(?<![@=])#[\p{L}\p{N}_\-.:]+[!?]?/u, '');
  return src.slice(node.span.from, node.labelSpan.to) + mods + src.slice(node.headerSpan.to, node.span.to);
}

/** the root's own #id (and ! / ?) as written */
function ownId(src: string, node: ANode): string {
  return /(?<![@=])#[\p{L}\p{N}_\-.:]+[!?]?/u.exec(src.slice(node.labelSpan.to, node.headerSpan.to))?.[0] ?? '';
}

/**
 * Which id of the target stands for which id of the winner: the same name, else a node with the
 * same label (in order), else the remaining ones in order; ids new in the winner get free names.
 */
function matchIds(w: { id: string; label: string }[], t: { id: string; label: string }[], used: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  const free = new Set(t.map((x) => x.id));
  for (const x of w) if (free.has(x.id)) (map.set(x.id, x.id), free.delete(x.id));
  for (const x of w) {
    if (map.has(x.id)) continue;
    const m = t.find((y) => free.has(y.id) && y.label === x.label);
    if (m) (map.set(x.id, m.id), free.delete(m.id));
  }
  const rest = t.filter((y) => free.has(y.id));
  for (const x of w) {
    if (map.has(x.id)) continue;
    const m = rest.shift();
    if (m) {
      map.set(x.id, m.id);
      free.delete(m.id);
      continue;
    }
    let name = x.id;
    for (let k = 2; used.has(name); k++) name = x.id + k;
    used.add(name);
    map.set(x.id, name);
  }
  return map;
}

function rename(text: string, map: Map<string, string>): string {
  return text.replace(ID_REF, (m, id: string) => (map.has(id) ? '#' + map.get(id) : m));
}

/** The content of a branch, independent of its own id names and of line breaks and indentation. */
export function canon(src: string, node: ANode): string {
  const ids = idsIn(node);
  const map = new Map(ids.map((id, i) => [id, `\u0001${i}`]));
  return rename(body(src, node), map).replace(/\s+/g, ' ');
}

/** Arrow lines and position lines that belong to a branch (every id in them is defined inside it). */
function linesOf(src: string, doc: ADoc, ids: Set<string>) {
  const inner: { from: number; to: number }[] = [];
  const touching: { from: number; to: number }[] = [];
  for (const a of doc.arrows) {
    const both = ids.has(a.from) && ids.has(a.to);
    if (both) inner.push(a.span);
    else if (ids.has(a.from) || ids.has(a.to)) touching.push(a.span);
  }
  for (const p of doc.posStyles) if (ids.has(p.id)) inner.push(p.span);
  return { inner, touching, text: inner.map((s) => src.slice(s.from, s.to)) };
}

/** a whole line, with its line break */
function lineRange(src: string, s: { from: number; to: number }): TextChange {
  let from = s.from;
  let to = s.to;
  while (to < src.length && src[to] !== '\n') to++;
  if (src[from - 1] === '\n') from--;
  return { from, to, insert: '' };
}

/**
 * The text of a document after one of its linked branches (target) took over the content of
 * another copy (from winnerSrc / winner). Returns null when nothing changes or it would not parse.
 */
export function propagate(winnerSrc: string, winnerDoc: ADoc, winner: ANode, targetSrc: string, targetDoc: ADoc, target: ANode): string | null {
  const wDefs = defsIn(winner);
  const wIds = wDefs.map((d) => d.id);
  const tIds = idsIn(target);
  const map = matchIds(wDefs, defsIn(target), new Set(targetDoc.ids.keys()));
  const kept = new Set(map.values());
  const vanished = new Set(tIds.filter((id) => !kept.has(id)));
  // the winner's content, with the target's own id put back on the root
  let text = rename(body(winnerSrc, winner), map);
  const own = ownId(targetSrc, target);
  if (own) {
    const at = winner.labelSpan.to - winner.span.from;
    text = text.slice(0, at) + own + text.slice(at);
  }
  const changes: TextChange[] = [{ from: target.span.from, to: target.span.to, insert: text }];
  // positions of chains elsewhere that pointed into the target at what no longer exists
  if (vanished.size && targetDoc.root) {
    walkAst(targetDoc.root, (n) => {
      if (n.span.from >= target.span.from && n.span.to <= target.span.to) return;
      for (const c of n.children) {
        if (c.kind !== 'ref' || !vanished.has(c.id)) continue;
        let f = c.span.from;
        while (f > 0 && (targetSrc[f - 1] === ' ' || targetSrc[f - 1] === '\t')) f--;
        changes.push({ from: f, to: c.span.to, insert: '' });
      }
    });
  }
  // the lines (arrows, position styles) inside the branch follow too
  const wLines = linesOf(winnerSrc, winnerDoc, new Set(wIds)).text.map((l) => rename(l, map));
  const tl = linesOf(targetSrc, targetDoc, new Set(tIds));
  const tText = tl.text;
  const dropTouching = tl.touching.filter((s) => [...vanished].some((id) => new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_\\-.:])`, 'u').test(targetSrc.slice(s.from, s.to))));
  const linesDiffer = wLines.join('\n') !== tText.join('\n');
  if (linesDiffer) for (const s of tl.inner) changes.push(lineRange(targetSrc, s));
  for (const s of dropTouching) changes.push(lineRange(targetSrc, s));
  if (linesDiffer && wLines.length) {
    const end = targetSrc.replace(/\s+$/, '').length;
    changes.push({ from: end, to: targetSrc.length, insert: '\n' + wLines.join('\n') + '\n' });
  }
  let out: string;
  try {
    out = applyChanges(targetSrc, dedupe(changes));
  } catch {
    return null;
  }
  // lay the branch out where it stands now (when it takes several lines)
  const r = parse(out);
  if (!r.ok) return null;
  let node: ANode | null = null;
  if (r.doc.root) walkAst(r.doc.root, (n) => !node && n.span.from === target.span.from && n.opts?.link === target.opts?.link && (node = n));
  if (node && text.includes('\n')) {
    const n = node as ANode;
    const col = n.span.from - out.lastIndexOf('\n', n.span.from - 1) - 1;
    out = out.slice(0, n.span.from) + formatNode(out, n, col) + out.slice(n.span.to);
  }
  return out === targetSrc ? null : out;
}

function dedupe(changes: TextChange[]): TextChange[] {
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  const out: TextChange[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.from < last.to) {
      if (c.to > last.to) last.to = c.to;
      continue;
    }
    out.push({ ...c });
  }
  return out;
}

/** A branch of its own again: the link marker goes. */
export function stripLinks(text: string): string {
  return text.replace(/;link=[^;\s[\]@#]+/g, '');
}

export interface LinkDoc {
  key: string;
  text: string;
}

/**
 * Bring every group of linked branches in line. docs: the texts of all trees; active: the key of
 * the one being edited (its changed branch wins); known: the last agreed content of each group
 * (updated). Returns the texts that changed.
 */
export function syncLinks(docs: LinkDoc[], active: string, known: Map<string, string>): Map<string, string> {
  const texts = new Map(docs.map((d) => [d.key, d.text]));
  const changed = new Map<string, string>();
  for (let round = 0; round < 60; round++) {
    const parsed = new Map<string, ADoc>();
    for (const [k, t] of texts) {
      const r = parse(t);
      if (r.ok) parsed.set(k, r.doc);
      else if (k === active) return changed;
    }
    const groups = new Map<string, { key: string; node: ANode; canon: string }[]>();
    for (const [k, d] of parsed) {
      for (const inst of linkInstances(d)) {
        if (!groups.has(inst.group)) groups.set(inst.group, []);
        groups.get(inst.group)!.push({ key: k, node: inst.node, canon: canon(texts.get(k)!, inst.node) });
      }
    }
    let did = false;
    for (const [g, list] of groups) {
      const first = list[0].canon;
      if (list.every((x) => x.canon === first)) {
        known.set(g, first);
        continue;
      }
      const stored = known.get(g);
      const winner =
        list.find((x) => x.key === active && x.canon !== stored) ?? list.find((x) => x.canon === stored) ?? list.find((x) => x.key === active) ?? list[0];
      const target = list.find((x) => x.canon !== winner.canon && !(x.node.span.from <= winner.node.span.from && x.node.span.to >= winner.node.span.to && x.key === winner.key));
      known.set(g, winner.canon);
      if (!target) continue;
      const out = propagate(texts.get(winner.key)!, parsed.get(winner.key)!, winner.node, texts.get(target.key)!, parsed.get(target.key)!, target.node);
      if (out === null) continue;
      texts.set(target.key, out);
      changed.set(target.key, out);
      did = true;
      break;
    }
    if (!did) break;
  }
  return changed;
}
