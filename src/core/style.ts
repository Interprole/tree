/** Visual settings of a tree (everything that the appearance panel controls). */

export type BuiltinFont = 'cmu' | 'libertinus' | 'garamond' | 'noto-serif' | 'noto-sans' | 'caveat';
/** a built-in font, or "local:Family Name" for a font installed on the computer */
export type FontId = BuiltinFont | `local:${string}`;

export function isLocalFont(f: FontId): f is `local:${string}` {
  return f.startsWith('local:');
}

/** CSS font-family list for a font id. */
export function fontCss(f: FontId): string {
  if (isLocalFont(f)) return `"${f.slice(6).replace(/"/g, '')}", "NanoTrees Symbols", serif`;
  return (FONT_FAMILIES[f] ?? FONT_FAMILIES.cmu).css;
}

export interface TreeStyle {
  font: FontId;
  /** label font size in px */
  fontSize: number;
  /** vertical gap between levels */
  levelGap: number;
  /** horizontal gap between sister subtrees */
  siblingGap: number;
  /** padding around the picture */
  padding: number;
  lineWidth: number;
  lineColor: string;
  /** non-terminal labels */
  nodeColor: string;
  /** terminals */
  leafColor: string;
  leafItalic: boolean;
  /** terminals on a common baseline */
  leavesAtBottom: boolean;
  /** how unpronounced copies look */
  copyStyle: 'regular' | 'gray' | 'strike' | 'angle';
  /** colour of movement arrows */
  arrowColor: string;
  /** gap between a label and the branches */
  edgeGap: number;
  /** slightly irregular "hand-drawn" lines */
  handDrawn: boolean;
  /** bold non-terminal labels */
  nodeBold: boolean;
  /** background of the exported picture ('transparent' allowed) */
  background: string;
}

export const defaultStyle: TreeStyle = {
  font: 'cmu',
  fontSize: 17,
  levelGap: 30,
  siblingGap: 18,
  padding: 20,
  lineWidth: 1,
  lineColor: '#1a1a1a',
  nodeColor: '#111111',
  leafColor: '#111111',
  leafItalic: true,
  leavesAtBottom: false,
  copyStyle: 'gray',
  arrowColor: '#1a1a1a',
  edgeGap: 3,
  handDrawn: false,
  nodeBold: false,
  background: '#ffffff',
};

export type PresetId = 'paper' | 'slides' | 'board';

export const presets: Record<PresetId, Partial<TreeStyle>> = {
  /** black & white, LaTeX look */
  paper: {
    font: 'cmu',
    fontSize: 17,
    levelGap: 30,
    siblingGap: 18,
    lineWidth: 0.9,
    lineColor: '#000000',
    nodeColor: '#000000',
    leafColor: '#000000',
    leafItalic: true,
    leavesAtBottom: false,
    copyStyle: 'angle',
    arrowColor: '#000000',
    handDrawn: false,
    nodeBold: false,
    background: '#ffffff',
  },
  /** large, high contrast */
  slides: {
    font: 'noto-sans',
    fontSize: 26,
    levelGap: 40,
    siblingGap: 28,
    lineWidth: 2.2,
    lineColor: '#22303c',
    nodeColor: '#0d3b66',
    leafColor: '#9a2617',
    leafItalic: false,
    leavesAtBottom: true,
    copyStyle: 'gray',
    arrowColor: '#c2410c',
    handDrawn: false,
    nodeBold: true,
    background: '#ffffff',
  },
  /** whiteboard / handwriting */
  board: {
    font: 'caveat',
    fontSize: 28,
    levelGap: 34,
    siblingGap: 22,
    lineWidth: 1.8,
    lineColor: '#1e3a8a',
    nodeColor: '#1e3a8a',
    leafColor: '#166534',
    leafItalic: false,
    leavesAtBottom: false,
    copyStyle: 'strike',
    arrowColor: '#b91c1c',
    handDrawn: true,
    nodeBold: false,
    background: '#ffffff',
  },
};

export const FONT_FAMILIES: Record<BuiltinFont, { css: string; name: string; italic: boolean }> = {
  cmu: { css: '"CMU Serif", "Latin Modern Roman", "NanoTrees Symbols", serif', name: 'Computer Modern (CMU Serif)', italic: true },
  libertinus: { css: '"Libertinus Serif", "Linux Libertine", "NanoTrees Symbols", serif', name: 'Libertinus Serif', italic: true },
  garamond: { css: '"EB Garamond", Garamond, "NanoTrees Symbols", serif', name: 'EB Garamond', italic: true },
  'noto-serif': { css: '"Noto Serif", "NanoTrees Symbols", serif', name: 'Noto Serif', italic: true },
  'noto-sans': { css: '"Noto Sans", "NanoTrees Symbols", "Helvetica Neue", Arial, sans-serif', name: 'Noto Sans', italic: true },
  caveat: { css: 'Caveat, "NanoTrees Symbols", cursive', name: 'Caveat (handwriting)', italic: false },
};

/** Typographic proportions derived from the font size. */
export function metricsFor(style: TreeStyle) {
  const fs = style.fontSize;
  return {
    fs,
    lineH: fs * 1.25,
    scriptScale: 0.68,
    featureFs: fs * 0.78,
    featureLineH: fs * 0.78 * 1.22,
    glossFs: fs * 0.82,
    glossLineH: fs * 0.82 * 1.3,
    semFs: fs * 0.8,
    semLineH: fs * 0.8 * 1.4,
    /** distance from the top of a line box to the baseline */
    ascent: fs * 0.98,
    /** where branches end above a label (from the top of the line box) */
    topInset: fs * 0.2,
    /** where branches start below a label (from the bottom of the line box) */
    bottomInset: fs * 0.08,
  };
}
