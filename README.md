# NanoTrees — syntax trees for linguists

**[→ Open NanoTrees](https://interprole.github.io/tree/)** · by Gleb Bubnov

NanoTrees is an interactive editor for syntactic trees, for papers, slides and teaching. Write a tree in bracket notation and it redraws as you type. You can also edit on the picture: every change on the canvas is written back into the text. Export to SVG, PNG, PDF or LaTeX (`forest`, `tikz-qtree`, TikZ).

![NanoTrees: meanings computed with Functional Application, Predicate Conjunction and Event Identification](docs/screenshot.png)

## Features

- **Bracket notation with live rendering.** Readable errors highlight their position, and the last valid tree stays on screen. Any Unicode works.
- **Typography close to a typeset paper.** Computer Modern, Libertinus, EB Garamond, Noto, a handwriting font, or any font installed on your computer. Real sub/superscripts, primes, small-caps glosses, feature stacks.
- **Labelling modes:**
  - *Manual*: as written.
  - *X-bar*: shorthand gets X′ levels filled in.
  - *Bare Phrase Structure*: labels come from the projecting daughter (`*`), shown as category, head or set.
- **Movement chains.** A chain is one constituent in several positions (`[DP#wh what] … #wh`). It can be drawn three ways:
  - **copies**: unpronounced copies regular, gray, struck through or ⟨in angle brackets⟩;
  - **traces**: `t`;
  - **multidominance**: one node, several mothers.

  Several copies can be pronounced (`#wh!`). Arrows between positions are drawn automatically and each can be edited. Movement indices are separate from the indices you type for binding.
- **Head movement.** An arrow between two heads strikes out the source and labels the target as a complex head (V+v, V+v+T).
- **Compositional semantics.** Write meanings as `$λx. cat(x) : <e,t>$`. The meanings of the other nodes are computed bottom-up with Functional Application, Predicate Conjunction, Event Identification and Function Composition. Type errors are shown at the node.
- **Canvas editing:**
  - rename, add daughters or sisters;
  - add an existing constituent again by clicking it (a new chain position);
  - triangles that keep the structure in the code;
  - features, meanings, colours (a node or its branch);
  - bundling sister heads into X.Y;
  - re-bracketing a node (flat, right- or left-branching);
  - c-command and dominance highlighting;
  - undo and redo.
- **Export and sharing:**
  - SVG and PDF with embedded fonts, PNG up to 576 dpi;
  - LaTeX code, tested by compiling it with `pdflatex`/`lualatex`;
  - share links, autosave, a list of saved trees.
- **Interface:** every setting can be reset on its own; light and dark themes; mobile layout; a built-in guide (button *Guide*).

## Bracket notation

| Write | Meaning |
|---|---|
| `[TP [DP the cat] [VP sleeps]]` | node = `[Label daughters…]`; words become terminals |
| `[ [D the] [N cat]]` | empty label (computed in BPS mode) |
| `T'` `DP_i` `X^0` `\phi` `\0` | prime, subscript, superscript, φ, ∅ |
| `[V читает \| read.PRS.3SG]` | gloss line under the terminal (ALL-CAPS → small caps) |
| `[T{uφ, iT, EPP} will]` | feature stack |
| `[DP ^the big cat]` / `[DP ^ [D the] [N cat]]` | triangle (over words / over a structure, which stays in the code) |
| `[DP@red …]`, `[DP@@#06c …]` | colour a node / its whole branch |
| `[V* eat]` | projecting daughter (BPS) |
| `[DP#wh what] … #wh` | a chain: the same constituent in two positions |
| `#wh!`, `[DP#wh? what]` | pronounce / silence a position |
| `$λx_e.λe_s. agent(e)(x)$` | a meaning (optionally `: <type>`) |
| `#a -> #b dashed "label" @red` | an arrow (after the tree); between heads it is head movement |
| `#wh/2 -> #wh/1 hide` | restyle or hide one automatic chain arrow |
| `% comment` | comment to the end of the line |

Example: head movement, together with a subject chain.

```
[TP [DP#subj she]
    [T' [T#t -s]
        [vP #subj
            [v' [v#v ∅]
                [VP [V#root sing] [DP songs]]]]]]
#root -> #v
#v -> #t
```

![Head movement, dark theme](docs/screenshot-dark.png)

## Semantics

Types are `e`, `t`, `s` (events) and `<a,b>`. A variable without a type is `e` (x, y, z), `s` (e, e′) or `<e,t>` (P, Q); write `λx_e.` to be explicit. For a node with two daughters, the first rule that applies is used:

| Rule | Applies to | Result |
|---|---|---|
| FA | ⟨a,b⟩ and a | ⟦β⟧(⟦γ⟧) |
| PC | two predicates of the same type | λa₁…aₙ. β(a…) ∧ γ(a…) |
| EI | ⟨e,⟨s,t⟩⟩ and ⟨s,t⟩ | λx.λe. β(x)(e) ∧ γ(e) |
| FC | ⟨b,c⟩ and ⟨a,b⟩ | λx. β(γ(x)) |

A daughter without any meaning below it counts as vacuous. If no rule applies, the node shows the failing types.

## LaTeX

The `forest` export is plain bracket code. Arrows and extra multidominance branches are TikZ `\draw` commands after the tree. Meanings and features are added as extra lines in the node. The test suite compiles every example in every format with `pdflatex`.

Limitation: in `forest`, a multidominated node is written under one of its mothers; the other branches are drawn as straight lines. Use the *TikZ (exact layout)* export to reproduce the app's placement.

## Development

```sh
npm install
npm run dev          # http://localhost:5173/tree/
npm test             # unit tests (Vitest); LaTeX compilation runs when pdflatex + forest are installed
npm run build && npm run e2e          # Playwright tests
npm run screenshots  # screenshots of all examples → screenshots/out
```

```
src/core/      no DOM, tested on its own
  parser.ts    bracket notation → AST with source spans and errors
  build.ts     AST → display tree: chains (copies/traces/MD), head movement, triangles, meanings
  modes.ts     X-bar projection and BPS labelling
  semantics.ts typed λ-calculus, β-reduction, composition rules
  layout.ts    tidy layout, multidominance placement and routing
  arrows.ts    movement arrows
  scene.ts     drawing primitives → SVG, PNG, PDF
  latex.ts     forest / tikz-qtree / TikZ export
  edits.ts     canvas operations as minimal text edits
  analysis.ts  c-command and dominance
```

CI runs the type check, unit tests, LaTeX compilation and Playwright on every push, and deploys `main` to GitHub Pages.

## License

MIT © Gleb Bubnov. Bundled fonts (CMU Serif, Libertinus, EB Garamond, Noto, Caveat, STIX Two Math, IBM Plex Mono) are under the SIL Open Font License.
