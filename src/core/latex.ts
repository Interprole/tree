import { layoutArrows } from './arrows';
import { semDisplay } from './layout';
import type { Layout } from './layout';
import type { DArrow, DNode, DTree } from './model';
import type { Run, Runs } from './richtext';
import { plain } from './richtext';
import type { Scene } from './scene';
import type { TreeStyle } from './style';

/**
 * LaTeX export.
 *  - forest (default): editable bracket code; arrows and extra multidominance branches are
 *    TikZ code after the tree.
 *  - tikz-qtree: classic qtree syntax (multidominance shown as copies).
 *  - tikz: exact picture with absolute coordinates, identical to the app's layout.
 * The output compiles with pdfLaTeX (and LuaLaTeX); see tests/latex.test.ts.
 */

export type LatexFormat = 'forest' | 'qtree' | 'tikz';

export interface LatexOptions {
  format: LatexFormat;
  /** full compilable document (standalone class) instead of just the picture */
  standalone: boolean;
}

/* ---------------------------------------------------------------- text */

const MATH: Record<string, string> = {
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', ζ: '\\zeta', η: '\\eta', θ: '\\theta', ι: '\\iota',
  κ: '\\kappa', λ: '\\lambda', μ: '\\mu', ν: '\\nu', ξ: '\\xi', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau', υ: '\\upsilon',
  φ: '\\varphi', ϕ: '\\phi', χ: '\\chi', ψ: '\\psi', ω: '\\omega', Γ: '\\Gamma', Δ: '\\Delta', Θ: '\\Theta', Λ: '\\Lambda',
  Ξ: '\\Xi', Π: '\\Pi', Σ: '\\Sigma', Φ: '\\Phi', Ψ: '\\Psi', Ω: '\\Omega',
  '∅': '\\varnothing', Ø: '\\varnothing', '′': "{}'", '″': "{}''", '⟨': '\\langle', '⟩': '\\rangle', '→': '\\rightarrow',
  '←': '\\leftarrow', '⇒': '\\Rightarrow', '±': '\\pm', '×': '\\times', '·': '\\cdot', '√': '\\surd', '∀': '\\forall',
  '∃': '\\exists', '∈': '\\in', '∪': '\\cup', '∩': '\\cap', '¬': '\\neg', '⊂': '\\subset', '⊃': '\\supset', '≺': '\\prec',
  '⁰': '^{0}', '∧': '\\wedge', '∨': '\\vee', '↔': '\\leftrightarrow', '⟦': '[\\![', '⟧': ']\\!]', '•': '\\bullet', '♯': '\\sharp', '♭': '\\flat', '✓': '\\checkmark',
};

const TEXT: Record<string, string> = {
  '\\': '\\textbackslash{}', '#': '\\#', $: '\\$', '%': '\\%', '&': '\\&', '~': '\\textasciitilde{}', _: '\\_',
  '^': '\\textasciicircum{}', '{': '\\{', '}': '\\}', '<': '\\textless{}', '>': '\\textgreater{}', '|': '\\textbar{}',
  '\u00a0': '~', '…': '\\dots{}', '—': '---', '–': '--', '“': '``', '”': "''", '‘': '`', '’': "'", '«': '<<', '»': '>>',
  '*': '*', '"': "''",
};

export function texEscape(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch in MATH) out += `$${MATH[ch]}$`;
    else if (ch in TEXT) out += TEXT[ch];
    else out += ch;
  }
  // merge adjacent math: $a$$b$ → $ab$
  return out.replace(/\$\$/g, '');
}

function texRun(r: Run): string {
  let t = texEscape(r.sc ? r.text.toLowerCase() : r.text);
  if (r.sc) t = `\\textsc{${t}}`;
  if (r.b) t = `\\textbf{${t}}`;
  if (r.i) t = `\\textit{${t}}`;
  if (r.s) t = `\\tfstrike{${t}}`;
  if (r.over) t = `$\\overline{\\mbox{${t}}}$`;
  if (r.sub) t = `\\textsubscript{${t}}`;
  if (r.sup) t = `\\textsuperscript{${t}}`;
  return t;
}

export function texRuns(runs: Runs): string {
  return runs.map(texRun).join('');
}

/* ---------------------------------------------------------------- colours */

const CSS_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'D62828', darkred: '8B0000', crimson: 'DC143C', blue: '1D4ED8', navy: '000080',
  darkblue: '00008B', green: '15803D', darkgreen: '006400', orange: 'EA580C', purple: '7E22CE', violet: '7C3AED',
  magenta: 'C026D3', pink: 'DB2777', teal: '0F766E', cyan: '0891B2', brown: '8B4513', gray: '808080', grey: '808080',
  olive: '808000', maroon: '800000', gold: 'B8860B', indigo: '4B0082', yellow: 'CA8A04', lime: '65A30D',
};

export function colorHex(c: string): string | null {
  const k = c.toLowerCase();
  if (CSS_COLORS[k]) return CSS_COLORS[k];
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return h.toUpperCase();
}

class Colors {
  defs = new Map<string, string>();
  name(c: string | undefined): string | null {
    if (!c) return null;
    const hex = colorHex(c);
    if (!hex) return null;
    if (hex === '000000' || hex === '111111' || hex === '1A1A1A') return null;
    let n = this.defs.get(hex);
    if (!n) {
      n = 'tf' + String.fromCharCode(65 + this.defs.size % 26) + (this.defs.size >= 26 ? Math.floor(this.defs.size / 26) : '');
      this.defs.set(hex, n);
    }
    return n;
  }
  preamble(): string {
    return [...this.defs].map(([hex, n]) => `\\definecolor{${n}}{HTML}{${hex}}`).join('\n');
  }
}

/* ---------------------------------------------------------------- shared */

const px2pt = (px: number) => Math.round(px * 0.75 * 100) / 100;

function hasCyrillic(s: string) {
  return /[\u0400-\u04FF]/.test(s);
}

export function preamble(body: string, colors: string, extra: string[] = []): string {
  const cyr = hasCyrillic(body);
  const lines = ['\\documentclass[border=8pt]{standalone}'];
  if (cyr) lines.push('\\usepackage[T1,T2A]{fontenc}', '\\usepackage[utf8]{inputenc}', '\\usepackage[english,russian]{babel}');
  else lines.push('\\usepackage[T1]{fontenc}', '\\usepackage[utf8]{inputenc}', '\\usepackage{lmodern}');
  lines.push('\\usepackage{amssymb}', '\\usepackage{xcolor}', ...extra);
  if (body.includes('\\tfstrike')) lines.push('\\newcommand\\tfstrike[1]{\\setbox0\\hbox{#1}\\rlap{\\rule[.6ex]{\\wd0}{.45pt}}\\box0}');
  if (colors) lines.push(colors);
  return lines.join('\n');
}

function labelTex(n: DNode, style: TreeStyle): string {
  let t = texRuns(n.label);
  if (n.kind === 'leaf' && style.leafItalic && t) t = `\\textit{${t}}`;
  if (n.kind === 'phrase' && style.nodeBold && t) t = `\\textbf{${t}}`;
  if (n.copy && t) {
    if (style.copyStyle === 'angle' && n.kind === 'leaf') t = `$\\langle$${t}$\\rangle$`;
    else if (style.copyStyle === 'strike') t = `\\tfstrike{${t}}`;
    else if (style.copyStyle === 'gray') t = `\\textcolor{gray}{${t}}`;
  }
  if (n.struck && !(n.copy && style.copyStyle === 'strike') && t) t = `\\tfstrike{${t}}`;
  const lines = [t];
  if (n.features?.length) {
    const f = n.features.map((x) => texRuns(x)).join('\\\\ ');
    lines.push(`{\\footnotesize$\\left[\\mbox{\\begin{tabular}{@{}l@{}}${f}\\end{tabular}}\\right]$}`);
  }
  const sem = semDisplay(n);
  if (sem && sem.kind !== 'error') lines.push(`{\\small ${texRuns(sem.runs)}}`);
  if (n.gloss?.length) for (const g of n.gloss) lines.push(`{\\small ${texRuns(g)}}`);
  return lines.join('\\\\ ');
}

/** The descendant whose bottom is lowest (where an "under" arrow attaches). */
function bottomNode(n: DNode, layout: Layout | undefined): DNode {
  let best = n;
  let bestY = -Infinity;
  const seen = new Set<DNode>();
  const visit = (x: DNode, depth: number) => {
    if (seen.has(x)) return;
    seen.add(x);
    const ln = layout?.nodes.get(x);
    const y = ln ? ln.y + ln.block.fullH : depth;
    const lx = layout?.nodes.get(n)?.x ?? 0;
    const dist = ln ? Math.abs(ln.x - lx) : 0;
    if (y > bestY + 0.5 || (Math.abs(y - bestY) <= 0.5 && dist < Math.abs((layout?.nodes.get(best)?.x ?? 0) - lx))) {
      best = x;
      bestY = y;
    }
    for (const c of x.children) visit(c, depth + 1);
  };
  visit(n, 0);
  return best;
}

function arrowTikz(a: DArrow, names: Map<DNode, string>, layout: Layout | undefined, level: number, colors: Colors): string {
  const opts: string[] = [];
  opts.push(a.head === 'both' ? '{Stealth}-{Stealth}' : a.head === 'start' ? '{Stealth}-' : a.head === 'none' ? '-' : '-{Stealth}');
  if (a.line !== 'solid') opts.push(a.line);
  const col = colors.name(a.color);
  if (col) opts.push(col);
  opts.push('semithick');
  const label = a.labels
    .map((l) => {
      const side = l.side === 'auto' ? (a.route === 'under' ? 'below' : 'right') : l.side;
      const shift = l.off ? `, xshift=${px2pt(l.off[0])}pt, yshift=${px2pt(-l.off[1])}pt` : '';
      return ` node[midway, ${side}${shift}, font=\\small\\itshape]{${texRuns(l.runs)}}`;
    })
    .join('');
  if (a.route === 'curve') {
    const s = names.get(a.from)!;
    const t = names.get(a.to)!;
    return `\\draw[${opts.join(', ')}] (${s}.north) to[out=150, in=-60, looseness=1.1]${label} (${t}.south);`;
  }
  const s = names.get(bottomNode(a.from, layout))!;
  const t = names.get(bottomNode(a.to, layout))!;
  const depth = (1.6 + level * 0.9 + (a.bend[1] ?? 0) / 20).toFixed(2);
  return `\\draw[${opts.join(', ')}] (${s}.south) .. controls ($(${s}.south |- tf-bottom)+(0,-${depth}em)$) and ($(${t}.south |- tf-bottom)+(0,-${depth}em)$) ..${label} (${t}.south);`;
}

/* ---------------------------------------------------------------- forest */

export function exportForest(tree: DTree, style: TreeStyle, layout: Layout | undefined, standalone: boolean): string {
  const colors = new Colors();
  const names = new Map<DNode, string>();
  let counter = 0;
  const nameOf = (n: DNode) => {
    let s = names.get(n);
    if (!s) {
      s = `n${++counter}`;
      names.set(n, s);
    }
    return s;
  };
  // arrow endpoints and multidominance participants need names
  for (const a of tree.arrows) {
    nameOf(a.route === 'under' ? bottomNode(a.from, layout) : a.from);
    nameOf(a.route === 'under' ? bottomNode(a.to, layout) : a.to);
  }
  // where to write each shared node: under its lowest mother (last in order)
  const depth = new Map<DNode, number>();
  const order = new Map(tree.nodes.map((n, i) => [n, i]));
  const setDepth = (n: DNode, d: number) => {
    if ((depth.get(n) ?? -1) >= d) return;
    depth.set(n, d);
    for (const c of n.children) setDepth(c, d + 1);
  };
  setDepth(tree.root, 0);
  const host = new Map<DNode, DNode>();
  const extra: [DNode, DNode][] = [];
  for (const n of tree.nodes) {
    if (n.parents.length < 2) continue;
    const ps = [...n.parents].sort((a, b) => depth.get(b)! - depth.get(a)! || order.get(b)! - order.get(a)!);
    host.set(n, ps[0]);
    for (const p of ps.slice(1)) extra.push([p, n]);
    nameOf(n);
    for (const p of ps) nameOf(p);
  }

  const emit = (n: DNode, parent: DNode | null, indent: string): string => {
    const opts: string[] = [];
    if (names.has(n)) opts.push(`name=${names.get(n)}`);
    const content = labelTex(n, style);
    if (content.includes('\\\\')) opts.push('align=center', 'base=top');
    if (parent?.triangle && n.kind === 'leaf') opts.push('roof');
    const tc = colors.name(n.copy && style.copyStyle === 'gray' ? undefined : n.color);
    if (tc) opts.push(`text=${tc}`);
    const ec = n.edgeColor ? colors.name(n.edgeColor) : parent && parent.branchColor === n.branchColor ? colors.name(n.branchColor) : null;
    const edgeOpts = [ec, n.edgeWidth !== undefined ? `line width=${px2pt(n.edgeWidth)}pt` : null].filter(Boolean);
    if (edgeOpts.length && parent) opts.push(`edge={${edgeOpts.join(', ')}}`);
    if (n.edgeLen) opts.push(`l+=${px2pt(n.edgeLen)}pt`);
    if (n.spread) opts.push(`for children={s sep+=${px2pt(n.spread)}pt}`);
    for (const note of n.notes ?? []) {
      const side = { left: 'left', right: 'right', above: 'above', below: 'below', auto: 'right' }[note.side];
      opts.push(`label={[font=\\small]${side}:{${texRuns(note.runs)}}}`);
    }
    if (n.copy && style.copyStyle === 'gray' && parent) opts.push('edge={gray, densely dashed}');
    if (!plain(n.label).trim() && !n.features?.length && n.kind === 'phrase') opts.push('coordinate');
    const kids = n.children.filter((c) => c.parents.length < 2 || host.get(c) === n);
    const head = `[{${content}}${opts.length ? ', ' + opts.join(', ') : ''}`;
    if (!kids.length) return `${indent}${head}]`;
    return `${indent}${head}\n${kids.map((k) => emit(k, n, indent + '  ')).join('\n')}\n${indent}]`;
  };

  const lsep = px2pt(Math.max(4, style.levelGap * 0.45));
  const ssep = px2pt(style.siblingGap);
  const treeOpts = [
    `for tree={parent anchor=south, child anchor=north, l sep=${lsep}pt, s sep=${ssep}pt, inner sep=1.5pt${style.lineWidth !== 1 ? `, edge={line width=${px2pt(style.lineWidth)}pt}` : ''}}`,
  ];
  if (style.leavesAtBottom) treeOpts.push('where n children=0{tier=word}{}');
  const body = emit(tree.root, null, '');
  const tikz: string[] = [];
  if (tree.arrows.length) tikz.push('\\coordinate (tf-bottom) at (current bounding box.south);');
  for (const [p, n] of extra) {
    const ec = colors.name(n.branchColor);
    tikz.push(`\\draw${ec ? `[${ec}]` : ''} (${names.get(p)}.south) -- (${names.get(n)}.north);`);
  }
  const levels = arrowLevels(tree, layout);
  tree.arrows.forEach((a, i) => tikz.push(arrowTikz(a, names, layout, levels[i], colors)));
  const forest = ['\\begin{forest}', treeOpts.join(',\n'), body, ...tikz, '\\end{forest}'].join('\n');
  if (!standalone) return forest;
  const doc = preamble(forest, colors.preamble(), ['\\usepackage[linguistics]{forest}', '\\usetikzlibrary{arrows.meta, calc}']);
  return `${doc}\n\\begin{document}\n${forest}\n\\end{document}\n`;
}

function arrowLevels(tree: DTree, layout: Layout | undefined): number[] {
  if (!layout) return tree.arrows.map((_, i) => i);
  const { geoms } = layoutArrows(layout, tree.arrows);
  return tree.arrows.map((a) => geoms.find((g) => g.arrow === a)?.level ?? 0);
}

/* ---------------------------------------------------------------- tikz-qtree */

export function exportQtree(tree: DTree, style: TreeStyle, layout: Layout | undefined, standalone: boolean): string {
  const colors = new Colors();
  const names = new Map<DNode, string>();
  let counter = 0;
  for (const a of tree.arrows) {
    for (const n of [a.from, a.to]) {
      const b = a.route === 'under' ? bottomNode(n, layout) : n;
      if (!names.has(b)) names.set(b, `q${++counter}`);
    }
  }
  const seen = new Set<DNode>();
  const emit = (n: DNode, parent: DNode | null): string => {
    const content = labelTex(n, style).replace(/\\\\ /g, '\\\\');
    const edge = parent?.triangle && n.kind === 'leaf' ? '\\edge[roof]; ' : '';
    const nm = names.get(n);
    const lab = nm ? `\\node(${nm}){${content}};` : `{${content}}`;
    if (seen.has(n) || n.children.length === 0) {
      seen.add(n);
      return `${edge}${lab}`;
    }
    seen.add(n);
    const kids = n.children.map((c) => emit(c, n)).join(' ');
    if (nm) return `${edge}[.\\node(${nm}){${content}}; ${kids} ]`;
    return `${edge}[.{${content}} ${kids} ]`;
  };
  const shared = tree.nodes.some((n) => n.parents.length > 1);
  const lines: string[] = [];
  if (shared) lines.push('% tikz-qtree cannot draw multidominance: shared nodes are repeated. Use the forest export instead.');
  lines.push('\\begin{tikzpicture}[every tree node/.style={align=center, anchor=north}]', `\\Tree ${emit(tree.root, null)}`);
  if (tree.arrows.length) lines.push('\\coordinate (tf-bottom) at (current bounding box.south);');
  const levels = arrowLevels(tree, layout);
  tree.arrows.forEach((a, i) => {
    const n2 = new Map<DNode, string>();
    for (const n of [a.from, a.to]) n2.set(n, names.get(a.route === 'under' ? bottomNode(n, layout) : n)!);
    lines.push(arrowTikz(a, a.route === 'under' ? names : n2, layout, levels[i], colors));
  });
  lines.push('\\end{tikzpicture}');
  const pic = lines.join('\n');
  if (!standalone) return pic;
  const doc = preamble(pic, colors.preamble(), ['\\usepackage{tikz-qtree}', '\\usetikzlibrary{arrows.meta, calc}']);
  return `${doc}\n\\begin{document}\n${pic}\n\\end{document}\n`;
}

/* ---------------------------------------------------------------- exact TikZ */

/** Convert an SVG path (M, L, Q, C, Z with absolute coordinates) into TikZ path syntax. */
function svgPathToTikz(d: string, H: number): string {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: string[] = [];
  let i = 0;
  const pt = () => {
    const x = Number(tokens[i++]);
    const y = Number(tokens[i++]);
    return `(${px2pt(x)}pt, ${px2pt(H - y)}pt)`;
  };
  let cur: string | null = null;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[MLQCZ]/i.test(t)) {
      cur = t.toUpperCase();
      i++;
      if (cur === 'Z') out.push('-- cycle');
      continue;
    }
    if (cur === 'M') out.push(pt());
    else if (cur === 'L') out.push('-- ' + pt());
    else if (cur === 'Q') {
      // quadratic: approximate with a single control point via "controls"
      const c = pt();
      const e = pt();
      out.push(`.. controls ${c} .. ${e}`);
    } else if (cur === 'C') {
      const c1 = pt();
      const c2 = pt();
      const e = pt();
      out.push(`.. controls ${c1} and ${c2} .. ${e}`);
    } else i++;
  }
  return out.join(' ');
}

export function exportTikz(scene: Scene, standalone: boolean): string {
  const colors = new Colors();
  const H = scene.height;
  const lines = ['\\begin{tikzpicture}[x=1pt, y=1pt, line cap=round, line join=round]'];
  lines.push(`\\path[use as bounding box] (0,0) rectangle (${px2pt(scene.width)}pt, ${px2pt(H)}pt);`);
  for (const p of scene.prims) {
    if (p.t === 'path') {
      const opts: string[] = [];
      const sc = colors.name(p.stroke);
      const fc = colors.name(p.fill);
      if (p.fill) opts.push(`fill${fc ? '=' + fc : ''}`, 'draw=none');
      else {
        opts.push(`line width=${px2pt(p.width ?? 1)}pt`);
        if (sc) opts.push(`draw=${sc}`);
        if (p.dash) opts.push(`dash pattern=on ${px2pt(p.dash[0])}pt off ${px2pt(p.dash[1])}pt`);
        if (p.role === 'bracket') opts.push('line cap=butt');
      }
      lines.push(`\\${p.fill ? 'path' : 'draw'}[${opts.join(', ')}] ${svgPathToTikz(p.d, H)};`);
    } else {
      // one node per label, centred on the label's baseline
      const first = p.pieces[0];
      const last = p.pieces[p.pieces.length - 1];
      if (!first) continue;
      const cx = (first.x + last.x + last.width) / 2;
      const base = p.pieces.find((q) => Math.abs(q.size - first.size) < 0.01)?.y ?? first.y;
      let content = '';
      for (const q of p.pieces) {
        let t = texEscape(q.upper ? q.text.toLowerCase() : q.text);
        if (q.upper) t = `\\textsc{${t}}`;
        if (q.italic) t = `\\textit{${t}}`;
        if (q.bold) t = `\\textbf{${t}}`;
        if (q.y > base + 0.5) t = `\\textsubscript{${t}}`;
        else if (q.y < base - 0.5) t = `\\textsuperscript{${t}}`;
        content += t;
      }
      const col = colors.name(p.color);
      const fs = px2pt(first.size);
      lines.push(`\\node[anchor=base, inner sep=0pt${col ? ', text=' + col : ''}, font=\\fontsize{${fs}}{${(fs * 1.2).toFixed(1)}}\\selectfont] at (${px2pt(cx)}pt, ${px2pt(H - base)}pt) {${content}};`);
    }
  }
  lines.push('\\end{tikzpicture}');
  const pic = lines.join('\n');
  if (!standalone) return pic;
  const doc = preamble(pic, colors.preamble(), ['\\usepackage{tikz}']);
  return `${doc}\n\\begin{document}\n${pic}\n\\end{document}\n`;
}

export function exportLatex(tree: DTree, scene: Scene, style: TreeStyle, opts: LatexOptions): string {
  if (opts.format === 'qtree') return exportQtree(tree, style, scene.layout, opts.standalone);
  if (opts.format === 'tikz') return exportTikz(scene, opts.standalone);
  return exportForest(tree, style, scene.layout, opts.standalone);
}
