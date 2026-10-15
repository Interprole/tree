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
    for (const mode of ['xbar', 'bps', 'manual'] as const) tree(src, { mode });
    expect(show(tree(src))).toBe('[TP [DP the cat] [T will] [VP [V eat] [DP fish]]]');
  });
});

describe('BPS mode', () => {
  const src = '[ [ [D* the] [N cat]] [* [T* will] [ [V* eat] [N fish]]]]';
  test('category labels', () => {
    expect(show(tree(src, { mode: 'bps' }))).toBe('[T [D [D the] [N cat]] [T [T will] [V [V eat] [N fish]]]]');
  });
  test('head labels', () => {
    expect(show(tree(src, { mode: 'bps', bps: { label: 'head' } }))).toBe('[will [the [D the] [N cat]] [will [T will] [eat [V eat] [N fish]]]]');
  });
  test('set labels', () => {
    const t = tree('[ [D* the] [N cat]]', { mode: 'bps', bps: { label: 'set' } });
    expect(plain(t.root.label)).toBe('{the, {the, cat}}');
  });
  test('without marks: the written label decides, then a head daughter', () => {
    expect(plain(tree('[VP [DP [D the] [N cat]] [V eat]]', { mode: 'bps' }).root.label)).toBe('V');
    expect(plain(tree('[ [D the] [NP [N cat] [PP [P of] [N mine]]]]', { mode: 'bps' }).root.label)).toBe('D');
  });
  test('primes vanish', () => {
    const t = tree("[TP [DP she] [T' [T* will] [VP go]]]", { mode: 'bps' });
    expect(t.nodes.every((n) => !plain(n.label).includes('′'))).toBe(true);
  });
  test('indices survive relabelling', () => {
    expect(plain(tree('[DP_i [D* the] [N cat]]', { mode: 'bps' }).root.label)).toBe('Di');
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
    expect(t.arrows[0]).toMatchObject({ line: 'dashed', label: 'wh' });
    expect(t.arrows[0].auto).toBeFalsy();
    expect(tree(src + '\n#wh/2 -> #wh/1 hide').arrows).toHaveLength(0);
  });
  test('works together with X-bar and BPS', () => {
    expect(tree(src, { mode: 'xbar', ...md }).nodes.find((n) => n.id === 'wh')!.parents).toHaveLength(2);
    expect(tree(src, { mode: 'bps', ...md }).nodes.find((n) => n.id === 'wh')!.parents).toHaveLength(2);
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
      for (const mode of ['manual', 'xbar', 'bps'] as const) {
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
