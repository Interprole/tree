import { signal, useSignal, useSignalEffect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import * as A from '../actions';
import type * as E from '../core/edits';
import type { DArrow, DNode } from '../core/model';
import { hasOnlyExponent } from '../core/arrows';
import { plain } from '../core/richtext';
import { t } from '../i18n';
import { editable, focusLabel, linkCounts, selection, showToast, tree } from '../state';
import { IArrowTool, IChild, ICopyNode, IMother, ISister, ITrash, ITriangle } from './icons';

const PALETTE = ['#b91c1c', '#c2410c', '#a16207', '#15803d', '#0f766e', '#1d4ed8', '#6d28d9', '#be185d', '#57534e'];

/** colours picked with the custom picker, newest first (remembered in this browser) */
const recentColors = signal<string[]>(readRecent());
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem('nanotrees:colors') ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}
function remember(c: string) {
  recentColors.value = [c, ...recentColors.value.filter((x) => x !== c)].slice(0, 8);
  try {
    localStorage.setItem('nanotrees:colors', JSON.stringify(recentColors.value));
  } catch {
    /* storage disabled */
  }
}

let focusConsumed = 0;

/** The editing panel beside the canvas: everything about the selected node, arrow or label. */
export function Inspector() {
  const sel = selection.value;
  const tr = tree.value;
  let body: ComponentChildren;
  if (sel?.kind === 'node') {
    const n = tr?.nodes.find((x) => x.key === sel.key);
    body = n ? <NodePanel key={n.key} n={n} /> : null;
  } else if (sel?.kind === 'arrow') {
    const a = tr?.arrows[sel.index];
    body = a ? <ArrowPanel key={sel.index} a={a} index={sel.index} /> : null;
  } else if (sel?.kind === 'label') {
    const text = A.labelText(sel.label, sel.owner, sel.index);
    body = text !== undefined ? <LabelPanel key={`${sel.label}${sel.owner}${sel.index}`} text={text} sel={sel} /> : null;
  }
  return (
    <div class="inspector" data-testid="inspector">
      {body ?? (
        <div class="insp-empty">
          <p class="hint">Click a node, an arrow or a note on the tree to edit it here. Double-click a node to rename it.</p>
          <ul class="hint insp-keys">
            <li><kbd>A</kbd> daughter · <kbd>S</kbd> sister · <kbd>P</kbd> mother</li>
            <li><kbd>T</kbd> triangle · <kbd>M</kbd> arrow from here · <kbd>Del</kbd> delete</li>
            <li>Double-click an arrow to add a bend point</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function Group({ title, children, hint }: { title: string; children: ComponentChildren; hint?: string }) {
  return (
    <section class="insp-group">
      <h3 title={hint}>{title}</h3>
      {children}
    </section>
  );
}

/** A text field that applies on Enter or when it loses focus, and follows outside changes while not focused. */
function TextField({ value, onCommit, placeholder, label, live, autoFocusOn, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string; live?: boolean; autoFocusOn?: number; mono?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const last = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = value;
    last.current = value;
  }, [value]);
  useEffect(() => {
    if (autoFocusOn && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoFocusOn]);
  const commit = () => {
    const v = ref.current!.value;
    if (v !== last.current) {
      last.current = v;
      onCommit(v);
    }
  };
  return (
    <label class="insp-field">
      <span>{label}</span>
      <input
        ref={ref}
        class={mono ? 'mono' : ''}
        defaultValue={value}
        placeholder={placeholder}
        aria-label={label}
        onInput={() => live && commit()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            ref.current!.value = last.current;
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        onBlur={commit}
      />
    </label>
  );
}

/**
 * A number field that applies at once: typing, the ▲▼ buttons, the arrow keys and the mouse wheel
 * (over the focused field) all change the tree immediately. Emptying it removes the setting.
 */
export function NumField({ label, value, onCommit, placeholder, step = 1, min }: { label: string; value?: number; onCommit: (v: string | null) => void; placeholder: string; step?: number; min?: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const current = value === undefined ? '' : String(value);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = current;
  }, [current]);
  const apply = (raw: string, final: boolean) => {
    const v = raw.trim();
    if (v === current) return;
    if (v === '') {
      if (final) onCommit(null);
      return;
    }
    if (Number.isFinite(Number(v))) onCommit(String(Number(v)));
  };
  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      const base = el.value.trim() === '' ? Number(el.placeholder) || 0 : Number(el.value);
      let next = base + (e.deltaY < 0 ? step : -step);
      if (min !== undefined) next = Math.max(min, next);
      el.value = String(Math.round(next * 100) / 100);
      apply(el.value, false);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  return (
    <label class="num-field">
      <span>{label}</span>
      <input
        ref={ref}
        type="number"
        step={step}
        min={min}
        defaultValue={current}
        placeholder={placeholder}
        onInput={(e) => apply((e.currentTarget as HTMLInputElement).value, false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') apply((e.currentTarget as HTMLInputElement).value, true);
        }}
        onBlur={(e) => apply((e.currentTarget as HTMLInputElement).value, true)}
      />
    </label>
  );
}

/** Palette swatches, colours used before, a custom colour and "default". */
export function ColorPicker({ value, onPick }: { value?: string; onPick: (c: string | null) => void }) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#336699';
  const extra = recentColors.value.filter((c) => !PALETTE.includes(c));
  return (
    <div class="swatches">
      {[...PALETTE, ...extra].map((c) => (
        <button key={c} class={`swatch ${value?.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />
      ))}
      <label class="swatch custom" title="Any colour…" aria-label="Any colour">
        <input
          type="color"
          value={hex}
          onInput={(e) => onPick((e.target as HTMLInputElement).value)}
          onChange={(e) => remember((e.target as HTMLInputElement).value)}
        />
      </label>
      <button class="swatch none" title="Default colour" aria-label="Default colour" onClick={() => onPick(null)} />
    </div>
  );
}

const SIDES = ['auto', 'left', 'right', 'above', 'below'] as const;

/** An editable list of labels (notes of a node, labels of an arrow). */
function LabelList({ initial, onApply, placeholder }: { initial: E.LabelSpec[]; onApply: (l: E.LabelSpec[]) => void; placeholder: string }) {
  const items = useSignal<E.LabelSpec[]>(initial.length ? initial : [{ text: '', side: 'auto' }]);
  const set = (i: number, patch: Partial<E.LabelSpec>) => (items.value = items.value.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <form
      class="label-list"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(items.value);
      }}
    >
      {items.value.map((it, i) => (
        <div class="row tight" key={i}>
          <input class="grow" value={it.text} placeholder={placeholder} onInput={(e) => set(i, { text: (e.target as HTMLInputElement).value })} onKeyDown={(e) => e.stopPropagation()} />
          <select value={it.side} onChange={(e) => set(i, { side: (e.target as HTMLSelectElement).value as E.LabelSpec['side'], off: undefined })} title="Position">
            {SIDES.map((sd) => (
              <option key={sd} value={sd}>
                {sd}
              </option>
            ))}
          </select>
          <button type="button" class="icon-btn small" title="Remove" aria-label="Remove" onClick={() => (items.value = items.value.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div class="row">
        <button type="button" class="btn small" onClick={() => (items.value = [...items.value, { text: '', side: 'auto' }])}>
          + Add
        </button>
        <button class="btn small primary" type="submit">
          Apply
        </button>
      </div>
    </form>
  );
}

function ToolRow({ children }: { children: ComponentChildren }) {
  return <div class="insp-tools">{children}</div>;
}

function Tool({ title, icon, text, onClick, disabled, active, danger }: { title: string; icon: preact.JSX.Element; text: string; onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean }) {
  return (
    <button class={`insp-tool ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{text}</span>
    </button>
  );
}

/* ------------------------------------------------------------ node */

function NodePanel({ n }: { n: DNode }) {
  const target = useSignal<'label' | 'edge' | 'branch' | 'meaning'>('label');
  const disabled = !n.src || !editable.value;
  const srcNode = n.src?.kind === 'node' ? n.src : n.parents[0]?.src?.kind === 'node' ? n.parents[0].src : null;
  const inChain = !!(n.chainRef || n.id);
  const overt = !n.copy && !n.trace;
  const ref = A.chainRef(n);
  const lines = A.arrowLinesOf(n);
  /** inside a lower position of a chain: triangle and colour apply to this position only */
  const linked = A.linkedBranchOf(n);
  // a position of a chain (or inside one): edits go to this copy only, or to all copies
  const inst = A.instanceOf(n);
  const scopeThis = !!inst && A.copyScope.value === 'this';
  const own = scopeThis ? A.posStyle(A.positionAt(n))?.mods : undefined;
  const instRef = inst ? A.chainRef(inst) : null;
  const instMods = inst ? A.posStyle(inst.chainRef!)?.mods : undefined;
  /** this copy: what it has of its own, else what all share */
  const pick = <T,>(mine: T | undefined, shared: T): T => (scopeThis && A.positionAt(n) && mine !== undefined ? mine : shared);
  const focus = useSignal(0);
  // a double-click, Enter or a new node: type the label right away (each request once)
  useSignalEffect(() => {
    const f = focusLabel.value;
    if (f && f.key === n.key && f.id !== focusConsumed) {
      focusConsumed = f.id;
      focus.value = f.id;
    }
  });
  const labelValue = n.src ? (n.src.kind === 'leaf' ? n.src.text : n.src.label.replace(/~/g, ' ')) : plain(n.label);
  const applyColor = (c: string | null) => {
    if (target.value === 'label') A.setColor(n, c, false);
    else if (target.value === 'branch') A.setColor(n, c, true);
    else A.setOption(n, target.value === 'edge' ? 'edge' : 'sem', c);
  };
  const currentColor = scopeThis && (target.value === 'label' || target.value === 'branch') ? instMods?.color ?? instRef?.color : target.value === 'label' ? n.color : target.value === 'branch' ? n.branchColor : target.value === 'edge' ? n.edgeColor : n.semColor;
  const kind = n.kind === 'leaf' ? 'Terminal' : n.trace ? 'Trace' : n.copy ? 'Silent copy' : 'Node';
  return (
    <div class="insp-panel">
      <header class="insp-head">
        <h2>{kind}</h2>
        {inChain && <span class="chip" title="A position of a movement chain">#{n.chainRef?.id ?? n.id}{n.chainRef ? `/${n.chainRef.occ}` : ''}</span>}
      </header>
      {inst && (
        <div class="scope">
          <span class="end-lbl">Apply to</span>
          <div class="seg small grow">
            <button class={A.copyScope.value === 'this' ? 'on' : ''} onClick={() => (A.copyScope.value = 'this')} title="Colour, triangle, features, meaning, notes and the edge of this copy only">
              This copy #{inst.chainRef!.id}/{inst.chainRef!.occ}
            </button>
            <button class={A.copyScope.value === 'all' ? 'on' : ''} onClick={() => (A.copyScope.value = 'all')} title="The constituent: every copy of it">
              All copies
            </button>
          </div>
        </div>
      )}
      {n.synthetic && !inst && <p class="hint">{t('syntheticNode')}</p>}
      {linked && (
        <div class="linked-note" style={{ borderColor: 'currentColor' }}>
          <span>
            {linked.root === n ? 'A linked branch' : 'Inside a linked branch'} · {linkCounts.value.get(linked.group) ?? 1} copies: what changes {linked.root === n ? 'inside it' : 'here'} changes in all of them; sisters, mothers and moving the branch are free.
          </span>
          {linked.root === n && (
            <button class="btn small" onClick={() => A.unlinkBranch(n)}>
              Unlink
            </button>
          )}
        </div>
      )}
      <TextField key={n.key} label={n.kind === 'leaf' ? 'Words' : 'Label'} value={labelValue} live autoFocusOn={focus.value} onCommit={(v) => A.renameNode(n, v)} placeholder={n.kind === 'leaf' ? 'words' : 'e.g. DP, T′, V_i'} />
      <ToolRow>
        <Tool title={t('addChild')} icon={<IChild />} text="Daughter" disabled={disabled} onClick={() => A.addChild(n)} />
        <Tool title={t('addSister')} icon={<ISister />} text="Sister" disabled={disabled || !n.parents.length} onClick={() => A.addSister(n)} />
        <Tool title="Add a mother above (P)" icon={<IMother />} text="Mother" disabled={disabled} onClick={() => A.addMother(n)} />
        <Tool
          title={scopeThis ? 'Triangle over this copy only (the other copies stay as they are)' : t('triangle')}
          icon={<ITriangle />}
          text="Triangle"
          disabled={disabled && !scopeThis}
          active={scopeThis ? !!(instMods?.triangle ?? instRef?.triangle) : !!n.triangle || !!n.parents[0]?.triangle}
          onClick={() => A.toggleTriangle(n)}
        />
        <Tool title="Draw an arrow from here, then click the target (M)" icon={<IArrowTool />} text="Arrow" onClick={() => A.startArrow(n)} />
        <Tool title={t('delete')} icon={<ITrash />} text="Delete" danger disabled={disabled} onClick={() => A.deleteNode(n)} />
      </ToolRow>

      <Group title="Copy and paste" hint="A pasted copy is a constituent of its own (its #ids are renamed), not one more position of the original">
        <div class="row wrap">
          <button class="btn small" disabled={!n.src} onClick={() => A.copyNode(n) && showToast('Copied.')} title="Ctrl+C">
            Copy
          </button>
          <button class="btn small" disabled={disabled || n.kind === 'leaf'} onClick={() => A.copyNode(n, true) && showToast('Copied as a linked branch: paste it anywhere, the copies stay in sync.')} title="Pasted, it stays linked: what changes inside one copy changes in all">
            Copy linked
          </button>
          <button class="btn small" disabled={disabled} onClick={() => A.cutNode(n)} title="Ctrl+X">
            Cut
          </button>
          <button class="btn small" disabled={disabled} onClick={() => A.duplicateNode(n)} title="Ctrl+D: a copy right after it">
            Duplicate
          </button>
        </div>
        {A.clip.value && (
          <div class="row wrap">
            <button class="btn small" disabled={disabled} onClick={() => A.paste(A.clip.value, n, 'daughter')} title="Ctrl+V">
              Paste as daughter
            </button>
            <button class="btn small" disabled={disabled || !n.parents.length} onClick={() => A.paste(A.clip.value, n, 'sister')} title="Ctrl+Shift+V">
              as sister
            </button>
            <button class="btn small" onClick={() => A.paste(A.clip.value, null)} title="Ctrl+V with nothing selected">
              as a new tree
            </button>
          </div>
        )}
      </Group>

      <Group title="Movement">
        <div class="row wrap">
          <button class="btn small" disabled={disabled} onClick={() => A.startPick('daughter', n)} title="Then click a constituent: it becomes one more position of the same element (#id)">
            <ICopyNode size={15} /> Re-merge as daughter…
          </button>
          <button class="btn small" disabled={disabled || !n.parents.length} onClick={() => A.startPick('sister', n)}>
            as sister…
          </button>
        </div>
        {inChain && (
          <button class="btn small" onClick={() => A.togglePronounce(n)}>
            {overt ? 'Silence this position' : 'Pronounce this position'}
          </button>
        )}
        {ref && (
          <TextField
            key={'as' + n.key}
            label="Pronounced as (other words, e.g. a pronoun copy)"
            value={ref.text ?? ''}
            placeholder="e.g. zij | she   (empty = the same words)"
            onCommit={(v) => A.setPronounceAs(n, v.trim() ? v : null)}
          />
        )}
      </Group>

      {lines.length > 0 && (
        <Group title="Arrows and head movement" hint="Arrow lines from or to this node; a hidden arrow between heads keeps its head movement">
          {lines.map((l, i) => (
            <div class="row tight arrow-line" key={i}>
              <span class="grow mono-small" title={l.hidden ? 'Not drawn' : 'Drawn'}>
                #{l.from}
                {l.fromOcc ? `/${l.fromOcc}` : ''} → #{l.to}
                {l.toOcc ? `/${l.toOcc}` : ''}
                {l.plain ? ' · just an arrow' : ''}
                {l.hidden ? ' · hidden' : ''}
              </span>
              <button class="btn small" onClick={() => A.setArrowLineHidden(l, !l.hidden)}>
                {l.hidden ? 'Show arrow' : 'Hide arrow'}
              </button>
              <button class="icon-btn small danger" title="Remove (the movement too)" aria-label="Remove the arrow" onClick={() => A.deleteArrowLine(l)}>
                ✕
              </button>
            </div>
          ))}
        </Group>
      )}

      <Group title="Features and meaning">
        <TextField key={'f' + n.key + scopeThis} label="Features, separated by commas" value={pick(own?.features?.join(', '), srcNode?.features?.join(', ') ?? '')} placeholder="uφ, iT, EPP" onCommit={(v) => A.setFeatures(n, v)} />
        <TextField key={'m' + n.key + scopeThis} mono label="Meaning: formula : type" value={pick(own?.sem ?? (scopeThis ? A.chainRef(n)?.sem : undefined), srcNode?.sem ?? '')} placeholder="lambda x. cat(x) : <e,t>" onCommit={(v) => A.setMeaning(n, v)} />
        {n.sem?.computed && n.sem.source && (
          <button class="btn small" onClick={() => A.keepComputedMeaning(n)} title={n.sem.source}>
            Write the computed meaning into the code
          </button>
        )}
        {n.sem?.error && <p class="pop-error">{n.sem.error}</p>}
      </Group>

      <Group title="Notes beside the node">
        <LabelList
          key={'n' + n.key + scopeThis + (srcNode?.notes?.length ?? 0) + (own?.notes?.length ?? 0)}
          initial={(scopeThis && A.positionAt(n) ? own?.notes ?? [] : srcNode?.notes ?? []).map((x) => ({ text: x.text, side: x.side, off: x.off }))} placeholder="e.g. focus, [+wh], ✓" onApply={(l) => A.setNotes(n, l)} />
      </Group>

      <Group title="Colour">
        <div class="seg small">
          {(['label', 'edge', 'branch', 'meaning'] as const).map((k) => (
            <button key={k} class={target.value === k ? 'on' : ''} onClick={() => (target.value = k)} title={{ label: 'The label', edge: 'The edge above the node', branch: 'Everything below (labels and edges)', meaning: 'The meaning formula' }[k]}>
              {{ label: 'Label', edge: 'Edge', branch: 'Branch', meaning: 'Meaning' }[k]}
            </button>
          ))}
        </div>
        <ColorPicker value={currentColor} onPick={applyColor} />
        {scopeThis && (target.value === 'label' || target.value === 'branch') && <p class="hint">This copy only, as a whole (with what it contains); the other copies keep their colours.</p>}
      </Group>

      <Group title="Spacing" hint="Width and length apply to the edge above this node; spread widens the gaps between its daughters (px).">
        <div class="num-row">
          <NumField label="Edge width" value={n.edgeWidth} placeholder="1" step={0.5} min={0} onCommit={(v) => A.setOption(n, 'width', v)} />
          <NumField label="Extra length" value={n.edgeLen} placeholder="0" onCommit={(v) => A.setOption(n, 'len', v)} />
          <NumField label="Spread daughters" value={n.spread} placeholder="0" onCommit={(v) => A.setOption(n, 'spread', v)} />
        </div>
      </Group>

      {n.kind === 'phrase' && (
        <Group title="Branching" hint="Swaps the two daughters">
          <div class="row tight">
            <button class="btn small" onClick={() => A.restructure(n, 'left')} disabled={disabled} title="[XP X [Z]] → [XP [Z] X]">
              ← left
            </button>
            <button class="btn small" onClick={() => A.restructure(n, 'right')} disabled={disabled} title="[XP [Z] X] → [XP X [Z]]">
              right →
            </button>
          </div>
        </Group>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ arrow */

function ArrowPanel({ a, index }: { a: DArrow; index: number }) {
  const up = (p: Parameters<typeof A.updateArrow>[1]) => A.updateArrow(a, p);
  const initial = (a.src?.labels ?? []).map((l) => ({ text: l.text, side: l.side, off: l.off }));
  const nVia = a.via?.length ?? 0;
  return (
    <div class="insp-panel">
      <header class="insp-head">
        <h2>Arrow</h2>
        {a.auto && <span class="chip">automatic</span>}
        {a.plain && <span class="chip">plain</span>}
      </header>
      {a.auto && <p class="hint">Drawn automatically between two positions of a chain. Changing it writes an arrow line into the code.</p>}
      {!a.auto && (
        <Group title="Meaning" hint="An arrow between two heads is head movement: the source is struck through and the target becomes a complex head.">
          <div class="seg small">
            <button class={!a.plain ? 'on' : ''} onClick={() => up({ plain: undefined })} title="Between heads: strikes the source, the target shows V+v">
              Movement
            </button>
            <button class={a.plain ? 'on' : ''} onClick={() => up({ plain: true })} title="Just an arrow from node to node: nothing is struck through or joined">
              Just an arrow
            </button>
          </div>
          {!a.plain && (
            <button
              class="btn small"
              title="Head movement stays (the struck source, V+v); only the arrow is not drawn"
              onClick={() => {
                up({ hidden: true });
                selection.value = null;
                showToast('The arrow is hidden; the movement stays. Show it again from the panel of either node.');
              }}
            >
              Movement without the arrow
            </button>
          )}
        </Group>
      )}
      {a.route === 'under' && (hasOnlyExponent(a.from) || hasOnlyExponent(a.to)) && (
        <Group title="Ends" hint="Where the arrow leaves and enters a node that has only a word or a morpheme">
          {hasOnlyExponent(a.from) && (
            <div class="row tight">
              <span class="end-lbl">From</span>
              <div class="seg small grow">
                <button class={a.fromAt !== 'node' ? 'on' : ''} onClick={() => up({ fromAt: undefined })} title="From under its word or morpheme">
                  the word
                </button>
                <button class={a.fromAt === 'node' ? 'on' : ''} onClick={() => up({ fromAt: 'node' })} title="From the side of the node's label">
                  the node {plain(a.from.label)}
                </button>
              </div>
            </div>
          )}
          {hasOnlyExponent(a.to) && (
            <div class="row tight">
              <span class="end-lbl">To</span>
              <div class="seg small grow">
                <button class={a.toAt !== 'node' ? 'on' : ''} onClick={() => up({ toAt: undefined })} title="Into the bottom of its word or morpheme">
                  the word
                </button>
                <button class={a.toAt === 'node' ? 'on' : ''} onClick={() => up({ toAt: 'node' })} title="Into the side of the node's label">
                  the node {plain(a.to.label)}
                </button>
              </div>
            </div>
          )}
        </Group>
      )}
      <Group title="Line">
        <div class="seg small">
          <button class={a.line === 'solid' ? 'on' : ''} onClick={() => up({ line: 'solid' })}>{t('arrowSolid')}</button>
          <button class={a.line === 'dashed' ? 'on' : ''} onClick={() => up({ line: 'dashed' })}>{t('arrowDashed')}</button>
          <button class={a.line === 'dotted' ? 'on' : ''} onClick={() => up({ line: 'dotted' })}>{t('arrowDotted')}</button>
        </div>
        <div class="seg small">
          <button class={a.route === 'under' ? 'on' : ''} onClick={() => up({ route: 'under', bend: [0, 0], via: undefined })}>{t('arrowUnder')}</button>
          <button class={a.route === 'curve' ? 'on' : ''} onClick={() => up({ route: 'curve', bend: [0, 0], via: undefined })}>{t('arrowCurve')}</button>
        </div>
        <div class="row tight">
          <div class="seg small">
            <button class={a.head === 'end' ? 'on' : ''} onClick={() => up({ head: 'end' })} title="Head at the target">→</button>
            <button class={a.head === 'start' ? 'on' : ''} onClick={() => up({ head: 'start' })} title="Head at the source">←</button>
            <button class={a.head === 'both' ? 'on' : ''} onClick={() => up({ head: 'both' })} title="Both ends">↔</button>
            <button class={a.head === 'none' ? 'on' : ''} onClick={() => up({ head: 'none' })} title="No head">—</button>
          </div>
          <button class="btn small" title="Swap source and target" onClick={() => A.reverseArrow(a)}>⇄ Reverse</button>
        </div>
      </Group>
      <Group title="Shape">
        <p class="hint">
          {nVia ? `${nVia} bend point${nVia > 1 ? 's' : ''}: drag a round handle to move it, double-click it to remove it.` : 'Drag the round handle to bend the arrow. Double-click the arrow to add bend points.'}
        </p>
        <div class="row tight">
          <button
            class="btn small"
            onClick={() => {
              const g = A.arrowGeom(index);
              if (g) A.setVia(a, A.addViaAtMiddle(g));
            }}
          >
            + Bend point
          </button>
          <button class="btn small" disabled={!nVia && !a.bend[0] && !a.bend[1]} onClick={() => up({ bend: [0, 0], via: undefined })} title={t('arrowResetBend')}>
            ⟲ Automatic shape
          </button>
        </div>
      </Group>
      <Group title="Colour">
        <ColorPicker value={a.color} onPick={(c) => up({ color: c ?? undefined })} />
      </Group>
      <Group title="Labels">
        <LabelList key={index + ':' + initial.length} initial={initial} placeholder={t('arrowLabel')} onApply={(l) => up({ labels: l.filter((x) => x.text.trim()).map((x) => ({ ...x, span: { from: 0, to: 0 } })) })} />
      </Group>
      <div class="row">
        <button class="btn small danger-btn" onClick={() => A.deleteArrow(a)}>
          <ITrash size={15} /> Delete arrow
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ note / arrow label */

function LabelPanel({ text, sel }: { text: string; sel: { label: 'note' | 'arrow'; owner: string | number; index: number } }) {
  return (
    <div class="insp-panel">
      <header class="insp-head">
        <h2>{sel.label === 'note' ? 'Note' : 'Arrow label'}</h2>
      </header>
      <TextField label="Text (Markdown: **bold**, *italic*)" value={text} autoFocusOn={1} onCommit={(v) => A.editLabel(sel.label, sel.owner, sel.index, v)} />
      <p class="hint">Drag the label on the tree to move it.</p>
      <div class="row">
        <button
          class="btn small danger-btn"
          onClick={() => {
            A.editLabel(sel.label, sel.owner, sel.index, null);
            selection.value = null;
          }}
        >
          <ITrash size={15} /> Delete label
        </button>
      </div>
    </div>
  );
}
