import type { DNode } from './model';

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
