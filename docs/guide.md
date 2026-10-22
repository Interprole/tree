# NanoTrees guide

## Start and select

Type a tree, or choose a canvas from **Examples**. An example replaces the entire current canvas, so save your work first. Edits on the canvas update the same source text and participate in undo/redo. Invalid code is underlined; the picture keeps the last valid tree.

```
[TP [DP the cat] [T' [T will] [VP sleep]]]
```

Click a node or the white sheet to show that tree's code. Click a tree caption or the dark canvas background to hide the code. Double-click a node, or press Enter/F2, to focus its label in **Edit**. The upper-right sliders button shows/hides the right panel. Opening, closing or resizing a panel keeps the canvas in place; **Fit** explicitly fits all visible trees.

**Edit** changes structure and content. **Customize** changes presentation. **Nanosyntax** appears last when enabled by the top-bar button. Clicking Nanosyntax again hides its tab, L-trees and derivations without deleting them; the ordinary panel remains available.

## Tree structure and text

| Code | Result |
| --- | --- |
| `[DP the cat]` | One syntactic node DP with the expression “the cat” below it. |
| `[DP [D the] [N cat]]` | A DP with two syntactic daughters. |
| `[VP eat [DP fish]]` | An expression and a syntactic daughter together. |
| `[ [D the] [N cat]]` | A branching node without a label. |
| `[Acc]` | A syntactic terminal Acc; Acc is a label, not an expression. |
| `[Acc;spell="-a"]` | Acc with a terminal expression -a below it. |
| `[T{uφ, iT, EPP} will]` | Feature stack below T. |
| `[V читает \| read.PRS.3SG]` | A gloss below the expression; additional `\|` separators add lines. |
| `[DP ^the big cat]` | Triangle over unanalysed words. |
| `[DP ^ [D the] [N cat]]` | Triangle over a retained structure; remove `^` to expand it again. |
| `[DP &"focus" &right"✓"@4,-2 …]` | Notes beside a node; optional side and drag offset in pixels. Replace … with daughters. |
| `[DP <what>]` | Manually mark an expression as an unpronounced copy. |
| `% comment` | Ignore the rest of this line. |

A bare expression and `;spell=` can have the same result: `[N cat]`, `[N;spell=cat]` and `[N;spell="cat"]` draw N over cat. Use quotes for spaces, e.g. `[N;spell="the cat"]`. The visual expression field writes `;spell=`. Nested brackets are syntactic nodes; `[Num fin]` does not mean the same thing as `[NumP;spell="fin" [Num]]`.

| Text notation | Result |
| --- | --- |
| `T'`, `T''` | Primes T′, T″. |
| `DP_i`, `DP_{i,j}` | Subscripts. |
| `X^0`, `X^{max}` | Superscripts. |
| `big~label` | A space within a node label. |
| `**bold**`, `*italic*`, `~~struck~~` | Inline markup in labels, expressions, notes and arrow labels. |
| `\phi`, `\alpha`, `\0` | Supported LaTeX symbols, or type Unicode directly. Type a backslash in the editor for completion. |
| `\Leftarrow`, `\Rightarrow`, `\Leftrightarrow` | ⇐, ⇒, ⇔. |
| `\[`, `\#`, `\*`, `"a [b]"` | Escape reserved characters or quote literal text. |

**Manual** draws the written hierarchy. **X-bar** processes shorthand and can add intermediate X′ nodes. Customize → Labelling controls X′ insertion, head labels, prime/overline, empty specifiers and word expansion. Generated nodes have no independent source to rename; edit their underlying written nodes or switch to Manual.

## Structural editing and dragging

Select a node. The square tools at the top of **Edit** are **New daughter**, **New sister**, **Remerged daughter**, **Remerged sister**, **Mother**, **Triangle**, **Arrow** and **Delete**. New nodes start as X, ready to rename. Remerged daughter/sister starts a picker: click an existing constituent to add another position of the same chain. **Branching** swaps the two daughters. It appears before Movement.

Drag a branch by its top node. Orange insertion points show where it will go:

1. A point left/right of a node inserts the branch as its preceding/following sister.
2. Below a node with n daughters are n+1 gaps: before the first, between each pair, and after the last.
3. Release at a point to move. Hold **Shift** to insert an independent copy; hold **Alt** to insert a linked copy. Alt takes precedence if both are held.
4. You can also move/copy into another tree or an empty sheet. A root cannot acquire a sister; a branch cannot be moved inside itself.

Shift-drag on empty space draws a selection rectangle. It selects the smallest branch enclosing the selection. Drag the background to pan. Ctrl+wheel or a pinch zooms. Bottom-toolbar buttons also zoom and fit.

Ctrl/Cmd+C copies the selected branch, X cuts, V pastes as last daughter; Ctrl/Cmd+Shift+V pastes as next sister. With no node selected, paste creates a new tree. Ctrl/Cmd+D duplicates the branch. Independent copies receive fresh conflicting IDs and carry their internal arrows. Text selected in a panel retains ordinary text-copy behavior.

A **linked copy** uses `;link=group` on its root. Its internal edits synchronize with other branches with the same link on the canvas; its surroundings can change independently. Right-click a branch → Copy as a linked branch, then paste, or Alt-drag. The dashed frame marks linked branches. Edit → Unlink makes that branch independent. A linked branch cannot contain itself.

C and D have no tool shortcuts; Ctrl/Cmd+C and Ctrl/Cmd+D still copy/duplicate.

## Expressions and spellout

Use the same **Expression (its words or morpheme)** field for a word and a phrasal exponent.

```
[NumP;spell="fin" [Num]]
[AccP;spell="-a";spellside=right [Acc] [NomP [Nom]]]
```

A terminal expression is below its label. A phrasal expression is beside its domain: **tree ⇒ expression** on the right or **expression ⇐ tree** on the left. Automatic side selection chooses free space; `;spellside=left` or `right` forces it. Lexical trees use **⇔**, exactly `\Leftrightarrow`.

For a phrasal node, **Failed expression** writes `;spellfail=yes`. It displays ∅ with a crossed spellout arrow when there is no expression. The same checkbox works outside automatic derivations. **Customize → Circle phrasal spellout domains** outlines successful and failed spellout domains. **Italic expressions** affects expressions rather than syntactic terminal labels.

## Movement chains and arrows

Give a constituent an ID and use references at other positions:

```
[CP [DP#wh what] [C' did [VP [V buy] #wh]]]
```

| Code or setting | Behavior |
| --- | --- |
| `#wh` | Another position of the constituent defined as `[DP#wh …]`. |
| `#wh!` | Pronounce this position. |
| `[DP#wh? what]` | Silence the defining position. |
| `#wh"whom"` | Pronounce a reference with different words. |
| `#subj"zij \| she"` | Alternate pronunciation with a gloss. |
| `#wh$x : e$` | Meaning specific to a lower position, enabling Predicate Abstraction. |
| `#wh/2: ^ @gray` | Position-specific triangle/colour, on a separate line after the tree. |
| `#wh/2: open` | Open this position even if the shared constituent has a triangle. |
| `#wh/2: @none` | Use default colour here despite the constituent's shared colour. |

**Copies** shows the full constituent at each position; **Traces** shows t at silent positions; **Multidominance** draws one node with multiple mothers. The highest position is pronounced by default. The Movement controls in Customize set chain representation, silent-copy appearance, phrasal/head arrows and indices. Movement indices are independent of typed binding indices such as `DP_i`.

For content shared by a chain versus content at one position, Edit offers This copy / All copies. A separate `#id/occ:` line overrides one numbered position; numbering follows positions from the top. It accepts pronunciation, `^`, `open`, `@colour`, edge and expression styles, features, notes, meaning and quoted replacement words. Customize offers This element / All copies for presentation.

Head movement can be written equivalently as:

```
[TP [T#t -s] [VP [V#v;to=t sing]]]
```

```
[TP [T#t -s] [VP [V#v sing]]]
#v -> #t
```

Both target the head #t: the source is struck out, the target displays V+T and sing+-s. This equivalence requires suitable head endpoints, not phrasal chain positions. `plain` makes an arrow purely graphical and prevents the arrow line from encoding movement. Several head-movement steps accumulate; ∅ is omitted from combined expressions.

The arrow tool draws a plain arrow: click the source, then target. In **Edit → Meaning**, Movement converts suitable same-category constituents to chain positions or different heads to head movement. Its structural meaning, endpoints, bend points and labels are in Edit. Its colour, width, pattern and arrowheads are in Customize.

| Arrow syntax after the tree | Meaning |
| --- | --- |
| `#a -> #b plain` | A graphical arrow from a to b, independent of movement. |
| `#a <-> #b`, `#a <- #b`, `#a -- #b` | Heads at both ends, source only, or neither end. |
| `solid`, `dashed`, `dotted`, `width=2`, `@red` | Explicit pattern, width in pixels and colour. |
| `out=below in=left` | Endpoint sides: below, above, left or right; automatic if absent. |
| `from=node to=node` | Attach to head labels instead of their expressions; `word` uses expressions. |
| `"label" above"x"@5,0` | Multiple labels, side and optional drag offset. |
| `bend=0,40` | Offset the automatic bend handle. |
| `via=0,40;-20,60` | Explicit bend points relative to the middle of the endpoints. |
| `under`, `curve` | Arrow routing mode. |
| `#wh/2 -> #wh/1 hide` | Hide one chain arrow while keeping movement. |
| `#wh/2 -> #wh/1 visible` | Show this arrow even when chain arrows are globally off. |

Select an arrow to reveal its handles. Drag handles to bend it; double-click the arrow to add a bend point, double-click a point to remove it. **Automatic shape** resets bends; **Reverse** swaps endpoints. Movement arrows have separate delete actions to keep or undo movement. Delete on a selected arrow keeps its underlying movement.

## Nanosyntax: build a derivation

1. Enable **Nanosyntax** in the top bar; the button turns orange.
2. Build an S-tree with syntactic feature nodes. Expressions represent exponents, not feature labels: `[AccP [Acc] [NomP [Nom]]]` contains two heads Acc and Nom.
3. Build ordinary trees for lexical entries. Right-click a tree → **Use as an L-tree…**; choose Whole canvas, an S-tree from the list, or pick an S-tree on the canvas.
4. To make an entry directly beside an owner, right-click the S-tree or a group containing its L-trees → **New L-tree to this tree**. All lexical entries remain visible, editable trees. A tree-scoped entry moves with its owner.
5. Fill in an entry such as `[NumP;spell="fin" [Num]]`. Right-click an L-tree to change its owner or stop using it as an L-tree.
6. Choose the three rules below in the **Nanosyntax** tab. Each selector has its own numbered explanation and links. Settings apply to this tree or the whole canvas; changing a general rule asks about independent tree values using Customize's Ask / Replace / Keep policy.
7. Right-click the S-tree with entries, or an L-tree → **Run spellout**. A canvas L-tree offers its eligible S-trees by name. The button belongs to the context menu.

Matching requires the whole syntactic constituent to be identical to a constituent inside an L-tree: a lexical tree can be a superset of what it spells out. Among matches the entry with the fewest unused features wins; declaration order resolves ties, with local entries before canvas entries.

### Choice 1: spellout-driven movement

1. Merge the next feature F; try direct lexicalization of FP.
2. **Starke 2018:** try spec-to-spec evacuation, then undo it and try complement (snowball) movement, retrying spellout after each.
3. **Caha et al. 2025:** start with the closest labelled non-remnant constituent. After failure, try its immediately dominating constituent, then progressively larger containing constituents. A remnant has had material extracted. This allows subextraction inside complex Specs.
4. When evacuation fails, try backtracking to an earlier cycle and its next option. New AUX formation is the last resort.

Sources: [Starke 2018, §§9.2–9.3](https://doi.org/10.1093/oso/9780190876746.003.0009); [De Clercq, Caha, Starke and Vanden Wyngaerd 2025, chapter 1, §1.6](https://doi.org/10.1093/9780198947158.003.0001).

### Choice 2: AUX closure

1. **Late Closure (Starke 2018):** keep AUX open and try the next feature there first. Keep growing it while spellout succeeds.
2. Close AUX when it cannot grow further, merge it as a left branch before the main spine, and continue on the combined tree.
3. **Early Closure (Caha 2019):** close AUX as soon as it can lexicalize. Merge the next external feature on the combined root; later failure can reopen AUX through backtracking.

Sources: [Starke 2018, tentative proposal in §9.3](https://doi.org/10.1093/oso/9780190876746.003.0009); [Caha 2019, §§6.4–6.5](https://ling.auf.net/lingbuzz/004875).

The 2025 evacuation revision does not by itself choose a single closure policy. Chapter 7 of the 2025 book discusses Late Closure, Early Closure and **Multiple Merge**: [Demonie 2025, especially §7.5](https://doi.org/10.1093/9780198947158.003.0007).

### Choice 3: F after backtracking

1. Return to the preceding cycle and try its next option. When backtracking reopens Spec formation, separate AUX from the main spine.
2. **AUX only:** try F on AUX, including movement rescue. F must co-spellout with material in the old Spec.
3. **Multiple Merge:** try F independently in every reopened workspace, with the same spellout, movement and recursive backtracking procedure.
4. Keep successful occurrences of F; undo failed occurrences. At least one workspace must lexicalize F. If all fail, open a new AUX as the last resort.

Source: [Caha 2019, chapter 6 and chapter 7, §7.3](https://ling.auf.net/lingbuzz/004875). Caha's Multiple Merge combines with Early Closure. The app also permits Multiple Merge with Late Closure as an explicit combination, not as a claim that this is Caha's published configuration.

### Reading the result and examples

The derivation is a group of ordered snapshots: Merge, spellout attempts, movement, backtracking and workspace operations. Workspaces that have not combined appear as separate trees grouped at that step. AUX attaches as a prefix. Only the copy involved in the current movement and its arrow are visible at that step. Subsequent lexicalization steps contain no lower copy, placeholder node or movement arrow. The actual last successful operation becomes **Fully lexicalised**, without an extra duplicate tree.

A domain that cannot lexicalize receives a failed empty expression with a crossed arrow. The algorithm continues lexicalizing the parts it can. Failure and search-limit messages distinguish an incomplete result from full lexicalization. The implementation accepts at most 180 input nodes and bounds search at 1,800 attempts and 700 trace steps. It does not infer language-specific agreement licensing, pointers or semantic restrictions.

The general **Examples** menu has three canvases with S-tree, visible L-trees and derivation already built:

| Example | Configuration and source |
| --- | --- |
| English **of sugar** | Starke movement + Late Closure + AUX only; Starke 2018, §9.3. |
| Mara **wili-gamiñ → wilamiñ**, “women” | Old movement + Early Closure + AUX only; Kloudová 2020, §5.3.1, pp. 65–69. This is the Kloudová example. |
| Friulian **fin-iʃ**, 1SG | Revised evacuation + Early Closure + AUX only; published 2025 chapter 1, §1.6. |

Lower lexical domains are abbreviated to matching minimal subtrees. Mara contraction is phonological and is not a syntactic operation. Changing rules does not rewrite already generated snapshots; use Run spellout to produce a derivation under the new rules. All eight combinations of the three independent choices can be selected and saved.

## Semantics

Write `$formula : type$` on a node. Types can be e, t, s, d, n, any name, or functions such as `<e,<s,t>>`. Variables default to e for x/y/z, s for event e/e′, and `<e,t>` for P/Q; typed variables remove ambiguity.

```
[S [DP Mary $mary : e$] [VP sleeps $λx. sleep(x) : <e,t>$]]
```

| Notation | Meaning |
| --- | --- |
| `λx.`, `lambda x.`, `\x.`, `\lambda x.` | Lambda abstraction. |
| `λx_e.λe_s. agent(e)(x)` | Explicit variable types. |
| `∃x.`, `∀x.`, `ιx.` | Also exists, forall, iota. |
| `∧ ∨ ¬ → =` | Logical operators; LaTeX forms and ASCII aliases are accepted. |
| `size(x) > 3`, `n + 1`, `!= <= >= - *` | Numbers, comparisons and arithmetic. |
| `mary : e`, `dog : <e,t>` | Constants with declared types. |

Composition runs bottom-up, trying FA (Functional Application), PC (Predicate Conjunction), EI (Event Identification) and FC (Function Composition), in that order. A unary node passes a meaning up; a subtree without any meaning is vacuous. A lower chain position with a variable triggers Predicate Abstraction, combined with the relevant rule (PA+…). Failed type combinations show an error in red.

Customize → Semantics controls visibility, computation, types, rule names and meaning colours. Edit → Features and meaning edits a given formula or writes a computed formula into the code.

## Customize: scope, colours and sizes

Select an element and open **Customize**. Its scope row offers **This element**, **All copies** when relevant, **All elements in this tree**, and **All trees**. A tree/canvas selection offers This tree / All trees. Selecting one element shows only its relevant controls; tree/canvas scope shows blocks for the whole picture.

**Values of their own** controls general changes meeting private values: **Ask**, **Replace them**, **Keep them**. Ask opens the existing replacement dialog. Replace clears the corresponding private values so they inherit the new setting; Keep leaves them independent. The `default` colour marker can be written by the editor to inherit that property while retaining the other colours of a branch. Other properties retain their own values. This applies to tree values against canvas defaults, source styles on nodes/expressions/lines/arrows, and position styles against shared chain settings. Inline markup remains content.

Whole-tree blocks cover presets, labelling, Movement, Circle phrasal spellout domains immediately after Movement, Semantics, Typography, Layout, Tree lines and Arrows. Changed settings have individual reset buttons. Installed fonts can be selected by name; browser support varies. PNG/SVG/PDF embed available font data; Times New Roman export uses its metric-compatible free twin Tinos.

Click a **tree line itself** to customize its colour, thickness, pattern and extra length. Those controls no longer live in the node editor. Select a node for its label colour/font size, branch colour, daughter spacing and meaning colour. Select an arrow for its own colour, width, pattern and arrowheads.

| Source option | Purpose |
| --- | --- |
| `@red`, `@@#06c` | Node label / whole branch colour; branch colour also affects descendants and internal edges, not the edge above. |
| `;color=red`, `;branch=blue` | Aliases for node/branch colour. |
| `;size=24` | Node label font size in pixels. |
| `;wordcolor=blue;wordsize=20` | Expression colour/font size. |
| `;edge=red;width=2;edgeline=dashed;len=20` | Incoming syntactic edge colour, width, pattern and extra length. |
| `;wordedge=red;wordwidth=2;wordline=dotted;wordlen=10` | Edge to the node's expression, independently of its own incoming edge. |
| `;spread=30` | Extra spacing between daughters. |
| `;sem=blue` | Node meaning colour. |

## Canvas, groups, persistence and export

Add a tree with **+** above the code or right-click the canvas → New tree here. An empty tree keeps its sheet; only an empty tree offers Add a node. Click a tree's white space to edit it; drag its caption to move it. A tree can be renamed, exported or removed through its context menu. Branch copy operations are in node menus and Edit; whole-tree tab menus also provide independent/linked copies.

Right-click a tree → **Add to a group…**. Choose a group or another tree, or pick it on the canvas. Group headers move members together. Tree-scoped L-trees stay adjacent to their S-tree and can be grouped with it. Derivation groups contain all steps, with separate workspaces grouped per step. Saving preserves roles, scopes, group membership, sources, settings and positions.

Drag the sheet corner to resize: the tree scales proportionally into the requested sheet. Double-click the corner restores natural size. Drag panel dividers to resize, double-click a divider for its default width. The format button or Shift+Alt+F lays out code without changing its tree.

| Action or format | Scope and behavior |
| --- | --- |
| File → Save to disk, Ctrl/Cmd+S | A `.nanotrees` file contains the entire canvas. In supporting browsers the file stays connected for subsequent saves. Shift saves as. |
| File → Open, Ctrl/Cmd+O | Open a canvas file; dropping a file on the app also opens it. |
| My trees | Named canvas snapshots in this browser. Automatic session saving is browser-local. |
| Share | A link containing canvas sources and settings. |
| SVG | Vector, embedded fonts; matches the scene. |
| PNG | Raster at chosen scale, optionally transparent. |
| PDF | Vector with embedded fonts. |
| LaTeX forest | Editable tree plus TikZ arrows/domains; shared nodes are hosted under one mother and connected to others. |
| LaTeX tikz-qtree | Editable hierarchy; multidominance is represented by repeated nodes. |
| LaTeX TikZ exact layout | Absolute geometry reproducing the app's scene. |
| Clear canvas | Removes all trees after confirmation; save first. |

Exports operate on the selected tree. Save/Share preserve the whole canvas. The offline build is one HTML file with the application and bundled fonts and runs locally without a server. Derivations run in the browser; no backend computation or external API is required.

## Keyboard reference

| Key | Action |
| --- | --- |
| Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z or Ctrl+Y | Undo; redo. |
| A; S; P | New daughter; new sister; mother. |
| Enter/F2 | Focus selected node's label. |
| T | Toggle triangle. |
| M | Start an arrow at the selected node. |
| V; W | Select tool; arrow tool. |
| Delete/Backspace | Delete selected node or arrow; typing fields retain text deletion. |
| Arrow keys | Navigate sisters/mother/daughter. |
| Ctrl/Cmd+C; X; V; Shift+V; D | Copy; cut; paste daughter/new tree; paste sister; duplicate. |
| Shift-drag a node; Alt-drag a node | Independent copy; linked copy. |
| Shift-drag empty space | Select a branch by rectangle. |
| +; −; 0 or F | Zoom in; zoom out; fit. |
| Shift+Alt+F | Format code in the editor. |
| Escape | Cancel tool/picker or deselect. |
| ? | Keyboard shortcuts. |
