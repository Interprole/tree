import type { ADoc, ALeaf, ANode } from './ast';
import { applyBps, applyXbar } from './modes';
import type { BpsOptions, XbarOptions } from './modes';
import { collectNodes, relink } from './model';
import type { DArrow, DNode, DTree } from './model';
import { baseText, indicesOf, parseRich, plain } from './richtext';
import type { Runs } from './richtext';

export type LabelMode = 'manual' | 'xbar' | 'bps';

export interface BuildOptions {
  mode: LabelMode;
  xbar: XbarOptions;
  bps: BpsOptions;
  /** draw multidominated nodes once (shared) or as copies in every position */
  multidominance: 'shared' | 'copies';
  /** arrows from traces/copies to coindexed antecedents */
  autoArrows: boolean;
  /** show null heads/specifiers (∅) */
  showEmpty: boolean;
}

export const defaultBuildOptions: BuildOptions = {
  mode: 'manual',
  xbar: { bar: 'always', headLabel: 'X', emptySpecs: false, barStyle: 'prime', expandWords: true },
  bps: { label: 'category' },
  multidominance: 'shared',
  autoArrows: true,
  showEmpty: true,
};

const EMPTY_WORDS = new Set(['∅', 'Ø', 'ø', 'e', '0']);
const TRACE_WORDS = new Set(['t', 't′', 't″', 'e']);

function isCopyText(runs: Runs): boolean {
  const b = baseText(runs).trim();
  return b.length >= 2 && b.startsWith('<') && b.endsWith('>');
}

function stripAngles(runs: Runs): Runs {
  const out = runs.map((r) => ({ ...r }));
  const first = out.find((r) => !r.sub && !r.sup);
  const last = [...out].reverse().find((r) => !r.sub && !r.sup);
  if (first) first.text = first.text.replace(/^\s*</, '');
  if (last) last.text = last.text.replace(/>\s*$/, '');
  return out.filter((r) => r.text !== '');
}

/** Build the display tree from the AST (shared structure for #refs). */
export function buildTree(doc: ADoc, opts: BuildOptions = defaultBuildOptions): DTree | null {
  if (!doc.root) return null;
  const byAst = new Map<ANode, DNode>();

  const mkLeaf = (l: ALeaf, key: string): DNode => {
    let label = parseRich(l.text);
    const d: DNode = {
      key,
      kind: 'leaf',
      label,
      children: [],
      parents: [],
      src: l,
      indices: indicesOf(label),
    };
    if (isCopyText(label)) {
      d.copy = true;
      d.trace = true;
      label = stripAngles(label);
      d.label = label;
    }
    const b = baseText(label).trim();
    if (EMPTY_WORDS.has(b)) d.empty = true;
    if (TRACE_WORDS.has(b)) d.trace = true;
    if (l.gloss.length) d.gloss = l.gloss.map((g) => parseRich(g, { smallCaps: true }));
    return d;
  };

  const mk = (a: ANode, key: string): DNode => {
    const existing = byAst.get(a);
    if (existing) return existing;
    let label = parseRich(a.label, { primes: true });
    const d: DNode = {
      key: a.id ? `#${a.id}` : key,
      kind: 'phrase',
      label,
      children: [],
      parents: [],
      src: a,
      indices: indicesOf(label),
    };
    byAst.set(a, d);
    if (a.id) d.id = a.id;
    if (a.head) d.head = true;
    if (a.triangle) d.triangle = true;
    if (a.color) d.color = a.color;
    if (a.branchColor) {
      d.branchColor = a.branchColor;
      if (!d.color) d.color = a.branchColor;
    }
    if (isCopyText(label)) {
      d.copy = true;
      d.trace = true;
      label = stripAngles(label);
      d.label = label;
    }
    if (a.features) d.features = a.features.map((f) => parseRich(f));
    if (a.gloss) d.gloss = a.gloss.map((g) => parseRich(g, { smallCaps: true }));
    a.children.forEach((c, i) => {
      if (c.kind === 'node') d.children.push(mk(c, `${key}.${i}`));
      else if (c.kind === 'leaf') d.children.push(mkLeaf(c, `${key}.${i}`));
      else d.children.push(mk(doc.ids.get(c.id)!, `${key}.${i}`));
    });
    // a triangle with several text pieces: join them into one terminal
    if (d.triangle) {
      const leaves = d.children.filter((c) => c.kind === 'leaf');
      if (leaves.length > 1) {
        const joined: DNode = { ...leaves[0], label: leaves.flatMap((l, i) => (i ? [{ text: ' ' }, ...l.label] : l.label)) };
        d.children = [joined, ...d.children.filter((c) => c.kind !== 'leaf')];
      }
    }
    return d;
  };

  let root = mk(doc.root, 'n');
  relink(root);
  propagateStyles(root);

  if (!opts.showEmpty) root = removeEmpty(root);
  if (opts.mode === 'xbar') root = applyXbar(root, opts.xbar);
  else if (opts.mode === 'bps') root = applyBps(root, opts.bps);
  relink(root);

  if (opts.multidominance === 'copies') root = unshare(root);
  const nodes = relink(root);

  const arrows: DArrow[] = [];
  const byId = new Map<string, DNode>();
  for (const n of nodes) if (n.id && !n.copyOf) byId.set(n.id, n);
  doc.arrows.forEach((a, index) => {
    const from = byId.get(a.from);
    const to = byId.get(a.to);
    if (!from || !to) return;
    arrows.push({
      from,
      to,
      head: a.head,
      line: a.line,
      route: a.route,
      label: a.label,
      color: a.color,
      bend: a.bend ?? [0, 0],
      src: a,
      index,
    });
  });
  if (opts.autoArrows) arrows.push(...autoArrows(root, nodes, arrows));
  return { root, arrows, nodes };
}

/** Copy colours and copy-marking down to descendants. */
function propagateStyles(root: DNode) {
  const visit = (n: DNode, branch: string | undefined, copy: boolean) => {
    if (branch && !n.branchColor) n.branchColor = branch;
    if (branch && !n.color) n.color = branch;
    if (copy) n.copy = true;
    for (const c of n.children) visit(c, n.branchColor ?? branch, copy || !!n.copy);
  };
  visit(root, undefined, false);
}

function isNullNode(n: DNode): boolean {
  if (n.kind === 'leaf') return !!n.empty && !n.trace && baseText(n.label).trim() !== 'e';
  if (n.children.length === 0) return ['∅', 'Ø'].includes(baseText(n.label).trim());
  return n.children.every(isNullNode);
}

function removeEmpty(root: DNode): DNode {
  const seen = new Set<DNode>();
  const visit = (n: DNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    const kept = n.children.filter((c) => !isNullNode(c));
    if (kept.length > 0 || n.children.every((c) => c.kind === 'leaf')) n.children = kept;
    n.children.forEach(visit);
  };
  visit(root);
  return root;
}

function depthMap(root: DNode): Map<DNode, number> {
  // shortest depth from root (highest position)
  const depth = new Map<DNode, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const n = queue.shift()!;
    for (const c of n.children) {
      if (!depth.has(c)) {
        depth.set(c, depth.get(n)! + 1);
        queue.push(c);
      }
    }
  }
  return depth;
}

let cloneCounter = 0;
function cloneSubtree(n: DNode, suffix: string): DNode {
  const c: DNode = {
    ...n,
    key: n.key + suffix,
    children: n.children.map((ch) => cloneSubtree(ch, suffix)),
    parents: [],
    copy: true,
    copyOf: n.key,
    id: undefined,
  };
  return c;
}

/** Multidominance shown as copies: the highest occurrence stays, the others become greyed copies. */
export function unshare(root: DNode): DNode {
  relink(root);
  const depth = depthMap(root);
  const nodes = collectNodes(root);
  for (const n of nodes) {
    if (n.parents.length < 2) continue;
    const primary = [...n.parents].sort((a, b) => depth.get(a)! - depth.get(b)!)[0];
    for (const p of n.parents) {
      if (p === primary) continue;
      const idx = p.children.indexOf(n);
      p.children[idx] = cloneSubtree(n, `~copy${++cloneCounter}`);
    }
  }
  relink(root);
  return root;
}

/** Arrows from each trace/copy to the next higher coindexed element. */
function autoArrows(root: DNode, nodes: DNode[], explicit: DArrow[]): DArrow[] {
  const depth = depthMap(root);
  const chains = new Map<string, DNode[]>();
  for (const n of nodes) {
    for (const i of n.indices) {
      if (!chains.has(i)) chains.set(i, []);
      chains.get(i)!.push(n);
    }
  }
  const out: DArrow[] = [];
  const has = (a: DNode, b: DNode) => explicit.some((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
  for (const chain of chains.values()) {
    if (chain.length < 2 || !chain.some((n) => n.trace)) continue;
    // order: highest first; ties by pre-order
    const order = new Map(nodes.map((n, i) => [n, i]));
    chain.sort((a, b) => depth.get(a)! - depth.get(b)! || order.get(a)! - order.get(b)!);
    for (let k = 1; k < chain.length; k++) {
      const foot = chain[k];
      if (!foot.trace) continue;
      // nearest higher member (not itself a descendant relation of foot)
      const target = chain[k - 1];
      if (has(foot, target)) continue;
      out.push({ from: foot, to: target, head: 'end', line: 'solid', route: 'under', bend: [0, 0], auto: true });
    }
  }
  return out;
}

export function labelText(n: DNode): string {
  return plain(n.label);
}
