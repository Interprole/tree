import { geomEnd, geomPath, layoutArrows } from './arrows';
import type { ArrowGeom } from './arrows';
import { displayLabel, fontFor, layoutTree, NOTE_SCALE, noteSide, semDisplay } from './layout';
import type { Box, Layout, LNode } from './layout';
import { runsWidth, SC_SCALE, SCRIPT_SCALE } from './measure';
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
  | { t: 'text'; pieces: TextPiece[]; color: string; font: FontId; role: 'label' | 'leaf' | 'feature' | 'gloss' | 'sem' | 'note' | 'arrowlabel'; node?: string; opacity?: number };

export interface NodeHit {
  key: string;
  node: DNode;
  box: Box;
  /** centre x, label top */
  x: number;
  y: number;
}

/** a draggable label: a note of a node or a label of an arrow */
export interface LabelHit {
  kind: 'note' | 'arrow';
  /** node key or arrow index */
  owner: string | number;
  index: number;
  box: Box;
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
  labels: LabelHit[];
  layout: Layout;
  /** translation applied to layout coordinates */
  dx: number;
  dy: number;
  style: TreeStyle;
}

const GRAY = '#8a8a8a';
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
export function runsPieces(runs: Runs, x: number, y: number, size: number, baseItalic: boolean, baseBold: boolean, measure: Measure, font: FontId): { pieces: TextPiece[]; overlines: [number, number][]; strikes: [number, number][]; width: number } {
  const pieces: TextPiece[] = [];
  const overlines: [number, number][] = [];
  const strikes: [number, number][] = [];
  let cx = x;
  for (const r of runs) {
    const italic = baseItalic !== !!r.i;
    const bold = baseBold || !!r.b;
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
    if (r.s) strikes.push([cx, cx + w]);
    cx += w;
  }
  return { pieces, overlines, strikes, width: cx - x };
}

/** The same look at another size: type, spacing and lines scaled together. */
export function scaleStyle(style: TreeStyle, k: number): TreeStyle {
  return {
    ...style,
    fontSize: style.fontSize * k,
    levelGap: style.levelGap * k,
    siblingGap: style.siblingGap * k,
    padding: style.padding * k,
    lineWidth: style.lineWidth * k,
    edgeGap: style.edgeGap * k,
  };
}

/**
 * The picture on a sheet of a chosen size (sheetWidth / sheetHeight): the tree grows or shrinks
 * to fill it (keeping its proportions) and stands in its middle.
 */
export function buildSheetScene(tree: DTree, style: TreeStyle, measure: Measure): Scene {
  const W = style.sheetWidth || 0;
  const H = style.sheetHeight || 0;
  if (!W && !H) return buildScene(tree, style, measure);
  const base = buildScene(tree, { ...style, sheetWidth: 0, sheetHeight: 0 }, measure);
  const k = Math.min(W ? W / base.width : Infinity, H ? H / base.height : Infinity);
  if (!Number.isFinite(k) || Math.abs(k - 1) < 0.003) return buildScene(tree, style, measure);
  return buildScene(tree, { ...scaleStyle(style, k), sheetWidth: W, sheetHeight: H }, measure);
}

/** a picture frame kept as it was (while an arrow is reshaped, the tree must not shift or rescale) */
export type Frame = Pick<Scene, 'width' | 'height' | 'dx' | 'dy'>;

export function buildScene(tree: DTree, style: TreeStyle, measure: Measure, layoutIn?: Layout, frame?: Frame): Scene {
  const layout = layoutIn ?? layoutTree(tree, style, measure);
  const m = metricsFor(style);
  const arrowFs = metricsFor(style).fs * 0.8;
  const { geoms, box } = layoutArrows(layout, tree.arrows, (runs) => runsWidth(runs, { font: style.font, size: arrowFs, italic: true }, measure));
  const pad = style.padding;
  // a sheet larger than the tree: the tree in its middle
  const natW = box.x2 - box.x1 + 2 * pad;
  const natH = box.y2 - box.y1 + 2 * pad;
  const sheetW = frame?.width ?? Math.max(natW, style.sheetWidth || 0);
  const sheetH = frame?.height ?? Math.max(natH, style.sheetHeight || 0);
  const dx = frame?.dx ?? pad - box.x1 + (sheetW - natW) / 2;
  const dy = frame?.dy ?? pad - box.y1 + (sheetH - natH) / 2;
  const X = (x: number) => x + dx;
  const Y = (y: number) => y + dy;
  const prims: Prim[] = [];
  const hits: NodeHit[] = [];
  const hand = style.handDrawn;

  const grayCopy = (n: DNode) => n.copy && style.copyStyle === 'gray';
  const colourOf = (n: DNode) => {
    if (n.posColor) return n.posColor;
    if (grayCopy(n)) return GRAY;
    return n.color ?? (n.kind === 'leaf' ? style.leafColor : style.nodeColor);
  };
  /** ;edge= colours the edge above a node; a coloured branch colours the edges inside it, not the one above it */
  const edgeColour = (parent: DNode, child: DNode) => {
    // a coloured position of a chain: the edges inside it, not the one above it
    if (child.posColor && parent.posColor === child.posColor) return child.posColor;
    if (grayCopy(child)) return GRAY;
    if (child.edgeColor) return child.edgeColor;
    if (child.branchColor && parent.branchColor === child.branchColor) return child.branchColor;
    return style.lineColor;
  };
  const labelHits: LabelHit[] = [];
  /** draw rich runs with their decorations (overline, strike-through) */
  const drawRuns = (runs: Runs, x: number, y: number, size: number, italic: boolean, bold: boolean, color: string, role: Extract<Prim, { t: 'text' }>['role'], node?: string, opacity?: number) => {
    const r = runsPieces(runs, x, y, size, italic, bold, measure, style.font);
    prims.push({ t: 'text', pieces: r.pieces, color, font: style.font, role, node, opacity });
    for (const [a, z] of r.strikes) prims.push({ t: 'path', d: `M${f(a)} ${f(y - size * 0.3)}L${f(z)} ${f(y - size * 0.3)}`, stroke: color, width: Math.max(0.7, size * 0.06), role: 'deco', node });
    return r;
  };

  // edges first (labels on top)
  for (const e of layout.edges) {
    const stroke = edgeColour(e.parent.node, e.child.node);
    const ew = e.child.node.edgeWidth ?? style.lineWidth;
    const dash = grayCopy(e.child.node) ? [3, 2.5] : undefined;
    if (e.kind === 'triangle') {
      const d = `M${f(X(e.x1))} ${f(Y(e.y1))}L${f(X(e.bx2!))} ${f(Y(e.y2))}L${f(X(e.bx1!))} ${f(Y(e.y2))}Z`;
      prims.push({ t: 'path', d: hand ? linePath(X(e.x1), Y(e.y1), X(e.bx2!), Y(e.y2), true) + linePath(X(e.bx2!), Y(e.y2), X(e.bx1!), Y(e.y2), true) + linePath(X(e.bx1!), Y(e.y2), X(e.x1), Y(e.y1), true) : d, stroke, width: ew, role: 'triangle', node: e.child.node.key, join: 'round' });
    } else if (e.pts) {
      prims.push({ t: 'path', d: smoothPath(e.pts.map(([x, y]) => [X(x), Y(y)])), stroke, width: ew, dash, role: 'edge', node: e.child.node.key });
    } else {
      prims.push({ t: 'path', d: linePath(X(e.x1), Y(e.y1), X(e.x2), Y(e.y2), hand), stroke, width: ew, dash, role: 'edge', node: e.child.node.key });
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
      const { overlines } = drawRuns(label, left, base, font.size, !!font.italic, !!font.bold, color, n.kind === 'leaf' ? 'leaf' : 'label', n.key);
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
      // the node's own colour (also from a coloured branch) wins over the meaning colours
      const own = n.semColor ?? (n.color && !grayCopy(n) ? n.color : undefined);
      prims.push({ t: 'text', pieces, color: sem.kind === 'error' ? SEM_ERROR : own ?? (sem.kind === 'computed' ? style.semComputedColor : style.semColor), font: style.font, role: 'sem', node: n.key });
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
    // notes: beside, above or below the label; dragged notes keep their offset
    if (n.notes?.length) {
      const ns = style.fontSize * NOTE_SCALE;
      const stack: Record<string, number> = { left: 0, right: 0, above: 0, below: 0 };
      const belowTop = Y(ln.y) + b.fullH - b.notesBelowH;
      for (const note of n.notes) {
        const side = noteSide(n, note.side);
        const w = runsWidth(note.runs, { font: style.font, size: ns }, measure);
        const k = stack[side]++;
        let nx: number;
        let ny: number;
        if (side === 'left') {
          nx = X(ln.x) - b.labelW / 2 - 6 - w;
          ny = base + k * ns * 1.25;
        } else if (side === 'right') {
          nx = X(ln.x) + b.labelW / 2 + 6;
          ny = base + k * ns * 1.25;
        } else if (side === 'above') {
          nx = X(ln.x) - w / 2;
          ny = Y(ln.y) - 2 - k * ns * 1.25;
        } else {
          nx = X(ln.x) - w / 2;
          ny = belowTop + ns * 1.05 + k * ns * 1.25;
        }
        if (note.off) {
          nx += note.off[0];
          ny += note.off[1];
        }
        drawRuns(note.runs, nx, ny, ns, false, false, n.color ?? style.nodeColor, 'note', n.key, 0.92);
        labelHits.push({ kind: 'note', owner: n.key, index: note.index, box: { x1: nx - 2, y1: ny - ns, x2: nx + w + 2, y2: ny + ns * 0.3 } });
      }
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
    const hl = m.fs * 0.45;
    const map = (q: [number, number]): [number, number] => [X(q[0]), Y(q[1])];
    const d = geomPath(g, map);
    const width = Math.max(0.8, style.lineWidth * 1.05);
    const dash = a.line === 'dashed' ? [5, 3.5] : a.line === 'dotted' ? [1.2, 2.8] : undefined;
    prims.push({ t: 'path', d, stroke: color, width, dash, role: 'arrow', arrow: i });
    const head = ([tip, from]: [[number, number], [number, number]]) => {
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
    if (a.head === 'end' || a.head === 'both') prims.push({ t: 'path', d: head(geomEnd(g, 'end')), fill: color, role: 'arrowhead', arrow: i });
    if (a.head === 'start' || a.head === 'both') prims.push({ t: 'path', d: head(geomEnd(g, 'start')), fill: color, role: 'arrowhead', arrow: i });
    for (const l of g.labels) {
      const runs = a.labels.find((x) => x.index === l.index)!.runs;
      const lx = X(l.x) - l.w / 2;
      const ly = Y(l.y);
      drawRuns(runs, lx, ly, arrowFs, true, false, color, 'arrowlabel');
      labelHits.push({ kind: 'arrow', owner: i, index: l.index, box: { x1: lx - 2, y1: ly - arrowFs, x2: lx + l.w + 2, y2: ly + arrowFs * 0.3 } });
    }
    const segs = g.segs.map((c) => c.map(map) as typeof c);
    arrowHits.push({ index: i, geom: { ...g, segs, knots: g.knots.map(map), mid: map(g.mid), handle: map(g.handle) }, d });
  });

  return {
    width: Math.ceil(sheetW),
    height: Math.ceil(sheetH),
    background: style.background,
    prims,
    hits,
    arrows: arrowHits,
    labels: labelHits,
    layout,
    dx,
    dy,
    style,
  };
}
