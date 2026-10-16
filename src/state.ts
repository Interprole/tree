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
export type Selection =
  | { kind: 'node'; key: string }
  | { kind: 'arrow'; index: number }
  /** a note of a node or a label of an arrow */
  | { kind: 'label'; label: 'note' | 'arrow'; owner: string | number; index: number }
  | null;

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
/** live preview while an arrow's bend handle or one of its bend points is dragged */
export const bendOverride = signal<{ index: number; bend?: [number, number]; via?: [number, number][] } | null>(null);
/** ask the edit panel to focus the label field of a node (after a double-click, Enter or a new node) */
export const focusLabel = signal<{ key: string; id: number } | null>(null);
let focusId = 0;
export function requestLabelFocus(key: string) {
  focusLabel.value = { key, id: ++focusId };
}
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
  if (o) t = { ...t, arrows: t.arrows.map((a, i) => (i === o.index ? { ...a, ...(o.bend ? { bend: o.bend } : {}), ...(o.via ? { via: o.via } : {}) } : a)) };
  try {
    return buildScene(t, style.value, currentMeasure());
  } catch (e) {
    console.error(e);
    return null;
  }
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

/* ------------------------------------------------------------ several trees on one canvas */

/**
 * The canvas holds several trees. Each has its own code, settings and place on the canvas. A
 * linked copy shares the code of another tree (srcId): editing one changes both, while settings
 * (e.g. copies vs traces, colours) stay separate. The active tree is the one in the code editor;
 * its live state is in source / build / style.
 */
export interface TreeEntry {
  id: string;
  name: string;
  /** key into sources: linked copies share it */
  srcId: string;
  build: BuildOptions;
  style: TreeStyle;
  /** top-left corner of the tree's sheet on the canvas */
  x: number;
  y: number;
}

const newId = () => Math.random().toString(36).slice(2, 9);

export const trees = signal<TreeEntry[]>([{ id: 't1', name: 'Tree 1', srcId: 's1', build: defaultBuildOptions, style: defaultStyle, x: 0, y: 0 }]);
export const sources = signal<Record<string, string>>({ s1: '' });
export const activeId = signal('t1');
export const activeTree = computed(() => trees.value.find((e) => e.id === activeId.value) ?? trees.value[0]);
/** trees whose code is shared with another tree */
export const linkedIds = computed(() => {
  const count = new Map<string, number>();
  for (const e of trees.value) count.set(e.srcId, (count.get(e.srcId) ?? 0) + 1);
  return new Set(trees.value.filter((e) => count.get(e.srcId)! > 1).map((e) => e.id));
});

// the active tree's live state is written back into the workspace (linked copies follow at once)
effect(() => {
  const s = source.value;
  const b = build.value;
  const st = style.value;
  const id = activeId.peek();
  const list = trees.peek();
  const e = list.find((x) => x.id === id);
  if (!e) return;
  if (e.build !== b || e.style !== st) trees.value = list.map((x) => (x.id === id ? { ...x, build: b, style: st } : x));
  if (sources.peek()[e.srcId] !== s) sources.value = { ...sources.peek(), [e.srcId]: s };
});

/** Make another tree the active one: its code goes into the editor, its settings into the panel. */
export function activateTree(id: string) {
  const e = trees.value.find((x) => x.id === id);
  if (!e || id === activeId.value) return;
  batch(() => {
    activeId.value = id;
    source.value = sources.value[e.srcId] ?? '';
    build.value = e.build;
    style.value = e.style;
    selection.value = null;
    relationOf.value = null;
    arrowSource.value = null;
    pick.value = null;
  });
}

/** Scenes of the other trees (cached: a tree is recomputed only when its code or settings change). */
const sceneCache = new Map<string, { key: string; scene: Scene | null }>();
export const otherScenes = computed(() => {
  void fontEpoch.value;
  const src = sources.value;
  const out: { entry: TreeEntry; scene: Scene | null }[] = [];
  for (const e of trees.value) {
    if (e.id === activeId.value) continue;
    const text = src[e.srcId] ?? '';
    const key = `${fontEpoch.peek()}\u0000${text}\u0000${JSON.stringify(e.build)}\u0000${JSON.stringify(e.style)}`;
    let c = sceneCache.get(e.id);
    if (!c || c.key !== key) {
      let sc: Scene | null = c?.scene ?? null;
      const r = parse(text);
      if (r.ok) {
        try {
          const t = buildTree(r.doc, e.build);
          sc = t ? buildScene(t, e.style, currentMeasure()) : null;
        } catch (err) {
          console.error(err);
        }
      }
      c = { key, scene: sc };
      sceneCache.set(e.id, c);
    }
    out.push({ entry: e, scene: c.scene });
  }
  return out;
});

/** Size of a tree's sheet. */
export function sheetSize(id: string): { w: number; h: number } {
  const sc = id === activeId.value ? scene.value : otherScenes.value.find((o) => o.entry.id === id)?.scene;
  return { w: sc?.width ?? 200, h: sc?.height ?? 120 };
}

/** a free place to the right of all trees */
function freeSpot(): { x: number; y: number } {
  let x = -Infinity;
  let y = Infinity;
  for (const e of trees.value) {
    x = Math.max(x, e.x + sheetSize(e.id).w);
    y = Math.min(y, e.y);
  }
  return { x: (Number.isFinite(x) ? x : 0) + 48, y: Number.isFinite(y) ? y : 0 };
}

function nextName(base: string): string {
  const names = new Set(trees.value.map((e) => e.name));
  if (!names.has(base)) return base;
  for (let k = 2; ; k++) if (!names.has(`${base} ${k}`)) return `${base} ${k}`;
}

export function addTree(text = '[S [NP] [VP]]') {
  const srcId = newId();
  const e: TreeEntry = { id: newId(), name: nextName(`Tree ${trees.value.length + 1}`), srcId, build: build.value, style: style.value, ...freeSpot() };
  batch(() => {
    sources.value = { ...sources.value, [srcId]: text };
    trees.value = [...trees.value, e];
  });
  activateTree(e.id);
}

/** A copy of a tree next to it: independent (its own code) or linked (the same code). */
export function duplicateTree(id: string, linked: boolean) {
  const e = trees.value.find((x) => x.id === id);
  if (!e) return;
  const srcId = linked ? e.srcId : newId();
  const copy: TreeEntry = { ...e, id: newId(), srcId, name: nextName(`${e.name} (${linked ? 'linked' : 'copy'})`), ...freeSpot() };
  batch(() => {
    if (!linked) sources.value = { ...sources.value, [srcId]: sources.value[e.srcId] ?? '' };
    trees.value = [...trees.value, copy];
  });
  activateTree(copy.id);
}

/** A linked copy gets its own code: later edits no longer reach the other trees. */
export function unlinkTree(id: string) {
  const e = trees.value.find((x) => x.id === id);
  if (!e) return;
  const srcId = newId();
  batch(() => {
    sources.value = { ...sources.value, [srcId]: sources.value[e.srcId] ?? '' };
    trees.value = trees.value.map((x) => (x.id === id ? { ...x, srcId } : x));
  });
}

/** Link a tree to another one: it takes over that tree's code. */
export function linkTree(id: string, to: string) {
  const target = trees.value.find((x) => x.id === to);
  if (!target || id === to) return;
  batch(() => {
    trees.value = trees.value.map((x) => (x.id === id ? { ...x, srcId: target.srcId } : x));
    if (id === activeId.value) source.value = sources.value[target.srcId] ?? '';
  });
  pruneSources();
}

export function removeTree(id: string) {
  if (trees.value.length < 2) return;
  const i = trees.value.findIndex((x) => x.id === id);
  if (id === activeId.value) activateTree(trees.value[i === 0 ? 1 : i - 1].id);
  trees.value = trees.value.filter((x) => x.id !== id);
  pruneSources();
}

export function renameTree(id: string, name: string) {
  trees.value = trees.value.map((x) => (x.id === id ? { ...x, name: name.trim() || x.name } : x));
}

export function moveTree(id: string, x: number, y: number) {
  trees.value = trees.value.map((e) => (e.id === id ? { ...e, x: Math.round(x), y: Math.round(y) } : e));
}

function pruneSources() {
  const used = new Set(trees.value.map((e) => e.srcId));
  const next = Object.fromEntries(Object.entries(sources.value).filter(([k]) => used.has(k)));
  if (Object.keys(next).length !== Object.keys(sources.value).length) sources.value = next;
}

// reload measurements when a font is needed (the active tree's or another tree's on the canvas)
const loadedFonts = new Set<string>();
effect(() => {
  if (typeof document === 'undefined') return;
  const fonts = new Set([style.value.font, ...trees.value.map((e) => e.style.font)]);
  for (const f of fonts) {
    if (loadedFonts.has(f)) continue;
    loadedFonts.add(f);
    loadFont(f).then(() => {
      measure = canvasMeasure((x) => fontCss(x));
      fontEpoch.value++;
    });
  }
});

/* ------------------------------------------------------------ snapshots */

interface TreeSnap {
  id: string;
  name: string;
  src: string;
  b?: DeepPartial<BuildOptions>;
  st?: Partial<TreeStyle>;
  x: number;
  y: number;
}

export interface Snapshot {
  /** the active tree (all that older versions read) */
  s: string;
  b?: DeepPartial<BuildOptions>;
  st?: Partial<TreeStyle>;
  /** all trees of the canvas, when there are several */
  w?: { trees: TreeSnap[]; sources: Record<string, string>; active: string };
}

function diffs(b: BuildOptions, st: TreeStyle): { b?: DeepPartial<BuildOptions>; st?: Partial<TreeStyle> } {
  const out: { b?: DeepPartial<BuildOptions>; st?: Partial<TreeStyle> } = {};
  const db = diff(b, defaultBuildOptions);
  const ds = diff(st, defaultStyle);
  if (Object.keys(db).length) out.b = db as DeepPartial<BuildOptions>;
  if (Object.keys(ds).length) out.st = ds;
  return out;
}

/** The state of the canvas; full = with tree names and places even for a single tree (files). */
export function snapshot(full = false): Snapshot {
  const snap: Snapshot = { s: source.value, ...diffs(build.value, style.value) };
  if (full || trees.value.length > 1) {
    snap.w = {
      trees: trees.value.map((e) => ({ id: e.id, name: e.name, src: e.srcId, x: e.x, y: e.y, ...(e.id === activeId.value ? diffs(build.value, style.value) : diffs(e.build, e.style)) })),
      sources: { ...sources.value, [activeTree.value.srcId]: source.value },
      active: activeId.value,
    };
  }
  return snap;
}

export function restore(snap: Snapshot) {
  batch(() => {
    const w = snap.w;
    if (w && w.trees?.length) {
      trees.value = w.trees.map((e) => ({
        id: e.id,
        name: e.name,
        srcId: e.src,
        x: e.x ?? 0,
        y: e.y ?? 0,
        build: mergeBuild(defaultBuildOptions, e.b),
        style: { ...defaultStyle, ...(e.st ?? {}) },
      }));
      sources.value = { ...w.sources };
      const act = trees.value.find((e) => e.id === w.active) ?? trees.value[0];
      activeId.value = act.id;
      source.value = sources.value[act.srcId] ?? '';
      build.value = act.build;
      style.value = act.style;
    } else {
      const b = mergeBuild(defaultBuildOptions, snap.b);
      const st = { ...defaultStyle, ...(snap.st ?? {}) };
      trees.value = [{ id: 't1', name: 'Tree 1', srcId: 's1', build: b, style: st, x: 0, y: 0 }];
      sources.value = { s1: snap.s ?? '' };
      activeId.value = 't1';
      source.value = snap.s ?? '';
      build.value = b;
      style.value = st;
    }
    selection.value = null;
    relationOf.value = null;
    fitRequest.value++;
  });
}

/** An example goes into the active tree (which stops sharing its code with other trees). */
export function loadExample(ex: Example) {
  if (trees.value.length < 2) {
    restore({ s: ex.src, b: ex.build, st: ex.style });
    currentName.value = null;
    return;
  }
  const e = activeTree.value;
  if (linkedIds.value.has(e.id)) unlinkTree(e.id);
  batch(() => {
    source.value = ex.src;
    build.value = mergeBuild(defaultBuildOptions, ex.build);
    style.value = { ...defaultStyle, ...(ex.style ?? {}) };
    selection.value = null;
    fitRequest.value++;
  });
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

/** widths of the code pane and the settings pane (px; null = default), changed by dragging their borders */
export const paneWidths = signal<{ code: number | null; settings: number; inspector: number }>({ code: null, settings: 330, inspector: 300, ...(lsGet<object>('nanotrees:panes') ?? {}) });
effect(() => lsSet('nanotrees:panes', paneWidths.value));

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
