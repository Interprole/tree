import { GUIDE } from './Guide';
import { useSignal } from '@preact/signals';
import { t } from '../i18n';
import { currentName, deleteTree, modal, openTree, savedTrees, saveTree } from '../state';
import { Modal } from './controls';
import { ISave, ITrash } from './icons';

export function MyTrees() {
  const name = useSignal(currentName.value ?? '');
  const close = () => (modal.value = null);
  const fmt = (ms: number) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Modal title={t('myTrees')} onClose={close}>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          saveTree(name.value.trim() || t('untitled'));
        }}
      >
        <input class="grow" placeholder={t('treeName')} value={name.value} onInput={(e) => (name.value = (e.target as HTMLInputElement).value)} aria-label={t('treeName')} />
        <button class="btn primary" type="submit">
          <ISave size={16} /> {t('saveCurrent')}
        </button>
      </form>
      {savedTrees.value.length === 0 ? (
        <p class="hint">{t('noTrees')}</p>
      ) : (
        <ul class="tree-list">
          {savedTrees.value.map((tr) => (
            <li key={tr.id} class={tr.name === currentName.value ? 'current' : ''}>
              <button
                class="open"
                onClick={() => {
                  openTree(tr);
                  close();
                }}
              >
                <strong>{tr.name}</strong>
                <code>{tr.snap.s.replace(/%.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 80)}</code>
                <small>{t('savedAt', { date: fmt(tr.savedAt) })}</small>
              </button>
              <button class="icon-btn danger" aria-label={t('delete')} title={t('delete')} onClick={() => confirm(t('confirmDelete', { name: tr.name })) && deleteTree(tr.id)}>
                <ITrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function Help() {
  const current = useSignal(GUIDE[0].id);
  const sec = GUIDE.find((g) => g.id === current.value) ?? GUIDE[0];
  return (
    <Modal title="Guide" onClose={() => (modal.value = null)} wide>
      <div class="guide">
        <nav class="guide-nav">
          {GUIDE.map((g) => (
            <button key={g.id} class={g.id === sec.id ? 'on' : ''} onClick={() => (current.value = g.id)}>
              {g.title}
            </button>
          ))}
        </nav>
        <article class="guide-body">
          <h3>{sec.title}</h3>
          {sec.body()}
        </article>
      </div>
    </Modal>
  );
}

const KEYS: [string, string][] = [
  ['Ctrl/⌘ Z', 'Undo'],
  ['Ctrl/⌘ Shift Z, Ctrl Y', 'Redo'],
  ['Ctrl/⌘ S', 'Save to disk (Shift: save as)'],
  ['Ctrl/⌘ O', 'Open from disk'],
  ['Click', 'Select a node (also selects it in the code)'],
  ['Double-click, Enter, F2', 'Rename'],
  ['A', 'Add a daughter'],
  ['S', 'Add a sister'],
  ['P', 'Add a mother'],
  ['Ctrl/⌘ C · X · V', 'Copy, cut, paste a node (V: as a daughter; with nothing selected: a new tree)'],
  ['Ctrl/⌘ Shift V', 'Paste as a sister'],
  ['Ctrl/⌘ D', 'Duplicate the node'],
  ['Delete, Backspace', 'Delete the node or arrow'],
  ['T', 'Triangle on/off'],
  ['M', 'Arrow from the selected node'],
  ['← → ↑ ↓', 'Move between sisters / mother / daughter'],
  ['V · W', 'Tools: select, arrow'],
  ['+ − 0', 'Zoom in / out / fit'],
  ['Shift Alt F', 'Lay out the code (in the code editor)'],
  ['Shift-drag / Alt-drag a node', 'Independent copy / linked copy'],
  ['Double-click an arrow', 'Add a bend point'],
  ['Esc', 'Cancel, deselect'],
  ['?', 'Shortcuts'],
];

function KeysTable() {
  return (
    <table class="keys">
      <tbody>
        {KEYS.map(([k, e]) => (
          <tr key={k}>
            <td>
              {k.split(/(\s+|·|,)/).map((p, i) => (p.trim() && p !== '·' && p !== ',' ? <kbd key={i}>{p}</kbd> : <span key={i}>{p}</span>))}
            </td>
            <td>{e}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Shortcuts() {
  return (
    <Modal title={t('shortcuts')} onClose={() => (modal.value = null)}>
      <KeysTable />
    </Modal>
  );
}
