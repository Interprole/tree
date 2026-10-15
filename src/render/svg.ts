import type { Prim, Scene, TextPiece } from '../core/scene';
import { fontCss } from '../core/style';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const r2 = (n: number) => (Math.round(n * 100) / 100).toString();

function pieceAttrs(p: TextPiece, baseSize: number, baseItalic: boolean): string {
  let a = ` x="${r2(p.x)}" y="${r2(p.y)}"`;
  if (Math.abs(p.size - baseSize) > 0.01) a += ` font-size="${r2(p.size)}"`;
  if (!!p.italic !== baseItalic) a += ` font-style="${p.italic ? 'italic' : 'normal'}"`;
  return a;
}

export function primToSvg(p: Prim): string {
  if (p.t === 'path') {
    const attrs = [`d="${p.d}"`];
    attrs.push(`fill="${p.fill ? esc(p.fill) : 'none'}"`);
    if (p.stroke) {
      attrs.push(`stroke="${esc(p.stroke)}"`, `stroke-width="${r2(p.width ?? 1)}"`);
      attrs.push(`stroke-linecap="${p.role === 'bracket' ? 'butt' : 'round'}"`);
      if (p.join) attrs.push(`stroke-linejoin="${p.join}"`);
      if (p.dash) attrs.push(`stroke-dasharray="${p.dash.join(' ')}"`);
    }
    return `<path ${attrs.join(' ')}/>`;
  }
  const first = p.pieces[0];
  if (!first) return '';
  const baseSize = first.size;
  const baseItalic = !!first.italic;
  const weight = first.bold ? ' font-weight="700"' : '';
  const op = p.opacity !== undefined && p.opacity < 1 ? ` fill-opacity="${p.opacity}"` : '';
  const spans = p.pieces.map((q) => `<tspan${pieceAttrs(q, baseSize, baseItalic)}>${esc(q.text)}</tspan>`).join('');
  return `<text font-family="${esc(fontCss(p.font))}" font-size="${r2(baseSize)}"${baseItalic ? ' font-style="italic"' : ''}${weight} fill="${esc(p.color)}"${op}>${spans}</text>`;
}

export interface SvgOptions {
  /** @font-face rules to embed */
  fontCss?: string;
  /** transparent background */
  transparent?: boolean;
  /** title for accessibility */
  title?: string;
}

/** Standalone SVG document. */
export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): string {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`);
  if (opts.title) parts.push(`<title>${esc(opts.title)}</title>`);
  parts.push(`<style>text{white-space:pre}${opts.fontCss ?? ''}</style>`);
  if (!opts.transparent && scene.background !== 'transparent') parts.push(`<rect width="100%" height="100%" fill="${esc(scene.background)}"/>`);
  for (const p of scene.prims) parts.push(primToSvg(p));
  parts.push('</svg>');
  return parts.join('\n');
}
