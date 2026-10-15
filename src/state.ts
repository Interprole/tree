import { batch, computed, effect, signal } from '@preact/signals';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { ADoc, ParseError } from './core/ast';
import { buildTree, defaultBuildOptions } from './core/build';
import type { BuildOptions } from './core/build';
import { approxMeasure, canvasMeasure } from './core/measure';
import type { Measure } from './core/measure';
import type { DTree } from './core/model';
import { parse } from './core/parser';
import { buildScene } from './core/scene';
import type { Scene } from './core/scene';
import { defaultStyle, fontCss } from './core/style';
import type { TreeStyle } from './core/style';
import { examples } from './examples';
import type { Example } from './examples';
import { loadFont } from './fonts';

/* ------------------------------------------------------------ settings */

export const source = signal<string>('');
export const build = signal<BuildOptions>(defaultBuildOptions);
export const style = signal<TreeStyle>(defaultStyle);

export type Theme = 'auto' | 'light' | 'dark';
export type Tool = 'select' | 'arrow' | 'ccommand' | 'dominance';
export type Selection = { kind: 'node'; key: string } | { kind: 'arrow'; index: number } | null;

export const theme = signal<Theme>('auto');
export const tool = signal<Tool>('select');
export const selection = signal<Selection>(null);
/** first click of the arrow tool */
export const arrowSource = signal<string | null>(null);
/** node whose c-command / dominance is shown */
export const relationOf = signal<string | null>(null);
/** picking an existing constituent on the canvas to add it again (a new chain position) */
export const pick = signal<null | { kind: 'daughter' | 'sister'; key: string }>(null);
export const panelOpen = signal(false);
export type Modal = null | 'export' | 'trees' | 'help' | 'shortcuts';
export const modal = signal<Modal>(null);
export const mobileTab = signal<'code' | 'tree' | 'settings'>('tree');
export const toast = signal<{ text: string; id: number } | null>(null);
export const fontEpoch = signal(0);
/** live preview while an arrow's bend handle is dragged */
export const bendOverride = signal<{ index: number; bend: [number, number] } | null>(null);
/** incremented when a different tree is loaded: the canvas re-fits */
export const fitRequest = signal(0);
/** name of the tree in "my trees" that is being edited */
export const currentName = signal<string | null>(null);

let toastId = 0;
export function showToast(text: string) {
  const id = ++toastId;
  toast.value = { text, id };
  setTimeout(() => {
    if (toast.value?.id === id) toast.value = null;
  }, 2600);
}

/* ------------------------------------------------------------ derived */

export const parsed = computed(() => parse(source.value));
export const error = computed<ParseError | null>(() => (parsed.value.ok ? null : parsed.value.error));

/** last document that parsed: the canvas keeps showing it while the text has an error */
const lastGoodDoc = signal<ADoc | null>(null);
effect(() => {
  const r = parsed.value;
  if (r.ok) lastGoodDoc.value = r.doc;
});
export const doc = computed(() => lastGoodDoc.value);
/** canvas edits are only possible when the text currently parses */
export const editable = computed(() => parsed.value.ok);

let measure: Measure = approxMeasure;
function currentMeasure(): Measure {
  if (typeof document === 'undefined') return approxMeasure;
  if (measure === approxMeasure) measure = canvasMeasure((f) => fontCss(f));
  return measure;
}

export const tree = computed<DTree | null>(() => {
  const d = doc.value;
  if (!d) return null;
  try {
    return buildTree(d, build.value);
  } catch (e) {
    console.error(e);
    return null;
  }
});

export const scene = computed<Scene | null>(() => {
  void fontEpoch.value;
  let t = tree.value;
  if (!t) return null;
  const o = bendOverride.value;
  if (o) t = { ...t, arrows: t.arrows.map((a, i) => (i === o.index ? { ...a, bend: o.bend } : a)) };
  try {
    return buildScene(t, style.value, currentMeasure());
  } catch (e) {
    console.error(e);
    return null;
  }
});

// reload measurements when the font changes
let loadedFont = '';
effect(() => {
  const f = style.value.font;
  if (f === loadedFont || typeof document === 'undefined') return;
  loadedFont = f;
  loadFont(f).then(() => {
    measure = canvasMeasure((x) => fontCss(x));
    fontEpoch.value++;
  });
});

/* ------------------------------------------------------------ settings helpers */

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function mergeBuild(base: BuildOptions, p: DeepPartial<BuildOptions> | undefined): BuildOptions {
  if (!p) return base;
  const known = Object.fromEntries(Object.entries(p).filter(([k]) => k in base)) as Partial<BuildOptions>;
  if ((known.mode as string) === 'bps') known.mode = 'manual';
  return {
    ...base,
    ...known,
    xbar: { ...base.xbar, ...(p.xbar ?? {}) },
    semantics: { ...base.semantics, ...(p.semantics ?? {}) },
  };
}

export function setBuild(p: DeepPartial<BuildOptions>) {
  build.value = mergeBuild(build.value, p);
}

export function setStyle(p: Partial<TreeStyle>) {
  style.value = { ...style.value, ...p };
}

/** differences from defaults (keeps links short) */
function diff<T extends object>(cur: T, def: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(cur) as (keyof T)[]) {
    const a = cur[k];
    const b = def[k];
    if (a && typeof a === 'object') {
      const d = diff(a as object, b as object);
      if (Object.keys(d).length) (out as Record<string, unknown>)[k as string] = d;
    } else if (a !== b) out[k] = a;
  }
  return out;
}

export interface Snapshot {
  s: string;
  b?: DeepPartial<BuildOptions>;
  st?: Partial<TreeStyle>;
}

export function snapshot(): Snapshot {
  const snap: Snapshot = { s: source.value };
  const b = diff(build.value, defaultBuildOptions);
  const st = diff(style.value, defaultStyle);
  if (Object.keys(b).length) snap.b = b as DeepPartial<BuildOptions>;
  if (Object.keys(st).length) snap.st = st;
  return snap;
}

export function restore(snap: Snapshot) {
  batch(() => {
    source.value = snap.s ?? '';
    build.value = mergeBuild(defaultBuildOptions, snap.b);
    style.value = { ...defaultStyle, ...(snap.st ?? {}) };
    selection.value = null;
    relationOf.value = null;
    fitRequest.value++;
  });
}

export function loadExample(ex: Example) {
  restore({ s: ex.src, b: ex.build, st: ex.style });
  currentName.value = null;
}

/* ------------------------------------------------------------ share links */

export function shareUrl(): string {
  const data = compressToEncodedURIComponent(JSON.stringify(snapshot()));
  const u = new URL(location.href);
  u.hash = 't=' + data;
  return u.toString();
}

export function readHash(): Snapshot | null {
  const m = /[#&]t=([^&]+)/.exec(location.hash);
  if (!m) return null;
  try {
    const json = decompressFromEncodedURIComponent(m[1]);
    if (!json) return null;
    const snap = JSON.parse(json) as Snapshot;
    return typeof snap.s === 'string' ? snap : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ local storage */

const CURRENT = 'nanotrees:current';
const TREES = 'nanotrees:trees';

export interface SavedTree {
  id: string;
  name: string;
  savedAt: number;
  snap: Snapshot;
}

function lsGet<T>(k: string): T | null {
  try {
    // trees saved under the app's earlier name
    const v = localStorage.getItem(k) ?? localStorage.getItem(k.replace(/^nanotrees:/, 'treeform:'));
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* quota or disabled */
  }
}

export const savedTrees = signal<SavedTree[]>(lsGet<SavedTree[]>(TREES) ?? []);
effect(() => lsSet(TREES, savedTrees.value));

export function saveTree(name: string) {
  const list = savedTrees.value.filter((x) => x.name !== name);
  savedTrees.value = [{ id: Math.random().toString(36).slice(2, 10), name, savedAt: Date.now(), snap: snapshot() }, ...list];
  currentName.value = name;
}

export function deleteTree(id: string) {
  savedTrees.value = savedTrees.value.filter((x) => x.id !== id);
}

export function openTree(tr: SavedTree) {
  restore(tr.snap);
  currentName.value = tr.name;
}

/** Initial state: link > autosave > first example. Then autosave on every change. */
export function initState(): 'link' | 'autosave' | 'example' {
  const fromLink = readHash();
  let origin: 'link' | 'autosave' | 'example';
  if (fromLink) {
    restore(fromLink);
    origin = 'link';
  } else {
    const auto = lsGet<{ snap: Snapshot; name: string | null }>(CURRENT);
    if (auto?.snap && auto.snap.s.trim()) {
      restore(auto.snap);
      currentName.value = auto.name;
      origin = 'autosave';
    } else {
      loadExample(examples[0]);
      origin = 'example';
    }
  }
  const th = lsGet<Theme>('nanotrees:theme');
  if (th) theme.value = th;
  let timer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const snap = snapshot();
    const name = currentName.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      lsSet(CURRENT, { snap, name });
      // keep "my trees" entry in sync when editing a saved tree
      if (name) {
        const i = savedTrees.value.findIndex((x) => x.name === name);
        if (i >= 0 && JSON.stringify(savedTrees.value[i].snap) !== JSON.stringify(snap)) {
          const copy = [...savedTrees.value];
          copy[i] = { ...copy[i], snap, savedAt: Date.now() };
          savedTrees.value = copy;
        }
      }
    }, 400);
  });
  effect(() => lsSet('nanotrees:theme', theme.value));
  return origin;
}
