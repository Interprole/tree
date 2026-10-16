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

/**
 * A smooth curve through all points (centripetal Catmull–Rom: round, without loops or cusps).
 * The ends continue the direction of their neighbours.
 */
export function splinePath(pts: P[], dirs: { start?: P; end?: P } = {}): Cubic[] {
  const q = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
  if (q.length < 2) return [line(pts[0], pts[pts.length - 1])];
  const n = q.length;
  if (n === 2 && !dirs.start && !dirs.end) return [line(q[0], q[1])];
  const ext = (a: P, b: P): P => [2 * a[0] - b[0], 2 * a[1] - b[1]];
  // a given direction at an end: a point behind the end in that direction
  const len = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
  const lenE = Math.hypot(q[n - 1][0] - q[n - 2][0], q[n - 1][1] - q[n - 2][1]);
  const before: P = dirs.start ? [q[0][0] - dirs.start[0] * len, q[0][1] - dirs.start[1] * len] : ext(q[0], q[1]);
  const after: P = dirs.end ? [q[n - 1][0] + dirs.end[0] * lenE, q[n - 1][1] + dirs.end[1] * lenE] : ext(q[n - 1], q[n - 2]);
  const all: P[] = [before, ...q, after];
  const segs: Cubic[] = [];
  for (let i = 1; i < all.length - 2; i++) {
    const [p0, p1, p2, p3] = [all[i - 1], all[i], all[i + 1], all[i + 2]];
    const d1 = Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])) || 1e-6;
    const d2 = Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])) || 1e-6;
    const d3 = Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])) || 1e-6;
    const c1: P = [
      (d1 * d1 * p2[0] - d2 * d2 * p0[0] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[0]) / (3 * d1 * (d1 + d2)),
      (d1 * d1 * p2[1] - d2 * d2 * p0[1] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[1]) / (3 * d1 * (d1 + d2)),
    ];
    const c2: P = [
      (d3 * d3 * p1[0] - d2 * d2 * p3[0] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[0]) / (3 * d3 * (d3 + d2)),
      (d3 * d3 * p1[1] - d2 * d2 * p3[1] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[1]) / (3 * d3 * (d3 + d2)),
    ];
    segs.push([p1, c1, c2, p2]);
  }
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
  for (const a of arrows) endsOf.set(a, a.route === 'under' ? [arrowEnd(a, 'from'), arrowEnd(a, 'to')] : [{ node: a.from, mode: 'side' }, { node: a.to, mode: 'side' }]);

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
    .filter(({ a }) => a.route === 'under' && layout.nodes.has(endsOf.get(a)![0].node) && layout.nodes.has(endsOf.get(a)![1].node));
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
  const getChannel = (a: DArrow, which: 'from' | 'to', ln: LNode, starts: Exit[]) => {
    const k = `${arrows.indexOf(a)}:${which}`;
    let c = cache.channels.get(k);
    if (!c) {
      c = channel(field(), ln, starts, channelBottom);
      markTaken(field(), [c.exit.attach, ...c.pts]);
      cache.channels.set(k, c);
    }
    return c;
  };
  /** a curve that touches no label, and the branches it crosses */
  const judge = (segs: Cubic[], own: DNode[]): { clear: boolean; crossings: number } => {
    const f = field();
    const pts = geomSample({ segs }, 14);
    for (let i = 2; i < pts.length - 2; i++) {
      const [x, y] = pts[i];
      if (f.boxes.some(({ box }) => x > box.x1 + 2 && x < box.x2 - 2 && y > box.y1 + 2 && y < box.y2 - 2)) return { clear: false, crossings: Infinity };
    }
    let crossings = 0;
    const ends = [pts[0], pts[pts.length - 1]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const sg: Seg = { x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1] };
      for (const e of f.segs) {
        if (own.includes(e.owner!) && ends.some(([ex, ey]) => Math.hypot(e.x1 - ex, e.y1 - ey) < 18)) continue;
        if (cross(sg, e)) crossings++;
      }
    }
    return { clear: true, crossings };
  };

  // route narrow arrows first: they take the closest channels
  const ordered = [...under.map((u) => u.a), ...arrows.filter((a) => a.route !== 'under')];
  const geomOf = new Map<DArrow, ArrowGeom>();
  const DOWN: P = [0, 1];
  const UP: P = [0, -1];
  const reverse = (segs: Cubic[]): Cubic[] => segs.map((q) => [q[3], q[2], q[1], q[0]] as Cubic).reverse();
  for (const a of ordered) {
    const [ef, et] = endsOf.get(a)!;
    const lf = layout.nodes.get(ef.node);
    const lt = layout.nodes.get(et.node);
    if (!lf || !lt) continue;
    const [ff, ft] = fanOf.get(a)!;
    let g: ArrowGeom;
    if (a.route === 'under') {
      const level = levelOf.get(a) ?? 0;
      // bend points are kept relative to the middle of the two ends (independent of the side taken)
      const ref = (ln: LNode, e: { mode: string }, f: { x: number }): P => (e.mode === 'side' && !ln.block.point ? [ln.x, ln.y + ln.block.labelH * 0.55] : [f.x, ln.y + ln.block.fullH + gap]);
      const r0 = ref(lf, ef, ff);
      const r1 = ref(lt, et, ft);
      const mid: P = [(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2];
      const startsF = exits(lf, ef.mode, ff.x, ff.yOff, gap);
      const startsT = exits(lt, et.mode, ft.x, ft.yOff, gap);
      if (a.via?.length) {
        const vias = a.via.map(([x, y]) => [mid[0] + x, mid[1] + y] as P);
        // the side nearest to the neighbouring bend point
        const pick = (st: Exit[], toward: P) => st.reduce((b, e) => (Math.abs(e.attach[0] - toward[0]) < Math.abs(b.attach[0] - toward[0]) ? e : b));
        const A = pick(startsF, vias[0]);
        const B = pick(startsT, vias[vias.length - 1]);
        const segs = [...(A.lead ? [A.lead] : []), ...splinePath([A.p, ...vias, B.p], { start: DOWN, end: UP }), ...(B.lead ? reverse([B.lead]) : [])];
        g = { arrow: a, segs, knots: [A.attach, ...vias, B.attach], mid, handle: vias[0], labels: [], level };
      } else {
        const chA = getChannel(a, 'from', lf, startsF);
        const chB = getChannel(a, 'to', lt, startsT);
        const ca = chA.pts;
        const cb = chB.pts;
        const bottom = Math.max(channelBottom + 8, treeBottom + spacing * (0.9 + level) + a.bend[1]);
        const dx = a.bend[0];
        /**
         * The curve below the tree is one round cubic, as it always was: from A down to the depth
         * of its level and up to B, its lowest point (t = 0.5) at (A.y + B.y)/8 + 0.75·yL.
         */
        const belly = (A: P, B: P): Cubic => {
          const yL = Math.max(A[1], B[1], (bottom - (A[1] + B[1]) / 8) / 0.75);
          return [A, [A[0] + dx, yL], [B[0] + dx, yL], B];
        };
        /** the channel down to its last bend: from there it runs straight down */
        const lastBend = (c: P[]) => (c.length > 2 ? c.length - 2 : 0);
        /** the part of a channel above the round curve, running straight down into it */
        const lead = (c: P[], upto: number): Cubic[] => (upto === 0 ? [] : splinePath(c.slice(0, upto + 1), { start: DOWN, end: DOWN }));
        const leadA = chA.exit.lead ? [chA.exit.lead] : [];
        const leadB = chB.exit.lead ? reverse([chB.exit.lead]) : [];
        const build = (ia: number, ib: number): { segs: Cubic[]; low: Cubic } => {
          const low = belly(ca[ia], cb[ib]);
          return { segs: [...leadA, ...lead(ca, ia), low, ...reverse(lead(cb, ib)), ...leadB], low };
        };
        // the roundest shape that touches no label and crosses no more branches than the channels do:
        // one curve from node to node, or from where the channels stop bending
        let best = build(ca.length - 1, cb.length - 1);
        const limit = judge(best.segs, [a.from, a.to, ef.node, et.node]).crossings;
        for (const [ia, ib] of [
          [0, 0],
          [0, lastBend(cb)],
          [lastBend(ca), 0],
          [lastBend(ca), lastBend(cb)],
        ]) {
          const cand = build(ia, ib);
          const j = judge(cand.segs, [a.from, a.to, ef.node, et.node]);
          if (j.clear && j.crossings <= limit) {
            best = cand;
            break;
          }
        }
        const { segs, low } = best;
        // few bend points when the shape is taken over by hand: around the lowest point
        const knots: P[] = [segs[0][0], bez(low, 0.25), bez(low, 0.75), segs[segs.length - 1][3]];
        g = { arrow: a, segs, knots, mid, handle: bez(low, 0.5), labels: [], level };
      }
    } else {
      // direct curve from the source label to the target label, bulging outwards
      const sx = lf.x;
      const sy = lf.y + m.topInset - style.edgeGap;
      const ex = lt.x;
      const ey = lt.y + lt.block.h + style.edgeGap;
      const mid: P = [(sx + ex) / 2, (sy + ey) / 2];
      const len = Math.hypot(ex - sx, ey - sy) || 1;
      // perpendicular, pointing left of the direction source → target
      let nx = (ey - sy) / len;
      let ny = -(ex - sx) / len;
      if (nx > 0) {
        nx = -nx;
        ny = -ny;
      }
      if (a.via?.length) {
        const knots: P[] = [[sx, sy], ...a.via.map(([x, y]) => [mid[0] + x, mid[1] + y] as P), [ex, ey]];
        g = { arrow: a, segs: splinePath(knots), knots, mid, handle: knots[1], labels: [], level: 0, outward: [nx, ny] };
      } else {
        const bulge = Math.min(140, len * 0.35);
        const cx = mid[0] + nx * bulge + a.bend[0];
        const cy = mid[1] + ny * bulge + a.bend[1];
        // quadratic → cubic
        const c: Cubic = [
          [sx, sy],
          [sx + (2 / 3) * (cx - sx), sy + (2 / 3) * (cy - sy)],
          [ex + (2 / 3) * (cx - ex), ey + (2 / 3) * (cy - ey)],
          [ex, ey],
        ];
        g = { arrow: a, segs: [c], knots: [c[0], c[3]], mid, handle: bez(c, 0.5), labels: [], level: 0, outward: [nx, ny] };
      }
    }
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
      const [hx, hy] = g.arrow.via?.length ? cubicAt(g, 0.5) : g.handle;
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
  pts.splice(best, 0, at);
  return pts.map(([x, y]) => [Math.round(x - g.mid[0]), Math.round(y - g.mid[1])]);
}

/** Absolute positions of an arrow's bend points. */
export function viaPoints(g: ArrowGeom): P[] {
  return (g.arrow.via ?? []).map(([x, y]) => [g.mid[0] + x, g.mid[1] + y]);
}
