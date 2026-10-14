import type { AArrow, ALeaf, ANode, ArrowHead, ArrowLine, ArrowRoute } from './ast';
import type { Runs } from './richtext';

/**
 * Display tree: what is actually laid out and drawn. Produced from the AST by
 * build.ts and then rewritten by the labelling modes (X-bar, BPS).
 * A node may have several parents (multidominance).
 */
export interface DNode {
  /** unique within a display tree */
  key: string;
  kind: 'phrase' | 'leaf';
  label: Runs;
  children: DNode[];
  parents: DNode[];
  /** source element (absent for nodes synthesised by a labelling mode) */
  src?: ANode | ALeaf;
  /** node created by automatic projection / labelling */
  synthetic?: boolean;
  /** user id (#id) */
  id?: string;
  triangle?: boolean;
  features?: Runs[];
  gloss?: Runs[];
  /** lower copy in a movement chain: rendered grey / struck through */
  copy?: boolean;
  /** empty category (∅, t, PRO, pro, e) */
  empty?: boolean;
  /** trace or copy: the foot of a movement chain */
  trace?: boolean;
  color?: string;
  /** colour inherited from a branch colouring */
  branchColor?: string;
  /** head daughter marked with * (BPS) */
  head?: boolean;
  /** coindices from subscripts */
  indices: string[];
  /** for nodes duplicated from a multidominated node (copies view): key of the original */
  copyOf?: string;
}

export interface DArrow {
  from: DNode;
  to: DNode;
  head: ArrowHead;
  line: ArrowLine;
  route: ArrowRoute;
  label?: string;
  color?: string;
  bend: [number, number];
  /** derived automatically from coindexation */
  auto?: boolean;
  src?: AArrow;
  /** index into doc.arrows for explicit arrows */
  index?: number;
}

export interface DTree {
  root: DNode;
  arrows: DArrow[];
  /** all nodes, pre-order, each once */
  nodes: DNode[];
}

export function isLeaf(n: DNode) {
  return n.kind === 'leaf';
}

/** Pre-order traversal visiting multidominated nodes once. */
export function collectNodes(root: DNode): DNode[] {
  const seen = new Set<DNode>();
  const out: DNode[] = [];
  const visit = (n: DNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
    for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

/** Recompute parent pointers from children lists. */
export function relink(root: DNode): DNode[] {
  const nodes = collectNodes(root);
  for (const n of nodes) n.parents = [];
  for (const n of nodes) for (const c of n.children) c.parents.push(n);
  return nodes;
}
