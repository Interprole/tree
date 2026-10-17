import * as A from './actions';
import { askOverride } from './ask';
import type { BuildOptions } from './core/build';
import * as E from './core/edits';
import { walkAst } from './core/parser';
import type { TreeStyle } from './core/style';
import { activeId, appearanceScope, build, canvasSettings, doc, mergeBuild, setBuild, setStyle, source, style, trees } from './state';

/**
 * Appearance for one tree or for the whole canvas. A setting for many that meets values of their
 * own below it (trees with their own value, nodes or arrows with their own colour, width, arrow
 * visibility) asks whether to replace them (see ask.ts).
 */

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const NAMES: Partial<Record<string, string>> = {
  lineColor: 'line colour',
  lineWidth: 'line width',
  nodeColor: 'label colour',
  leafColor: 'word colour',
  arrowColor: 'arrow colour',
  semColor: 'meaning colour',
  semComputedColor: 'meaning colour',
  font: 'font',
  fontSize: 'font size',
  chainArrows: 'arrows for phrasal movement',
  headArrows: 'arrows for head movement',
  chains: 'chain view',
  copyStyle: 'look of silent copies',
};
const nameOf = (k: string) => NAMES[k] ?? k.replace(/([A-Z])/g, ' $1').toLowerCase();

/** paths of the leaves of a (nested) patch: ['xbar', 'bar'] */
function paths(p: object, pre: string[] = []): string[][] {
  const out: string[][] = [];
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...paths(v, [...pre, k]));
    else out.push([...pre, k]);
  }
  return out;
}
const get = (o: unknown, path: string[]) => path.reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
const patchOf = (path: string[], v: unknown): Record<string, unknown> => (path.length === 1 ? { [path[0]]: v } : { [path[0]]: patchOf(path.slice(1), v) });

/** Change appearance settings (style) for the tree or the canvas. */
export function applyStyle(p: Partial<TreeStyle>) {
  if (appearanceScope.value === 'canvas') return applyCanvas('style', p);
  setStyle(p);
  for (const k of Object.keys(p)) void elementOverrides(k);
}

/** Change build settings (labelling, chains, arrows, semantics) for the tree or the canvas. */
export function applyBuild(p: DeepPartial<BuildOptions>) {
  if (appearanceScope.value === 'canvas') return applyCanvas('build', p);
  setBuild(p);
  for (const path of paths(p)) void elementOverrides(path.join('.'));
}

/** a canvas setting: every tree that had the canvas value follows; trees with their own are asked about */
function applyCanvas(kind: 'style' | 'build', p: object) {
  const old = canvasSettings.value[kind] as unknown as object;
  const next = kind === 'style' ? { ...canvasSettings.value.style, ...p } : mergeBuild(canvasSettings.value.build, p as DeepPartial<BuildOptions>);
  canvasSettings.value = { ...canvasSettings.value, [kind]: next };
  for (const path of paths(p)) {
    const was = get(old, path);
    const value = get(p, path);
    const valueOf = (id: string) => get(id === activeId.value ? (kind === 'style' ? style.value : build.value) : trees.value.find((e) => e.id === id)![kind], path);
    const follow = trees.value.filter((e) => valueOf(e.id) === was).map((e) => e.id);
    const own = trees.value.filter((e) => valueOf(e.id) !== was && valueOf(e.id) !== value).map((e) => e.id);
    const set = (ids: string[]) => {
      const part = patchOf(path, value);
      for (const id of ids) {
        if (id === activeId.value) {
          if (kind === 'style') setStyle(part as Partial<TreeStyle>);
          else setBuild(part as DeepPartial<BuildOptions>);
        } else
          trees.value = trees.value.map((e) =>
            e.id !== id ? e : kind === 'style' ? { ...e, style: { ...e.style, ...(part as Partial<TreeStyle>) } } : { ...e, build: mergeBuild(e.build, part as DeepPartial<BuildOptions>) },
          );
      }
    };
    set(follow);
    if (own.length) {
      const names = own.map((id) => trees.value.find((e) => e.id === id)!.name).join(', ');
      void askOverride(`canvas:${path.join('.')}`, `${own.length === 1 ? names + ' has' : `${own.length} trees (${names}) have`} their own ${nameOf(path[path.length - 1])}. Replace it with the new one?`).then((yes) => yes && set(own));
    }
  }
}

/* ------------------------------------------------------------ values written on nodes and arrows */

/** the code changes that remove the element values a tree setting stands for */
function overridesFor(key: string): E.TextChange[] {
  const d = doc.value;
  if (!d?.root) return [];
  const src = source.value;
  const out: E.TextChange[] = [];
  const opt = (name: 'edge' | 'width' | 'sem') => walkAst(d.root!, (n) => void (n.opts?.[name] && out.push(...E.setOption(n, name, null).changes)));
  switch (key) {
    case 'lineColor':
      opt('edge');
      break;
    case 'lineWidth':
      opt('width');
      break;
    case 'semColor':
    case 'semComputedColor':
      opt('sem');
      break;
    case 'nodeColor':
    case 'leafColor':
      walkAst(d.root, (n) => {
        if (n.color || n.branchColor) out.push({ from: n.labelSpan.to, to: n.headerSpan.to, insert: E.modifiers({ id: n.id, pronounce: n.pronounce, opts: n.opts }) });
      });
      break;
    case 'arrowColor':
      for (const a of d.arrows) if (a.color) out.push(...E.updateArrow(a, { color: undefined }).changes);
      break;
    case 'chainArrows':
    case 'headArrows': {
      const chain = key === 'chainArrows';
      for (const a of d.arrows) {
        if (a.plain || !(a.hidden || a.visible)) continue;
        const isChain = a.from === a.to && !!a.fromOcc;
        if (isChain !== chain) continue;
        out.push(...E.updateArrow(a, { hidden: undefined, visible: undefined }).changes);
      }
      break;
    }
  }
  void src;
  return out;
}

const ELEMENT_NAMES: Record<string, string> = {
  lineColor: 'edges with their own colour (;edge=)',
  lineWidth: 'edges with their own width (;width=)',
  semColor: 'meanings with their own colour (;sem=)',
  semComputedColor: 'meanings with their own colour (;sem=)',
  nodeColor: 'nodes with their own colour (@…)',
  leafColor: 'nodes with their own colour (@…)',
  arrowColor: 'arrows with their own colour',
  chainArrows: 'arrows of phrasal movement shown or hidden one by one (visible / hide)',
  headArrows: 'arrows of head movement shown or hidden one by one (visible / hide)',
};

/** a tree setting changed: nodes or arrows with their own value are asked about */
async function elementOverrides(key: string) {
  if (!ELEMENT_NAMES[key]) return;
  const changes = overridesFor(key);
  if (!changes.length) return;
  const yes = await askOverride(`tree:${key}`, `This tree has ${changes.length} ${ELEMENT_NAMES[key]}. Replace them with the new ${nameOf(key)}?`);
  if (!yes) return;
  const again = overridesFor(key);
  if (again.length) A.applyEdit({ changes: again });
}
