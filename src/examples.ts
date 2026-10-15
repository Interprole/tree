import type { BuildOptions } from './core/build';
import type { TreeStyle } from './core/style';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Example {
  id: string;
  title: { en: string; ru: string };
  note: { en: string; ru: string };
  src: string;
  build?: DeepPartial<BuildOptions>;
  style?: Partial<TreeStyle>;
}

export const examples: Example[] = [
  {
    id: 'xbar',
    title: { en: 'X-bar: auto-projected clause', ru: 'X-bar: автоматические проекции' },
    note: {
      en: 'Written in shorthand; X-bar mode builds the X′ levels.',
      ru: 'Записано сокращённо; режим X-bar сам достраивает уровни X′.',
    },
    src: `% X-bar mode completes XP → X′ → X
[TP [DP [D the] [NP student]]
    [T will]
    [VP [V read]
        [DP [D a] [NP book]]]]`,
    build: { mode: 'xbar' },
  },
  {
    id: 'wh',
    title: { en: 'Wh-question with movement arrows', ru: 'Wh-вопрос со стрелками передвижения' },
    note: {
      en: 'Arrows come from coindexed traces (t_i, t_j); drag an arrow to bend it.',
      ru: 'Стрелки строятся по коиндексации следов (t_i, t_j); стрелку можно изгибать мышью.',
    },
    src: `[CP [DP_i what]
    [C' [C did_j]
        [TP [DP Mary]
            [T' [T t_j]
                [VP [V buy] [DP t_i]]]]]]`,
  },
  {
    id: 'bps',
    title: { en: 'Bare Phrase Structure: computed labels', ru: 'BPS: вычисляемые ярлыки' },
    note: {
      en: 'Non-terminals are unlabelled; * marks the projecting daughter. Try the label style switch.',
      ru: 'Нетерминалы без ярлыков; * отмечает проецирующую дочку. Переключите вид ярлыков.',
    },
    src: `% * marks the daughter that projects
[ [ [D* the] [N cat]]
  [* [T* will]
     [ [V* eat] [N fish]]]]`,
    build: { mode: 'bps', bps: { label: 'category' } },
  },
  {
    id: 'atb',
    title: { en: 'Multidominance: ATB wh-movement', ru: 'Мультидоминирование: ATB-передвижение' },
    note: {
      en: 'One wh-phrase with three mothers: [DP#wh …] defines it, #wh re-merges it.',
      ru: 'Одна wh-группа с тремя матерями: [DP#wh …] задаёт узел, #wh — повторное слияние.',
    },
    src: `[CP [DP#wh which book]
    [C' [C did]
        [&P [TP [DP John] [VP [V buy] #wh]]
            [&' [& and]
                [TP [DP Mary] [VP [V sell] #wh]]]]]]`,
  },
  {
    id: 'nano',
    title: { en: 'Nanosyntax: case sequence', ru: 'Наносинтаксис: падежная последовательность' },
    note: {
      en: 'Feature stacks in {…}; the coloured branch is spelled out by one morpheme.',
      ru: 'Стопки признаков в {…}; выделенная ветка лексикализуется одной морфемой.',
    },
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
    title: { en: 'Russian sentence with glosses', ru: 'Русское предложение с глоссами' },
    note: {
      en: 'Glosses go after | ; ALL-CAPS abbreviations are set in small caps.',
      ru: 'Глоссы пишутся после | ; аббревиатуры ПРОПИСНЫМИ набираются капителью.',
    },
    src: `[TP [DP мальчик | boy.NOM]
    [T' [T ∅]
        [VP [V читает | read.PRS.3SG]
            [DP [AP интересную | interesting.ACC.F]
                [NP книгу | book.ACC]]]]]`,
    style: { leavesAtBottom: true },
  },
  {
    id: 'binding',
    title: { en: 'Binding theory check', ru: 'Проверка принципов связывания' },
    note: {
      en: 'Turn on the binding check: himself_i is not bound in its clause (Principle A).',
      ru: 'Включите проверку связывания: himself_i не связан в своей клаузе (Принцип A).',
    },
    src: `[TP [DP_i John]
    [T' [T -s]
        [VP [V think]
            [CP [C that]
                [TP [DP Bill]
                    [T' [T -s]
                        [VP [V like] [DP himself_i]]]]]]]]`,
  },
];
