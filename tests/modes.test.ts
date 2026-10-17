import { examples } from '../src/examples';
import { describe, expect, test } from 'vitest';
import { show, tree } from './helpers';
import { plain } from '../src/core/richtext';

describe('X-bar mode', () => {
  const xb = (o: object = {}) => ({ mode: 'xbar' as const, xbar: { bar: 'always', headLabel: 'X', emptySpecs: false, barStyle: 'prime', expandWords: false, ...o } as never });
  const src = '[TP [DP the cat] [T will] [VP [V eat] [DP fish]]]';
  test('builds X′ levels from shorthand', () => {
    expect(show(tree(src, xb()))).toBe("[TP [DP the cat] [T′ [T will] [VP [V′ [V eat] [DP fish]]]]]");
  });
  test('manual mode keeps the tree as written', () => {
    expect(show(tree(src))).toBe('[TP [DP the cat] [T will] [VP [V eat] [DP fish]]]');
  });
  test('X′ only when needed', () => {
    expect(show(tree(src, xb({ bar: 'auto' })))).toBe("[TP [DP the cat] [T′ [T will] [VP [V eat] [DP fish]]]]");
  });
  test('never: flat phrases, also flattens written X′', () => {
    expect(show(tree("[TP [DP x] [T' [T will] [VP y]]]", xb({ bar: 'never' })))).toBe('[TP [DP x] [T will] [VP y]]');
  });
  test('X⁰ heads', () => {
    const t = tree(src, { mode: 'xbar', xbar: { headLabel: 'X0' } as never });
    const T = t.nodes.find((n) => n.label.some((r) => r.sup && r.text === '0'))!;
    expect(plain(T.label)).toBe('T0');
  });
  test('empty specifiers', () => {
    expect(show(tree('[VP [V eat] [DP fish]]', xb({ emptySpecs: true })))).toBe("[VP [∅] [V′ [V eat] [DP fish]]]");
  });
  test('expands one-word phrases', () => {
    expect(show(tree('[NP cats]', xb({ expandWords: true })))).toBe("[NP [N′ [N cats]]]");
    expect(show(tree('[NP cats]', xb()))).toBe('[NP cats]');
  });
  test('already projected trees are left alone', () => {
    const s = "[TP [DP the cat] [T' [T will] [VP [V' [V eat] [DP fish]]]]]";
    expect(show(tree(s, xb()))).toBe(show(tree(s)).replace(/'/g, '′'));
  });
  test('overline bar style', () => {
    const t = tree(src, { mode: 'xbar', xbar: { barStyle: 'bar' } as never });
    expect(t.nodes.some((n) => n.label.some((r) => r.over && r.text === 'T'))).toBe(true);
  });
  test('switching modes does not change the source tree', () => {
    for (const mode of ['xbar', 'manual'] as const) tree(src, { mode });
    expect(show(tree(src))).toBe('[TP [DP the cat] [T will] [VP [V eat] [DP fish]]]');
  });
});

describe('movement chains (# positions)', () => {
  const src = '[CP [DP#wh what] [C′ [C did] [TP you [VP [V see] #wh]]]]';
  const md = { chains: 'multidominance' as const };
  test('multidominance: one node, two mothers, no arrows', () => {
    const t = tree(src, md);
    const wh = t.nodes.find((n) => n.id === 'wh')!;
    expect(wh.parents.map((p) => plain(p.label))).toEqual(['CP', 'VP']);
    expect(t.nodes.filter((n) => plain(n.label) === 'what')).toHaveLength(1);
    expect(t.arrows).toHaveLength(0);
  });
  test('copies: highest position pronounced, lower one a silent copy, arrow between them', () => {
    const t = tree(src);
    const whats = t.nodes.filter((n) => plain(n.label) === 'what');
    expect(whats.map((n) => !!n.copy)).toEqual([false, true]);
    expect(t.nodes.every((n) => n.parents.length <= 1)).toBe(true);
    expect(t.arrows).toHaveLength(1);
    expect(t.arrows[0]).toMatchObject({ auto: true, chain: { id: 'wh', from: 2, to: 1 } });
  });
  test('traces: lower position becomes [DP t]', () => {
    const t = tree(src, { chains: 'traces' });
    expect(show(t)).toBe('[CP [DP what] [C′ [C did] [TP you [VP [V see] [DP t]]]]]');
  });
  test('several pronounced copies: #id! marks a position as overt, #id? as silent', () => {
    const t = tree('[CP [DP#wh? what] [C′ [C did] [TP you [VP [V see] #wh!]]]]');
    const whats = t.nodes.filter((n) => plain(n.label) === 'what');
    expect(whats.map((n) => !!n.copy)).toEqual([true, false]);
    const both = tree('[CP [DP#wh what] [TP [DP #wh!] [VP see #wh]]]');
    expect(both.nodes.filter((n) => plain(n.label) === 'what').map((n) => !!n.copy)).toEqual([false, false, true]);
  });
  test('movement indices are added on request and avoid binding indices', () => {
    const t = tree('[CP [DP#wh what] [TP [DP_i John] [VP thinks [DP himself_i] #wh]]]', { chainIndices: true, chains: 'traces' });
    const labels = t.nodes.map((n) => plain(n.label));
    expect(labels).toContain('DPj');
    expect(labels).toContain('tj');
  });
  test('chain arrows can be switched off', () => {
    expect(tree(src, { chainArrows: false }).arrows).toHaveLength(0);
  });
  test('coindexation alone creates no chain', () => {
    const t = tree('[CP [DP_i what] [VP see [DP t_i]]]');
    expect(t.arrows).toHaveLength(0);
  });
  test('an explicit line restyles one automatic arrow, "hide" removes it', () => {
    const t = tree(src + '\n#wh/2 -> #wh/1 dashed "wh"');
    expect(t.arrows).toHaveLength(1);
    expect(t.arrows[0]).toMatchObject({ line: 'dashed' });
    expect(t.arrows[0].labels.map((l) => l.runs[0].text)).toEqual(['wh']);
    expect(t.arrows[0].auto).toBeFalsy();
    expect(tree(src + '\n#wh/2 -> #wh/1 hide').arrows).toHaveLength(0);
  });
  test('works together with X-bar', () => {
    expect(tree(src, { mode: 'xbar', ...md }).nodes.find((n) => n.id === 'wh')!.parents).toHaveLength(2);
  });
});

describe('copies with their own words', () => {
  test('#id"text" pronounces a position differently', () => {
    const t = tree('[S [DP#a the man] [VP saw #a"him"]]', { chains: 'copies' });
    const words = t.nodes.filter((n) => n.kind === 'leaf').map((n) => plain(n.label));
    expect(words).toContain('him');
    expect(words).toContain('the man');
  });
});

describe('per-node options and notes', () => {
  test(';edge ;width ;len ;spread ;sem and notes reach the display tree', () => {
    const t = tree('[S;spread=10 [DP;edge=red;width=2;len=12;sem=blue &"focus" &left"x" she] [VP runs]]');
    const dp = t.nodes.find((n) => plain(n.label) === 'DP')!;
    expect(dp).toMatchObject({ edgeColor: 'red', edgeWidth: 2, edgeLen: 12, semColor: 'blue' });
    expect(dp.notes!.map((x) => [plain(x.runs), x.side])).toEqual([['focus', 'auto'], ['x', 'left']]);
    expect(t.root.spread).toBe(10);
  });
});

describe('head movement', () => {
  test('arrows between heads: source struck, target V+v+T', () => {
    const t = tree('[TP [T#t -s] [vP [v#v ∅] [VP [V#r sing] [DP songs]]]]\n#r -> #v\n#v -> #t');
    const lab = (id: string) => plain(t.nodes.find((n) => n.id === id)!.label);
    expect(lab('v')).toBe('V+v');
    expect(lab('t')).toBe('V+v+T');
    expect(t.nodes.find((n) => n.id === 'r')!.struck).toBe(true);
  });
  test('the words of the moved heads appear at the target, joined by +', () => {
    const t = tree('[TP [T#t -s] [vP [v#v ∅] [VP [V#r sing] [DP songs]]]]\n#r -> #v\n#v -> #t');
    const word = (id: string) => plain(t.nodes.find((n) => n.id === id)!.children[0].label);
    expect(word('v')).toBe('sing');
    expect(word('t')).toBe('sing+-s');
  });
  test('T-to-C example: C shows T+C and did, no edge between C and T', () => {
    const ex = examples.find((e) => e.id === 'wh')!;
    const t = tree(ex.src);
    const c = t.nodes.find((n) => n.id === 'c')!;
    expect(plain(c.label)).toBe('T+C');
    expect(plain(c.children[0].label)).toBe('did');
    expect(t.nodes.find((n) => n.id === 't')!.parents).toHaveLength(1);
  });
  test('arrows between phrases are not head movement', () => {
    const t = tree('[CP [DP#a what] [VP see [DP#b it]]]\n#b -> #a');
    expect(t.nodes.some((n) => n.struck)).toBe(false);
  });
});

describe('triangles', () => {
  test('a triangle over a structure keeps the structure in the source', () => {
    const t = tree('[S [DP ^ [D the] [NP [A big] [N cat]]] [VP runs]]');
    expect(show(t)).toBe('[S [DP the big cat] [VP runs]]');
    expect(t.nodes.find((n) => plain(n.label) === 'DP')!.triangle).toBe(true);
  });
});

describe('semantics in the tree', () => {
  test('meanings are computed bottom-up', () => {
    const t = tree('[S [DP Mary $mary : e$] [VP sleeps $λx. sleep(x)$]]');
    expect(plain(t.root.sem!.runs)).toBe('sleep(mary)');
    expect(t.root.sem!.rule).toBe('FA');
  });
  test('type errors are reported at the node', () => {
    const t = tree('[S [DP Mary $mary : e$] [DP John $john : e$]]');
    expect(t.root.sem!.error).toMatch(/No composition rule applies to e and e/);
  });
  test('a daughter without any meaning is skipped (vacuous)', () => {
    const t = tree('[S [C that] [VP sleeps $λx. sleep(x)$]]');
    expect(plain(t.root.sem!.runs)).toBe('λx. sleep(x)');
  });
  test('a lower position with its own meaning triggers Predicate Abstraction', () => {
    const t = tree('[S [DP#d everyone $λP. ∀x. P(x) : <<e,t>,t>$] [S\' [DP John $john : e$] [VP [V saw $λy.λx. saw(x,y) : <e,<e,t>>$] #d$z : e$]]]');
    // the sister S′ is abstracted over z where the moved DP composes with it
    expect(t.root.sem!.rule).toBe('PA+FA');
    expect(plain(t.root.sem!.runs)).toBe('∀x. saw(john, x)');
  });
  test('the rule can be hidden', () => {
    const t = tree('[S [DP Mary $mary : e$] [VP sleeps $λx. sleep(x)$]]', { semantics: { show: true, compute: true, types: false, rules: false } });
    expect(t.root.sem!.rule).toBeUndefined();
  });
  test('any type names work', () => {
    const t = tree('[S [DP tall $λx. height(x) > 3 : <e,t>$] [DP d $d : e$]]');
    expect(plain(t.root.sem!.runs)).toBe('height(d) > 3');
  });
  test('bad formulas are reported', () => {
    const t = tree('[N cat $λx. cat(x$]');
    expect(t.root.sem!.error).toBeTruthy();
  });
});

import { serialize } from '../src/core/serialize';
import { parse } from '../src/core/parser';
describe('serialize (as displayed)', () => {
  test('round-trips through the parser', () => {
    for (const src of ['[TP [DP the cat] [T will] [VP [V eat] [DP fish]]]', '[CP [DP#wh what] [C′ [C did] [TP you [VP [V see] #wh]]]]', '[T{uφ, EPP} [V čitaet | read.PRS] [DP ^big cats]]']) {
      for (const mode of ['manual', 'xbar'] as const) {
        const tr = tree(src, { mode });
        const out = serialize(tr);
        const r = parse(out);
        expect(r.ok, out).toBe(true);
        expect(show(tree(out))).toBe(show(tr));
      }
    }
  });
});

describe('meaning display', () => {
  test('typed binders are shown as subscripts', () => {
    const t = tree('[D the $λP_<e,t>. ιx. P(x)$]');
    expect(t.root.sem!.runs).toEqual([{ text: 'λP' }, { text: '⟨e,t⟩', sub: true }, { text: '. ιx. P(x)' }]);
  });
});

import { tree as mkTree2 } from './helpers';
import { plain as plainText } from '../src/core/richtext';
describe('copies pronounced with other words, plain arrows', () => {
  test('#id"words | gloss" shows the words with a gloss line', () => {
    const t = mkTree2('[CP [DP#s dei vrou] [TP #s"zij | she" [VP x]]]');
    const tp = t.nodes.find((n) => plainText(n.label) === 'TP')!;
    const pos = tp.children[0];
    expect(plainText(pos.children[0].label)).toBe('zij');
    expect(pos.children[0].gloss?.map(plainText)).toEqual(['she']);
    expect(pos.copy).toBeFalsy();
  });
  test('a plain arrow between heads is not head movement', () => {
    const src = '[TP [T#t -s] [VP [V#v sing] x]]\n#v -> #t';
    const moved = mkTree2(src);
    expect(moved.nodes.some((n) => n.struck)).toBe(true);
    const plainArrow = mkTree2(src + ' plain');
    expect(plainArrow.nodes.some((n) => n.struck)).toBe(false);
    expect(plainText(plainArrow.nodes.find((n) => n.id === 't')!.label)).toBe('T');
    expect(plainArrow.arrows).toHaveLength(1);
  });
});

describe('one position of a chain styled on its own', () => {
  test('#wh^@colour: the silent copy is a triangle in that colour, the pronounced one is not', () => {
    const t = mkTree2('[CP [DP#wh [D which] [NP book]] [VP [V buy] #wh^@blue]]');
    const [top, low] = t.nodes.filter((n) => plainText(n.label) === 'DP');
    expect(top.triangle).toBeFalsy();
    expect(top.posColor).toBeUndefined();
    expect(low.triangle).toBe(true);
    expect(plainText(low.children[0].label)).toBe('which book');
    expect(low.posColor).toBe('blue');
    expect(low.children[0].posColor).toBe('blue');
  });
  test('a trace as a triangle', () => {
    const t = mkTree2('[CP [DP#wh what] [VP [V buy] #wh^]]', { chains: 'traces' });
    const tr = t.nodes.find((n) => n.trace && n.kind === 'phrase')!;
    expect(tr.triangle).toBe(true);
  });
});

describe('this copy or all copies', () => {
  const src = '[CP [DP#wh [D which] [NP book] &"focus"] [VP [V buy] #wh]]';
  test('what is written on the constituent goes to every copy', () => {
    const t = mkTree2(src);
    const dps = t.nodes.filter((n) => plainText(n.label) === 'DP');
    expect(dps).toHaveLength(2);
    for (const d of dps) expect(d.notes?.map((x) => plainText(x.runs))).toEqual(['focus']);
  });
  test('a line #wh/1: styles the pronounced copy only, #wh/2: the silent one only', () => {
    const t = mkTree2(src + '\n#wh/1: @red {uφ} &"top"\n#wh/2: ^ edge=blue width=2 $x : e$');
    const [top, low] = t.nodes.filter((n) => plainText(n.label) === 'DP');
    expect(top.posColor).toBe('red');
    expect(top.features?.map(plainText)).toEqual(['uφ']);
    expect(top.notes?.map((x) => plainText(x.runs))).toEqual(['focus', 'top']);
    expect(top.triangle).toBeFalsy();
    expect(low.posColor).toBeUndefined();
    expect(low.triangle).toBe(true);
    expect(low.edgeColor).toBe('blue');
    expect(low.edgeWidth).toBe(2);
    expect(low.notes?.map((x) => plainText(x.runs))).toEqual(['focus']);
  });
});

describe('a restyled chain arrow follows the view', () => {
  const src = '[CP [DP#wh what] [VP buy #wh]]\n#wh/2 -> #wh/1 dashed';
  test('drawn with copies and traces, not in multidominance or with the chain arrows off', () => {
    expect(mkTree2(src).arrows).toHaveLength(1);
    expect(mkTree2(src).arrows[0].line).toBe('dashed');
    expect(mkTree2(src, { chains: 'traces' }).arrows).toHaveLength(1);
    expect(mkTree2(src, { chains: 'multidominance' }).arrows).toHaveLength(0);
    expect(mkTree2(src, { chainArrows: false }).arrows).toHaveLength(0);
  });
});

describe('movement written in the tree', () => {
  test(';to= is head movement with its arrow; plain lines are just arrows; hide keeps the movement', () => {
    const src = '[TP [T#t -s] [VP [V#v;to=t sing] [DP it]]]';
    const t = mkTree2(src);
    expect(plainText(t.nodes.find((n) => n.id === 't')!.label)).toBe('V+T');
    expect(t.arrows).toHaveLength(1);
    expect(t.arrows[0].headMove).toEqual({ from: 'v', to: 't' });
    expect(mkTree2(src + '\n#v -> #t hide').arrows).toHaveLength(0);
    expect(plainText(mkTree2(src + '\n#v -> #t hide').nodes.find((n) => n.id === 't')!.label)).toBe('V+T');
    expect(mkTree2(src, { headArrows: false }).arrows).toHaveLength(0);
    expect(mkTree2(src + '\n#v -> #t visible', { headArrows: false }).arrows).toHaveLength(1);
    expect(mkTree2(src + '\n#v -> #t dashed').arrows[0].line).toBe('dashed');
    const plainOnly = mkTree2('[TP [T#t -s] [VP [V#v sing] [DP it]]]\n#v -> #t plain', { headArrows: false });
    expect(plainOnly.arrows).toHaveLength(1);
    expect(plainText(plainOnly.nodes.find((n) => n.id === 't')!.label)).toBe('T');
  });
  test('one copy open or in the default colour although all copies are not', () => {
    const t = mkTree2('[CP [DP#wh@red ^ [D which] [NP book]] [VP buy #wh]]\n#wh/2: open @none');
    const [top, low] = t.nodes.filter((n) => plainText(n.label) === 'DP');
    expect(top.triangle).toBe(true);
    expect(low.triangle).toBe(false);
    expect(low.children.map((c) => plainText(c.label))).toEqual(['D', 'NP']);
    expect(low.color).toBeUndefined();
    expect(top.color).toBe('red');
  });
});
