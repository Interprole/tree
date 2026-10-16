import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import * as A from '../actions';
import { cCommandDomain, dominated } from '../core/analysis';
import { plain } from '../core/richtext';
import { insertVia, viaPoints } from '../core/arrows';
import type { NodeHit, Scene } from '../core/scene';
import { primToSvg } from '../render/svg';
import { t } from '../i18n';
import {
  activateTree, activeId, activeTree, arrowSource, bendOverride, editable, fitRequest, fontEpoch, linkedIds, moveTree, otherScenes, pick, relationOf, requestLabelFocus, scene, selection, tool, tree, trees,
} from '../state';
import type { Tool } from '../state';
import { IArrowTool, ICcommand, IDominance, IFit, ILink, IMinus, IPlus, IPointer } from './icons';

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
  | { kind: 'tree'; id: string; x: number; y: number };

export function Canvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const view = useSignal<View>({ zoom: 1, x: 0, y: 0 });
  const size = useSignal({ w: 800, h: 600 });
  const hover = useSignal<string | null>(null);

  // ---------- fit: all trees of the canvas
  const fit = () => {
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

  useSignalEffect(() => {
    void fitRequest.value;
    void fontEpoch.value;
    // after the new scene is computed
    requestAnimationFrame(() => fit());
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
  const drag = useRef<null | (Drag & { sx: number; sy: number; moved: boolean })>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<null | { d: number; zoom: number; cx: number; cy: number; vx: number; vy: number }>(null);

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('.canvas-tools, .canvas-hint')) return;
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
    const via = target.closest('[data-via]');
    if (via) {
      const [index, point] = via.getAttribute('data-via')!.split('|').map(Number);
      const a = tree.value?.arrows[index];
      if (a?.via) drag.current = { ...base, kind: 'via', index, point, via: a.via.map((p) => [...p] as [number, number]) };
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
    drag.current = { ...base, kind: 'pan', vx: view.value.x, vy: view.value.y, target };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      const zoom = Math.min(6, Math.max(0.15, (p.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / p.d));
      const k = zoom / p.zoom;
      view.value = { zoom, x: p.cx - (p.cx - p.vx) * k, y: p.cy - (p.cy - p.vy) * k };
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (!d.moved) return;
    const z = view.value.zoom;
    if (d.kind === 'pan') view.value = { ...view.value, x: d.vx + dx, y: d.vy + dy };
    else if (d.kind === 'tree') moveTree(d.id, d.x + dx / z, d.y + dy / z);
    else if (d.kind === 'label') labelGhost.value = { box: d.label.box, dx: dx / z, dy: dy / z };
    else if (d.kind === 'via') bendOverride.value = { index: d.index, via: d.via.map((p, i) => (i === d.point ? [p[0] + dx / z, p[1] + dy / z] : p)) };
    else bendOverride.value = { index: d.index, bend: [d.bend[0] + dx / z, d.bend[1] + dy / z] };
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'tree') {
      if (!d.moved) activateTree(d.id);
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
    if (key) queueMicrotask(() => (selection.value = { kind: 'node', key: key! }));
  };

  const clickNode = (key: string) => {
    const n = A.nodeByKey(key);
    if (!n) return;
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
    // a bend point: remove it
    const via = target.closest('[data-via]');
    if (via) {
      const [index, point] = via.getAttribute('data-via')!.split('|').map(Number);
      const a = tree.value?.arrows[index];
      if (a?.via) A.setVia(a, a.via.filter((_, i) => i !== point));
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
      view.value = { ...view.value, x: view.value.x - e.deltaX, y: view.value.y - e.deltaY };
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
    view.value = { zoom: z, x: cx - (cx - view.value.x) * k, y: cy - (cy - view.value.y) * k };
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

  const hint = pick.value
    ? `Click the constituent to add again as a ${pick.value.kind} (a new position of the same element). Esc to cancel.`
    : tool.value === 'arrow' ? (srcKey ? t('arrowPickTarget') : t('arrowPickSource')) : tool.value === 'ccommand' ? t('ccHint') : tool.value === 'dominance' ? t('domHint') : null;

  const handleR = 6 / Math.sqrt(v.zoom);
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
            osc ? <OtherSheet key={entry.id} id={entry.id} x={entry.x} y={entry.y} scene={osc} /> : null,
          )}
          {sc && (
            <g transform={`translate(${active.x} ${active.y})`} class="sheet active-sheet">
              <rect class={`paper ${many ? 'paper-active' : ''}`} width={sc.width} height={sc.height} fill={sc.background === 'transparent' ? '#ffffff' : sc.background} filter="url(#paper-shadow)" rx="2" />
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
              {labelGhost.value && (
                <rect x={labelGhost.value.box.x1 + labelGhost.value.dx} y={labelGhost.value.box.y1 + labelGhost.value.dy} width={labelGhost.value.box.x2 - labelGhost.value.box.x1} height={labelGhost.value.box.y2 - labelGhost.value.box.y1} rx="3" class="label-ghost" />
              )}
              {selArrow && selArrowData && !selArrowData.via?.length && (
                <circle cx={selArrow.geom.handle[0]} cy={selArrow.geom.handle[1]} r={handleR} class="bend-handle" data-handle={selArrow.index}>
                  <title>Drag to bend · double-click the arrow to add bend points</title>
                </circle>
              )}
              {selArrow &&
                selArrowData?.via?.length &&
                viaPoints(selArrow.geom).map(([x, y], i) => (
                  <circle key={'via' + i} cx={x} cy={y} r={handleR} class="bend-handle via" data-via={`${selArrow.index}|${i}`}>
                    <title>Drag to move · double-click to remove</title>
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
      </div>

      {hint && <div class="canvas-hint">{hint}</div>}
    </div>
  );
}

/** a tree that is not being edited: drawn as it is, a click makes it the active one */
function OtherSheet({ id, x, y, scene: sc }: { id: string; x: number; y: number; scene: Scene }) {
  const html = useMemo(() => sc.prims.map(primToSvg).join(''), [sc]);
  return (
    <g transform={`translate(${x} ${y})`} class="sheet other-sheet" data-tree={id}>
      <rect class="paper" width={sc.width} height={sc.height} fill={sc.background === 'transparent' ? '#ffffff' : sc.background} filter="url(#paper-shadow)" rx="2" />
      <g class="prims" dangerouslySetInnerHTML={{ __html: html }} />
      <title>Click to edit this tree</title>
    </g>
  );
}

/** union of the sheets of all trees, in canvas coordinates */
function allSheets(): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const at = activeTree.value;
  const sc = scene.value;
  if (sc) out.push({ x: at.x, y: at.y, w: sc.width, h: sc.height });
  for (const o of otherScenes.value) if (o.scene) out.push({ x: o.entry.x, y: o.entry.y, w: o.scene.width, h: o.scene.height });
  return out;
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
