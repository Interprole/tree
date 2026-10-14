import { describe, expect, test } from 'vitest';
import { parse } from '../src/core/parser';
import type { ANode } from '../src/core/ast';

function ok(src: string) {
  const r = parse(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.doc;
}

describe('parser', () => {
  test('standard bracket notation', () => {
    const d = ok("[TP [DP the cat] [T' [T will] [VP [V eat] [DP fish]]]]");
    const root = d.root!;
    expect(root.label).toBe('TP');
    expect(root.children).toHaveLength(2);
    const dp = root.children[0] as ANode;
    expect(dp.label).toBe('DP');
    expect(dp.children[0]).toMatchObject({ kind: 'leaf', text: 'the cat' });
    expect((root.children[1] as ANode).label).toBe("T'");
  });

  test('spans point back into the source', () => {
    const src = '[S [NP John] [VP runs]]';
    const root = ok(src).root!;
    const np = root.children[0] as ANode;
    expect(src.slice(np.span.from, np.span.to)).toBe('[NP John]');
    expect(src.slice(np.labelSpan.from, np.labelSpan.to)).toBe('NP');
    const leaf = np.children[0];
    expect(src.slice(leaf.span.from, leaf.span.to)).toBe('John');
  });

  test('cyrillic and unicode', () => {
    const d = ok('[ИГ [Прил большая] [С кошка]]');
    expect(d.root!.label).toBe('ИГ');
    expect((d.root!.children[1] as ANode).children[0]).toMatchObject({ text: 'кошка' });
  });

  test('modifiers: id, head, colours', () => {
    const d = ok('[DP#1*@red [D@@#c00 the] [NP cat]]');
    const r = d.root!;
    expect(r).toMatchObject({ label: 'DP', id: '1', head: true, color: 'red' });
    expect((r.children[0] as ANode).branchColor).toBe('#c00');
    expect(d.ids.get('1')).toBe(r);
  });

  test('subscripts with braces in labels and features', () => {
    const d = ok('[DP_{i,j}{uφ, iT, EPP} the cat]');
    expect(d.root!.label).toBe('DP_{i,j}');
    expect(d.root!.features).toEqual(['uφ', 'iT', 'EPP']);
  });

  test('features block after a space and nested scripts', () => {
    const d = ok('[T {u\\phi_{3sg}, EPP} will]');
    expect(d.root!.features).toEqual(['u\\phi_{3sg}', 'EPP']);
  });

  test('triangle and glosses', () => {
    const d = ok('[VP [V čitaet | read.PRS.3SG] [DP ^knigu interesnuju | book.ACC | "an interesting book"]]');
    const v = (d.root!.children[0] as ANode).children[0];
    expect(v).toMatchObject({ kind: 'leaf', text: 'čitaet', gloss: ['read.PRS.3SG'] });
    const dp = d.root!.children[1] as ANode;
    expect(dp.triangle).toBe(true);
    expect(dp.children[0]).toMatchObject({ text: 'knigu interesnuju', gloss: ['book.ACC', '"an interesting book"'] });
  });

  test('multidominance references and arrows', () => {
    const d = ok('[&P [TP John [VP likes #1]] [&′ and [TP Mary [VP hates [DP#1 what]]]]]\n#1 -> #1 dashed "ATB"');
    expect(d.arrows[0]).toMatchObject({ from: '1', to: '1', line: 'dashed', label: 'ATB', head: 'end', route: 'under' });
  });

  test('arrow options', () => {
    const d = ok('[A#a [B#b x]]\n#b <-> #a curve dotted @blue bend=4,-20 % comment');
    expect(d.arrows[0]).toMatchObject({ head: 'both', route: 'curve', line: 'dotted', color: 'blue', bend: [4, -20] });
  });

  test('comments and escapes', () => {
    const d = ok('% a comment\n[S \\[x\\] y % trailing\n]');
    expect(d.root!.children[0]).toMatchObject({ text: '\\[x\\] y' });
  });

  test('qtree-style dotted labels', () => {
    expect(ok('[.DP the cat]').root!.label).toBe('DP');
  });

  test('empty label', () => {
    const d = ok('[ [D* the] [N cat]]');
    expect(d.root!.label).toBe('');
    expect(d.root!.children).toHaveLength(2);
  });

  test('mixed terminal and nodes', () => {
    const d = ok('[VP eat [DP fish]]');
    expect(d.root!.children.map((c) => c.kind)).toEqual(['leaf', 'node']);
  });
});

describe('parser errors', () => {
  const err = (src: string) => {
    const r = parse(src);
    if (r.ok) throw new Error('expected error');
    return r.error;
  };
  test('unclosed bracket points at the opening bracket', () => {
    const e = err('[S [NP John [VP runs]');
    expect(e.message).toMatch(/Missing "\]"/);
    expect(e.from).toBe(3); // the innermost unclosed bracket: [NP
  });
  test('stray closing bracket', () => {
    const e = err('[S x]]');
    expect(e.from).toBe(5);
  });
  test('unknown reference', () => {
    const e = err('[S [A #7]]');
    expect(e.message).toMatch(/#7/);
    expect(e.from).toBe(6);
  });
  test('duplicate id', () => {
    expect(err('[S [A#1 x] [B#1 y]]').message).toMatch(/Duplicate id/);
  });
  test('cycle', () => {
    expect(err('[S#1 [A #1]]').message).toMatch(/cannot dominate itself/);
  });
  test('two roots', () => {
    expect(err('[A x] [B y]').message).toMatch(/Only one tree/);
  });
  test('bad arrow option', () => {
    expect(err('[A#a [B#b x]]\n#a -> #b wiggly').message).toMatch(/Unknown arrow option/);
  });
  test('text outside the tree', () => {
    expect(err('hello [A x]').message).toMatch(/must start/);
  });
  test('empty input is not an error', () => {
    const r = parse('   % nothing\n');
    expect(r.ok && r.doc.root).toBe(null);
  });
});
