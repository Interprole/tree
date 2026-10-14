import { defaultStyle, FONT_FAMILIES, presets } from '../core/style';
import type { FontId, PresetId } from '../core/style';
import { t } from '../i18n';
import { bindingCheck, build, setBuild, setStyle, style } from '../state';
import { ColorField, Section, Seg, Select, Slider, Toggle } from './controls';

export function ModeOptions() {
  const b = build.value;
  if (b.mode === 'xbar') {
    return (
      <>
        <Seg label={t('xbarBar')} small value={b.xbar.bar} onChange={(v) => setBuild({ xbar: { bar: v } })} options={[
          { v: 'always', label: t('xbarBarAlways') },
          { v: 'auto', label: t('xbarBarAuto') },
          { v: 'never', label: t('xbarBarNever') },
        ]} />
        <Seg label={t('xbarHead')} small value={b.xbar.headLabel} onChange={(v) => setBuild({ xbar: { headLabel: v } })} options={[
          { v: 'X', label: 'X' },
          { v: 'X0', label: 'X⁰' },
        ]} />
        <Seg label={t('xbarBarStyle')} small value={b.xbar.barStyle} onChange={(v) => setBuild({ xbar: { barStyle: v } })} options={[
          { v: 'prime', label: t('xbarBarPrime') },
          { v: 'bar', label: t('xbarBarOver') },
        ]} />
        <Toggle label={t('xbarEmptySpecs')} checked={b.xbar.emptySpecs} onChange={(v) => setBuild({ xbar: { emptySpecs: v } })} />
        <Toggle label={t('xbarExpand')} checked={b.xbar.expandWords} onChange={(v) => setBuild({ xbar: { expandWords: v } })} />
      </>
    );
  }
  if (b.mode === 'bps') {
    return (
      <Seg label={t('bpsLabel')} small value={b.bps.label} onChange={(v) => setBuild({ bps: { label: v } })} options={[
        { v: 'category', label: t('bpsCategory') },
        { v: 'head', label: t('bpsHead') },
        { v: 'set', label: t('bpsSet') },
      ]} />
    );
  }
  return <p class="hint">{t('modeManualHint')}</p>;
}

export function SettingsPanel() {
  const s = style.value;
  const b = build.value;
  const applyPreset = (p: PresetId) => setStyle(presets[p]);
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
          <button class="preset preset-reset" onClick={() => (style.value = { ...defaultStyle })}>
            <strong>{t('reset')}</strong>
            <small>&nbsp;</small>
          </button>
        </div>
      </Section>

      <Section title={t('labelling')}>
        <Seg value={b.mode} onChange={(v) => setBuild({ mode: v })} options={[
          { v: 'manual', label: t('modeManual'), title: t('modeManualHint') },
          { v: 'xbar', label: t('modeXbar'), title: t('modeXbarHint') },
          { v: 'bps', label: t('modeBps'), title: t('modeBpsHint') },
        ]} />
        <ModeOptions />
      </Section>

      <Section title={t('display')}>
        <Seg label={t('mdShared')} small value={b.multidominance} onChange={(v) => setBuild({ multidominance: v })} options={[
          { v: 'shared', label: t('mdSharedOpt') },
          { v: 'copies', label: t('mdCopies') },
        ]} />
        <Toggle label={t('autoArrows')} checked={b.autoArrows} onChange={(v) => setBuild({ autoArrows: v })} />
        <Toggle label={t('showEmpty')} checked={b.showEmpty} onChange={(v) => setBuild({ showEmpty: v })} />
        <Toggle label={t('bindingCheck')} checked={bindingCheck.value} onChange={(v) => (bindingCheck.value = v)} />
      </Section>

      <Section title={t('typography')}>
        <Select<FontId> label={t('font')} value={s.font} onChange={(v) => setStyle({ font: v })} options={(Object.keys(FONT_FAMILIES) as FontId[]).map((f) => ({ v: f, label: FONT_FAMILIES[f].name }))} />
        <Slider label={t('fontSize')} value={s.fontSize} min={9} max={40} unit="px" onInput={(v) => setStyle({ fontSize: v })} />
        <Toggle label={t('leafItalic')} checked={s.leafItalic} onChange={(v) => setStyle({ leafItalic: v })} />
        <Toggle label={t('nodeBold')} checked={s.nodeBold} onChange={(v) => setStyle({ nodeBold: v })} />
        <Seg label={t('copyStyle')} small value={s.copyStyle} onChange={(v) => setStyle({ copyStyle: v })} options={[
          { v: 'grey', label: t('copyGrey') },
          { v: 'strike', label: t('copyStrike') },
          { v: 'angle', label: t('copyAngle') },
        ]} />
      </Section>

      <Section title={t('layout')}>
        <Slider label={t('levelGap')} value={s.levelGap} min={6} max={90} unit="px" onInput={(v) => setStyle({ levelGap: v })} />
        <Slider label={t('siblingGap')} value={s.siblingGap} min={4} max={80} unit="px" onInput={(v) => setStyle({ siblingGap: v })} />
        <Slider label={t('padding')} value={s.padding} min={0} max={80} unit="px" onInput={(v) => setStyle({ padding: v })} />
        <Toggle label={t('leavesAtBottom')} checked={s.leavesAtBottom} onChange={(v) => setStyle({ leavesAtBottom: v })} />
      </Section>

      <Section title={t('lines')}>
        <Slider label={t('lineWidth')} value={s.lineWidth} min={0.4} max={4} step={0.1} unit="px" onInput={(v) => setStyle({ lineWidth: v })} />
        <div class="colors">
          <ColorField label={t('lineColor')} value={s.lineColor} onChange={(v) => setStyle({ lineColor: v })} />
          <ColorField label={t('nodeColor')} value={s.nodeColor} onChange={(v) => setStyle({ nodeColor: v })} />
          <ColorField label={t('leafColor')} value={s.leafColor} onChange={(v) => setStyle({ leafColor: v })} />
          <ColorField label={t('arrowColor')} value={s.arrowColor} onChange={(v) => setStyle({ arrowColor: v })} />
          <ColorField label={t('background')} value={s.background === 'transparent' ? '#ffffff' : s.background} onChange={(v) => setStyle({ background: v })} />
        </div>
        <Toggle label={t('handDrawn')} checked={s.handDrawn} onChange={(v) => setStyle({ handDrawn: v })} />
      </Section>
    </div>
  );
}
