import { beforeEach, describe, expect, test } from 'vitest';
import { activateTree, activeTree, addTree, assignLexicalTree, canvasLexicon, canvasNanosyntaxOptions, createLexicalTree, effectiveNanosyntaxOptions, lexicalTreeExpression, lexicalTreeSource, lexicalTreesFor, moveTree, removeTree, restore, setLexicalExpression, setNanosyntaxOptions, setTreeSource, sheetSize, snapshot, source, trees, unassignLexicalTree } from '../src/state';
import { addDerivation, applyNanosyntaxRules, derivationTargets, effectiveLexicon, moveDerivation, setLexicon } from '../src/nanosyntax';
import { deriveNanosyntax, resolveNSAlgorithm } from '../src/core/nanosyntax';
import { overridePolicy, question } from '../src/ask';
import { nanosyntaxExamples } from '../src/core/nanosyntaxExamples';
import { addToTreeGroup, createTreeGroup, moveTreeGroup, nanosyntaxEnabled, toggleNanosyntax, treeGroups, visibleTrees } from '../src/state';

beforeEach(() => {
  restore({ s: '[F2 [F1]]' });
  overridePolicy.value = 'ask';
  question.value = null;
});

describe('nanosyntax values of their own', () => {
  test('changing one rule leaves other rules inherited from the canvas', async () => {
    const owner = activeTree.value.id;
    await applyNanosyntaxRules('tree', { movement: 'starke2018' }, owner);
    await applyNanosyntaxRules('canvas', { closure: 'late', backtracking: 'multiple-merge' });
    expect(question.value).toBeNull();
    expect(resolveNSAlgorithm(effectiveNanosyntaxOptions(owner).algorithm)).toEqual({ movement: 'starke2018', closure: 'late', backtracking: 'multiple-merge' });
    expect(trees.value.find((tree) => tree.id === owner)!.nanosyntax?.rules).toEqual({ movement: 'starke2018' });
    const saved = snapshot(true);
    restore(saved);
    expect(resolveNSAlgorithm(effectiveNanosyntaxOptions(owner).algorithm)).toEqual({ movement: 'starke2018', closure: 'late', backtracking: 'multiple-merge' });
  });
  test('the shared dialog can keep a tree rule while other trees follow the canvas', async () => {
    const owner = activeTree.value.id;
    const follower = addTree('[F1]');
    await applyNanosyntaxRules('tree', { movement: 'starke2018' }, owner);
    await applyNanosyntaxRules('canvas', { movement: 'starke2018' });
    const change = applyNanosyntaxRules('canvas', { movement: 'caha2025' });
    expect(question.value?.message).toContain('own spellout-driven movement');
    question.value!.answer(false, false);
    await change;
    expect(resolveNSAlgorithm(effectiveNanosyntaxOptions(owner).algorithm).movement).toBe('starke2018');
    expect(resolveNSAlgorithm(effectiveNanosyntaxOptions(follower).algorithm).movement).toBe('caha2025');
  });
  test('replace clears just the affected override and remembers the shared Appearance policy', async () => {
    const owner = activeTree.value.id;
    await applyNanosyntaxRules('tree', { movement: 'starke2018', closure: 'late' }, owner);
    await applyNanosyntaxRules('canvas', { closure: 'late' });
    const change = applyNanosyntaxRules('canvas', { closure: 'early' });
    expect(question.value?.message).toContain('own auxiliary workspace closure');
    question.value!.answer(true, true);
    await change;
    expect(overridePolicy.value).toBe('replace');
    expect(trees.value.find((tree) => tree.id === owner)!.nanosyntax?.rules).toEqual({ movement: 'starke2018' });
    await applyNanosyntaxRules('canvas', { movement: 'starke2018' });
    await applyNanosyntaxRules('canvas', { movement: 'caha2025' });
    expect(question.value).toBeNull();
    expect(resolveNSAlgorithm(effectiveNanosyntaxOptions(owner).algorithm).movement).toBe('caha2025');
  });
  test('a local L-tree derives its owner, while a global L-tree offers all nonempty S-trees', () => {
    const owner = activeTree.value;
    expect(derivationTargets(owner)).toHaveLength(0);
    const local = createLexicalTree('tree', owner.id, '[F1]', 'a');
    const other = addTree('[F1]');
    expect(derivationTargets(trees.value.find((tree) => tree.id === local)!)).toEqual([owner]);
    expect(derivationTargets(trees.value.find((tree) => tree.id === other)!)).toHaveLength(0);
    const global = createLexicalTree('canvas', undefined, '[F1]', 'b');
    expect(derivationTargets(trees.value.find((tree) => tree.id === global)!).map((tree) => tree.id)).toEqual([owner.id, other]);
  });
});

describe('visible lexical trees', () => {
  test('a new lexical entry is a normal editable sheet and keeps one source of truth', () => {
    const owner = activeTree.value;
    const id = createLexicalTree('tree', owner.id, '[F1P [F1]]', 'root');
    expect(lexicalTreesFor('tree', owner.id).map((t) => t.id)).toEqual([id]);
    expect(lexicalTreeExpression(id)).toBe('root');
    expect(effectiveLexicon(owner)).toEqual([{ id: trees.value.find((t) => t.id === id)!.lexical!.entryId, expression: 'root', source: lexicalTreeSource(id) }]);
    activateTree(id);
    source.value = '[F2P;spell="changed" [F2] [F1P [F1]]]';
    expect(effectiveLexicon(owner)[0].expression).toBe('changed');
    expect(effectiveLexicon(owner)[0].source).toBe(source.value);
    setLexicalExpression(id, 'new form');
    expect(source.value).toContain(';spell="new form"');
    expect(lexicalTreeExpression(id)).toBe('new form');
  });

  test('an already built tree can be scoped to a chosen S-tree or the whole canvas', () => {
    const owner = activeTree.value;
    const existing = addTree('[NP;spell="cat" [N]]');
    expect(assignLexicalTree(existing, 'tree', owner.id)).toBe(true);
    expect(effectiveLexicon(owner).map((e) => e.expression)).toEqual(['cat']);
    const unrelated = addTree('[F3 [F2 [F1]]]');
    expect(effectiveLexicon(activeTree.value)).toHaveLength(0);
    expect(assignLexicalTree(existing, 'canvas')).toBe(true);
    expect(effectiveLexicon(trees.value.find((t) => t.id === unrelated)!)).toHaveLength(1);
    unassignLexicalTree(existing);
    expect(trees.value.some((t) => t.id === existing)).toBe(true);
    expect(effectiveLexicon(owner)).toHaveLength(0);
  });

  test('reusing a visually built terminal keeps its expression out of the feature structure', () => {
    const owner = activeTree.value;
    setTreeSource(owner.id, '[N]');
    const lexical = addTree('[N cat]');
    assignLexicalTree(lexical, 'tree', owner.id);
    expect(lexicalTreeSource(lexical)).toBe('[NP;spell="cat" [N]]');
    expect(lexicalTreeExpression(lexical)).toBe('cat');
    const result = deriveNanosyntax('[N]', effectiveLexicon(owner), 'starke2018');
    expect(result.complete).toBe(true);
    expect(result.surface).toEqual(['cat']);
    setLexicalExpression(lexical, 'dog');
    expect(lexicalTreeSource(lexical)).toBe('[NP;spell="dog" [N]]');
    expect(deriveNanosyntax('[N]', effectiveLexicon(owner), 'starke2018').surface).toEqual(['dog']);
  });

  test('nested terminal words remain phonology when a phrase is reused as an L-tree', () => {
    const owner = activeTree.value;
    setTreeSource(owner.id, '[NP [N]]');
    const lexical = addTree('[NP [N cat]]');
    assignLexicalTree(lexical, 'tree', owner.id);
    setLexicalExpression(lexical, 'cat');
    expect(lexicalTreeSource(lexical)).toContain('[N cat]');
    expect(effectiveLexicon(owner)[0].source).toContain('[N ]');
    expect(deriveNanosyntax('[NP [N]]', effectiveLexicon(owner), 'starke2018').surface).toEqual(['cat']);
  });

  test('owned lexical sheets remain adjacent through owner moves and visual resizing', () => {
    const owner = activeTree.value;
    const a = createLexicalTree('tree', owner.id, '[FP [F]]', 'a');
    const b = createLexicalTree('tree', owner.id, '[GP [G]]', 'b');
    const entry = (id: string) => trees.value.find((t) => t.id === id)!;
    expect(entry(a).x).toBe(owner.x + sheetSize(owner.id).w + 32);
    expect(entry(b).x).toBe(entry(a).x + sheetSize(a).w + 32);
    moveTree(owner.id, 220, 145);
    expect(entry(a).y).toBe(145);
    expect(entry(b).y).toBe(145);
    setLexicalExpression(a, 'a very long pronounced morpheme');
    expect(entry(b).x).toBe(entry(a).x + sheetSize(a).w + 32);
    setTreeSource(owner.id, '[VeryLongProjectionLabel [F1]]');
    expect(entry(a).x).toBe(220 + sheetSize(owner.id).w + 32);
    moveTree(a, entry(b).x + 1000, 900);
    expect(entry(a).y).toBe(145);
    expect(lexicalTreesFor('tree', owner.id).map((t) => t.id)).toEqual([b, a]);
  });

  test('owner removal preserves lexical trees in the shared lexicon region', () => {
    const owner = activeTree.value.id;
    const id = createLexicalTree('tree', owner, '[FP [F]]', 'root');
    addTree('[Other]');
    removeTree(owner);
    expect(lexicalTreesFor('canvas').map((t) => t.id)).toEqual([id]);
    expect(trees.value.find((t) => t.id === id)!.lexical!.owner).toBeUndefined();
    expect(effectiveLexicon(activeTree.value)[0].expression).toBe('root');
  });

  test('adding L-trees to an older S-tree clears adjacent foreign S-tree clusters', () => {
    const owner = activeTree.value.id;
    const foreign = addTree('[Other]');
    const foreignLexical = createLexicalTree('tree', foreign, '[XP [X]]', 'other');
    const before = trees.value.find((t) => t.id === foreign)!.x;
    const a = createLexicalTree('tree', owner, '[FP [F]]', 'first');
    const b = createLexicalTree('tree', owner, '[GP [G]]', 'second');
    const entry = (id: string) => trees.value.find((t) => t.id === id)!;
    expect(entry(foreign).x).toBeGreaterThan(before);
    expect(entry(a).x).toBe(entry(owner).x + sheetSize(owner).w + 32);
    expect(entry(b).x).toBe(entry(a).x + sheetSize(a).w + 32);
    expect(entry(foreign).x).toBeGreaterThanOrEqual(entry(b).x + sheetSize(b).w + 32);
    expect(entry(foreignLexical).x).toBe(entry(foreign).x + sheetSize(foreign).w + 32);
    const foreignPosition = { x: entry(foreign).x, y: entry(foreign).y };
    moveTree(owner, foreignPosition.x, foreignPosition.y);
    expect({ x: entry(foreign).x, y: entry(foreign).y }).toEqual(foreignPosition);
  });

  test('lexical expansion shifts all steps of a conflicting derivation together', () => {
    const owner = activeTree.value;
    const result = deriveNanosyntax('[G]', [{ id: 'g', expression: 'g', source: '[G]' }], 'starke2018');
    addDerivation(result, 'starke2018', owner);
    const steps = trees.value.filter((t) => t.derivation);
    const group = steps[0].derivation!.group;
    moveDerivation(group, owner.x + sheetSize(owner.id).w + 48 - steps[0].x, owner.y - steps[0].y);
    const before = trees.value.filter((t) => t.derivation?.group === group).map((t) => ({ id: t.id, x: t.x, y: t.y }));
    createLexicalTree('tree', owner.id, '[FP [F]]', 'a');
    createLexicalTree('tree', owner.id, '[GP [G]]', 'b');
    const moved = before.map((old) => {
      const t = trees.value.find((t) => t.id === old.id)!;
      expect(t.y).toBe(old.y);
      return t.x - old.x;
    });
    expect(moved[0]).toBeGreaterThan(0);
    expect(new Set(moved).size).toBe(1);
  });

  test('snapshots retain live lexical ownership and per-tree option inheritance', () => {
    const owner = activeTree.value.id;
    createLexicalTree('tree', owner, '[F1]', 'root');
    createLexicalTree('canvas', undefined, '[F2]', '-a');
    setNanosyntaxOptions('canvas', { algorithm: 'caha2019', hideLowerCopies: true });
    setNanosyntaxOptions('tree', { algorithm: 'starke2018' }, owner);
    const saved = snapshot(true);
    restore(saved);
    expect(lexicalTreesFor('tree', owner)).toHaveLength(1);
    expect(lexicalTreesFor('canvas')).toHaveLength(1);
    expect(effectiveLexicon(trees.value.find((t) => t.id === owner)!)).toHaveLength(2);
    expect(effectiveNanosyntaxOptions(owner)).toEqual({ algorithm: 'starke2018', hideLowerCopies: true });
    expect(canvasNanosyntaxOptions.value.algorithm).toBe('caha2019');
    expect(snapshot(true)).toEqual(saved);
  });

  test('independent movement, closure and reopening choices survive save/restore and inherit from canvas', () => {
    const owner = activeTree.value;
    const canvasAlgorithm = { movement: 'caha2025', closure: 'late', backtracking: 'multiple-merge' } as const;
    const treeAlgorithm = { movement: 'starke2018', closure: 'early', backtracking: 'aux-only' } as const;
    setNanosyntaxOptions('canvas', { algorithm: canvasAlgorithm });
    expect(effectiveNanosyntaxOptions(owner).algorithm).toEqual(canvasAlgorithm);
    setNanosyntaxOptions('tree', { algorithm: treeAlgorithm }, owner.id);
    const saved = snapshot(true);
    restore(saved);
    expect(effectiveNanosyntaxOptions(owner.id).algorithm).toEqual(treeAlgorithm);
    expect(canvasNanosyntaxOptions.value.algorithm).toEqual(canvasAlgorithm);
    setNanosyntaxOptions('tree', { algorithm: undefined }, owner.id);
    expect(effectiveNanosyntaxOptions(owner.id).algorithm).toEqual(canvasAlgorithm);
    const result = deriveNanosyntax('[X]', [{ id: 'x', source: '[X]', expression: 'x' }], canvasAlgorithm);
    addDerivation(result, canvasAlgorithm, activeTree.value);
    const withDerivation = snapshot(true);
    restore(withDerivation);
    expect(withDerivation.w?.groups?.[0].algorithm).toEqual(canvasAlgorithm);
    expect(effectiveNanosyntaxOptions(activeTree.value).algorithm).toEqual(canvasAlgorithm);
  });

  test('movement copies are absent from the following lexicalization sheet', () => {
    const owner = activeTree.value;
    const example = nanosyntaxExamples.find((entry) => entry.id === 'caha-friulian-1sg')!;
    const result = deriveNanosyntax(example.source, example.entries, example.algorithm);
    addDerivation(result, example.algorithm, owner);
    const members = trees.value.filter((tree) => tree.derivation);
    const movement = members.findIndex((tree) => tree.derivation!.action === 'move-complement');
    expect(lexicalTreeSource(members[movement])).toMatch(/#ns1/);
    expect(lexicalTreeSource(members[movement + 1])).not.toMatch(/#ns|\[\s*\]/);
  });

  test('separate workspaces become grouped sheets without a shared syntactic mother', () => {
    const example = nanosyntaxExamples.find((entry) => entry.id === 'starke-sugar-of')!;
    addDerivation(deriveNanosyntax(example.source, example.entries, example.algorithm), example.algorithm);
    const workspaceGroups = treeGroups.value.filter((group) => group.nanosyntax);
    expect(workspaceGroups.length).toBeGreaterThan(0);
    for (const group of workspaceGroups) {
      expect(group.members.length).toBeGreaterThan(1);
      const sheets = group.members.map((id) => trees.value.find((tree) => tree.id === id)!);
      expect(new Set(sheets.map((tree) => tree.derivation!.step)).size).toBe(1);
      expect(sheets.every((tree) => !lexicalTreeSource(tree).includes('[\\n'))).toBe(true);
    }
  });

  test('turning off nanosyntax hides sheets without removing them and preserves ordinary groups', () => {
    const owner = activeTree.value.id;
    const other = addTree('[G]');
    const group = createTreeGroup([owner, other], 'My group');
    const lexical = createLexicalTree('tree', owner, '[F1]', 'root');
    toggleNanosyntax();
    expect(visibleTrees.value.some((tree) => tree.id === lexical)).toBe(true);
    toggleNanosyntax();
    expect(visibleTrees.value.some((tree) => tree.id === lexical)).toBe(false);
    expect(trees.value.some((tree) => tree.id === lexical)).toBe(true);
    moveTreeGroup(group, 25, 40);
    const saved = snapshot(true);
    restore(saved);
    expect(nanosyntaxEnabled.value).toBe(false);
    expect(treeGroups.value.find((entry) => entry.id === group)?.members).toEqual([owner, other]);
    toggleNanosyntax();
    expect(visibleTrees.value.some((tree) => tree.id === lexical)).toBe(true);
  });

  test('a canvas L-tree can join a group and move with it without snapping back to the lexicon row', () => {
    const owner = activeTree.value.id;
    const group = createTreeGroup([owner]);
    const lexical = createLexicalTree('canvas', undefined, '[F1]', 'root');
    addToTreeGroup(lexical, group);
    const original = trees.value.find((tree) => tree.id === lexical)!;
    expect(original.x).toBe(activeTree.value.x + sheetSize(owner).w + 30);
    expect(original.y).toBe(activeTree.value.y);
    moveTreeGroup(group, 45, 60);
    const moved = trees.value.find((tree) => tree.id === lexical)!;
    expect(moved.x).toBe(original.x + 45);
    expect(moved.y).toBe(original.y + 60);
    expect(effectiveLexicon(activeTree.value).map((entry) => entry.expression)).toContain('root');
  });

  test('restoring an old canvas removes obsolete empty positions and arrows', () => {
    const code = '[ [XP#ns1 [X]] [ [#nsgap1] [YP [Y] [#nsgap2]]]]\n#nsgap1 -> #ns1 plain\n#nsgap2 -> #ns1 plain';
    restore({ s: code, w: {
      active: 'step', sources: { base: '[X]', step: code },
      trees: [
        { id: 'base', name: 'Base', src: 'base', x: 0, y: 0 },
        { id: 'step', name: 'Step', src: 'step', x: 400, y: 300, derivation: { group: 'g', step: 1, action: 'lexicalize', title: 'Spellout', detail: '', status: 'success', cycle: 1 } },
      ],
      groups: [{ id: 'g', name: 'Saved derivation', sourceTree: 'base', algorithm: 'caha2025', complete: true, unresolved: [], warnings: [], surface: ['x'] }],
    } });
    expect(source.value).not.toMatch(/nsgap|->|\[\s*\]/);
    expect(activeTree.value).toMatchObject({ id: 'step', x: 400, y: 300 });
  });

  test('old workspace snapshots split into separate grouped trees when restored', () => {
    const code = '[ [F2P [F2] [Base]] [F1P;spell="root" [F1]]]';
    restore({ s: code, w: {
      active: 'workspace', sources: { base: '[F2 [F1]]', workspace: code },
      trees: [
        { id: 'base', name: 'S-tree', src: 'base', x: 0, y: 0 },
        { id: 'workspace', name: 'Workspace: Merge F2', src: 'workspace', x: 0, y: 250, derivation: { group: 'g', step: 8, action: 'merge', title: 'Workspace: Merge F2', detail: '', status: 'info', cycle: 2 } },
      ],
      groups: [{ id: 'g', name: 'Legacy derivation', sourceTree: 'base', algorithm: 'starke2018', complete: true, unresolved: [], warnings: [], surface: ['pre-', 'root'] }],
    } });
    expect(treeGroups.value).toHaveLength(1);
    const members = treeGroups.value[0].members;
    expect(members).toHaveLength(2);
    expect(lexicalTreeSource(members[0])).toBe('[F2P [F2] [Base]]');
    expect(lexicalTreeSource(members[1])).toBe('[F1P;spell="root" [F1]]');
    const saved = snapshot(true);
    restore(saved);
    expect(snapshot(true)).toEqual(saved);
  });

  test('legacy panel lexicons materialize once, and compatibility updates change visible sheets', () => {
    restore({ s: '[F1]', w: { active: 's', sources: { src: '[F1]' }, trees: [{ id: 's', name: 'Old S-tree', src: 'src', x: 0, y: 0, lexicon: [{ id: 'old', source: '[F1]', expression: 'root' }] }], lexicon: [{ id: 'shared', source: '[F2]', expression: '-a' }] } });
    expect(lexicalTreesFor('tree', 's')).toHaveLength(1);
    expect(lexicalTreesFor('canvas')).toHaveLength(1);
    expect(canvasLexicon.value).toHaveLength(0);
    expect(activeTree.value.lexicon).toBeUndefined();
    const saved = snapshot(true);
    restore(saved);
    expect(trees.value).toHaveLength(3);
    const originalId = lexicalTreesFor('tree', 's')[0].id;
    setLexicon('tree', [{ id: 'old', source: '[F3 [F1]]', expression: 'new' }], 's');
    expect(lexicalTreesFor('tree', 's')[0].id).toBe(originalId);
    expect(effectiveLexicon(activeTree.value).map((e) => e.expression)).toEqual(['new', '-a']);
  });

  test('legacy bare heads become syntactic nodes before adding the lexical expression', () => {
    const owner = activeTree.value;
    setLexicon('tree', [{ id: 'legacy-prefix', source: '[F2P F2 Base]', expression: 'pre-' }], owner.id);
    const lexical = lexicalTreesFor('tree', owner.id)[0];
    expect(lexicalTreeSource(lexical)).toContain('[F2] [Base]');
    expect(lexicalTreeExpression(lexical)).toBe('pre-');
    const entries = [{ id: 'root', source: '[F1]', expression: 'root' }, ...effectiveLexicon(owner)];
    expect(deriveNanosyntax('[F2 [F1]]', entries, 'starke2018').surface).toEqual(['pre-', 'root']);
  });

  test.each(nanosyntaxExamples)('$title retains its paper derivation after visual lexical materialization', (example) => {
    const owner = activeTree.value;
    setTreeSource(owner.id, example.source);
    setLexicon('tree', example.entries, owner.id);
    const result = deriveNanosyntax(example.source, effectiveLexicon(owner), example.algorithm);
    expect(result.complete).toBe(true);
    expect(result.surface).toEqual(example.expectedSurface);
    expect(lexicalTreesFor('tree', owner.id)).toHaveLength(example.entries.length);
  });
});
