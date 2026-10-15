import type { DNode, DTree } from './model';
import type { Runs } from './richtext';

/** Inline markup for runs (inverse of parseRich, as far as possible). */
export function runsToMarkup(runs: Runs, label: boolean): string {
  let out = '';
  for (const r of runs) {
    let t = r.text.replace(/([[\]{}|#%\\"*~$&])/g, '\\$1');
    if (label) t = t.replace(/\s/g, '~').replace(/([@;])/g, '\\$1');
    if (r.b) t = `**${t}**`;
    if (r.i) t = `*${t}*`;
    if (r.s) t = `~~${t}~~`;
    if (r.sub || r.sup) out += (r.sub ? '_' : '^') + (/^[\p{L}\p{N}]+$/u.test(t) ? t : `{${t}}`);
    else out += r.sc ? t.toUpperCase() : t;
  }
  return out;
}

/** Bracket notation of the tree as displayed (after X-bar processing). */
export function serialize(tree: DTree): string {
  const seen = new Set<DNode>();
  const ids = new Map<DNode, string>();
  let k = 0;
  for (const n of tree.nodes) if (n.parents.length > 1) ids.set(n, n.id ?? `m${++k}`);
  const go = (n: DNode, indent: string): string => {
    if (n.kind === 'leaf') {
      let s = runsToMarkup(n.label, false);
      if (n.copy) s = `<${s}>`;
      for (const g of n.gloss ?? []) s += ' | ' + runsToMarkup(g, false);
      return s;
    }
    if (seen.has(n) && ids.has(n)) return '#' + ids.get(n);
    seen.add(n);
    let head = runsToMarkup(n.label, true);
    if (n.copy && n.trace) head = `<${head}>`;
    if (ids.has(n)) head += '#' + ids.get(n);
    const parts: string[] = [];
    if (n.features?.length) parts.push(`{${n.features.map((f) => runsToMarkup(f, false)).join(', ')}}`);
    if (n.triangle) parts.push('^' + n.children.filter((c) => c.kind === 'leaf').map((c) => go(c, '')).join(' '));
    const kids = n.triangle ? n.children.filter((c) => c.kind !== 'leaf') : n.children;
    const simple = kids.every((c) => c.kind === 'leaf' || c.children.length === 0 || (c.children.length === 1 && c.children[0].kind === 'leaf'));
    const childStr = kids.map((c) => go(c, indent + '  '));
    if (simple) parts.push(...childStr);
    const body = simple ? parts.join(' ') : [...parts, ...childStr.map((c) => '\n' + indent + '  ' + c)].join(' ');
    return `[${head}${body ? ' ' + body : ''}]`;
  };
  return go(tree.root, '');
}
