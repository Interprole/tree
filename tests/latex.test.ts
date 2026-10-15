import { execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { exportLatex, texEscape, texRuns } from '../src/core/latex';
import type { LatexFormat } from '../src/core/latex';
import { buildScene } from '../src/core/scene';
import { approxMeasure } from '../src/core/measure';
import { defaultStyle } from '../src/core/style';
import { parseRich } from '../src/core/richtext';
import { examples } from '../src/examples';
import { tree } from './helpers';
import type { BuildOptions } from '../src/core/build';

function latex(src: string, format: LatexFormat, build: Partial<BuildOptions> = {}, standalone = true, style = {}) {
  const t = tree(src, build);
  const st = { ...defaultStyle, ...style };
  return exportLatex(t, buildScene(t, st, approxMeasure), st, { format, standalone });
}

function which(cmd: string) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const HAVE_LATEX = which('pdflatex') && which('kpsewhich') && (() => {
  try {
    return execFileSync('kpsewhich', ['forest.sty']).toString().trim() !== '';
  } catch {
    return false;
  }
})();
if (process.env.REQUIRE_LATEX && !HAVE_LATEX) throw new Error('REQUIRE_LATEX is set but pdflatex/forest are not available');

function compile(texSrc: string, engine = 'pdflatex'): Promise<{ ok: boolean; log: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'nanotrees-tex-'));
  writeFileSync(join(dir, 'tree.tex'), texSrc);
  return new Promise((resolve) => {
    // Vitest sets MODE=test, which Metafont's mktextfm would take as the printer mode
    const env = { ...process.env };
    delete env.MODE;
    execFile(engine, ['-interaction=nonstopmode', '-halt-on-error', 'tree.tex'], { cwd: dir, timeout: 90_000, env }, (err) => {
      const logPath = join(dir, 'tree.log');
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
      resolve({ ok: !err && existsSync(join(dir, 'tree.pdf')), log });
    });
  });
}

function errorExcerpt(log: string) {
  const i = log.indexOf('\n!');
  return i < 0 ? log.slice(-1500) : log.slice(i, i + 1500);
}

describe('LaTeX text conversion', () => {
  test('escapes special characters', () => {
    expect(texEscape('50% & $5 #1 a_b {x}')).toBe('50\\% \\& \\$5 \\#1 a\\_b \\{x\\}');
  });
  test('Greek and symbols go to math', () => {
    expect(texEscape('uφ ∅')).toBe('u$\\varphi$ $\\varnothing$');
    expect(texEscape("T′")).toBe("T${}'$");
  });
  test('sub- and superscripts, small caps', () => {
    expect(texRuns(parseRich('DP_i'))).toBe('DP\\textsubscript{i}');
    expect(texRuns(parseRich('X^0'))).toBe('X\\textsuperscript{0}');
    expect(texRuns(parseRich('read.PRS', { smallCaps: true }))).toBe('read.\\textsc{prs}');
  });
});

describe('forest export', () => {
  test('bracket structure with terminals as separate nodes', () => {
    const out = latex('[TP [DP the cat] [T′ [T will] [VP eat]]]', 'forest', {}, false);
    expect(out).toContain('\\begin{forest}');
    expect(out).toMatch(/\[\{DP\}\s*\n\s*\[\{\\textit\{the cat\}\}\]/);
    expect(out).toContain("[{T${}'$}");
  });
  test('triangles use roof', () => {
    expect(latex('[S [DP ^the big cat] [VP runs]]', 'forest', {}, false)).toMatch(/\\textit\{the big cat\}\}, roof\]/);
  });
  test('multidominance: shared node written once plus an extra branch', () => {
    const out = latex('[&P [VP likes #1] [&′ and [VP hates [DP#1 bagels]]]]', 'forest', { chains: 'multidominance' }, false);
    expect(out.match(/bagels/g)).toHaveLength(1);
    expect(out).toMatch(/\\draw \(n\d+\.south\) -- \(n\d+\.north\);/);
  });
  test('arrows are TikZ code after the tree', () => {
    const out = latex('[CP [DP#w what] [C′ did [VP see #w]]]', 'forest', {}, false);
    expect(out).toContain('\\coordinate (tf-bottom) at (current bounding box.south);');
    expect(out).toMatch(/\\draw\[-\{Stealth\}, semithick\] \(n\d+\.south\) \.\. controls/);
  });
  test('features and glosses', () => {
    const out = latex('[T{uφ, EPP} [V čitaet | read.PRS]]', 'forest', {}, false);
    expect(out).toContain('\\begin{tabular}{@{}l@{}}u$\\varphi$\\\\ EPP\\end{tabular}');
    expect(out).toContain('{\\small read.\\textsc{prs}}');
  });
  test('colours are defined', () => {
    const out = latex('[S [VP@@red x]]', 'forest');
    expect(out).toMatch(/\\definecolor\{tfA\}\{HTML\}\{D62828\}/);
    expect(out).toContain('edge={tfA}');
  });
});

describe.skipIf(!HAVE_LATEX)('LaTeX output compiles with pdflatex', () => {
  const cases: { name: string; src: string; build?: Partial<BuildOptions>; style?: object }[] = [];
  for (const ex of examples) {
    cases.push({ name: ex.id, src: ex.src, build: ex.build as Partial<BuildOptions>, style: ex.style });
  }
  cases.push({ name: 'atb-as-copies', src: examples.find((e) => e.id === 'atb')!.src, build: { chains: 'copies' } });
  cases.push({ name: 'xbar-bar-style', src: examples[0].src, build: { mode: 'xbar', xbar: { bar: 'always', headLabel: 'X0', emptySpecs: true, barStyle: 'bar', expandWords: true } } });
  cases.push({ name: 'atb-traces', src: examples.find((e) => e.id === 'atb')!.src, build: { chains: 'traces', chainIndices: true } });
  cases.push({ name: 'arrow-styles', src: '[CP#c [C′ [C#d did] [TP [DP#y you] [VP [V see] [DP#w what]]]]]\n#w -> #c dashed "wh"\n#y <-> #d curve dotted @blue\n#y -- #w @#2a7', style: { copyStyle: 'strike', leavesAtBottom: true } });
  cases.push({ name: 'round3-decorations', src: '[TP;spread=20 [DP#s;edge=red;width=2 **she** &"focus" &left"✓"@5,-3] [T\' [T;len=15 ~~will~~ *x*] [VP #s"herself" [V sing]]]]\n#s/2 -> #s/1 @blue above"*A*-mvt" below"x"' });
  cases.push({ name: 'special-chars', src: '[S [A 50\\% \\& \\$ x\\_y] [B "a [b]" ~ ‘q’ — …] [C ⟨x⟩ → α]]' });

  for (const c of cases) {
    for (const format of ['forest', 'qtree', 'tikz'] as LatexFormat[]) {
      test(`${c.name} (${format})`, async () => {
        const tex = latex(c.src, format, c.build, true, c.style);
        const r = await compile(tex);
        if (!r.ok) throw new Error(`${format} failed to compile:\n${errorExcerpt(r.log)}\n---\n${tex}`);
        expect(r.ok).toBe(true);
      }, 120_000);
    }
  }

  for (const ex of examples) {
    test.skipIf(!which('xelatex'))(`${ex.id} (forest) also compiles with XeLaTeX`, async () => {
      const r = await compile(latex(ex.src, 'forest', ex.build as Partial<BuildOptions>, true, ex.style), 'xelatex');
      if (!r.ok) throw new Error(errorExcerpt(r.log));
    }, 120_000);
  }
  test.skipIf(!which('xelatex'))('TikZ output compiles with XeLaTeX', async () => {
    const r = await compile(latex(examples[1].src, 'tikz'), 'xelatex');
    if (!r.ok) throw new Error(errorExcerpt(r.log));
  }, 120_000);

  test.skipIf(!which('lualatex'))('forest output also compiles with LuaLaTeX', async () => {
    const r = await compile(latex(examples[1].src, 'forest'), 'lualatex');
    if (!r.ok) throw new Error(errorExcerpt(r.log));
  }, 120_000);
});
