import { useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
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

type Row = [code: string, meaning: ComponentChildren];

function Table({ rows }: { rows: Row[] }) {
  return (
    <table class="guide-table">
      <tbody>
        {rows.map(([code, m]) => (
          <tr key={code}>
            <td>
              <code>{code}</code>
            </td>
            <td>{m}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Pre = ({ children }: { children: string }) => <pre class="guide-pre">{children}</pre>;

interface GuideSection {
  id: string;
  title: string;
  body: () => ComponentChildren;
}

const GUIDE: GuideSection[] = [
  {
    id: 'start',
    title: 'Quick start',
    body: () => (
      <>
        <p>NanoTrees draws a tree from bracket notation and lets you edit it on the picture. The text on the left is the tree: every change on the canvas is written back into it, so undo, sharing and saving all work on the text.</p>
        <ol class="steps">
          <li>
            <strong>Type a tree</strong> in the code panel. The picture updates as you type; an error is underlined and the last correct tree stays on screen.
            <Pre>{'[TP [DP the cat] [T\' [T will] [VP sleep]]]'}</Pre>
          </li>
          <li>
            <strong>Click a node</strong> on the canvas to edit it: rename (double-click), add daughters or sisters, delete, colour, triangle, features, meaning. Or keep typing in the code.
          </li>
          <li>
            <strong>Choose how it looks</strong> in Appearance (the sliders button, top right): labelling mode, how movement chains are drawn, fonts, spacing, presets.
          </li>
          <li>
            <strong>Export</strong> it as SVG, PNG, PDF or LaTeX (forest), or copy a <em>Share</em> link that opens the same tree.
          </li>
        </ol>
        <p class="hint">Start from <em>Examples</em> in the top bar: each one shows a feature (X-bar, chains, head movement, multidominance, nanosyntax, glosses, semantics).</p>
      </>
    ),
  },
  {
    id: 'syntax',
    title: 'Writing trees',
    body: () => (
      <>
        <h4>Nodes and terminals</h4>
        <Table rows={[
          ['[DP the cat]', 'A node: [Label contents]. Words become one terminal (“the cat”).'],
          ['[DP [D the] [N cat]]', 'Daughters are nested brackets.'],
          ['[VP eat [DP fish]]', 'Terminals and nodes can be mixed.'],
          ['[ [D the] [N cat]]', 'A node without a label.'],
          ['% comment', 'Everything after % on a line is ignored.'],
        ]} />
        <h4>Inside labels and words</h4>
        <Table rows={[
          ["T'   T''", 'Primes: T′, T″.'],
          ['DP_i   DP_{i,j}', 'Subscripts, e.g. binding indices.'],
          ['X^0   X^{max}', 'Superscripts: X⁰.'],
          ['\\phi  \\alpha  \\0', 'Symbols: φ α ∅ (type \\ in the code for the full list).'],
          ['\\Rightarrow  \\Leftrightarrow  \\varnothing  \\emptyset', 'Any standard LaTeX symbol command works anywhere: ⇒ ⇔ ∅ ∅, arrows, relations, set and logic symbols. The LaTeX export writes the same commands back.'],
          ['big~label', '~ is a space inside a label.'],
          ['**bold**  *italic*  ~~struck~~', 'Markdown in labels, words, notes and arrow labels. A lone * or ~~ stays as it is.'],
          ['\\[  \\#  \\*  "a [b]"', 'Escape a special character, or quote literal text.'],
        ]} />
        <h4>Decorations</h4>
        <Table rows={[
          ['[V читает | read.PRS.3SG]', 'Gloss lines under a terminal (one | per line). ALL-CAPS abbreviations are set in small caps.'],
          ['[T{uφ, iT, EPP} will]', 'Feature stack under the node.'],
          ['[DP ^the big cat]', 'Triangle over an unanalysed constituent.'],
          ['[DP ^ [D the] [N cat]]', 'Triangle over a structure: the picture shows “the cat”, the code keeps the structure; remove ^ to get it back.'],
          ['[DP@red …]   [DP@@#06c …]', 'Colour the label, or the whole branch below it: labels, edges and meanings (the edge above stays black).'],
          ['[DP;edge=red;width=2 …]', 'Colour / width (px) of the edge above this node.'],
          ['[VP;len=20;spread=30 …]', 'Make the edge above longer (px); widen the gaps between the daughters (px).'],
          ['[DP;sem=#06c …]', 'Colour of this node’s meaning formula.'],
          ['[DP &"focus" &right"✓" …]', 'Notes next to the node: & then optional left/right/above/below and the text in quotes. auto = left of the first daughter, right otherwise. Drag a note on the canvas to move it (writes @dx,dy).'],
          ['[DP <what>]', 'Mark any text as an unpronounced copy by hand.'],
          ['[N cat $λx. cat(x)$]', 'A meaning (see Semantics).'],
        ]} />
      </>
    ),
  },
  {
    id: 'modes',
    title: 'Labelling modes',
    body: () => (
      <>
        <p>The mode switch in the top bar changes how labels are drawn. It never changes your text: you can switch back and forth freely.</p>
        <Table rows={[
          ['Manual', 'Everything exactly as written.'],
          ['X-bar', <>Write shorthand <code>[VP [V eat] [DP fish]]</code>; the tree adds V′. Options: X′ always / only with a specifier / never, X vs X⁰, prime vs overline, empty specifiers, expansion of one-word phrases.</>],
        ]} />
      </>
    ),
  },
  {
    id: 'movement',
    title: 'Movement',
    body: () => (
      <>
        <h4>Chains are made with #</h4>
        <p>
          Give the moved constituent an id where it is written, <code>[DP#wh what]</code>, and put <code>#wh</code> in every other position. All positions are the same element: change it once, it changes everywhere.
        </p>
        <Pre>{'[CP [DP#wh what] [C\' did [VP [V buy] #wh]]]'}</Pre>
        <h4>Copies, traces or multidominance</h4>
        <Table rows={[
          ['Copies', 'Every position gets a full copy. Unpronounced copies can be regular, gray, struck through or in ⟨angle brackets⟩.'],
          ['Traces', 'Unpronounced positions become t.'],
          ['Multidominance', 'One node with several mothers (remerge, ATB, RNR).'],
        ]} />
        <p>Switch in the top bar or in Appearance → Movement. By default only the highest position is pronounced.</p>
        <Table rows={[
          ['#wh!', 'Pronounce this position too (multiple spell-out).'],
          ['[DP#wh? what]', 'Do not pronounce this position.'],
          ['#wh"whom"', 'Pronounce this copy differently (e.g. a resumptive or a partial copy): the position shows the given words.'],
          ['#wh$x : e$', 'Give a lower position its own meaning (a trace as a variable). Its sister is then abstracted over it (Predicate Abstraction, shown as PA+…).'],
        ]} />
        <p>On the canvas: select a position → ⋯ → <em>Pronounce / Silence this position</em>.</p>
        <h4>Arrows and indices</h4>
        <p>
          Arrows between the positions of a chain are drawn automatically (switch: <em>Arrows between positions</em>). Each one can still be edited: click it to change line, head, route or label, or drag its round handle to bend it. Editing writes a line like <code>#wh/2 -&gt; #wh/1 dashed</code> into the code (<code>/2</code> = the second position from the top); deleting writes <code>… hide</code>.
        </p>
        <p>
          <em>Movement indices</em> adds subscripts to all positions of each chain. They are separate from indices you type yourself (<code>DP_i</code>, used for binding): movement indices come from the # ids and never reuse a letter you already typed.
        </p>
        <h4>Head movement</h4>
        <p>An arrow from one head to another (e.g. V to v) is head movement: the source is struck through and the target shows the complex head as text, with the words joined by + too. Several steps add up: V+v, then V+v+T (sing+∅+-s). ∅ is left out of the words.</p>
        <Pre>{'[TP [T#t -s] [vP [v#v ∅] [VP [V#root sing] [DP songs]]]]\n#root -> #v\n#v -> #t'}</Pre>
        <h4>Arrow lines</h4>
        <Table rows={[
          ['#a -> #b', 'Arrow from the node #a to the node #b (one arrow per line, after the tree).'],
          ['<->   <-   --', 'Two heads, reversed, no head.'],
          ['dashed  dotted', 'Line style.'],
          ['curve', 'A direct curve instead of the route under the tree.'],
          ['"label"   @red', 'A label, a colour. Several labels are allowed.'],
          ['above"x"  below"y"  left"z"', 'Label position (default: auto = under an arrow below the tree, outside a curve). Drag a label to move it: writes "x"@dx,dy.'],
          ['bend=0,20', 'Offset of the bend (set by dragging the handle).'],
          ['#wh/2 -> #wh/1 hide', 'Hide one automatic arrow of a chain.'],
        ]} />
      </>
    ),
  },
  {
    id: 'semantics',
    title: 'Semantics',
    body: () => (
      <>
        <p>
          Write a meaning between <code>$…$</code> in a node, optionally followed by its type after “ : ”. Meanings of the other nodes are computed bottom-up and shown in blue, optionally with the rule used (Appearance → Semantics → Show the rule).
        </p>
        <Pre>{'[S [DP Mary $mary : e$] [VP sleeps $λx. sleep(x) : <e,t>$]]'}</Pre>
        <h4>Formulas</h4>
        <Table rows={[
          ['λx. cat(x)', 'λ-abstraction: type λ, or lambda x., or \\x., or \\lambda x.'],
          ['\\lambda \\iota \\forall \\Rightarrow', 'Symbols are written either directly (λ ι ∀ ⇒) or as LaTeX commands; ⇒ and ⇔ mean → and ↔.'],
          ['λx_e.λe_s. agent(e)(x)', 'Typed variables: x_e or x:e. Without a type, x y z are e, e e′ e1 are s (events), P Q are ⟨e,t⟩.'],
          ['∧ ∨ ¬ → =', 'Connectives (also & -> \\land \\neg).'],
          ['∃x. φ   ∀x. φ   ιx. φ', 'Quantifiers and the iota operator: also exists x., forall x., iota x.'],
          ['size(x) > 3   n + 1', 'Numbers and comparison / arithmetic: = ≠ < > ≤ ≥ + − × (also != <= >= - *).'],
          ['mary : e   dog : <e,t>', 'A constant with a declared type.'],
          ['<e,<s,t>>', 'Types can be anything: e, t, s, d, i, n, or any name you like, and ⟨a,b⟩ written <a,b>. Only the function structure matters for composition.'],
        ]} />
        <h4>Composition rules</h4>
        <p>For a node with two daughters β and γ, the first rule that fits applies:</p>
        <Table rows={[
          ['FA', <>Functional Application: one daughter is ⟨a,b⟩, the other a → ⟦β⟧(⟦γ⟧).</>],
          ['PC', <>Predicate Conjunction: both have the same predicate type → λa₁…aₙ. β(a…) ∧ γ(a…).</>],
          ['EI', <>Event Identification: ⟨e,⟨s,t⟩⟩ and ⟨s,t⟩ → λx.λe. β(x)(e) ∧ γ(e). Only these types.</>],
          ['FC', <>Function Composition: ⟨b,c⟩ and ⟨a,b⟩ → λx. β(γ(x)).</>],
        ]} />
        <p>
          A one-daughter node passes its daughter’s meaning up; a daughter with no meaning anywhere below it counts as semantically vacuous. If no rule fits, the node shows the types that failed in red. Select a node → λ to edit its meaning or to copy the computed one into the code.
        </p>
      </>
    ),
  },
  {
    id: 'canvas',
    title: 'Editing on the canvas',
    body: () => (
      <>
        <p>Click a node to select it (it is also selected in the code); a toolbar appears above it.</p>
        <Table rows={[
          ['✎', 'Rename (also double-click or Enter). You can type markup: DP_i, T\'.'],
          ['daughter / sister', 'Add a new node X and rename it.'],
          ['copy', 'Add an existing constituent again: choose daughter or sister, then click the constituent. This makes a new chain position (#id).'],
          ['△', 'Triangle on/off. The structure stays in the code.'],
          ['[f]', 'Features (comma-separated).'],
          ['λ', 'Meaning; or keep the computed meaning.'],
          ['“ ”', 'Notes next to the node: several, each with a position (auto, left, right, above, below). Drag them on the canvas; click one to rename or delete it.'],
          ['palette', 'Colour the label, the edge above, the whole branch or the meaning.'],
          ['↔', 'Spacing: width and extra length of the edge above, spread of the daughters.'],
          ['arrow', 'Draw an arrow from this node: then click the target.'],
          ['⋯', <>Change the branching of a node with two daughters by swapping them: <em>left</em> turns [XP X [Z]] into [XP [Z] X], <em>right</em> turns [XP [Z] X] into [XP X [Z]]; pronounce or silence a chain position.</>],
          ['🗑', 'Delete the node (its #references and arrows go too).'],
        ]} />
        <h4>Tools (bottom of the canvas)</h4>
        <Table rows={[
          ['Select', 'Select and edit.'],
          ['Arrow', 'Click the moved element, then the landing site.'],
          ['C-command', 'Click a node: green shows what it c-commands.'],
          ['Dominance', 'Click a node: blue shows what it dominates.'],
        ]} />
        <p>Click a note or an arrow label to rename or delete it; drag it to move it. Click an arrow to change its line, head direction (→ ← ↔ —), colour, route and labels, or to reverse it. Drag the background to pan, Ctrl + wheel or pinch to zoom, and use the percentage button to fit the tree.</p>
      </>
    ),
  },
  {
    id: 'output',
    title: 'Appearance & export',
    body: () => (
      <>
        <h4>Appearance</h4>
        <p>
          The sliders button opens the settings: presets (Paper, Slides, Board), labelling mode, movement, semantics, font, size, spacing, line width and colours. Every changed setting gets a ↺ button that restores its default. <em>An installed font…</em> lets you use any font on your computer.
        </p>
        <h4>Export</h4>
        <Table rows={[
          ['SVG', 'Vector, with the fonts embedded.'],
          ['PNG', '1× to 6× (up to 576 dpi), optionally transparent.'],
          ['PDF', 'Vector, fonts embedded.'],
          ['LaTeX', 'forest code (also tikz-qtree, or TikZ with the exact layout). Compiles with pdfLaTeX, XeLaTeX and LuaLaTeX.'],
          ['Share', 'A link with the tree and its settings.'],
          ['My trees', 'Save trees in this browser. The current tree is saved automatically.'],
        ]} />
      </>
    ),
  },
  {
    id: 'keys',
    title: 'Keyboard shortcuts',
    body: () => <KeysTable />,
  },
];

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
  ['Click', 'Select a node (also selects it in the code)'],
  ['Double-click, Enter, F2', 'Rename'],
  ['A', 'Add a daughter'],
  ['S', 'Add a sister'],
  ['Delete, Backspace', 'Delete the node or arrow'],
  ['T', 'Triangle on/off'],
  ['M', 'Arrow from the selected node'],
  ['← → ↑ ↓', 'Move between sisters / mother / daughter'],
  ['V · W · C · D', 'Tools: select, arrow, c-command, dominance'],
  ['+ − 0', 'Zoom in / out / fit'],
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
