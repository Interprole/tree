import { describe, expect, test } from 'vitest';
import { parse, walkAst } from '../src/core/parser';
import type { ADoc, ANode } from '../src/core/ast';
import { standalonePiece, withoutBranch } from '../src/core/standalone';

function doc(src: string): ADoc {
  const r = parse(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.doc;
}
function node(d: ADoc, label: string): ANode {
  let out: ANode | null = null;
  walkAst(d.root!, (n) => !out && n.label === label && (out = n));
  return out!;
}

describe('a branch on its own in another tree, and what stays behind', () => {
  const src = '[CP [DP#wh what] [C\' [C did] [VP [V buy] #wh]]]\n#wh/2 -> #wh/1 dashed';
  test('a silent copy of a constituent outside the branch: written out in full, pronounced', () => {
    const d = doc(src);
    const p = standalonePiece(src, d, node(d, 'VP').span);
    expect(p.text).toBe('[VP [V buy] [DP what]]');
    expect(p.lines).toEqual([]);
    expect(parse(p.text).ok).toBe(true);
  });
  test('the constituent leaves: its highest copy left behind becomes it, the arrows go', () => {
    const d = doc(src);
    const out = withoutBranch(src, d, node(d, 'DP').span);
    expect(out).toBe("[CP [C' [C did] [VP [V buy] [DP#wh what]]]]");
    expect(parse(out).ok).toBe(true);
  });
  test('a branch with the whole chain inside keeps it, with its lines', () => {
    const d = doc(src);
    const p = standalonePiece(src, d, d.root!.span);
    expect(p.text).toContain('#wh');
    expect(p.lines).toEqual(['#wh/2 -> #wh/1 dashed']);
  });
  test('head movement to a head on the other side goes', () => {
    const s = '[TP [T#t -s] [VP [V#v;to=t sing] [DP it]]]';
    const d = doc(s);
    expect(standalonePiece(s, d, node(d, 'VP').span).text).toBe('[VP [V#v sing] [DP it]]');
    expect(withoutBranch(s, d, node(d, 'T').span)).toBe('[TP [VP [V#v sing] [DP it]]]');
  });
});
