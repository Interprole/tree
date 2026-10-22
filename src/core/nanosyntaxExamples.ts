import type { LexicalEntry, NSAlgorithm } from './nanosyntax';

export interface NanosyntaxExample {
  id: string;
  title: string;
  algorithm: NSAlgorithm;
  source: string;
  entries: LexicalEntry[];
  description: string;
  citation: string;
  expectedSurface: string[];
}
const entry = (id: string, expression: string, source: string): LexicalEntry => ({ id, expression, source });
const closureEntries = [entry('gamma', 'γ', '[F1]'), entry('beta', 'β', '[F2P [F2] [Base]]'), entry('alpha', 'α', '[F3]')];
const friulianEntries = [
  // #P is named NumP to avoid confusing a feature with the editor's #id syntax.
  // The lower TP domain is uniformly abbreviated in both S- and L-trees.
  entry('fin', 'fin', '[Num]'),
  entry('ish', '-iʃ', '[SPKRP [SPKR] [ [πP [π]] [PARTP [PART]]]]'),
  entry('s', '-s', '[PART]'),
];

/** Checked source fixtures. Lower lexical domains indicated by triangles or
 * ellipses in the papers are represented by matching minimal subtrees here;
 * no inference is made about their internal feature decomposition. */
export const nanosyntaxExamples: NanosyntaxExample[] = [
  {
    id: 'starke-sugar-of', title: 'Starke 2018: of sugar', algorithm: 'starke2018',
    source: '[K3 [K2 [K1 [Z [Y [X]]]]]]',
    entries: [entry('sugar', 'sugar', '[Z [Y [X]]]'), entry('null-case', '∅', '[K2P [K2] [K1P [K1] [Z]]]'), entry('of', 'of', '[K3P [K3] [K2P [K2] [K1P [K1] [Z]]]]')],
    description: 'A binary-bottom case prefix is built in a separate workspace. Under Starke’s tentative late-closure proposal it grows through K1, K2 and K3 before merging with sugar; of overrides the earlier zero spellout.',
    citation: 'Starke (2018), “Complex Left Branches, Spellout, and Prefixes”, §9.3, pp. 246–249, Figures 9.15–9.20. The X… domain is abbreviated.',
    expectedSurface: ['of', 'sugar'],
  },
  {
    id: 'starke-late-closure', title: 'Starke 2018: late AUX closure (β–α–γ)', algorithm: 'starke2018',
    source: '[F3 [F2 [F1]]]', entries: closureEntries,
    description: 'The new F3 suffix is first tried in the still-open auxiliary workspace. Its complement moves inside that workspace, giving β–α–γ. Compare the Caha 2019 version of exactly the same input and lexicon.',
    citation: 'Starke (2018), §9.3, pp. 248–249; contrasting schematic derivation in Caha (2019), §6.4, pp. 168–173, (37)–(41), (53). Base explicitly represents the binary bottom of β.',
    expectedSurface: ['β', 'α', 'γ'],
  },
  {
    id: 'caha-early-closure', title: 'Caha 2019: early AUX closure (β–γ–α)', algorithm: 'caha2019',
    source: '[F3 [F2 [F1]]]', entries: closureEntries,
    description: 'Immediately close the successful F2 workspace. F3 is therefore merged on the main spine; complement movement produces the phrasal suffix order β–γ–α rather than β–α–γ.',
    citation: 'Caha (2019), Case Competition in Nanosyntax, §6.4, pp. 168–174, Early AUX Closure (36), derivation (46)–(52). Base explicitly represents the binary bottom of β.',
    expectedSurface: ['β', 'γ', 'α'],
  },
  {
    id: 'caha-mara-portmanteau', title: 'Kloudová 2020: Mara wilamiñ (wili-gamiñ)', algorithm: 'caha2019',
    source: '[Kobl [Num [NP [N] [Root]]]]',
    entries: [entry('mara-root', 'gamiñ', '[NP [N] [Root]]'), entry('mara-wili', 'wili-', '[KoblP [Kobl] [NumP [Num] [N]]]')],
    description: 'Mara wilamiñ “women” is underlying wili-gamiñ before contraction (Kloudová, following Heath 1981: 72). Num first requires a binary-bottom prefix. Early closure merges it with the noun. Kobl then fails on the main spine; backtracking reopens the Num workspace and derives the case–number prefix wili-.',
    citation: 'Kloudová (2020), The Interaction of Functional Morphemes inside the Nominal Phrase, §5.3.1, pp. 65–69, algorithm (14), Mara entries/derivation (15)–(21). The nominal lexical domain is abbreviated as NP N Root.',
    expectedSurface: ['wili-', 'gamiñ'],
  },
  {
    id: 'caha-ossetic-max', title: 'Caha 2019: Ossetic max-æj', algorithm: 'caha2019',
    source: '[Ins [Gen [Acc [Nom [Pl [Num [Spkr [Part [Ref]]]]]]]]]',
    entries: [entry('max', 'max', '[Gen [Acc [Nom [Pl [Num [Spkr [Part [Ref]]]]]]]]'), entry('zero-case', '∅', '[Acc [Nom]]'), entry('aej', '-æj', '[Ins [Gen [Acc [Nom]]]]')],
    description: 'The pronoun initially covers nominative through genitive. Instrumental fails, and backtracking shrinks max below nominative; successive evacuation then lets -æj lexicalise the case domain.',
    citation: 'Caha (2019), §4.5, pp. 118–122, Table 4.3 and (55)–(64). As in (57) and fn. 4, unavailable locative is omitted; # and f1–f4 are displayed as Num and case names.',
    expectedSurface: ['max', '-æj'],
  },
  {
    id: 'kloudova-finnish', title: 'Kloudová: Finnish karhu-i-ssa', algorithm: 'caha2019',
    source: '[K2 [K1 [Num [NP [N] [Root]]]]]',
    entries: [entry('karhu', 'karhu', '[NP [N] [Root]]'), entry('t', '-t', '[K1 [Num]]'), entry('i', '-i', '[Num]'), entry('ssa', '-ssa', '[K2 [K1]]')],
    description: 'K1 initially spells out with Num as -t. Inessive K2 has no match in that configuration. Backtracking changes K1 from spec movement to complement movement, exposing Num as -i and the case sequence as -ssa.',
    citation: 'Kloudová (2020), §5.2, pp. 61–65, Finnish lexicon (5) and derivation (6)–(13). The nominal lexical domain is abbreviated; Num means plural.',
    expectedSurface: ['karhu', '-i', '-ssa'],
  },
  {
    id: 'caha-czech-jazyka', title: 'Caha et al. 2025: Czech jazyk-a', algorithm: 'caha2025',
    source: '[K3 [K2 [K1 [SG [NP [N] [Root]]]]]]',
    entries: [entry('jazyk', 'jazyk', '[K2 [K1 [SG [NP [N] [Root]]]]]'), entry('a', '-a', '[K3 [K2 [K1 [SG]]]]')],
    description: 'The root jazyk covers through accusative K2. Genitive K3 forces backtracking down to SG: NP evacuates and the suffix -a takes over SG and all case features.',
    citation: 'De Clercq, Caha, Starke and Vanden Wyngaerd (2025), “Nanosyntax: State of the art and recent developments”, §1.4.3, pp. 21–23, Tables 1.4–1.5 and (32). DOI: 10.1093/9780198947158.003.0001. NP is abbreviated uniformly.',
    expectedSurface: ['jazyk', '-a'],
  },
  {
    id: 'caha-friulian-3sg', title: 'Caha et al. 2025: Friulian fin-iʃ (3SG)', algorithm: 'caha2025',
    source: '[π [Num]]', entries: friulianEntries,
    description: 'The small fin root reaches only NumP (#P in the paper). Evacuating it lets the πP constituent inside the lexical tree of -iʃ spell out the third person.',
    citation: 'De Clercq, Caha, Starke and Vanden Wyngaerd (2025), “Nanosyntax: State of the art and recent developments”, §1.6, pp. 35–36, Table 1.10, (46)–(47). DOI: 10.1093/9780198947158.003.0001. NumP abbreviates #P and its lower TP domain.',
    expectedSurface: ['fin', '-iʃ'],
  },
  {
    id: 'caha-friulian-2sg', title: 'Caha et al. 2025: Friulian fin-iʃ-s (2SG)', algorithm: 'caha2025',
    source: '[PART [π [Num]]]', entries: friulianEntries,
    description: 'Moving NumP alone fails at PART. Pied-piping its immediately dominating unlabelled constituent succeeds, leaving the unary PARTP to be spelled out as -s.',
    citation: 'De Clercq, Caha, Starke and Vanden Wyngaerd (2025), “Nanosyntax: State of the art and recent developments”, §1.6, pp. 35–37, Table 1.10, (46)–(48). DOI: 10.1093/9780198947158.003.0001. NumP abbreviates #P and its lower TP domain.',
    expectedSurface: ['fin', '-iʃ', '-s'],
  },
  {
    id: 'caha-friulian-1sg', title: 'Caha et al. 2025: Friulian fin-iʃ (1SG)', algorithm: 'caha2025',
    source: '[SPKR [PART [π [Num]]]]', entries: friulianEntries,
    description: 'At SPKR, extract NumP from inside the complex left branch. The stranded πP between SPKR and PART gives exactly the lexical tree of -iʃ, which overrides -s. Starke 2018 and Caha 2019 cannot derive this input with these entries.',
    citation: 'De Clercq, Caha, Starke and Vanden Wyngaerd (2025), “Nanosyntax: State of the art and recent developments”, §1.6, pp. 33–37, algorithm (45), Table 1.10, lexical entries (46), derivation (47)–(49). DOI: 10.1093/9780198947158.003.0001. NumP abbreviates #P and its lower TP domain.',
    expectedSurface: ['fin', '-iʃ'],
  },
];
