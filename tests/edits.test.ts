import { describe, expect, test } from 'vitest';
import { parse } from '../src/core/parser';
import type { ADoc, ANode, ALeaf } from '../src/core/ast';
import * as E from '../src/core/edits';

function doc(src: string): ADoc {
  const r = parse(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.doc;
}
function find(d: ADoc, label: string): ANode {
  let out: ANode | null = null;
  const visit = (n: ANode) => {
    if (n.label === label && !out) out = n;
    n.children.forEach((c) => c.kind === 'node' && visit(c));
  };
  visit(d.root!);
  if (!out) throw new Error('no ' + label);
  return out;
}
function run(src: string, f: (d: ADoc) => E.Edit) {
  const out = E.applyChanges(src, f(doc(src)).changes);
  const r = parse(out);
  if (!r.ok) throw new Error(`does not parse: ${out}\n${r.error.message}`);
  return out;
}

describe('canvas edits keep the text valid', () => {
  const src = '[S [NP John] [VP [V saw] [NP Mary]]]';
  test('rename', () => {
    expect(run(src, (d) => E.renameNode(src, find(d, 'VP'), "V'"))).toBe("[S [NP John] [V' [V saw] [NP Mary]]]");
    expect(run(src, (d) => E.renameNode(src, find(d, 'VP'), 'big [phrase]'))).toBe('[S [NP John] [big~\\[phrase\\] [V saw] [NP Mary]]]');
  });
  test('rename an empty label', () => {
    expect(run('[ [A x] [B y]]', (d) => E.renameNode('[ [A x] [B y]]', d.root!, 'S'))).toBe('[S [A x] [B y]]');
    expect(run('[[A x]]', (d) => E.renameNode('[[A x]]', d.root!, 'S'))).toBe('[S [A x]]');
  });
  test('rename a terminal', () => {
    expect(run(src, (d) => E.renameLeaf(find(d, 'V').children[0] as ALeaf, 'kissed'))).toBe('[S [NP John] [VP [V kissed] [NP Mary]]]');
  });
  test('add daughter and sister', () => {
    expect(run(src, (d) => E.addChild(find(d, 'VP')))).toBe('[S [NP John] [VP [V saw] [NP Mary] [X]]]');
    expect(run(src, (d) => E.addSister(find(d, 'V')))).toBe('[S [NP John] [VP [V saw] [X] [NP Mary]]]');
  });
  test('delete a node', () => {
    expect(run(src, (d) => E.deleteElement(src, d, find(d, 'VP')))).toBe('[S [NP John]]');
  });
  test('delete a shared node removes its references and arrows', () => {
    const s = '[S [A#1 x] [B #1]]\n#1 -> #1';
    const out = run(s, (d) => E.deleteElement(s, d, find(d, 'A')));
    expect(out).toBe('[S [B]]');
  });
  test('triangle on and off keeps the structure', () => {
    const tri = run(src, (d) => E.toggleTriangle(src, find(d, 'VP')));
    expect(tri).toBe('[S [NP John] [VP ^ [V saw] [NP Mary]]]');
    expect(run(tri, (d) => E.toggleTriangle(tri, find(d, 'VP')))).toBe(src);
    const s2 = '[ [A x] [B y]]';
    const t2 = run(s2, (d) => E.toggleTriangle(s2, d.root!));
    expect(t2).toBe('[^ [A x] [B y]]');
    expect(run(t2, (d) => E.toggleTriangle(t2, d.root!))).toBe('[[A x] [B y]]');
  });
  test('daughter of a terminal', () => {
    expect(run(src, (d) => E.addChild(find(d, 'V').children[0] as ALeaf))).toBe('[S [NP John] [VP [V [saw [X]]] [NP Mary]]]');
  });
  test('copies: a new position of an existing constituent', () => {
    expect(run(src, (d) => E.addCopy(d, find(d, 'NP'), { kind: 'daughter', of: find(d, 'VP') }))).toBe('[S [NP#np John] [VP [V saw] [NP Mary] #np]]');
    expect(run(src, (d) => E.addCopy(d, find(d, 'NP'), { kind: 'sister', of: find(d, 'V') }))).toBe('[S [NP#np John] [VP [V saw] #np [NP Mary]]]');
  });
  test('features and meanings', () => {
    expect(run(src, (d) => E.setFeatures(find(d, 'VP'), 'uφ, EPP'))).toBe('[S [NP John] [VP{uφ, EPP} [V saw] [NP Mary]]]');
    expect(run(src, (d) => E.setMeaning(find(d, 'V'), 'λx. λy. see(x)(y)'))).toBe('[S [NP John] [VP [V saw $λx. λy. see(x)(y)$] [NP Mary]]]');
  });
  test('pronunciation of chain positions', () => {
    const s3 = '[CP [DP#wh what] [VP see #wh]]';
    const d = doc(s3);
    const ref = (find(d, 'VP').children[1]) as never;
    expect(E.applyChanges(s3, E.setPronounce({ ref }, true).changes)).toBe('[CP [DP#wh what] [VP see #wh!]]');
    expect(E.applyChanges(s3, E.setPronounce({ node: find(d, 'DP') }, false).changes)).toBe('[CP [DP#wh? what] [VP see #wh]]');
  });
  test('bundling sister heads', () => {
    const s4 = '[TP [T -s] [Agr 3sg] [VP go]]';
    expect(run(s4, (d) => E.bundle(s4, find(d, 'T'), find(d, 'Agr')))).toBe('[TP [T.Agr -s 3sg] [VP go]]');
  });
  test('re-bracketing', () => {
    const s5 = '[VP [V give] [DP a] [PP b]]';
    const right = run(s5, (d) => E.restructure(s5, d.root!, 'right'));
    expect(right).toBe('[VP [V give] [VP [DP a] [PP b]]]');
    expect(run(s5, (d) => E.restructure(s5, d.root!, 'left'))).toBe('[VP [VP [V give] [DP a]] [PP b]]');
    expect(run(right, (d) => E.restructure(right, d.root!, 'flat'))).toBe(s5);
  });
  test('colours', () => {
    expect(run(src, (d) => E.setColor(find(d, 'VP'), 'red', false))).toBe('[S [NP John] [VP@red [V saw] [NP Mary]]]');
    expect(run(src, (d) => E.setColor(find(d, 'VP'), '#06c', true))).toBe('[S [NP John] [VP@@#06c [V saw] [NP Mary]]]');
    const c = '[S [VP#v@red x]]';
    expect(run(c, (d) => E.setColor(find(d, 'VP'), null, false))).toBe('[S [VP#v x]]');
  });
  test('head marks move between sisters', () => {
    const s = '[ [D* the] [N cat]]';
    expect(run(s, (d) => E.setHead(find(d, 'N'), d.root, true))).toBe('[ [D the] [N* cat]]');
  });
  test('arrows: add (with ids), restyle, delete', () => {
    const withArrow = run(src, (d) => E.addArrow(src, d, { node: find(d, 'V') }, { node: find(d, 'S') }));
    expect(withArrow).toBe('[S#s [NP John] [VP [V#v saw] [NP Mary]]]\n#v -> #s\n');
    const d2 = doc(withArrow);
    const restyled = E.applyChanges(withArrow, E.updateArrow(d2.arrows[0], { line: 'dashed', label: 'head mvt', bend: [0, 20] }).changes);
    expect(restyled).toContain('#v -> #s dashed "head mvt" bend=0,20');
    const d3 = doc(restyled);
    expect(E.applyChanges(restyled, E.deleteArrow(restyled, d3.arrows[0]).changes).trim()).toBe('[S#s [NP John] [VP [V#v saw] [NP Mary]]]');
  });
  test('ids are unique', () => {
    const s = '[S [NP#np x] [NP y]]';
    const d = doc(s);
    const second = d.root!.children[1] as ANode;
    const r = E.ensureId(d, second);
    expect(r.id).toBe('np2');
  });
});
