import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import * as A from '../actions';
import { cCommandDomain, checkBinding, dominated } from '../core/analysis';
import type { BindingResult } from '../core/analysis';
import type { DNode } from '../core/model';
import { plain } from '../core/richtext';
import type { NodeHit, Scene } from '../core/scene';
import { primToSvg } from '../render/svg';
import { t } from '../i18n';
import {
  arrowSource, bendOverride, bindingCheck, build, editable, fitRequest, relationOf, scene, selection, showToast, tool, tree,
} from '../state';
import type { Tool } from '../state';
import {
  IArrowTool, ICcommand, IChild, IDominance, IEdit, IFit, IMinus, IMove, IPalette, IPlus, IPointer, ISister, IStar, ITrash, ITriangle,
} from './icons';

const PALETTE = ['#b91c1c', '#c2410c', '#a16207', '#15803d', '#0f766e', '#1d4ed8', '#6d28d9', '#be185d', '#57534e'];

interface View {
  zoom: number;
  x: number;
  y: number;
}

function bindingText(r: BindingResult): string {
  const yieldOf = (n: DNode): string => (n.kind === 'leaf' ? plain(n.label) : n.children.map(yieldOf).join(' '));
  const name = (n: DNode | undefined) => (n ? `“${yieldOf(n).trim() || plain(n.label)}”` : '');
  const dom = (n: DNode | undefined) => (n ? plain(n.label) : '');
  const key = `binding${r.principle}_${r.ok ? 'ok' : 'bad'}` as Parameters<typeof t>[0];
  return t(key, { x: name(r.node), y: name(r.binder), d: dom(r.domain) });
}

export function Canvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const view = useSignal<View>({ zoom: 1, x: 0, y: 0 });
  const size = useSignal({ w: 800, h: 600 });
  const renaming = useSignal<{ key: string; value: string } | null>(null);
  const colorOpen = useSignal(false);
  const hover = useSignal<string | null>(null);

  // ---------- fit
  const fit = (sc: Scene | null = scene.value) => {
    if (!sc) return;
    const { w, h } = size.value;
    const margin = w < 600 ? 16 : 40;
    const bottom = 64; // floating toolbar
    const z = Math.min(1.5, (w - margin * 2) / sc.width, (h - margin - bottom) / sc.height);
    const zoom = Math.max(0.2, z);
    view.value = { zoom, x: (w - sc.width * zoom) / 2, y: Math.max(margin, (h - bottom + margin - sc.height * zoom) / 2) };
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
    // after the new scene is computed
    requestAnimationFrame(() => fit());
  });

  const sc = scene.value;
  const tr = tree.value;

  // ---------- relations & binding
  const relation = useComputed(() => {
    const key = relationOf.value;
    const tl = tool.value;
    if (!key || (tl !== 'ccommand' && tl !== 'dominance')) return null;
    const n = tree.value?.nodes.find((x) => x.key === key);
    if (!n) return null;
    const set = tl === 'ccommand' ? cCommandDomain(n) : dominated(n);
    return { kind: tl, of: key, keys: new Set([...set].map((x) => x.key)) };
  });
  const binding = useComputed(() => (bindingCheck.value && tree.value ? checkBinding(tree.value) : null));

  // ---------- coordinates
  const v = view.value;
  const toScreen = (x: number, y: number) => ({ x: x * v.zoom + v.x, y: y * v.zoom + v.y });
  const hitByKey = useMemo(() => new Map((sc?.hits ?? []).map((h) => [h.key, h])), [sc]);

  // ---------- pointer handling (pan, pinch, bend drag)
  const drag = useRef<null | { kind: 'pan' | 'bend'; sx: number; sy: number; vx: number; vy: number; moved: boolean; index?: number; bend?: [number, number]; target?: Element }>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<null | { d: number; zoom: number; cx: number; cy: number; vx: number; vy: number }>(null);

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('.floating, .canvas-tools, .rename-box, .binding-panel, .canvas-hint')) return;
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
    const handle = target.closest('[data-handle]');
    if (handle) {
      const index = Number(handle.getAttribute('data-handle'));
      const a = tree.value?.arrows[index];
      if (!a) return;
      drag.current = { kind: 'bend', sx: e.clientX, sy: e.clientY, vx: 0, vy: 0, moved: false, index, bend: [...a.bend] as [number, number] };
      return;
    }
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.value.x, vy: view.value.y, moved: false, target };
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
    if (d.kind === 'pan') view.value = { ...view.value, x: d.vx + dx, y: d.vy + dy };
    else bendOverride.value = { index: d.index!, bend: [d.bend![0] + dx / view.value.zoom, d.bend![1] + dy / view.value.zoom] };
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'bend') {
      const o = bendOverride.value;
      if (o && d.moved) {
        const a = tree.value?.arrows[o.index];
        if (a) A.updateArrow(a, { bend: [Math.round(o.bend[0]), Math.round(o.bend[1])] });
      }
      bendOverride.value = null;
      return;
    }
    if (d.moved) return;
    // a click (pointer capture retargets pointerup, so use the pointerdown target)
    const target = d.target ?? (e.target as Element);
    const nodeEl = target.closest('[data-node]');
    const arrowEl = target.closest('[data-arrow]');
    colorOpen.value = false;
    if (nodeEl) clickNode(nodeEl.getAttribute('data-node')!);
    else if (arrowEl) {
      selection.value = { kind: 'arrow', index: Number(arrowEl.getAttribute('data-arrow')) };
    } else {
      selection.value = null;
      relationOf.value = null;
      if (tool.value === 'arrow') arrowSource.value = null;
    }
  };

  const clickNode = (key: string) => {
    const n = A.nodeByKey(key);
    if (!n) return;
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
    const nodeEl = (e.target as Element).closest('[data-node]');
    if (!nodeEl) return;
    startRename(nodeEl.getAttribute('data-node')!);
  };

  const startRename = (key: string) => {
    const n = A.nodeByKey(key);
    if (!n) return;
    if (!n.src) {
      showToast(t('syntheticNode'));
      return;
    }
    if (!editable.value) {
      showToast(t('editDisabled'));
      return;
    }
    selection.value = { kind: 'node', key };
    renaming.value = { key, value: n.src.kind === 'leaf' ? n.src.text : n.src.label.replace(/~/g, ' ') };
  };

  // a freshly inserted node opens the rename box
  useSignalEffect(() => {
    const k = A.pendingRename.value;
    if (k) {
      A.pendingRename.value = null;
      requestAnimationFrame(() => startRename(k));
    }
  });

  const commitRename = () => {
    const r = renaming.value;
    renaming.value = null;
    if (!r) return;
    const n = A.nodeByKey(r.key);
    if (!n || !n.src) return;
    const old = n.src.kind === 'leaf' ? n.src.text : n.src.label.replace(/~/g, ' ');
    if (r.value === old) return;
    A.applyEdit(
      n.src.kind === 'leaf'
        ? { changes: [{ from: n.src.span.from, to: n.src.span.to, insert: r.value.trim() || '∅' }] }
        : { changes: [{ from: n.src.labelSpan.from, to: n.src.labelSpan.to, insert: r.value.trim().replace(/\s+/g, '~') + (n.src.headerSpan.from === n.src.headerSpan.to && r.value.trim() ? ' ' : '') }] },
    );
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
    canvasApi.rename = () => {
      const s = selection.value;
      if (s?.kind === 'node') startRename(s.key);
    };
  });

  // ---------- render
  const sel = selection.value;
  const selHit = sel?.kind === 'node' ? hitByKey.get(sel.key) : undefined;
  const selArrow = sel?.kind === 'arrow' && sc ? sc.arrows[sel.index] : undefined;
  const rel = relation.value;
  const srcKey = arrowSource.value;

  const primsHtml = useMemo(() => (sc ? sc.prims.map(primToSvg).join('') : ''), [sc]);

  const box = (h: NodeHit, pad = 3) => ({ x: h.box.x1 - pad, y: h.box.y1 - pad, width: h.box.x2 - h.box.x1 + pad * 2, height: h.box.y2 - h.box.y1 + pad * 2 });

  const hint =
    tool.value === 'arrow' ? (srcKey ? t('arrowPickTarget') : t('arrowPickSource')) : tool.value === 'ccommand' ? t('ccHint') : tool.value === 'dominance' ? t('domHint') : null;

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
        {sc && (
          <g transform={`translate(${v.x} ${v.y}) scale(${v.zoom})`}>
            <rect class="paper" width={sc.width} height={sc.height} fill={sc.background === 'transparent' ? '#ffffff' : sc.background} filter="url(#paper-shadow)" rx="2" />
            {rel &&
              [...rel.keys].map((k) => {
                const h = hitByKey.get(k);
                return h ? <rect key={'r' + k} {...box(h, 2)} rx="4" class={`rel rel-${rel.kind}`} /> : null;
              })}
            {rel && hitByKey.get(rel.of) && <rect {...box(hitByKey.get(rel.of)!, 3)} rx="4" class="rel-origin" />}
            {hover.value && hitByKey.get(hover.value) && tool.value !== 'select' && (
              <rect {...box(hitByKey.get(hover.value)!, 3)} rx="4" class="hover-box" />
            )}
            {srcKey && hitByKey.get(srcKey) && <rect {...box(hitByKey.get(srcKey)!, 4)} rx="5" class="arrow-source" />}
            <g class="prims" dangerouslySetInnerHTML={{ __html: primsHtml }} />
            {sc.arrows.map((a) => (
              <path key={'ah' + a.index} d={a.d} class={`arrow-hit ${selArrow?.index === a.index ? 'selected' : ''}`} data-arrow={a.index} />
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
            {selArrow && (
              <circle cx={selArrow.geom.handle[0]} cy={selArrow.geom.handle[1]} r={6 / Math.sqrt(v.zoom)} class="bend-handle" data-handle={selArrow.index} />
            )}
            {binding.value?.map((r, i) => {
              const h = hitByKey.get(r.node.key);
              if (!h) return null;
              return (
                <g key={'b' + i} class={`badge ${r.ok ? 'ok' : 'bad'}`} transform={`translate(${h.box.x2 + 2} ${h.box.y1 - 4})`}>
                  <rect width="30" height="15" rx="7.5" />
                  <text x="15" y="11" text-anchor="middle">{r.principle} {r.ok ? '✓' : '✗'}</text>
                  <title>{bindingText(r)}</title>
                </g>
              );
            })}
          </g>
        )}
      </svg>

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

      {selHit && tool.value === 'select' && !renaming.value && tr && (
        <NodeBar hit={selHit} pos={toScreen((selHit.box.x1 + selHit.box.x2) / 2, selHit.box.y1)} colorOpen={colorOpen.value} toggleColor={() => (colorOpen.value = !colorOpen.value)} onRename={() => startRename(selHit.key)} bps={build.value.mode === 'bps'} />
      )}
      {selArrow && tr?.arrows[selArrow.index] && <ArrowBar index={selArrow.index} pos={toScreen(selArrow.geom.handle[0], selArrow.geom.handle[1])} />}

      {renaming.value && hitByKey.get(renaming.value.key) && (() => {
        const h = hitByKey.get(renaming.value!.key)!;
        const p = toScreen((h.box.x1 + h.box.x2) / 2, h.box.y1);
        return (
          <input
            class="rename-box"
            style={{ left: `${p.x}px`, top: `${p.y - 4}px`, fontSize: `${Math.max(13, (sc?.style.fontSize ?? 16) * v.zoom * 0.9)}px` }}
            value={renaming.value!.value}
            ref={(el) => {
              if (el && document.activeElement !== el) {
                el.focus();
                el.select();
              }
            }}
            onInput={(e) => (renaming.value = { ...renaming.value!, value: (e.target as HTMLInputElement).value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') renaming.value = null;
            }}
            onBlur={commitRename}
            aria-label={t('rename')}
          />
        );
      })()}

      {binding.value && (
        <div class="binding-panel">
          <strong>{t('bindingTitle')}</strong>
          {binding.value.length === 0 ? <p>{t('bindingNone')}</p> : (
            <ul>
              {binding.value.map((r, i) => (
                <li key={i} class={r.ok ? 'ok' : 'bad'}>
                  <span class="pill">{r.principle} {r.ok ? '✓' : '✗'}</span> {bindingText(r)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export const canvasApi: { zoomIn?: () => void; zoomOut?: () => void; fit?: () => void; rename?: () => void } = {};

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

function NodeBar({ hit, pos, colorOpen, toggleColor, onRename, bps }: { hit: NodeHit; pos: { x: number; y: number }; colorOpen: boolean; toggleColor: () => void; onRename: () => void; bps: boolean }) {
  const n = hit.node;
  const branch = useSignal(false);
  const disabled = !n.src;
  return (
    <div class="floating node-bar" style={{ left: `${pos.x}px`, top: `${pos.y}px` }} onPointerDown={(e) => e.stopPropagation()}>
      <button class="icon-btn" title={t('rename')} aria-label={t('rename')} disabled={disabled} onClick={onRename}>
        <IEdit />
      </button>
      <button class="icon-btn" title={t('addChild')} aria-label={t('addChild')} disabled={disabled} onClick={() => A.addChild(n)}>
        <IChild />
      </button>
      <button class="icon-btn" title={t('addSister')} aria-label={t('addSister')} disabled={disabled} onClick={() => A.addSister(n)}>
        <ISister />
      </button>
      <button class="icon-btn" title={t('triangle')} aria-label={t('triangle')} disabled={disabled} onClick={() => A.toggleTriangle(n)}>
        <ITriangle />
      </button>
      <button class={`icon-btn ${colorOpen ? 'active' : ''}`} title={t('color')} aria-label={t('color')} disabled={disabled} onClick={toggleColor}>
        <IPalette />
      </button>
      {bps && n.kind === 'phrase' && (
        <button class={`icon-btn ${n.head ? 'active' : ''}`} title={t('head')} aria-label={t('head')} disabled={disabled} onClick={() => A.toggleHead(n)}>
          <IStar />
        </button>
      )}
      <button class="icon-btn" title={t('arrowFrom')} aria-label={t('arrowFrom')} onClick={() => A.startArrow(n)}>
        <IMove />
      </button>
      <button class="icon-btn danger" title={t('delete')} aria-label={t('delete')} disabled={disabled} onClick={() => A.deleteNode(n)}>
        <ITrash />
      </button>
      {colorOpen && (
        <div class="color-pop">
          <div class="seg small">
            <button class={!branch.value ? 'on' : ''} onClick={() => (branch.value = false)}>{t('colorNode')}</button>
            <button class={branch.value ? 'on' : ''} onClick={() => (branch.value = true)}>{t('colorBranch')}</button>
          </div>
          <div class="swatches">
            {PALETTE.map((c) => (
              <button key={c} class="swatch" style={{ background: c }} title={c} aria-label={c} onClick={() => A.setColor(n, c, branch.value)} />
            ))}
            <button class="swatch none" title={t('colorNone')} aria-label={t('colorNone')} onClick={() => A.setColor(n, null, false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function ArrowBar({ index, pos }: { index: number; pos: { x: number; y: number } }) {
  const a = tree.value!.arrows[index];
  const label = useSignal(a.label ?? '');
  useEffect(() => {
    label.value = a.label ?? '';
  }, [a.label, index]);
  const up = (p: Parameters<typeof A.updateArrow>[1]) => A.updateArrow(a, p);
  return (
    <div class="floating arrow-bar" style={{ left: `${pos.x}px`, top: `${pos.y + 14}px` }} onPointerDown={(e) => e.stopPropagation()}>
      {a.auto && <div class="note">{t('autoArrow')}</div>}
      <div class="seg small">
        <button class={a.line === 'solid' ? 'on' : ''} onClick={() => up({ line: 'solid' })}>{t('arrowSolid')}</button>
        <button class={a.line === 'dashed' ? 'on' : ''} onClick={() => up({ line: 'dashed' })}>{t('arrowDashed')}</button>
        <button class={a.line === 'dotted' ? 'on' : ''} onClick={() => up({ line: 'dotted' })}>{t('arrowDotted')}</button>
      </div>
      <div class="seg small">
        <button class={a.route === 'under' ? 'on' : ''} onClick={() => up({ route: 'under', bend: [0, 0] })}>{t('arrowUnder')}</button>
        <button class={a.route === 'curve' ? 'on' : ''} onClick={() => up({ route: 'curve', bend: [0, 0] })}>{t('arrowCurve')}</button>
      </div>
      <div class="seg small">
        <button class={a.head === 'end' ? 'on' : ''} onClick={() => up({ head: 'end' })}>→</button>
        <button class={a.head === 'both' ? 'on' : ''} onClick={() => up({ head: 'both' })}>↔</button>
        <button class={a.head === 'none' ? 'on' : ''} onClick={() => up({ head: 'none' })}>—</button>
      </div>
      <div class="row">
        <input
          placeholder={t('arrowLabel')}
          value={label.value}
          onInput={(e) => (label.value = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') up({ label: label.value || undefined });
          }}
          onBlur={() => label.value !== (a.label ?? '') && up({ label: label.value || undefined })}
        />
        <button class="btn small" onClick={() => up({ bend: [0, 0] })} title={t('arrowResetBend')}>
          ⟲
        </button>
        {!a.auto && (
          <button class="icon-btn danger" title={t('delete')} aria-label={t('delete')} onClick={() => A.deleteArrow(a)}>
            <ITrash />
          </button>
        )}
      </div>
    </div>
  );
}
