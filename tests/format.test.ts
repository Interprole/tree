import { describe, expect, test } from 'vitest';
import { parse } from '../src/core/parser';
import type { ADoc, ALeaf, ANode } from '../src/core/ast';
import * as E from '../src/core/edits';
import { formatDoc, tidyEdit } from '../src/core/format';

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
/** apply a canvas edit the way the app does: then lay out the code around it */
function tidy(src: string, f: (d: ADoc) => E.Edit, up = 1) {
  const e = f(doc(src));
  const out = tidyEdit(src, e, e.select!.from, up);
  const text = E.applyChanges(src, out.changes);
  expect(parse(text).ok).toBe(true);
  return { text, sel: text.slice(out.select!.from, out.select!.to) };
}

describe('code layout', () => {
  test('a deep tree gets one daughter per line, indented under its mother', () => {
    expect(formatDoc('[TP [DP the cat] [T\' [T will] [VP [V eat] [DP fish]]]]')).toBe(
      ['[TP', '    [DP the cat]', "    [T'", '        [T will]', '        [VP [V eat] [DP fish]]]]'].join('\n'),
    );
    // a chain of single daughters: each on a new line too
    expect(formatDoc('[X [Y [CP [DP what] [C did]]]]')).toBe(['[X', '    [Y', '        [CP [DP what] [C did]]]]'].join('\n'));
  });
  test('shallow and short nodes stay on one line', () => {
    expect(formatDoc('[DP [D the] [N cat]]')).toBe('[DP [D the] [N cat]]');
    expect(formatDoc('[S [NP John]\n   [VP runs]]')).toBe('[S [NP John] [VP runs]]');
  });
  test('only whitespace changes: notes, features, meanings, glosses and comments stay', () => {
    const src = '[CP{wh} &"x" [DP#wh what | WH] % top\n [C\' [C did] [TP [DP she] [VP [V buy] #wh $λx. x$]]]]\n#wh -> #wh';
    const out = formatDoc(src);
    expect(out.replace(/\s+/g, '')).toBe(src.replace(/\s+/g, ''));
    expect(out).toContain('% top\n');
    expect(parse(out).ok).toBe(true);
    expect(formatDoc(out)).toBe(out);
  });
  test('adding a daughter on the canvas lays out the code', () => {
    const src = ['[TP', '    [DP the cat]', "    [T'", '        [T will]', '        [VP sleep]]]'].join('\n');
    const r = tidy(src, (d) => E.addChild(find(d, 'VP')));
    expect(r.text).toBe(['[TP', '    [DP the cat]', "    [T'", '        [T will]', '        [VP sleep [X]]]]'].join('\n'));
    expect(r.sel).toBe('X');
    const r2 = tidy(r.text, (d) => E.addChild(find(d, 'X')));
    expect(r2.text).toBe(['[TP', '    [DP the cat]', "    [T'", '        [T will]', '        [VP', '            sleep', '            [X [X]]]]]'].join('\n'));
  });
  test('a one-line tree that grows deep is broken into lines', () => {
    const src = '[S [NP John] [VP [V saw] [NP Mary]]]';
    const r = tidy(src, (d) => E.addChild(find(d, 'V').children[0] as ALeaf));
    expect(r.text).toBe(['[S', '    [NP John]', '    [VP', '        [V', '            [saw [X]]]', '        [NP Mary]]]'].join('\n'));
    expect(r.sel).toBe('X');
  });
  test('mothers added one after another: each on a new line', () => {
    let text = '[CP [DP what] [C did]]';
    for (let k = 0; k < 2; k++) text = tidy(text, (d) => E.addMother(d.root!)).text;
    expect(text).toBe(['[X', '    [X', '        [CP [DP what] [C did]]]]'].join('\n'));
  });
  test('a sister and a mother', () => {
    const src = '[S [NP John] [VP runs]]';
    expect(tidy(src, (d) => E.addSister(find(d, 'NP'))).text).toBe('[S [NP John] [X] [VP runs]]');
    const m = tidy(src, (d) => E.addMother(find(d, 'VP')));
    expect(m.text).toBe(['[S', '    [NP John]', '    [X [VP runs]]]'].join('\n'));
    expect(m.sel).toBe('X');
    expect(tidy(src, (d) => E.addMother(d.root!)).text).toBe(['[X', '    [S [NP John] [VP runs]]]'].join('\n'));
    // a mother above a terminal
    expect(tidy('[VP [V saw] [NP Mary]]', (d) => E.addMother(find(d, 'V').children[0] as ALeaf)).text).toBe(['[VP', '    [V [X saw]]', '    [NP Mary]]'].join('\n'));
  });
});

describe('arrows and chains in the code', () => {
  test('plain arrows and bend points are read and written back', () => {
    const d = doc('[S [A#a x] [B#b y]]\n#a -> #b plain via=0,40;-12.5,60');
    const a = d.arrows[0];
    expect(a.plain).toBe(true);
    expect(a.via).toEqual([
      [0, 40],
      [-12.5, 60],
    ]);
    expect(E.arrowLine(a)).toBe('#a -> #b plain via=0,40;-12,60');
  });
  test('a lower position pronounced with other words', () => {
    const src = '[CP [DP#s dei vrou] [TP #s [VP #s?]]]';
    const d = doc(src);
    const ref = find(d, 'TP').children[0] as never;
    expect(E.applyChanges(src, E.setRefText(ref, 'zij | she').changes)).toBe('[CP [DP#s dei vrou] [TP #s"zij | she" [VP #s?]]]');
    const silent = find(d, 'VP').children[0] as never;
    expect(E.applyChanges(src, E.setRefText(silent, 'zij').changes)).toBe('[CP [DP#s dei vrou] [TP #s [VP #s"zij"]]]');
    const d2 = doc('[CP [DP#s x] [TP #s!"zij"$y : e$]]');
    expect(E.setRefText(find(d2, 'TP').children[0] as never, null).changes[0].insert).toBe('#s!$y : e$');
  });
});
