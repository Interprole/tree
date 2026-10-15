import { buildTree, defaultBuildOptions } from '../src/core/build';
import type { BuildOptions } from '../src/core/build';
import { approxMeasure } from '../src/core/measure';
import { parse } from '../src/core/parser';
import { layoutTree } from '../src/core/layout';
import { defaultStyle } from '../src/core/style';
import type { TreeStyle } from '../src/core/style';
import type { DTree } from '../src/core/model';
import { plain } from '../src/core/richtext';

export function opts(o: Partial<BuildOptions> = {}): BuildOptions {
  return { ...defaultBuildOptions, ...o, xbar: { ...defaultBuildOptions.xbar, ...(o.xbar ?? {}) }, semantics: { ...defaultBuildOptions.semantics, ...(o.semantics ?? {}) } };
}

export function tree(src: string, o: Partial<BuildOptions> = {}): DTree {
  const r = parse(src);
  if (!r.ok) throw new Error(r.error.message);
  return buildTree(r.doc, opts(o))!;
}

export function layout(src: string, o: Partial<BuildOptions> = {}, style: Partial<TreeStyle> = {}) {
  const t = tree(src, o);
  return { t, l: layoutTree(t, { ...defaultStyle, ...style }, approxMeasure) };
}

/** bracket string of the display tree, for compact assertions */
export function show(t: DTree): string {
  const seen = new Set();
  const go = (n: DTree['root']): string => {
    if (n.kind === 'leaf') return plain(n.label);
    if (seen.has(n) && n.id) return '#' + n.id;
    seen.add(n);
    const lab = plain(n.label);
    return '[' + lab + (n.children.length ? ' ' + n.children.map(go).join(' ') : '') + ']';
  };
  return go(t.root);
}
