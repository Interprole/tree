import { batch, signal } from '@preact/signals';
import { deriveNanosyntax, resolveNSAlgorithm } from './core/nanosyntax';
import type { LexicalEntry, NSAlgorithm, NSAlgorithmSettings, DerivationResult } from './core/nanosyntax';
import { askOverride } from './ask';
import { defaultBuildOptions } from './core/build';
import { activateTree, activeTree, activeId, canvasLexicon, canvasNanosyntaxOptions, createLexicalTree, createTreeGroup, derivationGroups, effectiveNanosyntaxOptions, fitRequest, focusTreeRequest, lexicalStructureSource, lexicalTreeExpression, lexicalTreeSource, lexicalTreesFor, loadExample, nanosyntaxEnabled, nanosyntaxOwner, otherScenes, prepareLexicalSource, removeTree, scene, setLexicalExpression, setNanosyntaxOptions, setTreeSource, sheetSize, showToast, sources, treeGroups, trees } from './state';
import type { NanosyntaxOptions, TreeEntry } from './state';
import type { Example } from './examples';

export const derivationBusy = signal(false);
export const derivationError = signal('');
const id = () => 'ns' + Math.random().toString(36).slice(2, 10);

export function effectiveLexicon(forTree = activeTree.value): LexicalEntry[] {
  const owner = nanosyntaxOwner(forTree);
  return [...lexicalTreesFor('tree', owner.id), ...lexicalTreesFor('canvas')].map((entry) => ({ id: entry.lexical!.entryId, expression: lexicalTreeExpression(entry), source: lexicalStructureSource(entry) }));
}

const ruleKeys: (keyof NSAlgorithmSettings)[] = ['movement', 'closure', 'backtracking'];
const ruleNames = { movement: 'spellout-driven movement', closure: 'auxiliary workspace closure', backtracking: 'Merge F after workspace reopening' };

/** Existing presets own all three values; new controls override one value at a time. */
function treeRules(owner: string): Partial<NSAlgorithmSettings> {
  const own = trees.value.find((tree) => tree.id === owner)?.nanosyntax;
  return { ...(own?.algorithm ? resolveNSAlgorithm(own.algorithm) : {}), ...own?.rules };
}
function setTreeRules(owner: string, rules: Partial<NSAlgorithmSettings>) {
  setNanosyntaxOptions('tree', { algorithm: undefined, rules: Object.keys(rules).length ? rules : undefined }, owner);
}

/** Share Appearance's Ask / Replace / Keep policy and the very same dialog. */
export async function applyNanosyntaxRules(scope: 'tree' | 'canvas', patch: Partial<NSAlgorithmSettings>, owner = nanosyntaxOwner().id) {
  if (scope === 'tree') {
    setTreeRules(owner, { ...treeRules(owner), ...patch });
    return;
  }
  for (const key of ruleKeys) {
    const value = patch[key];
    const before = resolveNSAlgorithm(canvasNanosyntaxOptions.value.algorithm);
    if (value === undefined || value === before[key]) continue;
    const owners = trees.value.filter((tree) => !tree.lexical && !tree.derivation);
    const own = owners.filter((tree) => treeRules(tree.id)[key] !== undefined && resolveNSAlgorithm(effectiveNanosyntaxOptions(tree.id).algorithm)[key] !== value);
    setNanosyntaxOptions('canvas', { algorithm: { ...before, [key]: value } });
    if (own.length) {
      const names = own.map((tree) => tree.name).join(', ');
      const replace = await askOverride('canvas:nanosyntax:' + key,
        (own.length === 1 ? names + ' has' : own.length + ' trees (' + names + ') have') + ' their own ' + ruleNames[key] + '. Replace it with the new one?');
      if (replace) batch(() => {
        for (const tree of own) if (trees.value.some((entry) => entry.id === tree.id)) {
          const rules = treeRules(tree.id);
          delete rules[key];
          setTreeRules(tree.id, rules);
        }
      });
    }
  }
}

/** A local L-tree derives its owner; a canvas L-tree offers each eligible S-tree. */
export function derivationTargets(forTree: TreeEntry): TreeEntry[] {
  const candidates = trees.value.filter((tree) => !tree.lexical && !tree.derivation);
  const owners = forTree.lexical
    ? candidates.filter((tree) => forTree.lexical!.scope === 'canvas' || tree.id === forTree.lexical!.owner)
    : candidates.filter((tree) => tree.id === forTree.id);
  return owners.filter((tree) => lexicalTreeSource(tree).trim() && effectiveLexicon(tree).length);
}

export function setLexicon(scope: 'tree' | 'canvas', entries: LexicalEntry[], owner = nanosyntaxOwner().id) {
  batch(() => {
    const old = lexicalTreesFor(scope, owner);
    for (const tree of old) if (!entries.some((entry) => entry.id === tree.lexical!.entryId)) removeTree(tree.id);
    for (const entry of entries) {
      const tree = old.find((candidate) => candidate.lexical!.entryId === entry.id);
      if (!tree) createLexicalTree(scope, owner, entry.source, entry.expression, entry.id);
      else { setTreeSource(tree.id, prepareLexicalSource(entry.source)); setLexicalExpression(tree.id, entry.expression); }
    }
    if (scope === 'canvas') canvasLexicon.value = [];
    else trees.value = trees.value.map((tree) => tree.id === owner ? { ...tree, lexicon: undefined } : tree);
  });
}

export function algorithmName(algorithm: NSAlgorithm): string {
  if (typeof algorithm === 'string') return ({ starke2018: 'Starke 2018', caha2019: 'Caha 2019', caha2019mm: 'Caha 2019 · Multiple Merge', caha2025: 'Caha et al. 2025' })[algorithm];
  const settings = resolveNSAlgorithm(algorithm);
  return (settings.movement === 'starke2018' ? 'Starke 2018 movement' : '2025 evacuation')
    + ' · ' + (settings.closure === 'early' ? 'Early Closure' : 'Late Closure')
    + ' · ' + (settings.backtracking === 'multiple-merge' ? 'Multiple Merge' : 'AUX only');
}

/** Each step is a group of independent workspace sheets until actual Merge combines them. */
export function addDerivation(result: DerivationResult, algorithm: NSAlgorithm, from = activeTree.value) {
  const group = id();
  const y = Math.max(...trees.value.map((tree) => tree.y + sheetSize(tree.id).h), 0) + 150;
  let x = from.x;
  const newSources: Record<string, string> = {};
  const stepMembers: string[][] = [];
  const entries: TreeEntry[] = result.steps.flatMap((step, index) => {
    const members = (step.workspaces ?? [step.source]).map((code, part) => {
      const key = id();
      newSources[key] = '% ' + (index + 1) + '. ' + step.title + '\n% ' + step.detail.replace(/\n/g, ' ') + '\n' + code;
      return {
        id: key, srcId: key, name: (index + 1) + '. ' + step.title + (step.workspaces ? ' · workspace ' + (part + 1) : ''), x: 0, y,
        build: { ...defaultBuildOptions, chains: 'copies', chainArrows: true, semantics: { ...defaultBuildOptions.semantics, show: false, compute: false } },
        style: { ...from.style, sheetWidth: 0, sheetHeight: 0 },
        derivation: { group, step: index + 1, action: step.action, title: step.title, detail: step.detail, status: step.status, cycle: step.cycle },
      } as TreeEntry;
    });
    stepMembers.push(members.map((member) => member.id));
    return members;
  });
  batch(() => {
    nanosyntaxEnabled.value = true;
    sources.value = { ...sources.value, ...newSources };
    trees.value = [...trees.value, ...entries];
    derivationGroups.value = [...derivationGroups.value, { id: group, name: from.name + ' · ' + algorithmName(algorithm), sourceTree: from.id, algorithm, complete: result.complete, unresolved: result.unresolved, warnings: result.warnings, surface: result.surface, displayVersion: 2 }];
  });
  const placements = new Map<string, number>();
  stepMembers.forEach((members, index) => {
    for (const member of members) { placements.set(member, x); x += sheetSize(member).w + 30; }
    if (members.length > 1) createTreeGroup(members, 'Step ' + (index + 1) + ' · separate workspaces', true, index + 1);
    x += 58;
  });
  trees.value = trees.value.map((tree) => placements.has(tree.id) ? { ...tree, x: placements.get(tree.id)! } : tree);
  const last = entries.at(-1);
  if (last) { activateTree(last.id); focusTreeRequest.value = { id: last.id }; }
}

export async function buildDerivation(forTree = nanosyntaxOwner()) {
  if (derivationBusy.value) return;
  derivationBusy.value = true;
  derivationError.value = '';
  const owner = nanosyntaxOwner(forTree);
  const code = lexicalTreeSource(owner);
  const entries = effectiveLexicon(owner);
  const algorithm = effectiveNanosyntaxOptions(owner).algorithm;
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    addDerivation(deriveNanosyntax(code, entries, algorithm), algorithm, owner);
  } catch (error) { derivationError.value = (error as Error).message; showToast(derivationError.value); }
  finally { derivationBusy.value = false; }
}

export async function loadCanvasExample(example: Example) {
  loadExample(example);
  if (example.nanosyntax) await buildDerivation(activeTree.value);
  fitRequest.value++;
}

/** Compatibility for callers storing old option fields; copy display is intrinsic to each step. */
export function updateNanosyntaxOptions(scope: 'tree' | 'canvas', patch: Partial<NanosyntaxOptions>, owner = nanosyntaxOwner().id) { setNanosyntaxOptions(scope, patch, owner); }

export function removeDerivation(group: string) {
  const members = new Set(trees.value.filter((tree) => tree.derivation?.group === group).map((tree) => tree.id));
  const remaining = trees.value.filter((tree) => !members.has(tree.id));
  if (!members.size || !remaining.length) return;
  if (members.has(activeId.value)) activateTree(remaining[0].id);
  batch(() => {
    trees.value = remaining;
    const used = new Set(remaining.map((tree) => tree.srcId));
    sources.value = Object.fromEntries(Object.entries(sources.value).filter(([key]) => used.has(key)));
    treeGroups.value = treeGroups.value.filter((entry) => !entry.members.every((member) => members.has(member)));
    derivationGroups.value = derivationGroups.value.filter((entry) => entry.id !== group);
  });
  fitRequest.value++;
}

export function moveDerivation(group: string, dx: number, dy: number) {
  const members = new Set(trees.value.filter((tree) => tree.derivation?.group === group).map((tree) => tree.id));
  for (const workspace of treeGroups.value) if (workspace.nanosyntax && workspace.members.some((id) => members.has(id))) {
    for (const id of workspace.members) members.add(id);
  }
  trees.value = trees.value.map((tree) => members.has(tree.id) || (tree.lexical?.owner && members.has(tree.lexical.owner)) ? { ...tree, x: Math.round(tree.x + dx), y: Math.round(tree.y + dy) } : tree);
}

export function derivationBounds() {
  if (!nanosyntaxEnabled.value) return [];
  const active = activeTree.value;
  const sizes = new Map(otherScenes.value.map((other) => [other.entry.id, other.scene]));
  return derivationGroups.value.flatMap((group) => {
    const members = trees.value.filter((tree) => tree.derivation?.group === group.id);
    if (!members.length) return [];
    const x = Math.min(...members.map((tree) => tree.x)) - 24;
    const y = Math.min(...members.map((tree) => tree.y)) - 100;
    return [{ group, x, y,
      width: Math.max(...members.map((tree) => tree.x + ((tree.id === active.id ? scene.value : sizes.get(tree.id))?.width ?? 240))) - x + 24,
      height: Math.max(...members.map((tree) => tree.y + ((tree.id === active.id ? scene.value : sizes.get(tree.id))?.height ?? 130))) - y + 32,
    }];
  });
}
