import type { Box, Layout, LNode } from './layout';
import type { DArrow, DNode } from './model';
import { metricsFor } from './style';

/** Geometry of a movement arrow. */
export interface ArrowGeom {
  arrow: DArrow;
  /** cubic Bézier: start, control 1, control 2, end */
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  p3: [number, number];
  /** the draggable handle (lowest point / apex of the curve) */
  handle: [number, number];
  /** label positions (centre, baseline) and widths */
  labels: { x: number; y: number; w: number; index: number }[];
  level: number;
  /** curve arrows: unit vector pointing outwards */
  outward?: [number, number];
}

/** Width of a label's text (approximate when no measurer is given). */
export type LabelWidth = (runs: import('./richtext').Runs) => number;

/** The lowest point of everything a node dominates. */
function subtreeBottom(layout: Layout, n: DNode, memo: Map<DNode, number>): number {
  const cached = memo.get(n);
  if (cached !== undefined) return cached;
  const ln = layout.nodes.get(n);
  let b = ln ? ln.y + ln.block.fullH : 0;
  for (const c of n.children) b = Math.max(b, subtreeBottom(layout, c, memo));
  memo.set(n, b);
  return b;
}

export function cubicAt(g: Pick<ArrowGeom, 'p0' | 'p1' | 'p2' | 'p3'>, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * g.p0[0] + b * g.p1[0] + c * g.p2[0] + d * g.p3[0], a * g.p0[1] + b * g.p1[1] + c * g.p2[1] + d * g.p3[1]];
}

/**
 * Lay out movement arrows. "under" arrows leave the bottom of the moved constituent's yield, dip
 * below the tree and come up under the landing site; nested and overlapping arrows get separate
 * levels so they never run on top of each other.
 */
export function layoutArrows(layout: Layout, arrows: DArrow[], labelWidth?: LabelWidth): { geoms: ArrowGeom[]; box: Box } {
  const style = layout.style;
  const m = metricsFor(style);
  const memo = new Map<DNode, number>();
  const box = { ...layout.box };
  const treeBottom = layout.box.y2;
  const spacing = m.fs * 0.95;
  const geoms: ArrowGeom[] = [];

  // endpoints per node, to fan out several arrows touching the same node
  const endpointCount = new Map<DNode, number>();
  const endpointSeen = new Map<DNode, number>();
  for (const a of arrows) {
    endpointCount.set(a.from, (endpointCount.get(a.from) ?? 0) + 1);
    endpointCount.set(a.to, (endpointCount.get(a.to) ?? 0) + 1);
  }
  const fan = (n: DNode, ln: LNode) => {
    const total = endpointCount.get(n) ?? 1;
    const i = endpointSeen.get(n) ?? 0;
    endpointSeen.set(n, i + 1);
    if (total <= 1) return ln.x;
    const w = Math.min(ln.block.w * 0.6, (total - 1) * 7);
    return ln.x - w / 2 + (w * i) / (total - 1);
  };

  // levels for under-arrows: narrow spans first, a level is taken if spans overlap there
  const under = arrows
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.route === 'under' && layout.nodes.has(a.from) && layout.nodes.has(a.to));
  const spanOf = (a: DArrow): [number, number] => {
    const x1 = layout.nodes.get(a.from)!.x;
    const x2 = layout.nodes.get(a.to)!.x;
    return [Math.min(x1, x2), Math.max(x1, x2)];
  };
  under.sort((p, q) => {
    const [a1, a2] = spanOf(p.a);
    const [b1, b2] = spanOf(q.a);
    return a2 - a1 - (b2 - b1) || p.i - q.i;
  });
  const levelSpans: [number, number][][] = [];
  const levelOf = new Map<DArrow, number>();
  for (const { a } of under) {
    const [s1, s2] = spanOf(a);
    let lvl = 0;
    for (;;) {
      const taken = (levelSpans[lvl] ??= []);
      if (!taken.some(([t1, t2]) => s1 <= t2 + 12 && t1 <= s2 + 12)) {
        taken.push([s1, s2]);
        break;
      }
      lvl++;
    }
    levelOf.set(a, lvl);
  }

  for (const a of arrows) {
    const lf = layout.nodes.get(a.from);
    const lt = layout.nodes.get(a.to);
    if (!lf || !lt) continue;
    if (a.route === 'under') {
      const sx = fan(a.from, lf);
      const tx = fan(a.to, lt);
      const sy = subtreeBottom(layout, a.from, memo) + style.edgeGap + 1;
      const ty = subtreeBottom(layout, a.to, memo) + style.edgeGap + 1;
      const level = levelOf.get(a) ?? 0;
      const bottom = treeBottom + spacing * (0.9 + level) + a.bend[1];
      // the curve's lowest point (t = 0.5) is (sy + ty)/8 + 0.75·yL
      const yL = (bottom - (sy + ty) / 8) / 0.75;
      const dx = a.bend[0];
      const g: ArrowGeom = {
        arrow: a,
        p0: [sx, sy],
        p1: [sx + dx, Math.max(yL, sy)],
        p2: [tx + dx, Math.max(yL, ty)],
        p3: [tx, ty],
        handle: [0, 0],
        labels: [],
        level,
      };
      g.handle = cubicAt(g, 0.5);
      g.labels = [];
      geoms.push(g);
    } else {
      // direct curve from the source label to the target label, bulging outwards
      const sx = lf.x;
      const sy = lf.y + m.topInset - style.edgeGap;
      const tx = lt.x;
      const ty = lt.y + lt.block.h + style.edgeGap;
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const len = Math.hypot(tx - sx, ty - sy) || 1;
      // perpendicular, pointing left of the direction source → target
      let nx = (ty - sy) / len;
      let ny = -(tx - sx) / len;
      if (nx > 0) {
        nx = -nx;
        ny = -ny;
      }
      const bulge = Math.min(140, len * 0.35);
      const cx = mx + nx * bulge + a.bend[0];
      const cy = my + ny * bulge + a.bend[1];
      // quadratic → cubic
      const g: ArrowGeom = {
        arrow: a,
        p0: [sx, sy],
        p1: [sx + (2 / 3) * (cx - sx), sy + (2 / 3) * (cy - sy)],
        p2: [tx + (2 / 3) * (cx - tx), ty + (2 / 3) * (cy - ty)],
        p3: [tx, ty],
        handle: [0, 0],
        labels: [],
        level: 0,
      };
      g.handle = cubicAt(g, 0.5);
      g.labels = [];
      g.outward = [nx, ny];
      geoms.push(g);
    }
  }
  for (const g of geoms) {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const [x, y] = cubicAt(g, t);
      box.x1 = Math.min(box.x1, x - 6);
      box.x2 = Math.max(box.x2, x + 6);
      box.y1 = Math.min(box.y1, y - 6);
      box.y2 = Math.max(box.y2, y + 6);
    }
    // labels: auto = below an "under" arrow / outside a curve; or above, below, left, right; plus drag offset
    const lh = m.fs * 0.95;
    let stackBelow = 0;
    let stackAbove = 0;
    for (const l of g.arrow.labels) {
      const w = labelWidth ? labelWidth(l.runs) : l.runs.reduce((s, r) => s + r.text.length, 0) * m.fs * 0.45;
      const [hx, hy] = g.handle;
      let x = hx;
      let y = hy;
      let side = l.side;
      if (side === 'auto') side = g.arrow.route === 'under' ? 'below' : g.outward && g.outward[0] < 0 ? 'left' : 'right';
      if (side === 'below') {
        y = hy + lh * (1 + stackBelow);
        stackBelow++;
      } else if (side === 'above') {
        y = hy - lh * (0.6 + stackAbove);
        stackAbove++;
      } else {
        x = side === 'left' ? hx - w / 2 - 8 : hx + w / 2 + 8;
        y = hy + m.fs * 0.3 + lh * (side === 'left' ? stackAbove++ : stackBelow++);
      }
      if (l.off) {
        x += l.off[0];
        y += l.off[1];
      }
      g.labels.push({ x, y, w, index: l.index });
      box.x1 = Math.min(box.x1, x - w / 2 - 4);
      box.x2 = Math.max(box.x2, x + w / 2 + 4);
      box.y1 = Math.min(box.y1, y - m.fs);
      box.y2 = Math.max(box.y2, y + m.fs * 0.35);
    }
  }
  return { geoms, box };
}
