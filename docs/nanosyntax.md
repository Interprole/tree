# Nanosyntactic derivations

The top-bar **Nanosyntax** button enables the nanosyntax section and turns orange.
Disabling it hides the section, L-trees and derivation sheets while preserving all
of them in the canvas file. The ordinary right panel stays open. The far-right
settings button independently opens or closes that panel.

## Expressions and lexical trees

An expression is always stored in the same node option:

    [N;spell="cat"]
    [NumP;spell="fin" [Num]]

A terminal expression is displayed below its label. A phrasal expression appears
beside the constituent: **tree ⇒ expression** on the right, or
**expression ⇐ tree** on the left. L-trees use **⇔** (`\Leftrightarrow`) to indicate
a lexical correspondence. Failed phrasal expressions retain ∅ and a crossed arrow.
The same rendering is used by SVG, PNG, PDF and LaTeX exports. Appearance contains
Italic expressions and Circle phrasal spellout domains.

Every L-tree is an ordinary tree on the canvas with the ordinary bracket editor
and node inspector. There is no separate lexical-tree editor. A terminal tree
assigned as a lexical entry is projected, for example [Num fin] becomes
[NumP;spell="fin" [Num]].

Right-click a tree and choose **Use as an L-tree…**. The dialog offers Whole canvas,
an S-tree from the list, or **Pick an S-tree on the canvas**. Right-click an L-tree
to change its scope or stop using it as an L-tree. **New L-tree to this tree** adds
an adjacent lexical entry; the same action is available inside a group containing
L-trees. Tree-scoped entries stay with their owner when it moves.

## Derivation display

The Nanosyntax tab contains three independent algorithm choices. Each choice is
followed immediately by numbered explanations and source links. Settings apply
to this tree or the whole canvas. Canvas changes use the same **Values of their
own** dialog and Ask / Replace / Keep preference as Appearance; replacing one
rule leaves the tree's other overrides intact. Tree overrides can be reset to
the canvas settings.

To build a derivation, right-click an S-tree with L-trees or an L-tree and choose
**Derive**. A local L-tree derives its owner; a canvas L-tree offers each eligible
S-tree by name. This action is also available when right-clicking a node. **Add
a node** appears only on an empty tree.

Each operation is a snapshot. A lower movement copy and its movement arrow appear
only on the operation that moves that particular constituent. Later lexicalization
steps have neither the copy nor an empty placeholder nor that arrow. Earlier
copies are not repeated when a different constituent moves.

Independent workspaces remain separate trees. At each step before Merge combines
them, their sheets are grouped together; they have no artificial shared syntactic
mother. The entire derivation is also framed as a group. The actual last successful
operation is labelled Fully lexicalised without a duplicate final snapshot.

Any ordinary trees can also be grouped through **Add to a group…** in the tree
context menu. Choose a group or another tree, or pick on the canvas. Group headers
move their members together. Groups, lexical scope, sources and positions are
saved in canvas files and share links.

Code is shown only for a selected node or a selected white sheet. Selecting a
caption or the canvas background hides it. Appearance settings are in the right
panel, rather than below the code.

## Independent algorithm choices

The movement rule, AUX closure policy and distribution of F after backtracking
are independent. All eight combinations can be derived and saved. Legacy
algorithm names in existing canvas files still load with their original settings.

### 1. Spellout-driven movement

1. Merge F and try lexicalization of FP.
2. Under **Starke 2018**, try spec-to-spec movement, then undo it and try
   complement (snowball) movement.
3. Under **Caha et al. 2025**, evacuate the closest labelled **non-remnant**
   constituent. If that fails, evacuate its immediately dominating constituent,
   recursively (pied-piping). A remnant has already undergone extraction. This
   formulation derives spec and complement movement and permits subextraction.
4. When movements fail, backtrack to an earlier cycle and try its next option.
5. Only after backtracking fails, build a lexicalizable XP providing F in a new
   auxiliary workspace and merge it as a complex left branch.

Sources: [Starke 2018](https://doi.org/10.1093/oso/9780190876746.003.0009),
§9.2 (1)–(2), pp. 245–246;
[De Clercq, Caha, Starke and Vanden Wyngaerd 2025](https://doi.org/10.1093/9780198947158.003.0001),
§1.4 (25), §1.6 (45), pp. 33–37.

### 2. Auxiliary workspace closure

1. **Late Closure (Starke 2018):** keep AUX open, trying each next feature there
   first with the selected spellout procedure. Keep growing while it succeeds.
2. When AUX can no longer grow, close it and continue on the combined main tree.
   Open workspaces are displayed as separate trees until closure.
3. **Early Closure (Caha 2019):** close AUX as soon as it can lexicalize. The next
   feature is tried on the combined root. Failure can reopen AUX by backtracking.

Sources: [Starke 2018](https://doi.org/10.1093/oso/9780190876746.003.0009),
tentative proposal in §9.3, pp. 248–249;
[Caha 2019](https://ling.auf.net/lingbuzz/004875), §6.4 (36), §6.5 (73), pp. 168–181.

The **2025 movement revision does not impose a universal closure policy**.
Chapter 7 of that volume uses Late Closure for Dutch ont- (p. 222) and discusses
Caha's Early Closure alongside Multiple Merge (§7.5, rule (39), pp. 240–243,
footnote 10).
[Demonie 2025, chapter 7](https://doi.org/10.1093/9780198947158.003.0007).

### 3. Merge F after reopening workspaces

1. Return to the preceding cycle and try its next option, replaying younger cycles.
2. When backtracking reaches Spec formation, separate AUX and the main spine.
3. **AUX only:** try F in AUX, including movement rescue. F must co-spellout with
   material of the old Spec (Caha 2019, chapter 6, §6.5 (73)/(104)).
4. **Multiple Merge:** try F in **every** reopened workspace independently.
   Apply the same movement and backtracking procedure to each. If deeper Specs
   reopen, apply Multiple Merge there recursively (§7.3 (14)–(19), pp. 204–206).
5. Keep all successful occurrences of F and undo failed ones. At least one workspace
   must successfully lexicalize F. Recombine successful derivations in the original
   branch order. If every workspace fails, open a new AUX for F as the last resort.

[Caha 2019](https://ling.auf.net/lingbuzz/004875), chapters 6–7.
Caha combines Multiple Merge with Early Closure. Selecting Multiple Merge with
Late Closure in the app is an available extension: the next feature may again
grow AUX first. This combination is not attributed to Caha's chapter 7.

Existing real-word examples choose their original combinations: Starke = old
movement + Late Closure + AUX only; Caha 2019 = old movement + Early Closure +
AUX only; the 2025 example = revised evacuation + Early Closure + AUX only.

## Real-word example canvases

Choosing an example replaces the whole canvas. Nanosyntax examples include their
S-tree, all L-trees, and an already-built derivation:

| Algorithm | Example | Source |
| --- | --- | --- |
| Starke 2018 | English **of sugar** | §9.3, pp. 246–249, Figures 9.15–9.20 |
| Kloudová 2020 | Mara **wili-gamiñ**, contracted to **wilamiñ** “women” | Kloudová (2020), §5.3.1, pp. 65–69; Mara lexical entries also in §3.4, pp. 47–49 |
| Caha et al. 2025 | Friulian **fin-iʃ** (1SG) | Published chapter 1, §1.6, pp. 33–37, (45)–(49), Table 1.10 |

The Mara tree represents the morphological sequence before phonological contraction;
contraction is not an operation of the syntactic algorithm. Lower lexical domains
abbreviated in the papers are represented uniformly by matching minimal subtrees.

Additional checked fixtures cover Ossetic max-æj, Finnish karhu-i-ssa, Czech
jazyk-a, Friulian 3SG/2SG, and the schematic early-/late-closure comparison.
Czech root shrinking is discussed in the published 2025 chapter, §1.4.3,
pp. 21–23, Tables 1.4–1.5, (32).

## Matching and limits

Lexical matching uses identity with whole constituents contained in an L-tree
(the Superset Principle). The smallest number of unused lexical features wins;
declaration order breaks ties, with local entries before canvas entries. Failed
domains are marked with an empty failed expression, and derivation continues.

The input limit is 180 nodes; search is bounded by 1,800 attempts and 700 trace
steps. A reached limit is reported as incomplete. Multiple Merge is enabled only
by its explicit setting. Pointers, agreement licensing and language-specific
semantic restrictions are not inferred automatically.

## Sources

- Michal Starke (2018), “Complex Left Branches, Spellout, and Prefixes”, in
  Exploring Nanosyntax, §§9.2–9.3.
- Pavel Caha (2019), Case Competition in Nanosyntax, §§4–7.
  [Book](https://ling.auf.net/lingbuzz/004875).
- Václava Kloudová (2020), The Interaction of Functional Morphemes inside the
  Nominal Phrase, especially §§3.4, 5.2 and 5.3.1.
- Karen De Clercq, Pavel Caha, Michal Starke and Guido Vanden Wyngaerd (2025),
  “Nanosyntax: State of the art and recent developments”, pp. 1–44, in Pavel Caha,
  Karen De Clercq and Guido Vanden Wyngaerd (eds.), Nanosyntax and the Lexicalization
  Algorithm, Oxford University Press.
  [Chapter DOI](https://doi.org/10.1093/9780198947158.003.0001);
  [Book DOI](https://doi.org/10.1093/9780198947158.001.0001).
