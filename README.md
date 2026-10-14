# Treeform — syntax trees for linguists

**[→ Open Treeform](https://interprole.github.io/tree/)**

Treeform is an interactive editor for syntactic trees for papers, slides and teaching. You type bracket notation and the tree redraws as you type. You can also edit directly on the picture: rename, add, delete, recolour, draw movement arrows. Every canvas edit is written back into the text. The result exports to SVG, PNG, PDF or LaTeX (`forest`, `tikz-qtree`, TikZ).

![Treeform: a wh-question with movement arrows](docs/screenshot.png)

## Features

- **Live bracket notation** with readable error messages. The error position is highlighted, and the last valid tree stays on screen. Cyrillic and any Unicode work.
- **Typography close to a typeset paper.** Computer Modern (CMU Serif), Libertinus, EB Garamond, Noto, plus a handwritten font for board-style pictures. Real sub/superscripts, primes, small-caps glosses.
- **Three labelling modes:**
  - *Manual*: everything as written.
  - *X-bar*: shorthand gets XP → X′ → X filled in automatically, with options for X′, X vs X⁰, prime vs overline, and empty specifiers.
  - *Bare Phrase Structure*: labels are computed from the projecting daughter (marked `*`). They can be shown as a category (`D`), a head (`the`) or a set (`{the, {the, cat}}`).
- **Multidominance.** One node with several mothers, placed between them, with branches routed around labels. A switch shows the same tree with copies instead.
- **Movement arrows:**
  - generated automatically from coindexed traces (`t_i`, `<copy>`), or written explicitly (`#a -> #b`);
  - drawn with the mouse; bends can be dragged;
  - styles: solid, dashed or dotted; heads; labels; routed under the tree or as a direct curve;
  - nested arrows get separate levels, so they don't run over each other.
- **Analysis tools:** c-command domain, dominance, and a check of binding Principles A/B/C.
- **Export:**
  - SVG (fonts embedded), PNG at any scale (optionally transparent), vector PDF;
  - LaTeX code that is compiled with `pdflatex` in CI;
  - copy SVG, image or bracket notation to the clipboard.
- **Share and keep trees:** a link encodes the tree and its settings; the current tree autosaves locally; a "My trees" list stores saved ones.
- Light/dark interface, English/Russian, keyboard shortcuts, mobile layout.

## Bracket notation

| Write | Meaning |
|---|---|
| `[TP [DP the cat] [VP sleeps]]` | node = `[Label daughters…]`; words become terminals |
| `[ [D the] [N cat]]` | empty label (computed in BPS mode) |
| `T'` `T''` | primes T′ T″ |
| `DP_i`, `DP_{i,j}` | subscript; also the coindex |
| `X^0`, `X^{max}` | superscript X⁰ |
| `\phi \alpha \0` | symbols φ α ∅ (type `\` for a list) |
| `"a [literal]"`, `\[`, `big~label` | literal text, escapes, a space inside a label |
| `[DP ^the big cat]` | triangle over an unanalysed constituent |
| `[V čitaet \| read.PRS.3SG]` | gloss line under the terminal; ALL-CAPS → small caps; several `\|` allowed |
| `[DP t_i]`, `[DP <what>]`, `[<DP> the cat]` | trace; lower copy (grey / struck through / ⟨angled⟩) |
| `[T{uφ, iT, EPP} will]` | feature stack under the node |
| `[V* eat]` | projecting daughter (BPS) |
| `[DP@red …]`, `[DP@@#06c …]` | colour a node / the whole branch |
| `[DP#wh what] … #wh` | define an id and re-merge it: one node, two mothers |
| `#t -> #w dashed "wh" @red` | explicit arrow after the tree: `->` `<->` `<-` `--`, `dashed`/`dotted`, `curve`, `"label"`, `bend=dx,dy` |
| `% comment` | comment to the end of the line |

Example (multidominance, ATB movement):

```
[CP [DP#wh which book]
    [C' [C did]
        [&P [TP [DP John] [VP [V buy] #wh]]
            [&' [& and]
                [TP [DP Mary] [VP [V sell] #wh]]]]]]
```

## LaTeX

The `forest` export is plain bracket code. Arrows and extra multidominance branches are TikZ `\draw` commands after the tree. Preamble: `\usepackage[linguistics]{forest}`, `\usetikzlibrary{arrows.meta, calc}`, `amssymb`, `xcolor`, or tick “Complete document”. The test suite compiles every example in every format with `pdflatex`, and the forest output also with `lualatex`.

Limitation: in `forest`, a multidominated node is written under one of its mothers, and the other branches are drawn as straight lines. Use the *TikZ (exact layout)* export to reproduce the app's placement exactly.

## Development

```sh
npm install
npm run dev          # http://localhost:5173/tree/
npm test             # unit tests (Vitest); LaTeX compilation tests run when pdflatex + forest are installed
npm run build && npm run e2e          # Playwright functional tests
npm run screenshots  # screenshots of all examples (light/dark/mobile) → screenshots/out
```

Architecture (`src/core` has no DOM dependencies and is tested on its own):

```
parser.ts    bracket notation → AST with source spans and errors
build.ts     AST → display tree (multidominance, copies, traces, automatic arrows)
modes.ts     X-bar projection and BPS labelling
layout.ts    tidy layout, terminal baseline, triangles, multidominance placement and routing
arrows.ts    movement arrow geometry and levels
scene.ts     backend-independent drawing primitives → render/svg.ts, export (PNG, PDF)
latex.ts     forest / tikz-qtree / TikZ export
edits.ts     canvas operations as minimal text edits (undo, sync)
analysis.ts  c-command, dominance, binding principles
```

CI (`.github/workflows`) runs the type check, unit tests, LaTeX compilation and Playwright on every push, and deploys `main` to GitHub Pages.


## License

MIT. Bundled fonts: CMU Serif, Libertinus, EB Garamond, Noto, Caveat, IBM Plex Mono — all under the SIL Open Font License.
