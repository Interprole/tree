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
  /** markdown: **bold**, *italic*, ~~strike~~ */
  b?: boolean;
  i?: boolean;
  s?: boolean;
}

export type Runs = Run[];

/** Standard LaTeX (and amssymb) symbol commands, usable as \name anywhere. */
export const LATEX_SYMBOLS: Record<string, string> = {
  // Greek
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
  varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // arrows
  rightarrow: '→', to: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', uparrow: '↑', downarrow: '↓', updownarrow: '↕',
  Rightarrow: '⇒', Leftarrow: '⇐', nRightarrow: '⇏', nLeftarrow: '⇍', Leftrightarrow: '⇔', Uparrow: '⇑', Downarrow: '⇓', Updownarrow: '⇕',
  Rightleftarrow: '⇄', rightleftarrows: '⇄',
  longrightarrow: '⟶', longleftarrow: '⟵', longleftrightarrow: '⟷', Longrightarrow: '⟹', Longleftarrow: '⟸', Longleftrightarrow: '⟺',
  implies: '⟹', impliedby: '⟸', iff: '⟺', mapsto: '↦', longmapsto: '⟼', hookrightarrow: '↪', hookleftarrow: '↩',
  nearrow: '↗', searrow: '↘', swarrow: '↙', nwarrow: '↖', leadsto: '⇝', rightsquigarrow: '⇝', rightharpoonup: '⇀', leftharpoonup: '↼',
  rightleftharpoons: '⇌', twoheadrightarrow: '↠', curvearrowright: '↷', curvearrowleft: '↶', circlearrowright: '↻', circlearrowleft: '↺',
  // logic and sets
  neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨', forall: '∀', exists: '∃', nexists: '∄',
  top: '⊤', bot: '⊥', vdash: '⊢', dashv: '⊣', models: '⊨', vDash: '⊨', Vdash: '⊩', therefore: '∴', because: '∵',
  emptyset: '∅', varnothing: '∅', in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
  subsetneq: '⊊', supsetneq: '⊋', cup: '∪', cap: '∩', bigcup: '⋃', bigcap: '⋂', setminus: '∖', complement: '∁', powerset: '℘', wp: '℘',
  // relations
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', equiv: '≡', approx: '≈', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', ll: '≪', gg: '≫', prec: '≺', succ: '≻', preceq: '⪯', succeq: '⪰', triangleleft: '◁', triangleright: '▷',
  lhd: '⊲', rhd: '⊳', unlhd: '⊴', unrhd: '⊵', parallel: '∥', perp: '⊥', mid: '∣', coloneqq: '≔', doteq: '≐',
  // operators
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', circ: '∘', bullet: '•', ast: '∗', star: '⋆', oplus: '⊕', otimes: '⊗',
  odot: '⊙', sqcup: '⊔', sqcap: '⊓', uplus: '⊎', sum: '∑', prod: '∏', coprod: '∐', int: '∫', oint: '∮', partial: '∂',
  nabla: '∇', infty: '∞', surd: '√', sqrt: '√', angle: '∠', diamond: '⋄', Diamond: '◇', Box: '□', square: '□', blacksquare: '■',
  triangle: '△', bigtriangleup: '△', bigtriangledown: '▽', lozenge: '◊', checkmark: '✓', dagger: '†', ddagger: '‡',
  // letters and misc
  aleph: 'ℵ', beth: 'ℶ', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', prime: '′', backprime: '‵', S: '§', P: '¶', copyright: '©',
  dots: '…', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊',
  rfloor: '⌋', llbracket: '⟦', rrbracket: '⟧', sharp: '♯', flat: '♭', natural: '♮', clubsuit: '♣', diamondsuit: '♢',
  heartsuit: '♡', spadesuit: '♠', textdagger: '†', textsection: '§', textbullet: '•', textendash: '–', textemdash: '—',
  textasciitilde: '~', textbackslash: '\\', textbar: '|', textless: '<', textgreater: '>', textdegree: '°', degree: '°',
};

export const MACROS: Record<string, string> = {
  ...LATEX_SYMBOLS,
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
  const keys = ['sub', 'sup', 'sc', 'over', 'b', 'i', 's'] as const;
  if (last && keys.every((k) => !!last[k] === !!style[k])) {
    last.text += text;
  } else {
    const r: Run = { text };
    for (const k of keys) if (style[k]) r[k] = true;
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
  const cur: { b?: boolean; i?: boolean; s?: boolean } = {};
  const flush = () => {
    if (!buf) return;
    if (opts.smallCaps) smallCapsSplit(runs, buf, { ...cur });
    else push(runs, buf, { ...cur });
    buf = '';
  };
  /** a closing single * after position k (not part of **) */
  const closingStar = (k: number) => {
    for (let j = k; j < src.length; j++) {
      if (src[j] === '\\') {
        j++;
        continue;
      }
      if (src[j] === '*' && src[j + 1] !== '*' && src[j - 1] !== '*') return true;
    }
    return false;
  };
  while (i < src.length) {
    const c = src[i];
    // markdown: a marker only counts when it is closed later
    if (src.startsWith('**', i) || src.startsWith('~~', i)) {
      const key = c === '*' ? 'b' : 's';
      if (cur[key] || src.indexOf(src.slice(i, i + 2), i + 2) >= 0) {
        flush();
        cur[key] = !cur[key];
        i += 2;
        continue;
      }
    } else if (c === '*' && (cur.i || closingStar(i + 1))) {
      flush();
      cur.i = !cur.i;
      i++;
      continue;
    }
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
      const style = c === '_' ? { ...cur, sub: true } : { ...cur, sup: true };
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
