import type { Box, Layout, LNode } from './layout';
import type { DArrow, DNode } from './model';
import { metricsFor } from './style';

type P = [number, number];
/** a cubic Bézier segment: start, control 1, control 2, end */
export type Cubic = [P, P, P, P];

/** Geometry of an arrow: a chain of cubic segments. */
export interface ArrowGeom {
  arrow: DArrow;
  segs: Cubic[];
  /** the points that shape the arrow, ends included: its bend points, or the few points a hand-shaped version starts from */
  knots: P[];
  /** bend points are stored relative to this point (the middle of the two ends) */
  mid: P;
  /** the draggable handle of an arrow without bend points (lowest point / apex of the curve) */
  handle: P;
  /** label positions (centre, baseline) and widths */
  labels: { x: number; y: number; w: number; index: number }[];
  level: number;
  /** curve arrows: unit vector pointing outwards */
  outward?: P;
}

/** Width of a label's text (approximate when no measurer is given). */
export type LabelWidth = (runs: import('./richtext').Runs) => number;

export function cubicAt(g: Pick<ArrowGeom, 'segs'> | { p0: P; p1: P; p2: P; p3: P }, t: number): P {
  if ('segs' in g) {
    const n = g.segs.length;
    const k = Math.min(n - 1, Math.floor(t * n));
    return bez(g.segs[k], t * n - k);
  }
  return bez([g.p0, g.p1, g.p2, g.p3], t);
}

function bez(c: Cubic, t: number): P {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}

/** Points along the arrow (for bounding boxes and hit areas). */
export function geomSample(g: Pick<ArrowGeom, 'segs'>, perSeg = 10): P[] {
  const out: P[] = [];
  g.segs.forEach((c, i) => {
    for (let k = i ? 1 : 0; k <= perSeg; k++) out.push(bez(c, k / perSeg));
  });
  return out;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** SVG path data of the arrow, with a coordinate transform. */
export function geomPath(g: Pick<ArrowGeom, 'segs'>, map: (p: P) => P = (p) => p): string {
  const pt = (p: P) => {
    const [x, y] = map(p);
    return `${fmt(x)} ${fmt(y)}`;
  };
  let d = `M${pt(g.segs[0][0])}`;
  for (const c of g.segs) d += `C${pt(c[1])} ${pt(c[2])} ${pt(c[3])}`;
  return d;
}

/** The tip and a point just before it (direction of an arrowhead). */
export function geomEnd(g: Pick<ArrowGeom, 'segs'>, which: 'start' | 'end'): [P, P] {
  if (which === 'end') {
    const c = g.segs[g.segs.length - 1];
    return [c[3], bez(c, 0.9)];
  }
  const c = g.segs[0];
  return [c[0], bez(c, 0.1)];
}

const line = (a: P, b: P): Cubic => [a, [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3], b];

const unit = (v: P): P => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
/** the direction t mirrored in the line along c (both unit vectors) */
const mirror = (t: P, c: P): P => {
  const k = 2 * (t[0] * c[0] + t[1] * c[1]);
  return [k * c[0] - t[0], k * c[1] - t[1]];
};

/** the direction of a curve through each inner point: halfway between the way in and the way out */
function innerTangents(pts: P[]): P[] {
  const out: P[] = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = unit([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
    const b = unit([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]);
    const s: P = [a[0] + b[0], a[1] + b[1]];
    out.push(Math.hypot(s[0], s[1]) < 1e-6 ? b : unit(s));
  }
  return out;
}

/**
 * The directions at the two ends of a curve through bend points that make its first and last
 * pieces arcs of a circle (the way TikZ bends: round, never pointed at a bend point).
 */
export function arcEnds(pts: P[]): { start: P; end: P } {
  const n = pts.length;
  const ts = innerTangents(pts);
  if (!ts.length) {
    const c = unit([pts[n - 1][0] - pts[0][0], pts[n - 1][1] - pts[0][1]]);
    return { start: c, end: c };
  }
  const c0 = unit([pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]]);
  const c1 = unit([pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]]);
  return { start: mirror(ts[0], c0), end: mirror(ts[ts.length - 1], c1) };
}

/**
 * A smooth curve through all points, each piece as close to an arc of a circle as its end
 * directions allow (handles as TikZ sets them: a third of the chord, longer as the turn grows).
 * start and end are the directions of travel at the two ends.
 */
export function splinePath(pts: P[], dirs: { start?: P; end?: P } = {}): Cubic[] {
  const q = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
  if (q.length < 2) return [line(pts[0], pts[pts.length - 1])];
  const n = q.length;
  if (n === 2 && !dirs.start && !dirs.end) return [line(q[0], q[1])];
  const ends = arcEnds(q);
  const tan: P[] = [dirs.start ?? ends.start, ...innerTangents(q), dirs.end ?? ends.end];
  const segs: Cubic[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const [a, b] = [q[i], q[i + 1]];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const c = unit([b[0] - a[0], b[1] - a[1]]);
    // the handle of an arc turning by 2φ over its chord: chord / (3 cos²(φ/2))
    const handle = (t: P) => {
      const phi = Math.acos(Math.max(-1, Math.min(1, t[0] * c[0] + t[1] * c[1])));
      return Math.min(chord / (3 * Math.cos(Math.min(phi, 2.2) / 2) ** 2), chord);
    };
    const h0 = handle(tan[i]);
    const h1 = handle(tan[i + 1]);
    segs.push([a, [a[0] + tan[i][0] * h0, a[1] + tan[i][1] * h0], [b[0] - tan[i + 1][0] * h1, b[1] - tan[i + 1][1] * h1], b]);
  }
  return segs;
}

/**
 * A route (a polyline) as one smooth curve: every bend becomes an arc of a circle (no stretched
 * ovals), as wide as the neighbouring stretches allow, up to maxR. ok() judges an arc against
 * the picture; a rejected arc is made smaller until it fits.
 */
export function smoothRoute(route: P[], ok: (arc: Cubic, legs: P[]) => boolean = () => true, maxR = 28): Cubic[] {
  const pts: P[] = [];
  for (const p of route) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.5) continue;
    if (pts.length >= 2) {
      // a point on the straight continuation of the previous stretch is not a bend
      const a = pts[pts.length - 2];
      const ux = last[0] - a[0];
      const uy = last[1] - a[1];
      const vx = p[0] - last[0];
      const vy = p[1] - last[1];
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      if (Math.abs(ux * vy - uy * vx) / (lu * lv) < 0.02 && ux * vx + uy * vy > 0) {
        pts[pts.length - 1] = p;
        continue;
      }
    }
    pts.push(p);
  }
  const n = pts.length;
  if (n < 2) return [line(route[0], route[route.length - 1])];
  if (n === 2) return [line(pts[0], pts[1])];
  const segs: Cubic[] = [];
  let cur = pts[0];
  for (let i = 1; i < n - 1; i++) {
    const [A, C, B] = [pts[i - 1], pts[i], pts[i + 1]];
    const la = Math.hypot(C[0] - A[0], C[1] - A[1]);
    const lb = Math.hypot(B[0] - C[0], B[1] - C[1]);
    const ua: P = [(C[0] - A[0]) / la, (C[1] - A[1]) / la];
    const ub: P = [(B[0] - C[0]) / lb, (B[1] - C[1]) / lb];
    const r0 = Math.min(i === 1 ? la * 0.95 : la / 2, i === n - 2 ? lb * 0.95 : lb / 2, maxR);
    let ra = r0;
    let rb = r0;
    // handle length of a circular arc through the turn angle, scaled to each side
    const phi = Math.min(Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]))), (170 * Math.PI) / 180);
    const k = phi < 1e-3 ? 2 / 3 : ((4 / 3) * Math.tan(phi / 4)) / Math.tan(phi / 2);
    let arc: Cubic;
    for (let tries = 0; ; tries++) {
      const P1: P = [C[0] - ua[0] * ra, C[1] - ua[1] * ra];
      const P2: P = [C[0] + ub[0] * rb, C[1] + ub[1] * rb];
      arc = [P1, [P1[0] + ua[0] * ra * k, P1[1] + ua[1] * ra * k], [P2[0] - ub[0] * rb * k, P2[1] - ub[1] * rb * k], P2];
      if (tries >= 7 || Math.max(ra, rb) < 5 || ok(arc, [P1, C, P2])) break;
      ra *= 0.65;
      rb *= 0.65;
    }
    if (Math.hypot(arc[0][0] - cur[0], arc[0][1] - cur[1]) > 0.01) segs.push(line(cur, arc[0]));
    segs.push(arc);
    cur = arc[3];
  }
  segs.push(line(cur, pts[n - 1]));
  return segs;
}

/* ------------------------------------------------------------ routing */

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** the mother whose branch this is */
  owner?: DNode;
}

function cross(a: Seg, b: Seg): boolean {
  const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (cy - ay) * (bx - ax) - (by - ay) * (cx - ax);
  const d1 = ccw(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = ccw(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = ccw(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = ccw(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segInBox(s: Seg, b: Box): boolean {
  const inside = (x: number, y: number) => x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2;
  if (inside(s.x1, s.y1) || inside(s.x2, s.y2)) return true;
  return [
    { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y1 },
    { x1: b.x2, y1: b.y1, x2: b.x2, y2: b.y2 },
    { x1: b.x2, y1: b.y2, x2: b.x1, y2: b.y2 },
    { x1: b.x1, y1: b.y2, x2: b.x1, y2: b.y1 },
  ].some((e) => cross(s, e));
}

/** a binary heap of [cost, cell] */
class Heap {
  c: number[] = [];
  v: number[] = [];
  push(cost: number, cell: number) {
    const { c, v } = this;
    let i = c.length;
    c.push(cost);
    v.push(cell);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p];
      v[i] = v[p];
      i = p;
    }
    c[i] = cost;
    v[i] = cell;
  }
  pop(): [number, number] | null {
    const { c, v } = this;
    if (!c.length) return null;
    const top: [number, number] = [c[0], v[0]];
    const lc = c.pop()!;
    const lv = v.pop()!;
    if (c.length) {
      let i = 0;
      for (;;) {
        let m = i;
        const l = 2 * i + 1;
        const r = l + 1;
        if (l < c.length && c[l] < (m === i ? lc : c[m])) m = l;
        if (r < c.length && c[r] < (m === i ? lc : c[m])) m = r;
        if (m === i) break;
        c[i] = c[m];
        v[i] = v[m];
        i = m;
      }
      c[i] = lc;
      v[i] = lv;
    }
    return top;
  }
}

const CELL = 4;
/** down, diagonally down, sideways: an arrow never climbs on its way below the tree */
const MOVES: [number, number, number][] = [
  [1, 0, CELL],
  [1, -1, CELL * 1.45],
  [1, 1, CELL * 1.45],
  [0, -1, CELL * 1.35],
  [0, 1, CELL * 1.35],
];
const CROSS = 34;
const NEAR_ARROW = 14;

interface Field {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
  /** branches passing through a cell */
  edges: Map<number, Seg[]>;
  /** cells already taken by other arrows */
  taken: Uint8Array;
  /** extra cost near labels and branches: arrows keep some distance */
  soft: Float32Array;
  boxes: { box: Box; node: DNode }[];
  segs: Seg[];
}

function makeField(layout: Layout, bottom: number): Field {
  const b = layout.box;
  const x0 = b.x1 - 70;
  const y0 = b.y1 - 10;
  const cols = Math.ceil((b.x2 + 70 - x0) / CELL) + 1;
  const rows = Math.ceil((bottom - y0) / CELL) + 2;
  const blocked = new Uint8Array(cols * rows);
  const boxes: Field['boxes'] = [];
  for (const ln of layout.list) {
    const bl = ln.block;
    if (bl.point) continue;
    const box = { x1: ln.x - bl.w / 2 - bl.extraL - 3, y1: ln.y - 1, x2: ln.x + bl.w / 2 + bl.extraR + 3, y2: ln.y + bl.fullH + 1 };
    boxes.push({ box, node: ln.node });
    const c1 = Math.max(0, Math.floor((box.x1 - x0) / CELL));
    const c2 = Math.min(cols - 1, Math.ceil((box.x2 - x0) / CELL));
    const r1 = Math.max(0, Math.floor((box.y1 - y0) / CELL));
    const r2 = Math.min(rows - 1, Math.ceil((box.y2 - y0) / CELL));
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) blocked[r * cols + c] = 1;
  }
  const segs: Seg[] = [];
  for (const e of layout.edges) {
    const pts: P[] = e.pts ?? (e.kind === 'triangle' ? [[e.bx1 ?? e.x2, e.y2], [e.x1, e.y1], [e.bx2 ?? e.x2, e.y2], [e.bx1 ?? e.x2, e.y2]] : [[e.x1, e.y1], [e.x2, e.y2]]);
    for (let i = 0; i + 1 < pts.length; i++) segs.push({ x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], owner: e.parent.node });
  }
  const edges = new Map<number, Seg[]>();
  for (const s of segs) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const steps = Math.max(1, Math.ceil(len / (CELL / 2)));
    const seen = new Set<number>();
    for (let k = 0; k <= steps; k++) {
      const x = s.x1 + ((s.x2 - s.x1) * k) / steps;
      const y = s.y1 + ((s.y2 - s.y1) * k) / steps;
      const c = Math.round((x - x0) / CELL);
      const r = Math.round((y - y0) / CELL);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      if (seen.has(i)) continue;
      seen.add(i);
      const list = edges.get(i);
      if (list) list.push(s);
      else edges.set(i, [s]);
    }
  }
  const soft = new Float32Array(cols * rows);
  const spread = (i: number, radius: number, cost: number) => {
    const r0 = Math.floor(i / cols);
    const c0 = i % cols;
    for (let dr = -radius; dr <= radius; dr++)
      for (let dc = -radius; dc <= radius; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const j = r * cols + c;
        const v = cost * (1 - Math.max(Math.abs(dr), Math.abs(dc)) / (radius + 1));
        if (v > soft[j]) soft[j] = v;
      }
  };
  for (const i of edges.keys()) spread(i, 2, 7);
  for (let i = 0; i < blocked.length; i++) if (blocked[i]) spread(i, 2, 5);
  return { x0, y0, cols, rows, blocked, edges, taken: new Uint8Array(cols * rows), soft, boxes, segs };
}

/** a node whose only daughter is its word or morpheme (a head, or a phrase with unanalysed words) */
export function hasOnlyExponent(n: DNode): boolean {
  return n.kind === 'phrase' && n.children.length === 1 && n.children[0].kind === 'leaf';
}

/**
 * Which node an arrow end touches, and how: a node with only a word attaches at the word (or at
 * the node itself with from=node / to=node); a node with daughters at the side of its label; a
 * node without daughters right under it.
 */
export function arrowEnd(a: DArrow, which: 'from' | 'to'): { node: DNode; mode: 'bottom' | 'side' } {
  const n = which === 'from' ? a.from : a.to;
  const at = which === 'from' ? a.fromAt : a.toAt;
  if (!n.children.length) return { node: n, mode: 'bottom' };
  if (hasOnlyExponent(n) && at !== 'node') return { node: n.children[0], mode: 'bottom' };
  return { node: n, mode: 'side' };
}

/** where an arrow touches a node, where its free channel starts, and the curve between the two */
interface Exit {
  attach: P;
  p: P;
  cost: number;
  /** from the attach point to the channel: leaves the side of the label horizontally, turns down */
  lead?: Cubic;
}

/**
 * How an arrow end meets a node: under it, vertically (a node without daughters: a word, an empty
 * node), or at the side of its label, horizontally (a node with daughters).
 */
function exits(ln: LNode, mode: 'bottom' | 'side', x: number, yOff: number, gap: number): Exit[] {
  const b = ln.block;
  if (mode === 'bottom' || b.point) {
    const p: P = [x, ln.y + b.fullH + gap];
    return [{ attach: p, p, cost: 0 }];
  }
  const y = ln.y + b.labelH * 0.55 + yOff;
  const r = 11;
  const out: Exit[] = [];
  for (const dir of [-1, 1]) {
    const extra = dir < 0 ? b.extraL : b.extraR;
    const attach: P = [ln.x + dir * (b.labelW / 2 + extra + gap), y];
    const turn: P = [ln.x + dir * (Math.max(b.labelW / 2 + extra, b.w / 2) + gap + r), y + r];
    const kx = Math.abs(turn[0] - attach[0]) * 0.55;
    out.push({ attach, p: turn, cost: 0, lead: [attach, [attach[0] + dir * kx, y], [turn[0], turn[1] - r * 0.55], turn] });
  }
  return out;
}

/**
 * A path from a node down to below the tree, through the gaps between labels and crossing as few
 * branches as possible. Returns its waypoints, the node's end first.
 */
function channel(f: Field, ln: LNode, starts: Exit[], bottomY: number): { pts: P[]; exit: Exit } {
  const { cols, rows, x0, y0 } = f;
  const cellOf = (p: P) => {
    const c = Math.min(cols - 1, Math.max(0, Math.round((p[0] - x0) / CELL)));
    const r = Math.min(rows - 1, Math.max(0, Math.round((p[1] - y0) / CELL)));
    return r * cols + c;
  };
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  const startOf = new Map<number, Exit>();
  const heap = new Heap();
  for (const s of starts) {
    const i = cellOf(s.p);
    if (s.cost < dist[i]) {
      dist[i] = s.cost;
      startOf.set(i, s);
      heap.push(s.cost, i);
    }
  }
  const startCells = new Set(startOf.keys());
  const [sx, sy] = starts[0].p;
  const lastRow = Math.min(rows - 1, Math.ceil((bottomY - y0) / CELL));
  /** branches of the node itself do not count right where they start */
  const edgeCost = (i: number) => {
    const list = f.edges.get(i);
    if (!list) return 0;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const px = x0 + c * CELL;
    const py = y0 + r * CELL;
    const near = Math.hypot(px - sx, py - sy) < 14;
    return list.some((s) => !(near && s.owner === ln.node)) ? CROSS : 0;
  };
  let end = -1;
  for (;;) {
    const top = heap.pop();
    if (!top) break;
    const [d, i] = top;
    if (d > dist[i]) continue;
    const r = Math.floor(i / cols);
    if (r >= lastRow) {
      end = i;
      break;
    }
    const c = i % cols;
    for (const [dr, dc, cost] of MOVES) {
      const nr = r + dr;
      const nc = c + dc;
      if (nc < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (f.blocked[j] && !startCells.has(j)) continue;
      const nd = d + cost + edgeCost(j) + (f.taken[j] ? NEAR_ARROW : 0) + (Math.hypot(nc * CELL + x0 - sx, nr * CELL + y0 - sy) < 14 ? 0 : f.soft[j]);
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(nd, j);
      }
    }
  }
  if (end < 0) return { pts: [starts[0].p, [sx, bottomY]], exit: starts[0] };
  const cells: number[] = [];
  for (let i = end; i >= 0; i = prev[i]) cells.push(i);
  cells.reverse();
  const pts: P[] = cells.map((i) => [x0 + (i % cols) * CELL, y0 + Math.floor(i / cols) * CELL]);
  const exit = startOf.get(cells[0]) ?? starts[0];
  pts[0] = exit.p;
  pts[pts.length - 1] = [pts[pts.length - 1][0], bottomY];
  return { pts: pull(f, ln.node, pts), exit };
}

/** Keep only the waypoints that are needed: a shortcut may not touch a label or cross more branches. */
function pull(f: Field, own: DNode, pts: P[]): P[] {
  const crossings = (a: P, b: P) => {
    const s: Seg = { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
    let k = 0;
    for (const e of f.segs) if (!(e.owner === own && (Math.hypot(e.x1 - pts[0][0], e.y1 - pts[0][1]) < 16)) && cross(s, e)) k++;
    return k;
  };
  const clean = (a: P, b: P) => {
    const s: Seg = { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
    return !f.boxes.some((o) => segInBox(s, o.box));
  };
  // crossings along the raw path, cumulative
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + crossings(pts[i - 1], pts[i]));
  const out: P[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !(clean(pts[i], pts[j]) && crossings(pts[i], pts[j]) <= acc[j] - acc[i])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

function markTaken(f: Field, pts: P[]) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2)));
    for (let k = 0; k <= steps; k++) {
      const x = ax + ((bx - ax) * k) / steps;
      const y = ay + ((by - ay) * k) / steps;
      const c = Math.round((x - f.x0) / CELL);
      const r = Math.round((y - f.y0) / CELL);
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        if (cc < 0 || cc >= f.cols || r < 0 || r >= f.rows) continue;
        f.taken[r * f.cols + cc] = 1;
      }
    }
  }
}

/** routing results survive dragging a handle (same layout, same arrows) */
let routeCache: { key: string; channels: Map<string, { pts: P[]; exit: Exit }>; field: Field | null } | null = null;

function layoutKey(layout: Layout, arrows: DArrow[]): string {
  const parts: string[] = [String(layout.style.edgeGap)];
  for (const ln of layout.list) parts.push(`${ln.node.key}:${ln.x.toFixed(1)},${ln.y.toFixed(1)},${ln.block.w.toFixed(1)},${ln.block.fullH.toFixed(1)}`);
  for (const a of arrows) parts.push(`${a.from.key}>${a.to.key}:${a.route}:${a.via ? 'v' : ''}:${a.fromAt ?? ''}:${a.toAt ?? ''}`);
  return parts.join('|');
}

/**
 * Lay out arrows. An "under" arrow leaves the moved node itself, finds its way down between the
 * labels and branches, runs below the tree and comes up the same way into the landing node.
 * Nested and overlapping arrows get separate levels so they never run on top of each other.
 * An arrow with bend points is a smooth curve through them.
 */
export function layoutArrows(layout: Layout, arrows: DArrow[], labelWidth?: LabelWidth): { geoms: ArrowGeom[]; box: Box } {
  const style = layout.style;
  const m = metricsFor(style);
  const box = { ...layout.box };
  const treeBottom = layout.box.y2;
  const spacing = m.fs * 0.95;
  const geoms: ArrowGeom[] = [];
  const gap = style.edgeGap + 1;

  // the nodes the arrow ends touch (a word instead of its head, by default)
  const endsOf = new Map<DArrow, [{ node: DNode; mode: 'bottom' | 'side' }, { node: DNode; mode: 'bottom' | 'side' }]>();
  for (const a of arrows) endsOf.set(a, [arrowEnd(a, 'from'), arrowEnd(a, 'to')]);

  // endpoints per node, to fan out several arrows touching the same node
  const endpointCount = new Map<DNode, number>();
  const endpointSeen = new Map<DNode, number>();
  for (const a of arrows) for (const e of endsOf.get(a)!) endpointCount.set(e.node, (endpointCount.get(e.node) ?? 0) + 1);
  const fan = (n: DNode, ln: LNode): { x: number; yOff: number } => {
    const total = endpointCount.get(n) ?? 1;
    const i = endpointSeen.get(n) ?? 0;
    endpointSeen.set(n, i + 1);
    if (total <= 1) return { x: ln.x, yOff: 0 };
    const w = Math.min(Math.max(ln.block.w * 0.6, 8), (total - 1) * 7);
    return { x: ln.x - w / 2 + (w * i) / (total - 1), yOff: (i - (total - 1) / 2) * 5 };
  };

  // levels for under-arrows: narrow spans first, a level is taken if spans overlap there
  const under = arrows
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => layout.nodes.has(endsOf.get(a)![0].node) && layout.nodes.has(endsOf.get(a)![1].node));
  const spanOf = (a: DArrow): [number, number] => {
    const x1 = layout.nodes.get(endsOf.get(a)![0].node)!.x;
    const x2 = layout.nodes.get(endsOf.get(a)![1].node)!.x;
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

  // fan positions in arrow order (stable while dragging)
  const fanOf = new Map<DArrow, [{ x: number; yOff: number }, { x: number; yOff: number }]>();
  for (const a of arrows) {
    const [ef, et] = endsOf.get(a)!;
    const lf = layout.nodes.get(ef.node);
    const lt = layout.nodes.get(et.node);
    if (lf && lt) fanOf.set(a, [fan(ef.node, lf), fan(et.node, lt)]);
  }

  const channelBottom = treeBottom + 6;
  const key = layoutKey(layout, arrows);
  if (routeCache?.key !== key) routeCache = { key, channels: new Map(), field: null };
  const cache = routeCache;
  const field = () => (cache.field ??= makeField(layout, channelBottom + 8));
  const getChannel = (a: DArrow, which: 'from' | 'to', ln: LNode, starts: Exit[], down = channelBottom) => {
    const k = `${arrows.indexOf(a)}:${which}:${Math.round(down)}`;
    let c = cache.channels.get(k);
    if (!c) {
      c = channel(field(), ln, starts, down);
      markTaken(field(), [c.exit.attach, ...c.pts]);
      cache.channels.set(k, c);
    }
    return c;
  };
  /** an arc of an arrow touches no label (but the arrow's own nodes) and crosses no more branches than the route */
  const arcOk = (own: DNode[]) => (arc: Cubic, legs: P[]): boolean => {
    const f = field();
    const pts = geomSample({ segs: [arc] }, 10);
    for (const [x, y] of pts) {
      if (f.boxes.some(({ box, node }) => !own.includes(node) && x > box.x1 + 1 && x < box.x2 - 1 && y > box.y1 + 1 && y < box.y2 - 1)) return false;
    }
    const crossings = (poly: P[]) => {
      let k = 0;
      for (let i = 0; i + 1 < poly.length; i++) {
        const sg: Seg = { x1: poly[i][0], y1: poly[i][1], x2: poly[i + 1][0], y2: poly[i + 1][1] };
        for (const e of f.segs) if (!own.includes(e.owner!) && cross(sg, e)) k++;
      }
      return k;
    };
    return crossings(pts) <= crossings(legs);
  };

  // route narrow arrows first: they take the closest channels
  const ordered = under.map((u) => u.a);
  /** under-arrows laid out so far: an arrow over others runs below them */
  const placed: { x1: number; x2: number; bottom: number }[] = [];
  /** the lowest label or branch between x1 and x2 (at least y) */
  const localBottom = (x1: number, x2: number, y: number): number => {
    let b = y;
    for (const ln of layout.list) {
      const bl = ln.block;
      if (ln.x + bl.w / 2 + bl.extraR >= x1 && ln.x - bl.w / 2 - bl.extraL <= x2) b = Math.max(b, ln.y + bl.fullH);
    }
    for (const e of layout.edges) {
      const xs = [e.x1, e.x2, e.bx1 ?? e.x2, e.bx2 ?? e.x2];
      if (Math.max(...xs) >= x1 && Math.min(...xs) <= x2) b = Math.max(b, e.y2);
    }
    return Math.min(b, treeBottom);
  };
  const geomOf = new Map<DArrow, ArrowGeom>();
  /**
   * A route between labels and branches, out of one node, below what lies between, into the other:
   * where the bend points of an arrow that cannot go in one curve are taken from.
   */
  const freeRoute = (a: DArrow, ef: { node: DNode; mode: 'bottom' | 'side' }, et: { node: DNode; mode: 'bottom' | 'side' }, lf: LNode, lt: LNode): P[] => {
    const [ff, ft] = fanOf.get(a)!;
    const startsF = exits(lf, ef.mode, ff.x, ff.yOff, gap);
    const startsT = exits(lt, et.mode, ft.x, ft.yOff, gap);
    const local = localBottom(Math.min(lf.x, lt.x) - R, Math.max(lf.x, lt.x) + R, Math.max(startsF[0].p[1], startsT[0].p[1]));
    const chA = getChannel(a, 'from', lf, startsF, local + 6);
    const chB = getChannel(a, 'to', lt, startsT, local + 6);
    const ca = chA.pts;
    const cb = chB.pts;
    const x1 = Math.min(lf.x, lt.x);
    const x2 = Math.max(lf.x, lt.x);
    let bottom = local + Math.max(spacing * 0.9, R + 6);
    for (const p of placed) if (p.x1 <= x2 + 12 && x1 <= p.x2 + 12) bottom = Math.max(bottom, p.bottom + spacing);
    placed.push({ x1, x2, bottom });
    const xa = ca[ca.length - 1][0];
    const xb = cb[cb.length - 1][0];
    const side = (e: Exit): P[] => (e.lead ? [e.attach, [e.p[0], e.attach[1]]] : []);
    const inner = (c: P[], e: Exit) => c.slice(e.lead ? 1 : 0, -1);
    return [...side(chA.exit), ...inner(ca, chA.exit), [xa, bottom], [xb, bottom], ...inner(cb, chB.exit).reverse(), ...side(chB.exit).reverse()];
  };
  /** radius of the turns of an arrow (at least: how deep it dips below what it passes) */
  const R = Math.max(14, m.fs * 1.8);
  /** a bend may take up to half of each stretch next to it: wide, smooth turns */
  const BEND = R * 8;
  /** paths of the arrows laid out so far: later arrows avoid crossing them */
  const placedPaths: P[][] = [];
  const own = (a: DArrow, ef: DNode, et: DNode) => [a.from, a.to, ef, et];
  /** how badly a curve goes: labels it touches, branches and arrows it crosses */
  const cost = (segs: Cubic[], mine: DNode[]): { hits: number; cross: number; arrows: number } => {
    const f = field();
    const pts = geomSample({ segs }, 16);
    let hits = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i];
      // a little room around every label
      if (f.boxes.some(({ box, node }) => !mine.includes(node) && x > box.x1 - 5 && x < box.x2 + 5 && y > box.y1 - 4 && y < box.y2 + 4)) hits++;
    }
    const ends = [pts[0], pts[pts.length - 1]];
    let crossN = 0;
    let arrowsN = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const sg: Seg = { x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1] };
      for (const e of f.segs) {
        // the branches of the nodes it touches count too: never in between a node's daughters
        void ends;
        if (cross(sg, e)) crossN++;
      }
      for (const path of placedPaths)
        for (let j = 0; j + 1 < path.length; j++) if (cross(sg, { x1: path[j][0], y1: path[j][1], x2: path[j + 1][0], y2: path[j + 1][1] })) arrowsN++;
    }
    return { hits, cross: crossN, arrows: arrowsN };
  };
  for (const a of ordered) {
    const [ef, et] = endsOf.get(a)!;
    const lf = layout.nodes.get(ef.node);
    const lt = layout.nodes.get(et.node);
    if (!lf || !lt) continue;
    const mine = own(a, ef.node, et.node);
    const bf = nodeBox(lf, gap);
    const bt = nodeBox(lt, gap);
    const cf = boxCentre(bf);
    const ct = boxCentre(bt);
    // bend points are kept relative to the middle of the two nodes
    const mid: P = [(cf[0] + ct[0]) / 2, (cf[1] + ct[1]) / 2];
    const fixedOut = a.outSide ? SIDE_ANGLE[a.outSide] : undefined;
    const fixedIn = a.inSide ? SIDE_ANGLE[a.inSide] : undefined;
    // a node with daughters is never left or entered from below (through its daughters)
    const sideF = ef.mode === 'side' && !lf.block.point;
    const sideT = et.mode === 'side' && !lt.block.point;
    const notBelow = (deg: number, side: boolean, toward: P, from: P) => (side && deg > 20 && deg < 160 ? (toward[0] < from[0] ? 180 : 0) : deg);
    /** a smooth curve through bend points: leaving one node and entering the other along the line to its centre */
    const through = (wps: P[]): { segs: Cubic[]; p0: P; p3: P } => {
      // the ends leave and enter as the arcs through the bend points want (found from the centres, then from the borders)
      let p0 = cf;
      let p3 = ct;
      let t0 = 0;
      let t1 = 0;
      for (let k = 0; k < 2; k++) {
        const e = arcEnds([p0, ...wps, p3]);
        t0 = fixedOut ?? notBelow(angleTo([0, 0], e.start), sideF, wps[0], cf);
        t1 = fixedIn ?? notBelow(angleTo(e.end, [0, 0]), sideT, wps[wps.length - 1], ct);
        p0 = anchor(bf, t0);
        p3 = anchor(bt, t1);
      }
      const d1 = dir(t1);
      return { segs: splinePath([p0, ...wps, p3], { start: dir(t0), end: [-d1[0], -d1[1]] }), p0, p3 };
    };
    /**
     * One bend point: still one curve as TikZ draws it, through that point at its middle (so moving
     * the handle of an automatic arrow only reshapes it). null when no such curve fits.
     */
    const curveThrough = (v: P): Cubic | null => {
      const grid = (side: boolean) => Array.from({ length: 24 }, (_, i) => i * 15 - 165).filter((d) => !side || d <= 20 || d >= 160);
      const outs = fixedOut !== undefined ? [fixedOut] : grid(sideF);
      const ins = fixedIn !== undefined ? [fixedIn] : grid(sideT);
      let best: { c: Cubic; score: number } | null = null;
      for (const t0 of outs) {
        for (const t1 of ins) {
          const p0 = anchor(bf, t0);
          const p3 = anchor(bt, t1);
          const d0 = dir(t0);
          const d1 = dir(t1);
          // B(½) = v: L0·d0 + L1·d1 = 8/3 (v − middle of the ends)
          const sx = (8 / 3) * (v[0] - (p0[0] + p3[0]) / 2);
          const sy = (8 / 3) * (v[1] - (p0[1] + p3[1]) / 2);
          const det = d0[0] * d1[1] - d0[1] * d1[0];
          if (Math.abs(det) < 1e-3) continue;
          const L0 = (sx * d1[1] - sy * d1[0]) / det;
          const L1 = (d0[0] * sy - d0[1] * sx) / det;
          if (L0 < R || L1 < R) continue;
          const c: Cubic = [p0, [p0[0] + d0[0] * L0, p0[1] + d0[1] * L0], [p3[0] + d1[0] * L1, p3[1] + d1[1] * L1], p3];
          const q = cost([c], mine);
          const score = q.hits * 1000 + q.cross * 300 + q.arrows * 120 + sidePenalty(t0, sideF) + sidePenalty(t1, sideT) + Math.abs(Math.log(L0 / L1)) * 60 + curveLength([c]) * 0.08;
          if (!best || score < best.score) best = { c, score };
        }
      }
      return best?.c ?? null;
    };
    let g: ArrowGeom;
    if (a.via?.length) {
      const vias = a.via.map(([x, y]) => [mid[0] + x, mid[1] + y] as P);
      const one = vias.length === 1 ? curveThrough(vias[0]) : null;
      if (one) g = { arrow: a, segs: [one], knots: [one[0], vias[0], one[3]], mid, handle: vias[0], labels: [], level: 0 };
      else {
        const c = through(vias);
        g = { arrow: a, segs: c.segs, knots: [c.p0, ...vias, c.p3], mid, handle: vias[0], labels: [], level: 0 };
      }
    } else {
      // one curve, as TikZ draws "to[out=…, in=…, looseness=…]": the sides and the looseness that touch nothing
      const outs = fixedOut !== undefined ? [fixedOut] : sideF ? SIDE_ANGLES : AUTO_ANGLES;
      const ins = fixedIn !== undefined ? [fixedIn] : sideT ? SIDE_ANGLES : AUTO_ANGLES;
      let best: { segs: Cubic[]; score: number; hits: number } | null = null;
      for (const t0 of outs) {
        for (const t1 of ins) {
          const p0 = anchor(bf, t0);
          const p3 = anchor(bt, t1);
          const dist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
          for (const k of LOOSENESS) {
            const L = k * Math.max(0.3915 * dist, R);
            const d0 = dir(t0);
            const d1 = dir(t1);
            const c: Cubic = [p0, [p0[0] + d0[0] * L, p0[1] + d0[1] * L], [p3[0] + d1[0] * L, p3[1] + d1[1] * L], p3];
            const q = cost([c], mine);
            const score = q.hits * 1000 + q.cross * 300 + q.arrows * 120 + sidePenalty(t0, sideF) + sidePenalty(t1, sideT) + curveLength([c]) * 0.08;
            if (!best || score < best.score) best = { segs: [c], score, hits: q.hits + q.cross };
          }
        }
      }
      let segs = best!.segs;
      let knots: P[] = [segs[0][0], bez(segs[0], 0.5), segs[0][3]];
      if (best!.hits > 0) {
        // something is in the way: as few bend points as it takes, found along a free route
        const route = freeRoute(a, ef, et, lf, lt);
        const inner = route.slice(1, -1);
        const sets: P[][] = [];
        for (let i = 0; i < inner.length; i++) sets.push([inner[i]]);
        for (let i = 0; i < inner.length; i++) for (let j = i + 1; j < inner.length; j++) sets.push([inner[i], inner[j]]);
        for (let i = 0; i < inner.length; i++) for (let j = i + 1; j < inner.length; j++) for (let l = j + 1; l < inner.length; l++) sets.push([inner[i], inner[j], inner[l]]);
        // the fewest bend points that cross nothing; otherwise the least bad, if better than one curve
        let found: { segs: Cubic[]; knots: P[]; score: number; clean: boolean } | null = null;
        for (const set of sets) {
          if (found?.clean && set.length > found.knots.length - 2) break;
          const c = through(set);
          const q = cost(c.segs, mine);
          if (q.hits) continue;
          const score = q.cross * 300 + q.arrows * 120 + curveLength(c.segs) * 0.08 + set.length * 80;
          const clean = q.cross === 0;
          if (!found || (clean && !found.clean) || (clean === found.clean && score < found.score)) found = { segs: c.segs, knots: [c.p0, ...set, c.p3], score, clean };
        }
        if (found && (found.clean || found.score < best!.score)) {
          segs = found.segs;
          knots = found.knots;
        } else if (inner.length && fixedOut === undefined && fixedIn === undefined) {
          // the free route itself, its corners rounded
          segs = smoothRoute(route, arcOk(mine), BEND);
          knots = route;
        }
      }
      g = { arrow: a, segs, knots, mid, handle: cubicAt({ segs }, 0.5), labels: [], level: 0 };
    }
    placedPaths.push(geomSample(g, 10));
    geomOf.set(a, g);
  }
  for (const a of arrows) {
    const g = geomOf.get(a);
    if (g) geoms.push(g);
  }
  for (const g of geoms) {
    for (const [x, y] of geomSample(g, 8)) {
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
      const [hx, hy] = cubicAt(g, 0.5);
      let x = hx;
      let y = hy;
      let side = l.side;
      if (side === 'auto') {
        const ys = [g.segs[0][0][1], g.segs[g.segs.length - 1][3][1]];
        side = hy >= Math.max(...ys) - 2 ? 'below' : hy <= Math.min(...ys) + 2 ? 'above' : 'right';
      }
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

/** sides an arrow end can take, as angles on the screen (degrees, 0 = right, 90 = down) */
export const SIDE_ANGLE: Record<string, number> = { below: 90, above: -90, right: 0, left: 180 };
/** what is tried for an end left to choose: below first (the usual movement arrow), then around */
const AUTO_ANGLES = [90, 60, 120, 30, 150, 0, 180, -30, -150, -90];
/** how far the curve swings out (TikZ looseness) */
const LOOSENESS = [0.8, 1, 1.4, 2, 2.8, 4];
/** for a node with daughters: sideways first, then up (never from below, through its daughters) */
const SIDE_ANGLES = [180, 0, 150, 30, -150, -30, -90];
function sidePenalty(deg: number, side = false): number {
  const d = Math.round(deg);
  // a node with daughters: sideways is best
  if (side) return d === 0 || d === 180 ? 0 : d === 30 || d === 150 ? 4 : d === -30 || d === -150 ? 8 : 16;
  // a word: below is the usual way an arrow leaves and enters; sideways costs a little, upwards more
  return d === 90 ? 0 : d === 60 || d === 120 ? 4 : d === 30 || d === 150 ? 8 : d === 0 || d === 180 ? 12 : d === -90 ? 24 : 18;
}
const dir = (deg: number): P => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const angleTo = (from: P, to: P) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
/** the box of a node an arrow touches (its label, features, meaning and words), with a gap */
function nodeBox(ln: LNode, gap: number): Box {
  const b = ln.block;
  if (b.point) return { x1: ln.x - 2, y1: ln.y - 2, x2: ln.x + 2, y2: ln.y + 2 };
  return { x1: ln.x - b.w / 2 - gap, y1: ln.y - gap, x2: ln.x + b.w / 2 + gap, y2: ln.y + b.fullH + gap };
}
const boxCentre = (b: Box): P => [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
function curveLength(segs: Cubic[]): number {
  const pts = geomSample({ segs }, 8);
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}
/** where the line from the centre of a box at an angle leaves the box (as TikZ anchors a node at an angle) */
function anchor(b: Box, deg: number): P {
  const [cx, cy] = boxCentre(b);
  const [dx, dy] = dir(deg);
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (b.x2 - cx) / dx);
  if (dx < -1e-9) t = Math.min(t, (b.x1 - cx) / dx);
  if (dy > 1e-9) t = Math.min(t, (b.y2 - cy) / dy);
  if (dy < -1e-9) t = Math.min(t, (b.y1 - cy) / dy);
  return [cx + dx * t, cy + dy * t];
}

/** Where a new bend point goes in the list of an arrow's bend points (by the nearest part of the curve). */
export function insertVia(g: ArrowGeom, at: P): [number, number][] {
  const inner = g.arrow.via?.length ? g.arrow.via.map(([x, y]) => [g.mid[0] + x, g.mid[1] + y] as P) : g.knots.slice(1, -1);
  const knots: P[] = [g.knots[0], ...inner, g.knots[g.knots.length - 1]];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i + 1 < knots.length; i++) {
    const [ax, ay] = knots[i];
    const [bx, by] = knots[i + 1];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((at[0] - ax) * (bx - ax) + (at[1] - ay) * (by - ay)) / len2));
    const d = Math.hypot(ax + t * (bx - ax) - at[0], ay + t * (by - ay) - at[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const pts = [...inner];
  // a point right at an existing one adds nothing
  if (!inner.some(([x, y]) => Math.hypot(x - at[0], y - at[1]) < 14)) pts.splice(best, 0, at);
  return pts.map(([x, y]) => [Math.round(x - g.mid[0]), Math.round(y - g.mid[1])]);
}

/** Absolute positions of an arrow's bend points. */
export function viaPoints(g: ArrowGeom): P[] {
  return (g.arrow.via ?? []).map(([x, y]) => [g.mid[0] + x, g.mid[1] + y]);
}
