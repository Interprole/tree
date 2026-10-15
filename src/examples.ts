import type { BuildOptions } from './core/build';
import type { TreeStyle } from './core/style';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Example {
  id: string;
  title: string;
  note: string;
  src: string;
  build?: DeepPartial<BuildOptions>;
  style?: Partial<TreeStyle>;
}

export const examples: Example[] = [
  {
    id: 'xbar',
    title: 'X-bar: auto-projected clause',
    note: 'Written in shorthand; X-bar mode builds the X′ levels.',
    src: `% X-bar mode completes XP → X′ → X
[TP [DP [D the] [NP student]]
    [T will]
    [VP [V read]
        [DP [D a] [NP book]]]]`,
    build: { mode: 'xbar' },
  },
  {
    id: 'wh',
    title: 'Wh-movement and T-to-C as chains',
    note: '[DP#wh …] and #wh are two positions of one constituent. Switch between copies, traces and multidominance.',
    src: `% #wh and #t mark the positions of a moved constituent
[CP [DP#wh what]
    [C' [C #t]
        [TP [DP Mary]
            [T' [T#t did]
                [VP [V buy] #wh]]]]]`,
  },
  {
    id: 'head',
    title: 'Head movement: V-to-v-to-T',
    note: 'An arrow between two heads is head movement: the source is struck through, the target becomes V+v.',
    src: `[TP [DP#subj she]
    [T' [T#t -s]
        [vP #subj
            [v' [v#v ∅]
                [VP [V#root sing] [DP songs]]]]]]
#root -> #v
#v -> #t`,
  },
  {
    id: 'bps',
    title: 'Bare Phrase Structure: computed labels',
    note: 'Non-terminals are unlabelled; * marks the projecting daughter. Try the label style switch.',
    src: `% * marks the daughter that projects
[ [ [D* the] [N cat]]
  [* [T* will]
     [ [V* eat] [N fish]]]]`,
    build: { mode: 'bps', bps: { label: 'category' } },
  },
  {
    id: 'atb',
    title: 'Multidominance: ATB wh-movement',
    note: 'One wh-phrase with three mothers: [DP#wh …] defines it, #wh re-merges it.',
    build: { chains: 'multidominance' },
    src: `[CP [DP#wh which book]
    [C' [C did]
        [&P [TP [DP John] [VP [V buy] #wh]]
            [&' [& and]
                [TP [DP Mary] [VP [V sell] #wh]]]]]]`,
  },
  {
    id: 'nano',
    title: 'Nanosyntax: case sequence',
    note: 'Feature stacks in {…}; the coloured branch is spelled out by one morpheme.',
    src: `% Caha (2009): NOM ⊂ ACC ⊂ GEN ⊂ DAT
[DatP{K1, K2, K3, K4}
  [K4]
  [GenP{K1, K2, K3}
    [K3]
    [AccP@@#b4441c{K1, K2}
      [K2]
      [NomP{K1}
        [K1]
        [NP ^stol- | table]]]]]`,
    style: { leavesAtBottom: false },
  },
  {
    id: 'russian',
    title: 'Russian sentence with glosses',
    note: 'Glosses go after | ; ALL-CAPS abbreviations are set in small caps.',
    src: `[TP [DP мальчик | boy.NOM]
    [T' [T ∅]
        [VP [V читает | read.PRS.3SG]
            [DP [AP интересную | interesting.ACC.F]
                [NP книгу | book.ACC]]]]]`,
    style: { leavesAtBottom: true },
  },
  {
    id: 'semantics',
    title: 'Compositional semantics: Event Identification',
    note: 'Meanings go between $…$. The tree computes the rest: FA, Predicate Conjunction, Event Identification, Function Composition.',
    src: `% meanings of the leaves; the rest is computed (Kratzer 1996)
[VoiceP [DP Mary $mary : e$]
  [Voice' [Voice $λx_e.λe_s. agent(e)(x)$]
          [VP [V fed $λx_e.λe_s. feed(e) ∧ theme(e)(x)$]
              [DP [D the $λP_<e,t>. ιx. P(x)$]
                  [NP [A gray $λx. gray(x)$] [N cat $λx. cat(x)$]]]]]]`,
    build: { semantics: { show: true, compute: true, types: true } },
  },
];
