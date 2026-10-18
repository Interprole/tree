import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { defaultBuildOptions } from '../core/build';
import type { BuildOptions } from '../core/build';
import { defaultStyle, FONT_FAMILIES, isLocalFont, presets } from '../core/style';
import type { BuiltinFont, FontId, PresetId, TreeStyle } from '../core/style';
import { canListLocalFonts, listLocalFamilies, localFamiliesIfAllowed, localFontAvailable, onlySystemFonts, systemFonts } from '../fonts';
import { t } from '../i18n';
import { activeTree, appearanceScope, showToast, shownBuild as build, shownStyle as style, trees } from '../state';
import { applyBuild as setBuild, applyStyle as setStyle } from '../overrides';
import { overridePolicy } from '../ask';
import { ColorField, ResetBtn, Section, Seg, Slider, Toggle } from './controls';
import { NumField } from './Inspector';

/** reset handler for a style key, or undefined when it already has its default value */
function rs<K extends keyof TreeStyle>(k: K): (() => void) | undefined {
  return style.value[k] === defaultStyle[k] ? undefined : () => setStyle({ [k]: defaultStyle[k] } as Partial<TreeStyle>);
}

type Path = [keyof BuildOptions] | ['xbar', keyof BuildOptions['xbar']] | ['semantics', keyof BuildOptions['semantics']];

function getPath(o: BuildOptions, p: Path): unknown {
  return p.length === 1 ? o[p[0]] : (o[p[0]] as unknown as Record<string, unknown>)[p[1]];
}

/** reset handler for a build option */
function rb(...p: Path): (() => void) | undefined {
  const def = getPath(defaultBuildOptions, p);
  if (getPath(build.value, p) === def) return undefined;
  return () => setBuild(p.length === 1 ? { [p[0]]: def } : { [p[0]]: { [p[1]]: def } });
}

export function ModeOptions() {
  const b = build.value;
  if (b.mode === 'xbar') {
    return (
      <>
        <Seg label={t('xbarBar')} small value={b.xbar.bar} reset={rb('xbar', 'bar')} onChange={(v) => setBuild({ xbar: { bar: v } })} options={[
          { v: 'always', label: t('xbarBarAlways') },
          { v: 'auto', label: t('xbarBarAuto') },
          { v: 'never', label: t('xbarBarNever') },
        ]} />
        <Seg label={t('xbarHead')} small value={b.xbar.headLabel} reset={rb('xbar', 'headLabel')} onChange={(v) => setBuild({ xbar: { headLabel: v } })} options={[
          { v: 'X', label: 'X' },
          { v: 'X0', label: 'X⁰' },
        ]} />
        <Seg label={t('xbarBarStyle')} small value={b.xbar.barStyle} reset={rb('xbar', 'barStyle')} onChange={(v) => setBuild({ xbar: { barStyle: v } })} options={[
          { v: 'prime', label: t('xbarBarPrime') },
          { v: 'bar', label: t('xbarBarOver') },
        ]} />
        <Toggle label={t('xbarEmptySpecs')} checked={b.xbar.emptySpecs} reset={rb('xbar', 'emptySpecs')} onChange={(v) => setBuild({ xbar: { emptySpecs: v } })} />
        <Toggle label={t('xbarExpand')} checked={b.xbar.expandWords} reset={rb('xbar', 'expandWords')} onChange={(v) => setBuild({ xbar: { expandWords: v } })} />
      </>
    );
  }
  return <p class="hint">{t('modeManualHint')}</p>;
}

/** Movement chains: representation, look of silent copies, arrows, indices. */
export function ChainOptions() {
  const b = build.value;
  const s = style.value;
  return (
    <>
      <Seg label="Chains are drawn as" small value={b.chains} reset={rb('chains')} onChange={(v) => setBuild({ chains: v })} options={[
        { v: 'copies', label: 'Copies', title: 'Every position gets a full copy; unpronounced copies are styled' },
        { v: 'traces', label: 'Traces', title: 'Unpronounced positions become t' },
        { v: 'multidominance', label: 'Multidominance', title: 'One node with several mothers' },
      ]} />
      {b.chains === 'copies' && (
        <Seg label="Unpronounced copies" small value={s.copyStyle} reset={rs('copyStyle')} onChange={(v) => setStyle({ copyStyle: v })} options={[
          { v: 'regular', label: 'Regular' },
          { v: 'gray', label: 'Gray' },
          { v: 'strike', label: 'Struck through' },
          { v: 'angle', label: '⟨Angle brackets⟩' },
        ]} />
      )}
      {b.chains !== 'multidominance' && <Toggle label="Arrows for phrasal movement" hint="Arrows between the copies of a chain (just-arrows stay)" checked={b.chainArrows} reset={rb('chainArrows')} onChange={(v) => setBuild({ chainArrows: v })} />}
      <Toggle label="Movement indices (DPᵢ … tᵢ)" checked={b.chainIndices} reset={rb('chainIndices')} onChange={(v) => setBuild({ chainIndices: v })} />
      <Toggle label="Arrows for head movement" hint="Without them, head movement still shows: the struck source and the complex head (V+v); just-arrows stay" checked={b.headArrows} reset={rb('headArrows')} onChange={(v) => setBuild({ headArrows: v })} />
    </>
  );
}

/** the CSS of a font id, for writing its name in itself */
const faceOf = (f: FontId) => (isLocalFont(f) ? `"${f.slice(6).replace(/"/g, '')}", var(--ui-font, sans-serif)` : FONT_FAMILIES[f as BuiltinFont]?.css);

/** A list of font names, each written in its own font. */
function FontNames({ names, current, filter, onPick }: { names: string[]; current: string; filter: string; onPick: (name: string) => void }) {
  const q = filter.trim().toLowerCase();
  // the name of the font in use shows them all; anything else typed narrows the list
  const shown = (q && q !== current.toLowerCase() ? names.filter((n) => n.toLowerCase().includes(q)) : names).slice(0, 200);
  if (!shown.length) return null;
  return (
    <div class="font-names" role="listbox" aria-label="Fonts">
      {shown.map((n) => (
        <button key={n} type="button" role="option" aria-selected={n === current} class={n === current ? 'on' : ''} style={{ fontFamily: faceOf(`local:${n}`) }} onPointerDown={(e) => e.preventDefault()} onClick={() => onPick(n)}>
          {n}
        </button>
      ))}
    </div>
  );
}

function FontPicker() {
  const s = style.value;
  const families = useSignal<string[] | null>(null);
  const custom = useSignal(isLocalFont(s.font) ? s.font.slice(6) : '');
  const local = isLocalFont(s.font) && s.font.slice(6).trim() !== '';
  // "An installed font…" chosen, no name yet: the tree keeps its font until one is given
  const picking = useSignal(false);
  const menu = useSignal(false);
  const open = local || picking.value || s.font === ('local:' as FontId);
  const missing = local && !localFontAvailable(s.font.slice(6));
  // Safari: only the fonts of the system, not the ones installed by the user
  const safari = onlySystemFonts();
  const noTimes = s.font === 'times' && !localFontAvailable('Times New Roman');
  const box = useRef<HTMLDivElement>(null);
  // the list once allowed: shown again without asking
  useEffect(() => {
    if (open && !families.value && !safari) void localFamiliesIfAllowed().then((l) => l && (families.value = l));
  }, [open]);
  // the menu closes on a click elsewhere or Escape
  useEffect(() => {
    if (!menu.value) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && (menu.value = false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (menu.value = false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menu.value]);
  const loadList = async () => {
    try {
      families.value = await listLocalFamilies();
    } catch {
      showToast('The browser did not allow reading the list of installed fonts. Type the name instead.');
    }
  };
  const useLocal = (name: string) => {
    custom.value = name;
    setStyle({ font: `local:${name}` });
  };
  const localLabel = safari ? 'A system font…' : 'An installed font…';
  const currentName = local ? s.font.slice(6) : open ? localLabel : FONT_FAMILIES[s.font as BuiltinFont]?.name ?? s.font;
  const names = safari ? systemFonts() : families.value;
  return (
    <>
      <div class="field font-menu" ref={box}>
        <span class="lbl">
          {t('font')} <ResetBtn reset={rs('font')} />
        </span>
        <button type="button" class="font-current" aria-haspopup="listbox" aria-expanded={menu.value} style={{ fontFamily: local || !open ? faceOf(s.font) : undefined }} onClick={() => (menu.value = !menu.value)}>
          {currentName}
        </button>
        {menu.value && (
          <div class="font-options" role="listbox" aria-label={t('font')}>
            {(Object.keys(FONT_FAMILIES) as BuiltinFont[]).map((f) => (
              <button
                key={f}
                type="button"
                role="option"
                data-font={f}
                aria-selected={s.font === f && !open}
                class={s.font === f && !open ? 'on' : ''}
                style={{ fontFamily: FONT_FAMILIES[f].css }}
                onClick={() => {
                  picking.value = false;
                  menu.value = false;
                  setStyle({ font: f });
                }}
              >
                {FONT_FAMILIES[f].name}
              </button>
            ))}
            <button
              type="button"
              role="option"
              data-font="local:"
              aria-selected={open}
              class={`other ${open ? 'on' : ''}`}
              onClick={() => {
                menu.value = false;
                if (!local) {
                  custom.value = '';
                  picking.value = true;
                }
              }}
            >
              {local ? `${safari ? 'System' : 'Installed'}: ${s.font.slice(6)}` : localLabel}
            </button>
          </div>
        )}
      </div>
      {s.font === 'times' && (
        <p class={noTimes ? 'hint warn' : 'hint'}>
          {noTimes
            ? 'This computer has no Times New Roman, so Tinos is shown instead: its free twin, with the same letter widths. Exports use Tinos too.'
            : 'PDF export uses Tinos, the free twin of Times New Roman with the same letter widths (Times New Roman itself cannot be embedded); so do SVG files opened where there is no Times New Roman.'}
        </p>
      )}
      {open && (
        <div class="local-font">
          {safari && <p class="hint">Safari lets websites use only the fonts that come with macOS (Helvetica, Georgia, Palatino…). Fonts you installed yourself work only in Chrome, Edge or Firefox.</p>}
          <form
            class="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.value.trim()) useLocal(custom.value.trim());
            }}
          >
            <input
              class="grow"
              placeholder={names?.length ? 'Pick below or type a name' : 'Font name, e.g. Times New Roman'}
              value={custom.value}
              onInput={(e) => (custom.value = (e.target as HTMLInputElement).value)}
            />
            <button class="btn small" type="submit">Use</button>
          </form>
          {names && <FontNames names={names} current={local ? s.font.slice(6) : ''} filter={custom.value} onPick={useLocal} />}
          {!safari && canListLocalFonts() && !families.value && (
            <button class="btn small ghost" type="button" onClick={loadList}>
              List the fonts installed on this computer
            </button>
          )}
          {missing && (
            <p class="hint warn">
              The browser finds no font called “{s.font.slice(6)}” on this computer, so it shows a fallback (usually Times New Roman). Check the name{names?.length ? ' against the list' : ''}. A font installed while the browser was open appears only after the browser is closed completely and opened again. Safari and Firefox with strict privacy settings do not let pages use fonts you installed yourself.
            </p>
          )}
          {!safari && <p class="hint">Installed fonts show on this computer; PNG, SVG and PDF exports embed them when the browser allows reading the font file (Chrome, Edge).</p>}
        </div>
      )}
    </>
  );
}

export function SettingsPanel() {
  const s = style.value;
  const b = build.value;
  const applyPreset = (p: PresetId) => {
    setStyle(presets[p]);
  };
  const anyStyleChanged = (Object.keys(defaultStyle) as (keyof TreeStyle)[]).some((k) => s[k] !== defaultStyle[k]);
  return (
    <div class="settings">
      <div class="scope appearance-scope">
        <span class="end-lbl">Settings of</span>
        <div class="seg small grow">
          <button class={appearanceScope.value === 'tree' ? 'on' : ''} onClick={() => (appearanceScope.value = 'tree')} title="The tree being edited (click a tree)">
            {trees.value.length > 1 ? activeTree.value.name : 'This tree'}
          </button>
          <button class={appearanceScope.value === 'canvas' ? 'on' : ''} onClick={() => (appearanceScope.value = 'canvas')} title="Every tree of the canvas (click the empty canvas)">
            All trees
          </button>
        </div>
      </div>
      <Section title={t('presets')}>
        <div class="presets">
          {(['paper', 'slides', 'board'] as PresetId[]).map((p) => (
            <button key={p} class={`preset preset-${p}`} onClick={() => applyPreset(p)}>
              <strong>{t(p === 'paper' ? 'presetPaper' : p === 'slides' ? 'presetSlides' : 'presetBoard')}</strong>
              <small>{t(p === 'paper' ? 'presetPaperHint' : p === 'slides' ? 'presetSlidesHint' : 'presetBoardHint')}</small>
            </button>
          ))}
          <button
            class="preset preset-reset"
            disabled={!anyStyleChanged}
            onClick={() => {
              setStyle({ ...defaultStyle });
            }}
          >
            <strong>{t('reset')}</strong>
            <small>all appearance settings</small>
          </button>
        </div>
      </Section>

      <Section title={t('labelling')}>
        <Seg value={b.mode} reset={rb('mode')} label="Mode" onChange={(v) => setBuild({ mode: v })} options={[
          { v: 'manual', label: t('modeManual'), title: t('modeManualHint') },
          { v: 'xbar', label: t('modeXbar'), title: t('modeXbarHint') },
        ]} />
        <ModeOptions />
        <Toggle label={t('showEmpty')} checked={b.showEmpty} reset={rb('showEmpty')} onChange={(v) => setBuild({ showEmpty: v })} />
      </Section>

      <Section title="Movement">
        <ChainOptions />
      </Section>

      <Section title="Semantics">
        <Toggle label="Show meanings ($…$)" checked={b.semantics.show} reset={rb('semantics', 'show')} onChange={(v) => setBuild({ semantics: { show: v } })} />
        <Toggle label="Compute missing meanings (FA, PC, EI, FC)" checked={b.semantics.compute} reset={rb('semantics', 'compute')} onChange={(v) => setBuild({ semantics: { compute: v } })} />
        <Toggle label="Show types" checked={b.semantics.types} reset={rb('semantics', 'types')} onChange={(v) => setBuild({ semantics: { types: v } })} />
        <Toggle label="Show the composition rule (FA, PC, …)" checked={b.semantics.rules} reset={rb('semantics', 'rules')} onChange={(v) => setBuild({ semantics: { rules: v } })} />
        <div class="colors">
          <ColorField label="Written meanings" value={s.semColor} reset={rs('semColor')} onChange={(v) => setStyle({ semColor: v })} />
          <ColorField label="Computed meanings" value={s.semComputedColor} reset={rs('semComputedColor')} onChange={(v) => setStyle({ semComputedColor: v })} />
        </div>
      </Section>

      <Section title={t('typography')}>
        <FontPicker />
        <Slider label={t('fontSize')} value={s.fontSize} min={9} max={40} unit="px" reset={rs('fontSize')} onInput={(v) => setStyle({ fontSize: v })} />
        <Toggle label={t('leafItalic')} checked={s.leafItalic} reset={rs('leafItalic')} onChange={(v) => setStyle({ leafItalic: v })} />
        <Toggle label={t('nodeBold')} checked={s.nodeBold} reset={rs('nodeBold')} onChange={(v) => setStyle({ nodeBold: v })} />
      </Section>

      <Section title={t('layout')}>
        <Slider label={t('levelGap')} value={s.levelGap} min={6} max={90} unit="px" reset={rs('levelGap')} onInput={(v) => setStyle({ levelGap: v })} />
        <Slider label={t('siblingGap')} value={s.siblingGap} min={4} max={80} unit="px" reset={rs('siblingGap')} onInput={(v) => setStyle({ siblingGap: v })} />
        <Slider label={t('padding')} value={s.padding} min={0} max={80} unit="px" reset={rs('padding')} onInput={(v) => setStyle({ padding: v })} />
        <div class="num-row two">
          <NumField label="Sheet width (px)" value={s.sheetWidth || undefined} placeholder="fit" min={0} step={10} onCommit={(v) => setStyle({ sheetWidth: v ? Number(v) : 0 })} />
          <NumField label="Sheet height (px)" value={s.sheetHeight || undefined} placeholder="fit" min={0} step={10} onCommit={(v) => setStyle({ sheetHeight: v ? Number(v) : 0 })} />
        </div>
        <p class="hint">Empty: as large as the tree needs. A larger or smaller sheet makes the tree grow or shrink with it (in proportion). Or drag the corner of the sheet on the canvas.</p>
        <Toggle label={t('leavesAtBottom')} checked={s.leavesAtBottom} reset={rs('leavesAtBottom')} onChange={(v) => setStyle({ leavesAtBottom: v })} />
      </Section>

      <Section title={t('lines')}>
        <Slider label={t('lineWidth')} value={s.lineWidth} min={0.4} max={4} step={0.1} unit="px" reset={rs('lineWidth')} onInput={(v) => setStyle({ lineWidth: v })} />
        <div class="colors">
          <ColorField label={t('lineColor')} value={s.lineColor} reset={rs('lineColor')} onChange={(v) => setStyle({ lineColor: v })} />
          <ColorField label={t('nodeColor')} value={s.nodeColor} reset={rs('nodeColor')} onChange={(v) => setStyle({ nodeColor: v })} />
          <ColorField label={t('leafColor')} value={s.leafColor} reset={rs('leafColor')} onChange={(v) => setStyle({ leafColor: v })} />
          <ColorField label={t('arrowColor')} value={s.arrowColor} reset={rs('arrowColor')} onChange={(v) => setStyle({ arrowColor: v })} />
          <ColorField label={t('background')} value={s.background === 'transparent' ? '#ffffff' : s.background} reset={rs('background')} onChange={(v) => setStyle({ background: v })} />
        </div>
        <Toggle label={t('handDrawn')} checked={s.handDrawn} reset={rs('handDrawn')} onChange={(v) => setStyle({ handDrawn: v })} />
      </Section>
      <Section title="Values of their own">
        <Seg
          label="When a setting for many changes and some items have their own value"
          small
          value={overridePolicy.value}
          reset={overridePolicy.value === 'ask' ? undefined : () => (overridePolicy.value = 'ask')}
          onChange={(v) => (overridePolicy.value = v)}
          options={[
            { v: 'ask', label: 'Ask', title: 'Ask every time' },
            { v: 'replace', label: 'Replace them', title: 'The new value goes everywhere' },
            { v: 'keep', label: 'Keep them', title: 'Items with their own value keep it' },
          ]}
        />
        <p class="hint">All trees vs a tree with its own value, a tree vs nodes and arrows with their own colour, width or arrow visibility, all copies vs one copy.</p>
      </Section>
      <p class="hint reset-note">
        <ResetBtn reset={() => undefined} /> next to a setting restores its default.
      </p>
    </div>
  );
}
