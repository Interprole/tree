import { FONT_FAMILIES } from '../core/style';
import type { FontId } from '../core/style';
import { FACES } from './fonts.generated';
import type { FontFace } from './fonts.generated';

/** Register all @font-face rules (files are only downloaded when used). */
export function installFontFaces() {
  if (document.getElementById('treeform-fonts')) return;
  const style = document.createElement('style');
  style.id = 'treeform-fonts';
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

export function facesFor(font: FontId, text: string, variants?: { weight: number; style: string }[]): FontFace[] {
  const cps = new Set<number>();
  for (const ch of text) cps.add(ch.codePointAt(0)!);
  return FACES.filter(
    (f) => f.id === font && (!variants || variants.some((v) => v.weight === f.weight && v.style === f.style)) && [...cps].some((cp) => covers(f, cp)),
  );
}

const SAMPLE = 'AaБбφ∅′';

/** Load the faces of a font family; resolves when ready (or after a timeout). */
export async function loadFont(font: FontId): Promise<void> {
  const fam = FONT_FAMILIES[font].css;
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

/** @font-face rules with embedded data for the characters actually used (for standalone SVG/PNG). */
export async function embeddedFontCss(font: FontId, text: string): Promise<string> {
  const faces = facesFor(font, text);
  const rules = await Promise.all(
    faces.map(async (f) => {
      const data = toBase64(await fetchBytes(f.woff2));
      return `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};src:url(data:font/woff2;base64,${data}) format("woff2");${f.range ? `unicode-range:${f.range};` : ''}}`;
    }),
  );
  return rules.join('');
}
