import { buildTree, defaultBuildOptions } from './build';
import type { BuildOptions } from './build';
import type { Measure } from './measure';
import type { DTree } from './model';
import { parse } from './parser';
import type { ParseError, ADoc } from './ast';
import { buildScene } from './scene';
import type { Scene } from './scene';
import { defaultStyle } from './style';
import type { TreeStyle } from './style';

export interface RenderResult {
  doc: ADoc | null;
  tree: DTree | null;
  scene: Scene | null;
  error: ParseError | null;
}

/** Text → picture. */
export function renderSource(src: string, build: BuildOptions = defaultBuildOptions, style: TreeStyle = defaultStyle, measure: Measure): RenderResult {
  const r = parse(src);
  if (!r.ok) return { doc: null, tree: null, scene: null, error: r.error };
  const tree = buildTree(r.doc, build);
  if (!tree) return { doc: r.doc, tree: null, scene: null, error: null };
  return { doc: r.doc, tree, scene: buildScene(tree, style, measure), error: null };
}
