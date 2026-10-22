import { runsWidth } from './measure';
import type { FontSpec, Measure } from './measure';
import type { LabelSide } from './ast';
import type { DNode, DTree } from './model';
import { plain } from './richtext';
import type { Runs } from './richtext';
import { metricsFor } from './style';
import type { TreeStyle } from './style';

/**
 * Tree layout.
 *
 * 1. Every node gets a "block": its label, an optional feature stack and (for terminals) gloss lines.
 * 2. Nodes are assigned to rows (depth). Multidominated nodes sit one row below their lowest mother.
 * 3. A contour-based tidy algorithm (Reingold–Tilford style, variable widths) places the tree
 *    without multidominated subtrees; parents are centred over their daughters.
 * 4. Each multidominated subtree is then placed as close as possible to the midpoint of its mothers
 *    at a position where it overlaps nothing and its extra branches cross no labels.
 */

export interface Block {
  w: number;
  /** height of label + features (where branches start) */
  h: number;
  /** total height including glosses */
  fullH: number;
  labelW: number;
  labelH: number;
  featureW: number;
  featureH: number;
  glossW: number;
  glossH: number;
  semW: number;
  semH: number;
  /** notes beside the label (they widen the node on that side) */
  extraL: number;
  extraR: number;
  /** notes above the label and below the block */
  notesAboveH: number;
  notesBelowH: number;
  /** label is empty: branches meet at a point */
  point: boolean;
}

export interface LNode {
  node: DNode;
  /** centre x */
  x: number;
  /** top y of the block */
  y: number;
  row: number;
  block: Block;
}

export interface LEdge {
  parent: LNode;
  child: LNode;
  kind: 'line' | 'triangle';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** triangle: base corners */
  bx1?: number;
  bx2?: number;
  /** an extra branch to a multidominated node */
  shared?: boolean;
  /** routed branch: polyline through free gaps (start and end included) */
  pts?: [number, number][];
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  nodes: Map<DNode, LNode>;
  list: LNode[];
  edges: LEdge[];
  /** bounding box of nodes and edges (without padding) */
  box: Box;
  rowTops: number[];
  style: TreeStyle;
}

export function fontFor(n: DNode, style: TreeStyle): FontSpec {
  return n.kind === 'leaf'
    ? { font: style.font, size: style.fontSize, italic: style.leafItalic }
    : { font: style.font, size: style.fontSize, bold: style.nodeBold };
}

export function displayLabel(n: DNode, style: TreeStyle): Runs {
  if (n.copy && style.copyStyle === 'angle' && n.kind === 'leaf') {
    return [{ text: '⟨' }, ...n.label, { text: '⟩' }];
  }
  return n.label;
}

/** Which side a note goes to: explicit, or left for a first daughter and right otherwise. */
export function noteSide(n: DNode, side: LabelSide): Exclude<LabelSide, 'auto'> {
  if (side !== 'auto') return side;
  const p = n.parents[0];
  return p && p.children.length > 1 && p.children[0] === n ? 'left' : 'right';
}

export const NOTE_SCALE = 0.82;

/** Prefer the outside of a branch; reserve that space during layout, including other notes. */
export function spelloutSide(n: DNode): 'left' | 'right' {
  if (n.spellout?.side && n.spellout.side !== 'auto') return n.spellout.side;
  const occupied = (side: 'left' | 'right') => (n.notes ?? []).filter((x) => noteSide(n, x.side) === side).length;
  if (occupied('left') !== occupied('right')) return occupied('left') < occupied('right') ? 'left' : 'right';
  return noteSide(n, 'auto') === 'left' ? 'left' : 'right';
}

export function spelloutRuns(n: DNode, italicExpressions = false): Runs {
  if (!n.spellout || n.copy) return [];
  const expression = (n.spellout.failed ? [{ text: '∅' }] : n.spellout.runs).map((r) => ({ ...r, i: italicExpressions !== !!r.i }));
  // Arrows stay upright even when word/morpheme expressions are italicized.
  const arrow = n.spellout.lexical ? '⇔' : spelloutSide(n) === 'right' ? '⇒' : '⇐';
  return spelloutSide(n) === 'right' ? [{ text: ' ' + arrow + ' ' }, ...expression] : [...expression, { text: ' ' + arrow + ' ' }];
}

/** Overt nodes inside the lexicalized constituent; movement copies are separate domains. */
export function spelloutDomainNodes(root: DNode): DNode[] {
  const seen = new Set<DNode>();
  const nodes: DNode[] = [];
  const visit = (n: DNode) => {
    if (seen.has(n) || n.copy) return;
    seen.add(n);
    nodes.push(n);
    for (const child of n.children) visit(child);
  };
  visit(root);
  return nodes;
}

/** Ellipses enclose the actual nodes of the domain, without its side expression or lower copies. */
export function spelloutDomains(layout: Layout): { node: DNode; box: Box }[] {
  if (!layout.style.circlePhrasalSpellout) return [];
  const domains: { node: DNode; box: Box }[] = [];
  for (const ln of layout.list) {
    if (!spelloutRuns(ln.node).length) continue;
    const nodes = spelloutDomainNodes(ln.node).map((n) => layout.nodes.get(n)).filter((x): x is LNode => !!x);
    domains.push({ node: ln.node, box: domainEllipse(nodes, layout.style) });
  }
  return domains;
}

/** Smallest proportional enlargement of a bounding ellipse that encloses each padded label. */
function domainEllipse(nodes: LNode[], style: TreeStyle): Box {
  const pad = Math.max(5, style.fontSize * .35);
  const bounds = nodes.map((n) => ({
    x1: n.x - n.block.w / 2 - pad, x2: n.x + n.block.w / 2 + pad,
    y1: n.y - pad, y2: n.y + Math.max(n.block.fullH, 2) + pad,
  }));
  const cx = (Math.min(...bounds.map((b) => b.x1)) + Math.max(...bounds.map((b) => b.x2))) / 2;
  const cy = (Math.min(...bounds.map((b) => b.y1)) + Math.max(...bounds.map((b) => b.y2))) / 2;
  let rx = Math.max(...bounds.map((b) => b.x2 - cx), pad);
  let ry = Math.max(...bounds.map((b) => b.y2 - cy), pad);
  const scale = Math.max(1, ...bounds.flatMap((b) => [b.x1, b.x2].flatMap((x) => [b.y1, b.y2].map((y) => Math.hypot((x - cx) / rx, (y - cy) / ry)))));
  rx *= scale; ry *= scale;
  return { x1: cx - rx, x2: cx + rx, y1: cy - ry, y2: cy + ry };
}

/** Expression position, beyond any notes and the optional domain outline. */
export function spelloutPosition(ln: LNode, style: TreeStyle, measure: Measure, domain?: Box): { x: number; width: number } {
  const n = ln.node;
  const size = style.fontSize * NOTE_SCALE;
  const width = runsWidth(spelloutRuns(n, style.leafItalic), { font: style.font, size }, measure);
  const side = spelloutSide(n);
  const notes = (n.notes ?? []).filter((note) => !note.off && noteSide(n, note.side) === side);
  const noteW = Math.max(0, ...notes.map((note) => runsWidth(note.runs, { font: style.font, size }, measure) + 6));
  let left = ln.x - ln.block.labelW / 2 - noteW;
  let right = ln.x + ln.block.labelW / 2 + noteW;
  if (domain) {
    const cx = (domain.x1 + domain.x2) / 2, cy = (domain.y1 + domain.y2) / 2;
    const rx = (domain.x2 - domain.x1) / 2, ry = (domain.y2 - domain.y1) / 2;
    const y = ln.y + metricsFor(style).ascent - size * .3;
    const half = rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
    left = Math.min(left, cx - half);
    right = Math.max(right, cx + half);
  }
  return { x: side === 'right' ? right + 6 : left - 6 - width, width };
}

/** The meaning line under a node: formula, type, composition rule, or an error. */
export function semDisplay(n: DNode): { runs: Runs; kind: 'given' | 'computed' | 'error'; title?: string } | null {
  const s = n.sem;
  if (!s) return null;
  if (s.error) {
    const short = s.error.replace(/^No composition rule applies to (.*?) \(.*$/, 'no rule for $1').replace(/ and /, ' + ');
    return { runs: [{ text: '✗ ' + (short.length > 70 ? short.slice(0, 68) + '…' : short) }], kind: 'error', title: s.error };
  }
  const runs: Runs = [...s.runs];
  if (s.type) runs.push({ text: ' : ' + s.type });
  if (s.computed && s.rule) runs.push({ text: '  ' + s.rule.toLowerCase(), sc: true });
  return { runs, kind: s.computed ? 'computed' : 'given' };
}

export function measureBlock(n: DNode, style: TreeStyle, measure: Measure): Block {
  const m = metricsFor(style);
  const label = displayLabel(n, style);
  const empty = plain(label).trim() === '';
  const labelW = empty ? 0 : runsWidth(label, fontFor(n, style), measure);
  const labelH = empty && n.kind === 'phrase' ? 0 : m.lineH;
  let featureW = 0;
  let featureH = 0;
  if (n.features?.length) {
    for (const f of n.features) featureW = Math.max(featureW, runsWidth(f, { font: style.font, size: m.featureFs }, measure));
    featureW += m.featureFs * 0.9; // brackets
    featureH = n.features.length * m.featureLineH + m.featureFs * 0.35;
  }
  let glossW = 0;
  let glossH = 0;
  if (n.gloss?.length) {
    for (const g of n.gloss) glossW = Math.max(glossW, runsWidth(g, { font: style.font, size: m.glossFs }, measure));
    glossH = n.gloss.length * m.glossLineH;
  }
  let semW = 0;
  let semH = 0;
  const sem = semDisplay(n);
  if (sem) {
    semW = runsWidth(sem.runs, { font: style.font, size: m.semFs }, measure);
    semH = m.semLineH;
  }
  let extraL = 0;
  let extraR = 0;
  let notesAboveH = 0;
  let notesBelowH = 0;
  let belowW = 0;
  const noteFs = style.fontSize * NOTE_SCALE;
  for (const note of n.notes ?? []) {
    const nw = runsWidth(note.runs, { font: style.font, size: noteFs }, measure);
    const side = noteSide(n, note.side);
    if (note.off) continue; // a dragged note does not take part in the layout
    if (side === 'left') extraL = Math.max(extraL, nw + 6);
    else if (side === 'right') extraR = Math.max(extraR, nw + 6);
    else if (side === 'above') notesAboveH += noteFs * 1.25;
    else {
      notesBelowH += noteFs * 1.25;
      belowW = Math.max(belowW, nw);
    }
  }
  const spell = spelloutRuns(n, style.leafItalic);
  if (spell.length) {
    const width = runsWidth(spell, { font: style.font, size: noteFs }, measure) + 6;
    if (spelloutSide(n) === 'left') extraL += width;
    else extraR += width;
  }
  const point = empty && !n.features?.length && !sem && n.kind === 'phrase';
  const w = Math.max(labelW, featureW, glossW, semW, belowW, point ? 2 : 0);
  const h = labelH + featureH + semH;
  return { w, h, fullH: h + glossH + notesBelowH, labelW, labelH, featureW, featureH, glossW, glossH, semW, semH, extraL, extraR, notesAboveH, notesBelowH, point };
}

type Contour = Map<number, [number, number]>;

interface Sub {
  contour: Contour;
  /** relative x of each daughter */
  offsets: Map<DNode, number>;
}

function mergeInto(target: Contour, src: Contour, dx: number) {
  for (const [row, [l, r]] of src) {
    const t = target.get(row);
    if (t) target.set(row, [Math.min(t[0], l + dx), Math.max(t[1], r + dx)]);
    else target.set(row, [l + dx, r + dx]);
  }
}

export function layoutTree(tree: DTree, style: TreeStyle, measure: Measure): Layout {
  const m = metricsFor(style);
  const nodes = tree.nodes;
  const blocks = new Map<DNode, Block>();
  for (const n of nodes) blocks.set(n, measureBlock(n, style, measure));

  const shared = new Set(nodes.filter((n) => n.parents.length > 1));
  const gap = style.siblingGap;

  // dominance among nodes, to find the "lower" mothers of a shared node
  const descMemo = new Map<DNode, Set<DNode>>();
  const desc = (n: DNode): Set<DNode> => {
    let d = descMemo.get(n);
    if (d) return d;
    d = new Set();
    for (const c of n.children) {
      d.add(c);
      for (const x of desc(c)) d.add(x);
    }
    descMemo.set(n, d);
    return d;
  };
  /** mothers that do not dominate another mother (the "base" positions) */
  const lowerMothers = new Map<DNode, DNode[]>();
  /** a shared node with a single lower mother is laid out as that mother's ordinary daughter */
  const host = new Map<DNode, DNode>();
  for (const s of shared) {
    const ms = [...new Set(s.parents)];
    const low = ms.filter((m) => !ms.some((o) => o !== m && desc(m).has(o)));
    lowerMothers.set(s, low);
    if (low.length === 1) host.set(s, low[0]);
  }
  /** detached: placed after the main layout */
  const isShared = (n: DNode) => shared.has(n) && !host.has(n);
  const slotKey = (m: DNode, s: DNode) => m.key + '\u0000' + s.key;

  // extra rows that pushed-down shared nodes get
  const push = new Map<DNode, number>();

  let result: Layout | null = null;
  for (let iter = 0; iter < 4; iter++) {
    // ---- rows (longest path in the DAG)
    const row = new Map<DNode, number>();
    const order = topoOrder(tree.root);
    for (const n of order) {
      if (n === tree.root) row.set(n, 0);
      else row.set(n, Math.max(...n.parents.map((p) => row.get(p)! + 1)) + (push.get(n) ?? 0));
    }
    const natural = new Map(row);
    if (style.leavesAtBottom) {
      let bottom = 0;
      for (const n of nodes) if (n.kind === 'leaf') bottom = Math.max(bottom, row.get(n)!);
      for (const n of nodes) if (n.kind === 'leaf') row.set(n, bottom);
    }
    // ---- row heights
    const maxRow = Math.max(...row.values());
    const rowH: number[] = new Array(maxRow + 1).fill(0);
    for (const n of nodes) {
      const r = row.get(n)!;
      rowH[r] = Math.max(rowH[r], blocks.get(n)!.fullH);
    }
    const rowTops: number[] = [];
    let y = 0;
    for (let r = 0; r <= maxRow + 6; r++) {
      rowTops.push(y);
      y += (rowH[r] || m.lineH) + style.levelGap;
    }

    // ---- tidy layout of a unit (subtree without shared daughters)
    const subs = new Map<DNode, Sub>();
    const slotRel = new Map<string, number>();
    const slotAbs = new Map<string, number>();
    const leafColumn = (n: DNode, c: Contour) => {
      const r0 = natural.get(n)!;
      const r1 = row.get(n)!;
      const half = blocks.get(n)!.w / 2;
      const tri = n.parents.some((p) => p.triangle);
      for (let r = r0; r < r1; r++) c.set(r, tri ? [-half, half] : [-1, 1]);
    };
    const tidy = (n: DNode): Sub => {
      const b = blocks.get(n)!;
      const contour: Contour = new Map([[row.get(n)!, [-b.w / 2 - b.extraL, b.w / 2 + b.extraR]]]);
      if (n.kind === 'leaf') leafColumn(n, contour);
      // the feature stack / gloss hang below the label: they belong to the same row
      const kids = n.children.filter((c) => !isShared(c) || lowerMothers.get(c)!.includes(n));
      const offsets = new Map<DNode, number>();
      const reserveDomain = (offsets: Map<DNode, number>) => {
        if (!style.circlePhrasalSpellout || !spelloutRuns(n).length) return;
        // An outline and its side expression belong to the subtree's contour too.
        // Reserving them here prevents sister circles from intersecting and inward
        // expressions from crossing a neighbouring constituent's labels.
        const domainNodes: LNode[] = [];
        const gather = (q: DNode, x: number, extraY: number, seen = new Set<DNode>()) => {
          if (q.copy || seen.has(q)) return;
          seen.add(q);
          domainNodes.push({ node: q, x, y: rowTops[row.get(q)!] + extraY, row: row.get(q)!, block: blocks.get(q)! });
          const qs = q === n ? { offsets } : subs.get(q);
          if (!qs) return;
          for (const [c, childX] of qs.offsets) gather(c, x + childX, extraY + (c.edgeLen ?? 0), seen);
        };
        gather(n, 0, 0);
        const ellipse = domainEllipse(domainNodes, style);
        const cx = (ellipse.x1 + ellipse.x2) / 2, cy = (ellipse.y1 + ellipse.y2) / 2;
        const rx = (ellipse.x2 - ellipse.x1) / 2, ry = (ellipse.y2 - ellipse.y1) / 2;
        const circleContour: Contour = new Map();
        for (let r = 0; r < rowTops.length; r++) {
          const y1 = rowTops[r] - style.levelGap / 2;
          const y2 = rowTops[r] + (rowH[r] || m.lineH) + style.levelGap / 2;
          if (y2 < ellipse.y1 || y1 > ellipse.y2) continue;
          const y = Math.max(y1, Math.min(cy, y2));
          const half = rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
          circleContour.set(r, [cx - half, cx + half]);
        }
        const expression = spelloutPosition(domainNodes[0], style, measure, ellipse);
        const expressionContour: Contour = new Map([[row.get(n)!, [expression.x, expression.x + expression.width]]]);
        mergeInto(contour, circleContour, 0);
        mergeInto(contour, expressionContour, 0);
      };
      if (kids.length === 0) {
        reserveDomain(offsets);
        const s: Sub = { contour, offsets };
        subs.set(n, s);
        return s;
      }
      const merged: Contour = new Map();
      let pos = 0;
      kids.forEach((k, i) => {
        const isSlot = isShared(k) || (host.has(k) && host.get(k) !== n);
        const ks: Sub = isSlot
          ? { contour: new Map([[row.get(n)! + 1, [-blocks.get(k)!.w / 2, blocks.get(k)!.w / 2]]]), offsets: new Map() }
          : tidy(k);
        if (i === 0) {
          pos = 0;
        } else {
          let need = -Infinity;
          for (const [r, [l]] of ks.contour) {
            const t = merged.get(r);
            if (t) need = Math.max(need, t[1] - l + gap + (n.spread ?? 0));
          }
          pos = need === -Infinity ? pos + gap + (n.spread ?? 0) : need;
        }
        if (isSlot) slotRel.set(slotKey(n, k), pos);
        else offsets.set(k, pos);
        mergeInto(merged, ks.contour, pos);
      });
      // centre the parent over its first and last daughter
      const off = (k: DNode) => offsets.get(k) ?? slotRel.get(slotKey(n, k))!;
      const centre = (off(kids[0]) + off(kids[kids.length - 1])) / 2;
      for (const k of kids) {
        if (offsets.has(k)) offsets.set(k, offsets.get(k)! - centre);
        else slotRel.set(slotKey(n, k), slotRel.get(slotKey(n, k))! - centre);
      }
      mergeInto(contour, merged, -centre);
      reserveDomain(offsets);
      // a parent label wider than its daughters is already in the contour
      const s: Sub = { contour, offsets };
      subs.set(n, s);
      return s;
    };

    const lnodes = new Map<DNode, LNode>();
    const place = (n: DNode, x: number) => {
      lnodes.set(n, { node: n, x, y: rowTops[row.get(n)!], row: row.get(n)!, block: blocks.get(n)! });
      const s = subs.get(n)!;
      for (const [k, dx] of s.offsets) place(k, x + dx);
      for (const c of n.children) {
        const r = slotRel.get(slotKey(n, c));
        if (r !== undefined) slotAbs.set(slotKey(n, c), x + r);
      }
    };
    tidy(tree.root);
    place(tree.root, 0);

    // ---- collision structures
    const boxes: { box: Box; node: DNode }[] = [];
    const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const boxOf = (ln: LNode, pad = 0): Box => ({
      x1: ln.x - ln.block.w / 2 - ln.block.extraL - pad,
      y1: ln.y - pad,
      x2: ln.x + ln.block.w / 2 + ln.block.extraR + pad,
      y2: ln.y + ln.block.fullH + pad,
    });
    const attachBottom = (ln: LNode) => (ln.block.point ? ln.y + style.edgeGap : ln.y + ln.block.h - m.bottomInset + style.edgeGap);
    const attachTop = (ln: LNode) => (ln.block.point ? ln.y : ln.y + m.topInset - style.edgeGap);
    const addUnit = (n: DNode, seen = new Set<DNode>()) => {
      if (seen.has(n)) return;
      seen.add(n);
      const ln = lnodes.get(n)!;
      boxes.push({ box: boxOf(ln), node: n });
      for (const c of n.children) {
        if (isShared(c) || (host.has(c) && host.get(c) !== n)) continue;
        const lc = lnodes.get(c)!;
        segs.push({ x1: ln.x, y1: attachBottom(ln), x2: lc.x, y2: attachTop(lc) });
        addUnit(c, seen);
      }
    };
    addUnit(tree.root);

    // ---- place shared subtrees
    let changed = false;
    const sharedOrder = order.filter(isShared);
    for (const s of sharedOrder) {
      const mothers = s.parents.map((p) => lnodes.get(p)).filter((p): p is LNode => !!p);
      tidy(s);
      // relative layout of the unit at x = 0
      const rel: { node: DNode; dx: number }[] = [];
      const collect = (n: DNode, dx: number) => {
        rel.push({ node: n, dx });
        for (const [k, kdx] of subs.get(n)!.offsets) collect(k, dx + kdx);
      };
      collect(s, 0);
      const low = lowerMothers.get(s)!;
      const slots = low.map((mo) => slotAbs.get(slotKey(mo, s)) ?? lnodes.get(mo)?.x ?? 0);
      const ideal = slots.reduce((a, x) => a + x, 0) / Math.max(1, slots.length);
      let best = { cost: Infinity, x: ideal, dr: 0 };
      const span = Math.max(400, ...boxes.map((b) => Math.abs(b.box.x1 - ideal)), ...boxes.map((b) => Math.abs(b.box.x2 - ideal)));
      for (let dr = 0; dr <= 3; dr++) {
        if (iter === 3 && dr > 0) break;
        const rowOf = (n: DNode) => (style.leavesAtBottom && n.kind === 'leaf' ? row.get(n)! : row.get(n)! + dr);
        const yOf = (n: DNode) => rowTops[Math.min(rowOf(n), rowTops.length - 1)];
        const sTop = yOf(s) + (blocks.get(s)!.point ? 0 : m.topInset - style.edgeGap);
        const step = 3;
        for (let k = 0; k * step <= span + 200; k++) {
          let foundClean = false;
          for (const sign of k === 0 ? [1] : [1, -1]) {
            const x = ideal + sign * k * step;
            // hard: overlaps
            let hard = false;
            const myBoxes: Box[] = [];
            for (const { node, dx } of rel) {
              const b = blocks.get(node)!;
              const bx: Box = { x1: x + dx - b.w / 2 - gap / 2, y1: yOf(node) - 2, x2: x + dx + b.w / 2 + gap / 2, y2: yOf(node) + b.fullH + 2 };
              myBoxes.push(bx);
              if (boxes.some((o) => overlap(o.box, bx))) {
                hard = true;
                break;
              }
              if (segs.some((sg) => segBox(sg, bx))) {
                hard = true;
                break;
              }
            }
            if (hard) continue;
            // soft: extra branches crossing labels or branches
            let crossings = 0;
            for (const mo of mothers) {
              const sg = { x1: mo.x, y1: attachBottom(mo), x2: x, y2: sTop };
              // branches from the base positions must stay clear; a long branch from a
              // dominating (re-merge) position inevitably crosses the tree and costs less
              const w = low.includes(mo.node) ? 1 : 0.04;
              for (const o of boxes) {
                if (o.node === mo.node) continue;
                if (segBox(sg, shrink(o.box, 1))) crossings += 10 * w;
              }
              for (const o of segs) if (segSeg(sg, o)) crossings += 1 * w;
            }
            const cost = crossings * 1000 + Math.abs(x - ideal) + dr * 120;
            if (cost < best.cost) best = { cost, x, dr };
            if (crossings === 0) foundClean = true;
          }
          if (foundClean) break;
          if (k * step > best.cost) break;
        }
      }
      if (best.dr > 0) {
        push.set(s, (push.get(s) ?? 0) + best.dr);
        changed = true;
      }
      // place it (rows as currently assigned; a re-run fixes pushed rows)
      for (const { node, dx } of rel) {
        lnodes.set(node, { node, x: best.x + dx, y: rowTops[row.get(node)!], row: row.get(node)!, block: blocks.get(node)! });
      }
      for (const { node } of rel) {
        const ln = lnodes.get(node)!;
        boxes.push({ box: boxOf(ln), node });
        for (const c of node.children) {
          if (isShared(c) || (host.has(c) && host.get(c) !== node)) continue;
          const lc = lnodes.get(c)!;
          segs.push({ x1: ln.x, y1: attachBottom(ln), x2: lc.x, y2: attachTop(lc) });
        }
      }
      const ls = lnodes.get(s)!;
      for (const mo of mothers) segs.push({ x1: mo.x, y1: attachBottom(mo), x2: ls.x, y2: attachTop(ls) });
    }

    // ---- per-node extra edge length (;len=): the node and everything below it move down
    if (nodes.some((n) => n.edgeLen)) {
      const shifted = new Set<DNode>();
      const shift = (n: DNode, acc: number) => {
        if (shifted.has(n)) return;
        shifted.add(n);
        const total = acc + (n.edgeLen ?? 0);
        const ln = lnodes.get(n);
        if (ln && total) ln.y += total;
        for (const c of n.children) shift(c, total);
      };
      shift(tree.root, 0);
    }

    // ---- edges
    const edges: LEdge[] = [];
    for (const n of nodes) {
      const p = lnodes.get(n);
      if (!p) continue;
      for (const c of n.children) {
        const lc = lnodes.get(c);
        if (!lc) continue;
        const e: LEdge = {
          parent: p,
          child: lc,
          kind: n.triangle && c.kind === 'leaf' ? 'triangle' : 'line',
          x1: p.x,
          y1: attachBottom(p),
          x2: lc.x,
          y2: attachTop(lc),
          shared: c.parents.length > 1,
        };
        if (e.kind === 'triangle') {
          const half = Math.max(lc.block.labelW / 2, m.fs * 0.6);
          e.bx1 = lc.x - half;
          e.bx2 = lc.x + half;
        }
        edges.push(e);
      }
    }
    const list = [...lnodes.values()];
    // ---- route branches to multidominated nodes around labels
    const rowBottom = (r: number) => rowTops[r] + (rowH[r] || m.lineH);
    for (const e of edges) {
      if (!e.shared || e.kind !== 'line') continue;
      const others = list.filter((ln) => ln !== e.parent && ln !== e.child);
      const crosses = (sg: { x1: number; y1: number; x2: number; y2: number }) =>
        others.some((ln) => segBox(sg, { x1: ln.x - ln.block.w / 2 - 2, y1: ln.y, x2: ln.x + ln.block.w / 2 + 2, y2: ln.y + ln.block.fullH }));
      if (!crosses(e)) continue;
      const pts: [number, number][] = [[e.x1, e.y1]];
      const r0 = e.parent.row;
      const r1 = e.child.row;
      for (let r = r0 + 1; r < r1; r++) {
        const top = rowTops[r] - 3;
        const bot = rowBottom(r) + 3;
        const mid = (top + bot) / 2;
        const t = (mid - e.y1) / (e.y2 - e.y1 || 1);
        const want = e.x1 + (e.x2 - e.x1) * t;
        const pad = Math.max(6, gap / 2);
        const blocked = others
          .filter((ln) => ln.y < bot && ln.y + ln.block.fullH > top)
          .map((ln) => [ln.x - ln.block.w / 2 - pad, ln.x + ln.block.w / 2 + pad] as [number, number]);
        const free = (x: number) => !blocked.some(([a, b]) => x > a && x < b);
        let best = want;
        if (!free(want)) {
          const cands = blocked.flatMap(([a, b]) => [a, b]).filter(free);
          best = cands.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0] ?? want;
        }
        pts.push([best, top], [best, bot]);
      }
      pts.push([e.x2, e.y2]);
      // string pulling: keep only the waypoints that are needed
      const pulled: [number, number][] = [pts[0]];
      let i = 0;
      while (i < pts.length - 1) {
        let j = pts.length - 1;
        while (j > i + 1 && crosses({ x1: pts[i][0], y1: pts[i][1], x2: pts[j][0], y2: pts[j][1] })) j--;
        pulled.push(pts[j]);
        i = j;
      }
      e.pts = pulled;
    }
    const box: Box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    for (const ln of list) {
      box.x1 = Math.min(box.x1, ln.x - ln.block.w / 2 - ln.block.extraL);
      box.x2 = Math.max(box.x2, ln.x + ln.block.w / 2 + ln.block.extraR);
      box.y1 = Math.min(box.y1, ln.y - ln.block.notesAboveH);
      box.y1 = Math.min(box.y1, ln.y);
      box.y2 = Math.max(box.y2, ln.y + ln.block.fullH);
    }
    for (const e of edges) {
      box.x1 = Math.min(box.x1, e.x1, e.x2, e.bx1 ?? Infinity);
      box.x2 = Math.max(box.x2, e.x1, e.x2, e.bx2 ?? -Infinity);
    }
    result = { nodes: lnodes, list, edges, box, rowTops, style };
    if (!changed) break;
  }
  return result!;
}

/** Topological order of the DAG (mothers before daughters). */
export function topoOrder(root: DNode): DNode[] {
  const indeg = new Map<DNode, number>();
  const all: DNode[] = [];
  const seen = new Set<DNode>();
  const visit = (n: DNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    all.push(n);
    for (const c of n.children) visit(c);
  };
  visit(root);
  for (const n of all) indeg.set(n, 0);
  for (const n of all) for (const c of n.children) indeg.set(c, indeg.get(c)! + 1);
  const out: DNode[] = [];
  const queue = all.filter((n) => indeg.get(n) === 0);
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const c of n.children) {
      indeg.set(c, indeg.get(c)! - 1);
      if (indeg.get(c) === 0) queue.push(c);
    }
  }
  return out;
}

export function overlap(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

function shrink(b: Box, d: number): Box {
  return { x1: b.x1 + d, y1: b.y1 + d, x2: b.x2 - d, y2: b.y2 - d };
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

function ccw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax);
}

export function segSeg(a: Seg, b: Seg): boolean {
  // shared endpoints do not count
  const eq = (x1: number, y1: number, x2: number, y2: number) => Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) < 0.5;
  if (eq(a.x1, a.y1, b.x1, b.y1) || eq(a.x1, a.y1, b.x2, b.y2) || eq(a.x2, a.y2, b.x1, b.y1) || eq(a.x2, a.y2, b.x2, b.y2)) return false;
  const d1 = ccw(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = ccw(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = ccw(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = ccw(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does a segment pass through a box? */
export function segBox(s: Seg, b: Box): boolean {
  const inside = (x: number, y: number) => x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2;
  if (inside(s.x1, s.y1) || inside(s.x2, s.y2)) return true;
  const edges: Seg[] = [
    { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y1 },
    { x1: b.x2, y1: b.y1, x2: b.x2, y2: b.y2 },
    { x1: b.x2, y1: b.y2, x2: b.x1, y2: b.y2 },
    { x1: b.x1, y1: b.y2, x2: b.x1, y2: b.y1 },
  ];
  return edges.some((e) => segSeg(s, e));
}
