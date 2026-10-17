import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import * as A from '../actions';
import { cCommandDomain, dominated } from '../core/analysis';
import { plain } from '../core/richtext';
import { insertVia, viaPoints } from '../core/arrows';
import type { NodeHit, Scene } from '../core/scene';
import { collectNodes } from '../core/model';
import type { DNode } from '../core/model';
import { primToSvg } from '../render/svg';
import { t } from '../i18n';
import {
  activateTree, activeId, activeTree, addTree, appearanceScope, setStyle, arrowSource, EMPTY_SHEET, sideTab, clearCanvas, duplicateTree, modal, removeTree, renameTree, bendOverride, editable, fitRequest, fontEpoch, linkCounts, linkedIds, moveTree, otherScenes, pick, relationOf, requestLabelFocus, scene, selection, tool, tree, trees,
} from '../state';
import type { Tool } from '../state';
import { IArrowTool, ICcommand, IDominance, IFit, ILink, IMinus, IPlus, IPointer, ITrash } from './icons';

interface View {
  zoom: number;
  x: number;
  y: number;
}

type Box = { x1: number; y1: number; x2: number; y2: number };

type Drag =
  | { kind: 'pan'; vx: number; vy: number; target: Element }
  | { kind: 'bend'; index: number; bend: [number, number] }
  | { kind: 'via'; index: number; point: number; via: [number, number][] }
  | { kind: 'label'; label: { kind: 'note' | 'arrow'; owner: string | number; index: number; off: [number, number]; box: Box } }
  | { kind: 'tree'; id: string; x: number; y: number }
  /** the corner of the sheet: its size */
  | { kind: 'sheet'; w: number; h: number }
  /** a branch dragged by its root */
  | { kind: 'node'; key: string; target: Element }
  /** a rectangle drawn with Shift: selects the smallest branch with everything in it */
  | { kind: 'marquee'; x0: number; y0: number };

/** everything a node dominates, as boxes of the picture */
function branchBox(root: DNode, hits: Map<string, NodeHit>, pad = 5): Box | null {
  let b: Box | null = null;
  for (const n of collectNodes(root)) {
    const h = hits.get(n.key);
    if (!h) continue;
    b = b ? { x1: Math.min(b.x1, h.box.x1), y1: Math.min(b.y1, h.box.y1), x2: Math.max(b.x2, h.box.x2), y2: Math.max(b.y2, h.box.y2) } : { ...h.box };
  }
  return b && { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad };
}

/** a colour per group of linked branches */
function linkColour(group: string): string {
  let h = 0;
  for (const c of group) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${(h * 7) % 360} 70% 45%)`;
}

/** boxes around the linked branches of a picture (groups with more than one copy) */
function linkedBoxes(sc: Scene, counts: Map<string, number>): { box: Box; group: string; count: number }[] {
  const hits = new Map(sc.hits.map((h) => [h.key, h]));
  const out: { box: Box; group: string; count: number }[] = [];
  for (const h of sc.hits) {
    const src = h.node.src;
    const g = src?.kind === 'node' ? src.opts?.link : undefined;
    if (!g || h.node.copyOf || (counts.get(g) ?? 0) < 2) continue;
    const box = branchBox(h.node, hits, 7);
    if (box) out.push({ box, group: g, count: counts.get(g)! });
  }
  return out;
}

function LinkedFrames({ sc, counts }: { sc: Scene; counts: Map<string, number> }) {
  return (
    <>
      {linkedBoxes(sc, counts).map(({ box, group, count }, i) => (
        <g key={'lk' + i} class="linked-frame" style={{ color: linkColour(group) }}>
          <rect x={box.x1} y={box.y1} width={box.x2 - box.x1} height={box.y2 - box.y1} rx="8" />
          <text x={box.x1 + 4} y={box.y1 - 3}>
            linked ×{count}
          </text>
          <title>Linked branch: what changes inside it changes in its {count - 1} other cop{count === 2 ? 'y' : 'ies'}</title>
        </g>
      ))}
    </>
  );
}

export function Canvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const view = useSignal<View>({ zoom: 1, x: 0, y: 0 });
  const size = useSignal({ w: 800, h: 600 });
  const hover = useSignal<string | null>(null);

  /** the view was moved or zoomed by hand: it is not fitted again by itself */
  const touched = useRef(false);
  const setView = (v: View) => {
    touched.current = true;
    view.value = v;
  };

  // ---------- fit: all trees of the canvas
  const fit = () => {
    touched.current = false;
    const sheets = allSheets();
    if (!sheets.length) return;
    const x1 = Math.min(...sheets.map((s) => s.x));
    const y1 = Math.min(...sheets.map((s) => s.y - (sheets.length > 1 ? 28 : 0)));
    const x2 = Math.max(...sheets.map((s) => s.x + s.w));
    const y2 = Math.max(...sheets.map((s) => s.y + s.h));
    const { w, h } = size.value;
    const margin = w < 600 ? 16 : 40;
    const bottom = 64; // floating toolbar
    const z = Math.min(1.5, (w - margin * 2) / (x2 - x1), (h - margin - bottom) / (y2 - y1));
    const zoom = Math.max(0.15, z);
    view.value = { zoom, x: (w - (x2 - x1) * zoom) / 2 - x1 * zoom, y: Math.max(margin, (h - bottom + margin - (y2 - y1) * zoom) / 2) - y1 * zoom };
  };

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const first = size.value.w === 800 && size.value.h === 600;
      size.value = { w: r.width, h: r.height };
      if (first) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // another tree (an example, a file, a link): fit it, after the new scene is computed
  useSignalEffect(() => {
    void fitRequest.value;
    requestAnimationFrame(() => fit());
  });
  // a font has loaded and the picture changed size: fit again, unless the view was set by hand
  useSignalEffect(() => {
    void fontEpoch.value;
    requestAnimationFrame(() => !touched.current && fit());
  });

  const sc = scene.value;
  const tr = tree.value;
  const active = activeTree.value;
  const many = trees.value.length > 1;

  // ---------- relations
  const relation = useComputed(() => {
    const key = relationOf.value;
    const tl = tool.value;
    if (!key || (tl !== 'ccommand' && tl !== 'dominance')) return null;
    const n = tree.value?.nodes.find((x) => x.key === key);
    if (!n) return null;
    const set = tl === 'ccommand' ? cCommandDomain(n) : dominated(n);
    return { kind: tl, of: key, keys: new Set([...set].map((x) => x.key)) };
  });

  // ---------- coordinates
  const v = view.value;
  const toScreen = (x: number, y: number) => ({ x: x * v.zoom + v.x, y: y * v.zoom + v.y });
  /** pointer → coordinates of the active tree's picture */
  const toLocal = (clientX: number, clientY: number): [number, number] => {
    const r = wrap.current!.getBoundingClientRect();
    const vv = view.value;
    const at = activeTree.value;
    return [(clientX - r.left - vv.x) / vv.zoom - at.x, (clientY - r.top - vv.y) / vv.zoom - at.y];
  };
  const hitByKey = useMemo(() => new Map((sc?.hits ?? []).map((h) => [h.key, h])), [sc]);

  // ---------- pointer handling (pan, pinch, drags)
  const labelGhost = useSignal<null | { box: Box; dx: number; dy: number }>(null);
  const nodeDrag = useSignal<null | { key: string; dx: number; dy: number; over: string | null; sister: boolean; copy: boolean; tree?: string | null; treeKey?: string | null }>(null);
  const marquee = useSignal<Box | null>(null);
  const ctx = useSignal<null | CtxAt>(null);
  const drag = useRef<null | (Drag & { sx: number; sy: number; moved: boolean })>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<null | { d: number; zoom: number; cx: number; cy: number; vx: number; vy: number }>(null);

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('.canvas-tools, .canvas-hint, .ctx-menu')) return;
    ctx.value = null;
    if (e.button === 2) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = wrap.current!.getBoundingClientRect();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.value.zoom, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, vx: view.value.x, vy: view.value.y };
      drag.current = null;
      return;
    }
    const target = e.target as Element;
    const base = { sx: e.clientX, sy: e.clientY, moved: false };
    const head = target.closest('[data-tree-head]');
    if (head) {
      const id = head.getAttribute('data-tree-head')!;
      const en = trees.value.find((x) => x.id === id);
      if (en) drag.current = { ...base, kind: 'tree', id, x: en.x, y: en.y };
      return;
    }
    if (target.closest('[data-sheet-resize]') && scene.value) {
      drag.current = { ...base, kind: 'sheet', w: scene.value.width, h: scene.value.height };
      return;
    }
    const via = target.closest('[data-via]');
    if (via) {
      const [index, point] = via.getAttribute('data-via')!.split('|').map(Number);
      const pts = bendsOf(index);
      if (pts) drag.current = { ...base, kind: 'via', index, point, via: pts };
      return;
    }
    const handle = target.closest('[data-handle]');
    if (handle) {
      const index = Number(handle.getAttribute('data-handle'));
      const a = tree.value?.arrows[index];
      if (a) drag.current = { ...base, kind: 'bend', index, bend: [...a.bend] as [number, number] };
      return;
    }
    const labEl = target.closest('[data-label]');
    if (labEl && editable.value) {
      const [kind, owner, idx] = labEl.getAttribute('data-label')!.split('|');
      const index = Number(idx);
      const own = kind === 'note' ? owner : Number(owner);
      const off =
        kind === 'note'
          ? A.nodeByKey(owner)?.notes?.find((x) => x.index === index)?.off
          : tree.value?.arrows[Number(owner)]?.labels.find((x) => x.index === index)?.off;
      const hitBox = scene.value?.labels.find((l) => l.kind === kind && l.owner === own && l.index === index)?.box;
      if (hitBox) {
        drag.current = { ...base, kind: 'label', label: { kind: kind as 'note', owner: own, index, off: off ?? [0, 0], box: hitBox } };
        return;
      }
    }
    // Shift + drag: a rectangle that selects a branch
    if (e.shiftKey && !target.closest('[data-tree]')) {
      const [x0, y0] = toLocal(e.clientX, e.clientY);
      drag.current = { ...base, kind: 'marquee', x0, y0 };
      return;
    }
    // a node: a click selects it, a drag moves its branch
    const nodeEl = target.closest('[data-node]');
    if (nodeEl && tool.value === 'select' && !pick.value) {
      drag.current = { ...base, kind: 'node', key: nodeEl.getAttribute('data-node')!, target };
      return;
    }
    drag.current = { ...base, kind: 'pan', vx: view.value.x, vy: view.value.y, target };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      const zoom = Math.min(6, Math.max(0.15, (p.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / p.d));
      const k = zoom / p.zoom;
      setView({ zoom, x: p.cx - (p.cx - p.vx) * k, y: p.cy - (p.cy - p.vy) * k });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (!d.moved) return;
    const z = view.value.zoom;
    if (d.kind === 'pan') setView({ ...view.value, x: d.vx + dx, y: d.vy + dy });
    else if (d.kind === 'tree') moveTree(d.id, d.x + dx / z, d.y + dy / z);
    else if (d.kind === 'sheet') setStyle({ sheetWidth: Math.max(40, Math.round(d.w + dx / z)), sheetHeight: Math.max(40, Math.round(d.h + dy / z)) });
    else if (d.kind === 'label') labelGhost.value = { box: d.label.box, dx: dx / z, dy: dy / z };
    else if (d.kind === 'node') {
      // where it would land: a node under the pointer, not inside the dragged branch
      const dragged = A.nodeByKey(d.key);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const el = under?.closest('[data-node]');
      const over = el ? A.nodeByKey(el.getAttribute('data-node')) : null;
      const inside = !!(over && dragged && collectNodes(dragged).includes(over));
      // another tree: one of its nodes, or its empty sheet
      const otherId = !el ? under?.closest('[data-tree]')?.getAttribute('data-tree') ?? null : null;
      let otherKey: string | null = null;
      if (otherId) {
        const o = otherScenes.value.find((x) => x.entry.id === otherId);
        if (o?.scene) {
          const r = wrap.current!.getBoundingClientRect();
          const vv = view.value;
          const lx = (e.clientX - r.left - vv.x) / vv.zoom - o.entry.x;
          const ly = (e.clientY - r.top - vv.y) / vv.zoom - o.entry.y;
          otherKey = o.scene.hits.find((h) => lx >= h.box.x1 && lx <= h.box.x2 && ly >= h.box.y1 && ly <= h.box.y2)?.key ?? null;
        }
      }
      nodeDrag.value = { key: d.key, dx: dx / z, dy: dy / z, over: over && !inside ? over.key : null, sister: e.shiftKey, copy: e.altKey, tree: otherId, treeKey: otherKey };
    } else if (d.kind === 'marquee') {
      const [x, y] = toLocal(e.clientX, e.clientY);
      marquee.value = { x1: Math.min(d.x0, x), y1: Math.min(d.y0, y), x2: Math.max(d.x0, x), y2: Math.max(d.y0, y) };
    }
    else if (d.kind === 'via') bendOverride.value = { index: d.index, via: d.via.map((p, i) => (i === d.point ? [p[0] + dx / z, p[1] + dy / z] : p)) };
    else bendOverride.value = { index: d.index, bend: [d.bend[0] + dx / z, d.bend[1] + dy / z] };
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'sheet') return;
    if (d.kind === 'tree') {
      if (!d.moved) activateTree(d.id);
      appearanceScope.value = 'tree';
      return;
    }
    if (d.kind === 'label') {
      const g = labelGhost.value;
      labelGhost.value = null;
      const l = d.label;
      if (g && d.moved) A.moveLabel(l.kind, l.owner, l.index, [Math.round(l.off[0] + g.dx), Math.round(l.off[1] + g.dy)]);
      // a click on a label: edit or delete it in the inspector
      else if (!d.moved) selection.value = { kind: 'label', label: l.kind, owner: l.owner, index: l.index };
      return;
    }
    if (d.kind === 'node') {
      const nd = nodeDrag.value;
      nodeDrag.value = null;
      if (!d.moved) {
        clickNode(d.key);
        return;
      }
      const n = A.nodeByKey(d.key);
      const over = A.nodeByKey(nd?.over);
      if (n && nd?.tree) A.moveToTree(n, nd.tree, nd.treeKey ?? null, nd.sister ? 'sister' : 'daughter', nd.copy);
      else if (n && over && nd) A.moveNode(n, over, nd.sister ? 'sister' : 'daughter', nd.copy);
      return;
    }
    if (d.kind === 'marquee') {
      const m = marquee.value;
      marquee.value = null;
      if (!d.moved || !m) {
        selection.value = null;
        return;
      }
      selectInRect(m);
      return;
    }
    if (d.kind === 'bend' || d.kind === 'via') {
      const o = bendOverride.value;
      bendOverride.value = null;
      const a = tree.value?.arrows[d.index];
      if (o && a && d.moved) {
        if (o.via) A.setVia(a, o.via);
        else if (o.bend) A.updateArrow(a, { bend: [Math.round(o.bend[0]), Math.round(o.bend[1])] });
      }
      return;
    }
    if (d.moved) return;
    // a click (pointer capture retargets pointerup, so use the pointerdown target)
    const target = d.target ?? (e.target as Element);
    const other = target.closest('[data-tree]');
    if (other) {
      clickOtherTree(other.getAttribute('data-tree')!, e);
      return;
    }
    const nodeEl = target.closest('[data-node]');
    const arrowEl = target.closest('[data-arrow]');
    if (nodeEl) clickNode(nodeEl.getAttribute('data-node')!);
    else if (arrowEl) selection.value = { kind: 'arrow', index: Number(arrowEl.getAttribute('data-arrow')) };
    else {
      selection.value = null;
      relationOf.value = null;
      if (tool.value === 'arrow') arrowSource.value = null;
      // the empty canvas: Appearance sets every tree; the sheet of a tree: that tree
      appearanceScope.value = target.closest('.active-sheet') ? 'tree' : 'canvas';
      sideTab.value = 'appearance';
    }
  };

  /** a click on another tree makes it active; a click on one of its nodes also selects that node */
  const clickOtherTree = (id: string, e: PointerEvent) => {
    const o = otherScenes.value.find((x) => x.entry.id === id);
    const r = wrap.current!.getBoundingClientRect();
    const vv = view.value;
    let key: string | null = null;
    if (o?.scene) {
      const lx = (e.clientX - r.left - vv.x) / vv.zoom - o.entry.x;
      const ly = (e.clientY - r.top - vv.y) / vv.zoom - o.entry.y;
      key = o.scene.hits.find((h) => lx >= h.box.x1 && lx <= h.box.x2 && ly >= h.box.y1 && ly <= h.box.y2)?.key ?? null;
    }
    activateTree(id);
    appearanceScope.value = 'tree';
    if (key) queueMicrotask(() => (selection.value = { kind: 'node', key: key! }));
  };

  /** the bends of an arrow as offsets from the middle of its ends: its own points, or the ones it found itself */
  const bendsOf = (index: number): [number, number][] | null => {
    const a = tree.value?.arrows[index];
    const g = scene.value?.arrows[index]?.geom;
    if (!a || !g) return null;
    if (a.via?.length) return a.via.map((p) => [...p] as [number, number]);
    return g.knots.slice(1, -1).map(([x, y]) => [x - g.mid[0], y - g.mid[1]] as [number, number]);
  };

  /** the smallest branch that has every node touched by the rectangle */
  const selectInRect = (m: Box) => {
    const inside = (scene.value?.hits ?? []).filter((h) => h.box.x2 > m.x1 && h.box.x1 < m.x2 && h.box.y2 > m.y1 && h.box.y1 < m.y2).map((h) => h.node);
    if (!inside.length) {
      selection.value = null;
      return;
    }
    const chain = (n: DNode) => {
      const out: DNode[] = [];
      for (let c: DNode | undefined = n; c; c = c.parents[0]) out.push(c);
      return out;
    };
    const common = inside.slice(1).reduce((acc, n) => {
      const up = new Set(chain(n));
      return acc.filter((x) => up.has(x));
    }, chain(inside[0]));
    const top = common[0];
    if (top) selection.value = { kind: 'node', key: top.key };
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const r = wrap.current!.getBoundingClientRect();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const el = under?.closest('[data-node]');
    const key = el?.getAttribute('data-node') ?? null;
    if (key) selection.value = { kind: 'node', key };
    // a tree: its name, its sheet (another tree), or the sheet of the tree being edited
    const tree = under?.closest('[data-tree-head]')?.getAttribute('data-tree-head') ?? under?.closest('[data-tree]')?.getAttribute('data-tree') ?? (under?.closest('.active-sheet') ? activeId.value : null);
    const vv = view.value;
    ctx.value = { x: e.clientX - r.left, y: e.clientY - r.top, key, tree: key ? null : tree, world: [(e.clientX - r.left - vv.x) / vv.zoom, (e.clientY - r.top - vv.y) / vv.zoom] };
  };

  const clickNode = (key: string) => {
    const n = A.nodeByKey(key);
    if (!n) return;
    appearanceScope.value = 'tree';
    if (pick.value) {
      A.completePick(n);
      return;
    }
    const tl = tool.value;
    if (tl === 'arrow') {
      A.arrowClick(n);
      return;
    }
    if (tl === 'ccommand' || tl === 'dominance') {
      relationOf.value = relationOf.value === key ? null : key;
      selection.value = { kind: 'node', key };
      return;
    }
    selection.value = { kind: 'node', key };
    if (n.src) {
      const s = n.src.kind === 'leaf' ? n.src.span : n.src.labelSpan;
      A.revealInCode(s.from, s.to);
    }
  };

  const onDblClick = (e: MouseEvent) => {
    // pointer capture sends the double-click to the canvas itself: look at what is under the pointer
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    // the corner of the sheet: as large as the tree needs again
    if (target.closest('[data-sheet-resize]')) {
      setStyle({ sheetWidth: 0, sheetHeight: 0 });
      return;
    }
    // a bend point: remove it
    const via = target.closest('[data-via]');
    if (via) {
      const [index, point] = via.getAttribute('data-via')!.split('|').map(Number);
      const a = tree.value?.arrows[index];
      const pts = bendsOf(index);
      if (a && pts) A.setVia(a, pts.filter((_, i) => i !== point));
      return;
    }
    // the selected arrow: add a bend point where it was clicked
    const arrowEl = target.closest('[data-arrow]');
    if (arrowEl) {
      const index = Number(arrowEl.getAttribute('data-arrow'));
      const g = scene.value?.arrows[index]?.geom;
      const a = tree.value?.arrows[index];
      if (!g || !a) return;
      selection.value = { kind: 'arrow', index };
      // offsets from the middle of the ends: the same in the picture's and the layout's coordinates
      A.setVia(a, insertVia(g, toLocal(e.clientX, e.clientY)));
      return;
    }
    const nodeEl = target.closest('[data-node]');
    if (!nodeEl) return;
    const key = nodeEl.getAttribute('data-node')!;
    selection.value = { kind: 'node', key };
    requestLabelFocus(key);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = wrap.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const z0 = view.value.zoom;
      const z = Math.min(6, Math.max(0.15, z0 * Math.exp(-e.deltaY * 0.01)));
      zoomAt(z, e.clientX - r.left, e.clientY - r.top);
    } else {
      setView({ ...view.value, x: view.value.x - e.deltaX, y: view.value.y - e.deltaY });
    }
  };
  useEffect(() => {
    const el = wrap.current!;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomAt = (z: number, cx: number, cy: number) => {
    const z0 = view.value.zoom;
    const k = z / z0;
    setView({ zoom: z, x: cx - (cx - view.value.x) * k, y: cy - (cy - view.value.y) * k });
  };
  const zoomBy = (f: number) => zoomAt(Math.min(6, Math.max(0.15, view.value.zoom * f)), size.value.w / 2, size.value.h / 2);

  // expose zoom helpers to keyboard shortcuts
  useEffect(() => {
    canvasApi.zoomIn = () => zoomBy(1.2);
    canvasApi.zoomOut = () => zoomBy(1 / 1.2);
    canvasApi.fit = () => fit();
  });

  // ---------- render
  const sel = selection.value;
  const selArrow = sel?.kind === 'arrow' && sc ? sc.arrows[sel.index] : undefined;
  const selArrowData = selArrow ? tr?.arrows[selArrow.index] : undefined;
  const rel = relation.value;
  const srcKey = arrowSource.value;
  const primsHtml = useMemo(() => (sc ? sc.prims.map(primToSvg).join('') : ''), [sc]);
  const others = otherScenes.value;

  const box = (h: NodeHit, pad = 3) => ({ x: h.box.x1 - pad, y: h.box.y1 - pad, width: h.box.x2 - h.box.x1 + pad * 2, height: h.box.y2 - h.box.y1 + pad * 2 });

  const handleR = 6 / Math.sqrt(v.zoom);
  // the selected branch (what Ctrl+C copies), the branch being dragged and where it would land
  const selNode = sel?.kind === 'node' ? A.nodeByKey(sel.key) : null;
  const selBranch = selNode && selNode.children.length && !nodeDrag.value ? branchBox(selNode, hitByKey) : null;
  const nd = nodeDrag.value;
  const dragNode = nd ? A.nodeByKey(nd.key) : null;
  const dragBase = dragNode ? branchBox(dragNode, hitByKey) : null;
  const dragBox = dragBase && nd ? { x1: dragBase.x1 + nd.dx, y1: dragBase.y1 + nd.dy, x2: dragBase.x2 + nd.dx, y2: dragBase.y2 + nd.dy } : null;
  const dropHit = nd?.over ? hitByKey.get(nd.over) : undefined;
  // where it would land in another tree: a node there, or its whole sheet when it is empty
  const otherDrop = (() => {
    if (!nd?.tree) return null;
    const o = others.find((x) => x.entry.id === nd.tree);
    if (!o) return null;
    if (!o.scene) return { x1: o.entry.x - 3, y1: o.entry.y - 3, x2: o.entry.x + EMPTY_SHEET.w + 3, y2: o.entry.y + EMPTY_SHEET.h + 3 };
    const h = nd.treeKey ? o.scene.hits.find((x) => x.key === nd.treeKey) : null;
    return h ? { x1: o.entry.x + h.box.x1 - 4, y1: o.entry.y + h.box.y1 - 4, x2: o.entry.x + h.box.x2 + 4, y2: o.entry.y + h.box.y2 + 4 } : null;
  })();
  const hint = nodeDrag.value
    ? nodeDrag.value.tree
      ? otherDrop
        ? `Drop: ${nodeDrag.value.copy ? 'a copy' : 'the branch'} goes into the other tree${nodeDrag.value.treeKey ? (nodeDrag.value.sister ? ', as this node’s sister' : ', below this node') : ''}. Shift: as a sister · Alt: a copy`
        : 'Drop it on a node of that tree (or on an empty tree)'
      : nodeDrag.value.over
      ? `Drop: ${nodeDrag.value.copy ? 'a copy' : 'the branch'} goes ${nodeDrag.value.sister ? 'right after this node (its sister)' : 'below this node (its last daughter)'}. Shift: as a sister · Alt: a copy`
      : 'Drag onto a node: the branch becomes its last daughter (Shift: its sister, Alt: a copy)'
    : pick.value
    ? `Click the constituent to add again as a ${pick.value.kind} (a new position of the same element). Esc to cancel.`
    : tool.value === 'arrow' ? (srcKey ? t('arrowPickTarget') : t('arrowPickSource')) : tool.value === 'ccommand' ? t('ccHint') : tool.value === 'dominance' ? t('domHint') : null;
  const linked = linkedIds.value;

  return (
    <div
      class={`canvas tool-${tool.value}`}
      ref={wrap}
      onPointerDown={onPointerDown as never}
      onPointerMove={onPointerMove as never}
      onPointerUp={onPointerUp as never}
      onPointerCancel={onPointerUp as never}
      onDblClick={onDblClick as never}
      onContextMenu={onContextMenu as never}
      tabIndex={0}
      aria-label="Tree canvas"
      data-testid="canvas"
    >
      <svg class="canvas-svg" width="100%" height="100%">
        <defs>
          <filter id="paper-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="1" stdDeviation="3" flood-opacity="0.12" />
          </filter>
        </defs>
        <g transform={`translate(${v.x} ${v.y}) scale(${v.zoom})`}>
          {others.map(({ entry, scene: osc }) =>
            osc ? <OtherSheet key={entry.id} id={entry.id} x={entry.x} y={entry.y} scene={osc} /> : <EmptySheet key={entry.id} id={entry.id} x={entry.x} y={entry.y} />,
          )}
          {!sc && <EmptySheet id={active.id} x={active.x} y={active.y} active />}
          {otherDrop && <rect class="drop-target" x={otherDrop.x1} y={otherDrop.y1} width={otherDrop.x2 - otherDrop.x1} height={otherDrop.y2 - otherDrop.y1} rx="5" />}
          {sc && (
            <g transform={`translate(${active.x} ${active.y})`} class="sheet active-sheet">
              <rect class={`paper ${many ? 'paper-active' : ''}`} width={sc.width} height={sc.height} fill={sc.background === 'transparent' ? '#ffffff' : sc.background} filter="url(#paper-shadow)" rx="2" />
              <LinkedFrames sc={sc} counts={linkCounts.value} />
              {selBranch && <rect class="branch-sel" x={selBranch.x1} y={selBranch.y1} width={selBranch.x2 - selBranch.x1} height={selBranch.y2 - selBranch.y1} rx="8" />}
              {rel &&
                [...rel.keys].map((k) => {
                  const h = hitByKey.get(k);
                  return h ? <rect key={'r' + k} {...box(h, 2)} rx="4" class={`rel rel-${rel.kind}`} /> : null;
                })}
              {rel && hitByKey.get(rel.of) && <rect {...box(hitByKey.get(rel.of)!, 3)} rx="4" class="rel-origin" />}
              {hover.value && hitByKey.get(hover.value) && tool.value !== 'select' && <rect {...box(hitByKey.get(hover.value)!, 3)} rx="4" class="hover-box" />}
              {srcKey && hitByKey.get(srcKey) && <rect {...box(hitByKey.get(srcKey)!, 4)} rx="5" class="arrow-source" />}
              <g class="prims" dangerouslySetInnerHTML={{ __html: primsHtml }} />
              {sc.arrows.map((a) => (
                <path key={'ah' + a.index} d={a.d} class={`arrow-hit ${selArrow?.index === a.index ? 'selected' : ''}`} data-arrow={a.index}>
                  <title>Click to select · double-click to add a bend point</title>
                </path>
              ))}
              {sc.hits.map((h) => (
                <rect
                  key={'h' + h.key}
                  {...box(h)}
                  rx="4"
                  class={`node-hit ${sel?.kind === 'node' && sel.key === h.key ? 'selected' : ''} ${h.node.synthetic ? 'synthetic' : ''}`}
                  data-node={h.key}
                  onPointerEnter={() => (hover.value = h.key)}
                  onPointerLeave={() => hover.value === h.key && (hover.value = null)}
                >
                  <title>{plain(h.node.label)}</title>
                </rect>
              ))}
              {sc.labels.map((l) => (
                <rect
                  key={`lab${l.kind}${l.owner}${l.index}`}
                  x={l.box.x1}
                  y={l.box.y1}
                  width={l.box.x2 - l.box.x1}
                  height={l.box.y2 - l.box.y1}
                  rx="3"
                  class={`label-hit ${sel?.kind === 'label' && sel.label === l.kind && sel.owner === l.owner && sel.index === l.index ? 'selected' : ''}`}
                  data-label={`${l.kind}|${l.owner}|${l.index}`}
                >
                  <title>Click to edit or delete, drag to move</title>
                </rect>
              ))}
              {dragBox && <rect class="branch-ghost" x={dragBox.x1} y={dragBox.y1} width={dragBox.x2 - dragBox.x1} height={dragBox.y2 - dragBox.y1} rx="8" />}
              {dropHit && <rect {...box(dropHit, 4)} rx="5" class="drop-target" />}
              {marquee.value && <rect class="marquee" x={marquee.value.x1} y={marquee.value.y1} width={marquee.value.x2 - marquee.value.x1} height={marquee.value.y2 - marquee.value.y1} />}
              {labelGhost.value && (
                <rect x={labelGhost.value.box.x1 + labelGhost.value.dx} y={labelGhost.value.box.y1 + labelGhost.value.dy} width={labelGhost.value.box.x2 - labelGhost.value.box.x1} height={labelGhost.value.box.y2 - labelGhost.value.box.y1} rx="3" class="label-ghost" />
              )}
              <rect class="sheet-resize" data-sheet-resize="1" x={sc.width - 9 / v.zoom} y={sc.height - 9 / v.zoom} width={14 / v.zoom} height={14 / v.zoom} rx={2 / v.zoom}>
                <title>Drag to change the size of the sheet · double-click: as large as the tree needs</title>
              </rect>
              {selArrow &&
                selArrowData &&
                (selArrowData.via?.length ? viaPoints(selArrow.geom) : selArrow.geom.knots.slice(1, -1)).map(([x, y], i) => (
                  <circle key={'via' + i} cx={x} cy={y} r={handleR} class={`bend-handle ${selArrowData.via?.length ? 'via' : ''}`} data-via={`${selArrow.index}|${i}`}>
                    <title>A bend: drag to move it, double-click to remove it · double-click the arrow to add one</title>
                  </circle>
                ))}
            </g>
          )}
        </g>
      </svg>

      {many &&
        trees.value.map((en) => {
          const p = toScreen(en.x, en.y);
          return (
            <div key={en.id} class={`sheet-head ${en.id === activeId.value ? 'on' : ''}`} style={{ left: `${p.x}px`, top: `${p.y - 26}px` }} data-tree-head={en.id} title="Drag to move the tree · click to edit it">
              {en.name}
              {linked.has(en.id) && <span class="link-mark" title="Linked copy: shares its code with another tree"><ILink size={11} /></span>}
            </div>
          );
        })}

      <div class="canvas-tools" role="toolbar">
        <ToolBtn id="select" icon={<IPointer />} label={t('toolSelect')} />
        <ToolBtn id="arrow" icon={<IArrowTool />} label={t('toolArrow')} />
        <ToolBtn id="ccommand" icon={<ICcommand />} label={t('toolCcommand')} />
        <ToolBtn id="dominance" icon={<IDominance />} label={t('toolDominance')} />
        <span class="sep" />
        <button class="icon-btn" title={t('zoomOut')} aria-label={t('zoomOut')} onClick={() => zoomBy(1 / 1.2)}>
          <IMinus />
        </button>
        <button class="zoom-label" title={t('fit')} onClick={() => fit()}>
          {Math.round(v.zoom * 100)}%
        </button>
        <button class="icon-btn" title={t('zoomIn')} aria-label={t('zoomIn')} onClick={() => zoomBy(1.2)}>
          <IPlus />
        </button>
        <button class="icon-btn" title={t('fit')} aria-label={t('fit')} onClick={() => fit()}>
          <IFit />
        </button>
        <span class="sep" />
        <button
          class="icon-btn danger"
          title="Clear the canvas: all trees go"
          aria-label="Clear the canvas"
          data-testid="clear-canvas"
          onClick={() => confirm('Clear the canvas? All its trees go (save them to disk or in My trees first if you need them).') && clearCanvas()}
        >
          <ITrash />
        </button>
      </div>

      {hint && <div class="canvas-hint">{hint}</div>}

      {ctx.value && <ContextMenu at={ctx.value} close={() => (ctx.value = null)} />}
    </div>
  );
}

/** a tree that is not being edited: drawn as it is, a click makes it the active one */
function OtherSheet({ id, x, y, scene: sc }: { id: string; x: number; y: number; scene: Scene }) {
  const html = useMemo(() => sc.prims.map(primToSvg).join(''), [sc]);
  return (
    <g transform={`translate(${x} ${y})`} class="sheet other-sheet" data-tree={id}>
      <rect class="paper" width={sc.width} height={sc.height} fill={sc.background === 'transparent' ? '#ffffff' : sc.background} filter="url(#paper-shadow)" rx="2" />
      <LinkedFrames sc={sc} counts={linkCounts.value} />
      <g class="prims" dangerouslySetInnerHTML={{ __html: html }} />
      <title>Click to edit this tree</title>
    </g>
  );
}

/** a tree without nodes: its sheet stays, ready for a node or a branch dropped on it */
function EmptySheet({ id, x, y, active }: { id: string; x: number; y: number; active?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`} class={`sheet empty-sheet ${active ? 'active-sheet' : 'other-sheet'}`} data-tree={active ? undefined : id} data-empty-tree={id}>
      <rect class={`paper ${active && trees.value.length > 1 ? 'paper-active' : ''}`} width={EMPTY_SHEET.w} height={EMPTY_SHEET.h} fill="#ffffff" filter="url(#paper-shadow)" rx="2" />
      <text x={EMPTY_SHEET.w / 2} y={EMPTY_SHEET.h / 2 - 6} class="empty-hint">
        An empty tree
      </text>
      <text x={EMPTY_SHEET.w / 2} y={EMPTY_SHEET.h / 2 + 12} class="empty-hint small">
        right-click: add a node · or drop a branch here
      </text>
    </g>
  );
}

/** union of the sheets of all trees, in canvas coordinates */
function allSheets(): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const at = activeTree.value;
  const sc = scene.value;
  out.push({ x: at.x, y: at.y, w: sc?.width ?? EMPTY_SHEET.w, h: sc?.height ?? EMPTY_SHEET.h });
  for (const o of otherScenes.value) out.push({ x: o.entry.x, y: o.entry.y, w: o.scene?.width ?? EMPTY_SHEET.w, h: o.scene?.height ?? EMPTY_SHEET.h });
  return out;
}

/** The menu of a right click: copy, paste, link and move branches. */
interface CtxAt {
  x: number;
  y: number;
  key: string | null;
  tree: string | null;
  /** canvas coordinates of the click */
  world: [number, number];
}

function ContextMenu({ at, close }: { at: CtxAt; close: () => void }) {
  const n = at.key ? A.nodeByKey(at.key) : null;
  // the whole menu stays inside the canvas: moved left / up where it would run out
  const box = useRef<HTMLDivElement>(null);
  const pos = useSignal({ x: at.x, y: at.y });
  useLayoutEffect(() => {
    const el = box.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const W = host.clientWidth;
    const H = host.clientHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = at.x + w + 8 > W ? Math.max(8, Math.min(at.x - w, W - w - 8)) : at.x;
    const y = at.y + h + 8 > H ? Math.max(8, Math.min(at.y - h, H - h - 8)) : at.y;
    if (x !== pos.value.x || y !== pos.value.y) pos.value = { x, y };
  }, [at.x, at.y]);
  const linked = A.linkedBranchOf(n);
  const run = (f: () => void) => () => {
    close();
    f();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const c = A.clip.value;
  return (
    <div ref={box} class="ctx-menu menu-pop" role="menu" style={{ left: `${pos.value.x}px`, top: `${pos.value.y}px` }} onContextMenu={(e) => e.preventDefault()}>
      {n && (
        <>
          <button role="menuitem" onClick={run(() => A.copyNode(n))}>
            <strong>Copy branch</strong>
            <small>Ctrl+C · a copy of its own</small>
          </button>
          <button role="menuitem" onClick={run(() => A.copyNode(n, true))}>
            <strong>Copy as a linked branch</strong>
            <small>Pasted, it stays linked: what changes inside one copy changes in all</small>
          </button>
          <button role="menuitem" onClick={run(() => A.cutNode(n))}>
            <strong>Cut</strong>
            <small>Ctrl+X</small>
          </button>
          {c && (
            <>
              <button role="menuitem" onClick={run(() => A.paste(c, n, 'daughter'))}>
                <strong>Paste as daughter</strong>
                <small>Ctrl+V</small>
              </button>
              {n.parents.length > 0 && (
                <button role="menuitem" onClick={run(() => A.paste(c, n, 'sister'))}>
                  <strong>Paste as sister</strong>
                  <small>Ctrl+Shift+V</small>
                </button>
              )}
            </>
          )}
          <button role="menuitem" onClick={run(() => A.duplicateNode(n))}>
            <strong>Duplicate</strong>
            <small>Ctrl+D</small>
          </button>
          {linked && linked.root === n && (
            <button role="menuitem" onClick={run(() => A.unlinkBranch(n))}>
              <strong>Unlink this branch</strong>
              <small>It becomes a branch of its own</small>
            </button>
          )}
          <button role="menuitem" class="danger" onClick={run(() => A.deleteNode(n))}>
            <strong>Delete</strong>
          </button>
        </>
      )}
      {!n && at.tree && <TreeItems id={at.tree} run={run} />}
      {!n && (
        <>
          {c && (
            <button role="menuitem" onClick={run(() => A.paste(c, null, 'daughter', { x: at.world[0], y: at.world[1] }))}>
              <strong>Paste as a new tree here</strong>
              <small>Ctrl+V with nothing selected</small>
            </button>
          )}
          <button role="menuitem" onClick={run(() => addTree(undefined, { x: at.world[0], y: at.world[1] }))}>
            <strong>New tree here</strong>
          </button>
          {!at.tree && (
            <button role="menuitem" class="danger" onClick={run(() => confirm('Clear the canvas? All its trees go (they stay in My trees if saved there).') && clearCanvas())}>
              <strong>Clear the canvas</strong>
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** a tree without any node */
function isEmptyTree(id: string): boolean {
  return id === activeId.value ? !scene.value : !otherScenes.value.find((o) => o.entry.id === id)?.scene;
}

/** What can be done with a whole tree (right click on its sheet or its name). */
function TreeItems({ id, run }: { id: string; run: (f: () => void) => () => void }) {
  const e = trees.value.find((x) => x.id === id);
  if (!e) return null;
  return (
    <>
      <p class="ctx-title">{e.name}</p>
      {isEmptyTree(id) && (
        <button role="menuitem" onClick={run(() => A.addRootNode(id))}>
          <strong>Add a node</strong>
          <small>The first node of this tree</small>
        </button>
      )}
      {isEmptyTree(id) && A.clip.value && (
        <button role="menuitem" onClick={run(() => A.pasteIntoTree(id))}>
          <strong>Paste here</strong>
          <small>The copied branch becomes this tree</small>
        </button>
      )}
      {id !== activeId.value && (
        <button role="menuitem" onClick={run(() => activateTree(id))}>
          <strong>Edit this tree</strong>
        </button>
      )}
      <button role="menuitem" onClick={run(() => duplicateTree(id, false))}>
        <strong>Copy the tree</strong>
        <small>An independent copy next to it</small>
      </button>
      <button role="menuitem" onClick={run(() => A.duplicateTreeLinked(id))}>
        <strong>Linked copy of the tree</strong>
        <small>The whole tree as a linked branch</small>
      </button>
      <button
        role="menuitem"
        onClick={run(() => {
          const name = prompt('Name of the tree', e.name);
          if (name) renameTree(id, name);
        })}
      >
        <strong>Rename…</strong>
      </button>
      <button
        role="menuitem"
        onClick={run(() => {
          activateTree(id);
          modal.value = 'export';
        })}
      >
        <strong>Export this tree…</strong>
      </button>
      {trees.value.length > 1 && (
        <button role="menuitem" class="danger" onClick={run(() => confirm(`Delete “${e.name}” from the canvas?`) && removeTree(id))}>
          <strong>Delete from the canvas</strong>
        </button>
      )}
      <hr class="ctx-sep" />
    </>
  );
}

export const canvasApi: { zoomIn?: () => void; zoomOut?: () => void; fit?: () => void } = {};

function ToolBtn({ id, icon, label }: { id: Tool; icon: preact.JSX.Element; label: string }) {
  return (
    <button
      class={`icon-btn ${tool.value === id ? 'active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={tool.value === id}
      onClick={() => {
        tool.value = id;
        arrowSource.value = null;
        if (id === 'ccommand' || id === 'dominance') {
          const s = selection.value;
          relationOf.value = s?.kind === 'node' ? s.key : null;
        } else relationOf.value = null;
      }}
    >
      {icon}
    </button>
  );
}
