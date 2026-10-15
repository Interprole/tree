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

describe('multidominance', () => {
  const src = '[CP [DP#wh what] [C′ [C did] [TP [DP you] [VP [V see] #wh]]]]';
  test('one node, two mothers', () => {
    const t = tree(src);
    const wh = t.nodes.find((n) => n.id === 'wh')!;
    expect(wh.parents.map((p) => plain(p.label))).toEqual(['CP', 'VP']);
    expect(t.nodes.filter((n) => plain(n.label) === 'what')).toHaveLength(1);
  });
  test('copies view: highest occurrence stays, lower ones become copies', () => {
    const t = tree(src, { multidominance: 'copies' });
    const whats = t.nodes.filter((n) => plain(n.label) === 'what');
    expect(whats).toHaveLength(2);
    expect(whats.map((n) => !!n.copy)).toEqual([false, true]);
    expect(t.nodes.every((n) => n.parents.length <= 1)).toBe(true);
  });
  test('works together with X-bar and BPS', () => {
    expect(tree(src, { mode: 'xbar' }).nodes.find((n) => n.id === 'wh')!.parents).toHaveLength(2);
    expect(tree(src, { mode: 'bps' }).nodes.find((n) => n.id === 'wh')!.parents).toHaveLength(2);
  });
});

describe('movement', () => {
  test('arrows from traces to antecedents, successive-cyclic chains link step by step', () => {
    const t = tree('[CP [DP_i what] [C′ [C do] [TP you [VP think [CP [DP t_i] [C′ that [TP he [VP saw [DP t_i]]]]]]]]]');
    expect(t.arrows).toHaveLength(2);
    const [a, b] = t.arrows;
    expect(plain(a.to.label)).toBe('DPi');
    expect(plain(a.from.label)).toBe('ti');
    expect(b.to).toBe(a.from);
  });
  test('copies <…> are traces', () => {
    const t = tree('[TP [DP_i John] [VP seems [TP [DP <John>_i] [T′ to win]]]]');
    const copy = t.nodes.find((n) => n.copy)!;
    expect(plain(copy.label)).toBe('Johni');
    expect(t.arrows).toHaveLength(1);
  });
  test('coindexed non-traces get no arrow (binding)', () => {
    expect(tree('[S [DP_i John] [VP likes [DP himself_i]]]').arrows).toHaveLength(0);
  });
  test('explicit arrows', () => {
    const t = tree('[S [A#a x] [B#b y]]\n#b -> #a dashed "move"', { autoArrows: false });
    expect(t.arrows[0]).toMatchObject({ line: 'dashed', label: 'move' });
  });
  test('auto arrows can be switched off', () => {
    expect(tree('[S [DP_i x] [VP t_i]]', { autoArrows: false }).arrows).toHaveLength(0);
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
