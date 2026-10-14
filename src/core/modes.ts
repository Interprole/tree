import { collectNodes, relink } from './model';
import type { DNode } from './model';
import { baseText, cloneRuns, plain } from './richtext';
import type { Runs } from './richtext';

export interface XbarOptions {
  /** X′ level: always project, only when there is a specifier, or never (flat XP) */
  bar: 'always' | 'auto' | 'never';
  /** head label: X or X⁰ */
  headLabel: 'X' | 'X0';
  /** insert empty specifier positions */
  emptySpecs: boolean;
  /** draw bar levels as primes (X′) or overlines (X̄) */
  barStyle: 'prime' | 'bar';
  /** expand single-word phrases: [NP cat] → NP → N′ → N → cat */
  expandWords: boolean;
}

export interface BpsOptions {
  /** what a computed label shows: category (D), head word (the) or set {the, {the, cat}} */
  label: 'category' | 'head' | 'set';
}

/* ---------------------------------------------------------------- helpers */

const PRIMES = /[′″']+$/;

/** Bar level and category of a label: "TP" → {cat:"T", level:"P"}, "T′" → {cat:"T", level:1}, "T" → {cat:"T", level:0}. */
export function analyseLabel(runs: Runs): { cat: string; level: 0 | 1 | 2 | 'P' } {
  let b = baseText(runs).trim();
  const sup = runs.find((r) => r.sup)?.text;
  const m = PRIMES.exec(b);
  if (m) {
    const n = m[0].replace('″', "''").length;
    b = b.slice(0, -m[0].length);
    return { cat: b, level: n >= 2 ? 2 : 1 };
  }
  if (b.endsWith('⁰')) return { cat: b.slice(0, -1), level: 0 };
  if (sup === 'max') return { cat: b, level: 'P' };
  if (b.length > 1 && b.endsWith('P')) return { cat: b.slice(0, -1), level: 'P' };
  return { cat: b, level: 0 };
}

function subs(runs: Runs): Runs {
  return runs.filter((r) => r.sub).map((r) => ({ ...r }));
}

function synth(key: string, label: Runs, children: DNode[], extra: Partial<DNode> = {}): DNode {
  return { key, kind: 'phrase', label, children, parents: [], synthetic: true, indices: [], ...extra };
}

function barLabel(cat: string, level: 1 | 2, style: 'prime' | 'bar'): Runs {
  if (style === 'bar') return level === 1 ? [{ text: cat, over: true }] : [{ text: cat, over: true }, { text: '′' }];
  return [{ text: cat + (level === 1 ? '′' : '″') }];
}

function headLabelRuns(cat: string, style: 'X' | 'X0', keepSubs: Runs): Runs {
  const r: Runs = [{ text: cat }];
  if (style === 'X0') r.push({ text: '0', sup: true });
  return [...r, ...keepSubs];
}

const isPhrase = (n: DNode) => n.kind === 'phrase';
const hasPhraseChild = (n: DNode) => n.children.some(isPhrase);
/** a lexical head: phrase node whose children are all terminals (or none) */
const isHeadLike = (n: DNode) => isPhrase(n) && !hasPhraseChild(n);

/* ---------------------------------------------------------------- X-bar */

/**
 * Complete X-bar projections. For XP with a head child X (or X⁰):
 *   [XP Spec X Comp] → [XP Spec [X′ X Comp]]
 * Nodes that already contain an X′ are left as written.
 */
export function applyXbar(root: DNode, o: XbarOptions): DNode {
  const done = new Set<DNode>();
  let counter = 0;
  const visit = (n: DNode) => {
    if (done.has(n)) return;
    done.add(n);
    for (const c of [...n.children]) visit(c);
    if (n.kind !== 'phrase' || n.triangle) return;
    const { cat, level } = analyseLabel(n.label);
    if (level === 'P' && cat) {
      let headIdx = n.children.findIndex((c) => {
        if (!isPhrase(c) || hasPhraseChild(c)) return false;
        const a = analyseLabel(c.label);
        return a.level === 0 && a.cat === cat;
      });
      const barIdx = n.children.findIndex((c) => isPhrase(c) && analyseLabel(c.label).cat === cat && analyseLabel(c.label).level === 1);
      if (barIdx >= 0) {
        // already projected: just restyle
        if (o.bar === 'never') {
          const bar = n.children[barIdx];
          n.children.splice(barIdx, 1, ...bar.children);
        }
        return;
      }
      // [NP cat] → NP → N′ → N → cat
      if (headIdx < 0 && o.expandWords && n.children.length === 1 && n.children[0].kind === 'leaf' && !/\s/.test(plain(n.children[0].label).trim())) {
        const leaf = n.children[0];
        const head = synth(`${n.key}~h`, headLabelRuns(cat, o.headLabel, []), [leaf]);
        n.children = [head];
        headIdx = 0;
        done.add(head);
      }
      if (headIdx < 0) return;
      const head = n.children[headIdx];
      head.label = headLabelRuns(analyseLabel(head.label).cat, o.headLabel, subs(head.label));
      const pre = n.children.slice(0, headIdx);
      const post = n.children.slice(headIdx + 1);
      if (o.bar === 'never') {
        if (pre.length === 0 && o.emptySpecs) n.children = [emptySpec(n, ++counter), head, ...post];
        return;
      }
      const needBar = o.bar === 'always' || pre.length > 0 || o.emptySpecs;
      if (!needBar) return;
      const bar = synth(`${n.key}~bar`, barLabel(cat, 1, o.barStyle), [head, ...post]);
      if (n.color && n.branchColor) bar.color = n.color;
      bar.branchColor = n.branchColor;
      if (n.copy) bar.copy = true;
      const spec = pre.length === 0 && o.emptySpecs ? [emptySpec(n, ++counter)] : pre;
      n.children = [...spec, bar];
    } else if (level === 0 && cat && isHeadLike(n) && n.children.length > 0) {
      // a bare head somewhere: normalise its label
      n.label = headLabelRuns(cat, o.headLabel, subs(n.label));
    }
  };
  visit(root);
  relink(root);
  if (o.barStyle === 'bar') {
    for (const n of collectNodes(root)) {
      const a = analyseLabel(n.label);
      if (n.kind === 'phrase' && (a.level === 1 || a.level === 2)) n.label = [...barLabel(a.cat, a.level, 'bar'), ...subs(n.label)];
    }
  }
  return root;
}

function emptySpec(n: DNode, k: number): DNode {
  return synth(`${n.key}~spec${k}`, [{ text: '∅' }], [], { empty: true });
}

/* ---------------------------------------------------------------- BPS */

/** Which daughter projects: marked with *, else the one matching the written label, else a head, else the first. */
export function projector(n: DNode, headOf: (d: DNode) => DNode): DNode | null {
  const kids = n.children.filter(isPhrase);
  if (kids.length === 0) return null;
  const marked = kids.find((k) => k.head);
  if (marked) return marked;
  const written = analyseLabel(n.label).cat;
  if (written) {
    const match = kids.find((k) => analyseLabel(headOf(k).label).cat === written);
    if (match) return match;
  }
  const head = kids.find(isHeadLike);
  return head ?? kids[0];
}

/**
 * Bare Phrase Structure: every non-terminal gets the label of its projecting head.
 */
export function applyBps(root: DNode, o: BpsOptions): DNode {
  relink(root);
  const headMemo = new Map<DNode, DNode>();
  const headOf = (n: DNode): DNode => {
    if (headMemo.has(n)) return headMemo.get(n)!;
    headMemo.set(n, n); // cycle guard
    let h = n;
    if (isPhrase(n) && hasPhraseChild(n)) {
      const p = projector(n, headOf);
      if (p) h = headOf(p);
    }
    headMemo.set(n, h);
    return h;
  };
  const catOf = (h: DNode): Runs => {
    const a = analyseLabel(h.label);
    if (a.cat) return [{ text: a.cat }];
    return [{ text: wordOf(h) }];
  };
  const wordOf = (h: DNode): string => {
    const leaf = h.children.find((c) => c.kind === 'leaf');
    if (leaf) return plain(leaf.label).trim();
    return plain(h.label).trim();
  };
  const setMemo = new Map<DNode, string>();
  const setRep = (n: DNode): string => {
    if (setMemo.has(n)) return setMemo.get(n)!;
    let s: string;
    if (!isPhrase(n)) s = plain(n.label).trim();
    else if (!hasPhraseChild(n)) s = wordOf(n);
    else {
      const parts = n.children.filter(isPhrase).map(setRep);
      s = `{${wordOf(headOf(n))}, {${parts.join(', ')}}}`;
    }
    setMemo.set(n, s);
    return s;
  };
  for (const n of collectNodes(root)) {
    if (!isPhrase(n) || !hasPhraseChild(n)) continue;
    const h = headOf(n);
    let label: Runs;
    if (o.label === 'category') label = catOf(h);
    else if (o.label === 'head') label = [{ text: wordOf(h) }];
    else label = [{ text: setRep(n) }];
    n.label = [...label, ...subs(n.label)];
  }
  return root;
}

export { cloneRuns };
