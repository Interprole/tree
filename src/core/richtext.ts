/**
 * Inline markup used inside node labels, terminals, features and glosses.
 *
 *   X_i, X_{i,j}     subscript (the text of a subscript is also its coindex)
 *   X^0, X^{max}     superscript
 *   T'  T''          primes (labels only): rendered as ′ ″
 *   \phi \alpha ...  named symbols (Greek, ∅ etc.), see MACROS
 *   \_ \^ \[ ...     escape any special character
 *   "a [literal]"    quoted literal text (no markup inside)
 *   ~                non-breaking space
 */

export interface Run {
  text: string;
  sub?: boolean;
  sup?: boolean;
  /** small caps (used for Leipzig-style gloss abbreviations) */
  sc?: boolean;
  /** overline (X-bar "bar" notation) */
  over?: boolean;
}

export type Runs = Run[];

export const MACROS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  emptyset: '∅', varnothing: '∅', empty: '∅', '0': '∅', null: '∅',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', pm: '±', times: '×', cdot: '·',
  surd: '√', sqrt: '√', check: '✓', star: '*', ast: '*', bullet: '•', dots: '…', ldots: '…',
  langle: '⟨', rangle: '⟩', neg: '¬', forall: '∀', exists: '∃', in: '∈', cup: '∪', cap: '∩',
land: '∧', wedge: '∧', lor: '∨', vee: '∨', lnot: '¬', llbracket: '⟦', rrbracket: '⟧', leftrightarrow: '↔', subset: '⊂',
  emdash: '—', endash: '–', prime: '′', dprime: '″', sharp: '♯', flat: '♭',
};

/** Characters that may be escaped with a backslash to be taken literally. */
const ESCAPABLE = new Set('[]{}|#*@^_%\\<>"\'~ ,.-=:;()!/&$'.split(''));

export interface RichOptions {
  /** convert ' to ′ (labels) */
  primes?: boolean;
  /** render ALL-CAPS gloss abbreviations in small caps */
  smallCaps?: boolean;
}

function push(runs: Runs, text: string, style: Omit<Run, 'text'> = {}) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && !!last.sub === !!style.sub && !!last.sup === !!style.sup && !!last.sc === !!style.sc && !!last.over === !!style.over) {
    last.text += text;
  } else {
    const r: Run = { text };
    if (style.sub) r.sub = true;
    if (style.sup) r.sup = true;
    if (style.sc) r.sc = true;
    if (style.over) r.over = true;
    runs.push(r);
  }
}

/** Read one "unit" of text after _ or ^ : a {group} or a run of letters/digits. */
function readScript(src: string, i: number): { text: string; end: number } {
  if (src[i] === '{') {
    let depth = 1;
    let j = i + 1;
    let out = '';
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '\\' && j + 1 < src.length) {
        const m = readMacro(src, j);
        out += m.text;
        j = m.end;
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
      out += c;
      j++;
    }
    return { text: out, end: j + 1 };
  }
  if (src[i] === '\\') {
    const m = readMacro(src, i);
    return { text: m.text, end: m.end };
  }
  let j = i;
  while (j < src.length && /[\p{L}\p{N}]/u.test(src[j])) j++;
  if (j === i && i < src.length) j = i + 1; // single non-word char, e.g. ^+ or ^*
  return { text: src.slice(i, j), end: j };
}

/** Read a backslash escape or macro starting at src[i] === '\\'. */
export function readMacro(src: string, i: number): { text: string; end: number; unknown?: boolean } {
  const next = src[i + 1];
  if (next === undefined) return { text: '\\', end: i + 1 };
  if (/[A-Za-z]/.test(next)) {
    let j = i + 1;
    while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
    const name = src.slice(i + 1, j);
    // swallow a single following space as in TeX ("\phi P" -> "φP" is unusual; keep space)
    if (name in MACROS) return { text: MACROS[name], end: j };
    return { text: '\\' + name, end: j, unknown: true };
  }
  if (next === '0') return { text: '∅', end: i + 2 };
  if (ESCAPABLE.has(next)) return { text: next, end: i + 2 };
  return { text: next, end: i + 2 };
}

const SC_RE = /^[A-Z0-9]*[A-Z][A-Z0-9]*$/;

/** Split a gloss string into runs, putting ALL-CAPS abbreviations (3SG, NOM) in small caps. */
function smallCapsSplit(runs: Runs, text: string, style: Omit<Run, 'text'>) {
  const parts = text.split(/([A-Z0-9]+)/);
  let prev = '';
  for (const p of parts) {
    if (!p) continue;
    const afterSep = /[.\-=:>]$/.test(prev);
    prev = p;
    if (SC_RE.test(p) && (/[A-Z]{2,}|^[0-9][A-Z]/.test(p) || afterSep)) {
      push(runs, p.toLowerCase(), { ...style, sc: true });
    } else {
      push(runs, p, style);
    }
  }
}

/** Parse inline markup into styled runs. */
export function parseRich(src: string, opts: RichOptions = {}): Runs {
  const runs: Runs = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (!buf) return;
    if (opts.smallCaps) smallCapsSplit(runs, buf, {});
    else push(runs, buf);
    buf = '';
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const m = readMacro(src, i);
      buf += m.text;
      i = m.end;
    } else if (c === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) {
        buf += src.slice(i + 1);
        i = src.length;
      } else {
        buf += src.slice(i + 1, j);
        i = j + 1;
      }
    } else if ((c === '_' || c === '^') && i + 1 < src.length) {
      flush();
      const s = readScript(src, i + 1);
      const style = c === '_' ? { sub: true } : { sup: true };
      // nested markup inside a script group (e.g. _{i'}) – keep it simple: macros resolved above
      push(runs, opts.primes ? s.text.replace(/'/g, '′') : s.text, style);
      i = s.end;
    } else if (c === "'" && opts.primes) {
      buf += '′';
      i++;
    } else if (c === '~') {
      buf += ' ';
      i++;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  // normalise double primes
  for (const r of runs) r.text = r.text.replace(/′′/g, '″');
  return runs;
}

export function plain(runs: Runs): string {
  return runs.map((r) => r.text).join('');
}

/** Coindices: the comma-separated contents of all subscripts. */
export function indicesOf(runs: Runs): string[] {
  const out: string[] = [];
  for (const r of runs) {
    if (r.sub) for (const p of r.text.split(/[,\s]+/)) if (p) out.push(p);
  }
  return out;
}

/** Text of the runs without sub/superscripts (the "base" of a label). */
export function baseText(runs: Runs): string {
  return runs.filter((r) => !r.sub && !r.sup).map((r) => r.text).join('');
}

export function cloneRuns(runs: Runs): Runs {
  return runs.map((r) => ({ ...r }));
}
