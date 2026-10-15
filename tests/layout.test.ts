import { describe, expect, test } from 'vitest';
import { examples } from '../src/examples';
import { overlap, segBox } from '../src/core/layout';
import type { Layout } from '../src/core/layout';
import { layout } from './helpers';
import type { LabelMode } from '../src/core/build';

function assertNoOverlaps(l: Layout) {
  const ls = l.list;
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j];
      const A = { x1: a.x - a.block.w / 2, y1: a.y, x2: a.x + a.block.w / 2, y2: a.y + a.block.fullH };
      const B = { x1: b.x - b.block.w / 2, y1: b.y, x2: b.x + b.block.w / 2, y2: b.y + b.block.fullH };
      if (overlap(A, B)) throw new Error(`overlap: ${a.node.key} / ${b.node.key}`);
    }
  }
}

function assertEdgesAvoidLabels(l: Layout) {
  for (const e of l.edges) {
    for (const ln of l.list) {
      if (ln === e.parent || ln === e.child) continue;
      const B = { x1: ln.x - ln.block.w / 2 + 1, y1: ln.y + 1, x2: ln.x + ln.block.w / 2 - 1, y2: ln.y + ln.block.fullH - 1 };
      const segs = e.pts ? e.pts.slice(1).map((q, i) => ({ x1: e.pts![i][0], y1: e.pts![i][1], x2: q[0], y2: q[1] })) : [e];
      if (segs.some((sg) => segBox(sg, B))) throw new Error(`edge ${e.parent.node.key}→${e.child.node.key} crosses ${ln.node.key}`);
    }
  }
}

function randomTree(seed: number, depth = 0): string {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const go = (d: number): string => {
    const lab = ['XP', 'Y', 'ZP', 'W′', 'Q', 'LongLabelP'][Math.floor(rnd() * 6)];
    if (d > 4 || rnd() < 0.25) return `[${lab} ${['a', 'word', 'long terminal', 'x'][Math.floor(rnd() * 4)]}]`;
    const n = 1 + Math.floor(rnd() * 3);
    return `[${lab} ${Array.from({ length: n }, () => go(d + 1)).join(' ')}]`;
  };
  return go(depth);
}

describe('layout', () => {
  for (const ex of examples) {
    for (const mode of ['manual', 'xbar'] as LabelMode[]) {
      for (const bottom of [false, true]) {
        test(`${ex.id} / ${mode} / leavesAtBottom=${bottom}: no overlapping nodes`, () => {
          const { l } = layout(ex.src, { mode }, { leavesAtBottom: bottom });
          assertNoOverlaps(l);
          assertEdgesAvoidLabels(l);
        });
      }
    }
  }

  test('random trees never overlap', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const bottom of [false, true]) {
        const { l } = layout(randomTree(seed), {}, { leavesAtBottom: bottom });
        assertNoOverlaps(l);
        assertEdgesAvoidLabels(l);
      }
    }
  });

  test('parents are centred over their daughters', () => {
    const { t, l } = layout('[S [NP John] [VP [V saw] [NP Mary]]]');
    const s = l.nodes.get(t.root)!;
    const [a, b] = t.root.children.map((c) => l.nodes.get(c)!);
    expect(s.x).toBeCloseTo((a.x + b.x) / 2);
  });

  test('long labels push sisters apart', () => {
    const { t, l } = layout('[S [AVeryVeryLongLabelPhrase a] [B b]]');
    const [a, b] = t.root.children.map((c) => l.nodes.get(c)!);
    expect(b.x - b.block.w / 2).toBeGreaterThan(a.x + a.block.w / 2);
  });

  test('terminals on a common baseline', () => {
    const { t, l } = layout('[S [NP John] [VP [V saw] [NP Mary]]]', {}, { leavesAtBottom: true });
    const ys = t.nodes.filter((n) => n.kind === 'leaf').map((n) => l.nodes.get(n)!.y);
    expect(new Set(ys).size).toBe(1);
  });

  test('triangle edge spans the terminal', () => {
    const { l } = layout('[S [DP ^the very big cat] [VP runs]]');
    const tri = l.edges.find((e) => e.kind === 'triangle')!;
    expect(tri).toBeTruthy();
    expect(tri.bx2! - tri.bx1!).toBeGreaterThan(tri.child.block.labelW * 0.9);
  });

  test('multidominated node: one vertex, below both mothers, between them, edges avoid labels', () => {
    const src = '[&P [TP [DP John] [VP [V likes] #1]] [&′ [& and] [TP [DP Mary] [VP [V hates] [DP#1 bagels]]]]]';
    const { t, l } = layout(src, { chains: 'multidominance' });
    const shared = t.nodes.find((n) => n.id === '1')!;
    expect(shared.parents).toHaveLength(2);
    const ls = l.nodes.get(shared)!;
    const ms = shared.parents.map((p) => l.nodes.get(p)!);
    for (const m of ms) expect(ls.y).toBeGreaterThan(m.y);
    expect(ls.x).toBeGreaterThan(Math.min(...ms.map((m) => m.x)));
    expect(ls.x).toBeLessThan(Math.max(...ms.map((m) => m.x)));
    expect(l.edges.filter((e) => e.child.node === shared)).toHaveLength(2);
    assertNoOverlaps(l);
    assertEdgesAvoidLabels(l);
  });
});

describe('layout performance', () => {
  test('a 400-node tree lays out quickly', () => {
    const build = (d: number): string => (d === 0 ? '[N word]' : `[XP${d} ${build(d - 1)} ${build(d - 1)}]`);
    const src = build(7); // 2^8 - 1 phrases + leaves
    const t0 = performance.now();
    const { l } = layout(src);
    const ms = performance.now() - t0;
    expect(l.list.length).toBeGreaterThan(380);
    expect(ms).toBeLessThan(1500);
  });
});

import { buildScene } from '../src/core/scene';
import { approxMeasure as am } from '../src/core/measure';
import { defaultStyle as ds } from '../src/core/style';
import { tree as mkTree } from './helpers';
describe('colours', () => {
  test('a coloured branch does not colour the edge above it', () => {
    const t = mkTree('[S [VP@@#ff0000 [V see] [DP it]] [X y]]');
    const sc = buildScene(t, ds, am);
    const edgeTo = (label: string) => {
      const n = t.nodes.find((x) => x.label.map((r) => r.text).join('') === label)!;
      return sc.prims.find((p) => p.t === 'path' && p.role === 'edge' && p.node === n.key) as { stroke: string };
    };
    expect(edgeTo('VP').stroke).toBe(ds.lineColor);
    expect(edgeTo('V').stroke).toBe('#ff0000');
  });
});

import { layoutTree } from '../src/core/layout';
import { layoutArrows } from '../src/core/arrows';
describe('movement arrows', () => {
  const end = (src: string, id: string) => {
    const t = mkTree(src, { chains: 'traces' });
    const L = layoutTree(t, ds, am);
    const { geoms } = layoutArrows(L, t.arrows);
    const n = t.nodes.find((x) => x.id === id)!;
    return { y: geoms[0].p3[1], node: L.nodes.get(n)!, kids: n.children.map((c) => L.nodes.get(c)!) };
  };
  test('an arrow lands on the label of a phrase, between its branches', () => {
    const { y, node, kids } = end('[S [DP#q [D every] [NP cat]] [VP [V likes] #q]]', 'q');
    expect(y).toBeGreaterThan(node.y + node.block.h - 1);
    expect(y).toBeLessThan(Math.min(...kids.map((k) => k.y)));
  });
  test('a unary phrase is entered from under its yield', () => {
    const { y, kids } = end('[S [DP#q [NP cat]] [VP [V likes] #q]]', 'q');
    expect(y).toBeGreaterThan(kids[0].y + kids[0].block.h);
  });
});
