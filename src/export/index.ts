import type { Scene } from '../core/scene';
import { colorHex } from '../core/latex';
import type { FontId } from '../core/style';
import { embeddedFontCss, facesFor, fetchBytes } from '../fonts';
import type { FontFace } from '../fonts/fonts.generated';
import { sceneToSvg } from '../render/svg';

export function sceneText(scene: Scene): string {
  let s = '';
  for (const p of scene.prims) if (p.t === 'text') for (const q of p.pieces) s += q.text;
  return s;
}

export async function svgString(scene: Scene, opts: { embedFonts: boolean; transparent: boolean }): Promise<string> {
  const fontCss = opts.embedFonts ? await embeddedFontCss(scene.style.font, sceneText(scene)) : '';
  return sceneToSvg(scene, { fontCss, transparent: opts.transparent, title: 'Syntax tree' });
}

export async function pngBlob(scene: Scene, scale: number, transparent: boolean): Promise<Blob> {
  const svg = await svgString(scene, { embedFonts: true, transparent });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not render the SVG'));
      img.src = url;
    });
    // fonts inside an SVG image may need a moment to decode
    await new Promise((r) => setTimeout(r, 60));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(scene.width * scale);
    canvas.height = Math.ceil(scene.height * scale);
    const ctx = canvas.getContext('2d')!;
    if (!transparent && scene.background !== 'transparent') {
      ctx.fillStyle = scene.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------ PDF */

function rgbOf(c: string | undefined, rgb: (r: number, g: number, b: number) => unknown) {
  const hex = c ? colorHex(c) : null;
  if (!hex) return rgb(0, 0, 0);
  return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
}

/** Vector PDF with embedded (subsetted) fonts. */
export async function pdfBlob(scene: Scene, transparent: boolean): Promise<Blob> {
  const [{ PDFDocument, rgb, LineCapStyle }, fontkitMod] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitMod.default ?? fontkitMod);
  pdf.setTitle('Syntax tree');
  pdf.setCreator('Treeform');
  const k = 0.75; // px → pt
  const W = scene.width * k;
  const H = scene.height * k;
  const page = pdf.addPage([W, H]);
  if (!transparent && scene.background !== 'transparent') {
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgbOf(scene.background, rgb) as never });
  }
  const font: FontId = scene.style.font;
  const allText = sceneText(scene);
  const embedded = new Map<FontFace, Promise<import('pdf-lib').PDFFont>>();
  const embed = (f: FontFace) => {
    let p = embedded.get(f);
    if (!p) {
      p = fetchBytes(f.sfnt).then((b) => pdf.embedFont(b, { subset: true }));
      embedded.set(f, p);
    }
    return p;
  };
  const facesByVariant = new Map<string, FontFace[]>();
  const facesFor2 = (weight: number, style: string) => {
    const key = weight + style;
    let fs = facesByVariant.get(key);
    if (!fs) {
      fs = facesFor(font, allText, [{ weight, style }]);
      if (!fs.length && style === 'italic') fs = facesFor(font, allText, [{ weight, style: 'normal' }]);
      if (!fs.length && weight === 700) fs = facesFor(font, allText, [{ weight: 400, style }]);
      facesByVariant.set(key, fs);
    }
    return fs;
  };

  for (const p of scene.prims) {
    if (p.t === 'path') {
      const opts: Record<string, unknown> = { x: 0, y: H, scale: k };
      if (p.fill) opts.color = rgbOf(p.fill, rgb);
      if (p.stroke) {
        opts.borderColor = rgbOf(p.stroke, rgb);
        opts.borderWidth = (p.width ?? 1) * k;
        opts.borderLineCap = p.role === 'bracket' ? LineCapStyle.Butt : LineCapStyle.Round;
        if (p.dash) opts.borderDashArray = p.dash.map((x) => x * k);
      }
      page.drawSvgPath(p.d, opts as never);
    } else {
      for (const q of p.pieces) {
        const faces = facesFor2(q.bold ? 700 : 400, q.italic ? 'italic' : 'normal');
        if (!faces.length) continue;
        // split into runs covered by the same face (latin / cyrillic / greek subsets)
        let x = q.x;
        let run = '';
        let runFace: FontFace | null = null;
        const flush = async () => {
          if (!run || !runFace) return;
          const f = await embed(runFace);
          page.drawText(run, { x: x * k, y: H - q.y * k, size: q.size * k, font: f, color: rgbOf(p.color, rgb) as never, opacity: p.opacity ?? 1 });
          x += f.widthOfTextAtSize(run, q.size * k) / k;
          run = '';
        };
        const pdfFonts = await Promise.all(faces.map(embed));
        for (const ch of q.text) {
          const cp = ch.codePointAt(0)!;
          let face = faces[0];
          for (let i = 0; i < faces.length; i++) {
            const glyphs = pdfFonts[i].getCharacterSet();
            if (glyphs.includes(cp)) {
              face = faces[i];
              break;
            }
          }
          if (face !== runFace) {
            await flush();
            runFace = face;
          }
          run += ch;
        }
        await flush();
      }
    }
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/* ------------------------------------------------------------ files & clipboard */

export function download(data: Blob | string, filename: string, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export async function copyImage(scene: Scene, scale = 2): Promise<boolean> {
  try {
    const item = new ClipboardItem({ 'image/png': pngBlob(scene, scale, false) });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

export function fileBase(scene: Scene | null, name: string | null): string {
  const base = name || (scene ? 'tree' : 'tree');
  return base.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'tree';
}
