import { describe, expect, test } from 'vitest';
import { applyChanges, setColor, setExpression } from '../src/core/edits';
import { fontFor, spelloutDomainNodes, spelloutDomains } from '../src/core/layout';
import { exportForest, exportQtree, exportTikz } from '../src/core/latex';
import { approxMeasure } from '../src/core/measure';
import { parse } from '../src/core/parser';
import { plain } from '../src/core/richtext';
import { buildScene } from '../src/core/scene';
import type { Prim } from '../src/core/scene';
import { serialize } from '../src/core/serialize';
import { defaultStyle } from '../src/core/style';
import { tree } from './helpers';

const texts = (prims: Prim[], role: string) => prims.filter((p) => p.t === 'text' && p.role === role).flatMap((p) => p.t === 'text' ? p.pieces : []);
const editExpression = (source: string, value: string) => {
  const p = parse(source);
  if (!p.ok) throw new Error(p.error.message);
  return applyChanges(source, setExpression(source, p.doc, p.doc.root!, value).changes);
};

describe('one expression for terminals and phrases', () => {
  test('a terminal expression is a word daughter and its syntactic head remains a label', () => {
    const source = editExpression('[Acc]', '-a');
    expect(source).toBe('[Acc;spell="-a"]');
    const t = tree(source);
    expect(t.root.kind).toBe('phrase');
    expect(t.root.spellout).toBeUndefined();
    expect(t.root.children[0].kind).toBe('leaf');
    expect(fontFor(t.root, defaultStyle).italic).toBeFalsy();
    expect(fontFor(t.root.children[0], defaultStyle).italic).toBe(true);
    expect(editExpression(source, '')).toBe('[Acc]');
    expect(serialize(t)).toBe(source);
  });

  test('a phrasal expression keeps its syntactic daughters and uses a side arrow', () => {
    const source = editExpression('[AccP [Acc] [NomP [Nom] [N]]]', '-a');
    const t = tree(source);
    expect(t.root.spellout?.runs.map((r) => r.text).join('')).toBe('-a');
    expect(t.root.children.map((n) => plain(n.label))).toEqual(['Acc', 'NomP']);
    expect(t.nodes.some((n) => n.kind === 'leaf')).toBe(false);
    const sc = buildScene(t, defaultStyle, approxMeasure);
    expect(texts(sc.prims, 'spellout').map((p) => p.text).join('')).toBe(' ⇒ -a');
    const cleared = tree(editExpression(source, ''));
    expect(cleared.root.spellout).toBeUndefined();
    expect(cleared.root.children).toHaveLength(2);
  });

  test('editing an older direct word on a phrase moves that expression into the same phrasal field', () => {
    const t = tree(editExpression('[XP old [X]]', 'new'));
    expect(t.root.spellout?.runs.map((r) => r.text).join('')).toBe('new');
    expect(t.root.children).toHaveLength(1);
    expect(t.root.children[0].kind).toBe('phrase');
  });

  test('old spell markers on preterminals can be edited without duplicating expression forms', () => {
    const source = editExpression('[N;spell="cat";spellside=left]', 'dog');
    expect(source).toBe('[N;spell="dog";spellside=left]');
    expect(editExpression('[N;spell="cat";spellside=left cat]', 'dog')).toBe('[N;spell="dog";spellside=left]');
  });
});

describe('italic expressions', () => {
  test('lexical entries use a bidirectional correspondence and can display a failed expression', () => {
    for (const failed of [false, true]) {
      const t = tree('[NumP;spell="fin"' + (failed ? ';spellfail=yes' : '') + ' [Num]]', { lexicalTree: true });
      const sc = buildScene(t, defaultStyle, approxMeasure);
      expect(texts(sc.prims, 'spellout').map((piece) => piece.text).join('')).toBe(failed ? ' ⇔ ∅' : ' ⇔ fin');
      expect(exportForest(t, defaultStyle, sc.layout, true)).toContain(failed ? '\\not\\Leftrightarrow' : '\\Leftrightarrow');
      expect(sc.prims.filter((primitive) => primitive.t === 'path' && primitive.role === 'deco')).toHaveLength(failed ? 1 : 0);
    }
  });
  test('only actual forms are italicized; feature heads and double arrows stay upright', () => {
    const t = tree('[AccP;spell="-a" [Acc] [NP [N cat]]]');
    const sc = buildScene(t, defaultStyle, approxMeasure);
    const expression = texts(sc.prims, 'spellout');
    expect(expression.find((p) => p.text === '-a')?.italic).toBe(true);
    expect(expression.find((p) => p.text.includes('⇒'))?.italic).toBe(false);
    expect(texts(sc.prims, 'label').every((p) => !p.italic)).toBe(true);
    expect(texts(sc.prims, 'leaf').every((p) => p.italic)).toBe(true);
    const regular = buildScene(t, { ...defaultStyle, leafItalic: false }, approxMeasure);
    expect(texts(regular.prims, 'spellout').every((p) => !p.italic)).toBe(true);
    expect(texts(regular.prims, 'leaf').every((p) => !p.italic)).toBe(true);
    for (const out of [exportForest(t, defaultStyle, sc.layout, false), exportQtree(t, defaultStyle, sc.layout, false)]) {
      expect(out).toContain('\\textit{-a}');
      expect(out).toContain('\\textit{cat}');
      expect(out).not.toContain('\\textit{Acc}');
      expect(out).not.toContain('\\textit{ $\\Rightarrow$');
    }
  });
});

describe('failed phrasal expressions', () => {
  test.each(['left', 'right'])('an empty failed phrase has a crossed %s arrow and ∅, and survives edits/serialization', (side) => {
    const source = `[AccP;spellfail=yes;spellside=${side} [Acc] [NomP [Nom]]]`;
    const t = tree(source);
    expect(t.root.spellout?.failed).toBe(true);
    const sc = buildScene(t, defaultStyle, approxMeasure);
    expect(texts(sc.prims, 'spellout').map((p) => p.text).join('')).toBe(side === 'left' ? '∅ ⇐ ' : ' ⇒ ∅');
    const slash = sc.prims.find((p) => p.t === 'path' && p.role === 'deco' && p.node === t.root.key);
    expect(slash?.t).toBe('path');
    expect(tree(serialize(t)).root.spellout?.failed).toBe(true);
    const p = parse(source);
    if (!p.ok) throw new Error(p.error.message);
    const colored = applyChanges(source, setColor(p.doc.root!, 'blue', false).changes);
    expect(tree(colored).root.spellout?.failed).toBe(true);
    for (const out of [exportForest(t, defaultStyle, sc.layout, true), exportQtree(t, defaultStyle, sc.layout, true)]) {
      expect(out).toContain(side === 'left' ? '\\nLeftarrow' : '\\nRightarrow');
      expect(out).toContain('\\varnothing');
    }
    expect(exportTikz(sc, false)).toContain('\\varnothing');
  });
});

describe('phrasal spellout domain circles', () => {
  test.each([false, true])('circles enclose the complete constituent, including failure=%s', (failed) => {
    const t = tree(`[AccP;spell="-a"${failed ? ';spellfail=yes' : ''} [Acc] [NomP [Nom] [N very-long-expression]]]`);
    const style = { ...defaultStyle, circlePhrasalSpellout: true };
    const sc = buildScene(t, style, approxMeasure);
    const domains = spelloutDomains(sc.layout);
    expect(domains).toHaveLength(1);
    expect(sc.prims.filter((p) => p.t === 'path' && p.role === 'spellout-domain')).toHaveLength(1);
    const box = domains[0].box;
    const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
    const rx = (box.x2 - box.x1) / 2, ry = (box.y2 - box.y1) / 2;
    for (const ln of sc.layout.list) for (const x of [ln.x - ln.block.w / 2, ln.x + ln.block.w / 2]) for (const y of [ln.y, ln.y + ln.block.fullH]) {
      expect(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2).toBeLessThan(1);
    }
    for (const piece of sc.prims.flatMap((p) => p.t === 'text' ? p.pieces : [])) {
      expect(piece.x).toBeGreaterThanOrEqual(0);
      expect(piece.x + piece.width).toBeLessThanOrEqual(sc.width + .01);
    }
    expect(buildScene(t, defaultStyle, approxMeasure).prims.some((p) => p.t === 'path' && p.role === 'spellout-domain')).toBe(false);
    for (const out of [exportForest(t, style, sc.layout, true), exportQtree(t, style, sc.layout, true)]) {
      expect(out).toContain('draw, ellipse, fit=');
      expect(out).toContain('fit, shapes.geometric');
    }
    const exact = exportTikz(sc, false);
    expect(exact).toContain('.. controls');
    expect(exact).toContain('-- cycle');
  });

  test('adjacent circles and inward expressions reserve space before layout', () => {
    const t = tree('[S [AccP;spellfail=yes;spellside=right [Acc] [NomP [Nom] [N cat]]] [VP;spell="will eat";spellside=left [V eat] [NP a very long object]]]');
    const sc = buildScene(t, { ...defaultStyle, circlePhrasalSpellout: true }, approxMeasure);
    const domains = spelloutDomains(sc.layout).sort((a, b) => a.box.x1 - b.box.x1);
    expect(domains).toHaveLength(2);
    expect(domains[0].box.x2).toBeLessThan(domains[1].box.x1);
    const words = sc.prims.filter((p) => p.t === 'text' && p.role === 'spellout').map((p) => p.t === 'text' ? p.pieces : []);
    expect(words).toHaveLength(2);
    const right = (pieces: typeof words[number]) => Math.max(...pieces.map((p) => p.x + p.width));
    const left = (pieces: typeof words[number]) => Math.min(...pieces.map((p) => p.x));
    words.sort((a, b) => left(a) - left(b));
    expect(right(words[0])).toBeLessThan(left(words[1]));
    // The same spacing must hold for empty failed constituents with no daughters.
    const empty = buildScene(tree('[S [XP;spellfail=yes] [YP;spellfail=yes]]'), { ...defaultStyle, circlePhrasalSpellout: true }, approxMeasure);
    const gaps = spelloutDomains(empty.layout).sort((a, b) => a.box.x1 - b.box.x1);
    expect(gaps[0].box.x2).toBeLessThan(gaps[1].box.x1);
  });

  test('inactive movement copies are excluded from a spelled domain', () => {
    const t = tree('[XP;spell="word" [DP#d a very wide moved phrase] [X #d]]');
    const domain = spelloutDomainNodes(t.root);
    expect(domain.length).toBeLessThan(t.nodes.length);
    expect(domain.every((n) => !n.copy)).toBe(true);
    const copy = t.nodes.find((n) => n.copy)!;
    expect(domain).not.toContain(copy);
    expect(copy.children.every((n) => !domain.includes(n))).toBe(true);
  });
});
