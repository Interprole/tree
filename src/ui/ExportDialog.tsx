import { useSignal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { exportLatex } from '../core/latex';
import type { LatexFormat } from '../core/latex';
import { serialize } from '../core/serialize';
import { copyImage, copyText, download, fileBase, pdfBlob, pngBlob, svgString } from '../export';
import { t } from '../i18n';
import { currentName, modal, scene, showToast, source, style, tree } from '../state';
import { Modal, Seg, Toggle } from './controls';
import { ICopy, IDownload } from './icons';

export function ExportDialog() {
  const tab = useSignal<'image' | 'latex'>('image');
  const scale = useSignal(3);
  const transparent = useSignal(false);
  const embed = useSignal(true);
  const format = useSignal<LatexFormat>('forest');
  const standalone = useSignal(false);
  const busy = useSignal(false);
  const sc = scene.value;
  const tr = tree.value;
  const close = () => (modal.value = null);
  const base = fileBase(sc, currentName.value);

  const latex = useMemo(() => (sc && tr ? exportLatex(tr, sc, style.value, { format: format.value, standalone: standalone.value }) : ''), [sc, tr, format.value, standalone.value]);

  const run = async (f: () => Promise<void>) => {
    if (!sc) return;
    busy.value = true;
    try {
      await f();
    } catch (e) {
      showToast(String((e as Error).message ?? e));
    } finally {
      busy.value = false;
    }
  };

  const hasMd = tr?.nodes.some((n) => n.parents.length > 1);

  return (
    <Modal title={t('exportTitle')} onClose={close} wide>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab.value === 'image'} class={tab.value === 'image' ? 'on' : ''} onClick={() => (tab.value = 'image')}>
          {t('image')}
        </button>
        <button role="tab" aria-selected={tab.value === 'latex'} class={tab.value === 'latex' ? 'on' : ''} onClick={() => (tab.value = 'latex')}>
          {t('latex')}
        </button>
      </div>
      {!sc && <p class="hint">{t('emptyDoc')}</p>}
      {sc && tab.value === 'image' && (
        <div class="export-image">
          <div class="export-grid">
            <div class="card">
              <h4>SVG</h4>
              <Toggle label={t('embedFonts')} checked={embed.value} onChange={(v) => (embed.value = v)} />
              <button class="btn primary" disabled={busy.value} onClick={() => run(async () => download(await svgString(sc, { embedFonts: embed.value, transparent: transparent.value }), base + '.svg', 'image/svg+xml'))}>
                <IDownload size={16} /> {t('downloadSvg')}
              </button>
              <button class="btn" disabled={busy.value} onClick={() => run(async () => { if (await copyText(await svgString(sc, { embedFonts: embed.value, transparent: transparent.value }))) showToast(t('copied')); })}>
                <ICopy size={16} /> {t('copySvg')}
              </button>
            </div>
            <div class="card">
              <h4>PNG</h4>
              <Seg label={t('scale')} small value={String(scale.value)} onChange={(v) => (scale.value = Number(v))} options={[1, 2, 3, 4, 6].map((x) => ({ v: String(x), label: `${x}× · ${Math.round(x * 96)} dpi` }))} />
              <p class="hint">
                {Math.ceil(sc.width * scale.value)} × {Math.ceil(sc.height * scale.value)} px
              </p>
              <button class="btn primary" disabled={busy.value} onClick={() => run(async () => download(await pngBlob(sc, scale.value, transparent.value), base + '.png'))}>
                <IDownload size={16} /> {t('downloadPng')}
              </button>
              <button class="btn" disabled={busy.value} onClick={() => run(async () => showToast((await copyImage(sc, scale.value)) ? t('copied') : 'Clipboard not available'))}>
                <ICopy size={16} /> {t('copyImage')}
              </button>
            </div>
            <div class="card">
              <h4>PDF</h4>
              <p class="hint">Vector, fonts embedded</p>
              <button class="btn primary" disabled={busy.value} onClick={() => run(async () => download(await pdfBlob(sc, transparent.value), base + '.pdf'))}>
                <IDownload size={16} /> {t('downloadPdf')}
              </button>
            </div>
          </div>
          <Toggle label={t('transparent')} checked={transparent.value} onChange={(v) => (transparent.value = v)} />
          <div class="row wrap">
            <button class="btn" onClick={async () => (await copyText(source.value)) && showToast(t('copied'))}>
              <ICopy size={16} /> {t('copyBrackets')}
            </button>
            {tr && (
              <button class="btn" onClick={async () => (await copyText(serialize(tr))) && showToast(t('copied'))}>
                <ICopy size={16} /> {t('copyBracketsShown')}
              </button>
            )}
          </div>
          {busy.value && <p class="hint">{t('exporting')}</p>}
        </div>
      )}
      {sc && tab.value === 'latex' && (
        <div class="export-latex">
          <div class="row wrap">
            <Seg label={t('latexFormat')} small value={format.value} onChange={(v) => (format.value = v)} options={[
              { v: 'forest', label: t('latexForest') },
              { v: 'qtree', label: t('latexQtree') },
              { v: 'tikz', label: t('latexTikz') },
            ]} />
            <Toggle label={t('standalone')} checked={standalone.value} onChange={(v) => (standalone.value = v)} />
          </div>
          <textarea class="code" readOnly value={latex} spellcheck={false} aria-label="LaTeX code" />
          <div class="row wrap">
            <button class="btn primary" onClick={async () => (await copyText(latex)) && showToast(t('copied'))}>
              <ICopy size={16} /> {t('copy')}
            </button>
            <button class="btn" onClick={() => download(exportLatex(tr!, sc, style.value, { format: format.value, standalone: true }), base + '.tex', 'application/x-tex')}>
              <IDownload size={16} /> {t('downloadTex')}
            </button>
          </div>
          <p class="hint">{t('latexNote')}</p>
          {!standalone.value && format.value === 'forest' && <p class="hint">Preamble: <code>\usepackage[linguistics]{'{'}forest{'}'}</code>, <code>\usetikzlibrary{'{'}arrows.meta, calc{'}'}</code>, <code>amssymb</code>, <code>xcolor</code>.</p>}
          {hasMd && format.value === 'forest' && <p class="hint">{t('latexMdNote')}</p>}
        </div>
      )}
    </Modal>
  );
}
