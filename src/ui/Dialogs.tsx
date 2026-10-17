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
          ['#wh"whom"', 'Pronounce this copy differently (e.g. a resumptive, a pronoun copy or a partial copy): the position shows the given words.'],
          ['#wh/2: open   #wh/2: @none', 'This copy without the triangle or the colour that all copies have.'],
          ['#wh/2: ^ @gray', 'One position on its own, as a line after the tree: ^ triangle, @colour, edge= width= len=, {features}, &"note", $meaning$, "words", ! or ?. Written on the constituent itself ([DP#wh@red …]) it goes to all copies. On the canvas: select a copy → Apply to: This copy / All copies.'],
          ['#subj"zij | she"', 'Other words with a gloss line, e.g. pronoun copying in Wambeek Dutch: [DP#subj dei vrou] … #subj"zij | she" (see Examples). On the canvas: select the lower position → Pronounced as.'],
          ['#wh$x : e$', 'Give a lower position its own meaning (a trace as a variable). Its sister is then abstracted over it (Predicate Abstraction, shown as PA+…).'],
        ]} />
        <p>On the canvas: select a position → ⋯ → <em>Pronounce / Silence this position</em>.</p>
        <h4>Arrows and indices</h4>
        <p>
          Arrows between the positions of a chain are drawn automatically (switch: <em>Arrows for phrasal movement</em>). Each one can still be edited: click it to change line, head, route or label, or drag its round handle to bend it. Editing writes a line like <code>#wh/2 -&gt; #wh/1 dashed</code> into the code (<code>/2</code> = the second position from the top); deleting the arrow (keeping the movement) writes <code>… hide</code>; with the switch off, <code>… visible</code> shows one arrow anyway.
        </p>
        <p>
          <em>Movement indices</em> adds subscripts to all positions of each chain. They are separate from indices you type yourself (<code>DP_i</code>, used for binding): movement indices come from the # ids and never reuse a letter you already typed.
        </p>
        <h4>Head movement</h4>
        <p>An arrow from one head to another (e.g. V to v) is head movement: the source is struck through and the target shows the complex head as text, with the words joined by + too. Several steps add up: V+v, then V+v+T (sing+∅+-s). ∅ is left out of the words.</p>
<p>
          Head movement is written on the moved head: <code>[V#v;to=t sing]</code>. On the canvas: draw an arrow (it is just an arrow), then choose <em>Movement</em> in its panel. Two heads of different categories become head movement; two constituents of the same category become copies of one chain (silent if they are the same, pronounced with their own words otherwise); different categories cannot move into each other. A movement arrow can be deleted keeping the movement (written <code>hide</code>, or nothing when such arrows are switched off) or with it. The switches <em>Arrows for phrasal movement</em> and <em>Arrows for head movement</em> hide only movement arrows, never just-arrows.
        </p>
        <Pre>{'[TP [T#t -s] [vP [v#v ∅] [VP [V#root sing] [DP songs]]]]\n#root -> #v\n#v -> #t'}</Pre>
        <h4>Arrow lines</h4>
        <Table rows={[
          ['#a -> #b', 'Arrow from the node #a to the node #b (one arrow per line, after the tree).'],
          ['<->   <-   --', 'Two heads, reversed, no head.'],
          ['dashed  dotted', 'Line style.'],
          ['out=below  in=left', 'Where the arrow leaves and enters (below, above, left, right); by default the sides that touch nothing, as one smooth curve like TikZ’s to[out=…, in=…].'],
          ['"label"   @red', 'A label, a colour. Several labels are allowed.'],
          ['above"x"  below"y"  left"z"', 'Label position (default: auto = under an arrow below the tree, outside a curve). Drag a label to move it: writes "x"@dx,dy.'],
          ['bend=0,20', 'Offset of the bend (set by dragging the handle).'],
          ['via=0,40;-30,60', 'Bend points: the arrow is a smooth curve through them (offsets in px from the middle of its two ends). Double-click an arrow to add one, drag the round handles, double-click a handle to remove it.'],
          ['plain', 'Just an arrow: between two heads it is not head movement (nothing struck through, no V+v).'],
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
        <p>Click a node to select it (it is also selected in the code). Everything about it is in the panel to the right of the canvas, tab <em>Edit</em>, so nothing covers the tree; the tab <em>Appearance</em> next to it (or the sliders button at the top) holds the settings of the whole tree.</p>
        <Table rows={[
          ['Label', 'Rename: type in the panel, the tree follows as you type (double-click or Enter jumps there). You can type markup: DP_i, T\'.'],
          ['Daughter / Sister / Mother', 'Add a new node X (a mother goes above the node: X → [Y X]) and type its label. The code gets line breaks by itself: every daughter of a bigger node on its own line, indented under its mother.'],
          ['Triangle', 'Triangle on/off. The structure stays in the code.'],
          ['Arrow', 'Draw an arrow from this node: then click the target.'],
          ['Movement', 'Re-merge: add an existing constituent again (a new chain position #id). Pronounce or silence a position; pronounce a lower position with other words (a pronoun copy).'],
          ['Features, meaning', 'Features (comma-separated), the meaning, or keep the computed meaning.'],
          ['Notes', 'Notes next to the node: several, each with a position (auto, left, right, above, below). Drag them on the canvas; click one to edit or delete it.'],
          ['Colour', 'Colour the label, the edge above, the whole branch or the meaning: a palette colour or any colour (the rainbow swatch).'],
          ['Spacing', 'Width and extra length of the edge above, spread of the daughters. The ▲▼ buttons, the arrow keys and the mouse wheel change the tree at once.'],
          ['Copy and paste', 'Ctrl+C copies the node with everything below it (the root: the whole tree), Ctrl+X cuts it. Ctrl+V pastes it as the last daughter of the selected node, Ctrl+Shift+V as its sister, and with nothing selected as a new tree on the canvas; Ctrl+D duplicates the node. A pasted copy is a constituent of its own: its #ids are renamed, arrows inside it come along.'],
          ['Linked branches', 'Right-click a node → Copy as a linked branch, then paste it (in this tree or another one). The copies are one branch: whatever changes inside one of them changes in all (in the code: ;link=…). Around a linked branch everything is free: add sisters or a mother, move it, re-merge it. A dashed frame shows linked branches on the canvas; Unlink makes one a branch of its own.'],
          ['Appearance', 'Click a tree, then Appearance sets that tree; click the empty canvas, and it sets all trees. When a setting for many meets values of their own (a tree, a node, an arrow, a copy), you are asked whether to replace them; Appearance → Values of their own changes that.'],
          ['Mouse', 'Drag a node to move its branch: drop it on a node to make it its last daughter (Shift: its sister, Alt: a copy) — also onto a node of another tree, or onto an empty tree. A tree without nodes keeps its sheet: right-click it to add a node. Shift + drag draws a rectangle that selects the smallest branch with everything in it. Right-click a node for copy, paste, link and delete.'],
          ['Branching', <>Swap the two daughters: <em>left</em> turns [XP X [Z]] into [XP [Z] X], <em>right</em> turns [XP [Z] X] into [XP X [Z]].</>],
        ]} />
        <p>Drag the borders between the code, the canvas, the edit panel and the settings to make them wider or narrower (double-click a border: default). The ≡ button in the code (Shift+Alt+F) lays out the whole code.</p>
        <h4>Several trees</h4>
        <p>
          The tabs above the code are the trees on the canvas; <strong>+</strong> adds one. Each tree has its own code and settings and is exported on its own. Click a tree on the canvas to edit it, drag its name to move it. ⋯ on a tab: <em>Copy</em> makes an independent copy, <em>Linked copy</em> one that shares the code (an edit in one changes both, while e.g. copies vs traces or colours stay separate); <em>Unlink</em> and <em>Link to…</em> change that later.
        </p>
        <h4>Tools (bottom of the canvas)</h4>
        <Table rows={[
          ['Select', 'Select and edit.'],
          ['Arrow', 'Click the moved element, then the landing site.'],
          ['C-command', 'Click a node: green shows what it c-commands.'],
          ['Dominance', 'Click a node: blue shows what it dominates.'],
        ]} />
        <p>Click a note or an arrow label to edit or delete it; drag it to move it. Every bend of a selected arrow is marked with a round handle: drag it, double-click it to remove it, double-click the arrow to add one. Click an arrow to change its line, head direction (→ ← ↔ —), colour, route, labels and bend points, to reverse it, or to make it <em>just an arrow</em> (not head movement). Deleting an arrow between two positions of a chain hides it (it does not come back with default settings). Drag the background to pan, Ctrl + wheel or pinch to zoom, and use the percentage button to fit the trees.</p>
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
          ['Save to disk', 'File → Save to disk (Ctrl+S) writes the whole canvas, all its trees, into a .nanotrees file; Open from disk (Ctrl+O) or dropping a file onto the window brings it back. In Chrome and Edge the file stays connected: Ctrl+S saves into it again, and it can be kept up to date automatically.'],
          ['My trees', 'Save the canvas (all its trees) in this browser. The current canvas is saved automatically, but only in this browser: save to disk to keep it safe.'],
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
  ['V · W · C · D', 'Tools: select, arrow, c-command, dominance'],
  ['+ − 0', 'Zoom in / out / fit'],
  ['Shift Alt F', 'Lay out the code (in the code editor)'],
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
