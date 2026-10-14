import type { Runs } from './richtext';
import type { FontId } from './style';

export interface FontSpec {
  font: FontId;
  size: number;
  italic?: boolean;
  bold?: boolean;
}

/** Width of a string in px. Browser: canvas measureText; tests: an approximation. */
export type Measure = (text: string, font: FontSpec) => number;

export const SCRIPT_SCALE = 0.68;
export const SC_SCALE = 0.8;

/** Width of rich runs (sub/superscripts are smaller, small caps are smaller capitals). */
export function runsWidth(runs: Runs, font: FontSpec, measure: Measure): number {
  let w = 0;
  for (const r of runs) {
    if (r.sub || r.sup) w += measure(r.sc ? r.text.toUpperCase() : r.text, { ...font, size: font.size * SCRIPT_SCALE });
    else if (r.sc) w += measure(r.text.toUpperCase(), { ...font, size: font.size * SC_SCALE });
    else w += measure(r.text, font);
  }
  return w;
}

const NARROW = new Set("il.,;:!|'′″()[]{}tfjrI ".split(''));
const WIDE = new Set('mwMWØ∅@%'.split(''));

/** Deterministic approximate measurer (used in tests and before fonts load). */
export const approxMeasure: Measure = (text, font) => {
  let w = 0;
  for (const ch of text) {
    let k = 0.52;
    if (NARROW.has(ch)) k = 0.3;
    else if (WIDE.has(ch)) k = 0.82;
    else if (ch >= 'A' && ch <= 'Z') k = 0.66;
    else if (/[Ѐ-ӿ]/.test(ch)) k = ch === ch.toUpperCase() ? 0.66 : 0.55;
    w += k * font.size;
  }
  return w * (font.bold ? 1.06 : 1);
};

/** Canvas based measurer with caching. */
export function canvasMeasure(cssFamily: (f: FontId) => string): Measure {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const cache = new Map<string, number>();
  return (text, font) => {
    const k = `${font.font}|${font.size}|${font.italic ? 1 : 0}|${font.bold ? 1 : 0}|${text}`;
    let w = cache.get(k);
    if (w === undefined) {
      ctx.font = `${font.italic ? 'italic ' : ''}${font.bold ? '700 ' : '400 '}${font.size}px ${cssFamily(font.font)}`;
      w = ctx.measureText(text).width;
      if (cache.size > 20000) cache.clear();
      cache.set(k, w);
    }
    return w;
  };
}
