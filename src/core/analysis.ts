import { analyseLabel } from './modes';
import type { DNode, DTree } from './model';
import { baseText, plain } from './richtext';

/** Everything a node dominates (multidominance: via any path). */
export function dominated(n: DNode): Set<DNode> {
  const out = new Set<DNode>();
  const visit = (x: DNode) => {
    for (const c of x.children) {
      if (!out.has(c)) {
        out.add(c);
        visit(c);
      }
    }
  };
  visit(n);
  return out;
}

/**
 * C-command domain: A c-commands B iff A does not dominate B, B ≠ A, and the first branching node
 * dominating A dominates B. With several mothers the domains of all positions are united.
 */
export function cCommandDomain(a: DNode): Set<DNode> {
  const out = new Set<DNode>();
  const own = dominated(a);
  const visit = (x: DNode) => {
    // climb through non-branching mothers
    if (x.children.length < 2 && x.parents.length) {
      for (const p of x.parents) visit(p);
      return;
    }
    for (const d of dominated(x)) if (d !== a && !own.has(d)) out.add(d);
  };
  for (const p of a.parents) visit(p);
  return out;
}

export function cCommands(a: DNode, b: DNode): boolean {
  return cCommandDomain(a).has(b);
}

const ANAPHORS = new Set([
  'himself', 'herself', 'itself', 'themselves', 'myself', 'yourself', 'ourselves', 'yourselves', 'oneself', 'themself',
  'each other', 'one another', 'себя', 'себе', 'собой', 'собою', 'друг друга', 'друг другу', 'друг с другом', 'sich', 'zich', 'zichzelf', 'se', 'si', 'soi',
]);
const PRONOUNS = new Set([
  'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your',
  'он', 'его', 'ему', 'им', 'нём', 'нем', 'него', 'нему', 'ним', 'она', 'её', 'ее', 'ей', 'ней', 'неё', 'нее', 'ею', 'оно', 'они', 'их', 'ими', 'них', 'ним', 'ними',
  'er', 'ihn', 'ihm', 'sie', 'ihr', 'il', 'elle', 'lui', 'le', 'la', 'les', 'leur', 'pro',
]);

export type NominalType = 'anaphor' | 'pronoun' | 'r-expression';

export interface BindingResult {
  node: DNode;
  type: NominalType;
  principle: 'A' | 'B' | 'C';
  ok: boolean;
  /** coindexed c-commanding node (if any) */
  binder?: DNode;
  /** the binding domain used */
  domain?: DNode;
  index: string;
}

function yieldText(n: DNode): string {
  if (n.kind === 'leaf') return baseText(n.label);
  return n.children.map(yieldText).join(' ');
}

export function nominalType(n: DNode): NominalType {
  const t = yieldText(n).toLowerCase().replace(/\s+/g, ' ').trim();
  if (ANAPHORS.has(t)) return 'anaphor';
  if (PRONOUNS.has(t)) return 'pronoun';
  return 'r-expression';
}

const CLAUSE = new Set(['T', 'I', 'Infl', 'S', 'IP', 'TP']);

/** Minimal clause (TP/IP/S) containing n. */
export function bindingDomain(n: DNode, root: DNode): DNode {
  let best: DNode = root;
  let bestSize = Infinity;
  const all = [root, ...dominated(root)];
  for (const x of all) {
    if (x.kind !== 'phrase') continue;
    const { cat, level } = analyseLabel(x.label);
    const lab = plain(x.label).trim();
    const isClause = (CLAUSE.has(cat) && level === 'P') || lab === 'S';
    if (!isClause) continue;
    const dom = dominated(x);
    if (dom.has(n) && dom.size < bestSize) {
      best = x;
      bestSize = dom.size;
    }
  }
  return best;
}

/** Check Principles A, B and C for all coindexed nominals (traces and copies are skipped). */
export function checkBinding(tree: DTree): BindingResult[] {
  const items = tree.nodes.filter((n) => n.indices.length > 0 && !n.trace && !n.copy);
  const results: BindingResult[] = [];
  for (const x of items) {
    const type = nominalType(x);
    for (const index of x.indices) {
      const binders = items.filter((y) => y !== x && y.indices.includes(index) && cCommands(y, x));
      const domain = bindingDomain(x, tree.root);
      const inDomain = dominated(domain);
      const local = binders.find((y) => inDomain.has(y));
      let r: BindingResult;
      if (type === 'anaphor') r = { node: x, type, principle: 'A', ok: !!local, binder: local, domain, index };
      else if (type === 'pronoun') r = { node: x, type, principle: 'B', ok: !local, binder: local, domain, index };
      else r = { node: x, type, principle: 'C', ok: binders.length === 0, binder: binders[0], domain, index };
      results.push(r);
    }
  }
  return results;
}
