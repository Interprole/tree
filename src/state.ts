import { batch, computed, effect, signal } from '@preact/signals';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { ADoc, ParseError } from './core/ast';
import { buildTree, defaultBuildOptions } from './core/build';
import type { BuildOptions } from './core/build';
import { approxMeasure, canvasMeasure } from './core/measure';
import type { Measure } from './core/measure';
import type { DTree } from './core/model';
import { parse } from './core/parser';
import { formatDoc } from './core/format';
import { applyChanges, escapeLabel, setExpression } from './core/edits';
import { buildScene, buildSheetScene } from './core/scene';
import type { Scene } from './core/scene';
import { defaultStyle, fontCss } from './core/style';
import type { TreeStyle } from './core/style';
import { examples } from './examples';
import type { Example } from './examples';
import type { LexicalEntry, NSAlgorithm, NSAlgorithmSettings, DerivationStep } from './core/nanosyntax';
import { derivationDisplaySource, lexicalEntrySource, resolveNSAlgorithm } from './core/nanosyntax';
import { loadFont } from './fonts';

/* ------------------------------------------------------------ settings */

export const source = signal<string>('');
export const build = signal<BuildOptions>(defaultBuildOptions);
export const style = signal<TreeStyle>(defaultStyle);

export type Theme = 'auto' | 'light' | 'dark';
export type Tool = 'select' | 'arrow' | 'ccommand' | 'dominance';
export const customizeScope = signal<'element' | 'copies' | 'tree' | 'canvas'>('element');
export type Selection =
  | { kind: 'node'; key: string }
  | { kind: 'arrow'; index: number }
  | { kind: 'edge'; parent: string; child: string }
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
/** the right side panel: editing the selection, or the appearance settings */
export const sideTab = signal<'edit' | 'appearance' | 'nanosyntax'>('edit');
export const nanosyntaxEnabled = signal(false);
export const rightPanelOpen = signal(true);
/** Code belongs to a selected sheet or node, never a caption or the canvas background. */
export const codeSelection = signal(false);
export const lexicalAssignment = signal<string | null>(null);
export const groupAssignment = signal<string | null>(null);
export const treeTargetPick = signal<{ kind: 'lexical' | 'group' | 'group-member'; id: string } | null>(null);

export function toggleNanosyntax() {
  const enabled = !nanosyntaxEnabled.value;
  batch(() => {
    nanosyntaxEnabled.value = enabled;
    if (enabled) {
      rightPanelOpen.value = true;
      sideTab.value = 'nanosyntax';
      for (const entry of trees.value.filter((tree) => !tree.lexical && lexicalTreesFor('tree', tree.id).length)) makeRoomForLexicalCluster(entry.id);
    }
    else {
      if (sideTab.value === 'nanosyntax') sideTab.value = 'appearance';
      if (activeTree.value.lexical || activeTree.value.derivation) {
        const owner = nanosyntaxOwner();
        const target = !owner.lexical && !owner.derivation ? owner : trees.value.find((t) => !t.lexical && !t.derivation);
        if (target) activateTree(target.id);
      }
      lexicalAssignment.value = null;
      treeTargetPick.value = null;
      selection.value = null;
      codeSelection.value = false;
    }
    fitRequest.value++;
  });
}
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
/** Centre a particular sheet after selecting a derivation step. */
export const focusTreeRequest = signal<{ id: string } | null>(null);
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
    return buildTree(d, { ...build.value, lexicalTree: !!activeTree.value?.lexical });
  } catch (e) {
    console.error(e);
    return null;
  }
});

/** the picture as it was when an arrow's bend began to be dragged: the tree stays put meanwhile */
let dragFrom: Scene | null = null;
let lastScene: Scene | null = null;

export const scene = computed<Scene | null>(() => {
  void fontEpoch.value;
  let t = tree.value;
  if (!t) return null;
  const o = bendOverride.value;
  if (!o) dragFrom = null;
  else {
    dragFrom ??= lastScene;
    t = { ...t, arrows: t.arrows.map((a, i) => (i === o.index ? { ...a, ...(o.bend ? { bend: o.bend } : {}), ...(o.via ? { via: o.via } : {}) } : a)) };
  }
  try {
    if (o && dragFrom) return buildScene(t, dragFrom.style, currentMeasure(), undefined, dragFrom);
    return (lastScene = buildSheetScene(t, style.value, currentMeasure()));
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

/** what the Appearance panel sets: the tree being edited, or every tree of the canvas */
export const appearanceScope = signal<'tree' | 'canvas'>('tree');
/** the settings of the canvas: what every tree has unless it has its own */
export const canvasSettings = signal<{ build: BuildOptions; style: TreeStyle }>({ build: defaultBuildOptions, style: defaultStyle });
export const shownStyle = computed(() => (appearanceScope.value === 'canvas' ? canvasSettings.value.style : style.value));
export const shownBuild = computed(() => (appearanceScope.value === 'canvas' ? canvasSettings.value.build : build.value));

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
  lexicon?: LexicalEntry[];
  /** A live, editable lexical tree. Its pronunciation lives in its root Expression field. */
  lexical?: { entryId: string; scope: 'tree' | 'canvas'; owner?: string };
  /** Omitted fields inherit the canvas's nanosyntax settings. */
  nanosyntax?: Partial<NanosyntaxOptions>;
  derivation?: { group: string; step: number; action: DerivationStep['action']; title: string; detail: string; status: DerivationStep['status']; cycle: number };
}

export interface DerivationGroup {
  id: string;
  name: string;
  sourceTree: string;
  algorithm: NSAlgorithm;
  complete: boolean;
  unresolved: string[];
  warnings: string[];
  surface: string[];
  displayVersion?: number;
  /** Both visualisations of the same derivation, so the display option is reversible. */
  copyVariants?: { shown: string[]; hidden: string[] };
  hideLowerCopies?: boolean;
}
export const canvasLexicon = signal<LexicalEntry[]>([]);
export const derivationGroups = signal<DerivationGroup[]>([]);
export const nanosyntaxAlgorithm = signal<NSAlgorithm>('caha2025');
export interface NanosyntaxOptions { algorithm: NSAlgorithm; hideLowerCopies: boolean; rules?: Partial<NSAlgorithmSettings> }
export const canvasNanosyntaxOptions = signal<NanosyntaxOptions>({ algorithm: 'caha2025', hideLowerCopies: false });

const newId = () => Math.random().toString(36).slice(2, 9);

export const trees = signal<TreeEntry[]>([{ id: 't1', name: 'Tree 1', srcId: 's1', build: defaultBuildOptions, style: defaultStyle, x: 0, y: 0 }]);
export const sources = signal<Record<string, string>>({ s1: '' });
export const visibleTrees = computed(() => trees.value.filter((entry) => nanosyntaxEnabled.value || (!entry.lexical && !entry.derivation)));
export interface TreeGroup { id: string; name: string; members: string[]; nanosyntax?: boolean; step?: number }
export const treeGroups = signal<TreeGroup[]>([]);
export function createTreeGroup(members: string[], name = 'Group', nanosyntax = false, step?: number): string {
  const id = 'group' + newId();
  if (name === 'Group') {
    let index = 2;
    const names = new Set(treeGroups.value.map((group) => group.name));
    while (names.has(name)) name = 'Group ' + index++;
  }
  treeGroups.value = [...treeGroups.value, { id, name, members: [...new Set(members)], ...(nanosyntax ? { nanosyntax: true } : {}), ...(step ? { step } : {}) }];
  if (!nanosyntax) fitRequest.value++;
  return id;
}
export function addToTreeGroup(treeId: string, groupId: string) {
  const entry = trees.value.find((tree) => tree.id === treeId);
  const group = treeGroups.value.find((group) => group.id === groupId);
  const members = trees.value.filter((tree) => group?.members.includes(tree.id) && tree.id !== treeId);
  batch(() => {
    if (entry?.lexical?.scope === 'canvas' && members.length && !group?.members.includes(treeId)) {
      const x = Math.max(...members.map((tree) => tree.x + sheetSize(tree.id).w)) + 30;
      const y = Math.min(...members.map((tree) => tree.y));
      trees.value = trees.value.map((tree) => tree.id === treeId ? { ...tree, x, y } : tree);
    }
    treeGroups.value = treeGroups.value.map((group) => group.id === groupId ? { ...group, members: [...new Set([...group.members, treeId])] } : group);
  });
}
export function groupTrees(first: string, second: string) {
  const existing = treeGroups.value.find((group) => !group.nanosyntax && group.members.includes(second));
  if (existing) addToTreeGroup(first, existing.id);
  else createTreeGroup([second, first]);
}
export function removeFromTreeGroups(id: string) {
  treeGroups.value = treeGroups.value.map((group) => ({ ...group, members: group.members.filter((member) => member !== id) })).filter((group) => group.members.length > 1);
}
export function moveTreeGroup(id: string, dx: number, dy: number) {
  const group = treeGroups.value.find((entry) => entry.id === id);
  if (!group) return;
  const members = new Set(group.members);
  trees.value = trees.value.map((entry) => members.has(entry.id) || (entry.lexical?.owner && members.has(entry.lexical.owner)) ? { ...entry, x: Math.round(entry.x + dx), y: Math.round(entry.y + dy) } : entry);
}
export function treeGroupBounds() {
  const visible = new Set(visibleTrees.value.map((entry) => entry.id));
  return treeGroups.value.filter((group) => !group.nanosyntax || nanosyntaxEnabled.value).flatMap((group) => {
    const members = trees.value.filter((entry) => visible.has(entry.id) && (group.members.includes(entry.id) || (entry.lexical?.owner && group.members.includes(entry.lexical.owner))));
    if (!members.length) return [];
    const x = Math.min(...members.map((entry) => entry.x)) - 12;
    const y = Math.min(...members.map((entry) => entry.y)) - 54;
    return [{ group, x, y, w: Math.max(...members.map((entry) => entry.x + sheetSize(entry.id).w)) - x + 12, h: Math.max(...members.map((entry) => entry.y + sheetSize(entry.id).h)) - y + 12 }];
  });
}
export const activeId = signal('t1');
export const activeTree = computed(() => trees.value.find((e) => e.id === activeId.value) ?? trees.value[0]);
/** how many copies each linked branch has on the whole canvas */
export const linkCounts = computed(() => {
  const counts = new Map<string, number>();
  const act = activeTree.value;
  const src = sources.value;
  for (const k of new Set(trees.value.map((e) => e.srcId))) {
    const text = k === act.srcId ? source.value : src[k] ?? '';
    for (const m of text.matchAll(/;link=([^;\s[\]@#]+)/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
});

/** trees with a branch linked to another place (or sharing all their code with another tree) */
export const linkedIds = computed(() => {
  const count = new Map<string, number>();
  for (const e of trees.value) count.set(e.srcId, (count.get(e.srcId) ?? 0) + 1);
  const counts = linkCounts.value;
  const act = activeTree.value;
  return new Set(
    trees.value
      .filter((e) => {
        if (count.get(e.srcId)! > 1) return true;
        const text = e.id === act.id ? source.value : sources.value[e.srcId] ?? '';
        return [...text.matchAll(/;link=([^;\s[\]@#]+)/g)].some((m) => (counts.get(m[1]) ?? 0) > 1);
      })
      .map((e) => e.id),
  );
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
    codeSelection.value = false;
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
        sc = null;
        try {
          const t = buildTree(r.doc, { ...e.build, lexicalTree: !!e.lexical });
          sc = t ? buildSheetScene(t, e.style, currentMeasure()) : null;
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

/** the sheet of a tree without nodes */
export const EMPTY_SHEET = { w: 240, h: 130 };

/** Size of a tree's sheet. */
export function sheetSize(id: string): { w: number; h: number } {
  const sc = id === activeId.value ? scene.value : otherScenes.value.find((o) => o.entry.id === id)?.scene;
  return { w: sc?.width ?? EMPTY_SHEET.w, h: sc?.height ?? EMPTY_SHEET.h };
}

/** a free place to the right of all trees */
function freeSpot(): { x: number; y: number } {
  let x = -Infinity;
  let y = Infinity;
  for (const e of visibleTrees.value) {
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

export function addTree(text = '', at?: { x: number; y: number }) {
  const srcId = newId();
  const e: TreeEntry = { id: newId(), name: nextName(`Tree ${trees.value.length + 1}`), srcId, build: canvasSettings.value.build, style: canvasSettings.value.style, ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : freeSpot()) };
  batch(() => {
    sources.value = { ...sources.value, [srcId]: text };
    trees.value = [...trees.value, e];
  });
  activateTree(e.id);
  focusTreeRequest.value = { id: e.id };
  return e.id;
}

/** Source text for a sheet, including the active editor's most recent keystroke. */
export function lexicalTreeSource(treeOrId: TreeEntry | string): string {
  const e = typeof treeOrId === 'string' ? trees.value.find((t) => t.id === treeOrId) : treeOrId;
  return !e ? '' : e.id === activeId.value ? source.value : sources.value[e.srcId] ?? '';
}

export function lexicalTreeExpression(treeOrId: TreeEntry | string): string {
  const p = parse(lexicalTreeSource(treeOrId));
  if (!p.ok || !p.doc.root) return '';
  return p.doc.root.opts?.spell ?? p.doc.root.children.filter((c) => c.kind === 'leaf').map((c) => c.text).join(' ');
}

/** Words are phonology throughout a live visual L-tree, including inside its terminals. */
export function lexicalStructureSource(treeOrId: TreeEntry | string): string {
  const text = lexicalTreeSource(treeOrId);
  const p = parse(text);
  if (!p.ok || !p.doc.root) return text;
  const changes: { from: number; to: number; insert: string }[] = [];
  const visit = (n: import('./core/ast').ANode) => {
    for (const c of n.children) {
      if (c.kind === 'node') visit(c);
      else if (c.kind === 'leaf') changes.push({ from: c.fullSpan.from, to: c.fullSpan.to, insert: '' });
    }
  };
  visit(p.doc.root);
  return applyChanges(text, changes);
}

/** Old panel sources used bare tokens as syntactic heads. Make those heads visual nodes. */
export function prepareLexicalSource(text: string): string {
  const p = parse(text);
  if (!p.ok || !p.doc.root) return text;
  const changes: { from: number; to: number; insert: string }[] = [];
  const visit = (n: import('./core/ast').ANode) => {
    for (const c of n.children) {
      if (c.kind === 'node') visit(c);
      else if (c.kind === 'leaf' && c.text.trim() !== n.opts?.spell?.trim()) changes.push({ from: c.fullSpan.from, to: c.fullSpan.to, insert: c.text.trim().split(/\s+/).map((word) => '[' + escapeLabel(word) + ']').join(' ') });
    }
  };
  visit(p.doc.root);
  return applyChanges(text, changes);
}

export function lexicalTreesFor(scope: 'tree' | 'canvas', owner?: string): TreeEntry[] {
  return trees.value.filter((t) => t.lexical?.scope === scope && (scope === 'canvas' || t.lexical.owner === owner));
}

/** A derivation step uses the original S-tree's lexicon and option overrides. */
export function nanosyntaxOwner(treeOrId: TreeEntry | string = activeTree.value): TreeEntry {
  const e = typeof treeOrId === 'string' ? trees.value.find((t) => t.id === treeOrId) ?? activeTree.value : treeOrId;
  const owner = e.lexical?.owner ?? (e.derivation && derivationGroups.value.find((g) => g.id === e.derivation!.group)?.sourceTree);
  return trees.value.find((t) => t.id === owner && !t.lexical) ?? e;
}

export function effectiveNanosyntaxOptions(treeOrId: TreeEntry | string = activeTree.value): NanosyntaxOptions {
  const own = nanosyntaxOwner(treeOrId).nanosyntax;
  const base = own?.algorithm ?? canvasNanosyntaxOptions.value.algorithm;
  return { ...canvasNanosyntaxOptions.value, ...own, algorithm: own?.rules ? { ...resolveNSAlgorithm(base), ...own.rules } : base };
}

export function setNanosyntaxOptions(scope: 'tree' | 'canvas', patch: Partial<NanosyntaxOptions>, owner = nanosyntaxOwner().id) {
  if (scope === 'canvas') {
    canvasNanosyntaxOptions.value = { ...canvasNanosyntaxOptions.value, ...patch };
    nanosyntaxAlgorithm.value = canvasNanosyntaxOptions.value.algorithm;
  } else trees.value = trees.value.map((t) => t.id === owner ? { ...t, nanosyntax: { ...t.nanosyntax, ...patch } } : t);
}

export function setLexicalExpression(id: string, expression: string) {
  const e = trees.value.find((t) => t.id === id);
  if (!e) return;
  const text = lexicalTreeSource(e);
  const p = parse(text);
  if (!p.ok || !p.doc.root) return;
  const next = applyChanges(text, setExpression(text, p.doc, p.doc.root, expression).changes);
  setTreeSource(id, next);
}

/** Editing a lexical sheet in either editor immediately updates the lexicon. */
export function setTreeSource(id: string, text: string) {
  const e = trees.value.find((t) => t.id === id);
  if (!e) return;
  batch(() => {
    sources.value = { ...sources.value, [e.srcId]: text };
    if (id === activeId.value) source.value = text;
  });
}

/** Turn an ordinary, visually built sheet into a lexical entry without copying its code. */
export function assignLexicalTree(id: string, scope: 'tree' | 'canvas', owner?: string, entryId = 'l' + newId()) {
  const e = trees.value.find((t) => t.id === id);
  const target = scope === 'tree' ? trees.value.find((t) => t.id === owner && !t.lexical && t.id !== id) : undefined;
  if (!e || (scope === 'tree' && !target)) return false;
  trees.value = trees.value.map((t) => t.id === id ? { ...t, lexical: { entryId: t.lexical?.entryId ?? entryId, scope, ...(target ? { owner: target.id } : {}) }, derivation: undefined, lexicon: undefined } :
    t.lexical?.owner === id ? { ...t, lexical: { ...t.lexical, scope: 'canvas', owner: undefined } } : t);
  const expression = lexicalTreeExpression(id);
  const structure = lexicalStructureSource(id);
  const parsed = parse(structure);
  if (parsed.ok && parsed.doc.root && !parsed.doc.root.children.length) {
    setTreeSource(id, lexicalEntrySource(structure, expression));
  } else if (expression) setLexicalExpression(id, expression);
  reflowLexicalTrees();
  focusTreeRequest.value = { id };
  return true;
}

/** A new L-tree is an ordinary canvas tree; its nodes use all standard visual operations. */
export function createLexicalTree(scope: 'tree' | 'canvas', owner?: string, text = '[FP [F]]', expression = '', entryId?: string): string {
  const srcId = newId();
  const id = newId();
  const e: TreeEntry = { id, srcId, name: nextName('L-tree'), build: canvasSettings.value.build, style: { ...canvasSettings.value.style, sheetWidth: 0, sheetHeight: 0 }, lexical: { entryId: entryId ?? 'l' + newId(), scope, ...(scope === 'tree' && owner ? { owner } : {}) }, x: 0, y: 0 };
  batch(() => {
    let code = expression ? prepareLexicalSource(text || '[FP [F]]') : text || '[FP [F]]';
    if (expression) code = lexicalEntrySource(code, expression);
    sources.value = { ...sources.value, [srcId]: code };
    trees.value = [...trees.value, e];
    if (expression) setLexicalExpression(id, expression);
  });
  reflowLexicalTrees();
  return id;
}

export function unassignLexicalTree(id: string) {
  trees.value = trees.value.map((t) => t.id === id ? { ...t, lexical: undefined } : t);
  reflowLexicalTrees();
}

/** Keep each lexical region touching its owner or the preceding L-tree. */
export function reflowLexicalTrees(owner?: string) {
  const places = new Map<string, { x: number; y: number }>();
  const list = trees.value;
  const owners = list.filter((t) => !t.lexical && (!owner || t.id === owner));
  for (const t of owners) {
    let x = t.x + sheetSize(t.id).w + 32;
    for (const l of lexicalTreesFor('tree', t.id)) {
      places.set(l.id, { x: Math.round(x), y: Math.round(t.y) });
      x += sheetSize(l.id).w + 32;
    }
  }
  if (!owner) {
    const shared = lexicalTreesFor('canvas').filter((tree) => !treeGroups.value.some((group) => group.members.includes(tree.id)));
    let x = Math.min(0, ...owners.map((t) => t.x));
    const y = Math.min(0, ...owners.map((t) => t.y)) - Math.max(130, ...shared.map((t) => sheetSize(t.id).h)) - 80;
    for (const l of shared) {
      places.set(l.id, { x: Math.round(x), y: Math.round(y) });
      x += sheetSize(l.id).w + 32;
    }
  }
  if (list.some((t) => { const p = places.get(t.id); return p && (t.x !== p.x || t.y !== p.y); })) {
    trees.value = list.map((t) => places.has(t.id) ? { ...t, ...places.get(t.id)! } : t);
  }
}

/** Make room for an expanded lexical row without repacking freely positioned sheets. */
function makeRoomForLexicalCluster(owner: string) {
  const list = trees.value;
  const anchor = list.find((t) => t.id === owner && !t.lexical);
  if (!anchor) return;
  const groupKey = (t: TreeEntry) => t.derivation ? 'derivation:' + t.derivation.group : 'tree:' + t.id;
  const ownKey = groupKey(anchor);
  const groups = new Map<string, TreeEntry[]>();
  for (const t of list.filter((t) => !t.lexical)) {
    const key = groupKey(t);
    const group = groups.get(key) ?? [];
    group.push(t, ...list.filter((l) => l.lexical?.scope === 'tree' && l.lexical.owner === t.id));
    groups.set(key, group);
  }
  const shifts = new Map<string, number>();
  const bounds = (key: string) => {
    const members = groups.get(key)!;
    const dx = shifts.get(key) ?? 0;
    return {
      left: Math.min(...members.map((t) => t.x)) + dx,
      right: Math.max(...members.map((t) => t.x + sheetSize(t.id).w)) + dx,
      top: Math.min(...members.map((t) => t.y)),
      bottom: Math.max(...members.map((t) => t.y + sheetSize(t.id).h)),
    };
  };
  const pending = [ownKey];
  const gap = 32;
  while (pending.length) {
    const key = pending.shift()!;
    const fixed = bounds(key);
    for (const foreign of groups.keys()) {
      if (foreign === key || foreign === ownKey) continue;
      const candidate = bounds(foreign);
      if (fixed.left >= candidate.right + gap || candidate.left >= fixed.right + gap || fixed.top >= candidate.bottom + gap || candidate.top >= fixed.bottom + gap) continue;
      shifts.set(foreign, (shifts.get(foreign) ?? 0) + Math.ceil(fixed.right + gap - candidate.left));
      if (!pending.includes(foreign)) pending.push(foreign);
    }
  }
  if (!shifts.size) return;
  const byId = new Map<string, number>();
  for (const [key, dx] of shifts) for (const t of groups.get(key)!) byId.set(t.id, dx);
  trees.value = list.map((t) => byId.has(t.id) ? { ...t, x: t.x + byId.get(t.id)! } : t);
}

/** Upgrade saved pre-visual lexicons once, retaining stable entry IDs. */
function materializeLegacyLexicons() {
  const legacy = [...trees.value].filter((t) => t.lexicon?.length && (!t.derivation || !derivationGroups.value.some((g) => g.id === t.derivation!.group && trees.value.some((s) => s.id === g.sourceTree))));
  for (const owner of legacy) for (const entry of owner.lexicon ?? []) {
    if (!lexicalTreesFor('tree', owner.id).some((t) => t.lexical?.entryId === entry.id)) createLexicalTree('tree', owner.id, entry.source, entry.expression, entry.id);
  }
  for (const entry of canvasLexicon.value) {
    if (!lexicalTreesFor('canvas').some((t) => t.lexical?.entryId === entry.id)) createLexicalTree('canvas', undefined, entry.source, entry.expression, entry.id);
  }
  trees.value = trees.value.map((t) => t.lexicon ? { ...t, lexicon: undefined } : t);
  canvasLexicon.value = [];
}

/** An empty canvas: one tree without code (settings of the active tree stay). */
export function clearCanvas() {
  batch(() => {
    const b = build.value;
    const st = style.value;
    trees.value = [{ id: 't' + newId(), name: 'Tree 1', srcId: 's' + newId(), build: b, style: st, x: 0, y: 0 }];
    sources.value = { [trees.value[0].srcId]: '' };
    derivationGroups.value = [];
    treeGroups.value = [];
    canvasLexicon.value = [];
    activeId.value = trees.value[0].id;
    source.value = '';
    selection.value = null;
    relationOf.value = null;
    currentName.value = null;
  });
}

/** A copy of a tree next to it: independent (its own code) or linked (the same code). */
export function duplicateTree(id: string, linked: boolean, text?: string) {
  const e = trees.value.find((x) => x.id === id);
  if (!e) return;
  const srcId = linked ? e.srcId : newId();
  const copy: TreeEntry = { ...e, id: newId(), srcId, name: nextName(`${e.name} (${linked || text !== undefined ? 'linked' : 'copy'})`), ...freeSpot() };
  const own = text ?? (e.id === activeId.value ? source.value : sources.value[e.srcId] ?? '');
  batch(() => {
    if (!linked) sources.value = { ...sources.value, [srcId]: text !== undefined ? own : stripLinksText(own) };
    delete copy.derivation;
    if (copy.lexical) copy.lexical = { ...copy.lexical, entryId: 'l' + newId() };
    delete copy.lexicon;
    trees.value = [...trees.value, copy];
  });
  activateTree(copy.id);
  reflowLexicalTrees();
}

/** a copy of its own: no link markers */
const stripLinksText = (t: string) => t.replace(/;link=[^;\s[\]@#]+/g, '');

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
  trees.value = trees.value.filter((x) => x.id !== id).map((t) => t.lexical?.owner === id ? { ...t, lexical: { ...t.lexical, scope: 'canvas', owner: undefined } } : t);
  pruneSources();
  removeFromTreeGroups(id);
  reflowLexicalTrees();
}

export function renameTree(id: string, name: string) {
  trees.value = trees.value.map((x) => (x.id === id ? { ...x, name: name.trim() || x.name } : x));
}

export function moveTree(id: string, x: number, y: number) {
  const original = trees.value.find((t) => t.id === id);
  if (!original) return;
  if (original.lexical) {
    // Reordering a lexical sheet preserves its adjacency to the S-tree/lexicon region.
    const siblings = lexicalTreesFor(original.lexical.scope, original.lexical.owner).filter((t) => t.id !== id);
    siblings.push({ ...original, x });
    siblings.sort((a, b) => a.x - b.x);
    const rank = new Map(siblings.map((t, i) => [t.id, i]));
    const positions = trees.value.flatMap((t, i) => rank.has(t.id) ? [i] : []);
    const next = [...trees.value];
    positions.forEach((position, i) => next[position] = siblings[i]);
    trees.value = next;
    reflowLexicalTrees(original.lexical.scope === 'tree' ? original.lexical.owner : undefined);
    return;
  }
  const dx = Math.round(x) - original.x, dy = Math.round(y) - original.y;
  trees.value = trees.value.map((e) => e.id === id || e.lexical?.owner === id ? { ...e, x: e.x + dx, y: e.y + dy } : e);
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

// A visually edited lexical tree may grow in either dimension; preserve the region's spacing.
// Only membership/size changes clear space. Dragging freely positioned S-trees keeps its meaning.
const lexicalDimensions = new Map<string, string>();
effect(() => {
  void source.value;
  void sources.value;
  void fontEpoch.value;
  reflowLexicalTrees();
  const owners = trees.value.filter((t) => !t.lexical && lexicalTreesFor('tree', t.id).length);
  for (const t of owners) {
    const members = [t, ...lexicalTreesFor('tree', t.id)];
    const dimensions = members.map((m) => m.id + ':' + JSON.stringify(sheetSize(m.id))).join('|');
    if (lexicalDimensions.get(t.id) !== dimensions) {
      lexicalDimensions.set(t.id, dimensions);
      makeRoomForLexicalCluster(t.id);
    }
  }
  for (const key of lexicalDimensions.keys()) if (!owners.some((t) => t.id === key)) lexicalDimensions.delete(key);
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
  lexicon?: LexicalEntry[];
  lexical?: TreeEntry['lexical'];
  nanosyntax?: Partial<NanosyntaxOptions>;
  derivation?: TreeEntry['derivation'];
}

export interface Snapshot {
  /** the active tree (all that older versions read) */
  s: string;
  b?: DeepPartial<BuildOptions>;
  st?: Partial<TreeStyle>;
  /** all trees of the canvas, when there are several */
  w?: { trees: TreeSnap[]; sources: Record<string, string>; active: string; canvas?: { b?: DeepPartial<BuildOptions>; st?: Partial<TreeStyle> }; lexicon?: LexicalEntry[]; groups?: DerivationGroup[]; treeGroups?: TreeGroup[]; nanosyntaxEnabled?: boolean; algorithm?: NSAlgorithm; nanosyntax?: NanosyntaxOptions };
}

function diffs(b: BuildOptions, st: TreeStyle): { b?: DeepPartial<BuildOptions>; st?: Partial<TreeStyle> } {
  const out: { b?: DeepPartial<BuildOptions>; st?: Partial<TreeStyle> } = {};
  const db = diff(b, defaultBuildOptions);
  const ds = diff(st, defaultStyle);
  if (Object.keys(db).length) out.b = db as DeepPartial<BuildOptions>;
  if (Object.keys(ds).length) out.st = ds;
  return out;
}

/** Split the artificial forest mother used by older saved workspace snapshots. */
function upgradeSavedWorkspaces() {
  const legacy = derivationGroups.value.filter((group) => !group.displayVersion);
  if (!legacy.length) return;
  for (const group of legacy) {
    const members = trees.value.filter((entry) => entry.derivation?.group === group.id);
    for (const entry of members) {
      if (!/^(?:Workspace:|Open workspace:|Reopened workspace:|Workspace (?:has|has no))/.test(entry.derivation!.title)) continue;
      const code = lexicalTreeSource(entry);
      const parsed = parse(code);
      if (!parsed.ok || !parsed.doc.root || parsed.doc.root.label || parsed.doc.arrows.length || parsed.doc.root.children.length < 2 || parsed.doc.root.children.some((child) => child.kind !== 'node')) continue;
      const prefix = code.slice(0, parsed.doc.root.span.from);
      const parts = parsed.doc.root.children.map((child) => code.slice(child.span.from, child.span.to));
      const ids = [entry.id];
      setTreeSource(entry.id, prefix + parts[0]);
      let x = entry.x + sheetSize(entry.id).w + 30;
      for (const [index, part] of parts.slice(1).entries()) {
        const id = 'ws' + newId();
        const extra = { ...entry, id, srcId: id, name: entry.name + ' · workspace ' + (index + 2), x };
        sources.value = { ...sources.value, [id]: prefix + part };
        trees.value = [...trees.value, extra];
        ids.push(id);
        x += sheetSize(id).w + 30;
      }
      createTreeGroup(ids, 'Step ' + entry.derivation!.step + ' · separate workspaces', true, entry.derivation!.step);
    }
    let cursor = Math.min(...members.map((entry) => entry.x));
    for (const step of [...new Set(members.map((entry) => entry.derivation!.step))].sort((a, b) => a - b)) {
      const sheets = trees.value.filter((entry) => entry.derivation?.group === group.id && entry.derivation.step === step);
      const left = Math.min(...sheets.map((entry) => entry.x));
      const shift = Math.max(0, cursor - left);
      if (shift) {
        const ids = new Set(sheets.map((entry) => entry.id));
        trees.value = trees.value.map((entry) => ids.has(entry.id) ? { ...entry, x: entry.x + shift } : entry);
      }
      cursor = Math.max(...sheets.map((entry) => entry.x + shift + sheetSize(entry.id).w)) + 64;
    }
  }
  derivationGroups.value = derivationGroups.value.map((group) => ({ ...group, displayVersion: 2 }));
}

/** The state of the canvas; full = with tree names and places even for a single tree (files). */
export function snapshot(full = false): Snapshot {
  const snap: Snapshot = { s: source.value, ...diffs(build.value, style.value) };
  const canvasOwn = diffs(canvasSettings.value.build, canvasSettings.value.style);
  if (full || trees.value.length > 1 || canvasOwn.b || canvasOwn.st || nanosyntaxEnabled.value || treeGroups.value.length || canvasLexicon.value.length || trees.value.some((e) => e.lexicon?.length || e.lexical || e.nanosyntax) || derivationGroups.value.length || canvasNanosyntaxOptions.value.hideLowerCopies || canvasNanosyntaxOptions.value.algorithm !== 'caha2025') {
    snap.w = {
      trees: trees.value.map((e) => ({ id: e.id, name: e.name, src: e.srcId, x: e.x, y: e.y, lexicon: e.lexicon, lexical: e.lexical, nanosyntax: e.nanosyntax, derivation: e.derivation, ...(e.id === activeId.value ? diffs(build.value, style.value) : diffs(e.build, e.style)) })),
      sources: { ...sources.value, [activeTree.value.srcId]: source.value },
      active: activeId.value,
      lexicon: canvasLexicon.value,
      groups: derivationGroups.value,
      treeGroups: treeGroups.value,
      nanosyntaxEnabled: nanosyntaxEnabled.value,
      algorithm: nanosyntaxAlgorithm.value,
      nanosyntax: canvasNanosyntaxOptions.value,
      canvas: diffs(canvasSettings.value.build, canvasSettings.value.style),
    };
  }
  return snap;
}

export function restore(snap: Snapshot) {
  batch(() => {
    const w = snap.w;
    const publishedLabel = (label: string) => label.replaceAll('Caha et al. 2024', 'Caha et al. 2025').replaceAll('Spell out ⇐', 'Spell out ⇒').replaceAll('Workspace: ⇐', 'Workspace: ⇒').replaceAll('Growing branch: ⇐', 'Growing branch: ⇒');
    codeSelection.value = false;
    treeGroups.value = w?.treeGroups ?? [];
    nanosyntaxEnabled.value = w?.nanosyntaxEnabled ?? !!w?.trees?.some((entry) => entry.lexical || entry.derivation);
    canvasLexicon.value = Array.isArray(w?.lexicon) ? w.lexicon : [];
    derivationGroups.value = Array.isArray(w?.groups) ? w.groups.map((group) => ({ ...group, name: publishedLabel(group.name), algorithm: (group.algorithm as string) === 'caha2024' ? 'caha2025' : group.algorithm, copyVariants: undefined, hideLowerCopies: undefined })) : [];
    const savedAlgorithm = w?.nanosyntax?.algorithm ?? w?.algorithm ?? 'caha2025';
    const algorithm = (savedAlgorithm as string) === 'caha2024' ? 'caha2025' : savedAlgorithm;
    nanosyntaxAlgorithm.value = algorithm;
    canvasNanosyntaxOptions.value = { algorithm, hideLowerCopies: w?.nanosyntax?.hideLowerCopies ?? false };
    canvasSettings.value = { build: mergeBuild(defaultBuildOptions, w?.canvas?.b), style: { ...defaultStyle, ...(w?.canvas?.st ?? {}) } };
    if (w && w.trees?.length) {
      trees.value = w.trees.map((e) => ({
        id: e.id,
        name: e.derivation ? publishedLabel(e.name) : e.name,
        srcId: e.src,
        lexicon: e.lexicon,
        lexical: e.lexical,
        nanosyntax: (e.nanosyntax?.algorithm as string) === 'caha2024' ? { ...e.nanosyntax, algorithm: 'caha2025' } : e.nanosyntax,
        derivation: e.derivation ? { ...e.derivation, title: publishedLabel(e.derivation.title) } : undefined,
        x: e.x ?? 0,
        y: e.y ?? 0,
        build: mergeBuild(defaultBuildOptions, e.b),
        style: { ...defaultStyle, ...(e.st ?? {}) },
      }));
      sources.value = { ...w.sources };
      for (const entry of trees.value) if (entry.derivation) {
        const code = sources.value[entry.srcId] ?? '';
        sources.value[entry.srcId] = derivationDisplaySource(code.replace(/^%.*$/gm, publishedLabel), entry.derivation!.action);
      }
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
    materializeLegacyLexicons();
    upgradeSavedWorkspaces();
    for (const entry of trees.value.filter((tree) => tree.lexical)) {
      const expression = lexicalTreeExpression(entry);
      const structure = lexicalStructureSource(entry);
      const parsed = parse(structure);
      if (parsed.ok && parsed.doc.root && !parsed.doc.root.children.length) setTreeSource(entry.id, lexicalEntrySource(structure, expression));
    }
    fitRequest.value++;
  });
}

/** An example replaces the canvas, including its lexical trees and settings. */
export function loadExample(ex: Example) {
  if (ex.nanosyntax) {
    const example = ex.nanosyntax;
    restore({ s: formatDoc(ex.src), b: ex.build, st: ex.style });
    const owner = activeId.value;
    renameTree(owner, example.title);
    setNanosyntaxOptions('tree', { algorithm: example.algorithm }, owner);
    for (const entry of example.entries) createLexicalTree('tree', owner, entry.source, entry.expression, entry.id);
    selection.value = null;
    sideTab.value = 'nanosyntax';
    nanosyntaxEnabled.value = true;
    rightPanelOpen.value = true;
    focusTreeRequest.value = { id: owner };
    return;
  }
  // laid out like code edited on the canvas
  const src = formatDoc(ex.src);
  restore({ s: src, b: ex.build, st: ex.style });
  if (sideTab.value === 'nanosyntax') sideTab.value = 'edit';
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

/** widths of the code pane and the settings pane (px; null = default), changed by dragging their borders */
export const paneWidths = signal<{ code: number | null; inspector: number; codeHidden?: boolean }>({ code: null, inspector: 320, ...(lsGet<object>('nanotrees:panes') ?? {}) });
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
