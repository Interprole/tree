import { useSignal, useSignalEffect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import * as A from '../actions';
import { lineCol } from '../core/parser';
import { examples } from '../examples';
import { copyText } from '../export';
import { t } from '../i18n';
import {
  activateTree, activeId, addTree, arrowSource, build, duplicateTree, error, linkedIds, linkTree, loadExample, mobileTab, modal, paneWidths, pick, relationOf, removeTree, renameTree, requestLabelFocus, scene, selection, setBuild, shareUrl, showToast, sideTab, source, theme, toast, tool, tree, trees, unlinkTree,
} from '../state';
import { Canvas, canvasApi } from './Canvas';
import { Seg } from './controls';
import { Help, MyTrees, Shortcuts } from './Dialogs';
import { Editor } from './Editor';
import { ExportDialog } from './ExportDialog';
import { IAuto, IBook, IChevron, IHelp, IDownload, IEdit, IFolder, IFormat, IKeyboard, ILink, IMoon, IMore, IPlus, IRedo, ISliders, ISun, IUndo, IClose } from './icons';
import { Inspector } from './Inspector';
import { autoSaveFile, canWriteFiles, fileHandle, fileName, loadFile, openFromDisk, saveToDisk, unsaved } from '../files';
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
  // copy and paste of nodes (when the keyboard is not in the code or a field)
  useEffect(() => {
    let sister = false;
    const busy = (e: Event) => modal.value !== null || isTyping(e as KeyboardEvent);
    const onCopy = (e: ClipboardEvent) => {
      if (busy(e) || selection.value?.kind !== 'node') return;
      const c = A.copyNode();
      if (!c) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', A.clipText(c));
      if (e.type === 'cut') A.deleteNode();
      else showToast('Copied: Ctrl+V pastes it as a daughter, Ctrl+Shift+V as a sister, or as a new tree when nothing is selected.');
    };
    const onPaste = (e: ClipboardEvent) => {
      if (busy(e)) return;
      const c = A.clipFromText(e.clipboardData?.getData('text/plain') ?? '') ?? A.clip.value;
      if (!c) return;
      e.preventDefault();
      A.paste(c, A.selectedNode(), sister ? 'sister' : 'daughter');
      sister = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') sister = e.shiftKey;
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCopy);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCopy);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
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
      // files: also while typing in the code (instead of the browser saving the page)
      if (mod && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveToDisk(e.shiftKey);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFromDisk();
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
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'd' && selection.value?.kind === 'node') {
        e.preventDefault();
        A.duplicateNode();
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
          requestLabelFocus(sel.key);
          break;
        case 'p':
          handled();
          A.addMother();
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

/** Saving to and opening from disk, and the trees kept in this browser. */
function FileMenu() {
  const open = useSignal(false);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.file-menu')) open.value = false;
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const run = (f: () => void) => () => {
    open.value = false;
    f();
  };
  const name = fileName.value;
  return (
    <div class="file-menu menu">
      <button class="btn ghost" aria-haspopup="true" aria-expanded={open.value} onClick={() => (open.value = !open.value)} title={name ? `File: ${name}${unsaved.value ? ' (unsaved changes)' : ''}` : 'Save to disk, open, my trees'} data-testid="file-menu">
        <IFolder size={17} /> <span class="hide-md file-label">{name ?? 'File'}</span>
        {unsaved.value && <span class="unsaved-dot" title="Unsaved changes" />}
        <IChevron size={14} />
      </button>
      {open.value && (
        <div class="menu-pop file-pop" role="menu">
          <button role="menuitem" onClick={run(() => void saveToDisk())}>
            <strong>Save to disk <kbd>Ctrl S</kbd></strong>
            <small>{fileHandle.value ? `Into ${fileHandle.value.name}` : `All trees of the canvas in one ${canWriteFiles() ? 'file' : 'file (downloaded)'}.`}</small>
          </button>
          <button role="menuitem" onClick={run(() => void saveToDisk(true))}>
            <strong>Save as… <kbd>Ctrl Shift S</kbd></strong>
            <small>A new file.</small>
          </button>
          <button role="menuitem" onClick={run(() => void openFromDisk())}>
            <strong>Open from disk… <kbd>Ctrl O</kbd></strong>
            <small>A saved .nanotrees file, or bracket code (.txt). You can also drop a file onto the window.</small>
          </button>
          {fileHandle.value && (
            <label class="menu-toggle">
              <input type="checkbox" checked={autoSaveFile.value} onChange={(e) => (autoSaveFile.value = (e.target as HTMLInputElement).checked)} />
              <span>
                <strong>Keep {fileHandle.value.name} up to date</strong>
                <small>Every change is written into the file.</small>
              </span>
            </label>
          )}
          <button role="menuitem" onClick={run(() => (modal.value = 'trees'))}>
            <strong>{t('myTrees')}…</strong>
            <small>Trees kept in this browser.</small>
          </button>
          {location.protocol !== 'file:' && (
            <a role="menuitem" class="menu-link" href="nanotrees.html" download="nanotrees.html" onClick={() => (open.value = false)}>
              <strong>NanoTrees for offline use</strong>
              <small>The whole app in one file (≈ 11 MB): open it by double-click, without the internet.</small>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Tabs of the trees on the canvas, with copying and linking. */
function TreeTabs() {
  const menu = useSignal<string | null>(null);
  /** the menu is placed over everything (the strip of tabs scrolls and would cut it off) */
  const menuAt = useSignal<{ left: number; top: number }>({ left: 0, top: 0 });
  const editing = useSignal<string | null>(null);
  const linked = linkedIds.value;
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.tree-tabs')) menu.value = null;
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  const list = trees.value;
  return (
    <div class="tree-tabs" role="tablist" aria-label="Trees on the canvas">
      {list.map((e) => (
        <div key={e.id} class={`tree-tab ${e.id === activeId.value ? 'on' : ''}`} role="tab" aria-selected={e.id === activeId.value}>
          {editing.value === e.id ? (
            <input
              class="tab-rename"
              defaultValue={e.name}
              ref={(el) => {
                if (el && document.activeElement !== el) {
                  el.focus();
                  el.select();
                }
              }}
              onKeyDown={(ev) => {
                ev.stopPropagation();
                if (ev.key === 'Enter') (ev.currentTarget as HTMLInputElement).blur();
                if (ev.key === 'Escape') editing.value = null;
              }}
              onBlur={(ev) => {
                if (editing.value === e.id) renameTree(e.id, (ev.currentTarget as HTMLInputElement).value);
                editing.value = null;
              }}
            />
          ) : (
            <button class="tab-name" onClick={() => activateTree(e.id)} onDblClick={() => (editing.value = e.id)} title={linked.has(e.id) ? 'Linked copy: shares its code with another tree. Double-click to rename.' : 'Double-click to rename'}>
              {e.name}
              {linked.has(e.id) && <span class="link-mark"><ILink size={11} /></span>}
            </button>
          )}
          <button
            class="tab-more"
            aria-label={`More for ${e.name}`}
            title="Copy, link, rename, delete"
            onClick={(ev) => {
              const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
              menuAt.value = { left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), top: r.bottom + 4 };
              menu.value = menu.value === e.id ? null : e.id;
            }}
          >
            <IMore size={14} />
          </button>
          {menu.value === e.id && (
            <div class="menu-pop tab-menu" role="menu" style={{ left: `${menuAt.value.left}px`, top: `${menuAt.value.top}px` }}>
              <button role="menuitem" onClick={() => ((menu.value = null), duplicateTree(e.id, false))}>
                <strong>Copy</strong>
                <small>An independent copy: change it without touching this one.</small>
              </button>
              <button role="menuitem" onClick={() => ((menu.value = null), duplicateTree(e.id, true))}>
                <strong>Linked copy</strong>
                <small>Shares the code: an edit in one changes both. Settings (copies / traces, colours, fonts) stay separate.</small>
              </button>
              {linked.has(e.id) && (
                <button role="menuitem" onClick={() => ((menu.value = null), unlinkTree(e.id))}>
                  <strong>Unlink</strong>
                  <small>Give this tree its own code again.</small>
                </button>
              )}
              {list
                .filter((o) => o.id !== e.id && o.srcId !== e.srcId)
                .map((o) => (
                  <button key={o.id} role="menuitem" onClick={() => ((menu.value = null), linkTree(e.id, o.id))}>
                    <strong>Link to {o.name}</strong>
                    <small>Take over the code of {o.name} and keep it shared.</small>
                  </button>
                ))}
              <button role="menuitem" onClick={() => ((menu.value = null), (editing.value = e.id))}>
                <strong>Rename</strong>
              </button>
              {list.length > 1 && (
                <button role="menuitem" class="danger" onClick={() => ((menu.value = null), confirm(`Delete “${e.name}” from the canvas?`) && removeTree(e.id))}>
                  <strong>Delete from the canvas</strong>
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <button class="icon-btn small add-tree" title="New tree on the canvas" aria-label="New tree" onClick={() => addTree()}>
        <IPlus size={15} />
      </button>
    </div>
  );
}

/** A draggable border that changes the width of a pane. */
function Splitter({ side, onDrag, onReset, label }: { side: 'left' | 'right'; onDrag: (dx: number, start: number) => void; onReset: () => void; label: string }) {
  return (
    <div
      class={`splitter splitter-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} (double-click: default)`}
      onDblClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const pane = el.parentElement!;
        const start = pane.getBoundingClientRect().width;
        const x0 = e.clientX;
        document.body.classList.add('resizing');
        const move = (ev: PointerEvent) => onDrag(ev.clientX - x0, start);
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          document.body.classList.remove('resizing');
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    />
  );
}

const clampW = (w: number, min: number) => Math.round(Math.min(Math.max(w, min), window.innerWidth * 0.6));

export function App() {
  useTheme();
  useShortcuts();
  // picking something on the tree brings the editing back
  useSignalEffect(() => {
    if (selection.value) sideTab.value = 'edit';
  });
  /** on narrow screens the right panel is a sheet, shown only when it has something to show */
  const sideOpen = sideTab.value === 'appearance' || !!selection.value;
  const b = build.value;
  const th = theme.value;
  const nextTheme = th === 'auto' ? 'light' : th === 'light' ? 'dark' : 'auto';
  const share = async () => {
    const url = shareUrl();
    history.replaceState(null, '', url);
    if (await copyText(url)) showToast(url.length > 2000 ? t('shareTooLong', { n: url.length }) : t('shareCopied'));
  };
  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = e.dataTransfer?.files?.[0];
        if (!f) return;
        e.preventDefault();
        void loadFile(f);
      }}
      class={`app side-${sideTab.value} ${selection.value ? 'has-selection' : ''} ${sideOpen ? 'side-open' : ''} tab-${mobileTab.value}`}
      style={{
        '--code-w': paneWidths.value.code ? `${paneWidths.value.code}px` : 'minmax(300px, 30%)',
        '--side-w': `${paneWidths.value.inspector}px`,
      }}
    >
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
          <FileMenu />
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
          <button
            class={`icon-btn panel-toggle ${sideTab.value === 'appearance' ? 'active' : ''}`}
            title={`${t('settings')} (the right panel: Edit / Appearance)`}
            aria-label={t('settings')}
            aria-pressed={sideTab.value === 'appearance'}
            onClick={() => (sideTab.value = sideTab.value === 'appearance' ? 'edit' : 'appearance')}
            data-testid="settings-toggle"
          >
            <ISliders />
          </button>
        </div>
      </header>

      <main class="workspace">
        <section class="pane code-pane" aria-label={t('code')}>
          <TreeTabs />
          <div class="editor-wrap">
            <Editor />
            <button class="icon-btn small format-btn" title="Lay out the code: line breaks and indentation (Shift+Alt+F)" aria-label="Format the code" onClick={() => A.formatCode()}>
              <IFormat size={15} />
            </button>
          </div>
          <StatusBar />
          <div class="mode-options">
            <ModeOptions />
            <ChainOptions />
          </div>
          <Splitter side="right" label="Width of the code" onReset={() => (paneWidths.value = { ...paneWidths.value, code: null })} onDrag={(dx, w0) => (paneWidths.value = { ...paneWidths.value, code: clampW(w0 + dx, 220) })} />
        </section>
        <section class="pane canvas-pane" aria-label={t('tree')}>
          <Canvas />
        </section>
        <aside class="pane side-pane" aria-label="Edit and appearance">
          <Splitter side="left" label="Width of the right panel" onReset={() => (paneWidths.value = { ...paneWidths.value, inspector: 320 })} onDrag={(dx, w0) => (paneWidths.value = { ...paneWidths.value, inspector: clampW(w0 - dx, 240) })} />
          <div class="side-tabs" role="tablist" aria-label="Right panel">
            <button role="tab" aria-selected={sideTab.value === 'edit'} class={sideTab.value === 'edit' ? 'on' : ''} onClick={() => (sideTab.value = 'edit')} data-testid="side-edit">
              <IEdit size={15} /> Edit
            </button>
            <button role="tab" aria-selected={sideTab.value === 'appearance'} class={sideTab.value === 'appearance' ? 'on' : ''} onClick={() => (sideTab.value = 'appearance')} data-testid="side-appearance">
              <ISliders size={15} /> {t('settings')}
            </button>
            <button
              class="icon-btn small side-close"
              title="Close"
              aria-label="Close the panel"
              onClick={() => {
                selection.value = null;
                sideTab.value = 'edit';
              }}
            >
              <IClose size={14} />
            </button>
          </div>
          <div class="side-body">{sideTab.value === 'edit' ? <Inspector /> : <SettingsPanel />}</div>
        </aside>
      </main>

      <nav class="mobile-tabs" role="tablist">
        {(['code', 'tree', 'settings'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={mobileTab.value === k}
            class={mobileTab.value === k ? 'on' : ''}
            onClick={() => {
              mobileTab.value = k;
              if (k === 'settings') sideTab.value = 'appearance';
              else if (k === 'tree') sideTab.value = 'edit';
            }}
          >
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
