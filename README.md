# NanoTrees

**[Open NanoTrees](https://interprole.github.io/tree/)** · by Gleb Bubnov

An interactive syntax-tree editor for linguists. Type bracket notation or edit the picture; canvas edits update the same code and undo history. Everything, including nanosyntactic derivation search, runs in the browser. Static hosting on GitHub Pages is sufficient; no application server or paid API is required.

**[Complete editor guide and syntax reference](docs/guide.md)** · **[Nanosyntax: sources, algorithms and limits](docs/nanosyntax.md)**

The in-app **Guide** renders `docs/guide.md`, keeping the instructions and repository reference together.

![NanoTrees](docs/screenshot.png)

## Editing workflow

1. Choose an example or write `[TP [DP the cat] [VP sleeps]]`. Examples replace the whole canvas; save your work first.
2. Click a node or a white sheet to show its code. A caption/background selection hides the code. Invalid text highlights its error and retains the last valid picture.
3. **Edit** changes content and structure: New daughter/sister, Remerged daughter/sister, Mother, Triangle, Arrow, Delete, Branching, movement pronunciation, features, meanings, notes and clipboard operations.
4. **Customize** changes presentation at element, copy, tree or canvas scope. The far-right sliders button toggles the right panel. Panels open/close/resize without shifting the canvas; Fit explicitly recenters.
5. Save the entire canvas to `.nanotrees`, keep a named browser snapshot, share a link, or export the selected tree.

Manual mode draws the written hierarchy. X-bar mode can generate intermediate levels, head labels and specifiers. Movement chains support copies, traces and multidominance. Text supports Unicode, primes, subscripts/superscripts, inline bold/italic/strike, glosses, notes and feature stacks. Bundled and installed fonts are available; export embeds font data when available.

## Drag, copy and group

Drag a branch by its top node. Visible orange positions determine the relation and order: left/right of a node means preceding/following sister; below it are **n+1 daughter gaps** for n daughters. No modifier is needed to choose daughter versus sister.

- **Shift-drag a node:** independent copy.
- **Alt-drag a node:** linked copy; internal changes synchronize through `;link=group`.
- **Shift-drag empty space:** select a branch by rectangle.
- **Ctrl/Cmd+C / X / V:** copy/cut/paste; Shift+V pastes as sister, V without a node creates a tree. Ctrl/Cmd+D duplicates.

Moving within the same mother omits the two gaps beside the branch's current position, since dropping there would leave it in place. Those gaps remain available when copying.

Moving/copying works between trees and into an empty sheet. Root sisters and self-containing branches are rejected. Remerged daughter/sister creates another position of the same movement chain, which differs from an independent or linked clipboard copy.

Drag a tree's caption to move it. Right-click → Add to a group lets you choose a group/tree or pick one on the canvas. A group header moves its members. Add a node appears only for an empty tree. C and D are no longer tool shortcuts. Selected panel text retains ordinary copy behavior.

## Customize

For a selected node, line or arrow, the scope row offers This element, All copies when applicable, All elements in this tree, and All trees. A blank tree/canvas selection offers This tree / All trees. Local scope displays the relevant element's controls; general scope displays settings in blocks.

General changes use **Values of their own → Ask / Replace them / Keep them** when trees/elements/copies have private values. Replace clears the corresponding private override; Keep leaves it independent. The same policy governs nanosyntax rules. Other properties are preserved; an explicit `default` colour marker can retain inheritance for one property while leaving other branch colours intact.

Click a **tree line itself** to change its colour, width, pattern or extra length. These controls are separate from the node editor. Select an arrow to edit its colour, width, pattern and arrowheads in Customize; its movement meaning, endpoints, labels and geometry remain in Edit. Node controls include label size/colour, branch colour, spacing and meaning colour.

Customize also contains typography, layout, labelling, movement, semantics and export-sheet dimensions. **Circle phrasal spellout domains** is immediately after Movement and before Semantics. **Italic expressions** italicizes expressions, not syntactic terminal labels.

## Expressions and movement syntax

| Code | Behavior |
| --- | --- |
| `[N cat]`, `[N;spell=cat]`, `[N;spell="cat"]` | Equivalent simple terminal expression cat beneath N. |
| `[NumP;spell="fin" [Num]]` | Phrasal expression; Num remains a syntactic head. |
| `;spellside=left` / `right` | Force the phrasal exponent's side; default chooses free space. |
| `;spellfail=yes` | Failed phrasal expression, empty ∅ if unspecified, crossed spellout arrow. |
| `[DP#wh what] … #wh` | One constituent in several chain positions. |
| `#wh!`, `[DP#wh? what]` | Pronounce / silence a position. |
| `#wh"whom"`, `#wh$x : e$` | Position-specific pronunciation / meaning. |
| `#wh/2: ^ @gray edge=blue width=2` | Private style for position 2, on a line after the tree. |
| `[V#v;to=t sing]` | Head movement to #t. |
| `#v -> #t` | Equivalent head movement for appropriate head endpoints; `plain` instead makes a graphical arrow. |
| `#a -> #b plain dashed width=2 "label" @red` | Graphical arrow with explicit styling. |
| `#a -> #b out=below in=left from=node to=node` | Endpoint sides and head label anchors. |
| `#a -> #b via=0,40;-20,60` | Bend points relative to the midpoint of the endpoints. |
| `#wh/2 -> #wh/1 hide` / `visible` | Hide/show one movement arrow against the general switch. |
| `;edge=red;width=2;edgeline=dashed;len=20` | Incoming syntactic line colour, width, pattern and extra length. |
| `;wordedge=red;wordwidth=2;wordline=dotted` | Independent line to an expression. |
| `@red`, `@@blue`, `;size=24`, `;wordsize=20;wordcolor=blue` | Label/branch colour and label/expression typography. |

Phrasal spellout displays **tree ⇒ expression** on the right or **expression ⇐ tree** on the left. L-trees display **⇔**, exactly `\Leftrightarrow`. `[Num fin]` is a head with a word; `[NumP;spell="fin" [Num]]` is a phrasal lexical entry. The full guide covers glosses, features, notes, escaping, markup, arrow variants, pronunciation, semantics and all position options.

## Nanosyntactic derivations

1. Enable the top **Nanosyntax** button; it turns orange and the last panel tab appears.
2. Build an S-tree with feature nodes, then visually build ordinary trees for lexical entries. Right-click an entry → **Use as an L-tree…** → Whole canvas, a named S-tree, or Pick an S-tree on the canvas.
3. **New L-tree to this tree** adds an adjacent entry from an S-tree or lexical-group context menu. All L-trees remain visible editable trees using the same code, e.g. `[NumP;spell="fin" [Num]]`. Their menus can reassign scope or stop using them as lexical trees.
4. Select rules in the Nanosyntax tab at tree/canvas scope. Each choice has its own numbered explanation and source links.
5. Right-click an S-tree with entries or an L-tree → **Run spellout**. A global entry offers eligible owners by name. The action belongs to the context menu, not the settings tab.

The three independent choices are:

| Choice | Alternatives |
| --- | --- |
| Spellout-driven movement | Starke 2018: spec-to-spec then complement; Caha et al. 2025: closest labelled non-remnant evacuation, then successively larger containing constituents. |
| AUX closure | Late: keep growing AUX while spellout succeeds; Early: close it as soon as it lexicalizes. |
| Backtracking | Merge F in reopened AUX only, or in every reopened workspace independently (**Multiple Merge**). |

Each Merge is followed by spellout. When direct matching fails, try the selected evacuation procedure, backtracking, then a new AUX as last resort. The Superset Principle matches the whole syntactic constituent to a constituent contained in an L-tree; the fewest unused lexical features wins, with declaration order resolving ties. Multiple Merge recursively applies the same procedure to each reopened workspace; at least one must lexicalize F.

Independent workspaces appear as separate trees grouped per step until they combine; AUX merges as a left branch. The derivation is a group of snapshots. A lower copy and its arrow appear only on the operation moving that constituent; later lexicalization has no lower node or placeholder. The actual final successful step becomes Fully lexicalised, without an extra duplicate. Unmatched domains get ∅ and a crossed spellout arrow; the search continues where possible.

The general Examples menu includes **English of sugar** (Starke 2018), **Mara wili-gamiñ → wilamiñ** (Kloudová 2020), and **Friulian fin-iʃ** (published 2025 chapter), with visible lexical entries and derivations already built. Examples use abbreviated lower lexical domains; phonological Mara contraction is not a syntactic operation.

Turning Nanosyntax off hides L-trees, derivations and the tab without deleting them. Files/share links preserve all roles, scopes and groups. Rule changes require deriving again to create new snapshots. Search limits: 180 input nodes, 1,800 attempts, 700 trace steps; exhaustion is reported as incomplete. Pointers and language-specific licensing are not inferred.

Sources: [Starke 2018](https://doi.org/10.1093/oso/9780190876746.003.0009), [Caha 2019, chapters 6–7](https://ling.auf.net/lingbuzz/004875), [published 2025 chapter 1](https://doi.org/10.1093/9780198947158.003.0001). **Chapter 7 of the 2025 volume also discusses Multiple Merge**, Early and Late Closure: [Demonie 2025](https://doi.org/10.1093/9780198947158.003.0007). The 2025 evacuation revision does not prescribe a universal closure policy. Caha's Multiple Merge uses Early Closure; Multiple Merge with Late Closure is an available explicit combination in the app. See [the detailed source guide](docs/nanosyntax.md).

## Semantics

Write `$λx. cat(x) : <e,t>$` on a node. Typed lambda calculus supports named types and function types, quantifiers, logic, arithmetic and comparisons. Missing meanings compute bottom-up, trying Functional Application, Predicate Conjunction, Event Identification and Function Composition. Variable meanings on lower chain positions enable Predicate Abstraction. Type failures are displayed at the node. Customize controls computation, types, rule labels and colours; Edit can retain a computed meaning in the source. See [the complete reference](docs/guide.md).

## Files and export

A `.nanotrees` file, My trees snapshot or share link preserves the entire canvas. Browser autosave is local to that browser. Ctrl/Cmd+S writes a connected file again where supported; Open or file drop restores a canvas.

Export the selected tree as SVG, PNG, PDF, editable forest/tikz-qtree, or exact-layout TikZ. SVG/PNG/PDF/exact TikZ share scene geometry; editable LaTeX reflows according to its packages. Forest hosts multidominated nodes under one mother and adds extra edges; tikz-qtree repeats shared nodes. Bundled fonts work offline; installed-font embedding depends on browser permissions. Times New Roman export uses its metric-compatible twin Tinos.

`npm run build:offline` produces `dist-offline/nanotrees.html`: the application and bundled fonts in a single locally openable file.

## Development

```sh
npm install
npm run dev          # http://localhost:5173/tree/
npm run typecheck
npm test             # includes LaTeX compilation when the toolchain is installed
npm run build
npm run e2e          # Playwright, against the production preview
npm run build:offline
npm run screenshots
```

Core: `parser.ts` parses source spans; `build.ts` resolves display nodes, chains and meanings; `nanosyntax.ts` searches derivations; `layout.ts` and `arrows.ts` position geometry; `drop.ts` defines insertion gaps; `scene.ts` builds drawing primitives; `latex.ts` exports editable/exact LaTeX; `edits.ts` writes source changes. `overrides.ts` manages style inheritance; `docs/guide.md` supplies the in-app guide.

CI checks types, tests, LaTeX and Playwright, and deploys main to GitHub Pages.

## License

MIT © Gleb Bubnov. Bundled fonts use the SIL Open Font License.
