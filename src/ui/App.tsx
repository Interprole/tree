import { useSignal, useSignalEffect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import * as A from '../actions';
import { lineCol } from '../core/parser';
import { examples } from '../examples';
import { copyText } from '../export';
import { t } from '../i18n';
import {
  arrowSource, build, error, loadExample, mobileTab, modal, panelOpen, pick, relationOf, scene, selection, setBuild, shareUrl, showToast, source, theme, toast, tool, tree,
} from '../state';
import { Canvas, canvasApi } from './Canvas';
import { Seg } from './controls';
import { Help, MyTrees, Shortcuts } from './Dialogs';
import { Editor } from './Editor';
import { ExportDialog } from './ExportDialog';
import { IAuto, IBook, IChevron, IHelp, IDownload, IFolder, IKeyboard, ILink, IMoon, IRedo, ISliders, ISun, IUndo, IClose } from './icons';
import { ChainOptions, ModeOptions, SettingsPanel } from './SettingsPanel';

function useTheme() {
  useSignalEffect(() => {
    const th = theme.value;
    const apply = () => {
      const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.closest('.cm-editor');
}

/** Arrow-key navigation in the tree. */
function navigate(dir: 'up' | 'down' | 'left' | 'right') {
  const n = A.selectedNode();
  const tr = tree.value;
  if (!tr) return;
  if (!n) {
    selection.value = { kind: 'node', key: tr.root.key };
    return;
  }
  let next = null;
  if (dir === 'up') next = n.parents[0] ?? null;
  else if (dir === 'down') next = n.children[0] ?? null;
  else {
    const p = n.parents[0];
    if (p) {
      const i = p.children.indexOf(n);
      next = p.children[i + (dir === 'left' ? -1 : 1)] ?? null;
    }
  }
  if (next) selection.value = { kind: 'node', key: next.key };
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (modal.value) modal.value = null;
        else if (pick.value) pick.value = null;
        else if (tool.value !== 'select') {
          tool.value = 'select';
          arrowSource.value = null;
          relationOf.value = null;
        } else selection.value = null;
        return;
      }
      if (isTyping(e) || modal.value) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) A.redo();
        else A.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        A.redo();
        return;
      }
      if (mod || e.altKey) return;
      const sel = selection.value;
      const key = e.key;
      const handled = () => e.preventDefault();
      if (key === '?') return handled(), (modal.value = 'shortcuts');
      if (key === '+' || key === '=') return handled(), canvasApi.zoomIn?.();
      if (key === '-' || key === '_') return handled(), canvasApi.zoomOut?.();
      if (key === '0' || key === 'f') return handled(), canvasApi.fit?.();
      if (key === 'v') return handled(), (tool.value = 'select');
      if (key === 'w') return handled(), (tool.value = 'arrow');
      if (key === 'c') return handled(), ((tool.value = 'ccommand'), (relationOf.value = sel?.kind === 'node' ? sel.key : null));
      if (key === 'd') return handled(), ((tool.value = 'dominance'), (relationOf.value = sel?.kind === 'node' ? sel.key : null));
      if (sel?.kind === 'arrow' && (key === 'Delete' || key === 'Backspace')) return handled(), A.deleteArrow();
      if (sel?.kind !== 'node') {
        if (key.startsWith('Arrow')) return handled(), navigate('down');
        return;
      }
      switch (key) {
        case 'Enter':
        case 'F2':
          handled();
          canvasApi.rename?.();
          break;
        case 'Delete':
        case 'Backspace':
          handled();
          A.deleteNode();
          break;
        case 'a':
          handled();
          A.addChild();
          break;
        case 's':
          handled();
          A.addSister();
          break;
        case 't':
          handled();
          A.toggleTriangle();
          break;
        case 'h':
          handled();
          A.toggleHead();
          break;
        case 'm':
          handled();
          A.startArrow();
          break;
        case 'ArrowUp':
          handled();
          navigate('up');
          break;
        case 'ArrowDown':
          handled();
          navigate('down');
          break;
        case 'ArrowLeft':
          handled();
          navigate('left');
          break;
        case 'ArrowRight':
          handled();
          navigate('right');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function ExamplesMenu() {
  const open = useSignal(false);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.examples')) open.value = false;
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  return (
    <div class="examples menu">
      <button class="btn ghost" aria-haspopup="true" aria-expanded={open.value} onClick={() => (open.value = !open.value)} data-testid="examples-button">
        <IBook size={17} /> <span class="hide-sm">{t('examples')}</span> <IChevron size={14} />
      </button>
      {open.value && (
        <div class="menu-pop" role="menu">
          {examples.map((ex) => (
            <button
              key={ex.id}
              role="menuitem"
              data-example={ex.id}
              onClick={() => {
                loadExample(ex);
                open.value = false;
              }}
            >
              <strong>{ex.title}</strong>
              <small>{ex.note}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBar() {
  const e = error.value;
  const tr = tree.value;
  if (e) {
    const lc = lineCol(source.value, e.from);
    return (
      <div class="status error" role="status" onClick={() => A.revealInCode(e.from, e.to)}>
        <span class="dot" />
        <span>
          <strong>{t('errorAt', lc)}:</strong> {e.message} <em>— {t('showingLastGood')}</em>
        </span>
      </div>
    );
  }
  return (
    <div class="status ok" role="status">
      <span class="dot" />
      {tr ? t('nodes', { n: tr.nodes.length }) : t('emptyDoc')}
    </div>
  );
}

export function App() {
  useTheme();
  useShortcuts();
  const b = build.value;
  const th = theme.value;
  const nextTheme = th === 'auto' ? 'light' : th === 'light' ? 'dark' : 'auto';
  const share = async () => {
    const url = shareUrl();
    history.replaceState(null, '', url);
    if (await copyText(url)) showToast(url.length > 2000 ? t('shareTooLong', { n: url.length }) : t('shareCopied'));
  };
  return (
    <div class={`app ${panelOpen.value ? 'panel-open' : ''} tab-${mobileTab.value}`}>
      <header class="topbar">
        <div class="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <g stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none">
              <path d="M16 8 7 25M16 8l9 17M20.5 16.5 16 25" />
            </g>
            <circle cx="16" cy="6.5" r="3" fill="var(--accent)" />
          </svg>
          <div>
            <h1>NanoTrees</h1>
            <span class="tagline hide-sm">{t('appTagline')} · by Gleb Bubnov</span>
          </div>
        </div>
        <ExamplesMenu />
        <div class="mode-switch hide-xs" title="Labelling">
          <Seg value={b.mode} onChange={(v) => setBuild({ mode: v })} options={[
            { v: 'manual', label: t('modeManual'), title: t('modeManualHint') },
            { v: 'xbar', label: t('modeXbar'), title: t('modeXbarHint') },
            { v: 'bps', label: t('modeBps'), title: t('modeBpsHint') },
          ]} />
        </div>
        <div class="mode-switch chain-switch hide-md" title="Movement chains">
          <Seg value={b.chains} onChange={(v) => setBuild({ chains: v })} options={[
            { v: 'copies', label: 'Copies', title: 'Chains drawn with copies' },
            { v: 'traces', label: 'Traces', title: 'Chains drawn with traces' },
            { v: 'multidominance', label: 'MD', title: 'Chains drawn as multidominance' },
          ]} />
        </div>
        <div class="spacer" />
        <div class="actions">
          <button class="icon-btn" title={`${t('undo')} (Ctrl+Z)`} aria-label={t('undo')} onClick={() => A.undo()}>
            <IUndo />
          </button>
          <button class="icon-btn" title={`${t('redo')} (Ctrl+Shift+Z)`} aria-label={t('redo')} onClick={() => A.redo()}>
            <IRedo />
          </button>
          <span class="sep hide-xs" />
          <button class="btn ghost" onClick={() => (modal.value = 'trees')} title={t('myTrees')}>
            <IFolder size={17} /> <span class="hide-md">{t('myTrees')}</span>
          </button>
          <button class="btn ghost" onClick={share} title={t('share')} data-testid="share">
            <ILink size={17} /> <span class="hide-md">{t('share')}</span>
          </button>
          <button class="btn primary" onClick={() => (modal.value = 'export')} disabled={!scene.value} data-testid="export">
            <IDownload size={17} /> <span class="hide-sm">{t('export')}</span>
          </button>
          <span class="sep hide-xs" />
          <button class="btn ghost" title="Guide: how to write and edit trees" aria-label="Guide" onClick={() => (modal.value = 'help')} data-testid="guide">
            <IHelp size={17} /> <span class="hide-sm">Guide</span>
          </button>
          <button class="icon-btn hide-sm" title={t('shortcuts')} aria-label={t('shortcuts')} onClick={() => (modal.value = 'shortcuts')}>
            <IKeyboard />
          </button>
          <button class="icon-btn" title={`${t('theme')}: ${t(th === 'auto' ? 'themeAuto' : th === 'light' ? 'themeLight' : 'themeDark')}`} aria-label={t('theme')} onClick={() => (theme.value = nextTheme)}>
            {th === 'auto' ? <IAuto /> : th === 'light' ? <ISun /> : <IMoon />}
          </button>
          <button class={`icon-btn panel-toggle ${panelOpen.value ? 'active' : ''}`} title={t('settings')} aria-label={t('settings')} aria-pressed={panelOpen.value} onClick={() => (panelOpen.value = !panelOpen.value)} data-testid="settings-toggle">
            <ISliders />
          </button>
        </div>
      </header>

      <main class="workspace">
        <section class="pane code-pane" aria-label={t('code')}>
          <Editor />
          <StatusBar />
          <div class="mode-options">
            <ModeOptions />
            <ChainOptions />
          </div>
        </section>
        <section class="pane canvas-pane" aria-label={t('tree')}>
          <Canvas />
        </section>
        <aside class="pane settings-pane" aria-label={t('settings')}>
          <div class="settings-head">
            <h2>{t('settings')}</h2>
            <button class="icon-btn hide-mobile" aria-label={t('close')} onClick={() => (panelOpen.value = false)}>
              <IClose />
            </button>
          </div>
          <SettingsPanel />
        </aside>
      </main>

      <nav class="mobile-tabs" role="tablist">
        {(['code', 'tree', 'settings'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={mobileTab.value === k} class={mobileTab.value === k ? 'on' : ''} onClick={() => (mobileTab.value = k)}>
            {k === 'code' ? t('code') : k === 'tree' ? t('tree') : t('settings')}
            {k === 'code' && error.value && <span class="err-dot" />}
          </button>
        ))}
      </nav>

      {modal.value === 'export' && <ExportDialog />}
      {modal.value === 'trees' && <MyTrees />}
      {modal.value === 'help' && <Help />}
      {modal.value === 'shortcuts' && <Shortcuts />}
      {toast.value && (
        <div class="toast" role="status" key={toast.value.id}>
          {toast.value.text}
        </div>
      )}
    </div>
  );
}
