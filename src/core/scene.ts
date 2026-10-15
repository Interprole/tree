import { layoutArrows } from './arrows';
import type { ArrowGeom } from './arrows';
import { displayLabel, fontFor, layoutTree, semDisplay } from './layout';
import type { Box, Layout, LNode } from './layout';
import { SC_SCALE, SCRIPT_SCALE } from './measure';
import type { Measure } from './measure';
import type { DNode, DTree } from './model';
import type { Runs } from './richtext';
import { metricsFor } from './style';
import type { FontId, TreeStyle } from './style';

/**
 * A backend-independent picture: SVG, PDF and the interactive canvas are all drawn from this.
 * Coordinates are final (top-left of the picture is 0,0).
 */

export interface TextPiece {
  x: number;
  /** baseline */
  y: number;
  text: string;
  size: number;
  italic?: boolean;
  bold?: boolean;
  /** render uppercase (small caps emulation) */
  upper?: boolean;
  width: number;
}

export type Prim =
  | { t: 'path'; d: string; stroke?: string; width?: number; dash?: number[]; fill?: string; role: 'edge' | 'triangle' | 'arrow' | 'arrowhead' | 'bracket' | 'deco'; node?: string; arrow?: number; join?: 'round' | 'miter' }
  | { t: 'text'; pieces: TextPiece[]; color: string; font: FontId; role: 'label' | 'leaf' | 'feature' | 'gloss' | 'sem' | 'arrowlabel'; node?: string; opacity?: number };

export interface NodeHit {
  key: string;
  node: DNode;
  box: Box;
  /** centre x, label top */
  x: number;
  y: number;
}

export interface ArrowHit {
  index: number;
  geom: ArrowGeom;
  d: string;
}

export interface Scene {
  width: number;
  height: number;
  background: string;
  prims: Prim[];
  hits: NodeHit[];
  arrows: ArrowHit[];
  layout: Layout;
  /** translation applied to layout coordinates */
  dx: number;
  dy: number;
  style: TreeStyle;
}

const GRAY = '#8a8a8a';
const SEM_COMPUTED = '#2f5d8a';
const SEM_ERROR = '#c0392b';

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** deterministic pseudo-random in [-1, 1] */
function jitter(seed: number) {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function linePath(x1: number, y1: number, x2: number, y2: number, hand: boolean): string {
  if (!hand) return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const k = jitter(x1 * 7 + y1 * 13 + x2 * 3 + y2) * Math.min(2.6, len * 0.03);
  const mx = (x1 + x2) / 2 + nx * k;
  const my = (y1 + y2) / 2 + ny * k;
  const o = jitter(x1 + y2) * 0.8;
  return `M${f(x1 + o)} ${f(y1)}Q${f(mx)} ${f(my)} ${f(x2)} ${f(y2 + o * 0.5)}`;
}

/** A polyline with rounded corners (quadratic smoothing through segment midpoints). */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length < 3) return `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const [px, py] = pts[i - 1];
    // corner radius limited by the adjacent segments
    const r = Math.min(18, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const a = Math.hypot(x - px, y - py) || 1;
    const b = Math.hypot(nx - x, ny - y) || 1;
    const ax = x - ((x - px) / a) * r;
    const ay = y - ((y - py) / a) * r;
    const bx = x + ((nx - x) / b) * r;
    const by = y + ((ny - y) / b) * r;
    d += `L${f(ax)} ${f(ay)}Q${f(x)} ${f(y)} ${f(bx)} ${f(by)}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${f(l[0])} ${f(l[1])}`;
}

/** Lay out rich runs starting at x (left) on baseline y. */
export function runsPieces(runs: Runs, x: number, y: number, size: number, italic: boolean, bold: boolean, measure: Measure, font: FontId): { pieces: TextPiece[]; overlines: [number, number][]; width: number } {
  const pieces: TextPiece[] = [];
  const overlines: [number, number][] = [];
  let cx = x;
  for (const r of runs) {
    let sz = size;
    let by = y;
    let text = r.text;
    let upper = false;
    if (r.sub) {
      sz = size * SCRIPT_SCALE;
      by = y + size * 0.24;
    } else if (r.sup) {
      sz = size * SCRIPT_SCALE;
      by = y - size * 0.36;
    }
    if (r.sc) {
      sz = sz * SC_SCALE;
      upper = true;
      text = text.toUpperCase();
    }
    const w = measure(text, { font, size: sz, italic, bold });
    pieces.push({ x: cx, y: by, text: upper ? text : r.text, size: sz, italic, bold, upper, width: w });
    if (r.over) overlines.push([cx, cx + w]);
    cx += w;
  }
  return { pieces, overlines, width: cx - x };
}

export function buildScene(tree: DTree, style: TreeStyle, measure: Measure, layoutIn?: Layout): Scene {
  const layout = layoutIn ?? layoutTree(tree, style, measure);
  const m = metricsFor(style);
  const { geoms, box } = layoutArrows(layout, tree.arrows);
  const pad = style.padding;
  const dx = pad - box.x1;
  const dy = pad - box.y1;
  const X = (x: number) => x + dx;
  const Y = (y: number) => y + dy;
  const prims: Prim[] = [];
  const hits: NodeHit[] = [];
  const hand = style.handDrawn;

  const grayCopy = (n: DNode) => n.copy && style.copyStyle === 'gray';
  const colourOf = (n: DNode) => {
    if (grayCopy(n)) return GRAY;
    return n.color ?? (n.kind === 'leaf' ? style.leafColor : style.nodeColor);
  };
  /** a coloured branch colours the edges inside it, not the edge above it */
  const edgeColour = (parent: DNode, child: DNode) => {
    if (grayCopy(child)) return GRAY;
    if (child.branchColor && parent.branchColor === child.branchColor) return child.branchColor;
    return style.lineColor;
  };

  // edges first (labels on top)
  for (const e of layout.edges) {
    const stroke = edgeColour(e.parent.node, e.child.node);
    const dash = grayCopy(e.child.node) ? [3, 2.5] : undefined;
    if (e.kind === 'triangle') {
      const d = `M${f(X(e.x1))} ${f(Y(e.y1))}L${f(X(e.bx2!))} ${f(Y(e.y2))}L${f(X(e.bx1!))} ${f(Y(e.y2))}Z`;
      prims.push({ t: 'path', d: hand ? linePath(X(e.x1), Y(e.y1), X(e.bx2!), Y(e.y2), true) + linePath(X(e.bx2!), Y(e.y2), X(e.bx1!), Y(e.y2), true) + linePath(X(e.bx1!), Y(e.y2), X(e.x1), Y(e.y1), true) : d, stroke, width: style.lineWidth, role: 'triangle', node: e.child.node.key, join: 'round' });
    } else if (e.pts) {
      prims.push({ t: 'path', d: smoothPath(e.pts.map(([x, y]) => [X(x), Y(y)])), stroke, width: style.lineWidth, dash, role: 'edge', node: e.child.node.key });
    } else {
      prims.push({ t: 'path', d: linePath(X(e.x1), Y(e.y1), X(e.x2), Y(e.y2), hand), stroke, width: style.lineWidth, dash, role: 'edge', node: e.child.node.key });
    }
  }

  for (const ln of layout.list) drawNode(ln);

  function drawNode(ln: LNode) {
    const n = ln.node;
    const b = ln.block;
    const font = fontFor(n, style);
    const label = displayLabel(n, style);
    const color = colourOf(n);
    const left = X(ln.x) - b.labelW / 2;
    const base = Y(ln.y) + m.ascent;
    if (b.labelW > 0) {
      const { pieces, overlines } = runsPieces(label, left, base, font.size, !!font.italic, !!font.bold, measure, style.font);
      prims.push({ t: 'text', pieces, color, font: style.font, role: n.kind === 'leaf' ? 'leaf' : 'label', node: n.key });
      for (const [a, z] of overlines) {
        const oy = base - font.size * 0.78;
        prims.push({ t: 'path', d: `M${f(a + 0.5)} ${f(oy)}L${f(z - 0.5)} ${f(oy)}`, stroke: color, width: Math.max(0.7, font.size * 0.055), role: 'deco', node: n.key });
      }
      if ((n.copy && style.copyStyle === 'strike') || n.struck) {
        const sy = base - font.size * 0.3;
        prims.push({ t: 'path', d: `M${f(left - 1)} ${f(sy)}L${f(left + b.labelW + 1)} ${f(sy)}`, stroke: color, width: Math.max(0.8, font.size * 0.06), role: 'deco', node: n.key });
      }
    }
    let y = Y(ln.y) + b.labelH;
    if (n.features?.length) {
      const fs = m.featureFs;
      const top = y + fs * 0.12;
      const height = n.features.length * m.featureLineH + fs * 0.15;
      const innerW = b.featureW - fs * 0.9;
      const lx = X(ln.x) - b.featureW / 2;
      const rx = X(ln.x) + b.featureW / 2;
      const tick = fs * 0.22;
      const bw = Math.max(0.6, style.lineWidth * 0.8);
      prims.push({ t: 'path', d: `M${f(lx + tick)} ${f(top)}L${f(lx)} ${f(top)}L${f(lx)} ${f(top + height)}L${f(lx + tick)} ${f(top + height)}`, stroke: color, width: bw, role: 'bracket', node: n.key });
      prims.push({ t: 'path', d: `M${f(rx - tick)} ${f(top)}L${f(rx)} ${f(top)}L${f(rx)} ${f(top + height)}L${f(rx - tick)} ${f(top + height)}`, stroke: color, width: bw, role: 'bracket', node: n.key });
      n.features.forEach((feat, i) => {
        const { pieces } = runsPieces(feat, X(ln.x) - innerW / 2, top + fs * 0.95 + i * m.featureLineH, fs, false, false, measure, style.font);
        prims.push({ t: 'text', pieces, color, font: style.font, role: 'feature', node: n.key });
      });
      y += b.featureH;
    }
    const sem = semDisplay(n);
    if (sem) {
      const ss = m.semFs;
      const w = runsPieces(sem.runs, 0, 0, ss, false, false, measure, style.font).width;
      const { pieces } = runsPieces(sem.runs, X(ln.x) - w / 2, y + ss * 1.05, ss, false, false, measure, style.font);
      prims.push({ t: 'text', pieces, color: sem.kind === 'error' ? SEM_ERROR : sem.kind === 'computed' ? SEM_COMPUTED : color, font: style.font, role: 'sem', node: n.key });
      y += b.semH;
    }
    if (n.gloss?.length) {
      const gs = m.glossFs;
      n.gloss.forEach((g, i) => {
        const w = runsPieces(g, 0, 0, gs, false, false, measure, style.font).width;
        const quoted = /^["'‘“«]/.test(g[0]?.text ?? '');
        const { pieces } = runsPieces(g, X(ln.x) - w / 2, y + gs * 1.02 + i * m.glossLineH, gs, false, false, measure, style.font);
        prims.push({ t: 'text', pieces, color: grayCopy(n) ? GRAY : quoted ? style.leafColor : style.leafColor, font: style.font, role: 'gloss', node: n.key, opacity: 0.88 });
      });
    }
    hits.push({
      key: n.key,
      node: n,
      x: X(ln.x),
      y: Y(ln.y),
      box: { x1: X(ln.x) - b.w / 2 - 3, y1: Y(ln.y) - 1, x2: X(ln.x) + b.w / 2 + 3, y2: Y(ln.y) + Math.max(b.fullH, 6) + 1 },
    });
  }

  // arrows
  const arrowHits: ArrowHit[] = [];
  geoms.forEach((g, i) => {
    const a = g.arrow;
    const color = a.color ?? style.arrowColor;
    const p = (q: [number, number]) => `${f(X(q[0]))} ${f(Y(q[1]))}`;
    const hl = m.fs * 0.45;
    // shorten the curve so the stroke does not poke through the arrowhead
    const d = `M${p(g.p0)}C${p(g.p1)} ${p(g.p2)} ${p(g.p3)}`;
    const width = Math.max(0.8, style.lineWidth * 1.05);
    const dash = a.line === 'dashed' ? [5, 3.5] : a.line === 'dotted' ? [1.2, 2.8] : undefined;
    prims.push({ t: 'path', d, stroke: color, width, dash, role: 'arrow', arrow: i });
    const head = (tip: [number, number], from: [number, number]) => {
      let vx = tip[0] - from[0];
      let vy = tip[1] - from[1];
      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;
      const bx = tip[0] - vx * hl;
      const by = tip[1] - vy * hl;
      const wx = -vy * hl * 0.38;
      const wy = vx * hl * 0.38;
      const back = 0.25;
      return `M${f(X(tip[0]))} ${f(Y(tip[1]))}L${f(X(bx + wx))} ${f(Y(by + wy))}L${f(X(tip[0] - vx * hl * (1 - back)))} ${f(Y(tip[1] - vy * hl * (1 - back)))}L${f(X(bx - wx))} ${f(Y(by - wy))}Z`;
    };
    // tangent direction: use a point slightly before the end
    const near = (t: number) => {
      const u = 1 - t;
      const a1 = u * u * u, b1 = 3 * u * u * t, c1 = 3 * u * t * t, d1 = t * t * t;
      return [a1 * g.p0[0] + b1 * g.p1[0] + c1 * g.p2[0] + d1 * g.p3[0], a1 * g.p0[1] + b1 * g.p1[1] + c1 * g.p2[1] + d1 * g.p3[1]] as [number, number];
    };
    if (a.head === 'end' || a.head === 'both') prims.push({ t: 'path', d: head(g.p3, near(0.93)), fill: color, role: 'arrowhead', arrow: i });
    if (a.head === 'start' || a.head === 'both') prims.push({ t: 'path', d: head(g.p0, near(0.07)), fill: color, role: 'arrowhead', arrow: i });
    if (a.label && g.labelAt) {
      const size = m.fs * 0.8;
      const w = measure(a.label, { font: style.font, size, italic: true });
      prims.push({ t: 'text', pieces: [{ x: X(g.labelAt[0]) - w / 2, y: Y(g.labelAt[1]), text: a.label, size, italic: true, width: w }], color, font: style.font, role: 'arrowlabel' });
    }
    arrowHits.push({ index: i, geom: { ...g, p0: [X(g.p0[0]), Y(g.p0[1])], p1: [X(g.p1[0]), Y(g.p1[1])], p2: [X(g.p2[0]), Y(g.p2[1])], p3: [X(g.p3[0]), Y(g.p3[1])], handle: [X(g.handle[0]), Y(g.handle[1])] }, d });
  });

  return {
    width: Math.ceil(box.x2 - box.x1 + 2 * pad),
    height: Math.ceil(box.y2 - box.y1 + 2 * pad),
    background: style.background,
    prims,
    hits,
    arrows: arrowHits,
    layout,
    dx,
    dy,
    style,
  };
}
