/** Visual settings of a tree (everything that the appearance panel controls). */

export type FontId = 'cmu' | 'libertinus' | 'garamond' | 'noto-serif' | 'noto-sans' | 'caveat';

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
  /** how lower copies look */
  copyStyle: 'grey' | 'strike' | 'angle';
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
  copyStyle: 'grey',
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
    copyStyle: 'grey',
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

export const FONT_FAMILIES: Record<FontId, { css: string; name: string; italic: boolean }> = {
  cmu: { css: '"CMU Serif", "Latin Modern Roman", "Computer Modern", serif', name: 'Computer Modern (CMU Serif)', italic: true },
  libertinus: { css: '"Libertinus Serif", "Linux Libertine", serif', name: 'Libertinus Serif', italic: true },
  garamond: { css: '"EB Garamond", Garamond, serif', name: 'EB Garamond', italic: true },
  'noto-serif': { css: '"Noto Serif", serif', name: 'Noto Serif', italic: true },
  'noto-sans': { css: '"Noto Sans", "Helvetica Neue", Arial, sans-serif', name: 'Noto Sans', italic: true },
  caveat: { css: 'Caveat, "Comic Sans MS", cursive', name: 'Caveat (handwriting)', italic: false },
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
    /** distance from the top of a line box to the baseline */
    ascent: fs * 0.98,
    /** where branches end above a label (from the top of the line box) */
    topInset: fs * 0.2,
    /** where branches start below a label (from the bottom of the line box) */
    bottomInset: fs * 0.08,
  };
}
