import { useSignal } from '@preact/signals';
import { lang, t } from '../i18n';
import { currentName, deleteTree, modal, openTree, savedTrees, saveTree } from '../state';
import { Modal } from './controls';
import { ISave, ITrash } from './icons';

export function MyTrees() {
  const name = useSignal(currentName.value ?? '');
  const close = () => (modal.value = null);
  const fmt = (ms: number) => new Date(ms).toLocaleString(lang.value === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
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

type Row = [code: string, en: string, ru: string];

const SYNTAX: [string, string, Row[]][] = [
  ['Structure', 'Структура', [
    ['[TP [DP the cat] [VP sleeps]]', 'A node: [Label daughters…]. Words become terminals.', 'Узел: [Ярлык дочки…]. Слова становятся терминалами.'],
    ['[ [D the] [N cat]]', 'Empty label (BPS computes it)', 'Пустой ярлык (BPS вычислит его)'],
    ['[VP eat [DP fish]]', 'Terminals and nodes can be mixed', 'Терминалы и узлы можно смешивать'],
    ['% comment', 'Comment until the end of the line', 'Комментарий до конца строки'],
  ]],
  ['Labels', 'Ярлыки', [
    ["T'  T''", 'Primes: T′ T″', 'Штрихи: T′ T″'],
    ['DP_i  DP_{i,j}', 'Subscript / coindexation', 'Нижний индекс / коиндексация'],
    ['X^0  X^{max}', 'Superscript: X⁰', 'Верхний индекс: X⁰'],
    ['\\phi \\alpha \\0', 'Symbols: φ α ∅ (type \\ for a list)', 'Символы: φ α ∅ (наберите \\ для списка)'],
    ['"a [literal]"  \\[', 'Literal text, escapes', 'Буквальный текст, экранирование'],
    ['big~label', '~ is a space inside a label', '~ — пробел внутри ярлыка'],
  ]],
  ['Terminals', 'Терминалы', [
    ['[DP ^the big cat]', 'Triangle (unanalysed constituent)', 'Треугольник (неразобранная составляющая)'],
    ['[V čitaet | read.PRS.3SG]', 'Gloss line under the terminal (several | allowed)', 'Глосса под терминалом (можно несколько |)'],
    ['[DP t_i]  [DP <what>]', 'Trace; lower copy (grey / struck / ⟨⟩)', 'След; нижняя копия (серая / зачёркнутая / ⟨⟩)'],
    ['[<DP> the cat]', 'A whole constituent as a copy', 'Целая составляющая как копия'],
    ['∅  PRO  pro  e', 'Empty elements are ordinary text', 'Пустые элементы — обычный текст'],
  ]],
  ['Features & modifiers', 'Признаки и модификаторы', [
    ['[T{uφ, iT, EPP} will]', 'Feature stack under the node', 'Стопка признаков под узлом'],
    ['[V* eat]', '* marks the projecting daughter (BPS)', '* — проецирующая дочка (BPS)'],
    ['[DP@red …]  [DP@@#06c …]', 'Colour the node / the whole branch', 'Цвет узла / всей ветки'],
  ]],
  ['Multidominance & arrows', 'Мультидоминирование и стрелки', [
    ['[DP#1 what] … #1', 'Define id #1, re-merge it elsewhere: one node, two mothers', 'Задать id #1 и слить повторно: один узел, две матери'],
    ['[DP_i what] … [DP t_i]', 'Arrow from a coindexed trace (automatic)', 'Стрелка от коиндексированного следа (автоматически)'],
    ['#t -> #w', 'Explicit arrow (after the tree, one per line)', 'Явная стрелка (после дерева, по одной в строке)'],
    ['#t -> #w dashed "wh" @red', 'Style: dashed/dotted, label, colour', 'Стиль: dashed/dotted, подпись, цвет'],
    ['#a <-> #b curve bend=0,20', 'Both heads, direct curve, bend offset', 'Два наконечника, прямая дуга, изгиб'],
    ['#a -- #b', 'Line without head', 'Линия без наконечника'],
  ]],
];

export function Help() {
  const ru = lang.value === 'ru';
  return (
    <Modal title={t('cheatTitle')} onClose={() => (modal.value = null)} wide>
      <div class="cheat">
        {SYNTAX.map(([en, ruTitle, rows]) => (
          <section key={en}>
            <h4>{ru ? ruTitle : en}</h4>
            <table>
              <tbody>
                {rows.map(([code, e, r]) => (
                  <tr key={code}>
                    <td>
                      <code>{code}</code>
                    </td>
                    <td>{ru ? r : e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Modal>
  );
}

const KEYS: [string, string, string][] = [
  ['Ctrl/⌘ Z', 'Undo', 'Отменить'],
  ['Ctrl/⌘ Shift Z, Ctrl Y', 'Redo', 'Повторить'],
  ['Click', 'Select node (also selects it in the code)', 'Выделить узел (и в коде)'],
  ['Double-click, Enter, F2', 'Rename', 'Переименовать'],
  ['A', 'Add daughter', 'Добавить дочку'],
  ['S', 'Add sister', 'Добавить сестру'],
  ['Delete, Backspace', 'Delete node / arrow', 'Удалить узел / стрелку'],
  ['T', 'Triangle on/off', 'Треугольник вкл/выкл'],
  ['H', 'Projecting daughter (BPS)', 'Проецирующая дочка (BPS)'],
  ['M', 'Arrow from the selected node', 'Стрелка от выделенного узла'],
  ['← → ↑ ↓', 'Move between sisters / mother / daughter', 'Сёстры / мать / дочь'],
  ['V · W · C · D', 'Tools: select, arrow, c-command, dominance', 'Инструменты: выделение, стрелка, c-команда, доминирование'],
  ['+ − 0', 'Zoom in / out / fit', 'Масштаб + / − / по окну'],
  ['Drag, wheel', 'Pan (Ctrl + wheel or pinch: zoom)', 'Перемещение (Ctrl + колесо или щипок: масштаб)'],
  ['Esc', 'Cancel, deselect', 'Отмена, снять выделение'],
  ['?', 'This list', 'Этот список'],
];

export function Shortcuts() {
  const ru = lang.value === 'ru';
  return (
    <Modal title={t('shortcuts')} onClose={() => (modal.value = null)}>
      <table class="keys">
        <tbody>
          {KEYS.map(([k, e, r]) => (
            <tr key={k}>
              <td>
                {k.split(/(\s+|·|,)/).map((p, i) => (p.trim() && p !== '·' && p !== ',' ? <kbd key={i}>{p}</kbd> : <span key={i}>{p}</span>))}
              </td>
              <td>{ru ? r : e}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
