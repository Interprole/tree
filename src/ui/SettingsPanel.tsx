import { useSignal } from '@preact/signals';
import { defaultBuildOptions } from '../core/build';
import type { BuildOptions } from '../core/build';
import { defaultStyle, FONT_FAMILIES, isLocalFont, presets } from '../core/style';
import type { BuiltinFont, FontId, PresetId, TreeStyle } from '../core/style';
import { canListLocalFonts, listLocalFamilies } from '../fonts';
import { t } from '../i18n';
import { build, setBuild, setStyle, showToast, style } from '../state';
import { ColorField, ResetBtn, Section, Seg, Select, Slider, Toggle } from './controls';

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
      {b.chains !== 'multidominance' && <Toggle label="Arrows between positions" checked={b.chainArrows} reset={rb('chainArrows')} onChange={(v) => setBuild({ chainArrows: v })} />}
      <Toggle label="Movement indices (DPᵢ … tᵢ)" checked={b.chainIndices} reset={rb('chainIndices')} onChange={(v) => setBuild({ chainIndices: v })} />
      <Toggle label="Arrows for head movement" hint="Without them, head movement still shows: the struck source and the complex head (V+v)" checked={b.headArrows} reset={rb('headArrows')} onChange={(v) => setBuild({ headArrows: v })} />
    </>
  );
}

function FontPicker() {
  const s = style.value;
  const families = useSignal<string[] | null>(null);
  const custom = useSignal(isLocalFont(s.font) ? s.font.slice(6) : '');
  const local = isLocalFont(s.font);
  const builtins = (Object.keys(FONT_FAMILIES) as BuiltinFont[]).map((f) => ({ v: f as FontId, label: FONT_FAMILIES[f].name }));
  const options = [...builtins, { v: (local ? s.font : 'local:') as FontId, label: local ? `Installed: ${s.font.slice(6)}` : 'An installed font…' }];
  const loadList = async () => {
    try {
      families.value = await listLocalFamilies();
    } catch {
      showToast('The browser did not allow reading the list of installed fonts. Type the name instead.');
    }
  };
  return (
    <>
      <Select<FontId>
        label={t('font')}
        value={local || s.font === ('local:' as FontId) ? (local ? s.font : ('local:' as FontId)) : s.font}
        reset={rs('font')}
        onChange={(v) => {
          if (v === 'local:') {
            custom.value = '';
            setStyle({ font: 'local:' as FontId });
          } else setStyle({ font: v });
        }}
        options={options}
      />
      {(local || s.font === ('local:' as FontId)) && (
        <div class="local-font">
          <form
            class="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.value.trim()) setStyle({ font: `local:${custom.value.trim()}` });
            }}
          >
            <input class="grow" list="local-font-list" placeholder="Font name, e.g. Times New Roman" value={custom.value} onInput={(e) => (custom.value = (e.target as HTMLInputElement).value)} onChange={(e) => {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v) setStyle({ font: `local:${v}` });
            }} />
            <button class="btn small" type="submit">Use</button>
          </form>
          {families.value && (
            <datalist id="local-font-list">
              {families.value.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          )}
          {canListLocalFonts() && !families.value && (
            <button class="btn small ghost" type="button" onClick={loadList}>
              List the fonts installed on this computer
            </button>
          )}
          <p class="hint">Installed fonts show on this computer; PNG, SVG and PDF exports embed them when the browser allows reading the font file (Chrome, Edge).</p>
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
              style.value = { ...defaultStyle };
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
      <p class="hint reset-note">
        <ResetBtn reset={() => undefined} /> next to a setting restores its default.
      </p>
    </div>
  );
}
