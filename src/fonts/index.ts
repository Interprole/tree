import { fontCss, isLocalFont } from '../core/style';
import type { FontId } from '../core/style';
import { FACES } from './fonts.generated';
import type { FontFace } from './fonts.generated';

/** Register all @font-face rules (files are only downloaded when used). */
export function installFontFaces() {
  if (document.getElementById('nanotrees-fonts')) return;
  const style = document.createElement('style');
  style.id = 'nanotrees-fonts';
  style.textContent = FACES.map(
    (f) => `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(${f.woff2}) format("woff2");${f.range ? `unicode-range:${f.range};` : ''}}`,
  ).join('\n');
  document.head.appendChild(style);
}

function parseRanges(r: string): [number, number][] {
  if (!r) return [[0, 0x10ffff]];
  return r.split(',').map((p) => {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(p.trim());
    if (!m) return [0, -1] as [number, number];
    const a = parseInt(m[1].replace(/\?/g, '0'), 16);
    const b = m[2] ? parseInt(m[2], 16) : m[1].includes('?') ? parseInt(m[1].replace(/\?/g, 'F'), 16) : a;
    return [a, b] as [number, number];
  });
}

const rangeCache = new Map<FontFace, [number, number][]>();
function covers(f: FontFace, cp: number) {
  let r = rangeCache.get(f);
  if (!r) {
    r = parseRanges(f.range);
    rangeCache.set(f, r);
  }
  return r.some(([a, b]) => cp >= a && cp <= b);
}

export function facesFor(font: FontId, text: string, variants?: { weight: number; style: string }[], pool: FontFace[] = FACES): FontFace[] {
  const cps = new Set<number>();
  for (const ch of text) cps.add(ch.codePointAt(0)!);
  return pool.filter(
    (f) => f.id === font && (!variants || variants.some((v) => v.weight === f.weight && v.style === f.style)) && [...cps].some((cp) => covers(f, cp)),
  );
}

const SAMPLE = 'AaБбφ∅′';

/** Load the faces of a font family; resolves when ready (or after a timeout). */
export async function loadFont(font: FontId): Promise<void> {
  const fam = fontCss(font);
  const specs = [`400 20px ${fam}`, `italic 400 20px ${fam}`, `700 20px ${fam}`];
  const timeout = new Promise<void>((r) => setTimeout(r, 4000));
  await Promise.race([Promise.all(specs.map((s) => document.fonts.load(s, SAMPLE).catch(() => []))).then(() => undefined), timeout]);
}

const bytesCache = new Map<string, Promise<ArrayBuffer>>();
export function fetchBytes(url: string): Promise<ArrayBuffer> {
  let p = bytesCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Cannot load font ${url}`);
      return r.arrayBuffer();
    });
    bytesCache.set(url, p);
  }
  return p;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

/* ------------------------------------------------------------ installed fonts */

interface LocalFontData {
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

/** Whether the browser can list installed fonts (Local Font Access API, Chromium). */
export function canListLocalFonts(): boolean {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window;
}

/** Families of the fonts installed on this computer (asks for permission). */
export async function listLocalFamilies(): Promise<string[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (!q) return [];
  const fonts = await q();
  return [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
}

const localCache = new Map<string, Promise<FontFace[]>>();

/** Font files of an installed family (regular, italic, bold) for embedding in exports. */
export function localFaces(family: string): Promise<FontFace[]> {
  let p = localCache.get(family);
  if (!p) {
    p = (async () => {
      const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
      if (!q) return [];
      const fonts = (await q()).filter((f) => f.family === family);
      const pickStyle = (re: RegExp) => fonts.find((f) => re.test(f.style));
      const variants: [number, 'normal' | 'italic', LocalFontData | undefined][] = [
        [400, 'normal', pickStyle(/^(regular|normal|book|roman)$/i) ?? fonts[0]],
        [400, 'italic', pickStyle(/^(italic|oblique)$/i)],
        [700, 'normal', pickStyle(/^bold$/i)],
      ];
      const out: FontFace[] = [];
      for (const [weight, style, f] of variants) {
        if (!f) continue;
        const url = URL.createObjectURL(await f.blob());
        out.push({ id: `local:${family}`, family, weight, style, range: '', woff2: url, sfnt: url });
      }
      return out;
    })().catch(() => []);
    localCache.set(family, p);
  }
  return p;
}

/** Faces available for a font id (built-in files or installed font files). */
export async function facePool(font: FontId): Promise<FontFace[]> {
  return isLocalFont(font) ? localFaces(font.slice(6)) : FACES;
}

/** @font-face rules with embedded data for the characters actually used (for standalone SVG/PNG). */
export async function embeddedFontCss(font: FontId, text: string): Promise<string> {
  let faces = facesFor(font, text, undefined, await facePool(font));
  // symbols (′ ∅ → …) the main font may lack, as on the canvas
  faces = [...faces, ...facesFor('symbols' as FontId, text)];
  const rules = await Promise.all(
    faces.map(async (f) => {
      const data = toBase64(await fetchBytes(f.woff2));
      const local = f.id.startsWith('local:');
      const src = local ? `url(data:font/otf;base64,${data})` : `url(data:font/woff2;base64,${data}) format("woff2")`;
      return `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};src:${src};${f.range ? `unicode-range:${f.range};` : ''}}`;
    }),
  );
  return rules.join('');
}
