import { LATEX_SYMBOLS } from './richtext';
import type { Runs } from './richtext';

/**
 * A small typed λ-calculus for compositional semantics in the style of Heim & Kratzer (1998).
 *
 *   $λx. cat(x) : <e,t>$          formula and (optional) type
 *   $λx_e.λe_s. agent(e)(x)$      bound variables may carry a type (x_e or x:e)
 *
 * Composition rules (tried in this order):
 *   FA  Functional Application    [[β]] : ⟨a,b⟩, [[γ]] : a              → [[β]]([[γ]])
 *   PC  Predicate Conjunction     [[β]], [[γ]] : same predicate type f → λa₁…aₙ. β(a…) ∧ γ(a…)
 *   EI  Event Identification      [[β]] : ⟨e,⟨s,t⟩⟩, [[γ]] : ⟨s,t⟩     → λx_e.λe_s. β(x)(e) ∧ γ(e)
 *   FC  Function Composition      [[β]] : ⟨b,c⟩, [[γ]] : ⟨a,b⟩         → λx_a. β(γ(x))
 */

/* ---------------------------------------------------------------- types */

export type Ty = { k: 'base'; n: string } | { k: 'fn'; a: Ty; b: Ty };

export const E: Ty = { k: 'base', n: 'e' };
export const T: Ty = { k: 'base', n: 't' };
export const S: Ty = { k: 'base', n: 's' };
export const fn = (a: Ty, b: Ty): Ty => ({ k: 'fn', a, b });

export function tyEq(a: Ty, b: Ty): boolean {
  if (a.k === 'base' && b.k === 'base') return a.n === b.n;
  if (a.k === 'fn' && b.k === 'fn') return tyEq(a.a, b.a) && tyEq(a.b, b.b);
  return false;
}

export function showTy(t: Ty): string {
  return t.k === 'base' ? t.n : `⟨${showTy(t.a)},${showTy(t.b)}⟩`;
}

export function parseTy(src: string): Ty {
  let i = 0;
  const s = src.replace(/\s+/g, '');
  const go = (): Ty => {
    const c = s[i];
    if (c === '<' || c === '⟨' || c === '(') {
      i++;
      const a = go();
      if (s[i] !== ',') throw new SemError(`Malformed type "${src}": expected ","`);
      i++;
      const b = go();
      if (s[i] !== '>' && s[i] !== '⟩' && s[i] !== ')') throw new SemError(`Malformed type "${src}": expected ">"`);
      i++;
      return fn(a, b);
    }
    const m = /^[\p{L}][\p{L}\p{N}_]*/u.exec(s.slice(i));
    if (!m) throw new SemError(`Malformed type "${src}"`);
    i += m[0].length;
    return { k: 'base', n: m[0] };
  };
  const t = go();
  if (i !== s.length) throw new SemError(`Malformed type "${src}"`);
  return t;
}

/** n-ary predicate type ending in t: argument types, or null */
function predicateArgs(t: Ty): Ty[] | null {
  const args: Ty[] = [];
  let cur = t;
  while (cur.k === 'fn') {
    args.push(cur.a);
    cur = cur.b;
  }
  return cur.n === 't' ? args : null;
}

/* ---------------------------------------------------------------- terms */

export type Term =
  | { k: 'var'; name: string; ty?: Ty }
  | { k: 'const'; name: string }
  | { k: 'app'; f: Term; args: Term[] }
  | { k: 'bind'; op: 'λ' | '∃' | '∀' | 'ι'; v: string; ty: Ty; body: Term }
  | { k: 'not'; a: Term }
  | { k: 'bin'; op: BinOp; a: Term; b: Term };

export type BinOp = '∧' | '∨' | '→' | '↔' | '=' | '≠' | '<' | '>' | '≤' | '≥' | '+' | '−' | '×';
const ARITH = new Set(['+', '−', '×']);

export class SemError extends Error {}

/** Default type of a variable from its name: x, y, z → e; e, e′, e1 → s (events); P, Q → ⟨e,t⟩. */
export function defaultVarTy(name: string): Ty {
  const base = name.replace(/[′'″0-9₀-₉]+$/, '');
  if (base === 'e' || base === 'ev') return S;
  if (/^[PQR]$/.test(base)) return fn(E, T);
  if (base === 'p' || base === 'q') return T;
  return E;
}

const ID = /^[\p{L}][\p{L}\p{N}′'″₀-₉]*/u;

export function parseTerm(src: string): Term {
  const s = src
    .replace(/\\lambda\b/g, 'λ')
    .replace(/\\exists\b/g, '∃')
    .replace(/\\forall\b/g, '∀')
    .replace(/\\iota\b/g, 'ι')
    .replace(/\\(land|wedge)\b/g, '∧')
    .replace(/\\(lor|vee)\b/g, '∨')
    .replace(/\\(neg|lnot)\b/g, '¬')
    .replace(/\\(to|rightarrow)\b/g, '→')
    .replace(/<->|\\leftrightarrow\b/g, '↔')
    // any other LaTeX symbol command (\Rightarrow, \neq, …); single letters stay λ-shorthand (\x.)
    .replace(/\\([A-Za-z]{2,})/g, (m, name: string) => LATEX_SYMBOLS[name] ?? m)
    .replace(/[⇒⟹]/g, '→')
    .replace(/[⇔⟺]/g, '↔')
    .replace(/->/g, '→')
    .replace(/<=/g, '≤')
    .replace(/>=/g, '≥')
    .replace(/!=/g, '≠')
    .replace(/(?<=\s)-(?=\s)/g, '−')
    .replace(/\*/g, '×')
    .replace(/&/g, '∧')
    .replace(/\\(?=[a-zA-Z]\s*[._:])/g, 'λ')
    // words for binders: lambda x. / iota x. / exists x. / forall x.
    .replace(/(?<![\p{L}\\])(lambda|iota|exists|forall)\s*(?=[\p{L}][\p{L}\p{N}′']*\s*[._:])/gu, (_, w: string) => ({ lambda: 'λ', iota: 'ι', exists: '∃', forall: '∀' })[w as 'lambda']!);
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const err = (m: string): never => {
    throw new SemError(`${m} in "${src}" at position ${i + 1}`);
  };
  const bound: { name: string; ty: Ty }[] = [];

  const parseExpr = (): Term => parseBin(0);
  const PREC: Record<string, number> = { '↔': 1, '→': 2, '∨': 3, '∧': 4, '=': 5, '≠': 5, '<': 5, '>': 5, '≤': 5, '≥': 5, '+': 6, '−': 6, '×': 7 };
  const parseBin = (min: number): Term => {
    let left = parseUnary();
    for (;;) {
      ws();
      const op = s[i];
      const p = PREC[op];
      if (p === undefined || p < min) return left;
      i++;
      // right-assoc for →, left for others
      const right = parseBin(op === '→' ? p : p + 1);
      left = { k: 'bin', op: op as BinOp, a: left, b: right };
    }
  };
  const parseUnary = (): Term => {
    ws();
    const c = s[i];
    if (c === '¬' || c === '~') {
      i++;
      return { k: 'not', a: parseUnary() };
    }
    if (c === 'λ' || c === '∃' || c === '∀' || c === 'ι') {
      i++;
      ws();
      const m = ID.exec(s.slice(i));
      if (!m) err('Expected a variable after ' + c);
      const name = m![0];
      i += name.length;
      let ty: Ty | undefined;
      if (s[i] === '_' || s[i] === ':') {
        i++;
        // type: up to "." at depth 0
        const st = i;
        let depth = 0;
        while (i < s.length && !(depth === 0 && s[i] === '.')) {
          if ('<⟨('.includes(s[i])) depth++;
          if ('>⟩)'.includes(s[i])) depth--;
          i++;
        }
        ty = parseTy(s.slice(st, i));
      }
      ws();
      if (s[i] !== '.') err('Expected "." after the bound variable');
      i++;
      const vty = ty ?? defaultVarTy(name);
      bound.push({ name, ty: vty });
      const body = parseExpr();
      bound.pop();
      return { k: 'bind', op: c as 'λ', v: name, ty: vty, body };
    }
    return parsePostfix(parseAtom());
  };
  const parseAtom = (): Term => {
    ws();
    if (s[i] === '(' || s[i] === '[') {
      const close = s[i] === '(' ? ')' : ']';
      i++;
      const t = parseExpr();
      ws();
      if (s[i] !== close) err(`Expected "${close}"`);
      i++;
      return t;
    }
    const num = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return { k: 'const', name: num[0] };
    }
    const m = ID.exec(s.slice(i));
    if (!m) err(s[i] ? `Unexpected "${s[i]}"` : 'Unexpected end of formula');
    i += m![0].length;
    const name = m![0];
    for (let k = bound.length - 1; k >= 0; k--) if (bound[k].name === name) return { k: 'var', name, ty: bound[k].ty };
    return { k: 'const', name };
  };
  const parsePostfix = (t: Term): Term => {
    for (;;) {
      if (s[i] !== '(') return t;
      i++;
      const args: Term[] = [];
      ws();
      if (s[i] === ')') err('Empty argument list');
      for (;;) {
        args.push(parseExpr());
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === ')') {
          i++;
          break;
        }
        err('Expected "," or ")"');
      }
      t = { k: 'app', f: t, args };
    }
  };
  const t = parseExpr();
  ws();
  if (i < s.length) err(`Unexpected "${s[i]}"`);
  return t;
}

/* ---------------------------------------------------------------- typing */

function headConst(t: Term): boolean {
  if (t.k === 'const') return true;
  if (t.k === 'app') return headConst(t.f);
  return false;
}

/** Type of a term. Constants applied to arguments are predicates (result t); bare constants are e. */
export function typeOf(t: Term): Ty {
  switch (t.k) {
    case 'var':
      return t.ty ?? defaultVarTy(t.name);
    case 'const':
      return E;
    case 'bind':
      if (t.op === 'λ') return fn(t.ty, typeOf(t.body));
      if (t.op === 'ι') return t.ty;
      return T;
    case 'not':
      return T;
    case 'bin':
      return ARITH.has(t.op) ? typeOf(t.a) : T;
    case 'app': {
      if (headConst(t)) return T;
      let ft = typeOf(t.f);
      for (const a of t.args) {
        if (ft.k !== 'fn') throw new SemError(`${show(t.f)} is of type ${showTy(ft)} and cannot apply to ${show(a)}`);
        const at = typeOf(a);
        if (!tyEq(ft.a, at)) throw new SemError(`${show(t.f)} expects ${showTy(ft.a)} but gets ${show(a)} : ${showTy(at)}`);
        ft = ft.b;
      }
      return ft;
    }
  }
}

/* ---------------------------------------------------------------- reduction */

/** free variables and constants (a constant may be captured by a binder of the same name) */
function freeVars(t: Term, out = new Set<string>()): Set<string> {
  switch (t.k) {
    case 'var':
    case 'const':
      out.add(t.name);
      break;
    case 'app':
      freeVars(t.f, out);
      t.args.forEach((a) => freeVars(a, out));
      break;
    case 'bind': {
      const inner = freeVars(t.body);
      inner.delete(t.v);
      inner.forEach((v) => out.add(v));
      break;
    }
    case 'not':
      freeVars(t.a, out);
      break;
    case 'bin':
      freeVars(t.a, out);
      freeVars(t.b, out);
      break;
  }
  return out;
}

function allNames(t: Term, out = new Set<string>()): Set<string> {
  switch (t.k) {
    case 'var':
    case 'const':
      out.add(t.name);
      break;
    case 'app':
      allNames(t.f, out);
      t.args.forEach((a) => allNames(a, out));
      break;
    case 'bind':
      out.add(t.v);
      allNames(t.body, out);
      break;
    case 'not':
      allNames(t.a, out);
      break;
    case 'bin':
      allNames(t.a, out);
      allNames(t.b, out);
      break;
  }
  return out;
}

export function fresh(base: string, avoid: Set<string>): string {
  if (!avoid.has(base)) return base;
  for (const p of ['′', '″', '‴']) if (!avoid.has(base + p)) return base + p;
  for (let k = 1; ; k++) if (!avoid.has(base + k)) return base + k;
}

/** Capture-avoiding substitution t[v := r]. */
function subst(t: Term, v: string, r: Term): Term {
  switch (t.k) {
    case 'var':
      return t.name === v ? r : t;
    case 'const':
      return t;
    case 'app':
      return { k: 'app', f: subst(t.f, v, r), args: t.args.map((a) => subst(a, v, r)) };
    case 'not':
      return { k: 'not', a: subst(t.a, v, r) };
    case 'bin':
      return { ...t, a: subst(t.a, v, r), b: subst(t.b, v, r) };
    case 'bind': {
      if (t.v === v) return t;
      const fv = freeVars(r);
      if (fv.has(t.v)) {
        const nv = fresh(t.v, new Set([...fv, ...allNames(t.body)]));
        const renamed = subst(t.body, t.v, { k: 'var', name: nv, ty: t.ty });
        return { ...t, v: nv, body: subst(renamed, v, r) };
      }
      return { ...t, body: subst(t.body, v, r) };
    }
  }
}

/** β-normal form. */
export function reduce(t: Term): Term {
  switch (t.k) {
    case 'var':
    case 'const':
      return t;
    case 'not':
      return { k: 'not', a: reduce(t.a) };
    case 'bin':
      return { ...t, a: reduce(t.a), b: reduce(t.b) };
    case 'bind':
      return { ...t, body: reduce(t.body) };
    case 'app': {
      let f = reduce(t.f);
      const args = t.args.map(reduce);
      let k = 0;
      while (k < args.length && f.k === 'bind' && f.op === 'λ') {
        f = reduce(subst(f.body, f.v, args[k]));
        k++;
      }
      if (k === args.length) return f;
      const rest = args.slice(k);
      // merge f(a)(b) into f(a, b) only when it was written that way: keep curried form
      return { k: 'app', f, args: rest };
    }
  }
}

/* ---------------------------------------------------------------- printing */

const PREC_OUT: Record<string, number> = { '↔': 1, '→': 2, '∨': 3, '∧': 4, '=': 5, '≠': 5, '<': 5, '>': 5, '≤': 5, '≥': 5, '+': 6, '−': 6, '×': 7 };

/** Formula as plain text. */
export function show(t: Term): string {
  return showRuns(t, false)
    .map((r) => r.text)
    .join('');
}

/** Formula as rich runs; bound variables carry their type as a subscript when typed=true. */
export function showRuns(t: Term, typed = true): Runs {
  const out: Runs = [];
  const push = (text: string, sub = false) => {
    const last = out[out.length - 1];
    if (last && !!last.sub === sub) last.text += text;
    else out.push(sub ? { text, sub: true } : { text });
  };
  const go = (x: Term, ctx: number) => {
    switch (x.k) {
      case 'var':
      case 'const':
        push(x.name);
        return;
      case 'app': {
        const needParen = x.f.k === 'bind' || x.f.k === 'bin' || x.f.k === 'not';
        if (needParen) push('[');
        go(x.f, 10);
        if (needParen) push(']');
        push('(');
        x.args.forEach((a, i) => {
          if (i) push(', ');
          go(a, 0);
        });
        push(')');
        return;
      }
      case 'not':
        push('¬');
        go(x.a, 9);
        return;
      case 'bin': {
        const p = PREC_OUT[x.op];
        const paren = p < ctx;
        if (paren) push('[');
        go(x.a, p + (x.op === '→' ? 1 : 0));
        push(` ${x.op} `);
        go(x.b, x.op === '→' || x.op === '∧' || x.op === '∨' ? p : p + 1);
        if (paren) push(']');
        return;
      }
      case 'bind': {
        const paren = ctx > 0;
        if (paren) push('[');
        push(x.op + x.v);
        if (typed) push(showTy(x.ty), true);
        push('. ');
        go(x.body, 0);
        if (paren) push(']');
        return;
      }
    }
  };
  go(t, 0);
  return out;
}

/** Formula in the input syntax (typed binders as x_e, x_<e,t>), so that it parses back. */
export function toSource(t: Term): string {
  return showRuns(t, true)
    .map((r) => (r.sub ? '_' + r.text.replace(/⟨/g, '<').replace(/⟩/g, '>') : r.text))
    .join('');
}

/* ---------------------------------------------------------------- meanings */

export interface Meaning {
  term: Term;
  ty: Ty;
}

/** Parse "formula : type" (the type is optional and checked against the formula when possible). */
/** Split "formula : type": the last " : " followed by something that parses as a type. */
export function splitMeaning(src: string): [string, string | undefined] {
  for (let i = src.length - 1; i > 0; i--) {
    if (src[i] !== ':' || !/\s/.test(src[i - 1])) continue;
    const rest = src.slice(i + 1).trim();
    try {
      parseTy(rest);
      return [src.slice(0, i).trim(), rest];
    } catch {
      /* not a type: keep looking */
    }
  }
  return [src.trim(), undefined];
}

export function parseMeaning(src: string): Meaning {
  const [f, tyText] = splitMeaning(src);
  const cut = tyText === undefined ? -1 : 0;
  const formula = f;
  const declared = cut >= 0 ? parseTy(tyText!) : undefined;
  if (!formula) throw new SemError('Empty formula');
  const term = parseTerm(formula);
  if (declared) {
    // a bare constant or predicate name may be given any type
    if (term.k === 'const') return { term, ty: declared };
    let inferred: Ty | null = null;
    try {
      inferred = typeOf(term);
    } catch {
      inferred = null;
    }
    if (inferred && !tyEq(inferred, declared)) {
      throw new SemError(`The formula has type ${showTy(inferred)}, not ${showTy(declared)}`);
    }
    return { term, ty: declared };
  }
  return { term, ty: typeOf(term) };
}

export type RuleName = 'FA' | 'PC' | 'EI' | 'FC';

/** Predicate Abstraction: λname. ⟦φ⟧ (the name may be written as a constant, e.g. a trace x). */
export function abstractOver(m: Meaning, name: string, ty: Ty): Meaning {
  const toVar = (t: Term): Term => {
    switch (t.k) {
      case 'const':
        return t.name === name ? { k: 'var', name, ty } : t;
      case 'var':
        return t.name === name ? { k: 'var', name, ty } : t;
      case 'app':
        return { k: 'app', f: toVar(t.f), args: t.args.map(toVar) };
      case 'not':
        return { k: 'not', a: toVar(t.a) };
      case 'bin':
        return { ...t, a: toVar(t.a), b: toVar(t.b) };
      case 'bind':
        return t.v === name ? t : { ...t, body: toVar(t.body) };
    }
  };
  return { term: { k: 'bind', op: 'λ', v: name, ty, body: toVar(m.term) }, ty: fn(ty, m.ty) };
}

export interface Composed extends Meaning {
  rule: RuleName;
}

function app(f: Term, ...args: Term[]): Term {
  return { k: 'app', f, args };
}

function lam(v: string, ty: Ty, body: Term): Term {
  return { k: 'bind', op: 'λ', v, ty, body };
}

function varFor(ty: Ty, avoid: Set<string>): string {
  const names = ty.k === 'base' ? (ty.n === 's' || ty.n === 'v' ? ['e'] : ty.n === 'e' ? ['x', 'y', 'z'] : ty.n === 't' ? ['p', 'q'] : ['a']) : ['P', 'Q', 'f', 'g'];
  const v = names.find((n) => !avoid.has(n)) ?? fresh(names[0], avoid);
  avoid.add(v);
  return v;
}

/** Combine two daughters by the first applicable rule; throws SemError if none applies. */
export function compose(b: Meaning, g: Meaning): Composed {
  const avoid = new Set([...freeVars(b.term), ...freeVars(g.term)]);
  const out = (term: Term, ty: Ty, rule: RuleName): Composed => ({ term: reduce(term), ty, rule });
  // FA
  for (const [f, x] of [
    [b, g],
    [g, b],
  ] as const) {
    if (f.ty.k === 'fn' && tyEq(f.ty.a, x.ty)) return out(app(f.term, x.term), f.ty.b, 'FA');
  }
  // PC
  if (tyEq(b.ty, g.ty)) {
    const args = predicateArgs(b.ty);
    if (args) {
      const vs = args.map((t) => varFor(t, avoid));
      const vars = vs.map((name, i) => ({ k: 'var', name, ty: args[i] }) as Term);
      const curried = (f: Term) => vars.reduce<Term>((acc, v) => app(acc, v), f);
      const body: Term = { k: 'bin', op: '∧', a: curried(b.term), b: curried(g.term) };
      let term: Term = body;
      for (let i = vs.length - 1; i >= 0; i--) term = lam(vs[i], args[i], term);
      return out(term, b.ty, 'PC');
    }
  }
  // EI
  for (const [f, p] of [
    [b, g],
    [g, b],
  ] as const) {
    const ft = f.ty;
    if (ft.k === 'fn' && tyEq(ft.a, E) && ft.b.k === 'fn' && ft.b.b.k === 'base' && ft.b.b.n === 't' && p.ty.k === 'fn' && tyEq(p.ty, ft.b) && ft.b.a.k === 'base' && (ft.b.a.n === 's' || ft.b.a.n === 'v')) {
      const ev = ft.b.a;
      const x = varFor(E, avoid);
      const e = varFor(ev, avoid);
      const X: Term = { k: 'var', name: x, ty: E };
      const Ev: Term = { k: 'var', name: e, ty: ev };
      return out(lam(x, E, lam(e, ev, { k: 'bin', op: '∧', a: app(app(f.term, X), Ev), b: app(p.term, Ev) })), ft, 'EI');
    }
  }
  // FC
  for (const [f, h] of [
    [b, g],
    [g, b],
  ] as const) {
    if (f.ty.k === 'fn' && h.ty.k === 'fn' && tyEq(f.ty.a, h.ty.b)) {
      const x = varFor(h.ty.a, avoid);
      const X: Term = { k: 'var', name: x, ty: h.ty.a };
      return out(lam(x, h.ty.a, app(f.term, app(h.term, X))), fn(h.ty.a, f.ty.b), 'FC');
    }
  }
  throw new SemError(
    `No composition rule applies to ${showTy(b.ty)} and ${showTy(g.ty)} ` +
      `(FA needs ⟨a,b⟩ + a; PC needs two predicates of the same type; EI needs ⟨e,⟨s,t⟩⟩ + ⟨s,t⟩; FC needs ⟨b,c⟩ + ⟨a,b⟩)`,
  );
}
