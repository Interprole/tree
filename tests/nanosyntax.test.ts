import { describe, expect, test } from 'vitest';
import { deriveNanosyntax, sequenceHiddenCopyArrows, validateLexicalEntry } from '../src/core/nanosyntax';
import type { LexicalEntry, NSAlgorithm, NSAlgorithmSettings } from '../src/core/nanosyntax';
import { parse } from '../src/core/parser';
import { nanosyntaxExamples } from '../src/core/nanosyntaxExamples';
import { tree } from './helpers';
import { buildScene } from '../src/core/scene';
import { defaultStyle } from '../src/core/style';
import { approxMeasure } from '../src/core/measure';
import { exportForest, exportQtree } from '../src/core/latex';
import { applyChanges, setColor } from '../src/core/edits';

const entry = (expression: string, source: string): LexicalEntry => ({ id: expression, expression, source });
const combinations: NSAlgorithmSettings[] = (['starke2018', 'caha2025'] as const).flatMap((movement) =>
  (['late', 'early'] as const).flatMap((closure) =>
    (['aux-only', 'multiple-merge'] as const).map((backtracking) => ({ movement, closure, backtracking }))));
const algorithms: NSAlgorithm[] = ['starke2018', 'caha2019', 'caha2025', ...combinations];

describe('phrasal spellout', () => {
  test('quoted Unicode, spaces, macros and punctuation survive unrelated edits', () => {
    const src = '[DP;spell="the \\"big\\" cat \\\\phi ; @ # $" [D the] [NP cat]]';
    const p = parse(src);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const next = applyChanges(src, setColor(p.doc.root!, 'red', false).changes);
    const q = parse(next);
    expect(q.ok).toBe(true);
    if (q.ok) expect(q.doc.root!.opts?.spell).toBe(p.doc.root!.opts?.spell);
  });
  test('renders a separate annotation on either side, preserving the subtree and exports', () => {
    for (const side of ['left', 'right']) {
      const t = tree('[DP;spell="the cat";spellside=' + side + ' [D the] [NP cat]]');
      const sc = buildScene(t, defaultStyle, approxMeasure);
      const spell = sc.prims.find((p) => p.t === 'text' && p.role === 'spellout');
      expect(spell?.t).toBe('text');
      if (spell?.t === 'text') expect(spell.pieces.map((p) => p.text).join('')).toBe(side === 'left' ? 'the cat ⇐ ' : ' ⇒ the cat');
      expect(t.root.children).toHaveLength(2);
      expect(exportForest(t, defaultStyle, sc.layout, false)).toContain(side === 'left' ? 'Leftarrow' : 'Rightarrow');
      expect(exportQtree(t, defaultStyle, sc.layout, false)).toContain('the cat');
      if (spell?.t === 'text') for (const p of spell.pieces) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(sc.width);
      }
    }
  });
  test('reserves the combined width of a spellout and a note on the same side', () => {
    const t = tree('[DP;spell="a long lexical expression";spellside=left &left"focus" [NP cat]]');
    const sc = buildScene(t, defaultStyle, approxMeasure);
    for (const p of sc.prims) if (p.t === 'text') for (const piece of p.pieces) {
      expect(piece.x).toBeGreaterThanOrEqual(0);
      expect(piece.x + piece.width).toBeLessThanOrEqual(sc.width + .01);
    }
  });
});

for (const algorithm of algorithms) describe(typeof algorithm === 'string' ? algorithm : JSON.stringify(algorithm), () => {
  test('explicit bracketed heads and compact feature spines agree', () => {
    const r = deriveNanosyntax('[F2P [F2] [F1P [F1]]]', [entry('root', '[F2 [F1]]')], algorithm);
    expect(r.complete).toBe(true);
    expect(r.surface).toEqual(['root']);
    expect(r.steps.filter((s) => s.action === 'merge')).toHaveLength(2);
    const prefix = deriveNanosyntax('[F2 [F1]]', [entry('root', '[F1]'), entry('pre-', '[F2P [F2] [Base]]')], algorithm);
    expect(prefix.complete).toBe(true);
    expect(prefix.surface).toEqual(['pre-', 'root']);
  });
  test('superset matching lexicalises every cycle and overrides lower spellout', () => {
    const r = deriveNanosyntax('[F3 [F2 [F1]]]', [entry('word', '[F3 [F2 [F1]]]')], algorithm);
    expect(r.complete).toBe(true);
    expect(r.surface).toEqual(['word']);
    expect(r.steps.filter((s) => s.action === 'merge')).toHaveLength(3);
    expect(r.steps.filter((s) => s.action === 'lexicalize')).toHaveLength(3);
    for (const step of r.steps) expect(parse(step.source).ok, step.source).toBe(true);
  });
  test('matches full constituents, not subsets of a feature inventory; reports partial coverage', () => {
    const r = deriveNanosyntax('[F3 [F2 [F1]]]', [entry('root', '[F1]'), entry('other', '[F3 [Z [F2]]]')], algorithm);
    expect(r.complete).toBe(false);
    expect(r.unresolved).toContain('F3P');
    expect(r.source).toContain('@red');
    expect(r.surface).toContain('root');
  });
  test('an unrelated binary root cannot replace the required features through Merge-XP', () => {
    const r = deriveNanosyntax('[NP N Original]', [entry('other-root', '[NP N Other]')], algorithm);
    expect(r.complete).toBe(false);
    expect(r.source).toContain('Original');
    expect(r.surface).toEqual([]);
  });
  test('complement and spec movement produce suffixes and valid chains', () => {
    const r = deriveNanosyntax('[F3 [F2 [F1]]]', [entry('root', '[F1]'), entry('-a', '[F3 [F2]]')], algorithm);
    expect(r.complete).toBe(true);
    expect(r.surface).toEqual(['root', '-a']);
    expect(r.steps.some((s) => s.action === 'move-complement')).toBe(true);
    expect(r.steps.some((s) => s.action === 'move-spec')).toBe(true);
    for (const s of r.steps) { expect(parse(s.source).ok, s.source).toBe(true); expect(() => tree(s.source)).not.toThrow(); }
  });
  test('backtracks an earlier direct spellout to rescue a higher feature', () => {
    const r = deriveNanosyntax('[F3 [F2 [F1]]]', [entry('root', '[F2 [F1]]'), entry('-a', '[F3 [F2]]')], algorithm);
    expect(r.complete).toBe(true);
    expect(r.steps.some((s) => s.action === 'backtrack')).toBe(true);
    expect(r.surface).toEqual(['root', '-a']);
  });
  test('spawns a prefix only after rescue and backtracking fail', () => {
    const r = deriveNanosyntax('[F2 [F1]]', [entry('root', '[F1]'), entry('pre-', '[F2P F2 Base]')], algorithm);
    expect(r.complete).toBe(true);
    expect(r.surface).toEqual(['pre-', 'root']);
    expect(r.steps.some((s) => s.action === 'spawn')).toBe(true);
    expect(r.steps.filter((s) => s.title.startsWith('Workspace:'))).not.toHaveLength(0);
    for (const s of r.steps) expect(parse(s.source).ok, s.source).toBe(true);
  });
  test('coordinated growth replaces a smaller prefix in its own workspace', () => {
    const r = deriveNanosyntax('[F3 [F2 [F1]]]', [entry('root', '[F1]'), entry('pre-', '[F3P F3 [F2P F2 Base]]')], algorithm);
    expect(r.complete).toBe(true);
    expect(r.surface).toEqual(['pre-', 'root']);
    expect(r.steps.some((s) => s.action === 'grow')).toBe(true);
  });
  test('larger later spellout can cover a temporarily unresolved lower domain', () => {
    const r = deriveNanosyntax('[F2 [F1]]', [entry('portmanteau', '[F2 [F1]]')], algorithm);
    expect(r.complete).toBe(true);
  });
  test('Elsewhere chooses the smaller entry and reports equal-size alternatives', () => {
    const small = entry('specific', '[F1]');
    const large = entry('general', '[F3 [F2 [F1]]]');
    const r = deriveNanosyntax('[F1]', [large, small, entry('alternative', '[F1]')], algorithm);
    expect(r.surface).toEqual(['specific']);
    expect(r.warnings.join(' ')).toContain('alternative');
  });
  test('search limits report incomplete exploration and keep a final tree', () => {
    const r = deriveNanosyntax('[F3 [F2 [F1]]]', [entry('root', '[F1]')], algorithm, { maxAttempts: 1 });
    expect(r.complete).toBe(false);
    expect(r.limited).toBe(true);
    expect(parse(r.source).ok).toBe(true);
    expect(r.steps.at(-1)?.source).toBe(r.source);
    expect(r.steps.at(-1)?.title).toContain('Partial lexicalisation');
  });
});

describe('Multiple Merge (Caha 2019, §7.3)', () => {
  const base = [entry('a', '[F1]'), entry('b', '[F2P [F2] [Base]]')];
  const upperAux = entry('B', '[F3P [F3] [F2P [F2] [Base]]]');
  const upperMain = entry('A', '[F3 [F1]]');
  for (const movement of ['starke2018', 'caha2025'] as const) {
    const settings: NSAlgorithmSettings = { movement, closure: 'early', backtracking: 'multiple-merge' };
    test(movement + ': F survives in both reopened workspaces, preserving order', () => {
      const entries = [...base, upperAux, upperMain];
      const result = deriveNanosyntax('[F3 [F2 [F1]]]', entries, settings);
      expect(result.complete).toBe(true);
      expect(result.surface).toEqual(['B', 'A']);
      expect(result.source.match(/\[F3\]/g)).toHaveLength(2);
      const auxOnly = deriveNanosyntax('[F3 [F2 [F1]]]', entries, { ...settings, backtracking: 'aux-only' });
      expect(auxOnly.surface).toEqual(['B', 'a']);
      const reopen = result.steps.find((step) => step.title === 'Multiple Merge: reopen all workspaces')!;
      expect(reopen.workspaces).toHaveLength(2);
      for (const step of result.steps) {
        expect(parse(step.source).ok, step.source).toBe(true);
        expect(() => tree(step.source)).not.toThrow();
        const movement = ['move-spec', 'move-complement', 'subextract', 'pied-pipe'].includes(step.action);
        expect(tree(step.source).arrows).toHaveLength(movement ? 1 : 0);
      }
    });
    test(movement + ': success in just MAIN is sufficient; failed AUX F is undone', () => {
      const result = deriveNanosyntax('[F3 [F2 [F1]]]', [...base, upperMain], settings);
      expect(result.complete).toBe(true);
      expect(result.surface).toEqual(['b', 'A']);
      expect(result.source.match(/\[F3\]/g)).toHaveLength(1);
      expect(result.source).not.toContain('spellfail');
      expect(deriveNanosyntax('[F3 [F2 [F1]]]', [...base, upperMain], { ...settings, backtracking: 'aux-only' }).complete).toBe(false);
    });
    test(movement + ': success in just AUX is sufficient; failed MAIN F is undone', () => {
      const result = deriveNanosyntax('[F3 [F2 [F1]]]', [...base, upperAux], settings);
      expect(result.complete).toBe(true);
      expect(result.surface).toEqual(['B', 'a']);
      expect(result.source.match(/\[F3\]/g)).toHaveLength(1);
      expect(result.source).not.toContain('spellfail');
    });
    test(movement + ': failure in every reopened workspace precedes a new AUX', () => {
      const result = deriveNanosyntax('[F3 [F2 [F1]]]', [...base, entry('c', '[F3P [F3] [Other]]')], settings);
      expect(result.complete).toBe(true);
      expect(result.surface).toEqual(['c', 'b', 'a']);
      const failure = result.steps.findIndex((step) => step.title === 'Multiple Merge failed in every workspace');
      expect(failure).toBeGreaterThan(-1);
      expect(result.steps.slice(failure + 1).some((step) => step.title === 'Spawn a new workspace for F3')).toBe(true);
    });
    test(movement + ': recursively reopening an inner Spec distributes F to three branches', () => {
      const entries = [...base, entry('c', '[F3P [F3] [Other]]'),
        entry('C', '[F4P [F4] [F3P [F3] [Other]]]'),
        entry('B', '[F4P [F4] [F2P [F2] [Base]]]'),
        entry('A', '[F4 [F1]]')];
      const result = deriveNanosyntax('[F4 [F3 [F2 [F1]]]]', entries, settings);
      expect(result.complete).toBe(true);
      expect(result.surface).toEqual(['C', 'B', 'A']);
      expect(result.source.match(/\[F4\]/g)).toHaveLength(3);
      expect(result.steps.filter((step) => step.title === 'Multiple Merge: reopen all workspaces' && step.cycle === 4)).toHaveLength(2);
      expect(result.steps.some((step) => step.cycle === 4 && step.workspaces?.length === 3)).toBe(true);
    });
    test(movement + ': ordinary cycles backtrack independently inside a reopened workspace', () => {
      const entries = [entry('a', '[F2 [F1]]'), entry('b', '[F3P [F3] [Base]]'),
        entry('B', '[F4P [F4] [F3P [F3] [Base]]]'), entry('-d', '[F4 [F2]]')];
      const result = deriveNanosyntax('[F4 [F3 [F2 [F1]]]]', entries, settings);
      expect(result.complete).toBe(true);
      expect(result.surface).toEqual(['B', 'a', '-d']);
      expect(result.steps.some((step) => step.title === 'Multiple Merge: backtrack within a workspace')).toBe(true);
      expect(result.source.match(/\[F4\]/g)).toHaveLength(2);
      for (const step of result.steps) expect(() => tree(step.source)).not.toThrow();
    });
    test(movement + ': after Early Closure the next feature targets the combined root', () => {
      const result = deriveNanosyntax('[F4 [F3 [F2 [F1]]]]', [...base, upperAux, upperMain, entry('-e', '[F4]')], settings);
      expect(result.complete).toBe(true);
      expect(result.surface).toEqual(['B', 'A', '-e']);
      expect(result.source.match(/\[F4\]/g)).toHaveLength(1);
      expect(result.steps.filter((step) => step.cycle === 4).some((step) => step.action === 'backtrack')).toBe(false);
    });
  }
  test('Late Closure and Multiple Merge can be selected together', () => {
    const result = deriveNanosyntax('[F3 [F2 [F1]]]', [...base, upperMain], { movement: 'starke2018', closure: 'late', backtracking: 'multiple-merge' });
    expect(result.complete).toBe(true);
    expect(result.surface).toEqual(['b', 'A']);
    expect(result.steps.some((step) => step.title === 'Multiple Merge: reopen all workspaces')).toBe(true);
  });
});
test('rejects invalid lexicons and existing movement rather than silently changing their meaning', () => {
  expect(validateLexicalEntry(entry('', '[F]'))).toContain('expression');
  expect(() => deriveNanosyntax('[F2 [F1#x] #x]', [entry('x', '[F1]')], 'caha2025')).toThrow('base S-tree');
  expect(() => deriveNanosyntax('[F]', [], 'starke2018')).toThrow('at least one');
});

test('Caha 2025 subextracts from inside a complex specifier where Starke 2018 cannot', () => {
  const entries = [
    entry('root', '[F1]'),
    entry('-a', '[F4P F4 [ [F2P F2] [F3P F3]]]'),
  ];
  const old = deriveNanosyntax('[F4 [F3 [F2 [F1]]]]', entries, 'starke2018');
  const revised = deriveNanosyntax('[F4 [F3 [F2 [F1]]]]', entries, 'caha2025');
  expect(old.complete).toBe(false);
  expect(revised.complete).toBe(true);
  expect(revised.surface).toEqual(['root', '-a']);
  expect(revised.steps.some((s) => s.action === 'subextract')).toBe(true);
  for (const s of revised.steps) expect(parse(s.source).ok, s.source).toBe(true);
});


describe('checked examples from the supplied literature', () => {
  for (const ex of nanosyntaxExamples) test(ex.title, () => {
    const result = deriveNanosyntax(ex.source, ex.entries, ex.algorithm);
    expect(result.limited).toBe(false);
    expect(result.complete).toBe(true);
    expect(result.surface).toEqual(ex.expectedSurface);
    expect(ex.citation).toMatch(/(?:pp?\.|§)/);
    expect(result.steps.at(-1)?.source).toBe(result.source);
    expect(result.steps.at(-1)?.title).toContain('Fully lexicalised');
    expect(result.steps.at(-1)?.source).not.toBe(result.steps.at(-2)?.source);
    for (const step of result.steps) {
      expect(parse(step.source).ok, step.title + ': ' + step.source).toBe(true);
      expect(() => tree(step.source)).not.toThrow();
      // Every visible head is a syntactic node. Only ;spell stores phonology.
      const parsed = parse(step.source);
      const visit = (n: import('../src/core/ast').AChild): boolean => n.kind === 'leaf' || (n.kind === 'node' && n.children.some(visit));
      if (parsed.ok) expect(visit(parsed.doc.root!), step.source).toBe(false);
    }
  });
  test('late versus early closure really changes suffix scope and surface order', () => {
    const ex = nanosyntaxExamples.find((x) => x.id === 'caha-early-closure')!;
    const old = deriveNanosyntax(ex.source, ex.entries, 'starke2018');
    const early = deriveNanosyntax(ex.source, ex.entries, 'caha2019');
    const revised = deriveNanosyntax(ex.source, ex.entries, 'caha2025');
    expect(revised.surface).toEqual(['β', 'γ', 'α']);
    expect(old.surface).toEqual(['β', 'α', 'γ']);
    expect(early.surface).toEqual(['β', 'γ', 'α']);
    expect(old.steps.findIndex((s) => s.action === 'grow')).toBeGreaterThan(-1);
    expect(early.steps.some((s) => s.title.startsWith('Reopened workspace'))).toBe(false);
  });
  test('Caha 2019 reopens Mara AUX only after the main-spine movements fail', () => {
    const ex = nanosyntaxExamples.find((x) => x.id === 'caha-mara-portmanteau')!;
    const result = deriveNanosyntax(ex.source, ex.entries, 'caha2019');
    const reopen = result.steps.findIndex((s) => s.title === 'Reopen the auxiliary workspace');
    expect(reopen).toBeGreaterThan(-1);
    expect(result.steps.slice(0, reopen).some((s) => s.cycle === 3 && s.action === 'move-complement')).toBe(true);
    expect(result.steps[reopen + 1].title).toContain('Reopened workspace');
    const starke = deriveNanosyntax(ex.source, ex.entries, 'starke2018');
    expect(starke.steps.some((s) => s.title === 'Reopen the auxiliary workspace')).toBe(false);
    expect(starke.surface).toEqual(ex.expectedSurface);
  });
  test('only the 2024 subextraction algorithm derives Friulian 1SG with these entries', () => {
    const ex = nanosyntaxExamples.find((x) => x.id === 'caha-friulian-1sg')!;
    for (const algorithm of ['starke2018', 'caha2019'] as const) {
      expect(deriveNanosyntax(ex.source, ex.entries, algorithm).complete).toBe(false);
    }
    const revised = deriveNanosyntax(ex.source, ex.entries, 'caha2025');
    expect(revised.steps.some((s) => s.action === 'subextract')).toBe(true);
    expect(revised.surface).toEqual(['fin', '-iʃ']);
    expect(revised.surface).not.toContain('-s');
  });
  test('Czech jazyk and Ossetic max shrink below their original lexicalisation size', () => {
    for (const id of ['caha-czech-jazyka', 'caha-ossetic-max']) {
      const ex = nanosyntaxExamples.find((x) => x.id === id)!;
      const result = deriveNanosyntax(ex.source, ex.entries, ex.algorithm);
      expect(result.steps.some((s) => s.action === 'backtrack')).toBe(true);
    }
  });
});

test('only the copy involved in the current movement step and its arrow are shown', () => {
  const ex = nanosyntaxExamples.find((x) => x.id === 'caha-friulian-1sg')!;
  const result = deriveNanosyntax(ex.source, ex.entries, ex.algorithm);
  for (const step of result.steps) {
    expect(parse(step.source).ok, step.source).toBe(true);
    expect(() => tree(step.source)).not.toThrow();
    const rendered = tree(step.source);
    const movement = ['move-spec', 'move-complement', 'subextract', 'pied-pipe'].includes(step.action);
    expect(rendered.arrows).toHaveLength(movement ? 1 : 0);
    expect(step.source).not.toContain('nsgap');
    if (!movement) expect(rendered.nodes.some((node) => node.copyOf)).toBe(false);
  }
  expect(result.surface).toEqual(['fin', '-iʃ']);
});

test('saved empty positions are linked consecutively without losing arrow styling', () => {
  const old = '[ [XP#ns1 [X]] [ [#nsgap1] [#nsgap2] [#nsgap3]]]\n#nsgap1 -> #ns1 plain\n#nsgap2 -> #ns1 plain dashed @red\n#nsgap3 -> #ns1 plain';
  const updated = sequenceHiddenCopyArrows(old);
  expect(updated).toContain('#nsgap2 -> #nsgap1 plain dashed @red');
  expect(updated).toContain('#nsgap3 -> #nsgap2 plain');
  expect(tree(updated).arrows.map((arrow) => [arrow.from.id, arrow.to.id])).toEqual([
    ['nsgap1', 'ns1'], ['nsgap2', 'nsgap1'], ['nsgap3', 'nsgap2'],
  ]);
  expect(sequenceHiddenCopyArrows(updated)).toBe(updated);
});

test('failed phrasal matches have an explicit failed empty expression', () => {
  const result = deriveNanosyntax('[Acc [Nom]]', [entry('nom', '[Nom]')], 'caha2019');
  const failure = result.steps.find((s) => s.action === 'failure')!;
  expect(failure.source).toContain(';spell="∅";spellfail=yes');
  expect(result.source).toContain(';spell="∅";spellfail=yes');
  expect(result.complete).toBe(false);
  expect(result.surface).toEqual(['nom']);
});

test('auxiliary workspaces are displayed before the main spine from their first Merge', () => {
  const ex = nanosyntaxExamples.find((x) => x.id === 'caha-mara-portmanteau')!;
  const result = deriveNanosyntax(ex.source, ex.entries, ex.algorithm);
  const first = result.steps.find((s) => s.title.startsWith('Workspace: Merge'))!;
  const parsed = parse(first.source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.doc.root!.children[0]).toMatchObject({ kind: 'node', label: 'NumP' });
  expect(parsed.doc.root!.children[1]).toMatchObject({ kind: 'node', label: 'NP' });
  expect(first.source).toContain('[Num] [N]');
});

test('visual terminal expressions are ignored when recognizing bracketed syntactic heads', () => {
  const entries = [entry('a cat', '[DP [D the] [NP [N cat]]]')];
  const result = deriveNanosyntax('[DP [D this] [NP [N dog]]]', entries, 'caha2019');
  expect(result.complete).toBe(true);
  expect(result.surface).toEqual(['a cat']);
  expect(result.source).toContain('[D]');
  expect(result.source).toContain('[N]');
  expect(result.source).not.toContain('dog');
});


test('Elsewhere counts unused features rather than projection or Merge nodes', () => {
  const first = entry('branched', '[UP [U] [ [XP [X]] [YP [Y]]]]');
  const second = entry('spine', '[W [V [X]]]');
  const result = deriveNanosyntax('[X]', [first, second], 'caha2019');
  expect(result.surface).toEqual(['branched']);
  expect(result.warnings.join(' ')).toContain('spine');
});


test('a marked word is expression, while legacy explicit bare heads remain syntax', () => {
  const marked = deriveNanosyntax('[N]', [entry('cat', '[N;spell="cat" cat]')], 'caha2019');
  expect(marked.complete).toBe(true);
  expect(marked.source).toContain('[N]');
  expect(marked.surface).toEqual(['cat']);
  const legacyPrefix = deriveNanosyntax('[F2 [F1]]', [entry('root', '[F1;spell="root"]'), entry('pre-', '[F2P;spell="pre-" F2 Base]')], 'caha2019');
  expect(legacyPrefix.complete).toBe(true);
  expect(legacyPrefix.surface).toEqual(['pre-', 'root']);
  expect(legacyPrefix.source).toContain('[Base]');
});


test('a branching input combines independently lexicalised daughters without inventing a failing feature', () => {
  const result = deriveNanosyntax('[ [XP [X]] [YP [Y]]]', [entry('x', '[X]'), entry('y', '[Y]')], 'caha2025');
  expect(result.complete).toBe(true);
  expect(result.surface).toEqual(['x', 'y']);
  expect(result.steps.at(-1)?.title).toContain('Fully lexicalised');
  expect(result.steps.at(-1)?.title).toContain('Merge the two derived branches');
  expect(result.steps.some((s) => s.action === 'failure')).toBe(false);
  expect(result.source).not.toContain('spellfail');
});
